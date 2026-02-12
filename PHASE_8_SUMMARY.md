# Phase 8: UI & Dashboard Layer

## Overview

Phase 8 completes the agent core operating system with a real-time monitoring and visualization layer. The UI system provides:

- **WebSocket Server** for real-time state streaming
- **REST API** with 12+ endpoints for querying agent metrics and logs
- **HTML5 Dashboard** with modern responsive design
- **State Management** integrated with Kernel and Monitor
- **Filtering & Aggregation** for logs, traces, and messages

**Total Tests**: 46 (all passing)

## Architecture

### Components

#### 1. Type System (`src/ui/types.ts`)

- **DashboardState**: Complete snapshot of system state
  - `agents`: Array of agent statuses
  - `tasks`: Task queue snapshot
  - `messages`: IPC message history
  - `systemMetrics`: Real-time metrics
  - `health`: System health status
  - `timestamp`: Update timestamp

- **AgentStatus**: Agent metadata and metrics
  - `id`, `name`, `state`, `tags`, `permissions`
  - Task counts: `taskCount`, `completedCount`, `failedCount`
  - Message counts: `messagesSent`, `messagesReceived`

- **UIConfig**: Configuration options
  - `enableWebSocket`: Enable real-time updates (default: true)
  - `enableDashboard`: Enable dashboard API (default: true)
  - `updateInterval`: State broadcast interval (default: 1000ms)
  - `maxHistoryLength`: Max stored entries (default: 1000)

#### 2. WebSocket Server (`src/ui/wsServer.ts`)

**UIServer Class**

```typescript
new UIServer(httpServer, kernel, monitor, config)
```

**Key Methods**:

- `setupWebSocket()`: Initialize WebSocket server
- `getState()`: Get current DashboardState snapshot
  - Collects agent status from kernel registry
  - Merges metrics from monitor
  - Includes task and message history
  - Tracks system health

- `getLogs(count?, source?, level?)`: Get logs with filtering
  - Returns up to `count` most recent logs
  - Filters by source (e.g., "kernel", "ipc", "tools")
  - Filters by level (debug, info, warn, error)

- `getTraces(count?, type?, agentId?)`: Get traces with filtering
  - Returns up to `count` most recent traces
  - Filters by type (task-start, task-complete, etc.)
  - Filters by agent ID

- `getMessages(count?, agentId?)`: Get IPC messages with filtering
  - Returns up to `count` most recent messages
  - Filters by sender or receiver (agentId)

- `broadcast(message)`: Send message to all connected clients
- `startUpdates()`: Start periodic state broadcasts
- `stopUpdates()`: Stop periodic broadcasts

**WebSocket Messages**:

```typescript
interface WSMessage {
  type: string;           // "state", "logs", "traces", "metrics"
  payload: unknown;       // Message data
  timestamp: number;      // Sent timestamp
}
```

**Client Subscriptions**:
- `subscribe:logs` → Receive latest logs
- `subscribe:traces` → Receive latest traces
- `subscribe:metrics` → Receive system metrics
- `subscribe:state` → Receive full state updates
- `unsubscribe:state` → Stop receiving state updates

#### 3. REST API (`src/ui/api.ts`)

**DashboardAPI Class**

```typescript
new DashboardAPI(app, uiServer, config)
```

**Endpoints**:

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/dashboard/state` | Full system state |
| GET | `/dashboard/agents` | All agents with status |
| GET | `/dashboard/agents/:id` | Specific agent details |
| GET | `/dashboard/metrics` | System metrics snapshot |
| GET | `/dashboard/health` | System health status |
| GET | `/dashboard/logs?source=&level=` | Filtered logs |
| GET | `/dashboard/traces?type=&agentId=` | Filtered traces |
| GET | `/dashboard/messages?agentId=` | Filtered messages |
| GET | `/dashboard/timeline?minutes=` | Historical metrics |
| GET | `/dashboard/agents/:id/history` | Agent activity history |
| GET | `/dashboard/summary` | Stats summary |
| GET | `/dashboard/stats` | Detailed statistics |

**Response Format**:

```typescript
// Success
{ success: true, data: { ... } }

// Error
{ success: false, error: "message" }
```

#### 4. HTML Dashboard (`src/ui/public/index.html`)

**Features**:

- **Header**:
  - Health indicator (green/red pulse animation)
  - Connection status (WebSocket)
  - Timestamp of last update

- **Metrics Cards Grid**:
  - Active agents count
  - Pending tasks count
  - Completed tasks count
  - Failed tasks count
  - Average latency
  - Error rate %

- **Tabbed Interface**:
  - **Agents Tab**: Agent list with state badges
  - **Logs Tab**: Colored log entries (debug/info/warn/error)
  - **Messages Tab**: IPC message flow visualization
  - **Traces Tab**: Execution trace history

- **Real-time Updates**:
  - WebSocket auto-reconnect (3s timeout)
  - State update callback handlers
  - Automatic UI refresh

- **Styling**:
  - Modern gradient background
  - Responsive grid layout
  - Color-coded status badges
  - Smooth animations

## Integration

### With Kernel

- Accesses `kernel.getRegistry()` for agent list
- Monitors `kernel.getStats()` for execution metrics

### With Monitor

- Reads logs from `monitor.log.getLogs()`
- Reads traces from `monitor.trace.getTraces()`
- Gets metrics from `monitor.getSystemMetrics()`
- Gets health from `monitor.getHealth()`

## Key Features

### 1. Real-time State Management

```typescript
const state = uiServer.getState();
// Returns: DashboardState with full snapshot
```

Snapshot includes:
- Agent status with task/message counts
- Running tasks with progress
- Recent messages with delivery status
- System metrics (latency, error rate, throughput)
- Health indicators

### 2. Filtering & Aggregation

**Logs**:
```typescript
uiServer.getLogs(10, "kernel", "error")
// Returns: Last 10 errors from kernel source
```

**Traces**:
```typescript
uiServer.getTraces(20, "task-complete", "agent-1")
// Returns: Last 20 task completions for agent-1
```

**Messages**:
```typescript
uiServer.getMessages(15, "agent-2")
// Returns: Last 15 messages from/to agent-2
```

### 3. Count=0 Handling

All filtering methods now correctly handle `count=0`:

```typescript
getLogs(0)      // Returns []
getTraces(0)    // Returns []
getMessages(0)  // Returns []
```

Previously these would return all entries due to falsy check.

## Test Coverage

### UIServer Tests (22 tests)
- ✓ State generation and structure
- ✓ Agent status tracking
- ✓ Metrics aggregation
- ✓ Health monitoring
- ✓ Timestamp management

### Filtering Tests (14 tests)
- ✓ getLogs with count limit
- ✓ getLogs by source
- ✓ getLogs by level
- ✓ getTraces with count limit
- ✓ getTraces by type
- ✓ getTraces by agent
- ✓ getMessages with count limit
- ✓ getMessages by agent

### Metrics Tests (5 tests)
- ✓ Task completion tracking
- ✓ Task failure tracking
- ✓ Message sent/received tracking
- ✓ Metrics consistency
- ✓ Timestamp progression

### Edge Cases (5 tests)
- ✓ count=0 returns empty
- ✓ Nonexistent source filter
- ✓ Nonexistent type filter
- ✓ Nonexistent agent filter
- ✓ State property types

## Usage Examples

### Starting UI Server

```typescript
import { UIServer } from "./ui/wsServer";
import { DashboardAPI } from "./ui/api";

const httpServer = createServer();
const uiServer = new UIServer(httpServer, kernel, monitor, {
  enableWebSocket: true,
  updateInterval: 1000,
  maxHistoryLength: 1000
});

new DashboardAPI(app, uiServer);

httpServer.listen(3000);
```

### WebSocket Connection (Client)

```javascript
const ws = new WebSocket('ws://localhost:3000/dashboard');

ws.onmessage = (event) => {
  const { type, payload, timestamp } = JSON.parse(event.data);
  
  if (type === 'state') {
    updateDashboard(payload);
  } else if (type === 'logs') {
    appendLogs(payload);
  }
};

// Subscribe to state updates
ws.send(JSON.stringify({ type: 'subscribe:state' }));
```

### REST API Usage

```bash
# Get all agents
curl http://localhost:3000/dashboard/agents

# Get agent details
curl http://localhost:3000/dashboard/agents/agent-1

# Get error logs from kernel
curl "http://localhost:3000/dashboard/logs?source=kernel&level=error"

# Get task completion traces for agent
curl "http://localhost:3000/dashboard/traces?type=task-complete&agentId=agent-1"

# Get system health
curl http://localhost:3000/dashboard/health
```

## Performance

- **State Generation**: O(n) where n = number of agents
- **Filtering**: O(m) where m = log/trace count (limited by storage)
- **WebSocket Broadcast**: O(c) where c = connected clients
- **Memory Usage**: Configurable via `maxHistoryLength`

## Dependencies

- `ws`: ^8.16.0 (WebSocket server)
- `@types/ws`: ^8.5.x (TypeScript types)
- Built-in: Node.js http module

## Files Modified/Created

**New Files**:
- `src/ui/types.ts` (70 lines)
- `src/ui/wsServer.ts` (183 lines)
- `src/ui/api.ts` (145 lines)
- `src/ui/public/index.html` (400+ lines)
- `src/ui/test.ts` (189 lines)

**Modified Files**:
- `src/observability/logger.ts`: Fixed count=0 handling in 4 methods
- `src/observability/tracer.ts`: Fixed count=0 handling in 6 methods
- `src/kernel/kernel.ts`: Added getRegistry() public method
- `src/observability/monitor.ts`: Updated to use new kernel methods
- `package.json`: Added ws dependency and test:ui script

## Summary

Phase 8 provides complete operational visibility into the agent system:

✅ **Real-time Monitoring**: WebSocket for live state streaming
✅ **Query API**: REST endpoints for historical analysis
✅ **Dashboard UI**: Interactive visualization
✅ **Filtering**: Source, level, type, agent-based filtering
✅ **Metrics**: Task execution, message flow, error rates
✅ **Health Indicators**: System uptime, agent count, error rate

**Total System Tests**: 301 tests passing across all 8 phases

### Next Steps: Phase 9 (Security & Sandboxing)

With complete operational visibility in place, Phase 9 will add:
- Agent sandboxing and resource limits
- Permission escalation prevention
- Tool execution quarantine
- Network isolation
- File system access control

---

**Status**: ✅ Phase 8 Complete (46/46 tests passing)
