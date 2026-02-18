import { v4 as uuidv4 } from "uuid";
import { getSqliteDb } from "./sqliteDb";
import { resolvePersistenceFlag } from "./persistenceConfig";
import { safeJson, safeJsonParse } from "./serialization";
import { runDbRetrySync } from "./dbUtils";
import { getPersistenceDriver } from "./persistenceDriver";
import { runPgQuery } from "./postgresDb";

export interface PersistedToolCall {
  id: string;
  timestamp: number;
  agentId: string;
  taskId?: string;
  toolName: string;
  args?: Record<string, any>;
  success: boolean;
  durationMs?: number;
  error?: string;
}

const TOOL_CALLS_ENABLED = resolvePersistenceFlag(
  process.env.PERSIST_TOOL_CALLS,
  true
);

export class ToolCallStore {
  recordCall(call: Omit<PersistedToolCall, "id">): void {
    if (!TOOL_CALLS_ENABLED) return;

    const id = uuidv4();
    try {
      if (getPersistenceDriver() === "postgres") {
        void runPgQuery(
          "INSERT INTO tool_calls (id, timestamp, agent_id, task_id, tool_name, args_json, success, duration_ms, error) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)",
          [
            id,
            call.timestamp,
            call.agentId,
            call.taskId ?? null,
            call.toolName,
            safeJson(call.args ?? null),
            call.success ? 1 : 0,
            call.durationMs ?? null,
            call.error ?? null,
          ]
        );
        return;
      }

      const db = getSqliteDb();
      const stmt = db.prepare(
        "INSERT INTO tool_calls (id, timestamp, agent_id, task_id, tool_name, args_json, success, duration_ms, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
      );
      runDbRetrySync(
        () =>
          stmt.run(
            id,
            call.timestamp,
            call.agentId,
            call.taskId ?? null,
            call.toolName,
            safeJson(call.args ?? null),
            call.success ? 1 : 0,
            call.durationMs ?? null,
            call.error ?? null
          ),
        "toolCallStore.recordCall"
      );
    } catch (error) {
      console.warn(`[toolCallStore] Failed to persist tool call: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  getCalls(filter?: {
    agentId?: string;
    taskId?: string;
    toolName?: string;
    success?: boolean;
    limit?: number;
  }): PersistedToolCall[] {
    if (!TOOL_CALLS_ENABLED) return [];
    const conditions: string[] = [];
    const params: Array<string | number> = [];

    if (filter?.agentId) {
      conditions.push("agent_id = ?");
      params.push(filter.agentId);
    }

    if (filter?.taskId) {
      conditions.push("task_id = ?");
      params.push(filter.taskId);
    }

    if (filter?.toolName) {
      conditions.push("tool_name = ?");
      params.push(filter.toolName);
    }

    if (filter?.success != null) {
      conditions.push("success = ?");
      params.push(filter.success ? 1 : 0);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = filter?.limit ?? 200;
    let rows: any[] = [];

    if (getPersistenceDriver() === "postgres") {
      throw new Error("ToolCallStore.getCalls is sync-only; use getCallsAsync with Postgres.");
    } else {
      const db = getSqliteDb();
      rows = db
        .prepare(
          `SELECT id, timestamp, agent_id, task_id, tool_name, args_json, success, duration_ms, error FROM tool_calls ${whereClause} ORDER BY timestamp DESC LIMIT ?`
        )
        .all(...params, limit);
    }

    return rows
      .reverse()
      .map((row: any) => ({
        id: row.id,
        timestamp: row.timestamp,
        agentId: row.agent_id,
        taskId: row.task_id ?? undefined,
        toolName: row.tool_name,
        args: safeJsonParse(row.args_json, undefined),
        success: row.success === 1,
        durationMs: row.duration_ms ?? undefined,
        error: row.error ?? undefined,
      }));
  }

  async getCallsAsync(filter?: {
    agentId?: string;
    taskId?: string;
    toolName?: string;
    success?: boolean;
    limit?: number;
  }): Promise<PersistedToolCall[]> {
    if (!TOOL_CALLS_ENABLED) return [];
    const limit = filter?.limit ?? 200;
    if (getPersistenceDriver() !== "postgres") return this.getCalls(filter);

    const pgConditions: string[] = [];
    const pgParams: Array<string | number> = [];
    let idx = 1;
    if (filter?.agentId) {
      pgConditions.push(`agent_id = $${idx++}`);
      pgParams.push(filter.agentId);
    }
    if (filter?.taskId) {
      pgConditions.push(`task_id = $${idx++}`);
      pgParams.push(filter.taskId);
    }
    if (filter?.toolName) {
      pgConditions.push(`tool_name = $${idx++}`);
      pgParams.push(filter.toolName);
    }
    if (filter?.success != null) {
      pgConditions.push(`success = $${idx++}`);
      pgParams.push(filter.success ? 1 : 0);
    }
    pgParams.push(limit);
    const pgWhere = pgConditions.length > 0 ? `WHERE ${pgConditions.join(" AND ")}` : "";
    const result = await runPgQuery(
      `SELECT id, timestamp, agent_id, task_id, tool_name, args_json, success, duration_ms, error FROM tool_calls ${pgWhere} ORDER BY timestamp DESC LIMIT $${idx}`,
      pgParams
    );
    const rows = result.rows as any[];
    return rows
      .reverse()
      .map((row: any) => ({
        id: row.id,
        timestamp: row.timestamp,
        agentId: row.agent_id,
        taskId: row.task_id ?? undefined,
        toolName: row.tool_name,
        args: safeJsonParse(row.args_json, undefined),
        success: Boolean(row.success),
        durationMs: row.duration_ms ?? undefined,
        error: row.error ?? undefined,
      }));
  }

  clear(): void {
    if (!TOOL_CALLS_ENABLED) return;
    if (getPersistenceDriver() === "postgres") {
      throw new Error("ToolCallStore.clear is sync-only; use clearAsync with Postgres.");
    }
    const db = getSqliteDb();
    runDbRetrySync(() => db.prepare("DELETE FROM tool_calls").run(), "toolCallStore.clear");
  }

  deleteOlderThan(cutoffMs: number): void {
    if (!TOOL_CALLS_ENABLED) return;
    if (getPersistenceDriver() === "postgres") {
      throw new Error("ToolCallStore.deleteOlderThan is sync-only; use deleteOlderThanAsync with Postgres.");
    }
    const db = getSqliteDb();
    runDbRetrySync(
      () => db.prepare("DELETE FROM tool_calls WHERE timestamp < ?").run(cutoffMs),
      "toolCallStore.deleteOlderThan"
    );
  }

  async clearAsync(): Promise<void> {
    if (!TOOL_CALLS_ENABLED) return;
    if (getPersistenceDriver() !== "postgres") {
      this.clear();
      return;
    }
    await runPgQuery("DELETE FROM tool_calls");
  }

  async deleteOlderThanAsync(cutoffMs: number): Promise<void> {
    if (!TOOL_CALLS_ENABLED) return;
    if (getPersistenceDriver() !== "postgres") {
      this.deleteOlderThan(cutoffMs);
      return;
    }
    await runPgQuery("DELETE FROM tool_calls WHERE timestamp < $1", [cutoffMs]);
  }
}

export const toolCallStore = new ToolCallStore();
