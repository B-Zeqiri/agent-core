# Phase 7: Observability & Control System

## Overview
Phase 7 implements comprehensive monitoring, logging, tracing, and health check systems for the agent kernel. It provides real-time visibility into agent activities, message flows, task execution, and system health through both programmatic APIs and REST endpoints.

## Architecture

### Logger (`src/observability/logger.ts`)
Structured logging with multiple levels and filtering capabilities.

**Features**:
- Four log levels: `debug`, `info`, `warn`, `error`
- Source-based filtering (agent, scheduler, ipc, etc.)
- Agent-specific logging
- Configurable max entries with automatic rotation
- Log level filtering (only log INFO and above, for example)

**API**:
```typescript
logger.debug(source, message, data?, agentId?)
logger.info(source, message, data?, agentId?)
logger.warn(source, message, data?, agentId?)
logger.error(source, message, data?, agentId?)

logger.getLogs(count?)
logger.getLogsBySource(source, count?)
logger.getLogsByLevel(level, count?)
logger.getLogsByAgent(agentId, count?)
logger.getStatistics()
logger.clearLogs()
```

**Configuration**:
```typescript
{
  enableLogging: boolean;      // default: true
  logLevel: LogLevel;           // default: "info"
  maxLogEntries: number;        // default: 10000
}
```

### Tracer (`src/observability/tracer.ts`)
Event and message tracing with sampling support.

**Features**:
- Trace events: task creation, completion, failure
- Message tracing: track individual messages through system
- Message delivery tracking (pending → delivered/failed)
- Sample rate filtering (reduce overhead in production)
- Trace ID generation for correlation

**Event Types**:
- `message:sent` - Message sent by agent
- `message:received` - Message received by agent
- `task:created` - Task created in scheduler
- `task:completed` - Task execution succeeded
- `task:failed` - Task execution failed

**API**:
```typescript
tracer.traceEvent(type, agentId, data)        // Returns traceId
tracer.traceMessage(from, to, type, payload, tag?)  // Returns messageId
tracer.markMessageDelivered(messageId, deliveryTime?)
tracer.markMessageFailed(messageId)

tracer.getTraces(count?)
tracer.getTracesByType(type, count?)
tracer.getTracesByAgent(agentId, count?)
tracer.getMessageTraces(count?)
tracer.getMessageTracesByAgent(agentId, count?)
tracer.getMessageTrace(id)
tracer.getStatistics()
tracer.clearTraces()
```

**Configuration**:
```typescript
{
  enableTracing: boolean;       // default: true
  maxTraceEntries: number;      // default: 10000
  traceSampleRate: number;      // default: 1.0 (0-1, percentage)
}
```

### Monitor (`src/observability/monitor.ts`)
Central monitoring hub combining logging, tracing, and metrics.

**Features**:
- Unified access to logger and tracer
- Agent metrics tracking (tasks completed/failed, messages sent/received)
- System metrics (active agents, pending tasks, error rates, latency)
- Health check endpoint
- Historical metrics (last N minutes)

**Agent Metrics**:
```typescript
{
  agentId: string;
  tasksCompleted: number;
  tasksFailed: number;
  averageExecutionTime: number;
  messagesReceived: number;
  messagesSent: number;
  lastActive: number; // timestamp
}
```

**System Metrics**:
```typescript
{
  timestamp: number;
  activeAgents: number;
  pendingTasks: number;
  completedTasks: number;
  failedTasks: number;
  messageCount: number;
  averageLatency: number;
  errorRate: number; // 0-1
}
```

**API**:
```typescript
// Logging (delegates to logger)
monitor.log.info(source, message, data?, agentId?)
monitor.log.debug(...), monitor.log.warn(...), monitor.log.error(...)
monitor.log.getLogs(), monitor.log.getLogsBySource(), etc.

// Tracing (delegates to tracer)
monitor.trace.traceEvent(type, agentId, data)
monitor.trace.traceMessage(from, to, type, payload, tag?)
monitor.trace.getTraces(), monitor.trace.getMessageTraces(), etc.

// Metrics
monitor.getSystemMetrics(): SystemMetrics
monitor.getAgentMetrics(agentId): AgentMetrics
monitor.getAllAgentMetrics(): AgentMetrics[]
monitor.recordTaskCompletion(agentId, executionTime)
monitor.recordTaskFailure(agentId)
monitor.recordMessageSent(agentId, count?)
monitor.recordMessageReceived(agentId, count?)

// Health & History
monitor.getHealth()
monitor.getSystemMetricsHistory(minutes?)
monitor.clear() // Clear all logs, traces, metrics
```

### REST API (`src/observability/api.ts`)
RESTful endpoints for monitoring and inspection.

**Endpoints**:

**Logs**:
- `GET /api/logs` - Get all logs (optional `?count=N`)
- `GET /api/logs/source/:source` - Filter by source
- `GET /api/logs/level/:level` - Filter by level (debug/info/warn/error)
- `GET /api/logs/agent/:agentId` - Filter by agent
- `GET /api/logs/stats` - Log statistics
- `DELETE /api/logs` - Clear logs

**Traces**:
- `GET /api/traces` - Get all traces (optional `?count=N`)
- `GET /api/traces/type/:type` - Filter by type
- `GET /api/traces/agent/:agentId` - Filter by agent
- `GET /api/traces/stats` - Trace statistics
- `DELETE /api/traces` - Clear traces

**Messages**:
- `GET /api/messages` - Get all messages (optional `?count=N`)
- `GET /api/messages/:id` - Get specific message
- `GET /api/messages/agent/:agentId` - Get messages for agent

**Metrics**:
- `GET /api/metrics/system` - Current system metrics
- `GET /api/metrics/agents` - All agent metrics
- `GET /api/metrics/agent/:agentId` - Specific agent metrics

**Health & History**:
- `GET /api/health` - Health check (200 if healthy, 503 if not)
- `GET /api/history` - System history (optional `?minutes=5`)

**Management**:
- `DELETE /api/monitor/clear` - Clear all monitoring data

## Test Coverage

**Observability Tests** (`src/observability/test.ts`): 46 tests
- Logger (12 tests): creation, levels, filtering, statistics, clearing
- Tracer (14 tests): events, messages, delivery tracking, statistics, clearing
- Monitor (15 tests): metrics, health, history, agent tracking
- Log level filtering (1 test)
- Sample rate filtering (1 test)
- Disabled monitoring (2 tests)

**All Phases**: 187 + 22 + 46 = **255 tests passing** ✅

## Integration Points

### Kernel Integration
Monitor receives kernel reference and accesses:
- `kernel.getStats()` - execution counts, times, agent state
- `kernel.getRegistry()` - active agents, agent state

### IPC Integration (Phase 6)
Monitor can trace:
- Message flow through system
- Delivery success/failure
- Per-agent message counts

### Scheduler Integration (Phase 5)
Monitor tracks:
- Task creation events
- Task completion/failure
- Average execution times
- Task queue depth

## Configuration & Usage

### In Kernel
```typescript
const monitor = new Monitor(kernel, {
  enableLogging: true,
  enableTracing: true,
  logLevel: "info",
  maxLogEntries: 10000,
  maxTraceEntries: 10000,
  traceSampleRate: 1.0 // 100% sampling
});

// Record task execution
monitor.recordTaskCompletion("a1", 150);
monitor.recordTaskFailure("a2");

// Record messages
monitor.recordMessageSent("a1", 5);
monitor.recordMessageReceived("a2", 5);

// Get metrics
const systemMetrics = monitor.getSystemMetrics();
const agentMetrics = monitor.getAgentMetrics("a1");
const health = monitor.getHealth();
```

### As REST API
```typescript
import { Express } from "express";
import { Monitor } from "./observability/monitor";
import { MonitoringAPI } from "./observability/api";

const app: Express = ...;
const monitor = new Monitor(kernel);
new MonitoringAPI(app, monitor); // Registers all endpoints
```

## Performance Considerations

**Log Rotation**: Automatically keeps most recent N entries (default 10,000)
**Trace Sampling**: Configurable sample rate (0-1) reduces overhead
**Memory**: Each log/trace entry is kept in memory; clear periodically for long-running systems
**Async**: All monitoring operations are synchronous (fast); can batch clear operations

## Production Deployment

### Recommended Settings
```typescript
{
  enableLogging: true,
  enableTracing: true,
  logLevel: "warn",           // Only log warnings and errors
  maxLogEntries: 50000,       // Keep 50k logs for investigation
  maxTraceEntries: 10000,     // Keep 10k traces
  traceSampleRate: 0.1        // 10% sampling to reduce overhead
}
```

### Health Check
```typescript
const health = monitor.getHealth();
if (health.healthy) {
  // System is operating normally
} else {
  // Error rate > 10% or no agents
  // Alert or take action
}
```

## Future Enhancements

- **Persistent Storage**: Write logs/traces to database/file system
- **Alerting**: Trigger alerts on error thresholds
- **Dashboards**: Web UI for real-time monitoring
- **Metrics Export**: Prometheus/OpenMetrics format
- **Distributed Tracing**: Correlation across multiple kernel instances
- **Performance Profiling**: Track function execution times
- **Custom Metrics**: User-defined metrics tracking

## File Structure
```
src/observability/
  ├── types.ts       # Type definitions
  ├── logger.ts      # Logger implementation
  ├── tracer.ts      # Tracer implementation
  ├── monitor.ts     # Monitor coordinator
  ├── api.ts         # REST API endpoints
  └── test.ts        # 46 unit tests
```
