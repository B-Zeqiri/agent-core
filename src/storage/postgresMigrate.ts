import * as fs from "fs";
import * as path from "path";
import { getPostgresPool, runPgQuery } from "./postgresDb";
import { getPersistenceDriver } from "./persistenceDriver";

type Migration = {
  version: number;
  filename: string;
  sql: string;
};

function parseVersion(filename: string): number {
  const match = filename.match(/^(\d+)_/);
  if (!match) return 0;
  return Number(match[1]);
}

function loadMigrations(dirPath: string): Migration[] {
  if (!fs.existsSync(dirPath)) return [];
  const files = fs
    .readdirSync(dirPath)
    .filter((name) => name.endsWith(".sql"))
    .sort();

  return files
    .map((filename) => {
      const version = parseVersion(filename);
      const sql = fs.readFileSync(path.join(dirPath, filename), "utf-8");
      return { version, filename, sql };
    })
    .filter((migration) => migration.version > 0);
}

async function ensureSchemaMigrations(): Promise<void> {
  await runPgQuery(
    "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at BIGINT NOT NULL)"
  );
}

async function getCurrentVersion(): Promise<number> {
  const result = await runPgQuery<{ version: number }>(
    "SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1"
  );
  return result.rows.length ? Number(result.rows[0].version) : 0;
}

async function applyMigration(migration: Migration): Promise<void> {
  const pool = getPostgresPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(migration.sql);
    await client.query(
      "INSERT INTO schema_migrations (version, applied_at) VALUES ($1, $2)",
      [migration.version, Date.now()]
    );
    await client.query("COMMIT");
    console.log(`[pg] Applied migration ${migration.filename}`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function runMigrations(): Promise<void> {
  if (getPersistenceDriver() !== "postgres") {
    console.log("[pg] Skipping migrations (PERSIST_DB_DRIVER is not 'postgres').");
    return;
  }

  const migrationsDir = path.join(__dirname, "migrations", "postgres");
  const migrations = loadMigrations(migrationsDir);
  if (migrations.length === 0) {
    console.log("[pg] No migrations found.");
    return;
  }

  await ensureSchemaMigrations();
  const currentVersion = await getCurrentVersion();

  const pending = migrations.filter((migration) => migration.version > currentVersion);
  if (pending.length === 0) {
    console.log("[pg] No pending migrations.");
    return;
  }

  for (const migration of pending) {
    await applyMigration(migration);
  }
}

runMigrations().catch((error) => {
  console.error(`[pg] Migration failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
