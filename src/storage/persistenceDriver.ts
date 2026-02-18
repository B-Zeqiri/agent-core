export type PersistenceDriver = "sqlite" | "postgres";

export function getPersistenceDriver(): PersistenceDriver {
  const raw = String(process.env.PERSIST_DB_DRIVER || "sqlite").trim().toLowerCase();
  return raw === "postgres" ? "postgres" : "sqlite";
}

export function isPostgresDriver(): boolean {
  return getPersistenceDriver() === "postgres";
}

export function getPostgresUrl(): string {
  const url =
    process.env.PG_URL ||
    process.env.POSTGRES_URL ||
    process.env.DATABASE_URL ||
    "";
  if (!url.trim()) {
    throw new Error("Postgres driver selected but PG_URL/POSTGRES_URL/DATABASE_URL is empty.");
  }
  return url;
}
