/**
 * Analytics Engine
 *
 * Analyzes execution data and generates insights and trends
 */

import {
  LearningInsight,
  TrendAnalysis,
  PerformanceReport,
  ExecutionRecord,
  AgentMetrics,
  StrategyMetrics,
} from './types';
import { PerformanceTracker } from './performanceTracker';

export class AnalyticsEngine {
  constructor(private tracker: PerformanceTracker) {}

  /**
   * Generate comprehensive performance report
   */
  generatePerformanceReport(): PerformanceReport {
    const timestamp = Date.now();
    const metrics = this.calculateMetrics();
    const insights = this.generateInsights();
    const recommendations = this.generateRecommendations();

    return {
      timestamp,
      periodStart: timestamp - 24 * 60 * 60 * 1000, // Last 24 hours
      periodEnd: timestamp,
      metrics,
      insights,
      recommendations,
      summary: this.generateSummary(metrics, insights),
    };
  }

  /**
   * Calculate key performance metrics
   */
  private calculateMetrics(): {
    totalExecutions: number;
    successRate: number;
    averageQualityScore: number;
    averageExecutionTime: number;
    topAgent: string;
    preferredStrategy: string;
  } {
    const allAgents = this.tracker.getAllAgentMetrics();
    const allStrategies = this.tracker.getAllStrategyMetrics();
    const history = this.tracker.getExecutionHistory(1000);

    if (history.length === 0) {
      return {
        totalExecutions: 0,
        successRate: 0,
        averageQualityScore: 0,
        averageExecutionTime: 0,
        topAgent: 'unknown',
        preferredStrategy: 'balanced',
      };
    }

    const successRate =
      history.filter((r) => r.success).length / history.length;
    const avgQuality =
      history.reduce((sum, r) => sum + r.qualityScore, 0) / history.length;
    const avgTime =
      history.reduce((sum, r) => sum + r.executionTime, 0) / history.length;

    let topAgent = 'unknown';
    let topScore = 0;
    allAgents.forEach((a) => {
      if (a.successRate > topScore) {
        topScore = a.successRate;
        topAgent = a.agentId;
      }
    });

    let preferredStrategy = 'balanced';
    let highestRec = 0;
    allStrategies.forEach((s) => {
      if (s.executionCount >= 3 && s.recommendation > highestRec) {
        highestRec = s.recommendation;
        preferredStrategy = s.strategyId;
      }
    });

    return {
      totalExecutions: history.length,
      successRate: Math.round(successRate * 100) / 100,
      averageQualityScore: Math.round(avgQuality * 10) / 10,
      averageExecutionTime: Math.round(avgTime * 10) / 10,
      topAgent,
      preferredStrategy,
    };
  }

  /**
   * Generate actionable insights from data
   */
  private generateInsights(): LearningInsight[] {
    const insights: LearningInsight[] = [];

    // Insight 1: Top performing agents
    const topAgents = this.tracker.getTopAgents(3);
    if (topAgents.length > 0) {
      insights.push({
        type: 'agent-performance',
        priority: 'high',
        insight: `Top performing agent: ${topAgents[0].agentId} with ${Math.round(topAgents[0].successRate * 100)}% success rate`,
        actionable: true,
        recommendation: `Consider using ${topAgents[0].agentId} for critical tasks`,
        confidence: Math.round(
          (topAgents[0].successfulExecutions / 10) * 100
        ),
      });
    }

    // Insight 2: Best strategies
    const topStrategies = this.tracker.getTopStrategies(2);
    if (topStrategies.length > 0) {
      insights.push({
        type: 'strategy-effectiveness',
        priority: 'high',
        insight: `Most effective strategy: ${topStrategies[0].strategyId} with ${topStrategies[0].recommendation}/100 recommendation score`,
        actionable: true,
        recommendation: `Use ${topStrategies[0].strategyId} strategy for similar tasks in future`,
        confidence: Math.min(
          100,
          topStrategies[0].executionCount * 10
        ),
      });
    }

    // Insight 3: Execution efficiency
    const allAgents = this.tracker.getAllAgentMetrics();
    const avgTime =
      allAgents.reduce((sum, a) => sum + a.averageExecutionTime, 0) /
      (allAgents.length || 1);
    const slowAgents = allAgents.filter((a) => a.averageExecutionTime > avgTime * 1.5);
    if (slowAgents.length > 0) {
      insights.push({
        type: 'performance-issue',
        priority: 'medium',
        insight: `${slowAgents.length} agent(s) are slower than average`,
        actionable: true,
        recommendation: `Optimize or parallelize ${slowAgents[0].agentId} for faster execution`,
        confidence: 60,
      });
    }

    // Insight 4: Reliability issues
    const unreliableAgents = allAgents.filter((a) => a.successRate < 0.85);
    if (unreliableAgents.length > 0) {
      insights.push({
        type: 'reliability-concern',
        priority: 'high',
        insight: `${unreliableAgents.length} agent(s) have success rate below 85%`,
        actionable: true,
        recommendation: `Review error logs for ${unreliableAgents[0].agentId} and implement fixes`,
        confidence: 75,
      });
    }

    // Insight 5: Quality score trends
    const history = this.tracker.getExecutionHistory(100);
    if (history.length >= 10) {
      const firstHalf = history.slice(50, 100);
      const secondHalf = history.slice(0, 50);
      const firstAvg =
        firstHalf.reduce((sum, r) => sum + r.qualityScore, 0) /
        firstHalf.length;
      const secondAvg =
        secondHalf.reduce((sum, r) => sum + r.qualityScore, 0) /
        secondHalf.length;
      const improvement = secondAvg - firstAvg;

      if (improvement > 5) {
        insights.push({
          type: 'quality-improvement',
          priority: 'high',
          insight: `Quality scores improving: +${Math.round(improvement * 10) / 10} point increase`,
          actionable: false,
          recommendation: 'Continue current optimization efforts',
          confidence: 80,
        });
      } else if (improvement < -5) {
        insights.push({
          type: 'quality-regression',
          priority: 'high',
          insight: `Quality scores declining: ${Math.round(improvement * 10) / 10} point decrease`,
          actionable: true,
          recommendation: 'Investigate recent changes for quality regression',
          confidence: 80,
        });
      }
    }

    return insights;
  }

  /**
   * Generate recommendations based on insights
   */
  private generateRecommendations(): string[] {
    const recommendations: string[] = [];
    const allMetrics = this.tracker.getAllAgentMetrics();

    if (allMetrics.length === 0) {
      recommendations.push('Execute more workflows to build recommendation history');
      return recommendations;
    }

    // Recommendation 1: Use top agents
    const topAgent = allMetrics.reduce((best, current) =>
      current.successRate > best.successRate ? current : best
    );
    if (topAgent.successRate > 0.8) {
      recommendations.push(
        `Prioritize ${topAgent.agentId} for critical tasks (${Math.round(topAgent.successRate * 100)}% success rate)`
      );
    }

    // Recommendation 2: Parallel vs Sequential
    const strategies = this.tracker.getAllStrategyMetrics();
    const parallel = strategies.find((s) => s.strategyId === 'parallel');
    const sequential = strategies.find((s) => s.strategyId === 'sequential');
    if (
      parallel &&
      sequential &&
      parallel.recommendation > sequential.recommendation
    ) {
      recommendations.push('Use parallel execution strategy for faster workflows');
    } else if (sequential && sequential.recommendation > 60) {
      recommendations.push('Use sequential execution for improved quality');
    }

    // Recommendation 3: Improve reliability
    const unreliable = allMetrics.filter((a) => a.successRate < 0.8);
    if (unreliable.length > 0) {
      recommendations.push(
        `Improve reliability of ${unreliable[0].agentId}: ${Math.round((1 - unreliable[0].successRate) * 100)}% failure rate`
      );
    }

    // Recommendation 4: Optimization opportunity
    const slowAgent = allMetrics.reduce((slowest, current) =>
      current.averageExecutionTime > slowest.averageExecutionTime
        ? current
        : slowest
    );
    if (slowAgent.averageExecutionTime > 2000) {
      recommendations.push(
        `Optimize ${slowAgent.agentId} performance: ${Math.round(slowAgent.averageExecutionTime)}ms average`
      );
    }

    return recommendations.slice(0, 5); // Top 5 recommendations
  }

  /**
   * Analyze trends over time
   */
  analyzeTrends(metric: string = 'quality'): TrendAnalysis {
    const history = this.tracker.getExecutionHistory(1000);

    if (history.length < 10) {
      return {
        metric,
        direction: 'insufficient-data',
        percentageChange: 0,
        movingAverage: 0,
        volatility: 0,
        forecast: 0,
        confidence: 0,
      };
    }

    // Divide into periods
    const periodSize = Math.ceil(history.length / 4);
    const periods: number[][] = [];

    for (let i = 0; i < 4; i++) {
      const start = i * periodSize;
      const end = Math.min(start + periodSize, history.length);
      const periodData: number[] = [];

      for (let j = start; j < end; j++) {
        const record = history[history.length - 1 - j];
        if (metric === 'quality') {
          periodData.push(record.qualityScore);
        } else if (metric === 'execution-time') {
          periodData.push(record.executionTime);
        } else if (metric === 'success-rate') {
          periodData.push(record.success ? 100 : 0);
        }
      }

      if (periodData.length > 0) {
        periods.push(periodData);
      }
    }

    if (periods.length < 2) {
      return {
        metric,
        direction: 'insufficient-data',
        percentageChange: 0,
        movingAverage: 0,
        volatility: 0,
        forecast: 0,
        confidence: 0,
      };
    }

    // Calculate statistics
    const lastPeriodAvg =
      periods[periods.length - 1].reduce((a, b) => a + b, 0) /
      periods[periods.length - 1].length;
    const firstPeriodAvg =
      periods[0].reduce((a, b) => a + b, 0) / periods[0].length;

    const percentageChange = ((lastPeriodAvg - firstPeriodAvg) / firstPeriodAvg) * 100;

    // Calculate moving average
    const allValues = history.map((r) =>
      metric === 'quality'
        ? r.qualityScore
        : metric === 'execution-time'
          ? r.executionTime
          : r.success ? 100 : 0
    );
    const movingAverage =
      allValues.slice(-10).reduce((a, b) => a + b, 0) / 10;

    // Calculate volatility
    const variance =
      allValues
        .slice(-20)
        .reduce((sum, val) => sum + Math.pow(val - movingAverage, 2), 0) / 20;
    const volatility = Math.sqrt(variance);

    // Simple forecast (linear extrapolation)
    const forecast = lastPeriodAvg + (percentageChange / 100) * lastPeriodAvg;

    // Determine direction
    let direction: 'improving' | 'degrading' | 'stable' | 'insufficient-data' =
      'stable';
    if (Math.abs(percentageChange) > 5) {
      direction = percentageChange > 0 ? 'improving' : 'degrading';
    }

    // Calculate confidence
    const confidence = Math.min(100, history.length);

    return {
      metric,
      direction,
      percentageChange: Math.round(percentageChange * 100) / 100,
      movingAverage: Math.round(movingAverage * 100) / 100,
      volatility: Math.round(volatility * 100) / 100,
      forecast: Math.round(forecast * 100) / 100,
      confidence: Math.round(confidence),
    };
  }

  /**
   * Generate human-readable summary
   */
  private generateSummary(
    metrics: {
      totalExecutions: number;
      successRate: number;
      averageQualityScore: number;
      averageExecutionTime: number;
      topAgent: string;
      preferredStrategy: string;
    },
    insights: LearningInsight[]
  ): string {
    const parts: string[] = [];

    parts.push(`${metrics.totalExecutions} total executions`);
    parts.push(`${Math.round(metrics.successRate * 100)}% success rate`);
    parts.push(`${metrics.averageQualityScore}/100 average quality`);
    parts.push(`${Math.round(metrics.averageExecutionTime)}ms average time`);

    if (insights.length > 0) {
      const highPriority = insights.filter((i) => i.priority === 'high');
      if (highPriority.length > 0) {
        parts.push(`${highPriority.length} high priority insights`);
      }
    }

    return parts.join(' | ');
  }
}

export const createAnalyticsEngine = (
  tracker: PerformanceTracker
): AnalyticsEngine => {
  return new AnalyticsEngine(tracker);
};
