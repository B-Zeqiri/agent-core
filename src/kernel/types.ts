// Agent state lifecycle
export type AgentState =
  | "idle"
  | "running"
  | "stopped"
  | "error"
  | "uninitialized";

// Task definition
export interface Task {
  id: string;
  agentId: string;
  input: string;
  priority?: "low" | "normal" | "high";
  createdAt: number;
}

// Execution record
export interface Execution {
  id: string;
  taskId: string;
  agentId: string;
  state: "pending" | "running" | "success" | "failed";
  input: string;
  output?: string;
  error?: string;
  startTime: number;
  endTime?: number;
}

// Agent definition
export interface Agent {
  id: string;
  name: string;
  model: "local" | "openai" | string;
  state: AgentState;
  permissions?: string[];
  tags?: string[];
  handler: (task: string, ctx?: { taskId?: string; signal?: AbortSignal }) => Promise<string>;
  // Optional IPC message handler
  onMessage?: (msg: any) => Promise<void> | void;
  metadata?: Record<string, any>;
}

// Lifecycle events
export type KernelEventType =
  | "agent:registered"
  | "agent:started"
  | "agent:stopped"
  | "task:queued"
  | "task:started"
  | "task:completed"
  | "task:failed"
  | "ipc:message"
  | "error:execution";

export interface KernelEvent {
  type: KernelEventType;
  timestamp: number;
  agentId?: string;
  taskId?: string;
  data?: Record<string, any>;
}
