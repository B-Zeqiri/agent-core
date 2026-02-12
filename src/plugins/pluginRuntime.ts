import { v4 as uuidv4 } from "uuid";
import type { AgentContext, AgentDefinition, AgentResult, Task } from "@agentos/sdk";
import { Agent } from "../kernel/types";
import { memoryManager } from "../memory/memoryManager";
import { toolManager } from "../tools/toolManager";
import { cleanupTaskAbortController, getOrCreateTaskAbortController, raceWithAbort } from "../cancellation/taskCancellation";

export interface PluginRuntimeServices {
  env?: {
    mode?: "dev" | "prod";
    model?: string;
    systemMode?: string;
  };
  timeoutMs?: number;
}

function slugifyAgentId(input: string): string {
  return String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

function getStablePluginId(definition: AgentDefinition): string {
  const meta: any = definition?.meta ?? {};
  const explicit = typeof meta.id === 'string' ? meta.id.trim() : '';
  if (explicit) return explicit;
  return slugifyAgentId(meta.name || 'plugin-agent') || 'plugin-agent';
}

function createLogger(agentId: string, taskId: string) {
  const prefix = `[plugin:${agentId}][task:${taskId}]`;

  return {
    info(msg: string, data?: Record<string, unknown>) {
      console.log(prefix, msg, data ?? "");
    },
    warn(msg: string, data?: Record<string, unknown>) {
      console.warn(prefix, msg, data ?? "");
    },
    error(msg: string, data?: Record<string, unknown>) {
      console.error(prefix, msg, data ?? "");
    },
  };
}

type HistoryTurn = {
  input?: string;
  output?: string;
  taskId?: string;
  agentId?: string;
  ts?: number;
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
    const user = compact(turn?.input || '', 700);
    const assistant = compact(turn?.output || '', 1000);
    if (!user && !assistant) continue;
    if (user) lines.push(`User: ${user}`);
    if (assistant) lines.push(`Assistant: ${assistant}`);
    lines.push('---');
  }

  return lines.join('\n');
}

function normalizeInputToTask(input: string): Task {
  const createdAt = Date.now();
  const fallback: Task = {
    id: uuidv4(),
    input,
    type: "text",
    priority: "normal",
    createdAt,
  };

  const trimmed = (input || "").trim();
  if (!trimmed) return fallback;

  try {
    const parsed = JSON.parse(trimmed) as any;
    if (parsed && typeof parsed === "object") {
      const taskId = typeof parsed.taskId === "string" && parsed.taskId.trim() ? parsed.taskId : fallback.id;
      const query = typeof parsed.query === "string" ? parsed.query : trimmed;
      const history = Array.isArray(parsed.history) ? (parsed.history as HistoryTurn[]) : undefined;
      const historyBlock = formatHistoryForPrompt(history);
      const mergedInput = historyBlock ? `${historyBlock}\n\nCurrent request:\n${query}` : query;
      return {
        ...fallback,
        id: taskId,
        input: mergedInput,
      };
    }
  } catch {
    // not JSON
  }

  return fallback;
}

function ensureMemorySpace(memorySpaceId: string) {
  if (!memoryManager.hasMemory(memorySpaceId)) {
    memoryManager.createAgentMemory(memorySpaceId);
  }
}

function setupMemoryPermissions(agentId: string, allowedSpaces: string[]) {
  // Ensure own memory always exists
  ensureMemorySpace(agentId);

  for (const space of allowedSpaces) {
    ensureMemorySpace(space);
    memoryManager.shareMemoryRead(agentId, space);
    memoryManager.shareMemoryWrite(agentId, space);
  }
}

function createCtx(params: {
  agentId: string;
  definition: AgentDefinition;
  task: Task;
  abortSignal: AbortSignal;
  services?: PluginRuntimeServices;
}): AgentContext {
  const { agentId, definition, task, abortSignal, services } = params;

  const allowedMemorySpaces = new Set<string>([
    agentId,
    ...(definition.meta.permissions?.memory ?? []),
  ]);

  setupMemoryPermissions(agentId, Array.from(allowedMemorySpaces).filter((s) => s !== agentId));

  const log = createLogger(agentId, task.id);

  return {
    task,
    env: {
      mode: services?.env?.mode ?? (process.env.NODE_ENV === "production" ? "prod" : "dev"),
      model: services?.env?.model ?? "local",
      systemMode: services?.env?.systemMode as any,
    },
    memory: {
      async read(key: string, opts?: { space?: string }) {
        const space = opts?.space ?? agentId;
        if (!allowedMemorySpaces.has(space)) {
          throw new Error(`Memory access denied: ${agentId} cannot read space ${space}`);
        }

        const entries = memoryManager.query(agentId, space);
        const matches = entries.filter((e) => e.metadata?.key === key);
        const last = matches[matches.length - 1];
        return last ? last.content : null;
      },
      async write(key: string, value: unknown, opts?: { space?: string }) {
        const space = opts?.space ?? agentId;
        if (!allowedMemorySpaces.has(space)) {
          throw new Error(`Memory access denied: ${agentId} cannot write space ${space}`);
        }

        const content = typeof value === "string" ? value : JSON.stringify(value);
        memoryManager.writeShort(agentId, space, content, "result", { key });
      },
      async list(opts?: { space?: string }) {
        const space = opts?.space ?? agentId;
        if (!allowedMemorySpaces.has(space)) {
          throw new Error(`Memory access denied: ${agentId} cannot list space ${space}`);
        }

        const entries = memoryManager.query(agentId, space);
        const keys = new Set<string>();
        for (const e of entries) {
          const k = e.metadata?.key;
          if (typeof k === "string") keys.add(k);
        }
        return Array.from(keys.values()).sort();
      },
    },
    tools: {
      async call(toolName: string, args: Record<string, unknown>) {
        if (abortSignal.aborted) {
          throw new Error("Task aborted");
        }

        const toolPromise = toolManager.callTool(agentId, {
          toolName,
          args: args as any,
        }, { taskId: task.id });

        const abortPromise = new Promise<never>((_resolve, reject) => {
          abortSignal.addEventListener(
            "abort",
            () => reject(new Error("Task aborted")),
            { once: true }
          );
        });

        return await Promise.race([toolPromise, abortPromise]);
      },
    },
    log,
    signal: abortSignal,
  };
}

export function pluginDefinitionToKernelAgent(
  definition: AgentDefinition,
  services?: PluginRuntimeServices
): Agent {
  const stableId = getStablePluginId(definition);
  const agentId = `plugin:${stableId}`;

  return {
    id: agentId,
    name: definition.meta.name,
    model: services?.env?.model ?? "local",
    state: "uninitialized",
    permissions: [],
    tags: ["plugin"],
    metadata: {
      ...definition.meta,
      id: (definition.meta as any)?.id ?? stableId,
      kind: "plugin",
    },
    handler: async (input: string, runtimeCtx?: { taskId?: string; signal?: AbortSignal }) => {
      const task = normalizeInputToTask(input);
      const abortController = getOrCreateTaskAbortController(task.id);

      // If caller provided a signal (e.g. orchestrator-level cancellation), link it.
      if (runtimeCtx?.signal && runtimeCtx.signal !== abortController.signal) {
        runtimeCtx.signal.addEventListener(
          'abort',
          () => {
            try {
              (abortController as any).abort?.((runtimeCtx.signal as any).reason);
            } catch {
              abortController.abort();
            }
          },
          { once: true }
        );
      }

      // Tool permissions (kernel-enforced)
      const allowedTools = definition.meta.permissions?.tools ?? [];
      if (allowedTools.length > 0) {
        toolManager.setPermissions(agentId, allowedTools);
      }

      const ctx = createCtx({
        agentId,
        definition,
        task,
        abortSignal: abortController.signal,
        services,
      });

      try {
        const timeoutMs = services?.timeoutMs;
        const runPromise = Promise.resolve(definition.run(task, ctx));

        const timedPromise = timeoutMs
          ? Promise.race([
              runPromise,
              new Promise<AgentResult>((_resolve, reject) => {
                setTimeout(() => {
                  abortController.abort();
                  reject(new Error(`Agent timed out after ${timeoutMs}ms`));
                }, timeoutMs);
              }),
            ])
          : runPromise;

        const result: AgentResult = await raceWithAbort(Promise.resolve(timedPromise), abortController.signal);

        return JSON.stringify({
          ok: true,
          agent: definition.meta.name,
          result,
        });
      } finally {
        cleanupTaskAbortController(task.id);
      }
    },
  };
}
