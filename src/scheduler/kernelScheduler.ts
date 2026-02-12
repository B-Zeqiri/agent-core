/**
 * Kernel Scheduler
 * 
 * Decides WHO runs and WHEN
 * - Agent selection based on task type
 * - Priority-based scheduling
 * - Load balancing
 */

import { Agent } from "../kernel/types";

export interface AgentSlot {
  agentId: string;
  agentName: string;
  isBusy: boolean;
  currentTaskId?: string;
  loadScore: number; // 0-100, higher = more busy
}

export interface ScheduleDecision {
  agentId: string;
  agentName: string;
  scheduledAt: number;
  estimatedWaitMs: number;
}

export class KernelScheduler {
  private agentSlots: Map<string, AgentSlot> = new Map();
  private taskQueue: Array<{
    taskId: string;
    priority: 'low' | 'normal' | 'high';
    createdAt: number;
  }> = [];

  /**
   * Register available agents
   */
  registerAgent(agentId: string, agentName: string): void {
    this.agentSlots.set(agentId, {
      agentId,
      agentName,
      isBusy: false,
      loadScore: 0,
    });
  }

  /**
   * Unregister agent (used for hot-reload / dynamic agent lifecycles)
   */
  unregisterAgent(agentId: string): boolean {
    return this.agentSlots.delete(agentId);
  }

  /**
   * Select best agent for task
   */
  selectAgent(taskType: string = 'web-dev'): ScheduleDecision | null {
    // Map task types to agents
    const agentMapping: Record<string, string> = {
      'web-dev': 'web-dev-agent',
      'research': 'research-agent',
      'system': 'system-agent',
    };

    const targetAgentId = agentMapping[taskType] || agentMapping['web-dev'];
    const agent = this.agentSlots.get(targetAgentId);

    if (!agent) {
      // Fallback: get least busy agent
      return this.getLeastBusyAgent();
    }

    if (!agent.isBusy) {
      return {
        agentId: agent.agentId,
        agentName: agent.agentName,
        scheduledAt: Date.now(),
        estimatedWaitMs: 0,
      };
    }

    // Agent is busy, calculate wait time
    return {
      agentId: agent.agentId,
      agentName: agent.agentName,
      scheduledAt: Date.now(),
      estimatedWaitMs: Math.ceil(agent.loadScore * 1000 / 100),
    };
  }

  /**
   * Get least busy agent
   */
  private getLeastBusyAgent(): ScheduleDecision | null {
    let leastBusyAgent: AgentSlot | null = null;
    let minLoad = Infinity;

    for (const slot of this.agentSlots.values()) {
      if (slot.loadScore < minLoad) {
        minLoad = slot.loadScore;
        leastBusyAgent = slot;
      }
    }

    if (!leastBusyAgent) return null;

    return {
      agentId: leastBusyAgent.agentId,
      agentName: leastBusyAgent.agentName,
      scheduledAt: Date.now(),
      estimatedWaitMs: Math.ceil(minLoad * 1000 / 100),
    };
  }

  /**
   * Mark agent as busy
   */
  markBusy(agentId: string, taskId: string): void {
    const slot = this.agentSlots.get(agentId);
    if (slot) {
      slot.isBusy = true;
      slot.currentTaskId = taskId;
      slot.loadScore = Math.min(100, slot.loadScore + 50);
    }
  }

  /**
   * Mark agent as idle
   */
  markIdle(agentId: string): void {
    const slot = this.agentSlots.get(agentId);
    if (slot) {
      slot.isBusy = false;
      slot.currentTaskId = undefined;
      slot.loadScore = Math.max(0, slot.loadScore - 50);
    }
  }

  /**
   * Get scheduler status
   */
  getStatus(): {
    agents: AgentSlot[];
    queuedTasks: number;
    avgLoad: number;
  } {
    const agents = Array.from(this.agentSlots.values());
    const avgLoad = agents.reduce((sum, a) => sum + a.loadScore, 0) / agents.length || 0;

    return {
      agents,
      queuedTasks: this.taskQueue.length,
      avgLoad: Math.round(avgLoad),
    };
  }
}

export const kernelScheduler = new KernelScheduler();
