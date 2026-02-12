/**
 * Learning Manager
 *
 * Coordinates the learning system: performance tracking, strategy recommendations,
 * and analytics
 */

import { ExecutionRecord, StrategyRecommendation, PerformanceReport } from './types';
import { PerformanceTracker } from './performanceTracker';
import { StrategyRecommender } from './strategyRecommender';
import { AnalyticsEngine } from './analyticsEngine';

export class LearningManager {
  private performanceTracker: PerformanceTracker;
  private strategyRecommender: StrategyRecommender;
  private analyticsEngine: AnalyticsEngine;

  constructor() {
    this.performanceTracker = new PerformanceTracker();
    this.strategyRecommender = new StrategyRecommender(this.performanceTracker);
    this.analyticsEngine = new AnalyticsEngine(this.performanceTracker);
  }

  /**
   * Record an execution for learning
   */
  recordExecution(
    agentIds: string[],
    strategyId: string,
    executionTime: number,
    qualityScore: number,
    success: boolean,
    errorMessage?: string
  ): ExecutionRecord {
    return this.performanceTracker.recordExecution(
      agentIds,
      strategyId,
      executionTime,
      qualityScore,
      success,
      errorMessage
    );
  }

  /**
   * Get recommendation for best strategy
   */
  recommendStrategy(
    agentIds: string[],
    context?: {
      priority?: 'speed' | 'quality' | 'balanced';
      timeout?: number;
      complexity?: 'low' | 'medium' | 'high';
    }
  ): StrategyRecommendation {
    return this.strategyRecommender.recommendStrategy(agentIds, context);
  }

  /**
   * Generate comprehensive performance report
   */
  generateReport(): PerformanceReport {
    return this.analyticsEngine.generatePerformanceReport();
  }

  /**
   * Get execution history
   */
  getHistory(limit: number = 100): ExecutionRecord[] {
    return this.performanceTracker.getExecutionHistory(limit);
  }

  /**
   * Compare strategies for given agents
   */
  compareStrategies(agentIds: string[]): any[] {
    return this.strategyRecommender.compareStrategies(agentIds);
  }

  /**
   * Analyze trends for a metric
   */
  analyzeTrends(metric: string = 'quality'): any {
    return this.analyticsEngine.analyzeTrends(metric);
  }

  /**
   * Get learning statistics
   */
  getStats(): {
    totalExecutions: number;
    agentCount: number;
    strategyCount: number;
    averageSuccessRate: number;
    averageQualityScore: number;
  } {
    const history = this.performanceTracker.getExecutionHistory(10000);
    const allAgents = this.performanceTracker.getAllAgentMetrics();
    const allStrategies = this.performanceTracker.getAllStrategyMetrics();

    const avgSuccess =
      history.length > 0
        ? history.filter((r) => r.success).length / history.length
        : 0;

    const avgQuality =
      history.length > 0
        ? history.reduce((sum, r) => sum + r.qualityScore, 0) / history.length
        : 0;

    return {
      totalExecutions: history.length,
      agentCount: allAgents.length,
      strategyCount: allStrategies.length,
      averageSuccessRate: Math.round(avgSuccess * 100) / 100,
      averageQualityScore: Math.round(avgQuality * 10) / 10,
    };
  }

  /**
   * Clear all learning data (for testing)
   */
  clear(): void {
    this.performanceTracker.clear();
  }

  /**
   * Export learning data
   */
  export(): {
    executionHistory: ExecutionRecord[];
    agentMetrics: any[];
    strategyMetrics: any[];
  } {
    return {
      executionHistory: this.performanceTracker.getExecutionHistory(10000),
      agentMetrics: this.performanceTracker.getAllAgentMetrics(),
      strategyMetrics: this.performanceTracker.getAllStrategyMetrics(),
    };
  }
}

export const learningManager = new LearningManager();
