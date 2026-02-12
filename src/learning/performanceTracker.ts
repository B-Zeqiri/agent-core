/**
 * Performance Tracker
 *
 * Tracks metrics for agents, strategies, and execution performance
 */

import { AgentMetrics, StrategyMetrics, ExecutionRecord } from './types';

export class PerformanceTracker {
  private agentMetrics = new Map<string, AgentMetrics>();
  private strategyMetrics = new Map<string, StrategyMetrics>();
  private executionHistory: ExecutionRecord[] = [];
  private readonly maxHistorySize = 10000;

  /**
   * Record a completed execution
   */
  recordExecution(
    agentIds: string[],
    strategyId: string,
    executionTime: number,
    qualityScore: number,
    success: boolean,
    errorMessage?: string
  ): ExecutionRecord {
    const record: ExecutionRecord = {
      id: `exec_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      agentIds,
      strategyId,
      executionTime,
      qualityScore,
      success,
      errorMessage,
      timestamp: Date.now(),
    };

    this.executionHistory.push(record);

    // Keep history bounded
    if (this.executionHistory.length > this.maxHistorySize) {
      this.executionHistory.shift();
    }

    // Update agent metrics
    agentIds.forEach((agentId) => {
      this.updateAgentMetrics(agentId, executionTime, qualityScore, success);
    });

    // Update strategy metrics
    this.updateStrategyMetrics(
      strategyId,
      agentIds,
      executionTime,
      qualityScore,
      success
    );

    return record;
  }

  /**
   * Update metrics for an agent
   */
  private updateAgentMetrics(
    agentId: string,
    executionTime: number,
    qualityScore: number,
    success: boolean
  ): void {
    let metrics = this.agentMetrics.get(agentId);

    if (!metrics) {
      metrics = {
        agentId,
        totalExecutions: 0,
        successfulExecutions: 0,
        failedExecutions: 0,
        averageExecutionTime: 0,
        averageQualityScore: 0,
        successRate: 0,
        lastExecutionTime: 0,
        lastExecutionSuccess: false,
      };
      this.agentMetrics.set(agentId, metrics);
    }

    // Update counts
    metrics.totalExecutions++;
    if (success) {
      metrics.successfulExecutions++;
    } else {
      metrics.failedExecutions++;
    }

    // Update averages
    metrics.averageExecutionTime =
      (metrics.averageExecutionTime * (metrics.totalExecutions - 1) +
        executionTime) /
      metrics.totalExecutions;

    metrics.averageQualityScore =
      (metrics.averageQualityScore * (metrics.totalExecutions - 1) +
        qualityScore) /
      metrics.totalExecutions;

    metrics.successRate =
      metrics.successfulExecutions / metrics.totalExecutions;

    metrics.lastExecutionTime = executionTime;
    metrics.lastExecutionSuccess = success;
  }

  /**
   * Update metrics for a strategy
   */
  private updateStrategyMetrics(
    strategyId: string,
    agentIds: string[],
    executionTime: number,
    qualityScore: number,
    success: boolean
  ): void {
    const key = this.getStrategyKey(strategyId, agentIds);
    let metrics = this.strategyMetrics.get(key);

    if (!metrics) {
      metrics = {
        strategyId,
        agentCombination: agentIds.join(','),
        executionCount: 0,
        successCount: 0,
        failureCount: 0,
        averageExecutionTime: 0,
        averageQualityScore: 0,
        successRate: 0,
        recommendation: 50, // neutral
        lastUsedTime: 0,
        improvementTrend: 'stable',
      };
      this.strategyMetrics.set(key, metrics);
    }

    // Update counts
    metrics.executionCount++;
    if (success) {
      metrics.successCount++;
    } else {
      metrics.failureCount++;
    }

    // Update averages
    metrics.averageExecutionTime =
      (metrics.averageExecutionTime * (metrics.executionCount - 1) +
        executionTime) /
      metrics.executionCount;

    metrics.averageQualityScore =
      (metrics.averageQualityScore * (metrics.executionCount - 1) +
        qualityScore) /
      metrics.executionCount;

    metrics.successRate =
      metrics.successCount / metrics.executionCount;

    metrics.lastUsedTime = Date.now();

    // Calculate recommendation score (0-100)
    // Higher score = better strategy
    const successComponent = metrics.successRate * 50; // Success rate 0-50
    const qualityComponent = (metrics.averageQualityScore / 100) * 30; // Quality 0-30
    const speedComponent =
      Math.max(0, 1 - metrics.averageExecutionTime / 10000) * 20; // Speed 0-20
    metrics.recommendation =
      Math.round(successComponent + qualityComponent + speedComponent);
  }

  /**
   * Get metrics for an agent
   */
  getAgentMetrics(agentId: string): AgentMetrics | undefined {
    return this.agentMetrics.get(agentId);
  }

  /**
   * Get all agent metrics
   */
  getAllAgentMetrics(): AgentMetrics[] {
    return Array.from(this.agentMetrics.values());
  }

  /**
   * Get metrics for a strategy
   */
  getStrategyMetrics(
    strategyId: string,
    agentIds: string[]
  ): StrategyMetrics | undefined {
    const key = this.getStrategyKey(strategyId, agentIds);
    return this.strategyMetrics.get(key);
  }

  /**
   * Get all strategy metrics
   */
  getAllStrategyMetrics(): StrategyMetrics[] {
    return Array.from(this.strategyMetrics.values());
  }

  /**
   * Get execution history (with optional filtering)
   */
  getExecutionHistory(
    limit: number = 100,
    agentId?: string,
    strategyId?: string
  ): ExecutionRecord[] {
    let history = [...this.executionHistory];

    if (agentId) {
      history = history.filter((r) => r.agentIds.includes(agentId));
    }

    if (strategyId) {
      history = history.filter((r) => r.strategyId === strategyId);
    }

    // Return most recent first
    return history.reverse().slice(0, limit);
  }

  /**
   * Get success rate for an agent
   */
  getAgentSuccessRate(agentId: string): number {
    const metrics = this.agentMetrics.get(agentId);
    return metrics ? metrics.successRate : 0;
  }

  /**
   * Get average execution time for a strategy
   */
  getStrategyAverageTime(
    strategyId: string,
    agentIds: string[]
  ): number {
    const metrics = this.getStrategyMetrics(strategyId, agentIds);
    return metrics ? metrics.averageExecutionTime : 0;
  }

  /**
   * Get best performing agents
   */
  getTopAgents(limit: number = 5): AgentMetrics[] {
    return this.getAllAgentMetrics()
      .filter((m) => m.totalExecutions >= 5) // Only agents with enough data
      .sort(
        (a, b) =>
          b.successRate - a.successRate ||
          b.averageQualityScore - a.averageQualityScore
      )
      .slice(0, limit);
  }

  /**
   * Get best performing strategies
   */
  getTopStrategies(limit: number = 5): StrategyMetrics[] {
    return this.getAllStrategyMetrics()
      .filter((m) => m.executionCount >= 3) // Only strategies with enough data
      .sort((a, b) => b.recommendation - a.recommendation)
      .slice(0, limit);
  }

  /**
   * Clear metrics (for testing)
   */
  clear(): void {
    this.agentMetrics.clear();
    this.strategyMetrics.clear();
    this.executionHistory = [];
  }

  /**
   * Get execution count for filtering
   */
  getExecutionCount(): number {
    return this.executionHistory.length;
  }

  /**
   * Helper to create strategy key
   */
  private getStrategyKey(strategyId: string, agentIds: string[]): string {
    return `${strategyId}:${agentIds.sort().join(',')}`;
  }
}

export const performanceTracker = new PerformanceTracker();
