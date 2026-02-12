/**
 * Task Registry
 * 
 * Manages task registration, validation, and lifecycle
 */

export interface TaskRequest {
  input: string;
  agentType?: 'web-dev' | 'research' | 'system';
  priority?: 'low' | 'normal' | 'high';
  timeout?: number;
  metadata?: Record<string, any>;
}

export interface ValidatedTask {
  id: string;
  request: TaskRequest;
  status: 'pending' | 'queued' | 'running' | 'completed' | 'failed';
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  result?: string;
  error?: string;
}

export class TaskRegistry {
  private tasks: Map<string, ValidatedTask> = new Map();
  private validationRules = {
    minInputLength: 1,
    maxInputLength: 10000,
    allowedAgentTypes: ['web-dev', 'research', 'system'],
    defaultTimeout: 60000,
    maxTimeout: 300000,
  };

  /**
   * Validate task request
   */
  validate(request: TaskRequest): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Validate input
    if (!request.input || request.input.trim().length === 0) {
      errors.push('Input cannot be empty');
    }
    if (request.input.length > this.validationRules.maxInputLength) {
      errors.push(
        `Input exceeds maximum length of ${this.validationRules.maxInputLength}`
      );
    }

    // Validate agent type
    if (request.agentType && !this.validationRules.allowedAgentTypes.includes(request.agentType)) {
      errors.push(
        `Invalid agent type. Allowed: ${this.validationRules.allowedAgentTypes.join(', ')}`
      );
    }

    // Validate timeout
    if (request.timeout) {
      if (request.timeout < 1000) {
        errors.push('Timeout must be at least 1000ms');
      }
      if (request.timeout > this.validationRules.maxTimeout) {
        errors.push(`Timeout exceeds maximum of ${this.validationRules.maxTimeout}ms`);
      }
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Register a validated task
   */
  register(id: string, request: TaskRequest): ValidatedTask {
    const task: ValidatedTask = {
      id,
      request: {
        ...request,
        agentType: request.agentType || 'web-dev',
        timeout: request.timeout || this.validationRules.defaultTimeout,
        priority: request.priority || 'normal',
      },
      status: 'pending',
      createdAt: Date.now(),
    };

    this.tasks.set(id, task);
    return task;
  }

  /**
   * Get task by ID
   */
  getTask(id: string): ValidatedTask | undefined {
    return this.tasks.get(id);
  }

  /**
   * Update task status
   */
  updateStatus(
    id: string,
    status: ValidatedTask['status'],
    data?: { result?: string; error?: string }
  ): ValidatedTask | undefined {
    const task = this.tasks.get(id);
    if (!task) return undefined;

    task.status = status;
    if (status === 'running' && !task.startedAt) {
      task.startedAt = Date.now();
    }
    if ((status === 'completed' || status === 'failed') && !task.completedAt) {
      task.completedAt = Date.now();
    }
    if (data?.result) {
      task.result = data.result;
    }
    if (data?.error) {
      task.error = data.error;
    }

    return task;
  }

  /**
   * Get all tasks
   */
  getAllTasks(): ValidatedTask[] {
    return Array.from(this.tasks.values());
  }

  /**
   * Get tasks by status
   */
  getTasksByStatus(status: ValidatedTask['status']): ValidatedTask[] {
    return Array.from(this.tasks.values()).filter((t) => t.status === status);
  }

  /**
   * Clear completed tasks
   */
  clearCompleted(): number {
    let count = 0;
    for (const [id, task] of this.tasks.entries()) {
      if (task.status === 'completed' || task.status === 'failed') {
        this.tasks.delete(id);
        count++;
      }
    }
    return count;
  }
}

export const taskRegistry = new TaskRegistry();
