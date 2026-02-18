import { auditLogger } from "../security/auditLogger";

export type DbRetryOptions = {
  retries?: number;
  baseDelayMs?: number;
  jitterMs?: number;
  maxDelayMs?: number;
};

const DEFAULT_RETRIES = 3;
const DEFAULT_BASE_DELAY_MS = 100;
const DEFAULT_JITTER_MS = 50;
const DEFAULT_MAX_DELAY_MS = 2000;
let auditLoggingInProgress = false;

function resolveNumberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw.trim() === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.floor(value) : fallback;
}

function getRetryDefaults(): Required<DbRetryOptions> {
  return {
    retries: resolveNumberEnv("PERSIST_DB_RETRIES", DEFAULT_RETRIES),
    baseDelayMs: resolveNumberEnv("PERSIST_DB_RETRY_BASE_MS", DEFAULT_BASE_DELAY_MS),
    jitterMs: resolveNumberEnv("PERSIST_DB_RETRY_JITTER_MS", DEFAULT_JITTER_MS),
    maxDelayMs: resolveNumberEnv("PERSIST_DB_RETRY_MAX_MS", DEFAULT_MAX_DELAY_MS),
  };
}

function sleepSync(ms: number): void {
  if (ms <= 0) return;
  const shared = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(shared, 0, 0, ms);
}

function computeBackoffMs(attempt: number, baseDelayMs: number, maxDelayMs: number, jitterMs: number): number {
  const exponential = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt));
  if (jitterMs <= 0) return exponential;
  const jitter = Math.floor(Math.random() * jitterMs);
  return Math.min(maxDelayMs, exponential + jitter);
}

export function isTransientDbError(err: unknown): boolean {
  const anyErr = err as { code?: string; message?: string };
  const code = typeof anyErr?.code === "string" ? anyErr.code : "";
  const message = typeof anyErr?.message === "string" ? anyErr.message : String(err);

  if (/SQLITE_BUSY|SQLITE_LOCKED/i.test(code)) return true;
  if (/SQLITE_BUSY|SQLITE_LOCKED|database is locked|database is busy/i.test(message)) return true;
  if (/SQLITE_IOERR|SQLITE_PROTOCOL|SQLITE_CANTOPEN/i.test(code)) return true;
  if (/I\/O error|disk I\/O error|could not open/i.test(message)) return true;

  if (/^(40001|40P01|53300|57P01|57P03|08006)$/i.test(code)) return true;
  if (/serialization failure|deadlock detected|too many connections|connection.*failed/i.test(message)) return true;

  return false;
}

function isDiskFullError(err: unknown): boolean {
  const anyErr = err as { code?: string; message?: string };
  const code = typeof anyErr?.code === "string" ? anyErr.code : "";
  const message = typeof anyErr?.message === "string" ? anyErr.message : String(err);
  return /SQLITE_FULL|SQLITE_NOSPC/i.test(code) || /database or disk is full|no space/i.test(message);
}

function logDbIssue(
  context: string,
  err: unknown,
  attempt: number,
  maxRetries: number,
  transient: boolean
): void {
  const message = err instanceof Error ? err.message : String(err);
  const level = transient && attempt < maxRetries ? "warn" : "error";
  const summary = `[db] ${context} failed (attempt ${attempt + 1}/${maxRetries + 1}) - ${message}`;

  if (level === "warn") {
    console.warn(summary);
  } else {
    console.error(summary);
  }

  if (isDiskFullError(err)) {
    console.error("[db] Disk full or no space left on device.");
  }

  if (!auditLoggingInProgress) {
    auditLoggingInProgress = true;
    try {
      auditLogger.log({
        eventType: "db-error",
        agentId: "system",
        details: {
          context,
          message,
          attempt: attempt + 1,
          maxRetries: maxRetries + 1,
          transient,
        },
      });
    } catch {
      // Avoid cascading failures if persistence is unavailable.
    } finally {
      auditLoggingInProgress = false;
    }
  }
}

export function runDbRetrySync<T>(operation: () => T, context: string, options?: DbRetryOptions): T {
  const defaults = getRetryDefaults();
  const retries = options?.retries ?? defaults.retries;
  const baseDelayMs = options?.baseDelayMs ?? defaults.baseDelayMs;
  const jitterMs = options?.jitterMs ?? defaults.jitterMs;
  const maxDelayMs = options?.maxDelayMs ?? defaults.maxDelayMs;

  let attempt = 0;
  while (true) {
    try {
      return operation();
    } catch (err) {
      const transient = isTransientDbError(err);
      logDbIssue(context, err, attempt, retries, transient);
      if (!transient || attempt >= retries) {
        throw err;
      }
      const delay = computeBackoffMs(attempt, baseDelayMs, maxDelayMs, jitterMs);
      sleepSync(delay);
      attempt += 1;
    }
  }
}
