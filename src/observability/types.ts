/**
 * Phase 7: Observability & Control
 * Type definitions for monitoring, logging, tracing, and metrics
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  timestamp: number;
  level: LogLevel;
  source: string; // e.g., "ipc", "kernel", "scheduler"
  message: string;
  data?: Record<string, any>;
  agentId?: string;
}

export interface TraceEntry {
  timestamp: number;
  traceId: string;
  type: "message:sent" | "message:received" | "task:created" | "task:completed" | "task:failed";
  agentId: string;
  data: Record<string, any>;
}

export interface MessageTrace {
  id: string;
  from: string;
  to: string;
  tag?: string;
  type: string;
  payload: any;
  timestamp: number;
  status: "pending" | "delivered" | "failed";
  deliveryTime?: number;
}

export interface SystemMetrics {
  timestamp: number;
  activeAgents: number;
  pendingTasks: number;
  completedTasks: number;
  failedTasks: number;
  messageCount: number;
  averageLatency: number;
  errorRate: number;
}

export interface AgentMetrics {
  agentId: string;
  tasksCompleted: number;
  tasksFailed: number;
  averageExecutionTime: number;
  messagesReceived: number;
  messagesSent: number;
  lastActive: number;
}

export interface MonitoringConfig {
  enableLogging?: boolean;
  enableTracing?: boolean;
  logLevel?: LogLevel;
  maxLogEntries?: number;
  maxTraceEntries?: number;
  traceSampleRate?: number; // 0-1, default 1.0 (100%)
}

export interface HistoryWindow {
  minutes: number;
  logs: LogEntry[];
  traces: TraceEntry[];
  messages: MessageTrace[];
}
