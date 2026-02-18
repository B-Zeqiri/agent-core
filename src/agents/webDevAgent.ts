/**
 * Web Dev Agent
 * 
 * Specialized agent for web development tasks
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
    const user = compact(turn?.input || '', 600);
    const assistant = compact(turn?.output || '', 900);
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

export class WebDevAgent {
  private agentId = 'web-dev-agent';
  private agent: Agent;

  constructor(modelAdapter: ModelAdapter) {
    const systemPrompt = `You are a senior web developer with expertise in:
- Full-stack development (Frontend & Backend)
- Modern frameworks (React, Vue, Angular, Next.js)
- TypeScript, JavaScript, HTML, CSS
- Node.js and server-side technologies
- Database design and optimization
- API design and RESTful principles
- Testing and debugging

Your job is to:
1. Understand the task clearly
2. Provide practical, working solutions
3. Explain your approach step by step
4. Consider performance, security, and best practices
5. Write clean, maintainable code

Keep responses clear, structured, and actionable.`;

    this.agent = {
      id: this.agentId,
      name: 'Web Dev Agent',
      model: 'local',
      state: 'uninitialized',
      permissions: ['read', 'write'],
      tags: ['web-development', 'coding', 'frontend', 'backend'],
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
            taskId: ctx?.taskId,
            agentId: this.agentId,
            agentVersion: this.agent.metadata?.version as string | undefined,
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
          'code-generation',
          'code-review',
          'debugging',
          'architecture-design',
          'performance-optimization',
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
