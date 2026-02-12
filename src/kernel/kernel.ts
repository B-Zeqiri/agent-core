import { Agent, Task, Execution, KernelEvent, KernelEventType } from "./types";
import { AgentRegistry } from "./registry";
import { IPCManager } from "../ipc/ipcManager";

/**
 * Kernel
 *
 * Core OS for managing AI agents.
 * Responsibilities:
 * - Agent lifecycle (register, run, stop)
 * - Task execution and tracking
 * - Event emission
 * - State management
 *
 * Architecture:
 * - Agents are processes
 * - Tasks are work items
 * - Executions are task runs
 * - Events are the audit trail
 */
export class Kernel {
  private registry: AgentRegistry;
  private executions = new Map<string, Execution>();
  private eventListeners: Array<(event: KernelEvent) => void> = [];
  private ipc: IPCManager;
  private agentSubscriptions: Map<string, () => void> = new Map();

  constructor(registry?: AgentRegistry) {
    this.registry = registry || new AgentRegistry();
    // Initialize IPC manager with the registry
    this.ipc = new IPCManager(this.registry);
  }

  // ============ AGENT LIFECYCLE ============

  /**
   * Register an agent (like loading a process)
   */
  registerAgent(agent: Agent): void {
    this.registry.register(agent);
    this.emit("agent:registered", { agentId: agent.id });
  }

  /**
   * Start an agent
   */
  startAgent(agentId: string): void {
    const agent = this.registry.get(agentId);
    if (!agent) throw new Error(`Agent ${agentId} not found`);

    agent.state = "idle";
    this.emit("agent:started", { agentId });
    // subscribe agent to IPC channel
    const unsub = this.ipc.subscribeAgent(agentId, async (msg) => {
      // emit kernel-level ipc event
      this.emit("ipc:message", { agentId, message: msg });
      try {
        if (agent.onMessage) {
          await agent.onMessage(msg);
        }
      } catch (err) {
        console.error("Agent onMessage handler error:", err);
      }
    });

    this.agentSubscriptions.set(agentId, unsub);
  }

  /**
   * Stop an agent
   */
  stopAgent(agentId: string): void {
    const agent = this.registry.get(agentId);
    if (!agent) return;

    agent.state = "stopped";
    this.emit("agent:stopped", { agentId });
    // unsubscribe from IPC
    const unsub = this.agentSubscriptions.get(agentId);
    if (unsub) {
      unsub();
      this.agentSubscriptions.delete(agentId);
    }
  }

  /**
   * Unregister an agent
   */
  unregisterAgent(agentId: string): boolean {
    // ensure unsubscribe
    const unsub = this.agentSubscriptions.get(agentId);
    if (unsub) {
      unsub();
      this.agentSubscriptions.delete(agentId);
    }
    return this.registry.unregister(agentId);
  }

  /**
   * Expose IPC manager for integration tests and advanced usage
   */
  getIPCManager(): IPCManager {
    return this.ipc;
  }

  // ============ AGENT QUERIES ============

  /**
   * Get agent by ID
   */
  getAgent(agentId: string): Agent | undefined {
    return this.registry.get(agentId);
  }

  /**
   * List all agents with metadata
   */
  listAgents(): Array<{
    id: string;
    name: string;
    state: string;
    model: string;
    permissions?: string[];
    tags?: string[];
    metadata?: Record<string, any>;
  }> {
    return this.registry.getAll().map((agent) => ({
      id: agent.id,
      name: agent.name,
      state: agent.state,
      model: agent.model,
      permissions: agent.permissions,
      tags: agent.tags,
      metadata: agent.metadata,
    }));
  }

  /**
   * Get agents by tag
   */
  getAgentsByTag(tag: string): Agent[] {
    return this.registry.getByTag(tag);
  }

  /**
   * Get all available tags
   */
  getTags(): string[] {
    return this.registry.getTags();
  }

  // ============ TASK EXECUTION ============

  /**
   * Run an agent task
   * Returns execution ID for tracking
   */
  async runAgent(agentId: string, input: string): Promise<{
    executionId: string;
    output: string;
  }> {
    const agent = this.registry.get(agentId);
    if (!agent) throw new Error(`Agent ${agentId} not found`);

    const taskId = this.generateId("task");
    const executionId = this.generateId("exec");

    // Create execution record
    const execution: Execution = {
      id: executionId,
      taskId,
      agentId,
      state: "pending",
      input,
      startTime: Date.now(),
    };

    this.executions.set(executionId, execution);
    this.emit("task:queued", { agentId, taskId });

    // Start execution
    execution.state = "running";
    agent.state = "running";
    this.emit("task:started", { agentId, taskId, executionId });

    try {
      const output = await agent.handler(input);

      execution.state = "success";
      execution.output = output;
      execution.endTime = Date.now();
      agent.state = "idle";

      this.emit("task:completed", {
        agentId,
        taskId,
        executionId,
        duration: execution.endTime - execution.startTime,
      });

      return { executionId, output };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);

      execution.state = "failed";
      execution.error = errorMsg;
      execution.endTime = Date.now();
      agent.state = "error";

      this.emit("task:failed", {
        agentId,
        taskId,
        executionId,
        error: errorMsg,
      });

      throw new Error(`Agent execution failed: ${errorMsg}`);
    }
  }

  /**
   * Get execution record
   */
  getExecution(executionId: string): Execution | undefined {
    return this.executions.get(executionId);
  }

  /**
   * Get all executions for an agent
   */
  getAgentExecutions(agentId: string): Execution[] {
    return Array.from(this.executions.values()).filter(
      (e) => e.agentId === agentId
    );
  }

  /**
   * Get execution history
   */
  getExecutionHistory(limit: number = 100): Execution[] {
    return Array.from(this.executions.values())
      .sort((a, b) => b.startTime - a.startTime)
      .slice(0, limit);
  }

  // ============ EVENTS ============

  /**
   * Subscribe to kernel events
   */
  on(callback: (event: KernelEvent) => void): () => void {
    this.eventListeners.push(callback);
    // Return unsubscribe function
    return () => {
      this.eventListeners = this.eventListeners.filter((cb) => cb !== callback);
    };
  }

  /**
   * Internal: emit event
   */
  private emit(type: KernelEventType, data?: Record<string, any>): void {
    const event: KernelEvent = {
      type,
      timestamp: Date.now(),
      ...data,
    };

    this.eventListeners.forEach((listener) => {
      try {
        listener(event);
      } catch (err) {
        console.error("Error in event listener:", err);
      }
    });
  }

  // ============ UTILITIES ============

  /**
   * Get kernel stats
   */
  getStats(): {
    agentCount: number;
    runningAgents: number;
    executionCount: number;
    failedExecutions: number;
    completedCount: number;
    failedCount: number;
    taskCount: number;
    executionTimes: number[];
  } {
    const agents = this.registry.getAll();
    const running = agents.filter((a) => a.state === "running").length;

    const executions = Array.from(this.executions.values());
    const failed = executions.filter((e) => e.state === "failed").length;
    const completed = executions.filter((e) => e.state === "success").length;
    const executionTimes = executions.filter((e) => e.endTime && e.startTime).map((e) => e.endTime! - e.startTime!);

    return {
      agentCount: agents.length,
      runningAgents: running,
      executionCount: executions.length,
      failedExecutions: failed,
      completedCount: completed,
      failedCount: failed,
      taskCount: running,
      executionTimes,
    };
  }

  /**
   * Get registry (for monitoring)
   */
  getRegistry(): AgentRegistry {
    return this.registry;
  }

  /**
   * Clear execution history (for testing)
   */
  clearExecutions(): void {
    this.executions.clear();
  }

  /**
   * Generate unique ID
   */
  private generateId(prefix: string): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }
}

// Export singleton kernel instance
export const kernel = new Kernel();
