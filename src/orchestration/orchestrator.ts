/**
 * Orchestrator
 * 
 * Main orchestration engine that:
 * - Manages workflows and task execution
 * - Handles composition patterns (pipeline, branch, etc.)
 * - Tracks metrics and events
 * - Coordinates multiple agents
 */

import { v4 as uuidv4 } from 'uuid';
import {
  OrchestratorConfig,
  OrchestrationMetrics,
  Workflow,
  WorkflowExecution,
  CompositionPattern,
  OrchestrationEvent,
  EventListener,
  Task,
} from './types';
import { contextManager } from './contextManager';
import { taskExecutor } from './taskExecutor';
import { Agent } from '../kernel/types';
import { raceWithAbort, throwIfAborted } from '../cancellation/taskCancellation';

const DEFAULT_CONFIG: OrchestratorConfig = {
  maxConcurrentTasks: 10,
  defaultTimeout: 60000,
  enableContextPropagation: true,
  enableLogging: true,
};

export class Orchestrator {
  private config: OrchestratorConfig;
  private workflows: Map<string, Workflow> = new Map();
  private executions: Map<string, WorkflowExecution> = new Map();
  private patterns: Map<string, CompositionPattern> = new Map();
  private activeTasks = 0;
  private metrics: OrchestrationMetrics = {
    totalTasks: 0,
    completedTasks: 0,
    failedTasks: 0,
    averageDuration: 0,
    activeTaskCount: 0,
    lastUpdated: Date.now(),
  };
  private eventListeners: Set<EventListener> = new Set();
  private agentRegistry: Map<string, Agent> = new Map();

  constructor(config: Partial<OrchestratorConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Register an agent
   */
  registerAgent(agent: Agent): void {
    this.agentRegistry.set(agent.id, agent);
  }

  /**
   * Unregister an agent (used for hot-reload / dynamic agent lifecycles)
   */
  unregisterAgent(agentId: string): boolean {
    return this.agentRegistry.delete(agentId);
  }

  /**
   * Create a workflow
   */
  createWorkflow(
    id: string,
    name: string,
    rootTask: Task,
    variables?: Record<string, any>
  ): Workflow {
    const workflow: Workflow = {
      id,
      name,
      rootTask,
      variables,
    };

    this.workflows.set(id, workflow);
    return workflow;
  }

  /**
   * Get workflow
   */
  getWorkflow(id: string): Workflow | undefined {
    return this.workflows.get(id);
  }

  /**
   * Register composition pattern
   */
  registerPattern(pattern: CompositionPattern): void {
    this.patterns.set(pattern.id, pattern);
  }

  /**
   * Execute workflow
   */
  async executeWorkflow(
    workflowId: string,
    options?: { signal?: AbortSignal; onNodeEvent?: (event: { taskId: string; nodeId: string; status: 'running' | 'succeeded' | 'failed'; output?: any; error?: string }) => void }
  ): Promise<WorkflowExecution> {
    const workflow = this.getWorkflow(workflowId);
    if (!workflow) {
      throw new Error(`Workflow ${workflowId} not found`);
    }

    throwIfAborted(options?.signal);

    // Check concurrent limit
    if (this.activeTasks >= this.config.maxConcurrentTasks) {
      throw new Error(
        `Cannot execute workflow: max concurrent tasks (${this.config.maxConcurrentTasks}) reached`
      );
    }

    this.activeTasks++;

    const executionId = uuidv4();
    const execution: WorkflowExecution = {
      workflowId,
      executionId,
      status: 'running',
      startTime: Date.now(),
      context: contextManager.createContext(executionId, 'orchestrator'),
    };

    this.executions.set(executionId, execution);

    // Set initial variables
    if (workflow.variables) {
      contextManager.setVariables(execution.context.taskId, workflow.variables);
    }

    // Emit start event
    await this.emitEvent({
      type: 'workflow.started',
      timestamp: Date.now(),
      workflowId,
      data: { executionId },
    });

    try {
      // Execute root task
      const result = await raceWithAbort(
        taskExecutor.executeTask(workflow.rootTask, execution.context, this.agentRegistry, {
          signal: options?.signal,
          onNodeEvent: options?.onNodeEvent,
        }),
        options?.signal
      );

      execution.result = result;
      execution.status = result.success ? 'succeeded' : 'failed';
      execution.error = result.error;
      execution.endTime = Date.now();

      // Update metrics
      this.updateMetrics(result);

      // Emit completion event
      await this.emitEvent({
        type: 'workflow.completed',
        timestamp: Date.now(),
        workflowId,
        data: {
          executionId,
          success: result.success,
          duration: result.duration,
        },
      });

      return execution;
    } catch (error) {
      execution.status = 'failed';
      execution.error = error instanceof Error ? error.message : String(error);
      execution.endTime = Date.now();

      this.metrics.failedTasks++;
      this.metrics.totalTasks++;

      return execution;
    } finally {
      this.activeTasks--;
      this.metrics.activeTaskCount = this.activeTasks;
      contextManager.cleanupContext(execution.context.taskId);
    }
  }

  /**
   * Get execution
   */
  getExecution(executionId: string): WorkflowExecution | undefined {
    return this.executions.get(executionId);
  }

  /**
   * Get metrics
   */
  getMetrics(): OrchestrationMetrics {
    return { ...this.metrics };
  }

  /**
   * Subscribe to events
   */
  subscribe(listener: EventListener): void {
    this.eventListeners.add(listener);
  }

  /**
   * Unsubscribe from events
   */
  unsubscribe(listener: EventListener): void {
    this.eventListeners.delete(listener);
  }

  /**
   * Emit event
   */
  private async emitEvent(event: OrchestrationEvent): Promise<void> {
    if (!this.config.enableLogging) return;

    for (const listener of this.eventListeners) {
      try {
        await listener(event);
      } catch (error) {
        // Listener errors shouldn't crash orchestration
        console.error('Event listener error:', error);
      }
    }
  }

  /**
   * Update metrics
   */
  private updateMetrics(result: any): void {
    this.metrics.totalTasks++;

    if (result.success) {
      this.metrics.completedTasks++;
    } else {
      this.metrics.failedTasks++;
    }

    const totalDuration = this.metrics.averageDuration * (this.metrics.completedTasks - 1) +
                         (result.duration || 0);
    this.metrics.averageDuration = totalDuration / this.metrics.completedTasks;
    this.metrics.lastUpdated = Date.now();
  }

  /**
   * Get active executions
   */
  getActiveExecutions(): WorkflowExecution[] {
    return Array.from(this.executions.values()).filter((e) => e.status === 'running');
  }

  /**
   * Get completed executions
   */
  getCompletedExecutions(): WorkflowExecution[] {
    return Array.from(this.executions.values()).filter((e) => e.status !== 'running');
  }

  /**
   * Get success rate
   */
  getSuccessRate(): number {
    if (this.metrics.completedTasks === 0) return 0;
    return this.metrics.completedTasks / this.metrics.totalTasks;
  }

  /**
   * Cancel workflow execution
   */
  async cancelExecution(executionId: string): Promise<void> {
    const execution = this.getExecution(executionId);
    if (!execution) return;

    execution.status = 'cancelled';
    execution.endTime = Date.now();
    this.activeTasks--;
    this.metrics.activeTaskCount = this.activeTasks;
  }

  /**
   * Clear all executions
   */
  clearExecutions(): void {
    this.executions.clear();
    this.activeTasks = 0;
    this.metrics.activeTaskCount = 0;
  }

  /**
   * Get orchestrator summary
   */
  getSummary(): Record<string, any> {
    return {
      totalWorkflows: this.workflows.size,
      totalPatterns: this.patterns.size,
      registeredAgents: this.agentRegistry.size,
      metrics: this.getMetrics(),
      activeExecutions: this.getActiveExecutions().length,
      completedExecutions: this.getCompletedExecutions().length,
      successRate: this.getSuccessRate(),
    };
  }

  /**
   * Reset orchestrator state
   */
  reset(): void {
    this.workflows.clear();
    this.patterns.clear();
    this.executions.clear();
    this.activeTasks = 0;
    this.eventListeners.clear();
    contextManager.clear();
    this.metrics = {
      totalTasks: 0,
      completedTasks: 0,
      failedTasks: 0,
      averageDuration: 0,
      activeTaskCount: 0,
      lastUpdated: Date.now(),
    };
  }
}

export const orchestrator = new Orchestrator();
