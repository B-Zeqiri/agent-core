export type TaskQueueDriver = "local" | "redis";

export type QueueStats = {
  driver: TaskQueueDriver;
  queueName: string;
  waiting: number;
  active: number;
  delayed: number;
  failed: number;
  completed: number;
  paused: number;
  prioritized: number;
  deadLetter: number;
  timestamp: number;
};

export type QueuedTaskPayload = {
  taskId: string;
  input: string;
  selectedAgentId: string;
  registeredTaskId: string;
  agentType: string;
  multiAgentConfig: Record<string, any>;
  priority?: number;
  meta?: Record<string, unknown>;
};
