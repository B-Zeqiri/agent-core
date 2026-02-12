/**
 * Behavior Pattern Engine
 * 
 * State machine implementation for agent behaviors:
 * - State transitions with guards and actions
 * - Event handling
 * - History tracking
 * - Error recovery
 */

import { BehaviorPattern, BehaviorInstance, BehaviorStateChange, ExecutionContext, BehaviorState, BehaviorEvent } from './types';

export class BehaviorEngine {
  private instances: Map<string, BehaviorInstance> = new Map();

  /**
   * Create a behavior instance
   */
  createInstance(
    patternName: string,
    pattern: BehaviorPattern,
    context: ExecutionContext
  ): BehaviorInstance {
    const instance: BehaviorInstance = {
      patternName,
      currentState: pattern.initialState,
      context,
      history: [],
    };

    this.instances.set(context.taskId, instance);
    return instance;
  }

  /**
   * Get behavior instance
   */
  getInstance(taskId: string): BehaviorInstance | undefined {
    return this.instances.get(taskId);
  }

  /**
   * Handle event in behavior
   */
  async handleEvent(
    taskId: string,
    pattern: BehaviorPattern,
    event: BehaviorEvent
  ): Promise<boolean> {
    const instance = this.getInstance(taskId);
    if (!instance) return false;

    // Find valid transition
    const transition = pattern.transitions.find(
      (t) =>
        t.from === instance.currentState &&
        t.event === event &&
        (!t.guard || t.guard(instance.context))
    );

    if (!transition) {
      return false;
    }

    // Check condition
    if (transition.condition && !transition.condition(instance.context)) {
      return false;
    }

    const fromState = instance.currentState;
    const toState = transition.to;
    const startTime = Date.now();

    try {
      // Exit current state
      if (pattern.onStateExit) {
        await pattern.onStateExit(fromState, instance.context);
      }

      // Execute transition action
      if (transition.action) {
        await transition.action(instance.context);
      }

      // Enter new state
      if (pattern.onStateEnter) {
        await pattern.onStateEnter(toState, instance.context);
      }

      // Update instance
      instance.currentState = toState;

      // Record history
      instance.history.push({
        fromState,
        toState,
        event,
        timestamp: Date.now(),
        duration: Date.now() - startTime,
      });

      return true;
    } catch (error) {
      if (pattern.onError) {
        await pattern.onError(
          fromState,
          error instanceof Error ? error : new Error(String(error)),
          instance.context
        );
      }
      return false;
    }
  }

  /**
   * Check if state is final
   */
  isFinalState(pattern: BehaviorPattern, state: BehaviorState): boolean {
    return pattern.finalStates.includes(state);
  }

  /**
   * Check if instance reached final state
   */
  isComplete(taskId: string, pattern: BehaviorPattern): boolean {
    const instance = this.getInstance(taskId);
    if (!instance) return false;

    return this.isFinalState(pattern, instance.currentState);
  }

  /**
   * Get available transitions from current state
   */
  getAvailableTransitions(
    taskId: string,
    pattern: BehaviorPattern
  ): BehaviorEvent[] {
    const instance = this.getInstance(taskId);
    if (!instance) return [];

    return pattern.transitions
      .filter(
        (t) =>
          t.from === instance.currentState &&
          (!t.guard || t.guard(instance.context))
      )
      .map((t) => t.event);
  }

  /**
   * Get state history
   */
  getHistory(taskId: string): BehaviorStateChange[] {
    return this.getInstance(taskId)?.history ?? [];
  }

  /**
   * Reset behavior to initial state
   */
  reset(taskId: string, pattern: BehaviorPattern): void {
    const instance = this.getInstance(taskId);
    if (!instance) return;

    instance.currentState = pattern.initialState;
    instance.history = [];
  }

  /**
   * Get current state
   */
  getCurrentState(taskId: string): BehaviorState | undefined {
    return this.getInstance(taskId)?.currentState;
  }

  /**
   * Get state transition count
   */
  getTransitionCount(taskId: string): number {
    return this.getInstance(taskId)?.history.length ?? 0;
  }

  /**
   * Get average state duration
   */
  getAverageStateDuration(taskId: string): number {
    const history = this.getHistory(taskId);
    if (history.length === 0) return 0;

    const totalDuration = history.reduce((sum, change) => sum + change.duration, 0);
    return totalDuration / history.length;
  }

  /**
   * Validate pattern structure
   */
  validatePattern(pattern: BehaviorPattern): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Check initial state exists
    if (!pattern.states.includes(pattern.initialState)) {
      errors.push(`Initial state '${pattern.initialState}' not in states list`);
    }

    // Check final states exist
    pattern.finalStates.forEach((state) => {
      if (!pattern.states.includes(state)) {
        errors.push(`Final state '${state}' not in states list`);
      }
    });

    // Check all transitions reference valid states
    pattern.transitions.forEach((transition) => {
      if (!pattern.states.includes(transition.from)) {
        errors.push(`Transition 'from' state '${transition.from}' not in states list`);
      }
      if (!pattern.states.includes(transition.to)) {
        errors.push(`Transition 'to' state '${transition.to}' not in states list`);
      }
    });

    // Check for unreachable states
    const reachable = new Set<BehaviorState>();
    reachable.add(pattern.initialState);

    let changed = true;
    while (changed) {
      changed = false;
      const newReachable = new Set(reachable);

      pattern.transitions.forEach((t) => {
        if (reachable.has(t.from) && !reachable.has(t.to)) {
          newReachable.add(t.to);
          changed = true;
        }
      });

      reachable.forEach((s) => newReachable.add(s));
      reachable.clear();
      newReachable.forEach((s) => reachable.add(s));
    }

    pattern.states.forEach((state) => {
      if (!reachable.has(state) && state !== pattern.initialState) {
        errors.push(`State '${state}' is unreachable`);
      }
    });

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Get behavior summary
   */
  getSummary(taskId: string): Record<string, any> {
    const instance = this.getInstance(taskId);
    if (!instance) return {};

    return {
      taskId,
      currentState: instance.currentState,
      transitionCount: instance.history.length,
      averageStateDuration: this.getAverageStateDuration(taskId),
      history: instance.history.map((h) => ({
        fromState: h.fromState,
        toState: h.toState,
        event: h.event,
        duration: h.duration,
      })),
    };
  }

  /**
   * Clean up instance
   */
  cleanupInstance(taskId: string): void {
    this.instances.delete(taskId);
  }

  /**
   * Clear all instances
   */
  clear(): void {
    this.instances.clear();
  }
}

export const behaviorEngine = new BehaviorEngine();
