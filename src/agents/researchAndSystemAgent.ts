/**
 * Research Agent
 * 
 * Specialized agent for research and information gathering tasks
 */

import { Agent } from '../kernel/types';
import { ModelAdapter } from '../models/modelAdapter';
import { GenerationConfig, ModelCallOverrides } from '../models/generation';

type HistoryTurn = {
  input?: string;
  output?: string;
  taskId?: string;
  agentId?: string;
  ts?: number;
};

type InputContext = {
  [key: string]: any;
};

function formatHistoryForPrompt(history: HistoryTurn[] | undefined): string {
  if (!history || history.length === 0) return '';

  const stripFencedCodeBlocks = (text: string) =>
    text.replace(/```[\s\S]*?```/g, '[code omitted]');

  const compact = (text: string, maxLen: number) => {
    const cleaned = stripFencedCodeBlocks(text)
      .replace(/\r\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    if (cleaned.length <= maxLen) return cleaned;
    return `${cleaned.slice(0, Math.max(0, maxLen - 1)).trimEnd()}…`;
  };

  const lines: string[] = [];
  lines.push('Conversation context (previous turns):');

  for (const turn of history) {
    const user = compact(turn?.input || '', 800);
    const assistant = compact(turn?.output || '', 1200);
    if (!user && !assistant) continue;

    if (user) lines.push(`User: ${user}`);
    if (assistant) lines.push(`Assistant: ${assistant}`);
    lines.push('---');
  }

  return lines.join('\n');
}

function parseAgentInput(raw: string): {
  query: string;
  overrides?: ModelCallOverrides;
  history?: HistoryTurn[];
  objective?: string;
  context?: InputContext;
} {
  const trimmed = (raw || '').trim();
  if (!trimmed) return { query: '' };

  try {
    const parsed = JSON.parse(trimmed) as any;
    if (parsed && typeof parsed === 'object') {
      const query = typeof parsed.query === 'string' ? parsed.query : trimmed;
      const generation = (parsed.generation ?? parsed.generationConfig) as GenerationConfig | undefined;
      const history = Array.isArray(parsed.history) ? (parsed.history as HistoryTurn[]) : undefined;
      const objective = typeof parsed.objective === 'string' ? parsed.objective : undefined;
      const context = parsed.context && typeof parsed.context === 'object' ? (parsed.context as InputContext) : undefined;

      const overrides: ModelCallOverrides | undefined = generation
        ? {
            temperature: typeof generation.temperature === 'number' ? generation.temperature : undefined,
            maxTokens: typeof generation.maxTokens === 'number' ? generation.maxTokens : undefined,
            seed: typeof generation.seed === 'number' ? generation.seed : undefined,
          }
        : undefined;

      return { query, overrides, history, objective, context };
    }
  } catch {
    // not JSON
  }

  return { query: trimmed };
}

export class ResearchAgent {
  private agentId = 'research-agent';
  private agent: Agent;

  constructor(modelAdapter: ModelAdapter) {
    const systemPrompt = `You are an expert research assistant. Your task is to:
1. Gather comprehensive information on the given topic
2. Analyze multiple perspectives
3. Identify key points and trends
4. Provide citations and sources where possible
5. Organize findings in a clear, hierarchical manner

Always prioritize accuracy and objectivity. Present conflicting viewpoints fairly.`;

    this.agent = {
      id: this.agentId,
      name: 'Research Agent',
      model: 'local',
      state: 'uninitialized',
      permissions: ['read'],
      tags: ['research', 'analysis', 'information-gathering'],
      handler: async (input: string, ctx?: { taskId?: string; signal?: AbortSignal }) => {
        try {
          const parsed = parseAgentInput(input);
          const historyBlock = formatHistoryForPrompt(parsed.history);
          const contextBlock = parsed.context
            ? `Context:\n${JSON.stringify(parsed.context, null, 2)}`
            : '';
          const objectiveBlock = parsed.objective ? `Objective: ${parsed.objective}` : '';
          const extraBlocks = [objectiveBlock, contextBlock].filter(Boolean).join('\n');

          const userMessage = historyBlock || extraBlocks
            ? `${[historyBlock, extraBlocks, `Current request:\n${parsed.query}`].filter(Boolean).join('\n\n')}`
            : parsed.query;

          const result = await modelAdapter.call(systemPrompt, userMessage, {
            ...parsed.overrides,
            signal: ctx?.signal,
          });
          return JSON.stringify({
            ok: true,
            agent: this.agentId,
            result: {
              type: 'text',
              content: result.content,
              meta: {
                model: result.model,
                executionTimeMs: result.executionTimeMs,
              },
            },
          });
        } catch (error) {
          return JSON.stringify({
            ok: false,
            agent: this.agentId,
            result: {
              type: 'error',
              reason: error instanceof Error ? error.message : String(error),
            },
          });
        }
      },
      metadata: {
        capabilities: [
          'web-research',
          'content-analysis',
          'trend-identification',
          'report-generation',
        ],
        version: '1.0.0',
      },
    };
  }

  getAgent(): Agent {
    return this.agent;
  }

  getAgentId(): string {
    return this.agentId;
  }
}

/**
 * System Agent
 * 
 * Specialized agent for system administration and management tasks
 */
export class SystemAgent {
  private agentId = 'system-agent';
  private agent: Agent;

  constructor(modelAdapter: ModelAdapter) {
    const systemPrompt = `You are an expert system administrator and DevOps specialist. Your task is to:
1. Analyze system issues and provide solutions
2. Recommend best practices for configuration
3. Explain complex system concepts clearly
4. Provide step-by-step troubleshooting guides
5. Suggest optimization strategies

Focus on practical, actionable advice. Consider security and performance implications.`;

    this.agent = {
      id: this.agentId,
      name: 'System Agent',
      model: 'local',
      state: 'uninitialized',
      permissions: ['read'],
      tags: ['system', 'devops', 'administration'],
      handler: async (input: string, ctx?: { taskId?: string; signal?: AbortSignal }) => {
        try {
          const parsed = parseAgentInput(input);
          const historyBlock = formatHistoryForPrompt(parsed.history);
          const contextBlock = parsed.context
            ? `Context:\n${JSON.stringify(parsed.context, null, 2)}`
            : '';
          const objectiveBlock = parsed.objective ? `Objective: ${parsed.objective}` : '';
          const extraBlocks = [objectiveBlock, contextBlock].filter(Boolean).join('\n');

          const userMessage = historyBlock || extraBlocks
            ? `${[historyBlock, extraBlocks, `Current request:\n${parsed.query}`].filter(Boolean).join('\n\n')}`
            : parsed.query;

          const result = await modelAdapter.call(systemPrompt, userMessage, {
            ...parsed.overrides,
            signal: ctx?.signal,
          });
          return JSON.stringify({
            ok: true,
            agent: this.agentId,
            result: {
              type: 'text',
              content: result.content,
              meta: {
                model: result.model,
                executionTimeMs: result.executionTimeMs,
              },
            },
          });
        } catch (error) {
          return JSON.stringify({
            ok: false,
            agent: this.agentId,
            result: {
              type: 'error',
              reason: error instanceof Error ? error.message : String(error),
            },
          });
        }
      },
      metadata: {
        capabilities: [
          'system-administration',
          'troubleshooting',
          'optimization',
          'monitoring',
        ],
        version: '1.0.0',
      },
    };
  }

  getAgent(): Agent {
    return this.agent;
  }

  getAgentId(): string {
    return this.agentId;
  }
}
