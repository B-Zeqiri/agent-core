import { v4 as uuidv4 } from "uuid";
import { getSqliteDb } from "./sqliteDb";
import { resolvePersistenceFlag } from "./persistenceConfig";
import { safeJson, safeJsonParse } from "./serialization";
import { runDbRetrySync } from "./dbUtils";
import { getPersistenceDriver } from "./persistenceDriver";
import { runPgQuery } from "./postgresDb";

export interface PersistedAuditEvent {
  id: string;
  timestamp: number;
  eventType: string;
  agentId: string;
  taskId?: string;
  toolName?: string;
  details: Record<string, any>;
}

const AUDIT_ENABLED = resolvePersistenceFlag(
  process.env.PERSIST_AUDIT,
  true
);

export class AuditStore {
  addEvent(event: Omit<PersistedAuditEvent, "id">): void {
    if (!AUDIT_ENABLED) return;

    const id = uuidv4();
    try {
      if (getPersistenceDriver() === "postgres") {
        void runPgQuery(
          "INSERT INTO audit_events (id, timestamp, event_type, agent_id, task_id, tool_name, details_json) VALUES ($1, $2, $3, $4, $5, $6, $7)",
          [
            id,
            event.timestamp,
            event.eventType,
            event.agentId,
            event.taskId ?? null,
            event.toolName ?? null,
            safeJson(event.details),
          ]
        );
        return;
      }

      const db = getSqliteDb();
      const stmt = db.prepare(
        "INSERT INTO audit_events (id, timestamp, event_type, agent_id, task_id, tool_name, details_json) VALUES (?, ?, ?, ?, ?, ?, ?)"
      );
      runDbRetrySync(
        () =>
          stmt.run(
            id,
            event.timestamp,
            event.eventType,
            event.agentId,
            event.taskId ?? null,
            event.toolName ?? null,
            safeJson(event.details)
          ),
        "auditStore.addEvent"
      );
    } catch (error) {
      console.warn(`[auditStore] Failed to persist audit event: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  getEvents(filter?: { agentId?: string; taskId?: string; eventType?: string; limit?: number }): PersistedAuditEvent[] {
    if (!AUDIT_ENABLED) return [];

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

    if (filter?.eventType) {
      conditions.push("event_type = ?");
      params.push(filter.eventType);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = filter?.limit ?? 100;
    let rows: any[] = [];

    if (getPersistenceDriver() === "postgres") {
      throw new Error("AuditStore.getEvents is sync-only; use getEventsAsync with Postgres.");
    } else {
      const db = getSqliteDb();
      rows = db
        .prepare(
          `SELECT id, timestamp, event_type, agent_id, task_id, tool_name, details_json FROM audit_events ${whereClause} ORDER BY timestamp DESC LIMIT ?`
        )
        .all(...params, limit);
    }

    return rows.map((row: any) => ({
      id: row.id,
      timestamp: row.timestamp,
      eventType: row.event_type,
      agentId: row.agent_id,
      taskId: row.task_id ?? undefined,
      toolName: row.tool_name ?? undefined,
      details: safeJsonParse(row.details_json, {}),
    }));
  }

  async getEventsAsync(filter?: { agentId?: string; taskId?: string; eventType?: string; limit?: number }): Promise<PersistedAuditEvent[]> {
    if (!AUDIT_ENABLED) return [];
    const limit = filter?.limit ?? 100;
    if (getPersistenceDriver() !== "postgres") return this.getEvents(filter);

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
    if (filter?.eventType) {
      pgConditions.push(`event_type = $${idx++}`);
      pgParams.push(filter.eventType);
    }
    pgParams.push(limit);
    const pgWhere = pgConditions.length > 0 ? `WHERE ${pgConditions.join(" AND ")}` : "";
    const result = await runPgQuery(
      `SELECT id, timestamp, event_type, agent_id, task_id, tool_name, details_json FROM audit_events ${pgWhere} ORDER BY timestamp DESC LIMIT $${idx}`,
      pgParams
    );
    const rows = result.rows as any[];
    return rows.map((row: any) => ({
      id: row.id,
      timestamp: row.timestamp,
      eventType: row.event_type,
      agentId: row.agent_id,
      taskId: row.task_id ?? undefined,
      toolName: row.tool_name ?? undefined,
      details: safeJsonParse(row.details_json, {}),
    }));
  }

  deleteOlderThan(cutoffMs: number): void {
    if (!AUDIT_ENABLED) return;
    if (getPersistenceDriver() === "postgres") {
      throw new Error("AuditStore.deleteOlderThan is sync-only; use deleteOlderThanAsync with Postgres.");
    }
    const db = getSqliteDb();
    runDbRetrySync(
      () => db.prepare("DELETE FROM audit_events WHERE timestamp < ?").run(cutoffMs),
      "auditStore.deleteOlderThan"
    );
  }

  async deleteOlderThanAsync(cutoffMs: number): Promise<void> {
    if (!AUDIT_ENABLED) return;
    if (getPersistenceDriver() !== "postgres") {
      this.deleteOlderThan(cutoffMs);
      return;
    }
    await runPgQuery("DELETE FROM audit_events WHERE timestamp < $1", [cutoffMs]);
  }
}

export const auditStore = new AuditStore();
