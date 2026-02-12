/**
 * Phase 11: Learning & Optimization Tests
 *
 * Comprehensive test suite for learning components
 */

import { PerformanceTracker } from './performanceTracker';
import { StrategyRecommender } from './strategyRecommender';
import { AnalyticsEngine } from './analyticsEngine';
import { LearningManager } from './learningManager';

// Simple test framework
let testsPassed = 0;
let testsFailed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(`✓ ${name}`);
    testsPassed++;
  } catch (error) {
    console.log(`✗ ${name}`);
    if (error instanceof Error) {
      console.log(`  Error: ${error.message}`);
    }
    testsFailed++;
  }
}

function assertEqual(actual: any, expected: any, message?: string) {
  if (actual !== expected) {
    throw new Error(
      message || `Expected ${expected} but got ${actual}`
    );
  }
}

function assertTrue(value: any, message?: string) {
  if (!value) {
    throw new Error(message || `Expected truthy value but got ${value}`);
  }
}

function assertDefined(value: any, message?: string) {
  if (value === undefined || value === null) {
    throw new Error(message || `Expected value to be defined`);
  }
}

// ============================================================================
// TESTS
// ============================================================================

console.log('\n=== PHASE 11 LEARNING & OPTIMIZATION TESTS ===\n');

// Test: PerformanceTracker
console.log('ΓåÆ PerformanceTracker Tests');

let tracker = new PerformanceTracker();
test('Record execution and update agent metrics', () => {
  const record = tracker.recordExecution(
    ['agent-1'],
    'sequential',
    100,
    85,
    true
  );
  assertDefined(record);
  assertEqual(record.success, true);

  const metrics = tracker.getAgentMetrics('agent-1');
  assertDefined(metrics);
  assertEqual(metrics!.totalExecutions, 1);
  assertEqual(metrics!.successfulExecutions, 1);
  assertEqual(metrics!.averageQualityScore, 85);
});

tracker.clear();
test('Track multiple agents in single execution', () => {
  tracker.recordExecution(['agent-1', 'agent-2'], 'parallel', 150, 80, true);

  const m1 = tracker.getAgentMetrics('agent-1');
  const m2 = tracker.getAgentMetrics('agent-2');

  assertDefined(m1);
  assertDefined(m2);
  assertEqual(m1!.totalExecutions, 1);
  assertEqual(m2!.totalExecutions, 1);
});

tracker.clear();
test('Calculate success rates correctly', () => {
  tracker.recordExecution(['agent-1'], 'sequential', 100, 85, true);
  tracker.recordExecution(['agent-1'], 'sequential', 110, 75, false);
  tracker.recordExecution(['agent-1'], 'sequential', 105, 80, true);

  const metrics = tracker.getAgentMetrics('agent-1');
  assertDefined(metrics);
  assertTrue(
    metrics!.successRate > 0.6 && metrics!.successRate < 0.7,
    `Success rate should be ~0.667`
  );
  assertEqual(metrics!.successfulExecutions, 2);
  assertEqual(metrics!.failedExecutions, 1);
});

tracker.clear();
test('Update strategy metrics', () => {
  tracker.recordExecution(['agent-1', 'agent-2'], 'parallel', 100, 85, true);
  tracker.recordExecution(['agent-1', 'agent-2'], 'parallel', 110, 87, true);

  const metrics = tracker.getStrategyMetrics('parallel', [
    'agent-1',
    'agent-2',
  ]);
  assertDefined(metrics);
  assertEqual(metrics!.executionCount, 2);
  assertEqual(metrics!.successRate, 1);
});

tracker.clear();
test('Calculate strategy recommendation score', () => {
  for (let i = 0; i < 5; i++) {
    tracker.recordExecution(['agent-1'], 'parallel', 500, 90, true);
  }

  const metrics = tracker.getStrategyMetrics('parallel', ['agent-1']);
  assertDefined(metrics);
  assertTrue(
    metrics!.recommendation > 60,
    'Recommendation should be > 60 for successful strategy'
  );
});

tracker.clear();
test('Get execution history with filtering', () => {
  tracker.recordExecution(['agent-1'], 'sequential', 100, 85, true);
  tracker.recordExecution(['agent-2'], 'parallel', 110, 80, true);
  tracker.recordExecution(['agent-1'], 'adaptive', 105, 88, true);

  const all = tracker.getExecutionHistory(10);
  assertEqual(all.length, 3);

  const agent1Only = tracker.getExecutionHistory(10, 'agent-1');
  assertEqual(agent1Only.length, 2);

  const parallelOnly = tracker.getExecutionHistory(10, undefined, 'parallel');
  assertEqual(parallelOnly.length, 1);
});

tracker.clear();
test('Get top agents by performance', () => {
  for (let i = 0; i < 10; i++) {
    tracker.recordExecution(['agent-1'], 'sequential', 100, 90, true);
  }
  for (let i = 0; i < 10; i++) {
    tracker.recordExecution(['agent-2'], 'sequential', 100, 70, i % 2 === 0);
  }

  const top = tracker.getTopAgents(1);
  assertEqual(top[0].agentId, 'agent-1');
});

tracker.clear();
test('Provide agent success rate query', () => {
  tracker.recordExecution(['agent-1'], 'sequential', 100, 85, true);
  tracker.recordExecution(['agent-1'], 'sequential', 100, 85, false);

  const rate = tracker.getAgentSuccessRate('agent-1');
  assertEqual(rate, 0.5);
});

console.log();

// Test: StrategyRecommender
console.log('ΓåÆ StrategyRecommender Tests');

tracker = new PerformanceTracker();
const recommender = new StrategyRecommender(tracker);

// Build history
for (let i = 0; i < 10; i++) {
  tracker.recordExecution(['agent-1'], 'sequential', 200 + i * 10, 85 + i, i < 8);
  tracker.recordExecution(['agent-1'], 'parallel', 100 + i * 5, 80 + i, i < 9);
}

test('Recommend best strategy based on history', () => {
  const rec = recommender.recommendStrategy(['agent-1']);
  assertDefined(rec.recommendedStrategy);
  assertTrue(
    ['sequential', 'parallel', 'adaptive'].includes(rec.recommendedStrategy)
  );
});

test('Include confidence score', () => {
  const rec = recommender.recommendStrategy(['agent-1']);
  assertTrue(rec.confidence >= 0);
  assertTrue(rec.confidence <= 100);
});

test('Predict execution time', () => {
  const rec = recommender.recommendStrategy(['agent-1']);
  assertTrue(rec.expectedExecutionTime > 0);
});

test('Predict quality score', () => {
  const rec = recommender.recommendStrategy(['agent-1']);
  assertTrue(rec.expectedQualityScore > 0);
  assertTrue(rec.expectedQualityScore <= 100);
});

test('Provide reasoning', () => {
  const rec = recommender.recommendStrategy(['agent-1']);
  assertTrue(rec.reasoning.length > 0);
  assertEqual(typeof rec.reasoning[0], 'string');
});

test('Prioritize speed when requested', () => {
  const rec = recommender.recommendStrategy(['agent-1'], {
    priority: 'speed',
  });
  assertDefined(rec.recommendedStrategy);
  assertTrue(rec.reasoning.some((r) => r.includes('speed') || r.includes('fast')));
});

test('Compare multiple strategies', () => {
  const comparison = recommender.compareStrategies(['agent-1']);
  assertTrue(comparison.length > 0);
  assertDefined(comparison[0].recommendation);
});

console.log();

// Test: AnalyticsEngine
console.log('ΓåÆ AnalyticsEngine Tests');

tracker = new PerformanceTracker();
const analytics = new AnalyticsEngine(tracker);

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

test('Generate comprehensive performance report', () => {
  const report = analytics.generatePerformanceReport();
  assertDefined(report.timestamp);
  assertDefined(report.metrics);
  assertDefined(report.insights);
  assertDefined(report.recommendations);
});

test('Include metrics in report', () => {
  const report = analytics.generatePerformanceReport();
  assertEqual(report.metrics.totalExecutions, 20);
  assertTrue(report.metrics.successRate > 0);
  assertTrue(report.metrics.averageQualityScore > 0);
  assertTrue(report.metrics.averageExecutionTime > 0);
});

test('Generate actionable insights', () => {
  const report = analytics.generatePerformanceReport();
  assertTrue(report.insights.length > 0);

  const insight = report.insights[0];
  assertDefined(insight.type);
  assertDefined(insight.priority);
  assertTrue(
    ['high', 'medium', 'low'].includes(insight.priority)
  );
  assertDefined(insight.insight);
  assertTrue(typeof insight.actionable === 'boolean');
  assertTrue(insight.confidence >= 0);
});

test('Generate recommendations', () => {
  const report = analytics.generatePerformanceReport();
  assertTrue(report.recommendations.length > 0);
  assertEqual(typeof report.recommendations[0], 'string');
});

test('Analyze quality trends', () => {
  const trend = analytics.analyzeTrends('quality');
  assertEqual(trend.metric, 'quality');
  assertDefined(trend.direction);
  assertTrue(
    ['improving', 'degrading', 'stable', 'insufficient-data'].includes(
      trend.direction
    )
  );
  assertDefined(trend.percentageChange);
  assertTrue(trend.movingAverage >= 0);
  assertTrue(trend.volatility >= 0);
});

test('Analyze execution time trends', () => {
  const trend = analytics.analyzeTrends('execution-time');
  assertEqual(trend.metric, 'execution-time');
  assertTrue(trend.forecast > 0);
});

console.log();

// Test: LearningManager
console.log('ΓåÆ LearningManager Tests');

let manager = new LearningManager();

for (let i = 0; i < 15; i++) {
  manager.recordExecution(
    [i % 2 === 0 ? 'agent-1' : 'agent-2'],
    i % 3 === 0 ? 'sequential' : 'parallel',
    100 + Math.random() * 100,
    75 + Math.random() * 20,
    Math.random() > 0.15
  );
}

test('Record executions', () => {
  const record = manager.recordExecution(
    ['agent-1'],
    'sequential',
    100,
    85,
    true
  );
  assertDefined(record);
  assertEqual(record.success, true);
});

test('Recommend strategies', () => {
  const rec = manager.recommendStrategy(['agent-1', 'agent-2']);
  assertDefined(rec.recommendedStrategy);
  assertTrue(rec.confidence > 0);
});

test('Generate comprehensive reports', () => {
  const report = manager.generateReport();
  assertDefined(report.metrics);
  assertDefined(report.insights);
  assertDefined(report.recommendations);
});

test('Provide execution history', () => {
  const history = manager.getHistory(5);
  assertTrue(history.length > 0);
  assertTrue(history.length <= 5);
});

test('Compare strategies', () => {
  const comparison = manager.compareStrategies(['agent-1']);
  assertTrue(comparison.length > 0);
});

test('Analyze trends', () => {
  const trend = manager.analyzeTrends('quality');
  assertDefined(trend.metric);
  assertDefined(trend.direction);
});

test('Provide statistics', () => {
  const stats = manager.getStats();
  assertTrue(stats.totalExecutions >= 15, `Should have at least 15 executions, got ${stats.totalExecutions}`);
  assertTrue(stats.agentCount > 0);
  assertTrue(stats.strategyCount > 0);
  assertTrue(stats.averageSuccessRate > 0);
  assertTrue(stats.averageQualityScore > 0);
});

test('Export learning data', () => {
  const exported = manager.export();
  assertDefined(exported.executionHistory);
  assertDefined(exported.agentMetrics);
  assertDefined(exported.strategyMetrics);
  assertTrue(exported.executionHistory.length >= 15, `Should have at least 15 executions, got ${exported.executionHistory.length}`);
});

console.log();

// Test: Integration
console.log('ΓåÆ Integration Tests');

manager = new LearningManager();

test('Support complete learning workflow', () => {
  for (let i = 0; i < 10; i++) {
    manager.recordExecution(
      ['analyzer-1', 'processor-1'],
      i % 2 === 0 ? 'sequential' : 'parallel',
      150 + Math.random() * 100,
      80 + Math.random() * 15,
      Math.random() > 0.1
    );
  }

  const rec = manager.recommendStrategy(['analyzer-1', 'processor-1']);
  assertDefined(rec.recommendedStrategy);

  const report = manager.generateReport();
  assertEqual(report.metrics.totalExecutions, 10);

  const trend = manager.analyzeTrends('quality');
  assertDefined(trend);

  const stats = manager.getStats();
  assertEqual(stats.totalExecutions, 10);
});

test('Learn from repeated executions', () => {
  manager.clear();

  for (let i = 0; i < 5; i++) {
    manager.recordExecution(['agent-1'], 'sequential', 200, 90, true);
  }
  for (let i = 0; i < 5; i++) {
    manager.recordExecution(['agent-1'], 'parallel', 100, 75, true);
  }

  const rec = manager.recommendStrategy(['agent-1'], { priority: 'quality' });
  assertTrue(rec.expectedQualityScore > 70);
});

test('Track multiple agents and strategies', () => {
  manager.clear();

  const configs = [
    { agents: ['agent-1'], strategy: 'sequential' },
    { agents: ['agent-2'], strategy: 'parallel' },
    { agents: ['agent-1', 'agent-2'], strategy: 'adaptive' },
  ];

  for (const config of configs) {
    for (let i = 0; i < 5; i++) {
      manager.recordExecution(config.agents, config.strategy, 150, 80, true);
    }
  }

  const stats = manager.getStats();
  assertEqual(stats.agentCount, 2);
  assertTrue(stats.strategyCount > 0);
});

console.log();

// Summary
console.log('═══════════════════════════════════════════════');
if (testsFailed === 0) {
  console.log(`Γ£à All tests passed! ${testsPassed}/${testsPassed}`);
} else {
  console.log(
    `Γ£ù Tests failed: ${testsFailed}/${testsPassed + testsFailed}`
  );
}
console.log('═══════════════════════════════════════════════\n');

process.exit(testsFailed > 0 ? 1 : 0);
