# Phase 11: Learning & Optimization

## Overview

Phase 11 introduces a comprehensive learning system that enables Agent Core OS to:

1. **Track Performance** - Monitor agent and strategy execution metrics
2. **Recommend Strategies** - Suggest optimal orchestration patterns based on history
3. **Analyze Trends** - Detect performance patterns and predict future outcomes
4. **Generate Insights** - Provide actionable recommendations for optimization

This enables **adaptive orchestration** where the system learns from past executions and automatically selects the best workflow patterns.

## Architecture

### Components

```
┌─────────────────────────────────────────────┐
│         LearningManager (Coordinator)        │
├─────────────────────────────────────────────┤
│ • recordExecution()                         │
│ • recommendStrategy()                       │
│ • generateReport()                          │
│ • analyzeTrends()                           │
│ • getStats()                                │
└─────────────────────────────────────────────┘
           │           │           │
    ┌──────┴───┬───────┴──┬────────┴───┐
    │           │          │            │
    ▼           ▼          ▼            ▼
┌─────────┐ ┌─────────┐ ┌────────┐ ┌─────────┐
│Performance│ Strategy  │Analytics │   Trend  │
│ Tracker   │ Recomm.  │ Engine   │ Analysis │
└─────────┘ └─────────┘ └────────┘ └─────────┘
```

### 1. PerformanceTracker

Collects and aggregates execution metrics:

```typescript
import { PerformanceTracker } from '@/learning';

const tracker = new PerformanceTracker();

// Record an execution
const record = tracker.recordExecution(
  ['agent-1', 'agent-2'],  // agents used
  'parallel',               // strategy
  250,                      // execution time (ms)
  85,                       // quality score (0-100)
  true,                     // success
);

// Query metrics
const agentMetrics = tracker.getAgentMetrics('agent-1');
// {
//   agentId: 'agent-1',
//   totalExecutions: 10,
//   successfulExecutions: 9,
//   failedExecutions: 1,
//   averageExecutionTime: 245,
//   averageQualityScore: 83,
//   successRate: 0.9,
//   lastExecutionTime: 250,
//   lastExecutionSuccess: true
// }

// Get history
const history = tracker.getExecutionHistory(100);
const agent1History = tracker.getExecutionHistory(100, 'agent-1');

// Get top performers
const topAgents = tracker.getTopAgents(5);
const topStrategies = tracker.getTopStrategies(5);
```

**Key Metrics Tracked:**
- Success rate per agent/strategy
- Average execution time
- Quality scores
- Execution history with timestamps
- Improvement trends

### 2. StrategyRecommender

Recommends optimal strategies based on historical performance:

```typescript
import { StrategyRecommender } from '@/learning';

const recommender = new StrategyRecommender(tracker);

// Get strategy recommendation
const recommendation = recommender.recommendStrategy(
  ['agent-1', 'agent-2'],
  {
    priority: 'balanced',  // 'speed' | 'quality' | 'balanced'
    complexity: 'high',    // 'low' | 'medium' | 'high'
    timeout: 5000
  }
);

// {
//   recommendedStrategy: 'sequential',
//   confidence: 85,           // 0-100 based on execution history
//   expectedExecutionTime: 250,
//   expectedQualityScore: 87,
//   reasoning: [
//     'sequential strategy recommended for optimal quality (87/100 expected)',
//     '23% better than parallel strategy',
//     'High confidence based on extensive execution history'
//   ]
// }

// Compare all strategies
const comparison = recommender.compareStrategies(['agent-1', 'agent-2']);
// Returns all strategies ranked by recommendation score
```

**Recommendation Algorithm:**

The recommender scores strategies using:

```
score = success_rate * 50        // Success component (0-50)
      + quality_score / 100 * 30 // Quality component (0-30)
      + speed_factor * 20        // Speed component (0-20)
```

**Priority-based Scoring:**

- **speed**: Prioritizes execution time (30% success, 20% time)
- **quality**: Prioritizes quality score (50% quality, rest balanced)
- **balanced**: Equal weighting of all factors

### 3. AnalyticsEngine

Analyzes data and generates insights:

```typescript
import { AnalyticsEngine } from '@/learning';

const analytics = new AnalyticsEngine(tracker);

// Generate comprehensive report
const report = analytics.generatePerformanceReport();

// {
//   timestamp: 1703500000000,
//   periodStart: 1703413600000,  // Last 24 hours
//   periodEnd: 1703500000000,
//   metrics: {
//     totalExecutions: 150,
//     successRate: 0.92,
//     averageQualityScore: 84.5,
//     averageExecutionTime: 245,
//     topAgent: 'agent-1',
//     preferredStrategy: 'parallel'
//   },
//   insights: [
//     {
//       type: 'agent-performance',
//       priority: 'high',
//       insight: 'Top performing agent: agent-1 with 95% success rate',
//       actionable: true,
//       recommendation: 'Consider using agent-1 for critical tasks',
//       confidence: 90
//     },
//     // ... more insights
//   ],
//   recommendations: [
//     'Prioritize agent-1 for critical tasks (95% success rate)',
//     'Use parallel execution strategy for faster workflows',
//     'Improve reliability of agent-3: 15% failure rate',
//     // ... more recommendations
//   ],
//   summary: '150 total executions | 92% success rate | 84.5/100 avg quality | 245ms avg time | 2 high priority insights'
// }

// Analyze trends
const trend = analytics.analyzeTrends('quality');
// {
//   metric: 'quality',
//   direction: 'improving',  // 'improving' | 'degrading' | 'stable'
//   percentageChange: 12.5,   // vs first period
//   movingAverage: 85.3,      // Last 10 executions
//   volatility: 3.2,          // Consistency
//   forecast: 88.2,           // Predicted next value
//   confidence: 92            // Based on data volume
// }
```

**Insight Types:**

1. **agent-performance** - Top/bottom agents
2. **strategy-effectiveness** - Best strategies
3. **performance-issue** - Slow agents
4. **reliability-concern** - Unreliable agents
5. **quality-improvement** - Positive trends
6. **quality-regression** - Negative trends

### 4. LearningManager

Coordinates all learning components:

```typescript
import { learningManager } from '@/learning';

// Record execution
learningManager.recordExecution(
  ['agent-1', 'agent-2'],
  'parallel',
  250,
  85,
  true
);

// Get recommendation
const rec = learningManager.recommendStrategy(['agent-1', 'agent-2'], {
  priority: 'quality'
});

// Generate report
const report = learningManager.generateReport();

// Get history
const recent = learningManager.getHistory(50);

// Compare strategies
const comparison = learningManager.compareStrategies(['agent-1']);

// Analyze trends
const trend = learningManager.analyzeTrends('quality');

// Get statistics
const stats = learningManager.getStats();
// {
//   totalExecutions: 1000,
//   agentCount: 5,
//   strategyCount: 3,
//   averageSuccessRate: 0.91,
//   averageQualityScore: 84.2
// }

// Export data for analysis
const data = learningManager.export();
// {
//   executionHistory: [...],
//   agentMetrics: [...],
//   strategyMetrics: [...]
// }
```

## Integration with Orchestrator

### Recording Executions

After an orchestration completes, record the execution:

```typescript
import { orchestrator } from '@/orchestration';
import { learningManager } from '@/learning';

async function executeAndLearn(agentIds, strategyId, config) {
  const startTime = Date.now();

  const result = await orchestrator.executeWorkflow({
    agentIds,
    strategy: strategyId,
    config
  });

  const executionTime = Date.now() - startTime;
  const qualityScore = calculateQuality(result);
  const success = !result.error;

  // Record for learning
  learningManager.recordExecution(
    agentIds,
    strategyId,
    executionTime,
    qualityScore,
    success,
    result.error?.message
  );

  return result;
}
```

### Adaptive Strategy Selection

Use recommendations to select strategies automatically:

```typescript
async function executeWithOptimalStrategy(agentIds, config) {
  // Get recommendation
  const recommendation = learningManager.recommendStrategy(agentIds, {
    priority: config.priority || 'balanced',
    complexity: config.complexity || 'medium'
  });

  console.log(`Recommending ${recommendation.recommendedStrategy} strategy`);
  console.log(`Confidence: ${recommendation.confidence}%`);
  console.log(`Expected time: ${recommendation.expectedExecutionTime}ms`);
  console.log(`Expected quality: ${recommendation.expectedQualityScore}/100`);

  // Execute with recommended strategy
  const result = await executeAndLearn(
    agentIds,
    recommendation.recommendedStrategy,
    config
  );

  return result;
}
```

## Usage Patterns

### Pattern 1: Performance Monitoring

Monitor and report on system performance:

```typescript
const report = learningManager.generateReport();

console.log(`Total Executions: ${report.metrics.totalExecutions}`);
console.log(`Success Rate: ${(report.metrics.successRate * 100).toFixed(1)}%`);
console.log(`Quality: ${report.metrics.averageQualityScore}/100`);

if (report.insights.length > 0) {
  console.log('\nKey Insights:');
  report.insights.forEach(insight => {
    console.log(`- ${insight.insight} (${insight.priority} priority)`);
    if (insight.actionable) {
      console.log(`  Action: ${insight.recommendation}`);
    }
  });
}

console.log('\nTop Recommendations:');
report.recommendations.forEach((rec, i) => {
  console.log(`${i + 1}. ${rec}`);
});
```

### Pattern 2: Trend Analysis

Detect performance trends and anomalies:

```typescript
const qualityTrend = learningManager.analyzeTrends('quality');
const timeTrend = learningManager.analyzeTrends('execution-time');
const successTrend = learningManager.analyzeTrends('success-rate');

if (qualityTrend.direction === 'degrading') {
  console.warn('⚠️ Quality scores declining - investigate issues');
  console.log(`Trend: ${qualityTrend.percentageChange.toFixed(1)}% change`);
  console.log(`Volatility: ${qualityTrend.volatility.toFixed(2)} (higher = less stable)`);
}

if (timeTrend.direction === 'improving') {
  console.log('✓ Execution times improving');
}

// Forecast next value
console.log(`Next quality prediction: ${qualityTrend.forecast.toFixed(1)}/100`);
```

### Pattern 3: Strategy Optimization

Continuously optimize strategy selection:

```typescript
async function optimizeStrategies(agentIds) {
  const strategies = learningManager.compareStrategies(agentIds);

  console.log('Strategy Comparison:');
  strategies.forEach(s => {
    console.log(`${s.strategyId}:`);
    console.log(`  Success: ${(s.successRate * 100).toFixed(1)}%`);
    console.log(`  Time: ${s.averageExecutionTime.toFixed(0)}ms`);
    console.log(`  Quality: ${s.averageQualityScore.toFixed(1)}/100`);
    console.log(`  Recommendation: ${s.recommendation}/100`);
  });

  const best = strategies[0];
  console.log(`\nOptimal Strategy: ${best.strategyId}`);
}
```

### Pattern 4: Agent Performance Analysis

Analyze and compare agent performance:

```typescript
const stats = learningManager.getStats();

console.log(`Active Agents: ${stats.agentCount}`);
console.log(`System Success Rate: ${(stats.averageSuccessRate * 100).toFixed(1)}%`);
console.log(`Average Quality: ${stats.averageQualityScore.toFixed(1)}/100`);

// Get performance comparison
const history = learningManager.getHistory(1000);
const agentPerformance = {};

history.forEach(record => {
  record.agentIds.forEach(agentId => {
    if (!agentPerformance[agentId]) {
      agentPerformance[agentId] = { successes: 0, total: 0 };
    }
    agentPerformance[agentId].total++;
    if (record.success) {
      agentPerformance[agentId].successes++;
    }
  });
});

console.log('\nAgent Performance:');
Object.entries(agentPerformance).forEach(([agentId, perf]) => {
  const rate = (perf.successes / perf.total) * 100;
  console.log(`${agentId}: ${rate.toFixed(1)}% success rate (${perf.total} executions)`);
});
```

## Data Structures

### ExecutionRecord

```typescript
interface ExecutionRecord {
  id: string;                    // Unique execution ID
  agentIds: string[];            // Agents involved
  strategyId: string;            // Strategy used
  executionTime: number;         // Time in ms
  qualityScore: number;          // 0-100
  success: boolean;              // Success/failure
  errorMessage?: string;         // Error details if failed
  timestamp: number;             // When executed
}
```

### AgentMetrics

```typescript
interface AgentMetrics {
  agentId: string;
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  averageExecutionTime: number;
  averageQualityScore: number;
  successRate: number;
  lastExecutionTime: number;
  lastExecutionSuccess: boolean;
}
```

### StrategyMetrics

```typescript
interface StrategyMetrics {
  strategyId: string;
  agentCombination: string;
  executionCount: number;
  successCount: number;
  failureCount: number;
  averageExecutionTime: number;
  averageQualityScore: number;
  successRate: number;
  recommendation: number;        // 0-100 score
  lastUsedTime: number;
  improvementTrend: string;
}
```

### StrategyRecommendation

```typescript
interface StrategyRecommendation {
  recommendedStrategy: 'sequential' | 'parallel' | 'adaptive';
  confidence: number;            // 0-100
  expectedExecutionTime: number;
  expectedQualityScore: number;
  reasoning: string[];
}
```

### PerformanceReport

```typescript
interface PerformanceReport {
  timestamp: number;
  periodStart: number;
  periodEnd: number;
  metrics: {
    totalExecutions: number;
    successRate: number;
    averageQualityScore: number;
    averageExecutionTime: number;
    topAgent: string;
    preferredStrategy: string;
  };
  insights: LearningInsight[];
  recommendations: string[];
  summary: string;
}
```

## Testing

Phase 11 includes 50+ comprehensive tests covering:

### PerformanceTracker Tests (10)
- Recording executions
- Updating metrics
- Querying history
- Success rate calculation
- Top performers identification

### StrategyRecommender Tests (8)
- Strategy recommendations
- Confidence scoring
- Time predictions
- Quality predictions
- Priority-based selection

### AnalyticsEngine Tests (15)
- Report generation
- Insight generation
- Recommendation generation
- Trend analysis
- Anomaly detection

### LearningManager Tests (8)
- Component coordination
- Data export/import
- Statistics calculation
- History management

### Integration Tests (9)
- Complete workflows
- Learning adaptation
- Multi-agent scenarios
- Trend detection

**Run tests:**

```bash
npm test -- src/learning/test.ts
```

## Performance Characteristics

- **Recording overhead**: ~1ms per execution
- **Recommendation generation**: ~5ms (with history)
- **Report generation**: ~10-50ms depending on data volume
- **History limit**: 10,000 executions (auto-purged)
- **Memory usage**: ~5MB for 10K executions with full metrics

## Best Practices

### 1. Record All Executions

Always record executions for accurate learning:

```typescript
learningManager.recordExecution(
  agentIds,
  strategyId,
  executionTime,
  qualityScore,
  success,
  errorMessage
);
```

### 2. Use Appropriate Priorities

Match priority to use case:

```typescript
// For critical tasks - prioritize quality
const recQuality = learningManager.recommendStrategy(agents, {
  priority: 'quality'
});

// For time-sensitive tasks - prioritize speed
const recSpeed = learningManager.recommendStrategy(agents, {
  priority: 'speed'
});

// For general tasks - balanced approach
const recBalanced = learningManager.recommendStrategy(agents, {
  priority: 'balanced'
});
```

### 3. Monitor Trends

Check trends regularly to detect issues:

```typescript
const trend = learningManager.analyzeTrends('quality');
if (trend.direction === 'degrading') {
  // Investigate and fix issues
}
```

### 4. Act on Insights

Use generated insights to improve system:

```typescript
const report = learningManager.generateReport();
report.insights
  .filter(i => i.priority === 'high' && i.actionable)
  .forEach(insight => {
    console.log(`Action needed: ${insight.recommendation}`);
  });
```

## Future Enhancements

- Machine learning model integration for better predictions
- Anomaly detection algorithms
- Multi-dimensional optimization (cost, performance, reliability)
- Historical data persistence and analysis
- Real-time dashboards and visualizations
- Predictive failure detection
- Auto-tuning of agent parameters based on performance

## See Also

- [orchestration/](orchestration/) - Workflow orchestration
- [agents/](agents/) - Production agents
- [examples/](examples/) - Real-world demonstrations
- [AGENTS.md](AGENTS.md) - Agent framework guide
