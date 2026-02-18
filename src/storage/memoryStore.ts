import { getSqliteDb } from "./sqliteDb";
import { resolvePersistenceFlag } from "./persistenceConfig";
import { safeJson, safeJsonParse } from "./serialization";
import { MemoryEntry } from "../memory/agentMemory";
import { runDbRetrySync } from "./dbUtils";
import { getPersistenceDriver } from "./persistenceDriver";
import { runPgQuerySync } from "./postgresDb";

export interface PersistedMemoryEntry extends MemoryEntry {
  pinnedLong: boolean;
}

const MEMORY_ENABLED = resolvePersistenceFlag(
  process.env.PERSIST_MEMORY,
  true
);

export class MemoryStore {
  saveEntry(agentId: string, entry: MemoryEntry, pinnedLong: boolean): void {
    if (!MEMORY_ENABLED) return;

    try {
      if (getPersistenceDriver() === "postgres") {
        runPgQuerySync(
          "INSERT INTO memory_entries (id, agent_id, content, entry_type, timestamp, metadata_json, pinned_long) VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO UPDATE SET agent_id = excluded.agent_id, content = excluded.content, entry_type = excluded.entry_type, timestamp = excluded.timestamp, metadata_json = excluded.metadata_json, pinned_long = excluded.pinned_long",
          [
            entry.id,
            agentId,
            entry.content,
            entry.type,
            entry.timestamp,
            safeJson(entry.metadata ?? null),
            pinnedLong ? 1 : 0,
          ]
        );
        return;
      }

      const db = getSqliteDb();
      const stmt = db.prepare(
        "INSERT OR REPLACE INTO memory_entries (id, agent_id, content, entry_type, timestamp, metadata_json, pinned_long) VALUES (?, ?, ?, ?, ?, ?, ?)"
      );
      runDbRetrySync(
        () =>
          stmt.run(
            entry.id,
            agentId,
            entry.content,
            entry.type,
            entry.timestamp,
            safeJson(entry.metadata ?? null),
            pinnedLong ? 1 : 0
          ),
        "memoryStore.saveEntry"
      );
    } catch (error) {
      console.warn(`[memoryStore] Failed to persist memory entry: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  loadAgentMemory(agentId: string, maxShortTermSize: number): { shortTerm: MemoryEntry[]; longTerm: MemoryEntry[] } {
    if (!MEMORY_ENABLED) {
      return { shortTerm: [], longTerm: [] };
    }
    let rows: any[] = [];

    if (getPersistenceDriver() === "postgres") {
      const result = runPgQuerySync(
        "SELECT id, content, entry_type, timestamp, metadata_json, pinned_long FROM memory_entries WHERE agent_id = $1 ORDER BY timestamp ASC",
        [agentId]
      );
      rows = result.rows as any[];
    } else {
      const db = getSqliteDb();
      rows = db
        .prepare(
          "SELECT id, content, entry_type, timestamp, metadata_json, pinned_long FROM memory_entries WHERE agent_id = ? ORDER BY timestamp ASC"
        )
        .all(agentId);
    }

    const entries: PersistedMemoryEntry[] = rows.map((row: any) => ({
      id: row.id,
      content: row.content,
      type: row.entry_type,
      timestamp: row.timestamp,
      metadata: safeJsonParse(row.metadata_json, undefined),
      pinnedLong: Boolean(row.pinned_long),
    }));

    const pinned = entries.filter((entry) => entry.pinnedLong).map(({ pinnedLong, ...rest }) => rest);
    const unpinned = entries.filter((entry) => !entry.pinnedLong).map(({ pinnedLong, ...rest }) => rest);

    const shortTerm = maxShortTermSize > 0 ? unpinned.slice(-maxShortTermSize) : [];
    const longTerm = unpinned.slice(0, Math.max(0, unpinned.length - shortTerm.length));

    return {
      shortTerm,
      longTerm: [...pinned, ...longTerm],
    };
  }

  deleteAgentMemory(agentId: string): void {
    if (!MEMORY_ENABLED) return;
    if (getPersistenceDriver() === "postgres") {
      runPgQuerySync("DELETE FROM memory_entries WHERE agent_id = $1", [agentId]);
      return;
    }
    const db = getSqliteDb();
    runDbRetrySync(
      () => db.prepare("DELETE FROM memory_entries WHERE agent_id = ?").run(agentId),
      "memoryStore.deleteAgentMemory"
    );
  }
}

export const memoryStore = new MemoryStore();
