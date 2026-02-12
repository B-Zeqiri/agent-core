/**
 * Strategy Recommender
 *
 * Analyzes execution history and recommends optimal orchestration strategies
 */

import {
  StrategyRecommendation,
  StrategyMetrics,
  AgentMetrics,
} from './types';
import { PerformanceTracker } from './performanceTracker';

export class StrategyRecommender {
  constructor(private tracker: PerformanceTracker) {}

  /**
   * Recommend best strategy for given agents
   */
  recommendStrategy(
    agentIds: string[],
    context?: {
      priority?: 'speed' | 'quality' | 'balanced';
      timeout?: number;
      complexity?: 'low' | 'medium' | 'high';
    }
  ): StrategyRecommendation {
    const priority = context?.priority || 'balanced';
    const complexity = context?.complexity || 'medium';

    // Get all possible strategies and their metrics
    const strategies = this.evaluateStrategies(agentIds, priority);

    // Select best strategy
    const best = strategies[0];

    // Calculate confidence based on execution count
    const allMetrics = this.tracker.getAllStrategyMetrics();
    const relevantMetrics = allMetrics.filter((m) =>
      agentIds.includes(m.agentCombination.split(',')[0])
    );
    const totalExecutions = relevantMetrics.reduce(
      (sum, m) => sum + m.executionCount,
      0
    );
    const confidence = Math.min(
      100,
      Math.round((totalExecutions / 10) * 10)
    );

    // Predict expected outcomes
    const expectedExecution = this.predictExecutionTime(
      best.strategyId,
      agentIds
    );
    const expectedQuality = this.predictQualityScore(
      best.strategyId,
      agentIds
    );

    // Generate reasoning
    const reasoning = this.generateReasoning(
      best,
      strategies.slice(1),
      priority,
      complexity,
      confidence
    );

    return {
      recommendedStrategy: best.strategyId as
        | 'sequential'
        | 'parallel'
        | 'adaptive',
      confidence: Math.min(100, confidence),
      expectedExecutionTime: expectedExecution,
      expectedQualityScore: expectedQuality,
      reasoning,
    };
  }

  /**
   * Evaluate all strategies for given agents
   */
  private evaluateStrategies(
    agentIds: string[],
    priority: 'speed' | 'quality' | 'balanced'
  ): StrategyMetrics[] {
    const strategies: Map<string, StrategyMetrics> = new Map();

    // Evaluate each strategy type
    const strategyTypes = ['sequential', 'parallel', 'adaptive'];

    for (const strategyId of strategyTypes) {
      // Get metrics for this strategy
      const metrics = this.tracker.getStrategyMetrics(strategyId, agentIds);

      if (metrics) {
        strategies.set(strategyId, metrics);
      } else {
        // Create hypothetical metrics based on agent performance
        const hypothetical = this.createHypotheticalMetrics(
          strategyId,
          agentIds,
          priority
        );
        strategies.set(strategyId, hypothetical);
      }
    }

    // Score and sort strategies
    const scored = Array.from(strategies.values())
      .map((m) => ({
        ...m,
        score: this.scoreStrategy(m, priority),
      }))
      .sort((a, b) => b.score - a.score);

    return scored.map(({ score, ...m }) => m);
  }

  /**
   * Score a strategy based on priority
   */
  private scoreStrategy(
    metrics: StrategyMetrics,
    priority: 'speed' | 'quality' | 'balanced'
  ): number {
    let score = 0;

    switch (priority) {
      case 'speed':
        // Favor fast strategies
        score = metrics.recommendation * 0.3;
        score += (1 - Math.min(1, metrics.averageExecutionTime / 5000)) * 70;
        break;
      case 'quality':
        // Favor high quality
        score = metrics.recommendation * 0.5;
        score += (metrics.averageQualityScore / 100) * 50;
        break;
      case 'balanced':
      default:
        // Balance all factors
        score = metrics.recommendation;
        break;
    }

    return score;
  }

  /**
   * Create hypothetical metrics for untested strategies
   */
  private createHypotheticalMetrics(
    strategyId: string,
    agentIds: string[],
    priority: string
  ): StrategyMetrics {
    // Get agent metrics to estimate
    const agentMetrics = agentIds
      .map((id) => this.tracker.getAgentMetrics(id))
      .filter((m): m is AgentMetrics => !!m);

    // Average agent performance
    let avgSuccess = 0.75; // Default success rate
    let avgQuality = 75;
    let avgTime = 1000;

    if (agentMetrics.length > 0) {
      avgSuccess =
        agentMetrics.reduce((sum, m) => sum + m.successRate, 0) /
        agentMetrics.length;
      avgQuality =
        agentMetrics.reduce((sum, m) => sum + m.averageQualityScore, 0) /
        agentMetrics.length;
      avgTime =
        agentMetrics.reduce((sum, m) => sum + m.averageExecutionTime, 0) /
        agentMetrics.length;
    }

    // Adjust for strategy type
    let timeMultiplier = 1;
    let qualityMultiplier = 1;

    if (strategyId === 'parallel') {
      // Parallel faster, similar quality
      timeMultiplier = 0.6;
    } else if (strategyId === 'sequential') {
      // Sequential slower, higher quality
      timeMultiplier = 1.5;
      qualityMultiplier = 1.1;
    } else {
      // Adaptive in between
      timeMultiplier = 0.9;
      qualityMultiplier = 1.05;
    }

    return {
      strategyId,
      agentCombination: agentIds.join(','),
      executionCount: 0,
      successCount: 0,
      failureCount: 0,
      averageExecutionTime: avgTime * timeMultiplier,
      averageQualityScore: Math.min(100, avgQuality * qualityMultiplier),
      successRate: avgSuccess,
      recommendation: this.scoreStrategy(
        {
          strategyId,
          agentCombination: agentIds.join(','),
          executionCount: 0,
          successCount: 0,
          failureCount: 0,
          averageExecutionTime: avgTime * timeMultiplier,
          averageQualityScore: Math.min(100, avgQuality * qualityMultiplier),
          successRate: avgSuccess,
          recommendation: 0,
          lastUsedTime: 0,
          improvementTrend: 'stable',
        },
        priority as any
      ),
      lastUsedTime: Date.now(),
      improvementTrend: 'stable',
    };
  }

  /**
   * Predict execution time based on history
   */
  private predictExecutionTime(
    strategyId: string,
    agentIds: string[]
  ): number {
    const metrics = this.tracker.getStrategyMetrics(strategyId, agentIds);
    if (metrics && metrics.executionCount >= 5) {
      return Math.round(metrics.averageExecutionTime);
    }

    // Estimate based on agent count and strategy
    const agentCount = agentIds.length;
    const baseTime = 500;
    const perAgent = 200;

    switch (strategyId) {
      case 'sequential':
        return baseTime + perAgent * agentCount;
      case 'parallel':
        return baseTime + Math.ceil((perAgent * agentCount) / 2);
      default:
        return baseTime + Math.round(perAgent * agentCount * 0.75);
    }
  }

  /**
   * Predict quality score based on history
   */
  private predictQualityScore(
    strategyId: string,
    agentIds: string[]
  ): number {
    const metrics = this.tracker.getStrategyMetrics(strategyId, agentIds);
    if (metrics && metrics.executionCount >= 5) {
      return Math.round(metrics.averageQualityScore);
    }

    // Estimate based on agent quality
    const agentMetrics = agentIds
      .map((id) => this.tracker.getAgentMetrics(id))
      .filter((m): m is AgentMetrics => !!m);

    if (agentMetrics.length === 0) {
      return 75;
    }

    const avgQuality =
      agentMetrics.reduce((sum, m) => sum + m.averageQualityScore, 0) /
      agentMetrics.length;

    // Sequential typically produces higher quality
    if (strategyId === 'sequential') {
      return Math.round(avgQuality * 1.1);
    }

    return Math.round(avgQuality);
  }

  /**
   * Generate human-readable reasoning for recommendation
   */
  private generateReasoning(
    best: StrategyMetrics,
    others: StrategyMetrics[],
    priority: string,
    complexity: string,
    confidence: number
  ): string[] {
    const reasoning: string[] = [];

    // Add primary reason
    const reason = this.getPrimaryReason(best, priority);
    reasoning.push(reason);

    // Add comparison reason if confident
    if (others.length > 0 && confidence > 50) {
      const secondBest = others[0];
      const difference = Math.round(
        ((best.recommendation - secondBest.recommendation) /
          secondBest.recommendation) *
          100
      );
      if (difference > 5) {
        reasoning.push(
          `${difference}% better than ${secondBest.strategyId} strategy`
        );
      } else {
        reasoning.push(
          `Similar performance to ${secondBest.strategyId} strategy`
        );
      }
    }

    // Add complexity consideration
    if (complexity === 'high') {
      if (best.strategyId === 'sequential') {
        reasoning.push('Sequential execution provides better control for complex workflows');
      }
    } else if (complexity === 'low') {
      if (best.strategyId === 'parallel') {
        reasoning.push('Parallel execution maximizes efficiency for simple tasks');
      }
    }

    // Add confidence note
    if (confidence < 40) {
      reasoning.push('Limited execution history; confidence may be lower');
    } else if (confidence > 80) {
      reasoning.push('High confidence based on extensive execution history');
    }

    return reasoning;
  }

  /**
   * Get primary reason for recommendation
   */
  private getPrimaryReason(
    metrics: StrategyMetrics,
    priority: string
  ): string {
    if (priority === 'speed') {
      return `${metrics.strategyId} strategy recommended for optimal speed (${Math.round(metrics.averageExecutionTime)}ms expected)`;
    } else if (priority === 'quality') {
      return `${metrics.strategyId} strategy recommended for best quality (${Math.round(metrics.averageQualityScore)}/100 expected)`;
    } else {
      return `${metrics.strategyId} strategy recommended for balanced performance`;
    }
  }

  /**
   * Get strategy comparison
   */
  compareStrategies(agentIds: string[]): StrategyMetrics[] {
    const strategies = this.evaluateStrategies(agentIds, 'balanced');
    return strategies;
  }
}

export const createStrategyRecommender = (
  tracker: PerformanceTracker
): StrategyRecommender => {
  return new StrategyRecommender(tracker);
};
