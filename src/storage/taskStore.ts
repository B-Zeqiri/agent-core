/**
 * TaskStore - Persistent storage for task history and agent decisions
 * 
 * Stores:
 * - Complete task history
 * - Agent decision reasoning
 * - Input/output relationships
 * - Retry chains
 */

import type Database from "better-sqlite3";
import { v4 as uuidv4 } from "uuid";
import { getSqliteDb } from "./sqliteDb";
import { runDbRetrySync } from "./dbUtils";
import { getPersistenceDriver } from "./persistenceDriver";
import { runPgQuery, runPgQuerySync, runPgTransaction, runPgTransactionSync } from "./postgresDb";

export interface TaskRecord {
  id: string;
  input: string;
  output?: string;
  rawOutput?: string;
  agentResult?: any;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
  agent?: string;
  agentVersion?: string;
  agentSelectionReason?: string; // Why this agent was chosen
  startedAt: number;
  completedAt?: number;
  durationMs?: number;
  error?: string;
  errorCode?: string;
  failedLayer?: string;
  stackTrace?: string;
  suggestions?: string[];
  
  // Retry tracking
  isRetry?: boolean;
  originalTaskId?: string; // Link to original task if this is a retry
  retryCount?: number;
  retries?: string[]; // IDs of retry attempts
  
  // Agent decision metadata
  availableAgents?: string[]; // Which agents were considered
  agentScores?: Record<string, number>; // Scoring for agent selection
  manuallySelected?: boolean; // True if user manually selected the agent
  involvedAgents?: string[]; // Agents that actually executed the task
  involvedAgentVersions?: Record<string, string>;
  
  // Conversation tracking
  conversationId?: string; // Groups related tasks in same conversation
  
  // Extended metadata
  messages?: string[];
  progress?: number;
  tags?: string[];
  userId?: string; // Future: multi-user support

  // Generation config (Creative/Deterministic)
  generation?: import('../models/generation').GenerationConfig;

  // System mode (Assist, Power, Autonomous)
  systemMode?: 'assist' | 'power' | 'autonomous';

  // Multi-agent mode enabled for this task
  multiAgentEnabled?: boolean;

  // Worker lease metadata
  workerId?: string | null;
  leaseExpiresAt?: number | null;
  lastClaimedAt?: number | null;
  claimCount?: number | null;
}

export interface TaskQuery {
  status?: string | string[];
  agent?: string;
  startDate?: number;
  endDate?: number;
  isRetry?: boolean;
  originalTaskId?: string;
  limit?: number;
  offset?: number;
  sortBy?: 'startedAt' | 'completedAt' | 'durationMs';
  sortOrder?: 'asc' | 'desc';
}

const PG_TASK_UPSERT_SQL = `INSERT INTO tasks (
  id,
  input,
  output,
  raw_output,
  agent_result_json,
  status,
  agent,
  agent_version,
  agent_selection_reason,
  started_at,
  completed_at,
  duration_ms,
  error,
  error_code,
  failed_layer,
  stack_trace,
  suggestions_json,
  is_retry,
  original_task_id,
  retry_count,
  retries_json,
  available_agents_json,
  agent_scores_json,
  manually_selected,
  involved_agents_json,
  involved_agent_versions_json,
  conversation_id,
  messages_json,
  progress,
  tags_json,
  user_id,
  generation_json,
  system_mode,
  multi_agent_enabled,
  worker_id,
  lease_expires_at,
  last_claimed_at,
  claim_count
) VALUES (
  $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
  $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
  $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,
  $31,$32,$33,$34,$35,$36,$37,$38
) ON CONFLICT (id) DO UPDATE SET
  input = excluded.input,
  output = excluded.output,
  raw_output = excluded.raw_output,
  agent_result_json = excluded.agent_result_json,
  status = excluded.status,
  agent = excluded.agent,
  agent_version = excluded.agent_version,
  agent_selection_reason = excluded.agent_selection_reason,
  started_at = excluded.started_at,
  completed_at = excluded.completed_at,
  duration_ms = excluded.duration_ms,
  error = excluded.error,
  error_code = excluded.error_code,
  failed_layer = excluded.failed_layer,
  stack_trace = excluded.stack_trace,
  suggestions_json = excluded.suggestions_json,
  is_retry = excluded.is_retry,
  original_task_id = excluded.original_task_id,
  retry_count = excluded.retry_count,
  retries_json = excluded.retries_json,
  available_agents_json = excluded.available_agents_json,
  agent_scores_json = excluded.agent_scores_json,
  manually_selected = excluded.manually_selected,
  involved_agents_json = excluded.involved_agents_json,
  involved_agent_versions_json = excluded.involved_agent_versions_json,
  conversation_id = excluded.conversation_id,
  messages_json = excluded.messages_json,
  progress = excluded.progress,
  tags_json = excluded.tags_json,
  user_id = excluded.user_id,
  generation_json = excluded.generation_json,
  system_mode = excluded.system_mode,
  multi_agent_enabled = excluded.multi_agent_enabled,
  worker_id = excluded.worker_id,
  lease_expires_at = excluded.lease_expires_at,
  last_claimed_at = excluded.last_claimed_at,
  claim_count = excluded.claim_count`;

export class TaskStore {
  private db: Database.Database;
  private usePostgres: boolean;

  constructor(options?: { db?: Database.Database }) {
    this.usePostgres = getPersistenceDriver() === "postgres";
    this.db = options?.db ?? (this.usePostgres ? (null as unknown as Database.Database) : getSqliteDb());
    if (!this.usePostgres) {
      this.ensureSchema();
    }
    this.normalizeStaleTasksOnStartup();
  }

  private ensureSqliteSync(method: string): void {
    if (this.usePostgres) {
      throw new Error(`TaskStore.${method} is sync-only; use ${method}Async with Postgres.`);
    }
  }

  private ensureSchema(): void {
    if (this.usePostgres) return;
    this.db.exec(`
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
    `);

    this.ensureWorkerLeaseColumns();
  }

  private ensureWorkerLeaseColumns(): void {
    if (this.usePostgres) return;
    const columns = this.db.prepare("PRAGMA table_info(tasks)").all() as Array<{ name: string }>;
    const existing = new Set(columns.map((col) => col.name));

    if (!existing.has("worker_id")) {
      this.db.prepare("ALTER TABLE tasks ADD COLUMN worker_id TEXT").run();
    }
    if (!existing.has("lease_expires_at")) {
      this.db.prepare("ALTER TABLE tasks ADD COLUMN lease_expires_at INTEGER").run();
    }
    if (!existing.has("last_claimed_at")) {
      this.db.prepare("ALTER TABLE tasks ADD COLUMN last_claimed_at INTEGER").run();
    }
    if (!existing.has("claim_count")) {
      this.db.prepare("ALTER TABLE tasks ADD COLUMN claim_count INTEGER").run();
    }
  }

  private normalizeStaleTasksOnStartup(): void {
    const now = Date.now();
    if (this.usePostgres) {
      setImmediate(() => {
        void runPgQuery(
          "UPDATE tasks SET status = 'failed', error = COALESCE(error, 'Task failed after server restart'), completed_at = COALESCE(completed_at, $1), duration_ms = COALESCE(duration_ms, $1 - started_at) WHERE status IN ('pending', 'in_progress')",
          [now]
        )
          .then((result) => {
            const changes = result.rowCount || 0;
            if (changes > 0) {
              console.log(`✓ Marked ${changes} stale task(s) as failed`);
            }
          })
          .catch((error) => {
            console.warn(`[taskStore] Failed to normalize stale tasks: ${error instanceof Error ? error.message : String(error)}`);
          });
      });
      return;
    }

    const stmt = this.db.prepare(`
      UPDATE tasks
      SET
        status = 'failed',
        error = COALESCE(error, 'Task failed after server restart'),
        completed_at = COALESCE(completed_at, @now),
        duration_ms = COALESCE(duration_ms, @now - started_at)
      WHERE status IN ('pending', 'in_progress')
    `);
    const result = runDbRetrySync(() => stmt.run({ now }), "taskStore.normalizeStaleTasksOnStartup");
    if (result.changes > 0) {
      console.log(`✓ Marked ${result.changes} stale task(s) as failed`);
    }
  }

  private toJson(value: unknown): string | null {
    if (value == null) return null;
    try {
      return JSON.stringify(value);
    } catch {
      return null;
    }
  }

  private fromJson<T>(raw: string | null | undefined): T | undefined {
    if (!raw) return undefined;
    if (typeof raw !== "string") return raw as T;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return undefined;
    }
  }

  private rowToRecord(row: any): TaskRecord {
    return {
      id: String(row.id),
      input: String(row.input),
      output: row.output ?? undefined,
      rawOutput: row.raw_output ?? undefined,
      agentResult: this.fromJson(row.agent_result_json),
      status: row.status,
      agent: row.agent ?? undefined,
      agentVersion: row.agent_version ?? undefined,
      agentSelectionReason: row.agent_selection_reason ?? undefined,
      startedAt: Number(row.started_at),
      completedAt: row.completed_at != null ? Number(row.completed_at) : undefined,
      durationMs: row.duration_ms != null ? Number(row.duration_ms) : undefined,
      error: row.error ?? undefined,
      errorCode: row.error_code ?? undefined,
      failedLayer: row.failed_layer ?? undefined,
      stackTrace: row.stack_trace ?? undefined,
      suggestions: this.fromJson(row.suggestions_json),
      isRetry: row.is_retry != null ? Boolean(row.is_retry) : undefined,
      originalTaskId: row.original_task_id ?? undefined,
      retryCount: row.retry_count != null ? Number(row.retry_count) : undefined,
      retries: this.fromJson(row.retries_json),
      availableAgents: this.fromJson(row.available_agents_json),
      agentScores: this.fromJson(row.agent_scores_json),
      manuallySelected: row.manually_selected != null ? Boolean(row.manually_selected) : undefined,
      involvedAgents: this.fromJson(row.involved_agents_json),
      involvedAgentVersions: this.fromJson(row.involved_agent_versions_json),
      conversationId: row.conversation_id ?? undefined,
      messages: this.fromJson(row.messages_json),
      progress: row.progress != null ? Number(row.progress) : undefined,
      tags: this.fromJson(row.tags_json),
      userId: row.user_id ?? undefined,
      generation: this.fromJson(row.generation_json),
      systemMode: row.system_mode ?? undefined,
      multiAgentEnabled: row.multi_agent_enabled != null ? Boolean(row.multi_agent_enabled) : undefined,
      workerId: row.worker_id ?? undefined,
      leaseExpiresAt: row.lease_expires_at != null ? Number(row.lease_expires_at) : undefined,
      lastClaimedAt: row.last_claimed_at != null ? Number(row.last_claimed_at) : undefined,
      claimCount: row.claim_count != null ? Number(row.claim_count) : undefined,
    };
  }

  private buildTaskBindings(record: TaskRecord): Record<string, unknown> {
    return {
      id: record.id,
      input: record.input,
      output: record.output ?? null,
      raw_output: record.rawOutput ?? null,
      agent_result_json: this.toJson(record.agentResult),
      status: record.status,
      agent: record.agent ?? null,
      agent_version: record.agentVersion ?? null,
      agent_selection_reason: record.agentSelectionReason ?? null,
      started_at: record.startedAt,
      completed_at: record.completedAt ?? null,
      duration_ms: record.durationMs ?? null,
      error: record.error ?? null,
      error_code: record.errorCode ?? null,
      failed_layer: record.failedLayer ?? null,
      stack_trace: record.stackTrace ?? null,
      suggestions_json: this.toJson(record.suggestions),
      is_retry: record.isRetry != null ? (record.isRetry ? 1 : 0) : null,
      original_task_id: record.originalTaskId ?? null,
      retry_count: record.retryCount ?? null,
      retries_json: this.toJson(record.retries),
      available_agents_json: this.toJson(record.availableAgents),
      agent_scores_json: this.toJson(record.agentScores),
      manually_selected: record.manuallySelected != null ? (record.manuallySelected ? 1 : 0) : null,
      involved_agents_json: this.toJson(record.involvedAgents),
      involved_agent_versions_json: this.toJson(record.involvedAgentVersions),
      conversation_id: record.conversationId ?? null,
      messages_json: this.toJson(record.messages),
      progress: record.progress ?? null,
      tags_json: this.toJson(record.tags),
      user_id: record.userId ?? null,
      generation_json: this.toJson(record.generation),
      system_mode: record.systemMode ?? null,
      multi_agent_enabled: record.multiAgentEnabled != null ? (record.multiAgentEnabled ? 1 : 0) : null,
      worker_id: record.workerId ?? null,
      lease_expires_at: record.leaseExpiresAt ?? null,
      last_claimed_at: record.lastClaimedAt ?? null,
      claim_count: record.claimCount ?? null,
    };
  }

  private buildTaskParams(record: TaskRecord): Array<unknown> {
    const bindings = this.buildTaskBindings(record);
    return [
      bindings.id,
      bindings.input,
      bindings.output,
      bindings.raw_output,
      bindings.agent_result_json,
      bindings.status,
      bindings.agent,
      bindings.agent_version,
      bindings.agent_selection_reason,
      bindings.started_at,
      bindings.completed_at,
      bindings.duration_ms,
      bindings.error,
      bindings.error_code,
      bindings.failed_layer,
      bindings.stack_trace,
      bindings.suggestions_json,
      bindings.is_retry,
      bindings.original_task_id,
      bindings.retry_count,
      bindings.retries_json,
      bindings.available_agents_json,
      bindings.agent_scores_json,
      bindings.manually_selected,
      bindings.involved_agents_json,
      bindings.involved_agent_versions_json,
      bindings.conversation_id,
      bindings.messages_json,
      bindings.progress,
      bindings.tags_json,
      bindings.user_id,
      bindings.generation_json,
      bindings.system_mode,
      bindings.multi_agent_enabled,
      bindings.worker_id,
      bindings.lease_expires_at,
      bindings.last_claimed_at,
      bindings.claim_count,
    ];
  }

  private upsertTask(record: TaskRecord): void {
    if (this.usePostgres) {
      const params = this.buildTaskParams(record);
      runPgQuerySync(PG_TASK_UPSERT_SQL, params);
      return;
    }

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO tasks (
        id,
        input,
        output,
        raw_output,
        agent_result_json,
        status,
        agent,
        agent_version,
        agent_selection_reason,
        started_at,
        completed_at,
        duration_ms,
        error,
        error_code,
        failed_layer,
        stack_trace,
        suggestions_json,
        is_retry,
        original_task_id,
        retry_count,
        retries_json,
        available_agents_json,
        agent_scores_json,
        manually_selected,
        involved_agents_json,
        involved_agent_versions_json,
        conversation_id,
        messages_json,
        progress,
        tags_json,
        user_id,
        generation_json,
        system_mode,
        multi_agent_enabled,
        worker_id,
        lease_expires_at,
        last_claimed_at,
        claim_count
      ) VALUES (
        @id,
        @input,
        @output,
        @raw_output,
        @agent_result_json,
        @status,
        @agent,
        @agent_version,
        @agent_selection_reason,
        @started_at,
        @completed_at,
        @duration_ms,
        @error,
        @error_code,
        @failed_layer,
        @stack_trace,
        @suggestions_json,
        @is_retry,
        @original_task_id,
        @retry_count,
        @retries_json,
        @available_agents_json,
        @agent_scores_json,
        @manually_selected,
        @involved_agents_json,
        @involved_agent_versions_json,
        @conversation_id,
        @messages_json,
        @progress,
        @tags_json,
        @user_id,
        @generation_json,
        @system_mode,
        @multi_agent_enabled,
        @worker_id,
        @lease_expires_at,
        @last_claimed_at,
        @claim_count
      )
    `);

    runDbRetrySync(() => stmt.run(this.buildTaskBindings(record)), "taskStore.upsertTask");
  }

  private async upsertTaskAsync(record: TaskRecord): Promise<void> {
    if (!this.usePostgres) {
      this.upsertTask(record);
      return;
    }
    const params = this.buildTaskParams(record);
    await runPgQuery(PG_TASK_UPSERT_SQL, params);
  }

  /**
   * Create a new task record
   */
  createTask(input: string, metadata?: Partial<TaskRecord>): TaskRecord {
    this.ensureSqliteSync("createTask");
    const task: TaskRecord = {
      id: metadata?.id || uuidv4(),
      input,
      status: 'pending',
      startedAt: Date.now(),
      ...metadata,
    };

    this.upsertTask(task);
    return task;
  }

  async createTaskAsync(input: string, metadata?: Partial<TaskRecord>): Promise<TaskRecord> {
    const task: TaskRecord = {
      id: metadata?.id || uuidv4(),
      input,
      status: 'pending',
      startedAt: Date.now(),
      ...metadata,
    };

    await this.upsertTaskAsync(task);
    return task;
  }

  /**
   * Update an existing task
   */
  updateTask(taskId: string, updates: Partial<TaskRecord>): TaskRecord | null {
    this.ensureSqliteSync("updateTask");
    const task = this.getTask(taskId);
    if (!task) return null;

    const updated: TaskRecord = { ...task, ...updates };
    
    // Auto-calculate duration if completing
    if (updates.status === 'completed' || updates.status === 'failed') {
      if (!updated.completedAt) {
        updated.completedAt = Date.now();
      }
      if (!updated.durationMs) {
        updated.durationMs = updated.completedAt - updated.startedAt;
      }
    }

    this.upsertTask(updated);
    return updated;
  }

  async updateTaskAsync(taskId: string, updates: Partial<TaskRecord>): Promise<TaskRecord | null> {
    const task = await this.getTaskAsync(taskId);
    if (!task) return null;

    const updated: TaskRecord = { ...task, ...updates };

    if (updates.status === 'completed' || updates.status === 'failed') {
      if (!updated.completedAt) {
        updated.completedAt = Date.now();
      }
      if (!updated.durationMs) {
        updated.durationMs = updated.completedAt - updated.startedAt;
      }
    }

    await this.upsertTaskAsync(updated);
    return updated;
  }

  /**
   * Claim a task for a worker with a lease.
   */
  claimTask(taskId: string, workerId: string, leaseMs: number): boolean {
    this.ensureSqliteSync("claimTask");
    const now = Date.now();
    const leaseExpiresAt = now + Math.max(0, leaseMs);
    if (this.usePostgres) {
      const result = runPgQuerySync(
        `UPDATE tasks
         SET
           worker_id = $1,
           lease_expires_at = $2,
           last_claimed_at = $3,
           claim_count = COALESCE(claim_count, 0) + 1,
           status = 'in_progress'
         WHERE id = $4
           AND status IN ('pending', 'queued', 'in_progress')
           AND (lease_expires_at IS NULL OR lease_expires_at < $3)`,
        [workerId, leaseExpiresAt, now, taskId]
      );
      return (result.rowCount || 0) > 0;
    }

    const stmt = this.db.prepare(`
      UPDATE tasks
      SET
        worker_id = @workerId,
        lease_expires_at = @leaseExpiresAt,
        last_claimed_at = @now,
        claim_count = COALESCE(claim_count, 0) + 1,
        status = 'in_progress'
      WHERE id = @taskId
        AND status IN ('pending', 'queued', 'in_progress')
        AND (lease_expires_at IS NULL OR lease_expires_at < @now)
    `);

    const result = runDbRetrySync(
      () => stmt.run({ taskId, workerId, leaseExpiresAt, now }),
      "taskStore.claimTask"
    );
    return result.changes > 0;
  }

  async claimTaskAsync(taskId: string, workerId: string, leaseMs: number): Promise<boolean> {
    const now = Date.now();
    const leaseExpiresAt = now + Math.max(0, leaseMs);
    if (this.usePostgres) {
      const result = await runPgQuery(
        `UPDATE tasks
         SET
           worker_id = $1,
           lease_expires_at = $2,
           last_claimed_at = $3,
           claim_count = COALESCE(claim_count, 0) + 1,
           status = 'in_progress'
         WHERE id = $4
           AND status IN ('pending', 'queued', 'in_progress')
           AND (lease_expires_at IS NULL OR lease_expires_at < $3)`,
        [workerId, leaseExpiresAt, now, taskId]
      );
      return (result.rowCount || 0) > 0;
    }

    return this.claimTask(taskId, workerId, leaseMs);
  }

  /**
   * Rekey a task ID while preserving history references.
   */
  rekeyTask(oldTaskId: string, newTaskId: string): TaskRecord | null {
    this.ensureSqliteSync("rekeyTask");
    if (oldTaskId === newTaskId) return this.getTask(oldTaskId) || null;
    const task = this.getTask(oldTaskId);
    if (!task) return null;
    if (this.getTask(newTaskId)) return null;

    if (this.usePostgres) {
      return runPgTransactionSync(async (client) => {
        const existing = await client.query("SELECT * FROM tasks WHERE id = $1", [oldTaskId]);
        if (existing.rows.length === 0) return null;
        const already = await client.query("SELECT 1 FROM tasks WHERE id = $1", [newTaskId]);
        if (already.rows.length > 0) return null;

        const updated = { ...this.rowToRecord(existing.rows[0]), id: newTaskId };
        await client.query("DELETE FROM tasks WHERE id = $1", [oldTaskId]);
        await client.query(PG_TASK_UPSERT_SQL, this.buildTaskParams(updated));

        const allRows = await client.query(
          "SELECT id, retries_json, original_task_id FROM tasks"
        );
        for (const row of allRows.rows) {
          let changed = false;
          const retries = this.fromJson<string[]>(row.retries_json) || [];
          const originalTaskId = row.original_task_id ?? null;

          let updatedRetries = retries;
          if (retries.includes(oldTaskId)) {
            updatedRetries = retries.map((retryId) => (retryId === oldTaskId ? newTaskId : retryId));
            changed = true;
          }

          let updatedOriginal = originalTaskId;
          if (originalTaskId === oldTaskId) {
            updatedOriginal = newTaskId;
            changed = true;
          }

          if (changed) {
            await client.query(
              "UPDATE tasks SET retries_json = $1, original_task_id = $2 WHERE id = $3",
              [this.toJson(updatedRetries), updatedOriginal, row.id]
            );
          }
        }

        return updated;
      });
    }

    const updated = { ...task, id: newTaskId };
    const transaction = this.db.transaction(() => {
      this.db.prepare("DELETE FROM tasks WHERE id = ?").run(oldTaskId);
      this.upsertTask(updated);

      const all = this.query();
      for (const record of all) {
        let changed = false;
        if (Array.isArray(record.retries) && record.retries.includes(oldTaskId)) {
          record.retries = record.retries.map((retryId) => (retryId === oldTaskId ? newTaskId : retryId));
          changed = true;
        }
        if (record.originalTaskId === oldTaskId) {
          record.originalTaskId = newTaskId;
          changed = true;
        }
        if (changed) {
          this.upsertTask(record);
        }
      }
    });

    runDbRetrySync(transaction, "taskStore.rekeyTask");
    return updated;
  }

  async rekeyTaskAsync(oldTaskId: string, newTaskId: string): Promise<TaskRecord | null> {
    if (oldTaskId === newTaskId) return (await this.getTaskAsync(oldTaskId)) || null;
    const task = await this.getTaskAsync(oldTaskId);
    if (!task) return null;
    if (await this.getTaskAsync(newTaskId)) return null;

    if (this.usePostgres) {
      return runPgTransaction(async (client) => {
        const existing = await client.query("SELECT * FROM tasks WHERE id = $1", [oldTaskId]);
        if (existing.rows.length === 0) return null;
        const already = await client.query("SELECT 1 FROM tasks WHERE id = $1", [newTaskId]);
        if (already.rows.length > 0) return null;

        const updatedRecord = { ...this.rowToRecord(existing.rows[0]), id: newTaskId };
        await client.query("DELETE FROM tasks WHERE id = $1", [oldTaskId]);
        await client.query(PG_TASK_UPSERT_SQL, this.buildTaskParams(updatedRecord));

        const allRows = await client.query(
          "SELECT id, retries_json, original_task_id FROM tasks"
        );
        for (const row of allRows.rows) {
          let changed = false;
          const retries = this.fromJson<string[]>(row.retries_json) || [];
          const originalTaskId = row.original_task_id ?? null;

          let updatedRetries = retries;
          if (retries.includes(oldTaskId)) {
            updatedRetries = retries.map((retryId) => (retryId === oldTaskId ? newTaskId : retryId));
            changed = true;
          }

          let updatedOriginal = originalTaskId;
          if (originalTaskId === oldTaskId) {
            updatedOriginal = newTaskId;
            changed = true;
          }

          if (changed) {
            await client.query(
              "UPDATE tasks SET retries_json = $1, original_task_id = $2 WHERE id = $3",
              [this.toJson(updatedRetries), updatedOriginal, row.id]
            );
          }
        }

        return updatedRecord;
      });
    }

    return this.rekeyTask(oldTaskId, newTaskId);
  }

  /**
   * Get task by ID
   */
  getTask(taskId: string): TaskRecord | null {
    this.ensureSqliteSync("getTask");
    if (this.usePostgres) {
      const result = runPgQuerySync("SELECT * FROM tasks WHERE id = $1", [taskId]);
      const row = result.rows[0];
      return row ? this.rowToRecord(row) : null;
    }
    const row = this.db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId);
    return row ? this.rowToRecord(row) : null;
  }

  async getTaskAsync(taskId: string): Promise<TaskRecord | null> {
    if (this.usePostgres) {
      const result = await runPgQuery("SELECT * FROM tasks WHERE id = $1", [taskId]);
      const row = result.rows[0];
      return row ? this.rowToRecord(row) : null;
    }
    return this.getTask(taskId);
  }

  /**
   * Create a retry task linked to original
   */
  createRetry(originalTaskId: string, input?: string): TaskRecord | null {
    this.ensureSqliteSync("createRetry");
    const originalTask = this.getTask(originalTaskId);
    if (!originalTask) return null;

    const retryCount = (originalTask.retryCount || 0) + 1;
    
    // Create retry task
    const retryTask = this.createTask(input || originalTask.input, {
      isRetry: true,
      originalTaskId,
      retryCount,
      agent: originalTask.agent, // Suggest same agent
      tags: ['retry', ...(originalTask.tags || [])],
    });

    // Update original task to track retry
    const retries = originalTask.retries || [];
    retries.push(retryTask.id);
    this.updateTask(originalTaskId, { retries, retryCount });

    return retryTask;
  }

  async createRetryAsync(originalTaskId: string, input?: string): Promise<TaskRecord | null> {
    const originalTask = await this.getTaskAsync(originalTaskId);
    if (!originalTask) return null;

    const retryCount = (originalTask.retryCount || 0) + 1;
    const retryTask = await this.createTaskAsync(input || originalTask.input, {
      isRetry: true,
      originalTaskId,
      retryCount,
      agent: originalTask.agent,
      tags: ['retry', ...(originalTask.tags || [])],
    });

    const retries = originalTask.retries || [];
    retries.push(retryTask.id);
    await this.updateTaskAsync(originalTaskId, { retries, retryCount });

    return retryTask;
  }

  /**
   * Get retry chain for a task
   */
  getRetryChain(taskId: string): TaskRecord[] {
    this.ensureSqliteSync("getRetryChain");
    const task = this.getTask(taskId);
    if (!task) return [];

    const chain: TaskRecord[] = [task];

    // Get original task if this is a retry
    if (task.originalTaskId) {
      const original = this.getTask(task.originalTaskId);
      if (original) {
        chain.unshift(original);
      }
    }

    // Get all retries if this is original
    if (task.retries && task.retries.length > 0) {
      task.retries.forEach(retryId => {
        const retry = this.getTask(retryId);
        if (retry) {
          chain.push(retry);
        }
      });
    }

    return chain;
  }

  async getRetryChainAsync(taskId: string): Promise<TaskRecord[]> {
    const task = await this.getTaskAsync(taskId);
    if (!task) return [];

    const chain: TaskRecord[] = [task];

    if (task.originalTaskId) {
      const original = await this.getTaskAsync(task.originalTaskId);
      if (original) {
        chain.unshift(original);
      }
    }

    if (task.retries && task.retries.length > 0) {
      for (const retryId of task.retries) {
        const retry = await this.getTaskAsync(retryId);
        if (retry) {
          chain.push(retry);
        }
      }
    }

    return chain;
  }

  /**
   * Query tasks with filters
   */
  query(filters?: TaskQuery): TaskRecord[] {
    this.ensureSqliteSync("query");
    const where: string[] = [];
    const params: Record<string, unknown> = {};

    if (filters?.status) {
      const statuses = Array.isArray(filters.status) ? filters.status : [filters.status];
      const placeholders = statuses.map((_, idx) => `@status${idx}`);
      where.push(`status IN (${placeholders.join(',')})`);
      statuses.forEach((status, idx) => {
        params[`status${idx}`] = status;
      });
    }

    if (filters?.agent) {
      where.push("agent = @agent");
      params.agent = filters.agent;
    }

    if (filters?.startDate) {
      where.push("started_at >= @startDate");
      params.startDate = filters.startDate;
    }

    if (filters?.endDate) {
      where.push("started_at <= @endDate");
      params.endDate = filters.endDate;
    }

    if (filters?.isRetry !== undefined) {
      where.push("is_retry = @isRetry");
      params.isRetry = filters.isRetry ? 1 : 0;
    }

    if (filters?.originalTaskId) {
      where.push("original_task_id = @originalTaskId");
      params.originalTaskId = filters.originalTaskId;
    }

    const sortBy = filters?.sortBy || "startedAt";
    const sortOrder = filters?.sortOrder || "desc";
    const sortColumn =
      sortBy === "completedAt"
        ? "completed_at"
        : sortBy === "durationMs"
          ? "duration_ms"
          : "started_at";

    const offset = filters?.offset || 0;
    const limit = filters?.limit;
    if (limit != null) {
      params.limit = limit;
      params.offset = offset;
    }

    if (this.usePostgres) {
      const pgWhere: string[] = [];
      const pgParams: Array<unknown> = [];
      let idx = 1;

      if (filters?.status) {
        const statuses = Array.isArray(filters.status) ? filters.status : [filters.status];
        pgWhere.push(`status = ANY($${idx++})`);
        pgParams.push(statuses);
      }

      if (filters?.agent) {
        pgWhere.push(`agent = $${idx++}`);
        pgParams.push(filters.agent);
      }

      if (filters?.startDate) {
        pgWhere.push(`started_at >= $${idx++}`);
        pgParams.push(filters.startDate);
      }

      if (filters?.endDate) {
        pgWhere.push(`started_at <= $${idx++}`);
        pgParams.push(filters.endDate);
      }

      if (filters?.isRetry !== undefined) {
        pgWhere.push(`is_retry = $${idx++}`);
        pgParams.push(filters.isRetry ? 1 : 0);
      }

      if (filters?.originalTaskId) {
        pgWhere.push(`original_task_id = $${idx++}`);
        pgParams.push(filters.originalTaskId);
      }

      let limitClause = "";
      if (limit != null) {
        pgParams.push(limit, offset);
        limitClause = ` LIMIT $${idx++} OFFSET $${idx++}`;
      }

      const sql = `SELECT * FROM tasks${pgWhere.length ? ` WHERE ${pgWhere.join(" AND ")}` : ""} ORDER BY ${sortColumn} ${sortOrder.toUpperCase()}${limitClause}`;
      const result = runPgQuerySync(sql, pgParams);
      return (result.rows as any[]).map((row) => this.rowToRecord(row));
    }

    const sql = `SELECT * FROM tasks${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY ${sortColumn} ${sortOrder.toUpperCase()}${limit != null ? " LIMIT @limit OFFSET @offset" : ""}`;
    const stmt = this.db.prepare(sql);
    const rows = stmt.all(params);
    return rows.map((row: any) => this.rowToRecord(row));
  }

  async queryAsync(filters?: TaskQuery): Promise<TaskRecord[]> {
    if (!this.usePostgres) return this.query(filters);

    const sortBy = filters?.sortBy || "startedAt";
    const sortOrder = filters?.sortOrder || "desc";
    const sortColumn =
      sortBy === "completedAt"
        ? "completed_at"
        : sortBy === "durationMs"
          ? "duration_ms"
          : "started_at";

    const offset = filters?.offset || 0;
    const limit = filters?.limit;

    const pgWhere: string[] = [];
    const pgParams: Array<unknown> = [];
    let idx = 1;

    if (filters?.status) {
      const statuses = Array.isArray(filters.status) ? filters.status : [filters.status];
      pgWhere.push(`status = ANY($${idx++})`);
      pgParams.push(statuses);
    }

    if (filters?.agent) {
      pgWhere.push(`agent = $${idx++}`);
      pgParams.push(filters.agent);
    }

    if (filters?.startDate) {
      pgWhere.push(`started_at >= $${idx++}`);
      pgParams.push(filters.startDate);
    }

    if (filters?.endDate) {
      pgWhere.push(`started_at <= $${idx++}`);
      pgParams.push(filters.endDate);
    }

    if (filters?.isRetry !== undefined) {
      pgWhere.push(`is_retry = $${idx++}`);
      pgParams.push(filters.isRetry ? 1 : 0);
    }

    if (filters?.originalTaskId) {
      pgWhere.push(`original_task_id = $${idx++}`);
      pgParams.push(filters.originalTaskId);
    }

    let limitClause = "";
    if (limit != null) {
      pgParams.push(limit, offset);
      limitClause = ` LIMIT $${idx++} OFFSET $${idx++}`;
    }

    const sql = `SELECT * FROM tasks${pgWhere.length ? ` WHERE ${pgWhere.join(" AND ")}` : ""} ORDER BY ${sortColumn} ${sortOrder.toUpperCase()}${limitClause}`;
    const result = await runPgQuery(sql, pgParams);
    return (result.rows as any[]).map((row) => this.rowToRecord(row));
  }

  /**
   * Get statistics
   */
  getStats(): {
    total: number;
    byStatus: Record<string, number>;
    byAgent: Record<string, number>;
    avgDuration: number;
    successRate: number;
    retryRate: number;
  } {
    this.ensureSqliteSync("getStats");
    const tasks = this.query();
    const total = tasks.length;

    const byStatus: Record<string, number> = {};
    const byAgent: Record<string, number> = {};
    let totalDuration = 0;
    let completedCount = 0;
    let retryCount = 0;

    tasks.forEach(task => {
      // Count by status
      byStatus[task.status] = (byStatus[task.status] || 0) + 1;

      // Count by agent
      if (task.agent) {
        byAgent[task.agent] = (byAgent[task.agent] || 0) + 1;
      }

      // Calculate average duration
      if (task.durationMs) {
        totalDuration += task.durationMs;
        completedCount++;
      }

      // Count retries
      if (task.isRetry) {
        retryCount++;
      }
    });

    const avgDuration = completedCount > 0 ? totalDuration / completedCount : 0;
    const successRate = total > 0 ? (byStatus['completed'] || 0) / total : 0;
    const retryRate = total > 0 ? retryCount / total : 0;

    return {
      total,
      byStatus,
      byAgent,
      avgDuration,
      successRate,
      retryRate,
    };
  }

  async getStatsAsync(): Promise<{
    total: number;
    byStatus: Record<string, number>;
    byAgent: Record<string, number>;
    avgDuration: number;
    successRate: number;
    retryRate: number;
  }> {
    const tasks = await this.queryAsync();
    const total = tasks.length;

    const byStatus: Record<string, number> = {};
    const byAgent: Record<string, number> = {};
    let totalDuration = 0;
    let completedCount = 0;
    let retryCount = 0;

    tasks.forEach(task => {
      byStatus[task.status] = (byStatus[task.status] || 0) + 1;
      if (task.agent) {
        byAgent[task.agent] = (byAgent[task.agent] || 0) + 1;
      }
      if (task.durationMs) {
        totalDuration += task.durationMs;
        completedCount++;
      }
      if (task.isRetry) {
        retryCount++;
      }
    });

    const avgDuration = completedCount > 0 ? totalDuration / completedCount : 0;
    const successRate = total > 0 ? (byStatus['completed'] || 0) / total : 0;
    const retryRate = total > 0 ? retryCount / total : 0;

    return {
      total,
      byStatus,
      byAgent,
      avgDuration,
      successRate,
      retryRate,
    };
  }

  /**
   * Delete old tasks (cleanup)
   */
  deleteOlderThan(daysOld: number): number {
    this.ensureSqliteSync("deleteOlderThan");
    const cutoffDate = Date.now() - (daysOld * 24 * 60 * 60 * 1000);
    if (this.usePostgres) {
      const result = runPgQuerySync("DELETE FROM tasks WHERE started_at < $1", [cutoffDate]);
      return result.rowCount || 0;
    }
    const result = runDbRetrySync(
      () => this.db.prepare("DELETE FROM tasks WHERE started_at < ?").run(cutoffDate),
      "taskStore.deleteOlderThan"
    );
    return result.changes;
  }

  async deleteOlderThanAsync(daysOld: number): Promise<number> {
    const cutoffDate = Date.now() - (daysOld * 24 * 60 * 60 * 1000);
    if (this.usePostgres) {
      const result = await runPgQuery("DELETE FROM tasks WHERE started_at < $1", [cutoffDate]);
      return result.rowCount || 0;
    }
    return this.deleteOlderThan(daysOld);
  }

  /**
   * Clear all tasks (use with caution!)
   */
  clear(): void {
    this.ensureSqliteSync("clear");
    if (this.usePostgres) {
      runPgQuerySync("DELETE FROM tasks");
      return;
    }
    runDbRetrySync(() => this.db.prepare("DELETE FROM tasks").run(), "taskStore.clear");
  }

  async clearAsync(): Promise<void> {
    if (this.usePostgres) {
      await runPgQuery("DELETE FROM tasks");
      return;
    }
    this.clear();
  }

  /**
   * Clear all tasks and return count
   */
  clearAll(): number {
    this.ensureSqliteSync("clearAll");
    if (this.usePostgres) {
      const result = runPgQuerySync<{ count: number }>("SELECT COUNT(*) as count FROM tasks");
      const total = result.rows.length ? Number(result.rows[0].count) : 0;
      runPgQuerySync("DELETE FROM tasks");
      return total;
    }
    const count = this.db.prepare("SELECT COUNT(*) as count FROM tasks").get() as { count: number };
    runDbRetrySync(() => this.db.prepare("DELETE FROM tasks").run(), "taskStore.clearAll");
    return count.count;
  }

  async clearAllAsync(): Promise<number> {
    if (this.usePostgres) {
      const result = await runPgQuery<{ count: number }>("SELECT COUNT(*) as count FROM tasks");
      const total = result.rows.length ? Number(result.rows[0].count) : 0;
      await runPgQuery("DELETE FROM tasks");
      return total;
    }
    return this.clearAll();
  }

  /**
   * Delete a specific task by ID
   */
  deleteTask(taskId: string): boolean {
    this.ensureSqliteSync("deleteTask");
    if (this.usePostgres) {
      const result = runPgQuerySync("DELETE FROM tasks WHERE id = $1", [taskId]);
      return (result.rowCount || 0) > 0;
    }
    const result = runDbRetrySync(
      () => this.db.prepare("DELETE FROM tasks WHERE id = ?").run(taskId),
      "taskStore.deleteTask"
    );
    return result.changes > 0;
  }

  async deleteTaskAsync(taskId: string): Promise<boolean> {
    if (this.usePostgres) {
      const result = await runPgQuery("DELETE FROM tasks WHERE id = $1", [taskId]);
      return (result.rowCount || 0) > 0;
    }
    return this.deleteTask(taskId);
  }

  /**
   * Delete all tasks in a conversation by conversationId
   */
  deleteByConversationId(conversationId: string): number {
    this.ensureSqliteSync("deleteByConversationId");
    if (this.usePostgres) {
      const result = runPgQuerySync("DELETE FROM tasks WHERE conversation_id = $1", [conversationId]);
      return result.rowCount || 0;
    }
    const result = runDbRetrySync(
      () => this.db.prepare("DELETE FROM tasks WHERE conversation_id = ?").run(conversationId),
      "taskStore.deleteByConversationId"
    );
    return result.changes;
  }

  async deleteByConversationIdAsync(conversationId: string): Promise<number> {
    if (this.usePostgres) {
      const result = await runPgQuery("DELETE FROM tasks WHERE conversation_id = $1", [conversationId]);
      return result.rowCount || 0;
    }
    return this.deleteByConversationId(conversationId);
  }

  /**
   * Force immediate save to disk
   */
  flush(): void {
    // SQLite writes are immediate; no-op for API compatibility.
  }
}

// Singleton instance
export const taskStore = new TaskStore();
