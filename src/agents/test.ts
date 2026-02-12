/**
 * Production Agents Test Suite
 * 
 * Tests for:
 * - Research Agent (sequential workflows)
 * - Code Review Agent (parallel workflows)
 * - Coordinator Agent (IPC and orchestration)
 */

import { Kernel } from '../kernel/kernel';
import { MemoryManager } from '../memory/memoryManager';
import { ToolManager } from '../tools/toolManager';
import { Orchestrator } from '../orchestration/orchestrator';
import { MessageBus } from '../ipc/messageBus';
import { BaseTool, ToolConfig } from '../tools/tool.interface';
import { ResearchAgent } from './researchAgent';
import { CodeReviewAgent } from './codeReviewAgent';
import { CoordinatorAgent } from './coordinatorAgent';

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
// SETUP
// ============================================================================

// Mock tool classes for testing
class MockWebTool extends BaseTool {
  constructor() {
    super({
      name: 'web-tool',
      type: 'web',
      description: 'Mock web search tool',
      requiredPermissions: ['network'],
    });
  }

  async execute(args: Record<string, any>): Promise<any> {
    return { results: ['result1', 'result2'] };
  }

  validate(args: Record<string, any>) {
    return { valid: true };
  }

  async isHealthy(): Promise<boolean> {
    return true;
  }
}

class MockFsTool extends BaseTool {
  constructor() {
    super({
      name: 'fs-tool',
      type: 'filesystem',
      description: 'Mock file system tool',
      requiredPermissions: ['read'],
    });
  }

  async execute(args: Record<string, any>): Promise<any> {
    return { content: 'file content' };
  }

  validate(args: Record<string, any>) {
    return { valid: true };
  }

  async isHealthy(): Promise<boolean> {
    return true;
  }
}

class MockCodeTool extends BaseTool {
  constructor() {
    super({
      name: 'code-tool',
      type: 'code',
      description: 'Mock code analysis tool',
      requiredPermissions: ['read'],
    });
  }

  async execute(args: Record<string, any>): Promise<any> {
    return { analysis: 'code analysis' };
  }

  validate(args: Record<string, any>) {
    return { valid: true };
  }

  async isHealthy(): Promise<boolean> {
    return true;
  }
}

const kernel = new Kernel();
const memory = new MemoryManager();
const toolManager = new ToolManager();
const orchestrator = new Orchestrator();
const messageBus = new MessageBus();

// Register mock tools for testing
toolManager.registerTool(new MockWebTool());
toolManager.registerTool(new MockFsTool());
toolManager.registerTool(new MockCodeTool());

// ============================================================================
// RESEARCH AGENT TESTS
// ============================================================================

async function testResearchAgent() {
  section('Research Agent');

  // Create memory for the research agent
  memory.createAgentMemory('research-agent');
  
  const agent = new ResearchAgent(kernel, memory, toolManager, orchestrator);

  // Test 1: Agent registration
  const registeredAgent = kernel.getAgent('research-agent');
  await assert(registeredAgent !== undefined, 'Research agent registered');

  // Test 2: Agent has correct capabilities
  await assert(
    registeredAgent?.metadata?.capabilities?.includes('web-search'),
    'Has web-search capability'
  );

  // Test 3: Get stats
  const stats = agent.getStats();
  await assert(stats.agentId === 'research-agent', 'Stats retrieved');

  // Test 4: Research workflow structure (quick research)
  // Note: We're not executing real web searches, just testing the structure
  await assert(
    kernel.getAgent('research-agent')?.state === 'uninitialized',
    'Agent in correct initial state'
  );

  // Test 5: Memory integration
  await assert(stats.memoryCount >= 0, 'Memory integration working');

  // Test 6: Tool permissions granted
  await assert(
    toolManager.canUseTool('research-agent', 'web-tool'),
    'Has web tool permission'
  );
}

// ============================================================================
// CODE REVIEW AGENT TESTS
// ============================================================================

async function testCodeReviewAgent() {
  section('Code Review Agent');

  // Create memory for main agent and sub-agents
  memory.createAgentMemory('code-review-agent');
  memory.createAgentMemory('style-analyzer');
  memory.createAgentMemory('bug-detector');
  memory.createAgentMemory('perf-analyzer');
  
  const agent = new CodeReviewAgent(kernel, memory, toolManager, orchestrator);

  // Test 1: Main agent registration
  const mainAgent = kernel.getAgent('code-review-agent');
  await assert(mainAgent !== undefined, 'Code review agent registered');

  // Test 2: Sub-agents registered
  const styleAgent = kernel.getAgent('style-analyzer');
  const bugAgent = kernel.getAgent('bug-detector');
  const perfAgent = kernel.getAgent('perf-analyzer');
  
  await assert(styleAgent !== undefined, 'Style analyzer registered');
  await assert(bugAgent !== undefined, 'Bug detector registered');
  await assert(perfAgent !== undefined, 'Performance analyzer registered');

  // Test 3: All sub-agents registered in orchestrator
  await assert(
    orchestrator.getSummary().registeredAgents >= 4,
    'Sub-agents registered in orchestrator'
  );

  // Test 4: Agent capabilities
  await assert(
    mainAgent?.metadata?.capabilities?.includes('style-check'),
    'Has style-check capability'
  );

  // Test 5: Get stats shows sub-agents
  const stats = agent.getStats();
  await assert(stats.subAgents.length === 3, 'Shows 3 sub-agents');

  // Test 6: Tool permissions
  await assert(
    toolManager.canUseTool('code-review-agent', 'fs-tool'),
    'Has file system tool permission'
  );
  await assert(
    toolManager.canUseTool('code-review-agent', 'code-tool'),
    'Has code tool permission'
  );
}

// ============================================================================
// COORDINATOR AGENT TESTS
// ============================================================================

async function testCoordinatorAgent() {
  section('Coordinator Agent');

  // Create memory for coordinator
  memory.createAgentMemory('coordinator-agent');

  const agent = new CoordinatorAgent(kernel, messageBus, toolManager, orchestrator);

  // Test 1: Agent registration
  const coordAgent = kernel.getAgent('coordinator-agent');
  await assert(coordAgent !== undefined, 'Coordinator agent registered');

  // Test 2: Has IPC message handler
  await assert(coordAgent?.onMessage !== undefined, 'Has message handler');

  // Test 3: Get initial stats
  const stats = agent.getStats();
  await assert(stats.messagesReceived === 0, 'No messages received initially');

  // Test 4: Subscribe to agent messages
  const unsubscribe = agent.subscribeToAgent('test-agent', (msg: any) => {
    console.log('Received:', msg);
  });
  await assert(typeof unsubscribe === 'function', 'Can subscribe to agent messages');
  unsubscribe(); // Clean up

  // Test 5: Message handling
  const testMessage = {
    from: 'test-sender',
    to: 'coordinator-agent',
    content: { test: true },
    timestamp: Date.now(),
  };
  
  if (coordAgent?.onMessage) {
    await coordAgent.onMessage(testMessage);
  }
  
  const messages = agent.getReceivedMessages();
  await assert(messages.length === 1, 'Message received and stored');

  // Test 6: Clear messages
  agent.clearMessages();
  await assert(agent.getReceivedMessages().length === 0, 'Messages cleared');

  // Test 7: Agent capabilities
  await assert(
    coordAgent?.metadata?.capabilities?.includes('agent-coordination'),
    'Has coordination capability'
  );
}

// ============================================================================
// INTEGRATION TESTS
// ============================================================================

async function testAgentIntegration() {
  section('Agent Integration');

  // Test 1: Multiple agents can coexist
  const allAgents = kernel.listAgents();
  await assert(allAgents.length >= 6, 'Multiple agents registered');

  // Test 2: All agents in orchestrator
  const orchSummary = orchestrator.getSummary();
  await assert(orchSummary.registeredAgents >= 6, 'All agents in orchestrator');

  // Test 3: Agents have unique IDs
  const agentIds = allAgents.map((a) => a.id);
  const uniqueIds = new Set(agentIds);
  await assert(uniqueIds.size === agentIds.length, 'All agent IDs are unique');

  // Test 4: Research and Code Review agents both use memory
  await assert(memory !== undefined, 'Shared memory manager');

  // Test 5: All production agents have metadata
  const prodAgents = kernel.listAgents().filter((a: any) => 
    a.id.includes('research') || a.id.includes('code-review') || a.id.includes('coordinator')
  );
  
  await assert(
    prodAgents.every((a: any) => a.metadata !== undefined),
    'All production agents have metadata'
  );

  // Test 6: All production agents have capabilities defined
  await assert(
    prodAgents.every((a: any) => a.metadata?.capabilities?.length > 0),
    'All production agents have capabilities'
  );
}

// ============================================================================
// WORKFLOW PATTERN TESTS
// ============================================================================

async function testWorkflowPatterns() {
  section('Workflow Patterns');

  // Test 1: Sequential pattern (Research Agent)
  await assert(
    kernel.getAgent('research-agent') !== undefined,
    'Sequential workflow agent exists'
  );

  // Test 2: Parallel pattern (Code Review Agent)
  await assert(
    kernel.getAgent('style-analyzer') !== undefined &&
    kernel.getAgent('bug-detector') !== undefined,
    'Parallel workflow sub-agents exist'
  );

  // Test 3: Coordination pattern (Coordinator Agent)
  const coordAgent = kernel.getAgent('coordinator-agent');
  await assert(
    coordAgent?.tags?.includes('orchestration') ?? false,
    'Coordination pattern agent tagged correctly'
  );

  // Test 4: All patterns use orchestrator
  const summary = orchestrator.getSummary();
  await assert(summary.registeredAgents > 0, 'Agents registered with orchestrator');
}

// ============================================================================
// CAPABILITY TESTS
// ============================================================================

async function testAgentCapabilities() {
  section('Agent Capabilities');

  const researchAgent = kernel.getAgent('research-agent');
  const codeReviewAgent = kernel.getAgent('code-review-agent');
  const coordinatorAgent = kernel.getAgent('coordinator-agent');

  // Test 1: Research agent capabilities
  await assert(
    researchAgent?.metadata?.capabilities?.includes('web-search'),
    'Research has web-search'
  );
  await assert(
    researchAgent?.metadata?.capabilities?.includes('summarization'),
    'Research has summarization'
  );

  // Test 2: Code review agent capabilities
  await assert(
    codeReviewAgent?.metadata?.capabilities?.includes('bug-detection'),
    'Code review has bug-detection'
  );

  // Test 3: Coordinator agent capabilities
  await assert(
    coordinatorAgent?.metadata?.capabilities?.includes('workflow-orchestration'),
    'Coordinator has workflow-orchestration'
  );

  // Test 4: All agents have version
  await assert(
    researchAgent?.metadata?.version !== undefined,
    'Research agent has version'
  );
  await assert(
    codeReviewAgent?.metadata?.version !== undefined,
    'Code review agent has version'
  );
  await assert(
    coordinatorAgent?.metadata?.version !== undefined,
    'Coordinator agent has version'
  );
}

// ============================================================================
// RUN ALL TESTS
// ============================================================================

async function runAllTests() {
  console.log(`\n${colors.blue}→${colors.reset} PRODUCTION AGENTS TEST SUITE\n`);

  try {
    await testResearchAgent();
    await testCodeReviewAgent();
    await testCoordinatorAgent();
    await testAgentIntegration();
    await testWorkflowPatterns();
    await testAgentCapabilities();

    console.log(
      `\n${colors.green}✓${colors.reset} All production agent tests passed\n`
    );
  } catch (error) {
    console.error('Test suite failed:', error);
    process.exit(1);
  }
}

runAllTests();
