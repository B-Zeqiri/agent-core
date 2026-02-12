/**
 * Task Types and Interfaces
 *
 * Core data structures for the scheduler.
 */

export type TaskPriority = "low" | "normal" | "high" | "critical";

export type TaskStatus =
  | "pending"
  | "assigned"
  | "running"
  | "completed"
  | "failed"
  | "retrying"
  | "cancelled";

export interface Task {
  id: string;
  name: string;
  description?: string;
  agentId?: string; // If specified, must use this agent
  agentTag?: string; // If specified, pick any agent with this tag
  input: string;
  priority: TaskPriority;
  status: TaskStatus;
  retries: number;
  maxRetries: number;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  result?: string;
  error?: string;
  metadata?: Record<string, any>;
}

export interface SchedulerConfig {
  maxConcurrentTasks?: number;
  defaultMaxRetries?: number;
  retryBackoffMs?: number; // Exponential backoff base
  taskTimeout?: number;
}

export interface TaskStats {
  totalTasks: number;
  completed: number;
  failed: number;
  pending: number;
  running: number;
  avgWaitTime: number;
  avgExecutionTime: number;
}
