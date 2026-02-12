/**
 * Phase 10: Agent Orchestration & Composition
 * 
 * Core types for multi-agent workflows, behavior patterns,
 * task decomposition, and context management.
 */

// ============================================================================
// CONTEXT MANAGEMENT
// ============================================================================

export interface ExecutionContext {
  taskId: string;
  agentId: string;
  parentTaskId?: string;
  depth: number;
  variables: Map<string, any>;
  history: ExecutionStep[];
  startTime: number;
  deadline?: number;
  metadata?: Record<string, any>;
}

export interface ExecutionStep {
  timestamp: number;
  agentId: string;
  action: string;
  input: any;
  output: any;
  error?: string;
  duration: number;
}

export interface ContextUpdate {
  key: string;
  value: any;
  timestamp: number;
  source: string;
}

// ============================================================================
// TASK DECOMPOSITION
// ============================================================================

export type TaskType = 'sequential' | 'parallel' | 'conditional' | 'loop' | 'atomic' | 'graph';

export interface TaskGraphNode {
  id: string;
  task: Task;
  dependsOn?: string[];
  allowFailure?: boolean;
}

export interface TaskGraph {
  nodes: TaskGraphNode[];
}

export interface Task {
  id: string;
  type: TaskType;
  name: string;
  description?: string;
  agentId?: string; // For atomic tasks
  input?: Record<string, any>;
  subtasks?: Task[]; // For composite tasks
  graph?: TaskGraph; // For graph tasks
  condition?: (context: ExecutionContext) => boolean; // For conditional tasks
  loopCondition?: (context: ExecutionContext) => boolean; // For loop tasks
  onSuccess?: (context: ExecutionContext, output: any) => void;
  onFailure?: (context: ExecutionContext, error: Error) => void;
  timeout?: number;
  retries?: number;
  allowFailure?: boolean; // Permit task failure without failing parent
  metadata?: Record<string, any>;
}

export interface TaskResult {
  taskId: string;
  success: boolean;
  output?: any;
  error?: string;
  duration: number;
  subtaskResults?: TaskResult[];
  context: ExecutionContext;
}

// ============================================================================
// BEHAVIOR PATTERNS (STATE MACHINES)
// ============================================================================

export type BehaviorState = string;
export type BehaviorEvent = string;

export interface StateTransition {
  from: BehaviorState;
  event: BehaviorEvent;
  to: BehaviorState;
  condition?: (context: ExecutionContext) => boolean;
  action?: (context: ExecutionContext) => Promise<void>;
  guard?: (context: ExecutionContext) => boolean;
}

export interface BehaviorPattern {
  name: string;
  states: BehaviorState[];
  initialState: BehaviorState;
  finalStates: BehaviorState[];
  transitions: StateTransition[];
  onStateEnter?: (state: BehaviorState, context: ExecutionContext) => Promise<void>;
  onStateExit?: (state: BehaviorState, context: ExecutionContext) => Promise<void>;
  onError?: (state: BehaviorState, error: Error, context: ExecutionContext) => Promise<void>;
}

export interface BehaviorInstance {
  patternName: string;
  currentState: BehaviorState;
  context: ExecutionContext;
  history: BehaviorStateChange[];
}

export interface BehaviorStateChange {
  fromState: BehaviorState;
  toState: BehaviorState;
  event: BehaviorEvent;
  timestamp: number;
  duration: number;
}

// ============================================================================
// AGENT COMPOSITION
// ============================================================================

export interface CompositionPattern {
  id: string;
  name: string;
  type: 'pipeline' | 'branch' | 'loop' | 'switch' | 'parallel';
  agents: string[]; // Agent IDs
  config: Record<string, any>;
  description?: string;
}

export interface PipelineConfig {
  steps: string[]; // Agent IDs in order
  passOutput: boolean; // Pass previous agent output as input to next
  stopOnError: boolean;
}

export interface BranchConfig {
  condition: string; // JS expression or reference
  trueBranch: string; // Agent ID or composition ID
  falseBranch: string; // Agent ID or composition ID
}

export interface LoopConfig {
  agentId: string;
  condition: string; // JS expression
  maxIterations: number;
}

export interface ParallelConfig {
  agents: string[]; // Agent IDs to run in parallel
  mergeStrategy: 'first' | 'all' | 'custom';
  timeout?: number;
}

// ============================================================================
// ORCHESTRATOR
// ============================================================================

export interface OrchestratorConfig {
  maxConcurrentTasks: number;
  defaultTimeout: number;
  enableContextPropagation: boolean;
  enableLogging: boolean;
}

export interface OrchestrationMetrics {
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  averageDuration: number;
  activeTaskCount: number;
  lastUpdated: number;
}

// ============================================================================
// WORKFLOW
// ============================================================================

export interface Workflow {
  id: string;
  name: string;
  description?: string;
  rootTask: Task;
  variables?: Record<string, any>;
  timeout?: number;
  retryPolicy?: RetryPolicy;
  metadata?: Record<string, any>;
}

export interface RetryPolicy {
  maxRetries: number;
  backoffMultiplier: number;
  initialDelay: number;
  maxDelay: number;
  retryableErrors: string[];
}

export interface WorkflowExecution {
  workflowId: string;
  executionId: string;
  status: 'running' | 'succeeded' | 'failed' | 'cancelled';
  startTime: number;
  endTime?: number;
  result?: TaskResult;
  error?: string;
  context: ExecutionContext;
}

// ============================================================================
// AGENT INTERFACE (STANDARDIZED)
// ============================================================================

export interface OrchestrationAgent {
  id: string;
  name: string;
  description: string;
  capabilities: string[];
  
  // Execute with context
  execute(
    input: any,
    context: ExecutionContext
  ): Promise<any>;
  
  // Validate input
  validate(input: any): { valid: boolean; errors?: string[] };
  
  // Check if agent can handle task
  canHandle(taskType: string): boolean;
  
  // Get behavior pattern (if agent follows state machine)
  getBehaviorPattern?(): BehaviorPattern;
  
  // Health check
  isHealthy(): Promise<boolean>;
}

// ============================================================================
// EVENT SYSTEM
// ============================================================================

export type OrchestrationEventType =
  | 'task.started'
  | 'task.completed'
  | 'task.failed'
  | 'state.changed'
  | 'context.updated'
  | 'workflow.started'
  | 'workflow.completed'
  | 'agent.executed';

export interface OrchestrationEvent {
  type: OrchestrationEventType;
  timestamp: number;
  taskId?: string;
  agentId?: string;
  workflowId?: string;
  data: Record<string, any>;
}

export interface EventListener {
  (event: OrchestrationEvent): Promise<void>;
}
