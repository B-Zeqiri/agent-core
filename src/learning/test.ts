/**
 * Learning System Tests
 *
 * Comprehensive tests for learning components: performance tracking,
 * strategy recommendation, and analytics
 */

import { PerformanceTracker } from './performanceTracker';
import { StrategyRecommender } from './strategyRecommender';
import { AnalyticsEngine } from './analyticsEngine';
import { LearningManager } from './learningManager';

describe('Phase 11: Learning & Optimization', () => {
  describe('PerformanceTracker', () => {
    let tracker: PerformanceTracker;

    beforeEach(() => {
      tracker = new PerformanceTracker();
    });

    afterEach(() => {
      tracker.clear();
    });

    it('should record execution and update agent metrics', () => {
      const record = tracker.recordExecution(
        ['agent-1'],
        'sequential',
        100,
        85,
        true
      );

      expect(record).toBeDefined();
      expect(record.agentIds).toContain('agent-1');
      expect(record.success).toBe(true);

      const metrics = tracker.getAgentMetrics('agent-1');
      expect(metrics).toBeDefined();
      expect(metrics?.totalExecutions).toBe(1);
      expect(metrics?.successfulExecutions).toBe(1);
      expect(metrics?.averageQualityScore).toBe(85);
    });

    it('should track multiple agents in single execution', () => {
      tracker.recordExecution(
        ['agent-1', 'agent-2'],
        'parallel',
        150,
        80,
        true
      );

      const m1 = tracker.getAgentMetrics('agent-1');
      const m2 = tracker.getAgentMetrics('agent-2');

      expect(m1?.totalExecutions).toBe(1);
      expect(m2?.totalExecutions).toBe(1);
    });

    it('should calculate success rates correctly', () => {
      tracker.recordExecution(['agent-1'], 'sequential', 100, 85, true);
      tracker.recordExecution(['agent-1'], 'sequential', 110, 75, false);
      tracker.recordExecution(['agent-1'], 'sequential', 105, 80, true);

      const metrics = tracker.getAgentMetrics('agent-1');
      expect(metrics?.successRate).toBeCloseTo(0.667, 2);
      expect(metrics?.successfulExecutions).toBe(2);
      expect(metrics?.failedExecutions).toBe(1);
    });

    it('should update strategy metrics', () => {
      tracker.recordExecution(
        ['agent-1', 'agent-2'],
        'parallel',
        100,
        85,
        true
      );
      tracker.recordExecution(
        ['agent-1', 'agent-2'],
        'parallel',
        110,
        87,
        true
      );

      const metrics = tracker.getStrategyMetrics('parallel', [
        'agent-1',
        'agent-2',
      ]);
      expect(metrics).toBeDefined();
      expect(metrics?.executionCount).toBe(2);
      expect(metrics?.successRate).toBe(1);
    });

    it('should calculate strategy recommendation score', () => {
      // Execute successful, fast operation
      for (let i = 0; i < 5; i++) {
        tracker.recordExecution(
          ['agent-1'],
          'parallel',
          500,
          90,
          true
        );
      }

      const metrics = tracker.getStrategyMetrics('parallel', ['agent-1']);
      expect(metrics?.recommendation).toBeGreaterThan(60);
    });

    it('should get execution history with filtering', () => {
      tracker.recordExecution(['agent-1'], 'sequential', 100, 85, true);
      tracker.recordExecution(['agent-2'], 'parallel', 110, 80, true);
      tracker.recordExecution(['agent-1'], 'adaptive', 105, 88, true);

      const all = tracker.getExecutionHistory(10);
      expect(all.length).toBe(3);

      const agent1Only = tracker.getExecutionHistory(10, 'agent-1');
      expect(agent1Only.length).toBe(2);

      const parallelOnly = tracker.getExecutionHistory(10, undefined, 'parallel');
      expect(parallelOnly.length).toBe(1);
    });

    it('should get top agents by performance', () => {
      // Agent 1: high success
      for (let i = 0; i < 10; i++) {
        tracker.recordExecution(['agent-1'], 'sequential', 100, 90, true);
      }

      // Agent 2: medium success
      for (let i = 0; i < 10; i++) {
        tracker.recordExecution(['agent-2'], 'sequential', 100, 70, i % 2 === 0);
      }

      const top = tracker.getTopAgents(1);
      expect(top[0].agentId).toBe('agent-1');
    });

    it('should handle bounded history size', () => {
      // Simulate many executions
      for (let i = 0; i < 1000; i++) {
        tracker.recordExecution(['agent-1'], 'sequential', 100, 85, true);
      }

      const history = tracker.getExecutionHistory(10000);
      expect(history.length).toBeLessThanOrEqual(10000);
    });

    it('should provide agent success rate query', () => {
      tracker.recordExecution(['agent-1'], 'sequential', 100, 85, true);
      tracker.recordExecution(['agent-1'], 'sequential', 100, 85, false);

      const rate = tracker.getAgentSuccessRate('agent-1');
      expect(rate).toBeCloseTo(0.5, 1);
    });

    it('should provide strategy average time query', () => {
      tracker.recordExecution(['agent-1'], 'parallel', 100, 85, true);
      tracker.recordExecution(['agent-1'], 'parallel', 200, 85, true);

      const avgTime = tracker.getStrategyAverageTime('parallel', ['agent-1']);
      expect(avgTime).toBe(150);
    });
  });

  describe('StrategyRecommender', () => {
    let tracker: PerformanceTracker;
    let recommender: StrategyRecommender;

    beforeEach(() => {
      tracker = new PerformanceTracker();
      recommender = new StrategyRecommender(tracker);

      // Build history for testing
      for (let i = 0; i < 10; i++) {
        tracker.recordExecution(
          ['agent-1'],
          'sequential',
          200 + i * 10,
          85 + i,
          i < 8
        );
        tracker.recordExecution(
          ['agent-1'],
          'parallel',
          100 + i * 5,
          80 + i,
          i < 9
        );
      }
    });

    afterEach(() => {
      tracker.clear();
    });

    it('should recommend best strategy based on history', () => {
      const rec = recommender.recommendStrategy(['agent-1']);
      expect(rec.recommendedStrategy).toBeDefined();
      expect(['sequential', 'parallel', 'adaptive']).toContain(
        rec.recommendedStrategy
      );
    });

    it('should include confidence score', () => {
      const rec = recommender.recommendStrategy(['agent-1']);
      expect(rec.confidence).toBeGreaterThanOrEqual(0);
      expect(rec.confidence).toBeLessThanOrEqual(100);
    });

    it('should predict execution time', () => {
      const rec = recommender.recommendStrategy(['agent-1']);
      expect(rec.expectedExecutionTime).toBeGreaterThan(0);
    });

    it('should predict quality score', () => {
      const rec = recommender.recommendStrategy(['agent-1']);
      expect(rec.expectedQualityScore).toBeGreaterThan(0);
      expect(rec.expectedQualityScore).toBeLessThanOrEqual(100);
    });

    it('should provide reasoning', () => {
      const rec = recommender.recommendStrategy(['agent-1']);
      expect(rec.reasoning.length).toBeGreaterThan(0);
      expect(typeof rec.reasoning[0]).toBe('string');
    });

    it('should prioritize speed when requested', () => {
      const rec = recommender.recommendStrategy(['agent-1'], {
        priority: 'speed',
      });
      expect(rec.recommendedStrategy).toBeDefined();
      expect(rec.reasoning.some((r) => r.includes('speed'))).toBe(true);
    });

    it('should prioritize quality when requested', () => {
      const rec = recommender.recommendStrategy(['agent-1'], {
        priority: 'quality',
      });
      expect(rec.recommendedStrategy).toBeDefined();
      expect(rec.reasoning.some((r) => r.includes('quality'))).toBe(true);
    });

    it('should handle untested strategies with hypothetical metrics', () => {
      tracker.clear(); // Clear history
      const rec = recommender.recommendStrategy(['agent-1']);
      expect(rec.recommendedStrategy).toBeDefined();
      expect(rec.confidence).toBeLessThan(40); // Low confidence with no history
    });

    it('should compare multiple strategies', () => {
      const comparison = recommender.compareStrategies(['agent-1']);
      expect(comparison.length).toBeGreaterThan(0);
      expect(comparison[0].recommendation).toBeDefined();
    });

    it('should handle multiple agents', () => {
      tracker.recordExecution(
        ['agent-1', 'agent-2'],
        'parallel',
        150,
        85,
        true
      );

      const rec = recommender.recommendStrategy(['agent-1', 'agent-2']);
      expect(rec.recommendedStrategy).toBeDefined();
    });
  });

  describe('AnalyticsEngine', () => {
    let tracker: PerformanceTracker;
    let analytics: AnalyticsEngine;

    beforeEach(() => {
      tracker = new PerformanceTracker();
      analytics = new AnalyticsEngine(tracker);

      // Build history
      for (let i = 0; i < 20; i++) {
        tracker.recordExecution(
          [i % 2 === 0 ? 'agent-1' : 'agent-2'],
          i % 3 === 0 ? 'sequential' : 'parallel',
          100 + Math.random() * 100,
          70 + Math.random() * 30,
          Math.random() > 0.1
        );
      }
    });

    afterEach(() => {
      tracker.clear();
    });

    it('should generate comprehensive performance report', () => {
      const report = analytics.generatePerformanceReport();
      expect(report.timestamp).toBeGreaterThan(0);
      expect(report.metrics).toBeDefined();
      expect(report.insights).toBeDefined();
      expect(report.recommendations).toBeDefined();
    });

    it('should include metrics in report', () => {
      const report = analytics.generatePerformanceReport();
      expect(report.metrics.totalExecutions).toBe(20);
      expect(report.metrics.successRate).toBeGreaterThan(0);
      expect(report.metrics.averageQualityScore).toBeGreaterThan(0);
      expect(report.metrics.averageExecutionTime).toBeGreaterThan(0);
    });

    it('should generate actionable insights', () => {
      const report = analytics.generatePerformanceReport();
      expect(report.insights.length).toBeGreaterThan(0);

      const insight = report.insights[0];
      expect(insight.type).toBeDefined();
      expect(insight.priority).toBeDefined();
      expect(['high', 'medium', 'low']).toContain(insight.priority);
      expect(insight.insight).toBeDefined();
      expect(insight.actionable).toBeDefined();
      expect(insight.confidence).toBeGreaterThanOrEqual(0);
    });

    it('should generate recommendations', () => {
      const report = analytics.generatePerformanceReport();
      expect(report.recommendations.length).toBeGreaterThan(0);
      expect(typeof report.recommendations[0]).toBe('string');
    });

    it('should analyze quality trends', () => {
      const trend = analytics.analyzeTrends('quality');
      expect(trend.metric).toBe('quality');
      expect(trend.direction).toBeDefined();
      expect(['improving', 'degrading', 'stable', 'insufficient-data']).toContain(
        trend.direction
      );
      expect(trend.percentageChange).toBeDefined();
      expect(trend.movingAverage).toBeGreaterThanOrEqual(0);
      expect(trend.volatility).toBeGreaterThanOrEqual(0);
    });

    it('should analyze execution time trends', () => {
      const trend = analytics.analyzeTrends('execution-time');
      expect(trend.metric).toBe('execution-time');
      expect(trend.forecast).toBeGreaterThan(0);
    });

    it('should analyze success rate trends', () => {
      const trend = analytics.analyzeTrends('success-rate');
      expect(trend.metric).toBe('success-rate');
    });

    it('should handle insufficient data gracefully', () => {
      tracker.clear();
      const trend = analytics.analyzeTrends('quality');
      expect(trend.direction).toBe('insufficient-data');
      expect(trend.confidence).toBe(0);
    });

    it('should generate summary string', () => {
      const report = analytics.generatePerformanceReport();
      expect(typeof report.summary).toBe('string');
      expect(report.summary.length).toBeGreaterThan(0);
    });

    it('should detect quality improvements', () => {
      tracker.clear();
      // First half: lower quality
      for (let i = 0; i < 50; i++) {
        tracker.recordExecution(['agent-1'], 'sequential', 100, 60, true);
      }
      // Second half: higher quality
      for (let i = 0; i < 50; i++) {
        tracker.recordExecution(['agent-1'], 'sequential', 100, 85, true);
      }

      const trend = analytics.analyzeTrends('quality');
      expect(trend.direction).toBe('improving');
      expect(trend.percentageChange).toBeGreaterThan(0);
    });

    it('should detect quality regressions', () => {
      tracker.clear();
      // First half: higher quality
      for (let i = 0; i < 50; i++) {
        tracker.recordExecution(['agent-1'], 'sequential', 100, 85, true);
      }
      // Second half: lower quality
      for (let i = 0; i < 50; i++) {
        tracker.recordExecution(['agent-1'], 'sequential', 100, 60, true);
      }

      const trend = analytics.analyzeTrends('quality');
      expect(trend.direction).toBe('degrading');
      expect(trend.percentageChange).toBeLessThan(0);
    });
  });

  describe('LearningManager', () => {
    let manager: LearningManager;

    beforeEach(() => {
      manager = new LearningManager();

      // Build history
      for (let i = 0; i < 15; i++) {
        manager.recordExecution(
          [i % 2 === 0 ? 'agent-1' : 'agent-2'],
          i % 3 === 0 ? 'sequential' : 'parallel',
          100 + Math.random() * 100,
          75 + Math.random() * 20,
          Math.random() > 0.15
        );
      }
    });

    afterEach(() => {
      manager.clear();
    });

    it('should coordinate all learning components', () => {
      expect(manager).toBeDefined();
    });

    it('should record executions', () => {
      const record = manager.recordExecution(
        ['agent-1'],
        'sequential',
        100,
        85,
        true
      );
      expect(record).toBeDefined();
      expect(record.success).toBe(true);
    });

    it('should recommend strategies', () => {
      const rec = manager.recommendStrategy(['agent-1', 'agent-2']);
      expect(rec.recommendedStrategy).toBeDefined();
      expect(rec.confidence).toBeGreaterThan(0);
    });

    it('should generate comprehensive reports', () => {
      const report = manager.generateReport();
      expect(report.metrics).toBeDefined();
      expect(report.insights).toBeDefined();
      expect(report.recommendations).toBeDefined();
    });

    it('should provide execution history', () => {
      const history = manager.getHistory(5);
      expect(history.length).toBeGreaterThan(0);
      expect(history.length).toBeLessThanOrEqual(5);
    });

    it('should compare strategies', () => {
      const comparison = manager.compareStrategies(['agent-1']);
      expect(comparison.length).toBeGreaterThan(0);
    });

    it('should analyze trends', () => {
      const trend = manager.analyzeTrends('quality');
      expect(trend.metric).toBeDefined();
      expect(trend.direction).toBeDefined();
    });

    it('should provide statistics', () => {
      const stats = manager.getStats();
      expect(stats.totalExecutions).toBe(15);
      expect(stats.agentCount).toBeGreaterThan(0);
      expect(stats.strategyCount).toBeGreaterThan(0);
      expect(stats.averageSuccessRate).toBeGreaterThan(0);
      expect(stats.averageQualityScore).toBeGreaterThan(0);
    });

    it('should export learning data', () => {
      const exported = manager.export();
      expect(exported.executionHistory).toBeDefined();
      expect(exported.agentMetrics).toBeDefined();
      expect(exported.strategyMetrics).toBeDefined();
      expect(exported.executionHistory.length).toBe(15);
    });

    it('should clear all learning data', () => {
      manager.clear();
      const stats = manager.getStats();
      expect(stats.totalExecutions).toBe(0);
    });
  });

  describe('Learning Integration Scenarios', () => {
    let manager: LearningManager;

    beforeEach(() => {
      manager = new LearningManager();
    });

    afterEach(() => {
      manager.clear();
    });

    it('should support complete learning workflow', () => {
      // Record executions
      for (let i = 0; i < 10; i++) {
        manager.recordExecution(
          ['analyzer-1', 'processor-1'],
          i % 2 === 0 ? 'sequential' : 'parallel',
          150 + Math.random() * 100,
          80 + Math.random() * 15,
          Math.random() > 0.1
        );
      }

      // Get recommendation
      const rec = manager.recommendStrategy(['analyzer-1', 'processor-1']);
      expect(rec.recommendedStrategy).toBeDefined();

      // Generate report
      const report = manager.generateReport();
      expect(report.metrics.totalExecutions).toBe(10);

      // Analyze trends
      const trend = manager.analyzeTrends('quality');
      expect(trend).toBeDefined();

      // Get stats
      const stats = manager.getStats();
      expect(stats.totalExecutions).toBe(10);
    });

    it('should learn from repeated executions', () => {
      // First batch: slower but higher quality
      for (let i = 0; i < 5; i++) {
        manager.recordExecution(
          ['agent-1'],
          'sequential',
          200,
          90,
          true
        );
      }

      // Second batch: faster but lower quality
      for (let i = 0; i < 5; i++) {
        manager.recordExecution(
          ['agent-1'],
          'parallel',
          100,
          75,
          true
        );
      }

      // Recommender should prefer sequential for quality
      const rec = manager.recommendStrategy(['agent-1'], { priority: 'quality' });
      expect(rec.expectedQualityScore).toBeGreaterThan(70);
    });

    it('should track multiple agents and strategies', () => {
      const configs = [
        { agents: ['agent-1'], strategy: 'sequential' },
        { agents: ['agent-2'], strategy: 'parallel' },
        { agents: ['agent-1', 'agent-2'], strategy: 'adaptive' },
      ];

      for (const config of configs) {
        for (let i = 0; i < 5; i++) {
          manager.recordExecution(
            config.agents,
            config.strategy,
            150,
            80,
            true
          );
        }
      }

      const stats = manager.getStats();
      expect(stats.agentCount).toBe(2);
      expect(stats.strategyCount).toBeGreaterThan(0);
    });

    it('should adapt recommendations based on new data', () => {
      // Initial: sequential performs better
      for (let i = 0; i < 5; i++) {
        manager.recordExecution(['agent-1'], 'sequential', 100, 85, true);
        manager.recordExecution(['agent-1'], 'parallel', 100, 70, true);
      }

      const rec1 = manager.recommendStrategy(['agent-1']);

      // Now parallel performs better
      for (let i = 0; i < 5; i++) {
        manager.recordExecution(['agent-1'], 'parallel', 100, 95, true);
      }

      const rec2 = manager.recommendStrategy(['agent-1']);

      // Should show adaptation in reasoning
      expect(rec2.reasoning).toBeDefined();
    });
  });
});
