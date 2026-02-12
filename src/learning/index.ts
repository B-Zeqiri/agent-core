/**
 * Learning & Optimization Module
 *
 * Provides comprehensive learning and optimization capabilities:
 * - Performance tracking across agents and strategies
 * - Strategy recommendation based on historical data
 * - Analytics and insights generation
 * - Trend analysis and forecasting
 */

export { PerformanceTracker } from './performanceTracker';
export { StrategyRecommender } from './strategyRecommender';
export { AnalyticsEngine } from './analyticsEngine';
export { LearningManager, learningManager } from './learningManager';

export type {
  AgentMetrics,
  StrategyMetrics,
  ExecutionRecord,
  LearningInsight,
  StrategyRecommendation,
  AgentProfile,
  PerformanceReport,
  TrendAnalysis,
  LearningConfig,
  LearningEvent,
} from './types';
