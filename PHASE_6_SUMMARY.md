# Phase 6: Inter-Process Communication (IPC) System

## Overview
Phase 6 implements a secure, multi-channel messaging system for agent-to-agent communication with permission enforcement, rate limiting, and per-agent ACL (Access Control Lists) filtering.

## Architecture

### MessageBus (`src/ipc/messageBus.ts`)
Pub/Sub message broker with three channel types:
- **Agent Channels**: `agent:{agentId}` for direct messages
- **Tag Channels**: `tag:{tagName}` for broadcast to agents with a specific tag
- **Broadcast Channel**: `broadcast` for system-wide announcements

**Methods**:
- `subscribe(channel, handler)`: Subscribe to a channel, returns unsubscribe function
- `publish(channel, message)`: Emit a message on a channel
- `once(channel, handler)`: Subscribe for single message
- `unsubscribe(channel, handler)`: Remove handler

### IPCManager (`src/ipc/ipcManager.ts`)
Central coordinator for all IPC operations with security and ACL enforcement.

**Configuration**:
```typescript
type IPCConfig = {
  maxPerWindow?: number;  // default: 100 messages
  windowMs?: number;      // default: 60000ms (1 minute)
};
```

**Permission Model**:
- **Sender**: Requires one of `["ipc:send", "ipc:send:tag", "ipc:send:broadcast"]`
- **Receiver**: Requires `"ipc:receive"` (skipped silently if absent during tag/broadcast)
- **Rate Limiting**: Per-sender sliding window (consumed once per send operation)

**ACL (Access Control List)**:
Each agent can have an allowlist and/or denylist for tags:
- **No ACL**: Agent accepts all tags/broadcasts (default)
- **Allowlist only**: Agent only accepts tags in the allowlist
- **Denylist only**: Agent rejects tags in the denylist, accepts all others
- **Both**: Denylist is checked first (deny wins), then allowlist

**Core Methods**:

#### Sending
- `sendToAgent(from, to, type, payload, permissions?, requireReceive?)`: Direct agent-to-agent
- `sendToTag(from, tag, type, payload)`: Send to all agents with a tag (respects ACL)
- `broadcast(from, type, payload)`: Send to all agents except sender (respects ACL)

#### Subscription
- `subscribeAgent(agentId, handler)`: Subscribe to direct messages
- `subscribeTag(tag, handler)`: Subscribe to tag channel
- `subscribeBroadcast(handler)`: Subscribe to broadcast channel

#### Inbox Management
- `getInbox(agentId)`: Retrieve message history
- `clearInbox(agentId)`: Clear agent's inbox

#### ACL Management
- `grantTagPermission(agentId, tag)`: Add to allowlist
- `revokeTagPermission(agentId, tag)`: Remove from allowlist
- `denyTag(agentId, tag)`: Add to denylist (blocks receiving)
- `undenyTag(agentId, tag)`: Remove from denylist
- `getTagACL(agentId)`: Retrieve { allowed: string[], denied: string[] }
- `clearTagACL(agentId)`: Delete all ACL for agent

### Kernel Integration (`src/kernel/kernel.ts`)
The Kernel creates an IPCManager on initialization and:
- Auto-subscribes agents to their direct message channel on `startAgent()`
- Emits `ipc:message` events through agent's `onMessage()` handler
- Cleans up subscriptions on `stopAgent()` and `unregisterAgent()`
- Exposes `getIPCManager()` for direct access

**Usage**:
```typescript
kernel.getIPCManager().sendToTag("a1", "team", "alert", { msg: "urgent" });
```

## Test Coverage

**IPC Tests** (`src/ipc/test.ts`): 21 tests
- Permission enforcement (send/receive)
- Rate limiting (per-sender sliding window)
- Tag-based messaging (sendToTag ACL filtering)
- Broadcast messaging (broadcast ACL filtering)
- ACL grant/revoke/deny/undeny operations
- getTagACL and clearTagACL
- Inbox management

**IPC Integration Tests** (`src/ipc/integration.test.ts`): 1 test
- Kernel + IPC integration (agent receives message)

**All Phases**: 187 + 22 = **209 tests passing**

## Security Model

### Permission Enforcement
```
SendToAgent:
  1. Check sender has ipc:send (or allowed override)
  2. Check rate limit (per-sender sliding window)
  3. Check receiver has ipc:receive (if required)
  4. Store in inbox, publish on channel

SendToTag/Broadcast:
  1. Check sender has ipc:send/ipc:send:tag/ipc:send:broadcast
  2. Check rate limit (once per operation)
  3. For each agent:
     - Check receiver has ipc:receive (skip silently if not)
     - Check receiver ACL allows the tag (skip silently if not)
     - Store in inbox, publish on channel
```

### ACL Semantics
```
canReceiveTag(agentId, tag):
  1. If no ACL → return true (accept all)
  2. If tag in denylist → return false (deny wins)
  3. If allowlist exists and non-empty:
     - return true if tag in allowlist
     - return false otherwise
  4. If no allowlist or empty → return true
```

### Rate Limiting
- Per-sender sliding window
- One message = one unit (regardless of recipients)
- Window resets if now - windowStart > windowMs
- Throws `Error` if limit exceeded

## File Structure
```
src/ipc/
  ├── types.ts           # IPCMessage, MessageHandler
  ├── messageBus.ts      # MessageBus pub/sub
  ├── ipcManager.ts      # IPCManager with permissions + ACL + rate limits
  ├── test.ts            # 21 unit tests
  └── integration.test.ts # 1 integration test with Kernel
```

## Example Usage

### Direct Messaging
```typescript
const kernel = new Kernel(registry);
const ipc = kernel.getIPCManager();

// Grant permissions
registry.get("a1")!.permissions = ["ipc:send"];
registry.get("a2")!.permissions = ["ipc:receive"];

// Send direct message
ipc.sendToAgent("a1", "a2", "greeting", { text: "hello" });

// Agent a2 receives via subscription
const unsub = ipc.subscribeAgent("a2", (msg) => {
  console.log(`Received: ${msg.payload.text}`);
});
```

### Tag-Based Messaging with ACL
```typescript
// Grant team members ipc:receive
team.forEach(agent => {
  agent.permissions = ["ipc:receive"];
});

// Only send to "alerts" tag members
ipc.sendToTag("manager", "alerts", "alert", { level: "critical" });

// But a2 is in alerts tag and denied it
ipc.denyTag("a2", "alerts");
// Now a2 won't receive alerts tag messages

// Grant it back
ipc.grantTagPermission("a2", "alerts");
// Now a2 receives alerts again
```

### Broadcast with ACL Filtering
```typescript
// Broadcast to all (except a3 who denied broadcast)
ipc.denyTag("a3", "broadcast");
const msgs = ipc.broadcast("system", "status", { online: true });
// a3 is skipped, others receive
```

## Future Phases

**Phase 7**: Observability & Control
- Logging and tracing for all IPC messages
- REST/WebSocket endpoints for monitoring
- Message inspection and replay

**Phase 8**: UI (Optional)
- Web dashboard for agent visualization
- IPC message explorer

**Phase 9**: Security & Sandboxing
- Message encryption (TLS)
- Message signing (JWT)
- Execution isolation

**Phase 10**: Productization
- Deployment documentation
- Performance benchmarks
- Production deployment guide
