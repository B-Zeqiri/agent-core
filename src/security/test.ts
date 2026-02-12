import { ToolManager } from "../tools/toolManager";
import { BaseTool, ToolConfig, ToolCall } from "../tools/tool.interface";
import { auditLogger } from "./auditLogger";

const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
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

class SlowTool extends BaseTool {
  constructor(cfg: ToolConfig) {
    super(cfg);
  }

  validate(args: Record<string, any>) {
    return { valid: true };
  }

  async isHealthy(): Promise<boolean> {
    return true;
  }

  async execute(args: Record<string, any>): Promise<any> {
    const ms = args.delay || 2000;
    return new Promise((resolve) => setTimeout(() => resolve({ ok: true }), ms));
  }
}

async function run() {
  console.log('\n→ PHASE 9: SECURITY & SANDBOXING\n');

  const tm = new ToolManager();
  auditLogger.clear();

  // Test 1: Timeout Enforcement
  test("Timeout Enforcement");
  const slowCfg: ToolConfig = {
    name: "slow-tool",
    type: "custom",
    description: "Slow tool",
    requiredPermissions: [],
    timeout: 300,
    rateLimit: 10,
  };

  const slowTool = new SlowTool(slowCfg);
  tm.registerTool(slowTool);
  tm.grantPermission("agent-1", "slow-tool");

    const res = await tm.callTool("agent-1", {
    toolName: "slow-tool",
    args: { delay: 1000 },
  });

  await assert(!res.success && (res.error?.toLowerCase().includes("timed") ?? false), "Tool timed out as expected");

  // Test 2: Audit Logging - Timeout Event
  test("Audit Logging - Timeouts");
  const timeoutEvents = auditLogger.getEvents({ eventType: "tool-timeout" });
  await assert(timeoutEvents.length > 0, "Timeout logged in audit");
  await assert(timeoutEvents[0].agentId === "agent-1", "Audit event has agent ID");
  await assert(timeoutEvents[0].toolName === "slow-tool", "Audit event has tool name");

  // Test 3: Permission Denial Audit
  test("Audit Logging - Permission Denial");
  const res2 = await tm.callTool("agent-2", {
      toolName: "slow-tool",
    args: { delay: 100 },
  });

  await assert(!res2.success && (res2.error?.includes("permission") ?? false), "Permission denied");

  const permissionEvents = auditLogger.getEvents({ eventType: "permission-denied" });
  await assert(permissionEvents.length > 0, "Permission denial logged");

  // Test 4: Successful Execution Audit
  test("Audit Logging - Successful Execution");
  tm.grantPermission("agent-2", "slow-tool");
  const res3 = await tm.callTool("agent-2", {
      toolName: "slow-tool",
    args: { delay: 50 },
  });

  await assert(res3.success, "Tool executed successfully");

  const successEvents = auditLogger.getEvents({ eventType: "tool-call", limit: 10 });
  await assert(successEvents.length > 0, "Successful execution logged");

  // Test 5: Audit Statistics
  test("Audit Statistics");
  const stats = auditLogger.getStats();
  await assert(stats.totalEvents > 0, "Audit events recorded");
  await assert(stats.byAgent["agent-1"] !== undefined, "Agent stats tracked");
  await assert(stats.byTool["slow-tool"] !== undefined, "Tool stats tracked");

  // Test 6: Rate Limiting Audit
  test("Rate Limiting & Audit");
  const fastCfg: ToolConfig = {
    name: "fast-tool",
    type: "custom",
    description: "Fast tool",
    requiredPermissions: [],
    timeout: 5000,
    rateLimit: 1, // 1 call per minute
  };

  class FastTool extends BaseTool {
    validate(args: Record<string, any>) {
      return { valid: true };
    }
    async isHealthy(): Promise<boolean> {
      return true;
    }
    async execute(args: Record<string, any>): Promise<any> {
      const startTime = Date.now();
      try {
        const result = { ok: true };
        const executionTime = Date.now() - startTime;
        (this as any).recordCall(true, executionTime);
        return result;
      } catch (err) {
        const executionTime = Date.now() - startTime;
        const errorMsg = err instanceof Error ? err.message : String(err);
        (this as any).recordCall(false, executionTime, errorMsg);
        throw err;
      }
    }
  }

  const fastTool = new FastTool(fastCfg);
  tm.registerTool(fastTool);
  tm.grantPermission("agent-3", "fast-tool");

  // First call succeeds
    const res4 = await tm.callTool("agent-3", {
    toolName: "fast-tool",
    args: {},
  });
  await assert(res4.success, "First call succeeds");

  // Second call hits rate limit
  const res5 = await tm.callTool("agent-3", {
    toolName: "fast-tool",
    args: {},
  });
  await assert(!res5.success && (res5.error?.toLowerCase().includes("rate") ?? false), "Rate limit enforced");

  const rateLimitEvents = auditLogger.getEvents({ eventType: "rate-limit-exceeded" });
  await assert(rateLimitEvents.length > 0, "Rate limit violation logged");

  // Test 7: Agent Isolation
  test("Agent Isolation");
    const res6 = await tm.callTool("agent-new", {
    toolName: "slow-tool",
    args: {},
  });
  await assert(!res6.success && (res6.error?.includes("permission") ?? false), "Unknown agent denied access");

  // Test 8: Filtering Audit Events
  test("Audit Event Filtering");
  const agent1Events = auditLogger.getEvents({ agentId: "agent-1", limit: 100 });
  await assert(agent1Events.every(e => e.agentId === "agent-1"), "Filtering by agent works");

  const slowToolEvents = auditLogger.getEvents({ toolName: "slow-tool", limit: 100 });
  await assert(slowToolEvents.every(e => e.toolName === "slow-tool"), "Filtering by tool works");

  console.log('\n✓ All Phase 9 security tests passed\n');
  process.exit(0);
}

run();
