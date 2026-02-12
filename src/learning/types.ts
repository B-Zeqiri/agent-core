/**
 * Learning System - Type Definitions
 *
 * Core types for Phase 11 learning and optimization
 */

// ============================================================================
// PERFORMANCE TRACKING
// ============================================================================

export interface AgentMetrics {
  agentId: string;
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  averageExecutionTime: number;
  averageQualityScore: number;
  successRate: number; // 0-1
  lastExecutionTime: number;
  lastExecutionSuccess: boolean;
}

export interface StrategyMetrics {
  strategyId: string; // 'sequential' | 'parallel' | 'adaptive'
  agentCombination: string; // agents involved
  executionCount: number;
  successCount: number;
  failureCount: number;
  averageExecutionTime: number;
  averageQualityScore: number;
  successRate: number; // 0-1
  recommendation: number; // 0-100 (higher = better)
  lastUsedTime: number;
  improvementTrend: 'improving' | 'stable' | 'declining';
}

export interface ExecutionRecord {
  id: string;
  agentIds: string[];
  strategyId: string;
  executionTime: number;
  qualityScore: number;
  success: boolean;
  errorMessage?: string;
  timestamp: number;
  metadata?: Record<string, any>;
}

export interface LearningInsight {
  type: 'agent-performance' | 'strategy-effectiveness' | 'performance-issue' | 'reliability-concern' | 'quality-improvement' | 'quality-regression';
  priority: 'high' | 'medium' | 'low';
  insight: string;
  actionable: boolean;
  recommendation: string;
  confidence: number; // 0-100
}

// ============================================================================
// STRATEGY SELECTION
// ============================================================================

export interface StrategyRecommendation {
  recommendedStrategy: 'sequential' | 'parallel' | 'adaptive';
  confidence: number; // 0-1
  expectedExecutionTime: number;
  expectedQualityScore: number;
  reasoning: string[];
}

export interface AgentProfile {
  agentId: string;
  strengths: string[]; // what it excels at
  weaknesses: string[]; // where it struggles
  averagePerformance: number; // 0-100
  reliability: number; // 0-1 (success rate)
  speed: number; // executions per second
  lastUpdated: number;
}

// ============================================================================
// ANALYTICS
// ============================================================================

export interface PerformanceReport {
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

export interface TrendAnalysis {
  metric: string; // 'execution-time', 'quality-score', 'success-rate'
  direction: 'improving' | 'stable' | 'degrading' | 'insufficient-data';
  percentageChange: number; // month-over-month
  movingAverage: number;
  volatility: number;
  forecast: number; // predicted next value
  confidence: number; // 0-100
}

// ============================================================================
// LEARNING CONFIGURATION
// ============================================================================

export interface LearningConfig {
  enableLearning: boolean;
  persistenceEnabled: boolean;
  persistencePath?: string;
  metricsRetentionDays: number; // how long to keep historical data
  minExecutionsForRecommendation: number; // need at least N executions
  confidenceThreshold: number; // 0-1, min confidence for recommendations
  adaptiveStrategyEnabled: boolean;
  performanceReportIntervalMs: number; // how often to generate reports
}

// ============================================================================
// LEARNING EVENTS
// ============================================================================

export type LearningEventType =
  | 'execution:completed'
  | 'execution:failed'
  | 'strategy:recommended'
  | 'agent:optimized'
  | 'insight:discovered'
  | 'trend:detected';

export interface LearningEvent {
  type: LearningEventType;
  timestamp: number;
  data: Record<string, any>;
}
