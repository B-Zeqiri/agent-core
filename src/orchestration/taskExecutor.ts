/**
 * Task Executor
 * 
 * Executes tasks with support for:
 * - Sequential, parallel, conditional, loop, and atomic tasks
 * - Retry logic
 * - Timeout enforcement
 * - Context propagation
 * - Error handling
 */

import { Task, TaskResult, TaskType, ExecutionContext } from './types';
import { contextManager } from './contextManager';
import { Agent } from '../kernel/types';
import { raceWithAbort, throwIfAborted } from '../cancellation/taskCancellation';

type GraphNodeEvent = {
  taskId: string;
  nodeId: string;
  status: 'running' | 'succeeded' | 'failed';
  output?: any;
  error?: string;
};

type TaskExecutionOptions = {
  signal?: AbortSignal;
  onNodeEvent?: (event: GraphNodeEvent) => void;
};

export class TaskExecutor {
  private retryDelays = [100, 200, 500, 1000, 2000];

  /**
   * Execute a task tree
   */
  async executeTask(
    task: Task,
    parentContext: ExecutionContext,
    agentRegistry: Map<string, Agent>,
    options?: TaskExecutionOptions
  ): Promise<TaskResult> {
    throwIfAborted(options?.signal);

    const localAbortController = new AbortController();
    const propagateAbort = () => {
      const reason = (options?.signal as any)?.reason;
      try {
        (localAbortController as any).abort?.(reason ?? new Error('Task aborted'));
      } catch {
        localAbortController.abort();
      }
    };

    if (options?.signal) {
      if (options.signal.aborted) {
        propagateAbort();
      } else {
        options.signal.addEventListener('abort', propagateAbort, { once: true });
      }
    }

    let timeoutId: NodeJS.Timeout | null = null;
    if (typeof task.timeout === 'number' && task.timeout > 0) {
      timeoutId = setTimeout(() => {
        try {
          (localAbortController as any).abort?.(new Error('Task timeout exceeded'));
        } catch {
          localAbortController.abort();
        }
      }, task.timeout);
    }

    const taskOptions: TaskExecutionOptions = {
      ...options,
      signal: localAbortController.signal,
    };

    // Create context for this task
    const context = contextManager.createContext(
      task.id,
      task.agentId || parentContext.agentId,
      parentContext.taskId
    );

    // Copy parent variables
    contextManager.inheritFromParent(context.taskId);

    // Set deadline if specified
    if (task.timeout) {
      contextManager.setDeadline(context.taskId, task.timeout);
    }

    try {
      const startTime = Date.now();
      const result = await this.executeByType(task, context, agentRegistry, taskOptions);
      const duration = Date.now() - startTime;

      // Call success callback
      if (task.onSuccess && result.success) {
        await task.onSuccess(context, result.output);
      }

      return {
        taskId: task.id,
        success: result.success,
        output: result.output,
        error: result.error,
        duration,
        context,
      };
    } catch (error) {
      const duration = Date.now() - context.startTime;
      const errorMsg = error instanceof Error ? error.message : String(error);

      // Call failure callback
      if (task.onFailure) {
        await task.onFailure(context, error instanceof Error ? error : new Error(errorMsg));
      }

      return {
        taskId: task.id,
        success: false,
        error: errorMsg,
        duration,
        context,
      };
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      if (options?.signal) {
        options.signal.removeEventListener('abort', propagateAbort);
      }
      contextManager.cleanupContext(context.taskId);
    }
  }

  /**
   * Execute task by type
   */
  private async executeByType(
    task: Task,
    context: ExecutionContext,
    agentRegistry: Map<string, Agent>,
    options?: TaskExecutionOptions
  ): Promise<{ success: boolean; output?: any; error?: string }> {
    throwIfAborted(options?.signal);

    switch (task.type) {
      case 'atomic':
        return this.executeAtomic(task, context, agentRegistry, options);
      case 'sequential':
        return this.executeSequential(task, context, agentRegistry, options);
      case 'parallel':
        return this.executeParallel(task, context, agentRegistry, options);
      case 'graph':
        return this.executeGraph(task, context, agentRegistry, options);
      case 'conditional':
        return this.executeConditional(task, context, agentRegistry, options);
      case 'loop':
        return this.executeLoop(task, context, agentRegistry, options);
      default:
        return { success: false, error: `Unknown task type: ${task.type}` };
    }
  }

  /**
   * Execute atomic task (calls a tool or agent)
   */
  private async executeAtomic(
    task: Task,
    context: ExecutionContext,
    agentRegistry: Map<string, Agent>,
    options?: TaskExecutionOptions
  ): Promise<{ success: boolean; output?: any; error?: string }> {
    if (!task.agentId) {
      return { success: false, error: 'Atomic task must have agentId' };
    }

    const agent = agentRegistry.get(task.agentId);
    if (!agent) {
      return { success: false, error: `Agent ${task.agentId} not found` };
    }

    // Check deadline
    if (!contextManager.isWithinDeadline(context.taskId)) {
      return { success: false, error: 'Deadline exceeded' };
    }

    throwIfAborted(options?.signal);

    try {
      const input = task.input ? JSON.stringify(task.input) : '';
      const startTime = Date.now();

      // Execute with retry logic
      let lastError: Error | undefined;
      const maxRetries = task.retries ?? 0;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          throwIfAborted(options?.signal);

          const output = await raceWithAbort(
            agent.handler(input, { taskId: context.taskId, signal: options?.signal }),
            options?.signal
          );

          contextManager.recordStep(
            context.taskId,
            'execute',
            input,
            output
          );

          return { success: true, output };
        } catch (error) {
          lastError = error instanceof Error ? error : new Error(String(error));

          if (attempt < maxRetries) {
            const delay = this.retryDelays[Math.min(attempt, this.retryDelays.length - 1)];
            await raceWithAbort(new Promise((resolve) => setTimeout(resolve, delay)), options?.signal);
          }
        }
      }

      return { success: false, error: lastError?.message };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      contextManager.recordStep(context.taskId, 'execute', task.input, undefined, errorMsg);
      return { success: false, error: errorMsg };
    }
  }

  /**
   * Execute sequential tasks
   */
  private async executeSequential(
    task: Task,
    context: ExecutionContext,
    agentRegistry: Map<string, Agent>,
    options?: TaskExecutionOptions
  ): Promise<{ success: boolean; output?: any; error?: string }> {
    if (!task.subtasks || task.subtasks.length === 0) {
      return { success: true, output: undefined };
    }

    const outputs: Record<string, any> = {};
    const failures: Array<{ taskId: string; error: string }> = [];
    let lastOutput: any;

    for (const subtask of task.subtasks) {
      // Check deadline
      if (!contextManager.isWithinDeadline(context.taskId)) {
        return { success: false, error: 'Deadline exceeded' };
      }

      throwIfAborted(options?.signal);

      const result = await this.executeTask(subtask, context, agentRegistry, options);
      if (!result.success) {
        if (subtask.allowFailure) {
          failures.push({ taskId: subtask.id, error: result.error || 'Unknown error' });
          outputs[subtask.id] = { success: false, error: result.error };
          continue;
        }

        return { success: false, error: result.error };
      }

      outputs[subtask.id] = result.output;
      lastOutput = result.output;

      // Pass output to next task
      if (result.output !== undefined) {
        contextManager.setVariable(context.taskId, `${subtask.id}_output`, result.output);
      }
    }

    return {
      success: true,
      output: { lastOutput, outputs, failures },
    };
  }

  /**
   * Execute parallel tasks
   */
  private async executeParallel(
    task: Task,
    context: ExecutionContext,
    agentRegistry: Map<string, Agent>,
    options?: TaskExecutionOptions
  ): Promise<{ success: boolean; output?: any; error?: string }> {
    if (!task.subtasks || task.subtasks.length === 0) {
      return { success: true, output: undefined };
    }

    throwIfAborted(options?.signal);

    const subtasks = task.subtasks;
    const promises = subtasks.map((subtask) =>
      this.executeTask(subtask, context, agentRegistry, options)
    );

    try {
      const results = await Promise.all(promises);

      const outputs: Record<string, any> = {};
      const failures: Array<{ taskId: string; error: string }> = [];

      results.forEach((result, index) => {
        const subtask = subtasks[index];
        if (!result.success) {
          failures.push({ taskId: result.taskId, error: result.error || 'Unknown error' });
          outputs[result.taskId] = { success: false, error: result.error };
        } else {
          outputs[result.taskId] = result.output;
        }
      });

      const hardFailures = results.filter((r, index) => !r.success && !subtasks[index].allowFailure);
      if (hardFailures.length > 0) {
        return { success: false, error: hardFailures[0].error };
      }

      return { success: true, output: { outputs, failures } };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Execute dependency graph tasks
   */
  private async executeGraph(
    task: Task,
    context: ExecutionContext,
    agentRegistry: Map<string, Agent>,
    options?: TaskExecutionOptions
  ): Promise<{ success: boolean; output?: any; error?: string }> {
    if (!task.graph || task.graph.nodes.length === 0) {
      return { success: true, output: undefined };
    }

    const nodeMap = new Map<string, { task: Task; dependsOn: string[]; allowFailure: boolean }>();
    for (const node of task.graph.nodes) {
      if (nodeMap.has(node.id)) {
        return { success: false, error: `Duplicate graph node id: ${node.id}` };
      }
      nodeMap.set(node.id, {
        task: node.task,
        dependsOn: node.dependsOn || [],
        allowFailure: Boolean(node.allowFailure || node.task.allowFailure),
      });
    }

    for (const [nodeId, node] of nodeMap.entries()) {
      for (const dep of node.dependsOn) {
        if (!nodeMap.has(dep)) {
          return { success: false, error: `Graph node ${nodeId} depends on missing node ${dep}` };
        }
      }
    }

    const completed = new Set<string>();
    const outputs: Record<string, any> = {};
    const failures: Array<{ taskId: string; error: string }> = [];

    while (completed.size < nodeMap.size) {
      throwIfAborted(options?.signal);

      const ready = Array.from(nodeMap.entries())
        .filter(([nodeId]) => !completed.has(nodeId))
        .filter(([, node]) => node.dependsOn.every((dep) => completed.has(dep)));

      if (ready.length === 0) {
        return { success: false, error: 'Graph has unresolved dependencies or cycle' };
      }

      const variables = contextManager.getVariables(context.taskId);

      const runPromises = ready.map(async ([nodeId, node]) => {
        options?.onNodeEvent?.({ taskId: context.taskId, nodeId, status: 'running' });
        const nodeTask = {
          ...node.task,
          input: { ...(node.task.input || {}), context: variables },
        } as Task;

        const result = await this.executeTask(nodeTask, context, agentRegistry, options);
        return { nodeId, node, result };
      });

      const results = await Promise.all(runPromises);

      for (const { nodeId, node, result } of results) {
        if (!result.success) {
          options?.onNodeEvent?.({
            taskId: context.taskId,
            nodeId,
            status: 'failed',
            error: result.error,
          });
          failures.push({ taskId: nodeId, error: result.error || 'Unknown error' });
          outputs[nodeId] = { success: false, error: result.error };
          completed.add(nodeId);

          if (!node.allowFailure) {
            return { success: false, error: result.error };
          }
        } else {
          options?.onNodeEvent?.({
            taskId: context.taskId,
            nodeId,
            status: 'succeeded',
            output: result.output,
          });
          outputs[nodeId] = result.output;
          contextManager.setVariable(context.taskId, `${nodeId}_output`, result.output);
          completed.add(nodeId);
        }
      }
    }

    return { success: true, output: { outputs, failures } };
  }

  /**
   * Execute conditional task
   */
  private async executeConditional(
    task: Task,
    context: ExecutionContext,
    agentRegistry: Map<string, Agent>,
    options?: TaskExecutionOptions
  ): Promise<{ success: boolean; output?: any; error?: string }> {
    if (!task.subtasks || task.subtasks.length < 2) {
      return { success: false, error: 'Conditional task requires 2 subtasks (true, false)' };
    }

    const condition = task.condition;
    if (!condition) {
      return { success: false, error: 'Conditional task requires a condition function' };
    }

    const shouldExecuteTrue = condition(context);
    const executedTask = task.subtasks[shouldExecuteTrue ? 0 : 1];

    throwIfAborted(options?.signal);
    const result = await this.executeTask(executedTask, context, agentRegistry, options);

    return {
      success: result.success,
      output: result.output,
      error: result.error,
    };
  }

  /**
   * Execute loop task
   */
  private async executeLoop(
    task: Task,
    context: ExecutionContext,
    agentRegistry: Map<string, Agent>,
    options?: TaskExecutionOptions
  ): Promise<{ success: boolean; output?: any; error?: string }> {
    if (!task.subtasks || task.subtasks.length === 0) {
      return { success: false, error: 'Loop task requires subtasks' };
    }

    if (!task.loopCondition) {
      return { success: false, error: 'Loop task requires loopCondition' };
    }

    const loopTask = task.subtasks[0];
    const outputs: any[] = [];
    let iteration = 0;
    const maxIterations = 1000; // Safety limit

    while (task.loopCondition(context) && iteration < maxIterations) {
      // Check deadline
      if (!contextManager.isWithinDeadline(context.taskId)) {
        return { success: false, error: 'Deadline exceeded' };
      }

      throwIfAborted(options?.signal);

      const result = await this.executeTask(loopTask, context, agentRegistry, options);

      if (!result.success) {
        return { success: false, error: result.error };
      }

      outputs.push(result.output);
      iteration++;
    }

    if (iteration >= maxIterations) {
      return { success: false, error: `Loop exceeded max iterations (${maxIterations})` };
    }

    return { success: true, output: outputs };
  }
}

export const taskExecutor = new TaskExecutor();
