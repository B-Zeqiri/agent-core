import { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";
import { runDbRetrySync } from "./dbUtils";
import { getPersistenceDriver, getPostgresUrl } from "./persistenceDriver";

let pool: Pool | null = null;

// Blocks the event loop to keep sync store APIs consistent across drivers.
function waitForPromise<T>(promise: Promise<T>): T {
  const shared = new Int32Array(new SharedArrayBuffer(4));
  let result: T | undefined;
  let error: unknown;

  promise
    .then((value) => {
      result = value;
      Atomics.store(shared, 0, 1);
      Atomics.notify(shared, 0);
    })
    .catch((err) => {
      error = err;
      Atomics.store(shared, 0, 1);
      Atomics.notify(shared, 0);
    });

  while (Atomics.load(shared, 0) === 0) {
    Atomics.wait(shared, 0, 0, 100);
  }

  if (error) {
    throw error;
  }
  return result as T;
}

export function getPostgresPool(): Pool {
  if (pool) return pool;
  if (getPersistenceDriver() !== "postgres") {
    throw new Error("Postgres pool requested while PERSIST_DB_DRIVER is not 'postgres'.");
  }
  const url = getPostgresUrl();
  const connectTimeoutMs = Number(process.env.PG_CONNECT_TIMEOUT_MS || 5000);
  pool = new Pool({
    connectionString: url,
    max: Number(process.env.PG_POOL_MAX || 10),
    connectionTimeoutMillis: Number.isFinite(connectTimeoutMs) ? connectTimeoutMs : 5000,
  });
  return pool;
}

export function runPgQuerySync<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
): QueryResult<T> {
  return runDbRetrySync(
    () => waitForPromise(getPostgresPool().query<T>(text, params)),
    "postgresDb.query"
  );
}

export function runPgTransactionSync<T>(handler: (client: PoolClient) => Promise<T>): T {
  return runDbRetrySync(
    () =>
      waitForPromise(
        (async () => {
          const client = await getPostgresPool().connect();
          try {
            await client.query("BEGIN");
            const result = await handler(client);
            await client.query("COMMIT");
            return result;
          } catch (error) {
            try {
              await client.query("ROLLBACK");
            } catch {
              // ignore rollback failure
            }
            throw error;
          } finally {
            client.release();
          }
        })()
      ),
    "postgresDb.transaction"
  );
}

export async function runPgQuery<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<QueryResult<T>> {
  return getPostgresPool().query<T>(text, params);
}

export async function runPgTransaction<T>(handler: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPostgresPool().connect();
  try {
    await client.query("BEGIN");
    const result = await handler(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore rollback failure
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function closePostgresPool(): Promise<void> {
  if (!pool) return;
  const current = pool;
  pool = null;
  await current.end();
}
