/**
 * Model Adapter
 * 
 * Abstracts different model providers (gpt4all, OpenAI, etc.)
 */

import { auditLogger } from "../security/auditLogger";
import { replayStore } from "../storage/replayStore";

export interface ModelResponse {
  content: string;
  model: string;
  tokensUsed?: number;
  executionTimeMs?: number;
}

export interface ModelConfig {
  baseURL: string;
  apiKey: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
}

export abstract class ModelAdapter {
  abstract call(
    systemPrompt: string,
    userMessage: string,
    overrides?: import('./generation').ModelCallOverrides
  ): Promise<ModelResponse>;
}

function recordModelAudit(
  overrides: import("./generation").ModelCallOverrides | undefined,
  details: {
    model: string;
    executionTimeMs: number;
    temperature?: number;
    maxTokens?: number;
    seed?: number;
    promptLength: number;
    userMessageLength: number;
    success: boolean;
    error?: string;
  }
): void {
  if (!overrides?.taskId && !overrides?.agentId) return;

  auditLogger.log({
    eventType: "model-call",
    agentId: overrides?.agentId ?? "unknown",
    taskId: overrides?.taskId,
    details: {
      ...details,
      agentVersion: overrides?.agentVersion,
    },
  });
}

function recordModelReplay(
  overrides: import("./generation").ModelCallOverrides | undefined,
  payload: {
    model: string;
    systemPrompt: string;
    userMessage: string;
    temperature?: number;
    maxTokens?: number;
    seed?: number;
    output?: string;
    error?: string;
    startedAt: number;
    completedAt: number;
  }
): void {
  if (!overrides?.taskId || !overrides?.agentId) return;

  replayStore.recordEvent({
    taskId: overrides.taskId,
    agentId: overrides.agentId,
    kind: "model",
    name: payload.model,
    input: {
      systemPrompt: payload.systemPrompt,
      userMessage: payload.userMessage,
      temperature: payload.temperature,
      maxTokens: payload.maxTokens,
      seed: payload.seed,
    },
    output: payload.output ?? null,
    error: payload.error,
    startedAt: payload.startedAt,
    completedAt: payload.completedAt,
    metadata: { agentVersion: overrides.agentVersion },
  });
}

function isAbortLikeError(err: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return true;
  const anyErr = err as any;
  const name = typeof anyErr?.name === 'string' ? anyErr.name : '';
  const message = typeof anyErr?.message === 'string' ? anyErr.message : String(err);
  return name === 'AbortError' || /aborted|aborterror/i.test(message);
}

function shouldFailoverOnError(err: unknown, signal?: AbortSignal): boolean {
  if (isAbortLikeError(err, signal)) return false;

  const message = err instanceof Error ? err.message : String(err);

  // Do not failover on user/request/config errors.
  // Keep this conservative to avoid hiding real issues.
  const nonRetryable = /\b(400|401)\b|bad request|unauthorized|invalid api key|invalid_request/i.test(message);
  if (nonRetryable) return false;

  return true;
}

type ChatCompletionCreateParamsNonStreaming = import('openai/resources/chat/completions').ChatCompletionCreateParamsNonStreaming;

/**
 * GPT4All Adapter
 */
export class GPT4AllAdapter extends ModelAdapter {
  private config: ModelConfig;

  constructor(config: ModelConfig) {
    super();
    this.config = {
      temperature: 0.7,
      maxTokens: 2000,
      ...config,
    };
  }

  async call(
    systemPrompt: string,
    userMessage: string,
    overrides?: import('./generation').ModelCallOverrides
  ): Promise<ModelResponse> {
    const startTime = Date.now();
    const usedTemperature = overrides?.temperature ?? this.config.temperature;
    const usedMaxTokens = overrides?.maxTokens ?? this.config.maxTokens;
    try {
      const { OpenAI } = await import("openai");
      const client = new OpenAI({
        baseURL: this.config.baseURL,
        apiKey: this.config.apiKey,
      });

      const payload: ChatCompletionCreateParamsNonStreaming = {
        model: this.config.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        temperature: usedTemperature,
        max_tokens: usedMaxTokens,
      };

      const response = overrides?.signal
        ? await client.chat.completions.create(payload, { signal: overrides.signal } as any)
        : await client.chat.completions.create(payload);

      const executionTimeMs = Date.now() - startTime;
      const content = response.choices[0]?.message?.content || "No response generated";

      recordModelAudit(overrides, {
        model: this.config.model,
        executionTimeMs,
        temperature: usedTemperature,
        maxTokens: usedMaxTokens,
        seed: overrides?.seed,
        promptLength: systemPrompt.length,
        userMessageLength: userMessage.length,
        success: true,
      });

      recordModelReplay(overrides, {
        model: this.config.model,
        systemPrompt,
        userMessage,
        temperature: usedTemperature,
        maxTokens: usedMaxTokens,
        seed: overrides?.seed,
        output: content,
        startedAt: startTime,
        completedAt: Date.now(),
      });

      return {
        content,
        model: this.config.model,
        executionTimeMs,
      };
    } catch (error) {
      const executionTimeMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      recordModelAudit(overrides, {
        model: this.config.model,
        executionTimeMs,
        temperature: usedTemperature,
        maxTokens: usedMaxTokens,
        seed: overrides?.seed,
        promptLength: systemPrompt.length,
        userMessageLength: userMessage.length,
        success: false,
        error: errorMessage,
      });

      recordModelReplay(overrides, {
        model: this.config.model,
        systemPrompt,
        userMessage,
        temperature: usedTemperature,
        maxTokens: usedMaxTokens,
        seed: overrides?.seed,
        error: errorMessage,
        startedAt: startTime,
        completedAt: Date.now(),
      });

      const message = error instanceof Error ? error.message : String(error);
      // Graceful fallback to OpenAI if local endpoint is unreachable
      const isConnectionError = /fetch|network|connect|ECONN|ENOTFOUND|timeout/i.test(message);

      const allowFallback = ['1', 'true', 'yes', 'on'].includes(
        String(process.env.ALLOW_OPENAI_FALLBACK || '').toLowerCase()
      );
      const openaiKey = process.env.OPENAI_API_KEY;
      const openaiModel = process.env.OPENAI_MODEL || "gpt-4o-mini";
      if (isConnectionError && allowFallback && openaiKey) {
        const fallback = new OpenAIAdapter({
          baseURL: "https://api.openai.com/v1",
          apiKey: openaiKey,
          model: openaiModel,
          temperature: overrides?.temperature ?? this.config.temperature,
          maxTokens: overrides?.maxTokens ?? this.config.maxTokens,
        });
        const result = await fallback.call(systemPrompt, userMessage, overrides);
        // Annotate model to indicate remote fallback
        return {
          ...result,
          model: `${result.model} (fallback)`
        };
      }

      if (isConnectionError && openaiKey && !allowFallback) {
        throw new Error(
          `GPT4All adapter error: ${message}. OpenAI fallback is disabled (set ALLOW_OPENAI_FALLBACK=1 to enable).`
        );
      }
      throw new Error(`GPT4All adapter error: ${message}`);
    }
  }
}

/**
 * OpenAI Adapter
 */
export class OpenAIAdapter extends ModelAdapter {
  private config: ModelConfig;

  constructor(config: ModelConfig) {
    super();
    this.config = {
      temperature: 0.7,
      maxTokens: 2000,
      ...config,
    };
  }

  async call(
    systemPrompt: string,
    userMessage: string,
    overrides?: import('./generation').ModelCallOverrides
  ): Promise<ModelResponse> {
    const startTime = Date.now();
    const usedTemperature = overrides?.temperature ?? this.config.temperature;
    const usedMaxTokens = overrides?.maxTokens ?? this.config.maxTokens;
    try {
      const { OpenAI } = await import("openai");
      const client = new OpenAI({
        apiKey: this.config.apiKey,
      });

      const payload: ChatCompletionCreateParamsNonStreaming = {
        model: this.config.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
        temperature: usedTemperature,
        max_tokens: usedMaxTokens,
        ...(overrides?.seed != null ? { seed: overrides.seed } : {}),
      };

      const response = overrides?.signal
        ? await client.chat.completions.create(payload, { signal: overrides.signal } as any)
        : await client.chat.completions.create(payload);

      const executionTimeMs = Date.now() - startTime;
      const content = response.choices[0]?.message?.content || "No response generated";

      recordModelAudit(overrides, {
        model: this.config.model,
        executionTimeMs,
        temperature: usedTemperature,
        maxTokens: usedMaxTokens,
        seed: overrides?.seed,
        promptLength: systemPrompt.length,
        userMessageLength: userMessage.length,
        success: true,
      });

      recordModelReplay(overrides, {
        model: this.config.model,
        systemPrompt,
        userMessage,
        temperature: usedTemperature,
        maxTokens: usedMaxTokens,
        seed: overrides?.seed,
        output: content,
        startedAt: startTime,
        completedAt: Date.now(),
      });

      return {
        content,
        model: this.config.model,
        executionTimeMs,
      };
    } catch (error) {
      const executionTimeMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);
      recordModelAudit(overrides, {
        model: this.config.model,
        executionTimeMs,
        temperature: usedTemperature,
        maxTokens: usedMaxTokens,
        seed: overrides?.seed,
        promptLength: systemPrompt.length,
        userMessageLength: userMessage.length,
        success: false,
        error: errorMessage,
      });

      recordModelReplay(overrides, {
        model: this.config.model,
        systemPrompt,
        userMessage,
        temperature: usedTemperature,
        maxTokens: usedMaxTokens,
        seed: overrides?.seed,
        error: errorMessage,
        startedAt: startTime,
        completedAt: Date.now(),
      });

      throw new Error(
        `OpenAI adapter error: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}

/**
 * Ollama Adapter
 *
 * Uses Ollama's native HTTP API (default: http://localhost:11434)
 */
export class OllamaAdapter extends ModelAdapter {
  private config: ModelConfig;

  constructor(config: ModelConfig) {
    super();
    this.config = {
      temperature: 0.7,
      maxTokens: 2000,
      ...config,
    };
  }

  async call(
    systemPrompt: string,
    userMessage: string,
    overrides?: import('./generation').ModelCallOverrides
  ): Promise<ModelResponse> {
    const startTime = Date.now();
    const usedTemperature = overrides?.temperature ?? this.config.temperature;
    const usedMaxTokens = overrides?.maxTokens ?? this.config.maxTokens;

    try {
      const base = (this.config.baseURL || '').replace(/\/+$/, '');
      const url = `${base}/api/chat`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        signal: overrides?.signal,
        body: JSON.stringify({
          model: this.config.model,
          stream: false,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
          ],
          options: {
            temperature: usedTemperature,
            num_predict: usedMaxTokens,
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data: any = await response.json();
      const content = data?.message?.content || '';
      const executionTimeMs = Date.now() - startTime;

      recordModelAudit(overrides, {
        model: this.config.model,
        executionTimeMs,
        temperature: usedTemperature,
        maxTokens: usedMaxTokens,
        seed: overrides?.seed,
        promptLength: systemPrompt.length,
        userMessageLength: userMessage.length,
        success: true,
      });

      recordModelReplay(overrides, {
        model: this.config.model,
        systemPrompt,
        userMessage,
        temperature: usedTemperature,
        maxTokens: usedMaxTokens,
        seed: overrides?.seed,
        output: content,
        startedAt: startTime,
        completedAt: Date.now(),
      });

      return {
        content,
        model: this.config.model,
        executionTimeMs,
      };
    } catch (error) {
      if (isAbortLikeError(error, overrides?.signal)) {
        throw error;
      }
      const executionTimeMs = Date.now() - startTime;
      const errorMessage = error instanceof Error ? error.message : String(error);

      recordModelAudit(overrides, {
        model: this.config.model,
        executionTimeMs,
        temperature: usedTemperature,
        maxTokens: usedMaxTokens,
        seed: overrides?.seed,
        promptLength: systemPrompt.length,
        userMessageLength: userMessage.length,
        success: false,
        error: errorMessage,
      });

      recordModelReplay(overrides, {
        model: this.config.model,
        systemPrompt,
        userMessage,
        temperature: usedTemperature,
        maxTokens: usedMaxTokens,
        seed: overrides?.seed,
        error: errorMessage,
        startedAt: startTime,
        completedAt: Date.now(),
      });

      throw new Error(`Ollama adapter error: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

/**
 * Model Router Adapter
 *
 * Runs a configured provider chain (e.g. local -> cloud -> local)
 * until one succeeds or we hit a non-retryable error.
 */
export class ModelRouterAdapter extends ModelAdapter {
  private chain: Array<{ id: string; adapter: ModelAdapter }>;

  constructor(chain: Array<{ id: string; adapter: ModelAdapter }>) {
    super();
    this.chain = chain;
  }

  async call(
    systemPrompt: string,
    userMessage: string,
    overrides?: import('./generation').ModelCallOverrides
  ): Promise<ModelResponse> {
    if (!this.chain.length) {
      throw new Error('ModelRouter adapter error: empty provider chain');
    }

    let lastError: unknown = null;

    for (let i = 0; i < this.chain.length; i++) {
      const { id, adapter } = this.chain[i];

      if (overrides?.signal?.aborted) {
        const abortErr: any = new Error('Aborted');
        abortErr.name = 'AbortError';
        throw abortErr;
      }

      try {
        return await adapter.call(systemPrompt, userMessage, overrides);
      } catch (err) {
        lastError = err;
        if (!shouldFailoverOnError(err, overrides?.signal)) {
          throw err;
        }

        const isLast = i === this.chain.length - 1;
        if (isLast) {
          const message = err instanceof Error ? err.message : String(err);
          throw new Error(`ModelRouter adapter error: all providers failed (last: ${id}): ${message}`);
        }
        continue;
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError || 'Unknown error'));
  }
}

/**
 * Model Adapter Factory
 */
export class ModelAdapterFactory {
  static create(type: 'gpt4all' | 'openai' | 'ollama', config: ModelConfig): ModelAdapter {
    switch (type) {
      case 'gpt4all':
        return new GPT4AllAdapter(config);
      case 'openai':
        return new OpenAIAdapter(config);
      case 'ollama':
        return new OllamaAdapter(config);
      default:
        throw new Error(`Unknown model type: ${type}`);
    }
  }

  static createFromEnv(): ModelAdapter {
    const chainRaw = String(process.env.MODEL_CHAIN || '').trim();
    const providerRaw = String(process.env.MODEL_PROVIDER || '').trim();

    const temperatureEnv = process.env.MODEL_TEMPERATURE;
    const maxTokensEnv = process.env.MODEL_MAX_TOKENS;
    const temperature = temperatureEnv != null && temperatureEnv !== '' ? Number(temperatureEnv) : undefined;
    const maxTokens = maxTokensEnv != null && maxTokensEnv !== '' ? Number(maxTokensEnv) : undefined;

    const normalize = (s: string) => s.trim().toLowerCase();
    const parseList = (s: string) => s
      .split(',')
      .map(x => normalize(x))
      .filter(Boolean);

    const chain = chainRaw ? parseList(chainRaw) : [];
    const resolvedChain = chain.length ? chain : [normalize(providerRaw || 'gpt4all')];

    const buildAdapter = (id: string): ModelAdapter => {
      if (id === 'gpt4all' || id === 'local') {
        return ModelAdapterFactory.create('gpt4all', {
          baseURL: process.env.GPT4ALL_BASE_URL || 'http://localhost:4891/v1',
          apiKey: process.env.GPT4ALL_API_KEY || 'not-used',
          model: process.env.GPT4ALL_MODEL || 'gpt4all',
          ...(temperature != null ? { temperature } : {}),
          ...(maxTokens != null ? { maxTokens } : {}),
        });
      }

      if (id === 'ollama') {
        return ModelAdapterFactory.create('ollama', {
          baseURL: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
          apiKey: process.env.OLLAMA_API_KEY || '',
          model: process.env.OLLAMA_MODEL || 'llama3.1',
          ...(temperature != null ? { temperature } : {}),
          ...(maxTokens != null ? { maxTokens } : {}),
        });
      }

      if (id === 'openai' || id === 'cloud') {
        const apiKey = process.env.OPENAI_API_KEY;
        if (!apiKey) {
          throw new Error('OPENAI_API_KEY is required when MODEL_CHAIN/MODEL_PROVIDER includes openai');
        }
        return ModelAdapterFactory.create('openai', {
          baseURL: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
          apiKey,
          model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
          ...(temperature != null ? { temperature } : {}),
          ...(maxTokens != null ? { maxTokens } : {}),
        });
      }

      throw new Error(`Unknown MODEL_PROVIDER entry: ${id}`);
    };

    if (resolvedChain.length === 1) {
      return buildAdapter(resolvedChain[0]);
    }

    const routerChain = resolvedChain.map((id) => ({ id, adapter: buildAdapter(id) }));
    return new ModelRouterAdapter(routerChain);
  }
}
