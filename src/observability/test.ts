import { Logger } from "./logger";
import { Tracer } from "./tracer";
import { Monitor } from "./monitor";
import { Kernel } from "../kernel/kernel";
import { AgentRegistry } from "../kernel/registry";

const colors = { reset: "\x1b[0m", green: "\x1b[32m", red: "\x1b[31m", blue: "\x1b[34m" };
function pass(msg: string) { console.log(`${colors.green}✓${colors.reset} ${msg}`); }
function fail(msg: string) { console.log(`${colors.red}✗${colors.reset} ${msg}`); process.exit(1); }
async function assert(cond: boolean, msg: string) { if (cond) pass(msg); else fail(msg); }

async function run() {
  console.log(`\n${colors.blue}→ Phase 7: Observability & Control Tests${colors.reset}\n`);

  // Logger Tests
  console.log(`${colors.blue}→ Logger${colors.reset}`);
  const logger = new Logger({ enableLogging: true, logLevel: "debug", maxLogEntries: 1000 });
  
  logger.info("test", "Hello world");
  let logs = logger.getLogs();
  await assert(logs.length === 1, "Logger.info creates entry");
  await assert(logs[0].level === "info", "Log entry has correct level");
  await assert(logs[0].message === "Hello world", "Log entry has correct message");

  logger.debug("test", "Debug msg");
  logger.warn("test", "Warn msg");
  logger.error("test", "Error msg", { code: 500 });
  logs = logger.getLogs();
  await assert(logs.length === 4, "All log levels work");

  logs = logger.getLogsByLevel("error");
  await assert(logs.length === 1 && logs[0].message === "Error msg", "getLogsByLevel filters correctly");

  logs = logger.getLogsBySource("test");
  await assert(logs.length === 4, "getLogsBySource works");

  logger.info("other", "Other source");
  logs = logger.getLogsBySource("other");
  await assert(logs.length === 1, "Multiple sources tracked");

  logger.info("test", "Agent action", { action: "execute" }, "a1");
  logs = logger.getLogsByAgent("a1");
  await assert(logs.length === 1, "getLogsByAgent works");

  const stats = logger.getStatistics();
  await assert(stats.totalLogs === 6, "Statistics show total logs");
  await assert(stats.byLevel.info === 3, "Statistics track by level");
  await assert(stats.bySource.test === 5, "Statistics track by source");

  logger.clearLogs();
  await assert(logger.getLogs().length === 0, "clearLogs empties logger");

  // Tracer Tests
  console.log(`${colors.blue}→ Tracer${colors.reset}`);
  const tracer = new Tracer({ enableTracing: true, traceSampleRate: 1.0, maxTraceEntries: 1000 });

  const traceId = tracer.traceEvent("task:created", "a1", { taskId: "t1" });
  await assert(traceId !== "", "traceEvent returns ID");
  
  let traces = tracer.getTraces();
  await assert(traces.length === 1, "Trace recorded");
  await assert(traces[0].type === "task:created", "Trace has correct type");
  await assert(traces[0].agentId === "a1", "Trace has correct agent");

  tracer.traceEvent("task:completed", "a1", { taskId: "t1", duration: 100 });
  tracer.traceEvent("task:failed", "a2", { taskId: "t2", error: "timeout" });
  traces = tracer.getTraces();
  await assert(traces.length === 3, "Multiple traces recorded");

  traces = tracer.getTracesByType("task:completed");
  await assert(traces.length === 1, "getTracesByType filters");

  traces = tracer.getTracesByAgent("a1");
  await assert(traces.length === 2, "getTracesByAgent filters");

  // Message Traces
  const msgId = tracer.traceMessage("a1", "a2", "greeting", { text: "hello" }, "team");
  await assert(msgId !== "", "traceMessage returns ID");
  
  let msgs = tracer.getMessageTraces();
  await assert(msgs.length === 1 && msgs[0].status === "pending", "Message trace created with pending status");

  tracer.markMessageDelivered(msgId, 50);
  const msg = tracer.getMessageTrace(msgId);
  await assert(msg?.status === "delivered" && msg?.deliveryTime === 50, "markMessageDelivered updates status and time");

  const msgId2 = tracer.traceMessage("a1", "a3", "greeting", { text: "hi" }, "team");
  tracer.markMessageFailed(msgId2);
  msgs = tracer.getMessageTraces();
  await assert(msgs.length === 2, "Two messages traced");

  msgs = tracer.getMessageTracesByAgent("a1");
  await assert(msgs.length === 2, "getMessageTracesByAgent for sender works");

  msgs = tracer.getMessageTracesByAgent("a2");
  await assert(msgs.length === 1, "getMessageTracesByAgent for receiver works");

  const msgStats = tracer.getStatistics();
  await assert(msgStats.totalMessages === 2, "Message statistics correct");
  await assert(msgStats.messageStats.delivered === 1, "Message delivery tracking correct");

  tracer.clearTraces();
  await assert(tracer.getTraces().length === 0 && tracer.getMessageTraces().length === 0, "clearTraces empties tracer");

  // Monitor Tests
  console.log(`${colors.blue}→ Monitor${colors.reset}`);
  const registry = new AgentRegistry();
  registry.register({ id: "a1", name: "A1", model: "m", state: "idle", handler: async (task) => task });
  registry.register({ id: "a2", name: "A2", model: "m", state: "idle", handler: async (task) => task });
  
  const kernel = new Kernel(registry);
  const monitor = new Monitor(kernel, { enableLogging: true, enableTracing: true });

  monitor.log.info("test", "Monitor created");
  await assert(monitor.log.getLogs().length === 1, "Monitor logger works");

  monitor.trace.traceEvent("task:created", "a1", { taskId: "t1" });
  await assert(monitor.trace.getTraces().length === 1, "Monitor tracer works");

  const metrics = monitor.getSystemMetrics();
  await assert(metrics.activeAgents === 0, "System metrics show inactive agents");
  await assert(metrics.completedTasks === 0, "System metrics show tasks");
  await assert(metrics.messageCount === 0, "System metrics show messages");

  monitor.recordTaskCompletion("a1", 100);
  const agentMetrics = monitor.getAgentMetrics("a1");
  await assert(agentMetrics.tasksCompleted === 1, "recordTaskCompletion tracked");
  await assert(agentMetrics.averageExecutionTime === 100, "Average execution time calculated");

  monitor.recordTaskCompletion("a1", 200);
  const agentMetrics2 = monitor.getAgentMetrics("a1");
  await assert(agentMetrics2.tasksCompleted === 2, "Task count incremented");
  await assert(agentMetrics2.averageExecutionTime === 150, "Average execution time updated");

  monitor.recordTaskFailure("a1");
  const agentMetrics3 = monitor.getAgentMetrics("a1");
  await assert(agentMetrics3.tasksFailed === 1, "recordTaskFailure tracked");

  monitor.recordMessageSent("a1", 5);
  const agentMetrics4 = monitor.getAgentMetrics("a1");
  await assert(agentMetrics4.messagesSent === 5, "recordMessageSent tracked");

  monitor.recordMessageReceived("a2", 3);
  const agentMetrics5 = monitor.getAgentMetrics("a2");
  await assert(agentMetrics5.messagesReceived === 3, "recordMessageReceived tracked");

  const allMetrics = monitor.getAllAgentMetrics();
  await assert(allMetrics.length === 2, "getAllAgentMetrics returns all");

  const health = monitor.getHealth();
  await assert(health.agentCount === 2, "Health check shows agent count");
  await assert(typeof health.uptime === "number", "Health check shows uptime");

  // History window test
  monitor.log.info("test", "Historical entry");
  monitor.trace.traceEvent("task:created", "a1", { taskId: "t2" });
  const history = monitor.getSystemMetricsHistory();
  await assert(history.logs.length > 0, "History includes logs");
  await assert(history.traces.length > 0, "History includes traces");

  const history5min = monitor.getSystemMetricsHistory(5);
  await assert(history5min.minutes === 5, "History window set correctly");

  monitor.clear();
  await assert(monitor.log.getLogs().length === 0, "clear() empties logs");
  await assert(monitor.trace.getTraces().length === 0, "clear() empties traces");

  // Log level filtering
  console.log(`${colors.blue}→ Log Level Filtering${colors.reset}`);
  const levelLogger = new Logger({ enableLogging: true, logLevel: "warn" });
  levelLogger.debug("test", "Debug");
  levelLogger.info("test", "Info");
  levelLogger.warn("test", "Warn");
  levelLogger.error("test", "Error");
  const levelLogs = levelLogger.getLogs();
  await assert(levelLogs.length === 2 && levelLogs[0].level === "warn", "Log level filtering works");

  // Sample rate test
  console.log(`${colors.blue}→ Sample Rate Filtering${colors.reset}`);
  const sampleTracer = new Tracer({ enableTracing: true, traceSampleRate: 0.1 });
  let sampleCount = 0;
  for (let i = 0; i < 100; i++) {
    if (sampleTracer.traceEvent("task:created", "a1", {}) !== "") sampleCount++;
  }
  await assert(sampleCount < 50 && sampleCount > 0, "Sample rate filtering works");

  // Disabled monitoring
  console.log(`${colors.blue}→ Disabled Monitoring${colors.reset}`);
  const disabledLogger = new Logger({ enableLogging: false });
  disabledLogger.info("test", "Should not log");
  await assert(disabledLogger.getLogs().length === 0, "Disabled logger doesn't log");

  const disabledTracer = new Tracer({ enableTracing: false });
  disabledTracer.traceEvent("task:created", "a1", {});
  await assert(disabledTracer.getTraces().length === 0, "Disabled tracer doesn't trace");

  console.log(`\n${colors.green}All Phase 7 tests passed${colors.reset}\n`);
}

run().catch((e) => { console.error(e); process.exit(1); });
