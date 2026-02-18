import * as fs from "fs";
import * as path from "path";
import type Database from "better-sqlite3";

type SqliteDatabase = Database.Database;
type SqliteConstructor = typeof import("better-sqlite3");

let dbInstance: SqliteDatabase | null = null;
let dbPathValue: string | null = null;

const LATEST_SCHEMA_VERSION = 1;

function parseIntOrDefault(raw: string | undefined, fallback: number): number {
  if (raw == null || raw.trim() === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.floor(value) : fallback;
}

function getSqliteConstructor(): SqliteConstructor {
  // Lazy-load to avoid native module initialization when Postgres is active.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require("better-sqlite3");
  return mod?.default ?? mod;
}

function initSchema(db: SqliteDatabase): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      version INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY,
      timestamp INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      task_id TEXT,
      tool_name TEXT,
      details_json TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_audit_events_task ON audit_events(task_id);
    CREATE INDEX IF NOT EXISTS idx_audit_events_agent ON audit_events(agent_id);
    CREATE INDEX IF NOT EXISTS idx_audit_events_time ON audit_events(timestamp);

    CREATE TABLE IF NOT EXISTS memory_entries (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      content TEXT NOT NULL,
      entry_type TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      metadata_json TEXT,
      pinned_long INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_memory_entries_agent ON memory_entries(agent_id);
    CREATE INDEX IF NOT EXISTS idx_memory_entries_time ON memory_entries(timestamp);

    CREATE TABLE IF NOT EXISTS replay_events (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      name TEXT,
      input_json TEXT,
      output_json TEXT,
      error TEXT,
      started_at INTEGER NOT NULL,
      completed_at INTEGER,
      duration_ms INTEGER,
      metadata_json TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_replay_events_task ON replay_events(task_id);
    CREATE INDEX IF NOT EXISTS idx_replay_events_time ON replay_events(started_at);

    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      input TEXT NOT NULL,
      output TEXT,
      raw_output TEXT,
      agent_result_json TEXT,
      status TEXT NOT NULL,
      agent TEXT,
      agent_version TEXT,
      agent_selection_reason TEXT,
      started_at INTEGER NOT NULL,
      completed_at INTEGER,
      duration_ms INTEGER,
      error TEXT,
      error_code TEXT,
      failed_layer TEXT,
      stack_trace TEXT,
      suggestions_json TEXT,
      is_retry INTEGER,
      original_task_id TEXT,
      retry_count INTEGER,
      retries_json TEXT,
      available_agents_json TEXT,
      agent_scores_json TEXT,
      manually_selected INTEGER,
      involved_agents_json TEXT,
      involved_agent_versions_json TEXT,
      conversation_id TEXT,
      messages_json TEXT,
      progress REAL,
      tags_json TEXT,
      user_id TEXT,
      generation_json TEXT,
      system_mode TEXT,
      multi_agent_enabled INTEGER,
      worker_id TEXT,
      lease_expires_at INTEGER,
      last_claimed_at INTEGER,
      claim_count INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
    CREATE INDEX IF NOT EXISTS idx_tasks_agent ON tasks(agent);
    CREATE INDEX IF NOT EXISTS idx_tasks_started ON tasks(started_at);
    CREATE INDEX IF NOT EXISTS idx_tasks_retry ON tasks(is_retry);
    CREATE INDEX IF NOT EXISTS idx_tasks_original ON tasks(original_task_id);
    CREATE INDEX IF NOT EXISTS idx_tasks_conversation ON tasks(conversation_id);

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

    CREATE TABLE IF NOT EXISTS logs (
      id TEXT PRIMARY KEY,
      ts INTEGER NOT NULL,
      level TEXT NOT NULL,
      message TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_logs_ts ON logs(ts);

    CREATE TABLE IF NOT EXISTS tool_calls (
      id TEXT PRIMARY KEY,
      timestamp INTEGER NOT NULL,
      agent_id TEXT NOT NULL,
      task_id TEXT,
      tool_name TEXT NOT NULL,
      args_json TEXT,
      success INTEGER NOT NULL,
      duration_ms INTEGER,
      error TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_tool_calls_time ON tool_calls(timestamp);
    CREATE INDEX IF NOT EXISTS idx_tool_calls_agent ON tool_calls(agent_id);
    CREATE INDEX IF NOT EXISTS idx_tool_calls_task ON tool_calls(task_id);
    CREATE INDEX IF NOT EXISTS idx_tool_calls_name ON tool_calls(tool_name);

    CREATE TABLE IF NOT EXISTS state_changes (
      id TEXT PRIMARY KEY,
      timestamp INTEGER NOT NULL,
      event_type TEXT NOT NULL,
      task_id TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      data_json TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_state_changes_time ON state_changes(timestamp);
    CREATE INDEX IF NOT EXISTS idx_state_changes_task ON state_changes(task_id);
    CREATE INDEX IF NOT EXISTS idx_state_changes_agent ON state_changes(agent_id);
    CREATE INDEX IF NOT EXISTS idx_state_changes_type ON state_changes(event_type);
  `);
}

function getSchemaVersion(db: SqliteDatabase): number {
  const row = db.prepare("SELECT version FROM schema_migrations WHERE id = 1").get();
  if (!row || typeof (row as any).version !== "number") return 0;
  return (row as any).version;
}

function setSchemaVersion(db: SqliteDatabase, version: number): void {
  db.prepare(
    "INSERT INTO schema_migrations (id, version, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET version = excluded.version, updated_at = excluded.updated_at"
  ).run(version, Date.now());
}

function runMigrations(db: SqliteDatabase): void {
  const current = getSchemaVersion(db);
  if (current >= LATEST_SCHEMA_VERSION) return;

  // Baseline migration for existing schema. Future migrations can be added here.
  setSchemaVersion(db, LATEST_SCHEMA_VERSION);
}

export function getSqliteDb(): SqliteDatabase {
  if (dbInstance) return dbInstance;

  const dbPath = process.env.PERSIST_DB_PATH || path.join(process.cwd(), ".data", "agent-core.db");
  dbPathValue = dbPath;
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const Sqlite = getSqliteConstructor();
  const db = new Sqlite(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  const busyTimeoutMs = parseIntOrDefault(process.env.PERSIST_DB_BUSY_TIMEOUT_MS, 5000);
  if (busyTimeoutMs > 0) {
    db.pragma(`busy_timeout = ${busyTimeoutMs}`);
  }

  initSchema(db);
  runMigrations(db);
  dbInstance = db;
  return dbInstance;
}

export function getSqliteDbPath(): string {
  if (dbPathValue) return dbPathValue;
  return process.env.PERSIST_DB_PATH || path.join(process.cwd(), ".data", "agent-core.db");
}

export function checkpointSqliteDb(): void {
  if (!dbInstance) return;
  try {
    dbInstance.pragma("wal_checkpoint(TRUNCATE)");
  } catch {
    // ignore checkpoint failures
  }
}

export function closeSqliteDb(): void {
  if (!dbInstance) return;
  try {
    dbInstance.close();
  } catch {
    // ignore close failures
  } finally {
    dbInstance = null;
  }
}
