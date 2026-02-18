import { Queue, Worker, JobsOptions } from "bullmq";
import { QueuedTaskPayload, QueueStats, TaskQueueDriver } from "./types";

export type QueueProcessor = (payload: QueuedTaskPayload) => Promise<void>;

type QueueAdapter = {
  enqueue: (payload: QueuedTaskPayload) => Promise<string>;
  startWorker: (processor: QueueProcessor) => void;
  getStats: () => Promise<QueueStats>;
};

function parseBool(raw: string | undefined, fallback: boolean): boolean {
  if (raw == null || raw.trim() === "") return fallback;
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

function parseNumber(raw: string | undefined, fallback: number): number {
  if (raw == null || raw.trim() === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.floor(value) : fallback;
}

class LocalQueueAdapter implements QueueAdapter {
  private processor: QueueProcessor | null = null;
  private pending: QueuedTaskPayload[] = [];
  private running = false;
  private queueName = process.env.QUEUE_NAME || "local";

  async enqueue(payload: QueuedTaskPayload): Promise<string> {
    this.pending.push(payload);
    this.processNext();
    return payload.taskId;
  }

  startWorker(processor: QueueProcessor): void {
    this.processor = processor;
    this.processNext();
  }

  async getStats(): Promise<QueueStats> {
    return {
      driver: "local",
      queueName: this.queueName,
      waiting: this.pending.length,
      active: this.running ? 1 : 0,
      delayed: 0,
      failed: 0,
      completed: 0,
      paused: 0,
      prioritized: 0,
      deadLetter: 0,
      timestamp: Date.now(),
    };
  }

  private async processNext(): Promise<void> {
    if (!this.processor || this.running) return;
    const payload = this.pending.shift();
    if (!payload) return;

    this.running = true;
    try {
      await this.processor(payload);
    } finally {
      this.running = false;
      if (this.pending.length > 0) {
        setImmediate(() => this.processNext());
      }
    }
  }
}

class RedisQueueAdapter implements QueueAdapter {
  private queue: Queue<QueuedTaskPayload>;
  private dlq: Queue<QueuedTaskPayload>;
  private worker: Worker<QueuedTaskPayload> | null = null;
  private queueName: string;
  private connectionOptions: Record<string, any>;

  constructor(queueName: string, connectionOptions: Record<string, any>) {
    this.queueName = queueName;
    this.connectionOptions = connectionOptions;
    this.queue = new Queue(queueName, { connection: connectionOptions });
    this.dlq = new Queue(`${queueName}-dlq`, { connection: connectionOptions });
  }

  async enqueue(payload: QueuedTaskPayload): Promise<string> {
    const opts: JobsOptions = {
      jobId: payload.taskId,
      attempts: parseNumber(process.env.QUEUE_MAX_ATTEMPTS, 3),
      backoff: {
        type: "exponential",
        delay: parseNumber(process.env.QUEUE_BACKOFF_MS, 1000),
      },
      priority: payload.priority,
      removeOnComplete: true,
      removeOnFail: false,
    };

    const job = await this.queue.add("execute-task", payload, opts);
    return String(job.id ?? payload.taskId);
  }

  async getStats(): Promise<QueueStats> {
    const counts = await this.queue.getJobCounts(
      "waiting",
      "active",
      "delayed",
      "failed",
      "completed",
      "paused",
      "prioritized"
    );
    const dlqCounts = await this.dlq.getJobCounts(
      "waiting",
      "active",
      "delayed",
      "failed",
      "completed"
    );
    const deadLetter = Object.values(dlqCounts).reduce((sum, value) => sum + (value || 0), 0);

    return {
      driver: "redis",
      queueName: this.queueName,
      waiting: counts.waiting ?? 0,
      active: counts.active ?? 0,
      delayed: counts.delayed ?? 0,
      failed: counts.failed ?? 0,
      completed: counts.completed ?? 0,
      paused: counts.paused ?? 0,
      prioritized: counts.prioritized ?? 0,
      deadLetter,
      timestamp: Date.now(),
    };
  }

  startWorker(processor: QueueProcessor): void {
    if (this.worker) return;
    this.worker = new Worker(
      this.queue.name,
      async (job) => {
        await processor(job.data);
      },
      {
        connection: this.connectionOptions,
        concurrency: parseNumber(process.env.QUEUE_WORKER_CONCURRENCY, 2),
      }
    );

    this.worker.on("failed", (job, err) => {
      const id = job?.id ?? "unknown";
      console.error(`[queue] Job ${id} failed: ${err instanceof Error ? err.message : String(err)}`);
      if (job) {
        void this.maybeMoveToDlq(job, err);
      }
    });
  }

  private async maybeMoveToDlq(job: any, err: unknown): Promise<void> {
    const maxAttempts = job?.opts?.attempts ?? 1;
    const attemptsMade = job?.attemptsMade ?? 0;
    if (attemptsMade < maxAttempts) return;

    const payload: QueuedTaskPayload = {
      ...job.data,
      meta: {
        ...(job.data?.meta || {}),
        originJobId: String(job.id ?? "unknown"),
        failedReason: err instanceof Error ? err.message : String(err),
        attemptsMade,
        queue: this.queueName,
        movedAt: Date.now(),
      },
    };

    await this.dlq.add("dead-letter", payload, {
      jobId: `${job.id ?? payload.taskId}-dlq`,
      removeOnComplete: true,
      removeOnFail: true,
    });

    try {
      await job.remove();
    } catch {
      // ignore removal failures
    }
  }
}

let adapter: QueueAdapter | null = null;

function buildRedisConnectionOptions(): Record<string, any> {
  const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";
  const url = new URL(redisUrl);
  const options: Record<string, any> = {
    host: url.hostname,
    port: url.port ? Number(url.port) : 6379,
    maxRetriesPerRequest: parseNumber(process.env.REDIS_MAX_RETRIES, 3),
    enableReadyCheck: parseBool(process.env.REDIS_READY_CHECK, true),
  };

  if (url.username) {
    options.username = decodeURIComponent(url.username);
  }
  if (url.password) {
    options.password = decodeURIComponent(url.password);
  }
  if (url.pathname && url.pathname !== "/") {
    const db = Number(url.pathname.replace("/", ""));
    if (Number.isFinite(db)) {
      options.db = db;
    }
  }

  return options;
}

export function getTaskQueue(): QueueAdapter {
  if (adapter) return adapter;

  const driver = (process.env.QUEUE_DRIVER || "local") as TaskQueueDriver;
  if (driver === "redis") {
    const queueName = process.env.QUEUE_NAME || "agent-core-tasks";
    adapter = new RedisQueueAdapter(queueName, buildRedisConnectionOptions());
  } else {
    adapter = new LocalQueueAdapter();
  }

  return adapter;
}
