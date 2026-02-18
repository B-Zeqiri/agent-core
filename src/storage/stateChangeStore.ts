import { v4 as uuidv4 } from "uuid";
import { getSqliteDb } from "./sqliteDb";
import { resolvePersistenceFlag } from "./persistenceConfig";
import { safeJson, safeJsonParse } from "./serialization";
import { runDbRetrySync } from "./dbUtils";
import { getPersistenceDriver } from "./persistenceDriver";
import { runPgQuery } from "./postgresDb";

export interface PersistedStateChange {
  id: string;
  timestamp: number;
  eventType: string;
  taskId: string;
  agentId: string;
  data?: Record<string, any>;
}

const STATE_CHANGES_ENABLED = resolvePersistenceFlag(
  process.env.PERSIST_STATE_CHANGES,
  true
);

export class StateChangeStore {
  addEvent(event: Omit<PersistedStateChange, "id">): void {
    if (!STATE_CHANGES_ENABLED) return;

    const id = uuidv4();
    try {
      if (getPersistenceDriver() === "postgres") {
        void runPgQuery(
          "INSERT INTO state_changes (id, timestamp, event_type, task_id, agent_id, data_json) VALUES ($1, $2, $3, $4, $5, $6)",
          [
            id,
            event.timestamp,
            event.eventType,
            event.taskId,
            event.agentId,
            safeJson(event.data ?? null),
          ]
        );
        return;
      }

      const db = getSqliteDb();
      const stmt = db.prepare(
        "INSERT INTO state_changes (id, timestamp, event_type, task_id, agent_id, data_json) VALUES (?, ?, ?, ?, ?, ?)"
      );
      runDbRetrySync(
        () =>
          stmt.run(
            id,
            event.timestamp,
            event.eventType,
            event.taskId,
            event.agentId,
            safeJson(event.data ?? null)
          ),
        "stateChangeStore.addEvent"
      );
    } catch (error) {
      console.warn(`[stateChangeStore] Failed to persist state change: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  getEvents(filter?: { taskId?: string; agentId?: string; eventType?: string; limit?: number }): PersistedStateChange[] {
    if (!STATE_CHANGES_ENABLED) return [];
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

    if (filter?.eventType) {
      conditions.push("event_type = ?");
      params.push(filter.eventType);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = filter?.limit ?? 200;
    let rows: any[] = [];

    if (getPersistenceDriver() === "postgres") {
      throw new Error("StateChangeStore.getEvents is sync-only; use getEventsAsync with Postgres.");
    } else {
      const db = getSqliteDb();
      rows = db
        .prepare(
          `SELECT id, timestamp, event_type, task_id, agent_id, data_json FROM state_changes ${whereClause} ORDER BY timestamp DESC LIMIT ?`
        )
        .all(...params, limit);
    }

    return rows
      .reverse()
      .map((row: any) => ({
        id: row.id,
        timestamp: row.timestamp,
        eventType: row.event_type,
        taskId: row.task_id,
        agentId: row.agent_id,
        data: safeJsonParse(row.data_json, undefined),
      }));
  }

  async getEventsAsync(filter?: { taskId?: string; agentId?: string; eventType?: string; limit?: number }): Promise<PersistedStateChange[]> {
    if (!STATE_CHANGES_ENABLED) return [];
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
    if (filter?.eventType) {
      pgConditions.push(`event_type = $${idx++}`);
      pgParams.push(filter.eventType);
    }
    pgParams.push(limit);
    const pgWhere = pgConditions.length > 0 ? `WHERE ${pgConditions.join(" AND ")}` : "";
    const result = await runPgQuery(
      `SELECT id, timestamp, event_type, task_id, agent_id, data_json FROM state_changes ${pgWhere} ORDER BY timestamp DESC LIMIT $${idx}`,
      pgParams
    );
    const rows = result.rows as any[];
    return rows
      .reverse()
      .map((row: any) => ({
        id: row.id,
        timestamp: row.timestamp,
        eventType: row.event_type,
        taskId: row.task_id,
        agentId: row.agent_id,
        data: safeJsonParse(row.data_json, undefined),
      }));
  }

  clear(): void {
    if (!STATE_CHANGES_ENABLED) return;
    if (getPersistenceDriver() === "postgres") {
      throw new Error("StateChangeStore.clear is sync-only; use clearAsync with Postgres.");
    }
    const db = getSqliteDb();
    runDbRetrySync(() => db.prepare("DELETE FROM state_changes").run(), "stateChangeStore.clear");
  }

  deleteOlderThan(cutoffMs: number): void {
    if (!STATE_CHANGES_ENABLED) return;
    if (getPersistenceDriver() === "postgres") {
      throw new Error("StateChangeStore.deleteOlderThan is sync-only; use deleteOlderThanAsync with Postgres.");
    }
    const db = getSqliteDb();
    runDbRetrySync(
      () => db.prepare("DELETE FROM state_changes WHERE timestamp < ?").run(cutoffMs),
      "stateChangeStore.deleteOlderThan"
    );
  }

  async clearAsync(): Promise<void> {
    if (!STATE_CHANGES_ENABLED) return;
    if (getPersistenceDriver() !== "postgres") {
      this.clear();
      return;
    }
    await runPgQuery("DELETE FROM state_changes");
  }

  async deleteOlderThanAsync(cutoffMs: number): Promise<void> {
    if (!STATE_CHANGES_ENABLED) return;
    if (getPersistenceDriver() !== "postgres") {
      this.deleteOlderThan(cutoffMs);
      return;
    }
    await runPgQuery("DELETE FROM state_changes WHERE timestamp < $1", [cutoffMs]);
  }
}

export const stateChangeStore = new StateChangeStore();
