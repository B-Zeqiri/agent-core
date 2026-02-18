import * as fs from "fs";
import * as path from "path";

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

async function assert(condition: boolean, msg: string) {
  if (condition) {
    pass(msg);
  } else {
    fail(msg);
  }
}

async function runTests() {
  console.log(`\n${colors.yellow}=== PERSISTENCE & REPLAY TESTS ===${colors.reset}\n`);

  const dataDir = path.join(process.cwd(), ".data");
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  const dbPath = path.join(dataDir, "test-agent-core.db");
  if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
  }

  process.env.PERSIST_DB_PATH = dbPath;
  process.env.PERSIST_DB_DRIVER = "sqlite";
  process.env.PERSIST_AUDIT = "1";
  process.env.PERSIST_MEMORY = "1";
  process.env.PERSIST_REPLAY = "1";

  const { auditStore } = await import("./auditStore");
  const { replayStore } = await import("./replayStore");
  const { closeSqliteDb } = await import("./sqliteDb");
  const { MemoryManager } = await import("../memory/memoryManager");

  const taskId = "task_persist_1";
  const agentId = "agent_persist";

  // Audit persistence
  auditStore.addEvent({
    timestamp: Date.now(),
    eventType: "task-event",
    agentId,
    taskId,
    toolName: undefined,
    details: { message: "audit ok" },
  });

  const auditEvents = auditStore.getEvents({ taskId, limit: 5 });
  await assert(auditEvents.length === 1, "Audit event persisted");
  await assert(auditEvents[0].details.message === "audit ok", "Audit event payload preserved");

  // Replay persistence
  replayStore.recordEvent({
    taskId,
    agentId,
    kind: "model",
    name: "test-model",
    input: { systemPrompt: "sys", userMessage: "hello" },
    output: "world",
    startedAt: Date.now(),
    completedAt: Date.now() + 5,
    metadata: { agentVersion: "1.0.0" },
  });

  const replayEvents = replayStore.getEvents({ taskId });
  await assert(replayEvents.length === 1, "Replay event persisted");
  await assert(replayEvents[0].output === "world", "Replay output preserved");

  // Memory persistence
  const mm1 = new MemoryManager({ enablePersistence: true });
  mm1.createAgentMemory(agentId, 2);
  mm1.writeShort(agentId, agentId, "short", "text");
  mm1.writeLong(agentId, agentId, "long", "insight");

  const mm2 = new MemoryManager({ enablePersistence: true });
  const restored = mm2.createAgentMemory(agentId, 2);
  const restoredStats = restored.getStats();
  await assert(restoredStats.totalSize >= 2, "Memory restored from persistence");

  closeSqliteDb();
  if (fs.existsSync(dbPath)) {
    fs.unlinkSync(dbPath);
  }

  console.log(`\n${colors.green}✓ Persistence tests passed${colors.reset}`);
}

runTests().catch((error) => {
  console.error(error);
  process.exit(1);
});
