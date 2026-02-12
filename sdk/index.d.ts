export type SystemMode = "assist" | "power" | "autonomous";

export type AgentFile = {
  path: string;
  content: string;
};

export type AgentResult =
  | { type: "text"; content: string; meta?: Record<string, unknown> }
  | { type: "code"; files: AgentFile[]; meta?: Record<string, unknown> }
  | { type: "artifact"; id: string; meta?: Record<string, unknown> }
  | { type: "error"; reason: string; meta?: Record<string, unknown> }
  | { type: "html"; content: string; meta?: Record<string, unknown> }
  | { type: "json"; content: unknown; meta?: Record<string, unknown> };

export type TaskPriority = "low" | "normal" | "high";

export interface Task {
  id: string;
  input: string;
  type?: string;
  priority?: TaskPriority;
  createdAt: number;
  deadline?: number;
}

export interface Permissions {
  tools?: string[];
  memory?: string[];
  /** Allow calling other agents by id (exact match). */
  agents?: string[];
  network?: boolean;
  fs?: boolean;
}

export interface AgentMeta {
  /** Stable identifier (preferred). If omitted, runtime may derive from name. */
  id?: string;
  name: string;
  description?: string;
  version: string;
  capabilities: string[];
  permissions?: Permissions;
}

export interface AgentContext {
  task: Task;
  env: {
    mode: "dev" | "prod";
    model: "local" | "cloud" | string;
    systemMode?: SystemMode;
  };
  memory: {
    read: (key: string, opts?: { space?: string }) => Promise<string | null>;
    write: (key: string, value: unknown, opts?: { space?: string }) => Promise<void>;
    list: (opts?: { space?: string }) => Promise<string[]>;
  };
  tools: {
    call: (toolName: string, args: Record<string, unknown>) => Promise<any>;
  };
  log: {
    info: (msg: string, data?: Record<string, unknown>) => void;
    warn: (msg: string, data?: Record<string, unknown>) => void;
    error: (msg: string, data?: Record<string, unknown>) => void;
  };
  signal: AbortSignal;

  /**
   * Controlled agent-to-agent call. Must enforce permissions, depth limits,
   * and cancellation propagation.
   */
  runAgent?: (
    agentId: string,
    input: unknown
  ) => Promise<{
    taskId: string;
    agentId: string;
    result: AgentResult;
    durationMs: number;
  }>;
}

export interface AgentDefinition {
  meta: AgentMeta;
  run: (task: Task, ctx: AgentContext) => Promise<AgentResult> | AgentResult;
}

export type DefineAgentInput =
  | AgentDefinition
  | (Omit<AgentDefinition, "meta"> & {
      id?: string;
      name: string;
      description?: string;
      version: string;
      capabilities: string[];
      permissions?: Permissions;
    });

export function defineAgent(definition: DefineAgentInput): AgentDefinition;
