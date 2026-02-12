/**
 * Context Manager
 * 
 * Manages execution context for task workflows:
 * - Variable storage and retrieval
 * - Context propagation through agent chains
 * - History tracking
 * - Deadline/timeout management
 */

import { ExecutionContext, ExecutionStep, ContextUpdate } from './types';

export class ContextManager {
  private contexts: Map<string, ExecutionContext> = new Map();
  private updates: Map<string, ContextUpdate[]> = new Map();

  /**
   * Create a new execution context
   */
  createContext(
    taskId: string,
    agentId: string,
    parentTaskId?: string
  ): ExecutionContext {
    const depth = parentTaskId ? this.getContext(parentTaskId)?.depth ?? 0 + 1 : 0;

    const context: ExecutionContext = {
      taskId,
      agentId,
      parentTaskId,
      depth,
      variables: new Map(),
      history: [],
      startTime: Date.now(),
      metadata: {},
    };

    this.contexts.set(taskId, context);
    this.updates.set(taskId, []);

    return context;
  }

  /**
   * Get execution context
   */
  getContext(taskId: string): ExecutionContext | undefined {
    return this.contexts.get(taskId);
  }

  /**
   * Set variable in context
   */
  setVariable(taskId: string, key: string, value: any): void {
    const context = this.getContext(taskId);
    if (!context) {
      throw new Error(`Context not found for task ${taskId}`);
    }

    context.variables.set(key, value);

    this.recordUpdate(taskId, {
      key,
      value,
      timestamp: Date.now(),
      source: context.agentId,
    });
  }

  /**
   * Get variable from context
   */
  getVariable(taskId: string, key: string): any {
    const context = this.getContext(taskId);
    return context?.variables.get(key);
  }

  /**
   * Set multiple variables
   */
  setVariables(taskId: string, variables: Record<string, any>): void {
    Object.entries(variables).forEach(([key, value]) => {
      this.setVariable(taskId, key, value);
    });
  }

  /**
   * Get all variables
   */
  getVariables(taskId: string): Record<string, any> {
    const context = this.getContext(taskId);
    if (!context) return {};

    const result: Record<string, any> = {};
    context.variables.forEach((value, key) => {
      result[key] = value;
    });
    return result;
  }

  /**
   * Inherit variables from parent context
   */
  inheritFromParent(taskId: string): void {
    const context = this.getContext(taskId);
    if (!context || !context.parentTaskId) return;

    const parentContext = this.getContext(context.parentTaskId);
    if (!parentContext) return;

    parentContext.variables.forEach((value, key) => {
      context.variables.set(key, value);
    });
  }

  /**
   * Record execution step
   */
  recordStep(
    taskId: string,
    action: string,
    input: any,
    output: any,
    error?: string
  ): void {
    const context = this.getContext(taskId);
    if (!context) return;

    const lastStep = context.history[context.history.length - 1];
    const stepStartTime = lastStep ? lastStep.timestamp + lastStep.duration : context.startTime;

    const step: ExecutionStep = {
      timestamp: stepStartTime,
      agentId: context.agentId,
      action,
      input,
      output,
      error,
      duration: Date.now() - stepStartTime,
    };

    context.history.push(step);
  }

  /**
   * Get execution history
   */
  getHistory(taskId: string): ExecutionStep[] {
    return this.getContext(taskId)?.history ?? [];
  }

  /**
   * Set deadline for task
   */
  setDeadline(taskId: string, deadlineMs: number): void {
    const context = this.getContext(taskId);
    if (!context) return;

    context.deadline = Date.now() + deadlineMs;
  }

  /**
   * Check if task is within deadline
   */
  isWithinDeadline(taskId: string): boolean {
    const context = this.getContext(taskId);
    if (!context || !context.deadline) return true;

    return Date.now() < context.deadline;
  }

  /**
   * Get remaining time until deadline
   */
  getRemainingTime(taskId: string): number | undefined {
    const context = this.getContext(taskId);
    if (!context || !context.deadline) return undefined;

    return Math.max(0, context.deadline - Date.now());
  }

  /**
   * Record context update
   */
  private recordUpdate(taskId: string, update: ContextUpdate): void {
    const updates = this.updates.get(taskId);
    if (updates) {
      updates.push(update);
    }
  }

  /**
   * Get context updates
   */
  getUpdates(taskId: string): ContextUpdate[] {
    return this.updates.get(taskId) ?? [];
  }

  /**
   * Get execution duration
   */
  getDuration(taskId: string): number {
    const context = this.getContext(taskId);
    if (!context) return 0;

    const endTime = context.history.length > 0
      ? context.history[context.history.length - 1].timestamp +
        context.history[context.history.length - 1].duration
      : Date.now();

    return endTime - context.startTime;
  }

  /**
   * Get context summary
   */
  getSummary(taskId: string): Record<string, any> {
    const context = this.getContext(taskId);
    if (!context) return {};

    const variables: Record<string, any> = {};
    context.variables.forEach((value, key) => {
      variables[key] = value;
    });

    return {
      taskId: context.taskId,
      agentId: context.agentId,
      depth: context.depth,
      variables,
      historyLength: context.history.length,
      duration: this.getDuration(taskId),
      isWithinDeadline: this.isWithinDeadline(taskId),
    };
  }

  /**
   * Clean up context
   */
  cleanupContext(taskId: string): void {
    this.contexts.delete(taskId);
    this.updates.delete(taskId);
  }

  /**
   * Clean up all contexts
   */
  clear(): void {
    this.contexts.clear();
    this.updates.clear();
  }
}

export const contextManager = new ContextManager();
