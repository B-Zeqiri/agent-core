import * as fs from "fs";
import * as path from "path";
import { auditStore } from "./auditStore";
import { logStore } from "./logStore";
import { replayStore } from "./replayStore";
import { stateChangeStore } from "./stateChangeStore";
import { toolCallStore } from "./toolCallStore";
import { checkpointSqliteDb, getSqliteDbPath } from "./sqliteDb";
import { getPersistenceDriver } from "./persistenceDriver";

const DAY_MS = 24 * 60 * 60 * 1000;

function parseIntOrDefault(raw: string | undefined, fallback: number): number {
  if (raw == null || raw.trim() === "") return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? Math.floor(value) : fallback;
}

function parseBoolOrDefault(raw: string | undefined, fallback: boolean): boolean {
  if (raw == null || raw.trim() === "") return fallback;
  return ["1", "true", "yes", "on"].includes(raw.toLowerCase());
}

function ensureDir(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

function getDirectorySizeBytes(dirPath: string): number {
  if (!fs.existsSync(dirPath)) return 0;
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  let total = 0;
  for (const entry of entries) {
    const entryPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      total += getDirectorySizeBytes(entryPath);
    } else if (entry.isFile()) {
      try {
        total += fs.statSync(entryPath).size;
      } catch {
        // ignore stat failures
      }
    }
  }
  return total;
}

function bytesToMb(bytes: number): number {
  return Math.round((bytes / (1024 * 1024)) * 10) / 10;
}

function formatTimestamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    "-",
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join("");
}

export async function runRetentionCleanup(): Promise<void> {
  const retentionDays = parseIntOrDefault(process.env.PERSIST_RETENTION_DAYS, 30);
  if (retentionDays <= 0) return;

  const cutoffMs = Date.now() - retentionDays * DAY_MS;
  if (getPersistenceDriver() === "postgres") {
    await Promise.all([
      logStore.deleteOlderThanAsync(cutoffMs),
      toolCallStore.deleteOlderThanAsync(cutoffMs),
      stateChangeStore.deleteOlderThanAsync(cutoffMs),
      auditStore.deleteOlderThanAsync(cutoffMs),
      replayStore.deleteOlderThanAsync(cutoffMs),
    ]);
    return;
  }

  logStore.deleteOlderThan(cutoffMs);
  toolCallStore.deleteOlderThan(cutoffMs);
  stateChangeStore.deleteOlderThan(cutoffMs);
  auditStore.deleteOlderThan(cutoffMs);
  replayStore.deleteOlderThan(cutoffMs);
}

export function runBackup(): string | null {
  const backupsEnabled = parseBoolOrDefault(process.env.PERSIST_BACKUPS, true);
  if (!backupsEnabled) return null;

  if (getPersistenceDriver() === "postgres") {
    console.warn("[storage] Postgres driver active; SQLite backup skipped.");
    return null;
  }

  const dbPath = getSqliteDbPath();
  if (!dbPath || !fs.existsSync(dbPath)) return null;

  const backupDir = process.env.PERSIST_BACKUP_DIR || path.join(process.cwd(), ".data", "backups");
  ensureDir(backupDir);

  checkpointSqliteDb();

  const timestamp = formatTimestamp(new Date());
  const backupName = `agent-core-${timestamp}.db`;
  const backupPath = path.join(backupDir, backupName);
  fs.copyFileSync(dbPath, backupPath);
  return backupPath;
}

export function runDiskUsageCheck(): void {
  if (getPersistenceDriver() === "postgres") {
    return;
  }
  const dbPath = getSqliteDbPath();
  if (!dbPath || !fs.existsSync(dbPath)) return;

  const dbSizeBytes = fs.statSync(dbPath).size;
  const dbMaxMb = parseIntOrDefault(process.env.PERSIST_DB_MAX_MB, 1024);
  const dbSizeMb = bytesToMb(dbSizeBytes);

  if (dbMaxMb > 0 && dbSizeMb >= dbMaxMb) {
    console.warn(`[storage] DB size ${dbSizeMb}MB exceeds limit ${dbMaxMb}MB.`);
  }

  const backupDir = process.env.PERSIST_BACKUP_DIR || path.join(process.cwd(), ".data", "backups");
  const backupSizeBytes = getDirectorySizeBytes(backupDir);
  const backupMaxMb = parseIntOrDefault(process.env.PERSIST_BACKUP_MAX_MB, 2048);
  const backupSizeMb = bytesToMb(backupSizeBytes);

  if (backupMaxMb > 0 && backupSizeMb >= backupMaxMb) {
    console.warn(`[storage] Backup size ${backupSizeMb}MB exceeds limit ${backupMaxMb}MB.`);
  }
}

export function schedulePersistenceMaintenance(): void {
  void runRetentionCleanup();
  runBackup();
  runDiskUsageCheck();

  const cleanupIntervalMs = parseIntOrDefault(process.env.PERSIST_CLEANUP_INTERVAL_MS, DAY_MS);
  if (cleanupIntervalMs > 0) {
    setInterval(() => void runRetentionCleanup(), cleanupIntervalMs);
  }

  const backupIntervalMs = parseIntOrDefault(process.env.PERSIST_BACKUP_INTERVAL_MS, DAY_MS);
  if (backupIntervalMs > 0) {
    setInterval(runBackup, backupIntervalMs);
  }

  const diskCheckIntervalMs = parseIntOrDefault(process.env.PERSIST_DISK_CHECK_INTERVAL_MS, DAY_MS);
  if (diskCheckIntervalMs > 0) {
    setInterval(runDiskUsageCheck, diskCheckIntervalMs);
  }
}
