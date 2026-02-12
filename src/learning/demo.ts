/**
 * Phase 11 Learning & Optimization - Interactive Demo
 *
 * Demonstrates the learning system in action
 */

import { learningManager } from './learningManager';

async function runDemo() {
  console.log('\n╔════════════════════════════════════════════════════════════════╗');
  console.log('║     PHASE 11: LEARNING & OPTIMIZATION - INTERACTIVE DEMO     ║');
  console.log('╚════════════════════════════════════════════════════════════════╝\n');

  // Phase 1: Record some executions
  console.log('📊 PHASE 1: Recording Execution History...\n');

  const scenarios = [
    // Scenario 1: Sequential strategy with agents 1 and 2
    {
      name: 'Sequential: High Quality',
      agents: ['agent-1', 'agent-2'],
      strategy: 'sequential',
      executions: 10,
      baseTime: 200,
      baseQuality: 88,
      successRate: 0.95,
    },
    // Scenario 2: Parallel strategy (faster but lower quality)
    {
      name: 'Parallel: Fast Execution',
      agents: ['agent-1', 'agent-2'],
      strategy: 'parallel',
      executions: 10,
      baseTime: 120,
      baseQuality: 78,
      successRate: 0.90,
    },
    // Scenario 3: Adaptive strategy (balanced)
    {
      name: 'Adaptive: Balanced Approach',
      agents: ['agent-1', 'agent-2'],
      strategy: 'adaptive',
      executions: 5,
      baseTime: 150,
      baseQuality: 83,
      successRate: 0.92,
    },
    // Scenario 4: Single agent (fast but less capable)
    {
      name: 'Single Agent: Fast',
      agents: ['agent-1'],
      strategy: 'sequential',
      executions: 8,
      baseTime: 80,
      baseQuality: 72,
      successRate: 0.88,
    },
  ];

  for (const scenario of scenarios) {
    console.log(`  ▶ ${scenario.name}`);
    for (let i = 0; i < scenario.executions; i++) {
      const time = scenario.baseTime + Math.random() * 50 - 25;
      const quality = scenario.baseQuality + Math.random() * 10 - 5;
      const success = Math.random() < scenario.successRate;

      learningManager.recordExecution(
        scenario.agents,
        scenario.strategy,
        Math.round(time),
        Math.round(quality * 10) / 10,
        success
      );
    }
    console.log(`    ✓ Recorded ${scenario.executions} executions\n`);
  }

  // Phase 2: Get Strategy Recommendations
  console.log('💡 PHASE 2: Strategy Recommendations\n');

  const testAgents = ['agent-1', 'agent-2'];

  console.log('  🎯 Quality Priority:');
  const qualityRec = learningManager.recommendStrategy(testAgents, {
    priority: 'quality',
  });
  console.log(`    Recommended: ${qualityRec.recommendedStrategy}`);
  console.log(`    Confidence: ${qualityRec.confidence}%`);
  console.log(`    Expected Quality: ${qualityRec.expectedQualityScore}/100`);
  console.log(`    Expected Time: ${qualityRec.expectedExecutionTime}ms`);
  console.log(`    Reasoning:`);
  qualityRec.reasoning.forEach((r) => console.log(`      • ${r}\n`));

  console.log('  ⚡ Speed Priority:');
  const speedRec = learningManager.recommendStrategy(testAgents, {
    priority: 'speed',
  });
  console.log(`    Recommended: ${speedRec.recommendedStrategy}`);
  console.log(`    Confidence: ${speedRec.confidence}%`);
  console.log(`    Expected Time: ${speedRec.expectedExecutionTime}ms`);
  console.log(`    Expected Quality: ${speedRec.expectedQualityScore}/100\n`);

  console.log('⚖️  Balanced Priority:');
  const balancedRec = learningManager.recommendStrategy(testAgents, {
    priority: 'balanced',
  });
  console.log(`    Recommended: ${balancedRec.recommendedStrategy}`);
  console.log(`    Confidence: ${balancedRec.confidence}%\n`);

  // Phase 3: Generate Report
  console.log('📈 PHASE 3: Performance Report\n');

  const report = learningManager.generateReport();

  console.log('  📊 Metrics:');
  console.log(`    Total Executions: ${report.metrics.totalExecutions}`);
  console.log(
    `    Success Rate: ${(report.metrics.successRate * 100).toFixed(1)}%`
  );
  console.log(
    `    Average Quality: ${report.metrics.averageQualityScore.toFixed(1)}/100`
  );
  console.log(
    `    Average Time: ${report.metrics.averageExecutionTime.toFixed(0)}ms\n`
  );

  console.log('  💡 Key Insights:');
  report.insights.slice(0, 3).forEach((insight, i) => {
    console.log(`    ${i + 1}. ${insight.insight}`);
    console.log(`       Priority: ${insight.priority}`);
    if (insight.actionable) {
      console.log(`       Action: ${insight.recommendation}`);
    }
    console.log(`       Confidence: ${insight.confidence}%\n`);
  });

  console.log('  🎯 Top Recommendations:');
  report.recommendations.slice(0, 3).forEach((rec, i) => {
    console.log(`    ${i + 1}. ${rec}`);
  });
  console.log();

  // Phase 4: Trend Analysis
  console.log('📉 PHASE 4: Trend Analysis\n');

  const qualityTrend = learningManager.analyzeTrends('quality');
  const timeTrend = learningManager.analyzeTrends('execution-time');
  const successTrend = learningManager.analyzeTrends('success-rate');

  console.log('  📊 Quality Trends:');
  console.log(`    Direction: ${qualityTrend.direction}`);
  console.log(
    `    Change: ${qualityTrend.percentageChange > 0 ? '+' : ''}${qualityTrend.percentageChange.toFixed(1)}%`
  );
  console.log(`    Moving Average: ${qualityTrend.movingAverage.toFixed(1)}/100`);
  console.log(`    Volatility: ${qualityTrend.volatility.toFixed(2)}`);
  console.log(`    Forecast: ${qualityTrend.forecast.toFixed(1)}/100\n`);

  console.log('  ⚡ Execution Time Trends:');
  console.log(`    Direction: ${timeTrend.direction}`);
  console.log(
    `    Change: ${timeTrend.percentageChange > 0 ? '+' : ''}${timeTrend.percentageChange.toFixed(1)}%`
  );
  console.log(`    Moving Average: ${timeTrend.movingAverage.toFixed(0)}ms`);
  console.log(`    Forecast: ${timeTrend.forecast.toFixed(0)}ms\n`);

  console.log('  ✅ Success Rate Trends:');
  console.log(`    Direction: ${successTrend.direction}`);
  console.log(
    `    Change: ${successTrend.percentageChange > 0 ? '+' : ''}${successTrend.percentageChange.toFixed(1)}%`
  );
  console.log(
    `    Moving Average: ${(successTrend.movingAverage).toFixed(1)}%\n`
  );

  // Phase 5: Strategy Comparison
  console.log('🔍 PHASE 5: Strategy Comparison\n');

  const strategies = learningManager.compareStrategies(testAgents);
  console.log('  Strategy Rankings:');
  strategies.forEach((strategy, i) => {
    console.log(
      `    ${i + 1}. ${strategy.strategyId.toUpperCase()}`
    );
    console.log(
      `       Recommendation Score: ${strategy.recommendation}/100`
    );
    console.log(
      `       Success Rate: ${(strategy.successRate * 100).toFixed(1)}%`
    );
    console.log(
      `       Avg Time: ${strategy.averageExecutionTime.toFixed(0)}ms`
    );
    console.log(
      `       Avg Quality: ${strategy.averageQualityScore.toFixed(1)}/100`
    );
    console.log(`       Trend: ${strategy.improvementTrend}`);
    console.log();
  });

  // Phase 6: Learning Statistics
  console.log('📊 PHASE 6: Learning Statistics\n');

  const stats = learningManager.getStats();
  console.log(`  Total Executions: ${stats.totalExecutions}`);
  console.log(`  Active Agents: ${stats.agentCount}`);
  console.log(`  Strategies Tracked: ${stats.strategyCount}`);
  console.log(
    `  System Success Rate: ${(stats.averageSuccessRate * 100).toFixed(1)}%`
  );
  console.log(
    `  Average Quality Score: ${stats.averageQualityScore.toFixed(1)}/100`
  );

  // Phase 7: Execution History
  console.log('\n📜 PHASE 7: Recent Execution History\n');

  const history = learningManager.getHistory(5);
  console.log(`  Latest ${Math.min(5, history.length)} Executions:\n`);
  history.forEach((record, i) => {
    console.log(`    ${i + 1}. ${record.agentIds.join(' + ')} (${record.strategyId})`);
    console.log(`       Time: ${record.executionTime}ms | Quality: ${record.qualityScore}/100 | ${record.success ? '✓ Success' : '✗ Failed'}`);
  });

  // Summary
  console.log(
    '\n╔════════════════════════════════════════════════════════════════╗'
  );
  console.log(
    '║                    DEMO COMPLETE                               ║'
  );
  console.log(
    '║                                                                ║'
  );
  console.log(
    '║  The learning system has demonstrated:                        ║'
  );
  console.log(
    '║  ✓ Performance metric collection                              ║'
  );
  console.log(
    '║  ✓ Strategy recommendations with reasoning                    ║'
  );
  console.log(
    '║  ✓ Comprehensive analytics and insights                       ║'
  );
  console.log(
    '║  ✓ Trend detection and forecasting                            ║'
  );
  console.log(
    '║  ✓ Strategy comparison and ranking                            ║'
  );
  console.log(
    '║                                                                ║'
  );
  console.log(
    '║  The system learns from execution history and provides        ║'
  );
  console.log(
    '║  data-driven recommendations for optimization.                ║'
  );
  console.log(
    '╚════════════════════════════════════════════════════════════════╝\n'
  );
}

runDemo().catch(console.error);
