/**
 * Coordinator Agent
 * 
 * A production agent that:
 * - Coordinates multiple agents via IPC
 * - Orchestrates complex multi-agent workflows
 * - Makes decisions about which agents to use
 * - Aggregates results from multiple agents
 * 
 * Demonstrates: IPC, agent-to-agent communication, complex orchestration
 */

import { Agent } from '../kernel/types';
import { Kernel } from '../kernel/kernel';
import { MessageBus } from '../ipc/messageBus';
import { ToolManager } from '../tools/toolManager';
import { Orchestrator } from '../orchestration/orchestrator';
import { Task } from '../orchestration/types';

export interface CoordinationRequest {
  goal: string;
  availableAgents: string[];
  strategy?: 'sequential' | 'parallel' | 'adaptive';
  timeout?: number;
}

export interface CoordinationResult {
  goal: string;
  strategy: string;
  agentsUsed: string[];
  results: Record<string, any>;
  executionTime: number;
  success: boolean;
  timestamp: number;
}

export class CoordinatorAgent {
  private agentId = 'coordinator-agent';
  private agent: Agent;
  private kernel: Kernel;
  private messageBus: MessageBus;
  private toolManager: ToolManager;
  private orchestrator: Orchestrator;
  private receivedMessages: any[] = [];

  constructor(
    kernel: Kernel,
    messageBus: MessageBus,
    toolManager: ToolManager,
    orchestrator: Orchestrator
  ) {
    this.kernel = kernel;
    this.messageBus = messageBus;
    this.toolManager = toolManager;
    this.orchestrator = orchestrator;

    // Create coordinator agent
    this.agent = {
      id: this.agentId,
      name: 'Coordinator Agent',
      model: 'local',
      state: 'uninitialized',
      permissions: ['read', 'write', 'network', 'execute'],
      tags: ['coordinator', 'orchestration', 'ipc'],
      handler: async (input: string) => this.executeCoordination(input),
      onMessage: async (msg: any) => this.handleMessage(msg),
      metadata: {
        capabilities: ['agent-coordination', 'workflow-orchestration', 'decision-making'],
        version: '1.0.0',
      },
    };

    // Register agent
    this.kernel.registerAgent(this.agent);
    this.orchestrator.registerAgent(this.agent);

    // Subscribe to IPC messages
    this.messageBus.subscribe(`agent:${this.agentId}`, this.handleMessage.bind(this));
  }

  /**
   * Execute coordination workflow
   */
  private async executeCoordination(input: string): Promise<string> {
    const request: CoordinationRequest = JSON.parse(input);
    const startTime = Date.now();

    try {
      // Decide strategy
      const strategy = request.strategy || this.decideStrategy(request);

      // Build workflow based on strategy
      const workflow = this.buildCoordinationWorkflow(request, strategy);

      // Create and execute workflow
      const wf = this.orchestrator.createWorkflow(
        `coordination-${Date.now()}`,
        `Coordinate: ${request.goal}`,
        workflow,
        { goal: request.goal, strategy }
      );

      const execution = await this.orchestrator.executeWorkflow(wf.id);

      if (!execution.result?.success) {
        return JSON.stringify({
          success: false,
          error: execution.result?.error || 'Coordination failed',
        });
      }

      // Compile results
      const result: CoordinationResult = {
        goal: request.goal,
        strategy,
        agentsUsed: request.availableAgents,
        results: execution.result.output,
        executionTime: Date.now() - startTime,
        success: true,
        timestamp: Date.now(),
      };

      return JSON.stringify(result);
    } catch (error) {
      return JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : String(error),
        executionTime: Date.now() - startTime,
      });
    }
  }

  /**
   * Decide which strategy to use
   */
  private decideStrategy(request: CoordinationRequest): 'sequential' | 'parallel' | 'adaptive' {
    // Simple heuristic: if more than 3 agents, use parallel
    // In production, this would use ML or more sophisticated logic
    if (request.availableAgents.length > 3) {
      return 'parallel';
    }
    
    // Check if goal suggests sequential (contains words like "then", "after", "next")
    if (request.goal.match(/then|after|next|followed by/i)) {
      return 'sequential';
    }

    return 'parallel';
  }

  /**
   * Build coordination workflow
   */
  private buildCoordinationWorkflow(
    request: CoordinationRequest,
    strategy: string
  ): Task {
    const agentTasks: Task[] = request.availableAgents.map((agentId) => ({
      id: `task-${agentId}`,
      type: 'atomic',
      name: `Execute ${agentId}`,
      agentId,
      input: { goal: request.goal },
      timeout: request.timeout || 30000,
      retries: 1,
    }));

    if (strategy === 'sequential') {
      return {
        id: 'coordination-root',
        type: 'sequential',
        name: 'Sequential Coordination',
        subtasks: agentTasks,
      };
    } else if (strategy === 'parallel') {
      return {
        id: 'coordination-root',
        type: 'parallel',
        name: 'Parallel Coordination',
        subtasks: agentTasks,
      };
    } else {
      // Adaptive: try parallel first, fall back to sequential
      return {
        id: 'coordination-root',
        type: 'conditional',
        name: 'Adaptive Coordination',
        condition: (ctx) => ctx.variables.get('try_parallel') !== false,
        subtasks: [
          {
            id: 'parallel-attempt',
            type: 'parallel',
            name: 'Parallel attempt',
            subtasks: agentTasks,
          },
          {
            id: 'sequential-fallback',
            type: 'sequential',
            name: 'Sequential fallback',
            subtasks: agentTasks,
          },
        ],
      };
    }
  }

  /**
   * Handle IPC messages
   */
  private async handleMessage(msg: any): Promise<void> {
    this.receivedMessages.push({
      from: msg.from,
      timestamp: Date.now(),
      content: msg.payload,
    });

    // Coordinator can relay messages, aggregate responses, etc.
    console.log(`[Coordinator] Received message from ${msg.from}:`, msg.payload);
  }

  /**
   * Send message to agent via IPC
   */
  async sendMessageToAgent(targetAgentId: string, content: any): Promise<void> {
    this.messageBus.publish(`agent:${targetAgentId}`, {
      id: `${this.agentId}-${Date.now()}`,
      from: this.agentId,
      to: targetAgentId,
      type: 'request',
      payload: content,
      timestamp: Date.now(),
    });
  }

  /**
   * Broadcast to multiple agents
   */
  async broadcastToAgents(agentIds: string[], content: any): Promise<void> {
    for (const agentId of agentIds) {
      await this.sendMessageToAgent(agentId, content);
    }
  }

  /**
   * Request and aggregate responses from multiple agents
   */
  async requestFromAgents(
    agentIds: string[],
    request: any,
    timeoutMs = 5000
  ): Promise<Record<string, any>> {
    const responses: Record<string, any> = {};
    const startTime = Date.now();

    // Send requests
    const requestId = `req-${Date.now()}`;
    await this.broadcastToAgents(agentIds, {
      requestId,
      ...request,
    });

    // Wait for responses (in production, use Promise.race with timeout)
    await new Promise((resolve) => setTimeout(resolve, timeoutMs));

    // Collect responses from received messages
    const relevantMessages = this.receivedMessages.filter(
      (msg) => msg.content?.requestId === requestId &&
               Date.now() - msg.timestamp < timeoutMs
    );

    relevantMessages.forEach((msg) => {
      responses[msg.from] = msg.content;
    });

    return responses;
  }

  /**
   * Public API: Coordinate agents
   */
  async coordinate(request: CoordinationRequest): Promise<CoordinationResult> {
    const input = JSON.stringify(request);
    const output = await this.agent.handler(input);
    return JSON.parse(output);
  }

  /**
   * Public API: Get received messages
   */
  getReceivedMessages(): any[] {
    return [...this.receivedMessages];
  }

  /**
   * Public API: Clear message history
   */
  clearMessages(): void {
    this.receivedMessages = [];
  }

  /**
   * Public API: Get coordination stats
   */
  getStats() {
    return {
      agentId: this.agentId,
      state: this.agent.state,
      messagesReceived: this.receivedMessages.length,
      workflows: this.orchestrator.getSummary(),
    };
  }

  /**
   * Public API: Subscribe to messages from an agent
   */
  subscribeToAgent(agentId: string, handler: (msg: any) => void): () => void {
    return this.messageBus.subscribe(`agent:${this.agentId}`, (msg) => {
      if (msg.from === agentId) {
        handler(msg);
      }
    });
  }
}
