import { v4 as uuidv4 } from "uuid";
import { getSqliteDb } from "./sqliteDb";
import { resolvePersistenceFlag } from "./persistenceConfig";
import { runDbRetrySync } from "./dbUtils";
import { getPersistenceDriver } from "./persistenceDriver";
import { runPgQuery } from "./postgresDb";

export interface PersistedLogEntry {
  id: string;
  ts: number;
  level: "info" | "success" | "error";
  message: string;
}

const LOGS_ENABLED = resolvePersistenceFlag(
  process.env.PERSIST_LOGS,
  true
);

export class LogStore {
  addLog(entry: Omit<PersistedLogEntry, "id">): void {
    if (!LOGS_ENABLED) return;

    const id = uuidv4();
    try {
      if (getPersistenceDriver() === "postgres") {
        void runPgQuery(
          "INSERT INTO logs (id, ts, level, message) VALUES ($1, $2, $3, $4)",
          [id, entry.ts, entry.level, entry.message]
        );
        return;
      }

      const db = getSqliteDb();
      const stmt = db.prepare(
        "INSERT INTO logs (id, ts, level, message) VALUES (?, ?, ?, ?)"
      );
      runDbRetrySync(
        () => stmt.run(id, entry.ts, entry.level, entry.message),
        "logStore.addLog"
      );
    } catch (error) {
      console.warn(`[logStore] Failed to persist log: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  getLogs(filter?: { limit?: number }): PersistedLogEntry[] {
    if (!LOGS_ENABLED) return [];
    const limit = filter?.limit ?? 200;
    let rows: any[] = [];
    if (getPersistenceDriver() === "postgres") {
      throw new Error("LogStore.getLogs is sync-only; use getLogsAsync with Postgres.");
    } else {
      const db = getSqliteDb();
      rows = db
        .prepare("SELECT id, ts, level, message FROM logs ORDER BY ts DESC LIMIT ?")
        .all(limit);
    }

    return rows
      .reverse()
      .map((row: any) => ({
        id: row.id,
        ts: row.ts,
        level: row.level,
        message: row.message,
      }));
  }

  clear(): void {
    if (!LOGS_ENABLED) return;
    if (getPersistenceDriver() === "postgres") {
      throw new Error("LogStore.clear is sync-only; use clearAsync with Postgres.");
    }
    const db = getSqliteDb();
    runDbRetrySync(() => db.prepare("DELETE FROM logs").run(), "logStore.clear");
  }

  deleteOlderThan(cutoffMs: number): void {
    if (!LOGS_ENABLED) return;
    if (getPersistenceDriver() === "postgres") {
      throw new Error("LogStore.deleteOlderThan is sync-only; use deleteOlderThanAsync with Postgres.");
    }
    const db = getSqliteDb();
    runDbRetrySync(
      () => db.prepare("DELETE FROM logs WHERE ts < ?").run(cutoffMs),
      "logStore.deleteOlderThan"
    );
  }

  async getLogsAsync(filter?: { limit?: number }): Promise<PersistedLogEntry[]> {
    if (!LOGS_ENABLED) return [];
    const limit = filter?.limit ?? 200;
    if (getPersistenceDriver() !== "postgres") return this.getLogs(filter);

    const result = await runPgQuery(
      "SELECT id, ts, level, message FROM logs ORDER BY ts DESC LIMIT $1",
      [limit]
    );
    const rows = result.rows as any[];
    return rows
      .reverse()
      .map((row: any) => ({
        id: row.id,
        ts: row.ts,
        level: row.level,
        message: row.message,
      }));
  }

  async clearAsync(): Promise<void> {
    if (!LOGS_ENABLED) return;
    if (getPersistenceDriver() !== "postgres") {
      this.clear();
      return;
    }
    await runPgQuery("DELETE FROM logs");
  }

  async deleteOlderThanAsync(cutoffMs: number): Promise<void> {
    if (!LOGS_ENABLED) return;
    if (getPersistenceDriver() !== "postgres") {
      this.deleteOlderThan(cutoffMs);
      return;
    }
    await runPgQuery("DELETE FROM logs WHERE ts < $1", [cutoffMs]);
  }
}

export const logStore = new LogStore();
