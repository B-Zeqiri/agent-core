/**
 * GPT4All Model Implementation
 *
 * Wrapper for GPT4All local models via API
 * Runs on localhost (e.g., http://localhost:4891/v1)
 */

import {
  BaseModel,
  ModelConfig,
  GenerateOptions,
  GenerateResult,
} from "./model.interface";

export class GPT4AllModel extends BaseModel {
  constructor(config: ModelConfig) {
    super(config);

    if (!config.baseUrl) {
      throw new Error(
        "GPT4All model requires baseUrl (e.g., http://localhost:4891/v1)"
      );
    }
  }

  async generate(options: GenerateOptions): Promise<GenerateResult> {
    const startTime = Date.now();

    try {
      const response = await fetch(
        `${this.config.baseUrl}/chat/completions`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: this.config.modelName,
            messages: options.messages,
            max_tokens: options.maxTokens || this.config.maxTokens || 1024,
            temperature: options.temperature ?? this.config.temperature ?? 0.7,
            top_p: options.topP ?? this.config.topP ?? 1,
          }),
        }
      );

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      const content = data.choices[0]?.message?.content || "";
      const tokensUsed = data.usage?.total_tokens || 0;
      const latency = Date.now() - startTime;

      this.updateStats(tokensUsed, latency, true);

      return {
        content,
        model: this.config.modelName,
        tokensUsed,
        metadata: {
          finishReason: data.choices[0]?.finish_reason,
          promptTokens: data.usage?.prompt_tokens,
          completionTokens: data.usage?.completion_tokens,
        },
      };
    } catch (err) {
      const latency = Date.now() - startTime;
      this.updateStats(0, latency, false);
      throw new Error(`GPT4All generation failed: ${err}`);
    }
  }

  async isHealthy(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(`${this.config.baseUrl}/models`, {
        method: "GET",
        signal: controller.signal,
      });

      clearTimeout(timeout);
      return response.ok;
    } catch (err) {
      return false;
    }
  }

  getCapabilities() {
    const modelName = this.config.modelName.toLowerCase();

    if (modelName.includes("orca")) {
      return {
        maxContextLength: 2048,
        supportsVision: false,
        supportsFunctionCalling: false,
      };
    }

    if (modelName.includes("phi")) {
      return {
        maxContextLength: 2048,
        supportsVision: false,
        supportsFunctionCalling: false,
      };
    }

    // Default for local models
    return {
      maxContextLength: 2048,
      supportsVision: false,
      supportsFunctionCalling: false,
    };
  }
}
