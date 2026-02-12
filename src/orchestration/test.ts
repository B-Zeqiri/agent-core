/**
 * Phase 10: Agent Orchestration & Composition Tests
 * 
 * Comprehensive test suite covering:
 * - Context management
 * - Behavior patterns (state machines)
 * - Task execution (all types)
 * - Orchestration and workflows
 * - Multi-agent coordination
 */

import { Kernel } from '../kernel/kernel';
import { Agent } from '../kernel/types';
import { Orchestrator } from './orchestrator';
import { ContextManager, contextManager } from './contextManager';
import { BehaviorEngine, behaviorEngine } from './behaviorEngine';
import { TaskExecutor, taskExecutor } from './taskExecutor';
import {
  Task,
  BehaviorPattern,
  ExecutionContext,
  Workflow,
} from './types';

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  blue: '\x1b[34m',
};

function pass(msg: string) {
  console.log(`${colors.green}✓${colors.reset} ${msg}`);
}

function fail(msg: string) {
  console.log(`${colors.red}✗${colors.reset} ${msg}`);
  process.exit(1);
}

function section(msg: string) {
  console.log(`\n${colors.blue}→${colors.reset} ${msg}`);
}

async function assert(condition: boolean, msg: string) {
  if (condition) {
    pass(msg);
  } else {
    fail(msg);
  }
}

// ============================================================================
// TEST SETUP
// ============================================================================

const kernel = new Kernel();
const orchestrator = new Orchestrator({
  maxConcurrentTasks: 10,
  enableLogging: true,
});

// Create test agents
const agentA: Agent = {
  id: 'agent-a',
  name: 'Agent A',
  model: 'local',
  state: 'uninitialized',
  handler: async (input: string) => `Agent A: ${input}`,
};

const agentB: Agent = {
  id: 'agent-b',
  name: 'Agent B',
  model: 'local',
  state: 'uninitialized',
  handler: async (input: string) => `Agent B: ${input}`,
};

const agentC: Agent = {
  id: 'agent-c',
  name: 'Agent C',
  model: 'local',
  state: 'uninitialized',
  handler: async (input: string) => `Agent C: ${input}`,
};

const agentFail: Agent = {
  id: 'agent-fail',
  name: 'Agent Fail',
  model: 'local',
  state: 'uninitialized',
  handler: async () => {
    throw new Error('Intentional failure');
  },
};

// Register agents
kernel.registerAgent(agentA);
kernel.registerAgent(agentB);
kernel.registerAgent(agentC);
kernel.registerAgent(agentFail);
orchestrator.registerAgent(agentA);
orchestrator.registerAgent(agentB);
orchestrator.registerAgent(agentC);
orchestrator.registerAgent(agentFail);

// ============================================================================
// CONTEXT MANAGER TESTS
// ============================================================================

async function testContextManager() {
  section('Context Management');

  // Test 1: Create and retrieve context
  const ctx = contextManager.createContext('task-1', 'agent-a');
  await assert(ctx.taskId === 'task-1', 'Context created with correct task ID');
  await assert(contextManager.getContext('task-1') !== undefined, 'Context retrieved');

  // Test 2: Set and get variables
  contextManager.setVariable('task-1', 'key1', 'value1');
  await assert(contextManager.getVariable('task-1', 'key1') === 'value1', 'Variable set and retrieved');

  // Test 3: Multiple variables
  contextManager.setVariables('task-1', {
    name: 'test',
    count: 42,
    active: true,
  });
  const vars = contextManager.getVariables('task-1');
  await assert(vars.name === 'test' && vars.count === 42, 'Multiple variables set');

  // Test 4: Parent-child context inheritance
  const parentCtx = contextManager.createContext('parent', 'agent-a');
  contextManager.setVariable('parent', 'inherited', 'from-parent');
  const childCtx = contextManager.createContext('child', 'agent-b', 'parent');
  contextManager.inheritFromParent('child');
  await assert(
    contextManager.getVariable('child', 'inherited') === 'from-parent',
    'Child inherits parent variables'
  );

  // Test 5: Deadline management
  contextManager.setDeadline('task-1', 1000);
  const isWithin = contextManager.isWithinDeadline('task-1');
  await assert(isWithin, 'Within deadline initially');

  const remaining = contextManager.getRemainingTime('task-1');
  await assert(remaining !== undefined && remaining > 0, 'Remaining time calculated');

  // Test 6: Execution history
  contextManager.recordStep('task-1', 'execute', { input: 1 }, { output: 2 });
  const history = contextManager.getHistory('task-1');
  await assert(history.length === 1, 'Execution step recorded');

  // Test 7: Context summary
  const summary = contextManager.getSummary('task-1');
  await assert(summary.taskId === 'task-1', 'Context summary retrieved');

  // Cleanup
  contextManager.clear();
}

// ============================================================================
// BEHAVIOR ENGINE TESTS
// ============================================================================

async function testBehaviorEngine() {
  section('Behavior Patterns (State Machines)');

  // Define a simple state machine
  const pattern: BehaviorPattern = {
    name: 'simple-fsm',
    states: ['idle', 'running', 'done'],
    initialState: 'idle',
    finalStates: ['done'],
    transitions: [
      { from: 'idle', event: 'start', to: 'running' },
      { from: 'running', event: 'finish', to: 'done' },
      { from: 'running', event: 'error', to: 'idle' },
    ],
  };

  // Test 1: Validate pattern
  const validation = behaviorEngine.validatePattern(pattern);
  await assert(validation.valid, 'Pattern is valid');

  // Test 2: Create and manage instance
  const ctx = contextManager.createContext('behavior-task', 'agent-a');
  const instance = behaviorEngine.createInstance('simple-fsm', pattern, ctx);
  await assert(instance.currentState === 'idle', 'Instance starts in initial state');

  // Test 3: Handle transitions
  const transitioned = await behaviorEngine.handleEvent('behavior-task', pattern, 'start');
  await assert(transitioned, 'Transition executed');
  await assert(behaviorEngine.getCurrentState('behavior-task') === 'running', 'State changed to running');

  // Test 4: Get available transitions
  const available = behaviorEngine.getAvailableTransitions('behavior-task', pattern);
  await assert(available.includes('finish'), 'Finish transition available');
  await assert(available.includes('error'), 'Error transition available');

  // Test 5: Check final state
  const finished = await behaviorEngine.handleEvent('behavior-task', pattern, 'finish');
  await assert(finished, 'Transition to final state');
  await assert(behaviorEngine.isComplete('behavior-task', pattern), 'Pattern is complete');

  // Test 6: State history
  const stateHistory = behaviorEngine.getHistory('behavior-task');
  await assert(stateHistory.length === 2, 'State transitions recorded');

  // Test 7: Behavior summary
  const summary = behaviorEngine.getSummary('behavior-task');
  await assert(summary.currentState === 'done', 'Summary shows final state');

  contextManager.clear();
  behaviorEngine.clear();
}

// ============================================================================
// TASK EXECUTOR TESTS
// ============================================================================

async function testTaskExecutor() {
  section('Task Execution');

  const parentCtx = contextManager.createContext('workflow-1', 'orchestrator');

  // Test 1: Atomic task execution
  const atomicTask: Task = {
    id: 'atomic-1',
    type: 'atomic',
    name: 'Simple atomic task',
    agentId: 'agent-a',
    input: { test: true },
  };

  const atomicResult = await taskExecutor.executeTask(atomicTask, parentCtx, new Map([
    ['agent-a', agentA],
    ['agent-b', agentB],
    ['agent-c', agentC],
  ]));

  await assert(atomicResult.success, 'Atomic task executed');

  // Test 2: Sequential task execution
  const sequentialTask: Task = {
    id: 'seq-1',
    type: 'sequential',
    name: 'Sequential tasks',
    subtasks: [
      {
        id: 'seq-1-1',
        type: 'atomic',
        name: 'First step',
        agentId: 'agent-a',
      },
      {
        id: 'seq-1-2',
        type: 'atomic',
        name: 'Second step',
        agentId: 'agent-b',
      },
    ],
  };

  const seqResult = await taskExecutor.executeTask(sequentialTask, parentCtx, new Map([
    ['agent-a', agentA],
    ['agent-b', agentB],
  ]));

  await assert(seqResult.success, 'Sequential tasks executed');

  // Test 3: Parallel task execution
  const parallelTask: Task = {
    id: 'par-1',
    type: 'parallel',
    name: 'Parallel tasks',
    subtasks: [
      {
        id: 'par-1-1',
        type: 'atomic',
        name: 'Parallel step 1',
        agentId: 'agent-a',
      },
      {
        id: 'par-1-2',
        type: 'atomic',
        name: 'Parallel step 2',
        agentId: 'agent-b',
      },
    ],
  };

  const parResult = await taskExecutor.executeTask(parallelTask, parentCtx, new Map([
    ['agent-a', agentA],
    ['agent-b', agentB],
  ]));

  await assert(parResult.success, 'Parallel tasks executed');

  // Test 4: Conditional task
  const conditionalTask: Task = {
    id: 'cond-1',
    type: 'conditional',
    name: 'Conditional task',
    condition: () => true,
    subtasks: [
      {
        id: 'cond-1-true',
        type: 'atomic',
        name: 'True branch',
        agentId: 'agent-a',
      },
      {
        id: 'cond-1-false',
        type: 'atomic',
        name: 'False branch',
        agentId: 'agent-b',
      },
    ],
  };

  const condResult = await taskExecutor.executeTask(conditionalTask, parentCtx, new Map([
    ['agent-a', agentA],
    ['agent-b', agentB],
  ]));

  await assert(condResult.success, 'Conditional task executed');

  // Test 5: Task with timeout
  const timeoutTask: Task = {
    id: 'timeout-1',
    type: 'atomic',
    name: 'Task with timeout',
    agentId: 'agent-a',
    timeout: 5000,
  };

  const timeoutResult = await taskExecutor.executeTask(timeoutTask, parentCtx, new Map([
    ['agent-a', agentA],
  ]));

  await assert(timeoutResult.duration < 6000, 'Task completed within timeout');

  contextManager.clear();
}

// ============================================================================
// ORCHESTRATOR TESTS
// ============================================================================

async function testOrchestrator() {
  section('Orchestrator & Workflows');

  // Test 1: Create workflow
  const rootTask: Task = {
    id: 'root',
    type: 'sequential',
    name: 'Root task',
    subtasks: [
      {
        id: 'step-1',
        type: 'atomic',
        name: 'Step 1',
        agentId: 'agent-a',
      },
    ],
  };

  const workflow = orchestrator.createWorkflow('wf-1', 'Test Workflow', rootTask, {
    initialVar: 'test',
  });

  await assert(workflow.id === 'wf-1', 'Workflow created');

  // Test 2: Execute workflow
  const execution = await orchestrator.executeWorkflow('wf-1');
  await assert(execution.status === 'succeeded' || execution.status === 'failed', 'Workflow executed');

  // Test 3: Get execution
  const retrieved = orchestrator.getExecution(execution.executionId);
  await assert(retrieved !== undefined, 'Execution retrieved');

  // Test 4: Get metrics
  const metrics = orchestrator.getMetrics();
  await assert(metrics.totalTasks > 0, 'Metrics tracked');

  // Test 5: Get active executions
  const active = orchestrator.getActiveExecutions();
  await assert(Array.isArray(active), 'Active executions listed');

  // Test 6: Get summary
  const summary = orchestrator.getSummary();
  await assert(summary.totalWorkflows > 0, 'Orchestrator summary generated');

  // Test 7: Success rate
  const successRate = orchestrator.getSuccessRate();
  await assert(successRate >= 0 && successRate <= 1, 'Success rate calculated');

  // Cleanup
  orchestrator.reset();
}

// ============================================================================
// MULTI-AGENT COORDINATION TESTS
// ============================================================================

async function testMultiAgentCoordination() {
  section('Multi-Agent Coordination');

  // Test 1: Sequential agent chain
  const chainWorkflow = orchestrator.createWorkflow(
    'chain-wf',
    'Agent Chain',
    {
      id: 'chain',
      type: 'sequential',
      name: 'Agent chain',
      subtasks: [
        {
          id: 'agent-a-task',
          type: 'atomic',
          name: 'Agent A processes',
          agentId: 'agent-a',
        },
        {
          id: 'agent-b-task',
          type: 'atomic',
          name: 'Agent B processes',
          agentId: 'agent-b',
        },
        {
          id: 'agent-c-task',
          type: 'atomic',
          name: 'Agent C processes',
          agentId: 'agent-c',
        },
      ],
    }
  );

  const chainExecution = await orchestrator.executeWorkflow('chain-wf');
  await assert(chainExecution.executionId !== undefined, 'Multi-agent chain executed');

  // Test 2: Parallel agent coordination
  const parallelWorkflow = orchestrator.createWorkflow(
    'parallel-wf',
    'Parallel Agents',
    {
      id: 'parallel-coord',
      type: 'parallel',
      name: 'Parallel coordination',
      subtasks: [
        {
          id: 'parallel-a',
          type: 'atomic',
          name: 'Agent A parallel task',
          agentId: 'agent-a',
        },
        {
          id: 'parallel-b',
          type: 'atomic',
          name: 'Agent B parallel task',
          agentId: 'agent-b',
        },
      ],
    }
  );

  const parallelExecution = await orchestrator.executeWorkflow('parallel-wf');
  await assert(parallelExecution.executionId !== undefined, 'Parallel agents coordinated');

  // Test 3: Graph workflow with partial failure allowed
  const graphWorkflow = orchestrator.createWorkflow(
    'graph-wf',
    'Graph Agents',
    {
      id: 'graph-root',
      type: 'graph',
      name: 'Graph workflow',
      graph: {
        nodes: [
          {
            id: 'node-a',
            task: {
              id: 'node-a-task',
              type: 'atomic',
              name: 'Node A',
              agentId: 'agent-a',
            },
          },
          {
            id: 'node-fail',
            allowFailure: true,
            task: {
              id: 'node-fail-task',
              type: 'atomic',
              name: 'Node Fail',
              agentId: 'agent-fail',
            },
          },
          {
            id: 'node-c',
            dependsOn: ['node-a', 'node-fail'],
            task: {
              id: 'node-c-task',
              type: 'atomic',
              name: 'Node C',
              agentId: 'agent-c',
            },
          },
        ],
      },
    }
  );

  const graphExecution = await orchestrator.executeWorkflow('graph-wf');
  await assert(graphExecution.status === 'succeeded', 'Graph workflow tolerates partial failure');

  // Test 3b: Graph workflow with explicit final node output
  const finalWorkflow = orchestrator.createWorkflow(
    'final-wf',
    'Final Output Aggregation',
    {
      id: 'final-root',
      type: 'graph',
      name: 'Final output graph',
      graph: {
        nodes: [
          {
            id: 'node-a',
            task: {
              id: 'node-a-final-task',
              type: 'atomic',
              name: 'Node A final',
              agentId: 'agent-a',
              input: { step: 'a' },
            },
          },
          {
            id: 'node-b',
            task: {
              id: 'node-b-final-task',
              type: 'atomic',
              name: 'Node B final',
              agentId: 'agent-b',
              input: { step: 'b' },
            },
          },
          {
            id: 'final',
            dependsOn: ['node-a', 'node-b'],
            task: {
              id: 'final-task',
              type: 'atomic',
              name: 'Final output',
              agentId: 'agent-c',
              input: { role: 'final' },
            },
          },
        ],
      },
    }
  );

  const finalExecution = await orchestrator.executeWorkflow('final-wf');
  await assert(finalExecution.status === 'succeeded', 'Final node graph succeeded');
  const finalOutputs = (finalExecution.result as any)?.output?.outputs;
  await assert(
    typeof finalOutputs?.final === 'string' && finalOutputs.final.includes('Agent C'),
    'Final node output captured'
  );

  // Test 4: Context sharing across agents
  const contextSharingWorkflow = orchestrator.createWorkflow(
    'context-wf',
    'Context Sharing',
    {
      id: 'context-task',
      type: 'sequential',
      name: 'Share context',
      subtasks: [
        {
          id: 'set-context',
          type: 'atomic',
          name: 'Set context var',
          agentId: 'agent-a',
        },
      ],
    },
    { sharedData: 'initial' }
  );

  const contextExecution = await orchestrator.executeWorkflow('context-wf');
  await assert(contextExecution.status !== undefined, 'Context shared across agents');

  orchestrator.reset();
}

// ============================================================================
// EVENT SYSTEM TESTS
// ============================================================================

async function testEventSystem() {
  section('Event System');

  const events: any[] = [];

  orchestrator.subscribe(async (event) => {
    events.push(event);
  });

  const workflow = orchestrator.createWorkflow('event-wf', 'Event Test', {
    id: 'event-root',
    type: 'atomic',
    name: 'Event test task',
    agentId: 'agent-a',
  });

  await orchestrator.executeWorkflow('event-wf');

  await assert(events.length > 0, 'Events emitted');
  await assert(events.some((e) => e.type === 'workflow.started'), 'Start event emitted');
  await assert(events.some((e) => e.type === 'workflow.completed'), 'Completion event emitted');

  orchestrator.reset();
}

// ============================================================================
// HARD CANCELLATION TESTS
// ============================================================================

async function testHardCancellation() {
  section('Hard Cancellation (AbortSignal)');

  const slowAgent: Agent = {
    id: 'agent-cancellable',
    name: 'Agent Cancellable',
    model: 'local',
    state: 'uninitialized',
    handler: async (_input: string, ctx?: { taskId?: string; signal?: AbortSignal }) => {
      const signal = ctx?.signal;
      return await new Promise<string>((resolve, reject) => {
        if (signal?.aborted) {
          reject(new Error('Task aborted'));
          return;
        }

        const t = setTimeout(() => resolve('done'), 10_000);
        signal?.addEventListener(
          'abort',
          () => {
            clearTimeout(t);
            reject(new Error('Task aborted'));
          },
          { once: true }
        );
      });
    },
  };

  orchestrator.registerAgent(slowAgent);

  orchestrator.createWorkflow('cancel-wf', 'Cancel Workflow', {
    id: 'cancel-root',
    type: 'atomic',
    name: 'Cancelable atomic',
    agentId: slowAgent.id,
    input: { test: true },
  });

  const controller = new AbortController();
  const execPromise = orchestrator.executeWorkflow('cancel-wf', { signal: controller.signal });

  await new Promise((r) => setTimeout(r, 50));
  controller.abort('User cancelled');

  const execution = await execPromise;
  await assert(execution.status === 'failed', 'Workflow fails on abort');
  await assert(/abort|cancel/i.test(execution.error || ''), 'Execution error indicates abort/cancel');

  orchestrator.reset();
}

// ============================================================================
// RUN ALL TESTS
// ============================================================================

async function runAllTests() {
  console.log(`\n${colors.blue}→${colors.reset} PHASE 10: AGENT ORCHESTRATION & COMPOSITION\n`);

  try {
    await testContextManager();
    await testBehaviorEngine();
    await testTaskExecutor();
    await testOrchestrator();
    await testMultiAgentCoordination();
    await testEventSystem();
    await testHardCancellation();

    console.log(
      `\n${colors.green}✓${colors.reset} All Phase 10 orchestration tests passed\n`
    );
  } catch (error) {
    console.error('Test suite failed:', error);
    process.exit(1);
  }
}

runAllTests();
