import Database from "better-sqlite3";
import * as fs from "fs";
import * as path from "path";
import { getPersistenceDriver } from "./persistenceDriver";

function resolveBackupPath(): string | null {
  const argPath = process.argv[2];
  if (argPath && argPath.trim() !== "") {
    return path.resolve(argPath);
  }

  const backupDir = process.env.PERSIST_BACKUP_DIR || path.join(process.cwd(), ".data", "backups");
  if (!fs.existsSync(backupDir)) return null;

  const entries = fs.readdirSync(backupDir)
    .map((name) => path.join(backupDir, name))
    .filter((fullPath) => fullPath.toLowerCase().endsWith(".db"));

  if (entries.length === 0) return null;

  entries.sort((a, b) => {
    const aTime = fs.statSync(a).mtimeMs;
    const bTime = fs.statSync(b).mtimeMs;
    return bTime - aTime;
  });

  return entries[0];
}

function verifyBackup(dbPath: string): boolean {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const integrityRow = db.prepare("PRAGMA integrity_check").get() as Record<string, string> | undefined;
    const integrity = integrityRow ? Object.values(integrityRow)[0] : undefined;
    if (integrity !== "ok") {
      console.error(`[backup] Integrity check failed: ${integrity ?? "unknown"}`);
      return false;
    }

    const schemaRow = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'")
      .get() as { name?: string } | undefined;
    if (!schemaRow?.name) {
      console.error("[backup] schema_migrations table missing.");
      return false;
    }

    const versionRow = db.prepare("SELECT version FROM schema_migrations WHERE id = 1").get() as { version?: number } | undefined;
    const version = typeof versionRow?.version === "number" ? versionRow.version : "unknown";

    console.log(`[backup] Integrity check ok. schema_migrations version: ${version}.`);
    return true;
  } finally {
    db.close();
  }
}

const backupPath = resolveBackupPath();
if (getPersistenceDriver() === "postgres") {
  console.error("[backup] Postgres driver active; SQLite backup verification skipped.");
  process.exit(1);
}
if (!backupPath) {
  console.error("[backup] No backup file found. Provide a path or set PERSIST_BACKUP_DIR.");
  process.exit(1);
}

if (!fs.existsSync(backupPath)) {
  console.error(`[backup] Backup file not found: ${backupPath}`);
  process.exit(1);
}

const ok = verifyBackup(backupPath);
process.exit(ok ? 0 : 1);
