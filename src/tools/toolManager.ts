/**
 * ToolManager
 *
 * Central controller for all agent tools.
 *
 * Responsibilities:
 * - Register and manage tools
 * - Enforce permissions
 * - Rate limiting
 * - Call tracking and statistics
 * - Health checks
 */

import { BaseTool, ToolConfig, ToolPermission, ToolCall, ToolResult } from "./tool.interface";
import { securityManager } from "../security/securityManager";
import { auditLogger } from "../security/auditLogger";
import { replayStore } from "../storage/replayStore";
import { eventBus } from "../events/eventBus";
import { toolCallStore } from "../storage/toolCallStore";

export interface AgentToolPermissions {
  agentId: string;
  permissions: Set<string>; // tool names they can use
}

export class ToolManager {
  private tools = new Map<string, BaseTool>();
  private permissions = new Map<string, AgentToolPermissions>();
  private callLog: Array<{
    agentId: string;
    toolName: string;
    timestamp: number;
    success: boolean;
  }> = [];

  /**
   * Register a tool
   */
  registerTool(tool: BaseTool): void {
    const name = tool.getConfig().name;
    if (this.tools.has(name)) {
      throw new Error(`Tool ${name} already registered`);
    }
    this.tools.set(name, tool);
  }

  /**
   * Get tool by name
   */
  getTool(name: string): BaseTool | undefined {
    return this.tools.get(name);
  }

  /**
   * Get all registered tools
   */
  getTools(): BaseTool[] {
    return Array.from(this.tools.values());
  }

  /**
   * Unregister a tool
   */
  unregisterTool(name: string): boolean {
    return this.tools.delete(name);
  }

  // ============ PERMISSIONS ============

  /**
   * Grant agent permission to use a tool
   */
  grantPermission(agentId: string, toolName: string): void {
    if (!this.tools.has(toolName)) {
      throw new Error(`Tool ${toolName} not registered`);
    }

    const perms = this.getOrCreatePermissions(agentId);
    perms.permissions.add(toolName);
  }

  /**
   * Revoke agent permission to use a tool
   */
  revokePermission(agentId: string, toolName: string): void {
    const perms = this.permissions.get(agentId);
    if (perms) {
      perms.permissions.delete(toolName);
    }
  }

  /**
   * Check if agent can use a tool
   */
  canUseTool(agentId: string, toolName: string): boolean {
    const perms = this.permissions.get(agentId);
    return perms ? perms.permissions.has(toolName) : false;
  }

  /**
   * Get agent's allowed tools
   */
  getAgentTools(agentId: string): BaseTool[] {
    const perms = this.permissions.get(agentId);
    if (!perms) return [];

    return Array.from(perms.permissions)
      .map((name) => this.tools.get(name))
      .filter((tool): tool is BaseTool => tool !== undefined);
  }

  /**
   * Grant multiple permissions at once
   */
  grantPermissions(agentId: string, toolNames: string[]): void {
    toolNames.forEach((name) => this.grantPermission(agentId, name));
  }

  /**
   * Set all permissions for an agent (replaces existing)
   */
  setPermissions(agentId: string, toolNames: string[]): void {
    const perms = this.getOrCreatePermissions(agentId);
    perms.permissions.clear();
    toolNames.forEach((name) => {
      if (!this.tools.has(name)) {
        throw new Error(`Tool ${name} not registered`);
      }
      perms.permissions.add(name);
    });
  }

  /**
   * Get agent permissions
   */
  getPermissions(agentId: string): string[] {
    const perms = this.permissions.get(agentId);
    return perms ? Array.from(perms.permissions) : [];
  }

  // ============ TOOL EXECUTION ============

  /**
   * Call a tool (with permission check)
   */
  async callTool(
    agentId: string,
    toolCall: ToolCall,
    options?: { taskId?: string }
  ): Promise<ToolResult> {
    const taskId = options?.taskId;

    // Check permission
    if (!this.canUseTool(agentId, toolCall.toolName)) {
      auditLogger.log({
        eventType: 'permission-denied',
        agentId,
        taskId,
        toolName: toolCall.toolName,
        details: { reason: 'Agent lacks permission', args: toolCall.args },
      });
      return {
        success: false,
        error: `Agent ${agentId} does not have permission to use ${toolCall.toolName}`,
        executionTime: 0,
      };
    }

    const tool = this.tools.get(toolCall.toolName);
    if (!tool) {
      return {
        success: false,
        error: `Tool ${toolCall.toolName} not found`,
        executionTime: 0,
      };
    }

    // Check rate limit
    if (!tool.checkRateLimit()) {
      auditLogger.log({
        eventType: 'rate-limit-exceeded',
        agentId,
        taskId,
        toolName: toolCall.toolName,
        details: { rateLimit: tool.getConfig().rateLimit, args: toolCall.args },
      });
      return {
        success: false,
        error: `Rate limit exceeded for ${toolCall.toolName}`,
        executionTime: 0,
      };
    }

    const startTime = Date.now();

    if (taskId) {
      eventBus.emit('tool.called', taskId, agentId, { toolName: toolCall.toolName }).catch(() => {});
    }

    try {
      const result = await securityManager.enforceToolCall(agentId, tool, toolCall.args);

      const executionTime = Date.now() - startTime;
      this.logCall(agentId, toolCall.toolName, true);
      auditLogger.log({
        eventType: 'tool-call',
        agentId,
        taskId,
        toolName: toolCall.toolName,
        details: { executionTime, success: true, args: toolCall.args },
      });

      if (taskId) {
        replayStore.recordEvent({
          taskId,
          agentId,
          kind: "tool",
          name: toolCall.toolName,
          input: toolCall.args,
          output: result,
          startedAt: startTime,
          completedAt: Date.now(),
          metadata: { success: true },
        });
      }

      toolCallStore.recordCall({
        timestamp: startTime,
        agentId,
        taskId,
        toolName: toolCall.toolName,
        args: toolCall.args,
        success: true,
        durationMs: executionTime,
      });

      if (taskId) {
        eventBus.emit("tool.completed", taskId, agentId, {
          toolName: toolCall.toolName,
          success: true,
          executionTime,
        }).catch(() => {});
      }

      return {
        success: true,
        data: result,
        executionTime,
      };
    } catch (err) {
      const executionTime = Date.now() - startTime;
      const error = err instanceof Error ? err.message : String(err);

      this.logCall(agentId, toolCall.toolName, false);
      const isTimeout = error.toLowerCase().includes('timed out');
      auditLogger.log({
        eventType: isTimeout ? 'tool-timeout' : 'execution-error',
        agentId,
        taskId,
        toolName: toolCall.toolName,
        details: { executionTime, error, args: toolCall.args },
      });

      if (taskId) {
        replayStore.recordEvent({
          taskId,
          agentId,
          kind: "tool",
          name: toolCall.toolName,
          input: toolCall.args,
          error,
          startedAt: startTime,
          completedAt: Date.now(),
          metadata: { success: false },
        });
      }

      toolCallStore.recordCall({
        timestamp: startTime,
        agentId,
        taskId,
        toolName: toolCall.toolName,
        args: toolCall.args,
        success: false,
        durationMs: executionTime,
        error,
      });

      if (taskId) {
        eventBus.emit("tool.completed", taskId, agentId, {
          toolName: toolCall.toolName,
          success: false,
          executionTime,
          error,
        }).catch(() => {});
      }

      return {
        success: false,
        error,
        executionTime,
      };
    } finally {
      if (taskId) {
        eventBus
          .emit('tool.completed', taskId, agentId, { toolName: toolCall.toolName })
          .catch(() => {});
      }
    }
  }

  /**
   * Call multiple tools in sequence
   */
  async callTools(
    agentId: string,
    toolCalls: ToolCall[]
  ): Promise<ToolResult[]> {
    const results: ToolResult[] = [];

    for (const toolCall of toolCalls) {
      const result = await this.callTool(agentId, toolCall);
      results.push(result);
    }

    return results;
  }

  // ============ STATISTICS ============

  /**
   * Get tool statistics
   */
  getToolStats(): Record<string, any> {
    const stats: Record<string, any> = {};

    for (const [name, tool] of this.tools) {
      stats[name] = tool.getStats();
    }

    return stats;
  }

  /**
   * Get agent call history
   */
  getAgentCallHistory(agentId: string, limit: number = 100): Array<any> {
    return this.callLog
      .filter((log) => log.agentId === agentId)
      .slice(-limit);
  }

  /**
   * Get all call history
   */
  getCallHistory(limit: number = 1000): Array<any> {
    return this.callLog.slice(-limit);
  }

  /**
   * Get tool usage stats
   */
  getToolUsage(): Record<string, { calls: number; success: number; failed: number }> {
    const usage: Record<string, { calls: number; success: number; failed: number }> = {};

    for (const [name] of this.tools) {
      usage[name] = { calls: 0, success: 0, failed: 0 };
    }

    this.callLog.forEach((log) => {
      if (usage[log.toolName]) {
        usage[log.toolName].calls++;
        if (log.success) {
          usage[log.toolName].success++;
        } else {
          usage[log.toolName].failed++;
        }
      }
    });

    return usage;
  }

  // ============ HEALTH ============

  /**
   * Health check all tools
   */
  async healthCheck(): Promise<Record<string, boolean>> {
    const results: Record<string, boolean> = {};

    for (const [name, tool] of this.tools) {
      try {
        results[name] = await tool.isHealthy();
      } catch (err) {
        results[name] = false;
      }
    }

    return results;
  }

  // ============ CLEANUP ============

  /**
   * Clear all tools and permissions
   */
  clear(): void {
    this.tools.clear();
    this.permissions.clear();
    this.callLog = [];
  }

  /**
   * Clear call history
   */
  clearCallHistory(): void {
    this.callLog = [];
  }

  // ============ PRIVATE ============

  private getOrCreatePermissions(agentId: string): AgentToolPermissions {
    if (!this.permissions.has(agentId)) {
      this.permissions.set(agentId, {
        agentId,
        permissions: new Set(),
      });
    }
    return this.permissions.get(agentId)!;
  }

  private logCall(agentId: string, toolName: string, success: boolean): void {
    this.callLog.push({
      agentId,
      toolName,
      timestamp: Date.now(),
      success,
    });
  }
}

export const toolManager = new ToolManager();
