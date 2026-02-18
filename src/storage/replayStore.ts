import { v4 as uuidv4 } from "uuid";
import { getSqliteDb } from "./sqliteDb";
import { resolvePersistenceFlag } from "./persistenceConfig";
import { safeJson, safeJsonParse } from "./serialization";
import { runDbRetrySync } from "./dbUtils";
import { getPersistenceDriver } from "./persistenceDriver";
import { runPgQuery } from "./postgresDb";

export interface ReplayEventInput {
  taskId: string;
  agentId: string;
  kind: "model" | "tool";
  name?: string;
  input?: unknown;
  output?: unknown;
  error?: string;
  startedAt: number;
  completedAt: number;
  metadata?: Record<string, any>;
}

export interface ReplayEventRecord {
  id: string;
  taskId: string;
  agentId: string;
  kind: "model" | "tool";
  name?: string;
  input?: unknown;
  output?: unknown;
  error?: string;
  startedAt: number;
  completedAt?: number;
  durationMs?: number;
  metadata?: Record<string, any>;
}

const REPLAY_ENABLED = resolvePersistenceFlag(
  process.env.PERSIST_REPLAY,
  true
);

export class ReplayStore {
  recordEvent(event: ReplayEventInput): void {
    if (!REPLAY_ENABLED) return;

    const id = uuidv4();
    const durationMs = event.completedAt - event.startedAt;
    try {
      if (getPersistenceDriver() === "postgres") {
        void runPgQuery(
          "INSERT INTO replay_events (id, task_id, agent_id, kind, name, input_json, output_json, error, started_at, completed_at, duration_ms, metadata_json) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)",
          [
            id,
            event.taskId,
            event.agentId,
            event.kind,
            event.name ?? null,
            safeJson(event.input ?? null),
            safeJson(event.output ?? null),
            event.error ?? null,
            event.startedAt,
            event.completedAt,
            durationMs,
            safeJson(event.metadata ?? null),
          ]
        );
        return;
      }

      const db = getSqliteDb();
      const stmt = db.prepare(
        "INSERT INTO replay_events (id, task_id, agent_id, kind, name, input_json, output_json, error, started_at, completed_at, duration_ms, metadata_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      );
      runDbRetrySync(
        () =>
          stmt.run(
            id,
            event.taskId,
            event.agentId,
            event.kind,
            event.name ?? null,
            safeJson(event.input ?? null),
            safeJson(event.output ?? null),
            event.error ?? null,
            event.startedAt,
            event.completedAt,
            durationMs,
            safeJson(event.metadata ?? null)
          ),
        "replayStore.recordEvent"
      );
    } catch (error) {
      console.warn(`[replayStore] Failed to persist replay event: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  getEvents(filter?: { taskId?: string; agentId?: string; kind?: "model" | "tool"; limit?: number }): ReplayEventRecord[] {
    if (!REPLAY_ENABLED) return [];
    const conditions: string[] = [];
    const params: Array<string | number> = [];

    if (filter?.taskId) {
      conditions.push("task_id = ?");
      params.push(filter.taskId);
    }

    if (filter?.agentId) {
      conditions.push("agent_id = ?");
      params.push(filter.agentId);
    }

    if (filter?.kind) {
      conditions.push("kind = ?");
      params.push(filter.kind);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = filter?.limit ?? 200;
    let rows: any[] = [];

    if (getPersistenceDriver() === "postgres") {
      throw new Error("ReplayStore.getEvents is sync-only; use getEventsAsync with Postgres.");
    } else {
      const db = getSqliteDb();
      rows = db
        .prepare(
          `SELECT id, task_id, agent_id, kind, name, input_json, output_json, error, started_at, completed_at, duration_ms, metadata_json FROM replay_events ${whereClause} ORDER BY started_at ASC LIMIT ?`
        )
        .all(...params, limit);
    }

    return rows.map((row: any) => ({
      id: row.id,
      taskId: row.task_id,
      agentId: row.agent_id,
      kind: row.kind,
      name: row.name ?? undefined,
      input: safeJsonParse(row.input_json, undefined),
      output: safeJsonParse(row.output_json, undefined),
      error: row.error ?? undefined,
      startedAt: row.started_at,
      completedAt: row.completed_at ?? undefined,
      durationMs: row.duration_ms ?? undefined,
      metadata: safeJsonParse(row.metadata_json, undefined),
    }));
  }

  async getEventsAsync(filter?: { taskId?: string; agentId?: string; kind?: "model" | "tool"; limit?: number }): Promise<ReplayEventRecord[]> {
    if (!REPLAY_ENABLED) return [];
    const limit = filter?.limit ?? 200;
    if (getPersistenceDriver() !== "postgres") return this.getEvents(filter);

    const pgConditions: string[] = [];
    const pgParams: Array<string | number> = [];
    let idx = 1;
    if (filter?.taskId) {
      pgConditions.push(`task_id = $${idx++}`);
      pgParams.push(filter.taskId);
    }
    if (filter?.agentId) {
      pgConditions.push(`agent_id = $${idx++}`);
      pgParams.push(filter.agentId);
    }
    if (filter?.kind) {
      pgConditions.push(`kind = $${idx++}`);
      pgParams.push(filter.kind);
    }
    pgParams.push(limit);
    const pgWhere = pgConditions.length ? `WHERE ${pgConditions.join(" AND ")}` : "";
    const result = await runPgQuery(
      `SELECT id, task_id, agent_id, kind, name, input_json, output_json, error, started_at, completed_at, duration_ms, metadata_json FROM replay_events ${pgWhere} ORDER BY started_at ASC LIMIT $${idx}`,
      pgParams
    );
    const rows = result.rows as any[];
    return rows.map((row: any) => ({
      id: row.id,
      taskId: row.task_id,
      agentId: row.agent_id,
      kind: row.kind,
      name: row.name ?? undefined,
      input: safeJsonParse(row.input_json, undefined),
      output: safeJsonParse(row.output_json, undefined),
      error: row.error ?? undefined,
      startedAt: row.started_at,
      completedAt: row.completed_at ?? undefined,
      durationMs: row.duration_ms ?? undefined,
      metadata: safeJsonParse(row.metadata_json, undefined),
    }));
  }

  deleteOlderThan(cutoffMs: number): void {
    if (!REPLAY_ENABLED) return;
    if (getPersistenceDriver() === "postgres") {
      throw new Error("ReplayStore.deleteOlderThan is sync-only; use deleteOlderThanAsync with Postgres.");
    }
    const db = getSqliteDb();
    runDbRetrySync(
      () => db.prepare("DELETE FROM replay_events WHERE started_at < ?").run(cutoffMs),
      "replayStore.deleteOlderThan"
    );
  }

  async deleteOlderThanAsync(cutoffMs: number): Promise<void> {
    if (!REPLAY_ENABLED) return;
    if (getPersistenceDriver() !== "postgres") {
      this.deleteOlderThan(cutoffMs);
      return;
    }
    await runPgQuery("DELETE FROM replay_events WHERE started_at < $1", [cutoffMs]);
  }
}

export const replayStore = new ReplayStore();
