import type Database from "better-sqlite3";
import { getSqliteDb } from "./sqliteDb";
import { runDbRetrySync } from "./dbUtils";
import { getPersistenceDriver } from "./persistenceDriver";
import { runPgQuery, runPgTransaction } from "./postgresDb";

export interface RuntimeTaskRecord {
  id: string;
  agent: string;
  status: "queued" | "in_progress" | "completed" | "failed" | "cancelled";
  startedAt: number;
  endedAt?: number;
  durationMs?: number;
  progress: number;
  input: string;
  output?: string;
  error?: string;
  progress_messages: Array<{ ts: number; message: string }>;
  generation?: {
    mode: "creative" | "deterministic";
    temperature?: number;
    maxTokens?: number;
    seed?: number;
  };
  systemMode?: "assist" | "power" | "autonomous";
}

function toJson(value: unknown): string | null {
  if (value == null) return null;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function fromJson<T>(raw: string | null | undefined): T | undefined {
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

function ensureRuntimeSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS runtime_tasks (
      id TEXT PRIMARY KEY,
      agent TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      duration_ms INTEGER,
      progress INTEGER,
      input TEXT NOT NULL,
      output TEXT,
      error TEXT,
      progress_messages_json TEXT,
      generation_json TEXT,
      system_mode TEXT,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_runtime_tasks_status ON runtime_tasks(status);
    CREATE INDEX IF NOT EXISTS idx_runtime_tasks_started ON runtime_tasks(started_at);
  `);
}

export class RuntimeTaskStore {
  private db: Database.Database;
  private usePostgres: boolean;

  constructor(db?: Database.Database) {
    this.usePostgres = getPersistenceDriver() === "postgres";
    this.db = db ?? (this.usePostgres ? (null as unknown as Database.Database) : getSqliteDb());
    if (!this.usePostgres) {
      ensureRuntimeSchema(this.db);
    }
  }

  loadAll(): RuntimeTaskRecord[] {
    if (this.usePostgres) {
      throw new Error("RuntimeTaskStore.loadAll is sync-only; use loadAllAsync with Postgres.");
    }
    const rows = this.db.prepare("SELECT * FROM runtime_tasks ORDER BY started_at DESC").all();
    return rows.map((row: any) => ({
      id: String(row.id),
      agent: String(row.agent),
      status: row.status,
      startedAt: Number(row.started_at),
      endedAt: row.ended_at != null ? Number(row.ended_at) : undefined,
      durationMs: row.duration_ms != null ? Number(row.duration_ms) : undefined,
      progress: row.progress != null ? Number(row.progress) : 0,
      input: String(row.input),
      output: row.output ?? undefined,
      error: row.error ?? undefined,
      progress_messages: fromJson<Array<{ ts: number; message: string }>>(row.progress_messages_json) || [],
      generation: fromJson(row.generation_json),
      systemMode: row.system_mode ?? undefined,
    }));
  }

  saveAll(tasks: RuntimeTaskRecord[]): void {
    if (this.usePostgres) {
      throw new Error("RuntimeTaskStore.saveAll is sync-only; use saveAllAsync with Postgres.");
    }

    const ids = tasks.map((t) => t.id);
    const now = Date.now();

    const deleteStmt = ids.length
      ? this.db.prepare(`DELETE FROM runtime_tasks WHERE id NOT IN (${ids.map(() => "?").join(",")})`)
      : this.db.prepare("DELETE FROM runtime_tasks");

    const insertStmt = this.db.prepare(`
      INSERT OR REPLACE INTO runtime_tasks (
        id,
        agent,
        status,
        started_at,
        ended_at,
        duration_ms,
        progress,
        input,
        output,
        error,
        progress_messages_json,
        generation_json,
        system_mode,
        updated_at
      ) VALUES (
        @id,
        @agent,
        @status,
        @started_at,
        @ended_at,
        @duration_ms,
        @progress,
        @input,
        @output,
        @error,
        @progress_messages_json,
        @generation_json,
        @system_mode,
        @updated_at
      )
    `);

    const transaction = this.db.transaction((rows: RuntimeTaskRecord[]) => {
      deleteStmt.run(...ids);
      for (const task of rows) {
        insertStmt.run({
          id: task.id,
          agent: task.agent,
          status: task.status,
          started_at: task.startedAt,
          ended_at: task.endedAt ?? null,
          duration_ms: task.durationMs ?? null,
          progress: task.progress ?? 0,
          input: task.input,
          output: task.output ?? null,
          error: task.error ?? null,
          progress_messages_json: toJson(task.progress_messages),
          generation_json: toJson(task.generation),
          system_mode: task.systemMode ?? null,
          updated_at: now,
        });
      }
    });

    runDbRetrySync(() => transaction(tasks), "runtimeTaskStore.saveAll");
  }

  async loadAllAsync(): Promise<RuntimeTaskRecord[]> {
    if (!this.usePostgres) return this.loadAll();
    const result = await runPgQuery("SELECT * FROM runtime_tasks ORDER BY started_at DESC");
    const rows = result.rows as any[];
    return rows.map((row: any) => ({
      id: String(row.id),
      agent: String(row.agent),
      status: row.status,
      startedAt: Number(row.started_at),
      endedAt: row.ended_at != null ? Number(row.ended_at) : undefined,
      durationMs: row.duration_ms != null ? Number(row.duration_ms) : undefined,
      progress: row.progress != null ? Number(row.progress) : 0,
      input: String(row.input),
      output: row.output ?? undefined,
      error: row.error ?? undefined,
      progress_messages: fromJson<Array<{ ts: number; message: string }>>(row.progress_messages_json) || [],
      generation: fromJson(row.generation_json),
      systemMode: row.system_mode ?? undefined,
    }));
  }

  async saveAllAsync(tasks: RuntimeTaskRecord[]): Promise<void> {
    if (!this.usePostgres) {
      this.saveAll(tasks);
      return;
    }

    const ids = tasks.map((t) => t.id);
    const now = Date.now();

    await runPgTransaction(async (client) => {
      if (ids.length > 0) {
        await client.query(
          `DELETE FROM runtime_tasks WHERE id NOT IN (${ids.map((_, idx) => `$${idx + 1}`).join(",")})`,
          ids
        );
      } else {
        await client.query("DELETE FROM runtime_tasks");
      }

      for (const task of tasks) {
        await client.query(
          `INSERT INTO runtime_tasks (
            id,
            agent,
            status,
            started_at,
            ended_at,
            duration_ms,
            progress,
            input,
            output,
            error,
            progress_messages_json,
            generation_json,
            system_mode,
            updated_at
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14
          )
          ON CONFLICT (id) DO UPDATE SET
            agent = EXCLUDED.agent,
            status = EXCLUDED.status,
            started_at = EXCLUDED.started_at,
            ended_at = EXCLUDED.ended_at,
            duration_ms = EXCLUDED.duration_ms,
            progress = EXCLUDED.progress,
            input = EXCLUDED.input,
            output = EXCLUDED.output,
            error = EXCLUDED.error,
            progress_messages_json = EXCLUDED.progress_messages_json,
            generation_json = EXCLUDED.generation_json,
            system_mode = EXCLUDED.system_mode,
            updated_at = EXCLUDED.updated_at
          `,
          [
            task.id,
            task.agent,
            task.status,
            task.startedAt,
            task.endedAt ?? null,
            task.durationMs ?? null,
            task.progress ?? 0,
            task.input,
            task.output ?? null,
            task.error ?? null,
            toJson(task.progress_messages) ?? null,
            toJson(task.generation) ?? null,
            task.systemMode ?? null,
            now,
          ]
        );
      }
    });
  }
}

export const runtimeTaskStore = new RuntimeTaskStore();
