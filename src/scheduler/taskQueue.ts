/**
 * TaskQueue
 *
 * Priority-based task queue.
 * Manages pending, running, and completed tasks.
 */

import { Task, TaskPriority, TaskStatus } from "./task";

export class TaskQueue {
  private queues: Map<TaskPriority, Task[]> = new Map([
    ["critical", []],
    ["high", []],
    ["normal", []],
    ["low", []],
  ]);

  private running = new Map<string, Task>();
  private completed: Task[] = [];
  private failed: Task[] = [];

  constructor(private maxCompletedHistory: number = 1000) {}

  /**
   * Enqueue a task
   */
  enqueue(task: Task): void {
    if (task.status !== "pending") {
      throw new Error("Only pending tasks can be enqueued");
    }

    const queue = this.queues.get(task.priority);
    if (!queue) {
      throw new Error(`Invalid priority: ${task.priority}`);
    }

    queue.push(task);
  }

  /**
   * Dequeue next task (by priority)
   */
  dequeue(): Task | undefined {
    // Check in priority order: critical > high > normal > low
    for (const priority of ["critical", "high", "normal", "low"] as const) {
      const queue = this.queues.get(priority);
      if (queue && queue.length > 0) {
        const task = queue.shift()!;
        task.status = "assigned";
        return task;
      }
    }

    return undefined;
  }

  /**
   * Mark task as running
   */
  markRunning(taskId: string, task: Task): void {
    task.status = "running";
    task.startedAt = Date.now();
    this.running.set(taskId, task);
  }

  /**
   * Mark task as completed
   */
  markCompleted(taskId: string, result: string): Task | undefined {
    const task = this.running.get(taskId);
    if (!task) return undefined;

    task.status = "completed";
    task.completedAt = Date.now();
    task.result = result;

    this.running.delete(taskId);
    this.addToHistory(task, true);

    return task;
  }

  /**
   * Mark task as failed (may retry)
   */
  markFailed(taskId: string, error: string, retry: boolean = false): Task | undefined {
    const task = this.running.get(taskId);
    if (!task) return undefined;

    task.error = error;
    task.completedAt = Date.now();

    if (retry && task.retries < task.maxRetries) {
      // Requeue for retry
      task.status = "retrying";
      task.retries++;
      this.running.delete(taskId);

      const queue = this.queues.get(task.priority);
      if (queue) {
        queue.push(task);
      }

      return task;
    }

    // Final failure
    task.status = "failed";
    this.running.delete(taskId);
    this.addToHistory(task, false);

    return task;
  }

  /**
   * Cancel a task
   */
  cancel(taskId: string): boolean {
    // Check running
    if (this.running.has(taskId)) {
      const task = this.running.get(taskId)!;
      task.status = "cancelled";
      task.completedAt = Date.now();
      this.running.delete(taskId);
      this.addToHistory(task, false);
      return true;
    }

    // Check queues
    for (const queue of this.queues.values()) {
      const idx = queue.findIndex((t) => t.id === taskId);
      if (idx !== -1) {
        const task = queue[idx];
        task.status = "cancelled";
        task.completedAt = Date.now();
        queue.splice(idx, 1);
        this.addToHistory(task, false);
        return true;
      }
    }

    return false;
  }

  /**
   * Get task by ID
   */
  getTask(taskId: string): Task | undefined {
    // Check running
    if (this.running.has(taskId)) {
      return this.running.get(taskId);
    }

    // Check queues
    for (const queue of this.queues.values()) {
      const task = queue.find((t) => t.id === taskId);
      if (task) return task;
    }

    // Check history
    return this.completed.find((t) => t.id === taskId) || 
           this.failed.find((t) => t.id === taskId);
  }

  /**
   * Get all pending tasks
   */
  getPending(): Task[] {
    const pending: Task[] = [];
    for (const queue of this.queues.values()) {
      pending.push(...queue);
    }
    return pending;
  }

  /**
   * Get all running tasks
   */
  getRunning(): Task[] {
    return Array.from(this.running.values());
  }

  /**
   * Get completed tasks
   */
  getCompleted(limit?: number): Task[] {
    if (limit) {
      return this.completed.slice(-limit);
    }
    return [...this.completed];
  }

  /**
   * Get failed tasks
   */
  getFailed(limit?: number): Task[] {
    if (limit) {
      return this.failed.slice(-limit);
    }
    return [...this.failed];
  }

  /**
   * Get queue stats
   */
  getStats(): {
    pending: number;
    running: number;
    completed: number;
    failed: number;
  } {
    let pending = 0;
    for (const queue of this.queues.values()) {
      pending += queue.length;
    }

    return {
      pending,
      running: this.running.size,
      completed: this.completed.length,
      failed: this.failed.length,
    };
  }

  /**
   * Clear all data (for testing)
   */
  clear(): void {
    for (const queue of this.queues.values()) {
      queue.length = 0;
    }
    this.running.clear();
    this.completed = [];
    this.failed = [];
  }

  // ============ PRIVATE ============

  private addToHistory(task: Task, success: boolean): void {
    if (success) {
      this.completed.push(task);
      if (this.completed.length > this.maxCompletedHistory) {
        this.completed.shift();
      }
    } else {
      this.failed.push(task);
      if (this.failed.length > this.maxCompletedHistory) {
        this.failed.shift();
      }
    }
  }
}
