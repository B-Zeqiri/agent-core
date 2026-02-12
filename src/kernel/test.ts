/**
 * Phase 1 — Kernel System Tests
 *
 * Tests all core functionality:
 * ✓ Agent registration/unregistration
 * ✓ Agent lifecycle (start, stop, state)
 * ✓ Task execution and tracking
 * ✓ Event emission
 * ✓ Registry queries
 * ✓ Error handling
 * ✓ Kernel stats
 */

import { Kernel } from "./kernel";
import { Agent } from "./types";
import { AgentRegistry } from "./registry";

// ============ TEST UTILITIES ============

const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
};

function pass(msg: string) {
  console.log(`${colors.green}✓${colors.reset} ${msg}`);
}

function fail(msg: string) {
  console.log(`${colors.red}✗${colors.reset} ${msg}`);
  process.exit(1);
}

function test(name: string) {
  console.log(`\n${colors.blue}→ ${name}${colors.reset}`);
}

async function assert(condition: boolean, msg: string) {
  if (condition) {
    pass(msg);
  } else {
    fail(msg);
  }
}

// ============ TEST AGENTS ============

const testAgentA: Agent = {
  id: "agent-a",
  name: "Test Agent A",
  model: "local",
  state: "uninitialized",
  permissions: ["read", "write"],
  tags: ["test", "local"],
  handler: async (input: string) => {
    return `Agent A processed: ${input}`;
  },
};

const testAgentB: Agent = {
  id: "agent-b",
  name: "Test Agent B",
  model: "openai",
  state: "uninitialized",
  permissions: ["read"],
  tags: ["test", "remote"],
  handler: async (input: string) => {
    await new Promise((resolve) => setTimeout(resolve, 50));
    return `Agent B processed: ${input}`;
  },
};

const errorAgent: Agent = {
  id: "error-agent",
  name: "Error Agent",
  model: "local",
  state: "uninitialized",
  tags: ["test", "local"],
  handler: async () => {
    throw new Error("Intentional test error");
  },
};

// ============ TESTS ============

async function runTests() {
  console.log(`\n${colors.yellow}=== PHASE 1 KERNEL TESTS ===${colors.reset}\n`);

  const kernel = new Kernel();

  // Test 1: Agent Registration
  test("Agent Registration");
  kernel.registerAgent(testAgentA);
  await assert(kernel.getAgent("agent-a") !== undefined, "Agent A registered");
  await assert(kernel.getAgent("agent-a")?.state === "uninitialized", "Agent A state is uninitialized");

  kernel.registerAgent(testAgentB);
  await assert(kernel.getAgent("agent-b") !== undefined, "Agent B registered");

  kernel.registerAgent(errorAgent);
  await assert(kernel.getAgent("error-agent") !== undefined, "Error agent registered");

  // Test 2: Duplicate Registration
  test("Duplicate Registration (should fail)");
  try {
    kernel.registerAgent(testAgentA);
    fail("Should have thrown error on duplicate registration");
  } catch (err) {
    pass("Correctly rejected duplicate registration");
  }

  // Test 3: Registry Queries
  test("Registry Queries");
  const allAgents = kernel.listAgents();
  await assert(allAgents.length === 3, `Listed all 3 agents`);
  await assert(allAgents[0].permissions !== undefined, "Agent has permissions");
  await assert(allAgents[0].tags !== undefined, "Agent has tags");

  const testAgents = kernel.getAgentsByTag("test");
  await assert(testAgents.length === 3, "All 3 agents have 'test' tag");

  const localAgents = kernel.getAgentsByTag("local");
  await assert(localAgents.length === 2, "2 agents have 'local' tag");

  const tags = kernel.getTags();
  await assert(tags.includes("test"), "Registry has 'test' tag");
  await assert(tags.includes("local"), "Registry has 'local' tag");
  await assert(tags.includes("remote"), "Registry has 'remote' tag");

  // Test 4: Agent Lifecycle
  test("Agent Lifecycle");
  kernel.startAgent("agent-a");
  await assert(kernel.getAgent("agent-a")?.state === "idle", "Agent A started (state=idle)");

  kernel.startAgent("agent-b");
  await assert(kernel.getAgent("agent-b")?.state === "idle", "Agent B started (state=idle)");

  kernel.stopAgent("agent-a");
  await assert(kernel.getAgent("agent-a")?.state === "stopped", "Agent A stopped");

  // Test 5: Task Execution
  test("Task Execution");
  kernel.startAgent("agent-a");

  const { executionId, output } = await kernel.runAgent("agent-a", "test input");
  await assert(output === "Agent A processed: test input", "Agent A returned correct output");
  await assert(executionId.startsWith("exec_"), "Execution ID generated");

  const agent = kernel.getAgent("agent-a");
  await assert(agent?.state === "idle", "Agent A returned to idle after execution");

  // Test 6: Execution Tracking
  test("Execution Tracking");
  const execution = kernel.getExecution(executionId);
  await assert(execution !== undefined, "Execution record exists");
  await assert(execution?.state === "success", "Execution state is success");
  await assert(execution?.output === "Agent A processed: test input", "Execution output stored");
  await assert(execution !== undefined && execution.startTime > 0, "Execution has start time");
  await assert(execution?.endTime !== undefined, "Execution has end time");

  // Test 7: Multiple Executions
  test("Multiple Executions");
  const exec2 = await kernel.runAgent("agent-b", "input 2");
  const exec3 = await kernel.runAgent("agent-a", "input 3");

  const agentAExecutions = kernel.getAgentExecutions("agent-a");
  await assert(agentAExecutions.length === 2, "Agent A has 2 executions");

  const allExecutions = kernel.getExecutionHistory();
  await assert(allExecutions.length >= 3, "Execution history contains all runs");

  // Test 8: Error Handling
  test("Error Handling");
  kernel.startAgent("error-agent");

  let failedExecutionId: string | undefined;
  try {
    const result = await kernel.runAgent("error-agent", "will fail");
    fail("Should have thrown on agent error");
  } catch (err) {
    pass("Correctly caught agent execution error");
    // Get the failed execution from history
    const recentHistory = kernel.getExecutionHistory(10);
    // Find the error-agent execution
    const errorExec = recentHistory.find(e => e.agentId === 'error-agent');
    if (errorExec) {
      failedExecutionId = errorExec.id;
    }
  }

  const errorExecution = failedExecutionId ? kernel.getExecution(failedExecutionId) : undefined;
  await assert(errorExecution?.state === "failed", "Failed execution marked as failed");
  await assert(
    errorExecution?.error !== undefined && errorExecution.error.includes("Intentional test error"),
    "Error message stored"
  );
  await assert(
    kernel.getAgent("error-agent")?.state === "error",
    "Agent state set to error"
  );

  // Test 9: Events
  test("Event Emission");
  const kernel2 = new Kernel();
  const events: string[] = [];

  kernel2.on((event) => {
    events.push(event.type);
  });

  kernel2.registerAgent(testAgentA);
  await assert(events.includes("agent:registered"), "agent:registered event emitted");

  kernel2.startAgent("agent-a");
  await assert(events.includes("agent:started"), "agent:started event emitted");

  const reg = await kernel2.runAgent("agent-a", "test");
  await assert(events.includes("task:queued"), "task:queued event emitted");
  await assert(events.includes("task:started"), "task:started event emitted");
  await assert(events.includes("task:completed"), "task:completed event emitted");

  kernel2.stopAgent("agent-a");
  await assert(events.includes("agent:stopped"), "agent:stopped event emitted");

  // Test 10: Kernel Stats
  test("Kernel Statistics");
  kernel.startAgent("agent-b");

  const stats = kernel.getStats();
  await assert(stats.agentCount === 3, "Agent count correct");
  await assert(stats.executionCount >= 3, "Execution count tracked");
  await assert(stats.failedExecutions >= 1, "Failed execution count tracked");

  // Test 11: Agent Unregistration
  test("Agent Unregistration");
  const unregistered = kernel.unregisterAgent("agent-a");
  await assert(unregistered === true, "Unregistration returns true");
  await assert(kernel.getAgent("agent-a") === undefined, "Agent A no longer retrievable");
  await assert(kernel.listAgents().length === 2, "Agent list updated");

  const agentNotFound = kernel.unregisterAgent("non-existent");
  await assert(agentNotFound === false, "Unregistering non-existent returns false");

  // Test 12: Not Found Errors
  test("Error Cases");
  try {
    await kernel.runAgent("non-existent-agent", "test");
    fail("Should throw on non-existent agent");
  } catch (err) {
    pass("Correctly throws on non-existent agent");
  }

  try {
    kernel.startAgent("non-existent-agent");
    fail("Should throw on non-existent agent");
  } catch (err) {
    pass("Correctly throws on startAgent non-existent");
  }

  // Test 13: Agent Registry Independent Use
  test("Agent Registry (Independent)");
  const registry = new AgentRegistry();

  registry.register(testAgentA);
  registry.register(testAgentB);

  await assert(registry.exists("agent-a"), "Registry.exists() works");
  await assert(registry.count() === 2, "Registry.count() works");

  const retrieved = registry.get("agent-a");
  await assert(retrieved?.name === "Test Agent A", "Registry.get() returns full agent");

  const byTag = registry.getByTag("test");
  await assert(byTag.length === 2, "Registry.getByTag() works");

  registry.clear();
  await assert(registry.count() === 0, "Registry.clear() works");

  // ============ SUMMARY ============

  console.log(
    `\n${colors.yellow}=== ALL TESTS PASSED ===${colors.reset}\n`
  );
  console.log(`${colors.green}✓ Agent Lifecycle${colors.reset}`);
  console.log(`${colors.green}✓ Task Execution${colors.reset}`);
  console.log(`${colors.green}✓ Execution Tracking${colors.reset}`);
  console.log(`${colors.green}✓ Event Emission${colors.reset}`);
  console.log(`${colors.green}✓ Registry Queries${colors.reset}`);
  console.log(`${colors.green}✓ Error Handling${colors.reset}`);
  console.log(`${colors.green}✓ Kernel Stats${colors.reset}\n`);
}

// Run tests
runTests().catch((err) => {
  console.error("Test suite failed:", err);
  process.exit(1);
});
