# Phase 3 — Platform Power

This phase turns the runtime into a platform developers can trust: observable, deterministic, composable, and replayable.

## Guiding Rules

- Kernel-owned truth: live task state and cancellation are platform responsibilities.
- Event-driven introspection: `currentStep` and `logs` are derived from structured events.
- One contract: built-in agents and plugins cross the same kernel/API boundaries.
- UI is a client: no UI-only agent system; UI-generated agents compile to the same plugin contract.

## Step 1 — Agent State Introspection

### Goal
Make "what is my agent doing right now?" answerable via API, without reading server console logs.

### API
Add `GET /api/task/:id/details` returning:

```json
{
  "taskId": "...",
  "status": "running",
  "agent": "plugin:web-dev",
  "startedAt": 0,
  "elapsedMs": 12345,
  "logs": [],
  "currentStep": "calling http.fetch",
  "cancelable": true
}
```

### Requirements
- Single source of truth for live task state (kernel-owned; in-memory is fine initially).
- `cancelable` must reflect real execution state (e.g. active abort controller exists and is not already aborted).
- `currentStep` must come from structured events, not ad-hoc string mutation.

### Done Criteria
- You can debug a stuck/running task using only the API response (no server console).
- UI can render: status, elapsed time, current step, and recent logs.

## Step 2 — Deterministic Agent Outputs

### Goal
Make outputs renderable and chainable without guessing.

### Contract
Define a discriminated union:

```ts
type AgentResult =
  | { type: "text"; content: string }
  | { type: "code"; files: Array<{ path: string; content: string }> }
  | { type: "artifact"; id: string }
  | { type: "error"; reason: string };
```

Consider a stable envelope at the API boundary:

```ts
type AgentResultEnvelope = {
  taskId: string;
  agentId: string;
  result: AgentResult;
  durationMs: number;
};
```

### Requirements
- Enforced at the kernel → API boundary for both built-in agents and plugins.
- Errors must be representable as `{ type: "error" }` (in addition to transport-level failures).

### Done Criteria
- Frontend never needs to inspect arbitrary strings/JSON to decide rendering.
- A downstream workflow can branch purely on `result.type`.

## Step 3 — Execution Event Stream (Backbone)

### Goal
Standardize event emission so introspection, replay, and auditing are derived and consistent.

### Event Types (minimum)
- `task.started`
- `task.step`
- `tool.called`
- `tool.completed`
- `task.completed`
- `task.failed`
- `task.cancelled`

### Requirements
- Events include `taskId`, `agentId`, timestamps, and enough data to render step/log UX.
- `currentStep` and `logs` are derived from events.

### Done Criteria
- `GET /api/task/:id/details` can be implemented purely by reading live task state + event stream.

## Step 4 — Controlled Agent-to-Agent Calls

### Goal
Enable safe composition: one agent can call another as a first-class child task.

### API (runtime ctx)
Add `ctx.runAgent(agentId, input)` with:
- Permission checks
- Depth limits / fanout limits
- Cancellation propagation (parent abort cancels children)

### Requirements
- Child runs are real tasks linked by `parentTaskId` (not hidden function calls).

### Done Criteria
- A composite agent can call a helper agent and you can observe/cancel both cleanly.

## Step 5 — Persistence + Replay

### Goal
Make runs reproducible and debuggable after the fact.

### Persist
- Task inputs
- Agent version/hash
- Outputs
- Structured event timeline/logs
- Tool call summaries

### Replay
- Replay using pinned agent version/hash (not "latest")
- Compare outputs between runs

### Done Criteria
- You can reproduce a bug by replaying an old task and inspecting its event timeline.

## Step 6 — UI Agent Builder (Same Contract)

### Goal
UI-generated agents are plugins in every meaningful sense.

### Requirements
- UI builds `defineAgent({ ... })` artifacts
- Same runtime, same permissions, same cancellation, same introspection

### Done Criteria
- Filesystem plugins and UI-generated plugins behave identically under the kernel.

---

## After Each Step — Developer Story (Template)

Copy/paste and fill this out after each step ships:

- For a plugin author: what changed?
- For a UI user: what changed?
- For platform guarantees: what is now true that wasn’t before?
- How to verify quickly (1–3 API calls or a single test).
