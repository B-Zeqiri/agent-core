/**
 * Scheduler
 *
 * Multi-agent task orchestration.
 * Dispatches tasks to agents with retry logic and priority handling.
 */

import { Kernel } from "../kernel/kernel";
import { AgentRegistry } from "../kernel/registry";
import { TaskQueue } from "./taskQueue";
import { Task, TaskPriority, SchedulerConfig, TaskStats } from "./task";

export class Scheduler {
  private kernel: Kernel;
  private registry: AgentRegistry;
  private queue: TaskQueue;
  private config: Required<SchedulerConfig>;
  private running = new Set<string>();
  private taskMetrics = new Map<string, { waitTime: number; executionTime: number }>();

  constructor(kernel: Kernel, registry: AgentRegistry, config?: SchedulerConfig) {
    this.kernel = kernel;
    this.registry = registry;
    this.queue = new TaskQueue();
    this.config = {
      maxConcurrentTasks: config?.maxConcurrentTasks || 10,
      defaultMaxRetries: config?.defaultMaxRetries || 3,
      retryBackoffMs: config?.retryBackoffMs || 1000,
      taskTimeout: config?.taskTimeout || 30000,
    };
  }

  /**
   * Submit a task to the scheduler
   */
  submitTask(
    name: string,
    input: string,
    options?: {
      agentId?: string;
      agentTag?: string;
      priority?: TaskPriority;
      maxRetries?: number;
      metadata?: Record<string, any>;
      description?: string;
    }
  ): Task {
    const task: Task = {
      id: this.generateId(),
      name,
      description: options?.description,
      agentId: options?.agentId,
      agentTag: options?.agentTag,
      input,
      priority: options?.priority || "normal",
      status: "pending",
      retries: 0,
      maxRetries: options?.maxRetries || this.config.defaultMaxRetries,
      createdAt: Date.now(),
      metadata: options?.metadata,
    };

    this.queue.enqueue(task);
    return task;
  }

  /**
   * Process next task from queue
   */
  async processNext(): Promise<Task | null> {
    // Check if we can run more tasks
    if (this.running.size >= this.config.maxConcurrentTasks) {
      return null;
    }

    const task = this.queue.dequeue();
    if (!task) {
      return null;
    }

    this.running.add(task.id);

    try {
      // Select agent
      const agent = this.selectAgent(task);
      if (!agent) {
        throw new Error("No suitable agent found");
      }

      task.agentId = agent.id;
      this.queue.markRunning(task.id, task);

      // Execute task
      const waitTime = Date.now() - task.createdAt;
      const startExec = Date.now();

      try {
        const { output } = await this.kernel.runAgent(agent.id, task.input);
        const executionTime = Date.now() - startExec;

        this.taskMetrics.set(task.id, { waitTime, executionTime });
        this.queue.markCompleted(task.id, output);
        this.running.delete(task.id);

        return task;
      } catch (err) {
        const executionTime = Date.now() - startExec;
        const error = err instanceof Error ? err.message : String(err);

        this.taskMetrics.set(task.id, { waitTime, executionTime });

        // Determine if we should retry
        const shouldRetry = task.retries < task.maxRetries;
        const updated = this.queue.markFailed(task.id, error, shouldRetry);

        this.running.delete(task.id);

        return updated || task;
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      const shouldRetry = task.retries < task.maxRetries;
      const updated = this.queue.markFailed(task.id, error, shouldRetry);

      this.running.delete(task.id);

      return updated || task;
    }
  }

  /**
   * Process all available tasks (up to concurrency limit)
   */
  async processAll(): Promise<Task[]> {
    const results: Task[] = [];

    while (this.running.size < this.config.maxConcurrentTasks) {
      const task = await this.processNext();
      if (!task) {
        break;
      }
      results.push(task);
    }

    return results;
  }

  /**
   * Wait for a specific task to complete
   */
  async waitForTask(taskId: string, timeoutMs?: number): Promise<Task> {
    const timeout = timeoutMs || this.config.taskTimeout;
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const task = this.queue.getTask(taskId);
      if (!task) {
        throw new Error(`Task ${taskId} not found`);
      }

      if (
        task.status === "completed" ||
        task.status === "failed" ||
        task.status === "cancelled"
      ) {
        return task;
      }

      // Wait a bit before checking again
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    throw new Error(`Task ${taskId} timeout after ${timeout}ms`);
  }

  /**
   * Wait for all tasks to complete
   */
  async waitForAll(timeoutMs?: number): Promise<Task[]> {
    const timeout = timeoutMs || this.config.taskTimeout * 10;
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const pending = this.queue.getPending();
      const running = this.queue.getRunning();

      if (pending.length === 0 && running.length === 0) {
        return [
          ...this.queue.getCompleted(),
          ...this.queue.getFailed(),
        ];
      }

      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    throw new Error(`Tasks timeout after ${timeout}ms`);
  }

  /**
   * Cancel a task
   */
  cancelTask(taskId: string): boolean {
    const cancelled = this.queue.cancel(taskId);
    if (cancelled) {
      this.running.delete(taskId);
    }
    return cancelled;
  }

  /**
   * Get task by ID
   */
  getTask(taskId: string): Task | undefined {
    return this.queue.getTask(taskId);
  }

  /**
   * Get scheduler stats
   */
  getStats(): TaskStats {
    const stats = this.queue.getStats();
    const metrics = Array.from(this.taskMetrics.values());

    const avgWaitTime =
      metrics.length > 0
        ? metrics.reduce((sum, m) => sum + m.waitTime, 0) / metrics.length
        : 0;

    const avgExecutionTime =
      metrics.length > 0
        ? metrics.reduce((sum, m) => sum + m.executionTime, 0) / metrics.length
        : 0;

    return {
      totalTasks:
        stats.pending + stats.running + stats.completed + stats.failed,
      completed: stats.completed,
      failed: stats.failed,
      pending: stats.pending,
      running: stats.running,
      avgWaitTime,
      avgExecutionTime,
    };
  }

  /**
   * Get pending tasks
   */
  getPending(): Task[] {
    return this.queue.getPending();
  }

  /**
   * Get running tasks
   */
  getRunning(): Task[] {
    return this.queue.getRunning();
  }

  /**
   * Get completed tasks
   */
  getCompleted(limit?: number): Task[] {
    return this.queue.getCompleted(limit);
  }

  /**
   * Get failed tasks
   */
  getFailed(limit?: number): Task[] {
    return this.queue.getFailed(limit);
  }

  /**
   * Clear all tasks (for testing)
   */
  clear(): void {
    this.queue.clear();
    this.running.clear();
    this.taskMetrics.clear();
  }

  // ============ PRIVATE ============

  private selectAgent(task: Task) {
    // If specific agent is required, use it
    if (task.agentId) {
      return this.registry.get(task.agentId);
    }

    // If tag is specified, find any agent with that tag
    if (task.agentTag) {
      return this.registry.getByTag(task.agentTag)[0];
    }

    // Otherwise, pick any available agent (round-robin or random)
    const agents = this.registry.getAll();
    if (agents.length === 0) {
      return undefined;
    }

    // Simple random selection
    return agents[Math.floor(Math.random() * agents.length)];
  }

  private generateId(): string {
    return `task_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }
}
