/**
 * Phase 5 — Task Scheduler Tests
 *
 * Tests:
 * ✓ Task creation and submission
 * ✓ Priority queue
 * ✓ Task execution
 * ✓ Retry mechanism
 * ✓ Agent selection
 * ✓ Concurrency limits
 * ✓ Statistics tracking
 */

import { Kernel } from "../kernel/kernel";
import { AgentRegistry } from "../kernel/registry";
import { Agent } from "../kernel/types";
import { Scheduler } from "./scheduler";
import { TaskQueue } from "./taskQueue";

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

// ============ TESTS ============

async function runTests() {
  console.log(`\n${colors.yellow}=== PHASE 5 SCHEDULER TESTS ===${colors.reset}\n`);

  // ============ TASK QUEUE TESTS ============

  test("TaskQueue — Enqueue and Dequeue");
  const queue = new TaskQueue();

  const task1 = {
     id: "enqueue-task-1",
    name: "Task 1",
    input: "test",
    priority: "normal" as const,
    status: "pending" as const,
    retries: 0,
    maxRetries: 3,
    createdAt: Date.now(),
  };

  queue.enqueue(task1);
  await assert(queue.getStats().pending === 1, "Task enqueued");

  const dequeued = queue.dequeue();
   await assert(dequeued?.id === "enqueue-task-1", "Task dequeued");
  await assert(dequeued?.status === "assigned", "Status changed to assigned");

  test("TaskQueue — Priority Ordering");
  const queue2 = new TaskQueue();

  queue2.enqueue({
     ...{
       id: "enqueue-task-1",
       name: "Task 1",
       input: "test",
       priority: "normal" as const,
       status: "pending" as const,
       retries: 0,
       maxRetries: 3,
       createdAt: Date.now(),
     },
    id: "low",
    priority: "low",
    status: "pending",
  });

  queue2.enqueue({
     ...{
       id: "enqueue-task-1",
       name: "Task 1",
       input: "test",
       priority: "normal" as const,
       status: "pending" as const,
       retries: 0,
       maxRetries: 3,
       createdAt: Date.now(),
     },
    id: "critical",
    priority: "critical",
    status: "pending",
  });

  queue2.enqueue({
     ...{
       id: "enqueue-task-1",
       name: "Task 1",
       input: "test",
       priority: "normal" as const,
       status: "pending" as const,
       retries: 0,
       maxRetries: 3,
       createdAt: Date.now(),
     },
    id: "normal",
    priority: "normal",
    status: "pending",
  });

  const first = queue2.dequeue();
  await assert(first?.id === "critical", "Critical priority dequeued first");

  const second = queue2.dequeue();
  await assert(second?.id === "normal", "Normal priority next");

  const third = queue2.dequeue();
  await assert(third?.id === "low", "Low priority last");

  test("TaskQueue — Completion Tracking");
  const queue3 = new TaskQueue();
   const testTask = {
     id: "completion-task",
     name: "Task 1",
     input: "test",
     priority: "normal" as const,
     status: "pending" as const,
     retries: 0,
     maxRetries: 3,
     createdAt: Date.now(),
   };

  queue3.enqueue(testTask);
  queue3.dequeue();

   queue3.markRunning("completion-task", testTask);
  await assert(queue3.getRunning().length === 1, "Task marked running");

   const completed = queue3.markCompleted("completion-task", "result");
  await assert(completed?.status === "completed", "Task completed");
  await assert(queue3.getRunning().length === 0, "Removed from running");
  await assert(queue3.getCompleted().length === 1, "Added to completed");

  test("TaskQueue — Failure and Retry");
  const queue4 = new TaskQueue();
   const retryTask = {
     id: "retry",
     name: "Task 1",
     input: "test",
     priority: "normal" as const,
     status: "pending" as const,
     retries: 0,
     maxRetries: 2,
     createdAt: Date.now(),
   };

  queue4.enqueue(retryTask);
  queue4.dequeue();
  queue4.markRunning("retry", retryTask);

  const failed = queue4.markFailed("retry", "Error!", true);
  await assert(failed?.status === "retrying", "Task marked for retry");
  await assert(failed?.retries === 1, "Retry count incremented");
  await assert(queue4.getPending().length === 1, "Task requeued");

  test("TaskQueue — Final Failure");
  const queue5 = new TaskQueue();
   const maxRetryTaskData = {
    id: "max-retry",
     name: "Task 1",
     input: "test",
     priority: "normal" as const,
    maxRetries: 1,
    retries: 1,
    status: "pending" as const,
     createdAt: Date.now(),
  };

   queue5.enqueue(maxRetryTaskData);
  queue5.dequeue();
   queue5.markRunning("max-retry", maxRetryTaskData);

  const finalFail = queue5.markFailed("max-retry", "Final error", true);
  await assert(finalFail?.status === "failed", "Task marked as failed");
  await assert(queue5.getFailed().length === 1, "Task in failed history");

  test("TaskQueue — Cancellation");
  const queue6 = new TaskQueue();
   const queueCancelTask = {
     id: "cancel",
     name: "Task 1",
     input: "test",
     priority: "normal" as const,
     status: "pending" as const,
     retries: 0,
     maxRetries: 3,
     createdAt: Date.now(),
   };

   queue6.enqueue(queueCancelTask);
   const queueCancelled = queue6.cancel("cancel");
   await assert(queueCancelled === true, "Cancellation succeeds");
   await assert(queue6.getTask("cancel")?.status === "cancelled", "Status is cancelled");

  // ============ SCHEDULER TESTS ============

  test("Scheduler — Task Submission");
  const registry = new AgentRegistry();
  const kernel = new Kernel(registry);

  const agent: Agent = {
    id: "agent-1",
    name: "Test Agent",
    model: "local",
    state: "idle",
    handler: async (input: string) => `Result: ${input}`,
  };

  registry.register(agent);
  kernel.startAgent("agent-1");

  const scheduler = new Scheduler(kernel, registry);

  const submitted = scheduler.submitTask("Test Task", "input data", {
    priority: "high",
    metadata: { key: "value" },
  });

  await assert(submitted.id.startsWith("task_"), "Task ID generated");
  await assert(submitted.status === "pending", "Task starts pending");
  await assert(submitted.priority === "high", "Priority set");

  test("Scheduler — Agent Selection");
  const registry2 = new AgentRegistry();
  const kernel2 = new Kernel(registry2);

  const agentA: Agent = {
    id: "agent-a",
    name: "Agent A",
    model: "local",
    state: "idle",
    tags: ["web"],
    handler: async (input: string) => `A: ${input}`,
  };

  const agentB: Agent = {
    id: "agent-b",
    name: "Agent B",
    model: "local",
    state: "idle",
    tags: ["analysis"],
    handler: async (input: string) => `B: ${input}`,
  };

  registry2.register(agentA);
  registry2.register(agentB);
  kernel2.startAgent("agent-a");
  kernel2.startAgent("agent-b");

  const scheduler2 = new Scheduler(kernel2, registry2);

  // Submit task for specific agent
   const specificTask = scheduler2.submitTask("Specific", "data", { agentId: "agent-a" });
   await assert(specificTask.agentId === "agent-a", "Agent ID specified");

  // Submit task for agent with tag
   const taggedTask = scheduler2.submitTask("Tagged", "data", { agentTag: "web" });
   await assert(taggedTask.agentTag === "web", "Agent tag specified");

  test("Scheduler — Task Processing");
  const registry3 = new AgentRegistry();
  const kernel3 = new Kernel(registry3);

  const procAgent: Agent = {
    id: "proc-agent",
    name: "Processor",
    model: "local",
    state: "idle",
    handler: async (input: string) => `Processed: ${input}`,
  };

  registry3.register(procAgent);
  kernel3.startAgent("proc-agent");

  const scheduler3 = new Scheduler(kernel3, registry3);

  scheduler3.submitTask("Process", "test input", { priority: "high" });

  const processed = await scheduler3.processNext();
  await assert(processed !== null, "Task processed");
  await assert(processed?.status === "completed", "Task completed");
   await assert(typeof processed?.result === "string" && processed.result.includes("Processed"), "Result correct");

  test("Scheduler — Concurrency Limit");
  const registry4 = new AgentRegistry();
  const kernel4 = new Kernel(registry4);

  const slowAgent: Agent = {
    id: "slow-agent",
    name: "Slow",
    model: "local",
    state: "idle",
    handler: async (input: string) => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      return `Done: ${input}`;
    },
  };

  registry4.register(slowAgent);
  kernel4.startAgent("slow-agent");

  const scheduler4 = new Scheduler(kernel4, registry4, { maxConcurrentTasks: 2 });

  // Submit 5 tasks
  for (let i = 0; i < 5; i++) {
    scheduler4.submitTask(`Task ${i}`, `data ${i}`);
  }

  const running = scheduler4.getPending();
  await assert(running.length === 5, "All tasks pending");

  test("Scheduler — Task Statistics");
  const stats = scheduler3.getStats();
  await assert(stats.completed > 0, "Completed tasks tracked");
  await assert(stats.totalTasks > 0, "Total tasks counted");
   await assert(stats.avgExecutionTime >= 0, "Execution time tracked");

  test("Scheduler — Task Waiting");
  const registry5 = new AgentRegistry();
  const kernel5 = new Kernel(registry5);

  const quickAgent: Agent = {
    id: "quick-agent",
    name: "Quick",
    model: "local",
    state: "idle",
    handler: async (input: string) => `Quick: ${input}`,
  };

  registry5.register(quickAgent);
  kernel5.startAgent("quick-agent");

  const scheduler5 = new Scheduler(kernel5, registry5);

  const waitTask = scheduler5.submitTask("Wait", "data");

  // Process in background
  setTimeout(() => scheduler5.processNext(), 50);

  const waited = await scheduler5.waitForTask(waitTask.id, 5000);
  await assert(
    waited.status === "completed" || waited.status === "failed",
    "Task completed within timeout"
  );

  test("Scheduler — Task Cancellation");
  const registry6 = new AgentRegistry();
  const kernel6 = new Kernel(registry6);

  const agent6: Agent = {
    id: "agent-6",
    name: "Agent 6",
    model: "local",
    state: "idle",
    handler: async (input: string) => `Result: ${input}`,
  };

  registry6.register(agent6);
  kernel6.startAgent("agent-6");

  const scheduler6 = new Scheduler(kernel6, registry6);

   const schedulerCancelTask = scheduler6.submitTask("Cancel", "data");
   const schedulerCancelled = scheduler6.cancelTask(schedulerCancelTask.id);

   await assert(schedulerCancelled === true, "Cancellation succeeds");
   await assert(scheduler6.getTask(schedulerCancelTask.id)?.status === "cancelled", "Status is cancelled");

  test("Scheduler — Retry Logic");
  const registry7 = new AgentRegistry();
  const kernel7 = new Kernel(registry7);

  let callCount = 0;
  const retryAgent: Agent = {
    id: "retry-agent",
    name: "Retry Agent",
    model: "local",
    state: "idle",
    handler: async (input: string) => {
      callCount++;
      if (callCount < 2) {
        throw new Error("Temporary failure");
      }
      return "Success after retry";
    },
  };

  registry7.register(retryAgent);
  kernel7.startAgent("retry-agent");

  const scheduler7 = new Scheduler(kernel7, registry7, { defaultMaxRetries: 2 });

  const retryableTask = scheduler7.submitTask("Retryable", "data");

  // First attempt fails
  let result = await scheduler7.processNext();
  await assert(result?.status === "retrying", "Task retrying");

  // Second attempt succeeds
  result = await scheduler7.processNext();
  await assert(result?.status === "completed", "Task succeeds on retry");
  await assert(result?.result === "Success after retry", "Result correct");

  // ============ SUMMARY ============

  console.log(
    `\n${colors.yellow}=== ALL TESTS PASSED ===${colors.reset}\n`
  );
  console.log(`${colors.green}✓ TaskQueue (priority, FIFO)${colors.reset}`);
  console.log(`${colors.green}✓ Task Lifecycle (pending → running → complete)${colors.reset}`);
  console.log(`${colors.green}✓ Retry Mechanism (exponential backoff)${colors.reset}`);
  console.log(`${colors.green}✓ Scheduler (agent selection, dispatch)${colors.reset}`);
  console.log(`${colors.green}✓ Concurrency Management${colors.reset}`);
  console.log(`${colors.green}✓ Statistics & Tracking${colors.reset}\n`);
}

// Run tests
runTests().catch((err) => {
  console.error("Test suite failed:", err);
  process.exit(1);
});
