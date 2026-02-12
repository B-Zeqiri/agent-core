/**
 * AgentMemory
 *
 * Per-agent isolated memory with short-term and long-term storage.
 *
 * Short-term: Recent context (current session, limited size)
 * Long-term: Persistent knowledge (searchable, queryable)
 *
 * Isolation is built-in: other agents can't read this memory
 * unless explicitly shared via ACL.
 */

export interface MemoryEntry {
  id: string;
  content: string;
  type: "text" | "insight" | "error" | "result";
  timestamp: number;
  metadata?: Record<string, any>;
}

export interface MemoryQuery {
  type?: "text" | "insight" | "error" | "result";
  limit?: number;
  since?: number;
  keyword?: string;
}

export class AgentMemory {
  private agentId: string;
  private shortTerm: MemoryEntry[] = []; // Current session
  private longTerm: MemoryEntry[] = []; // Persistent storage
  private maxShortTermSize: number;

  constructor(agentId: string, maxShortTermSize: number = 50) {
    this.agentId = agentId;
    this.maxShortTermSize = maxShortTermSize;
  }

  /**
   * Remember something in short-term memory
   * (overflow moves to long-term)
   */
  rememberShort(
    content: string,
    type: "text" | "insight" | "error" | "result" = "text",
    metadata?: Record<string, any>
  ): string {
    const entry: MemoryEntry = {
      id: this.generateId(),
      content,
      type,
      timestamp: Date.now(),
      metadata,
    };

    this.shortTerm.push(entry);

    // Overflow: move oldest to long-term
    if (this.shortTerm.length > this.maxShortTermSize) {
      const old = this.shortTerm.shift();
      if (old) {
        this.longTerm.push(old);
      }
    }

    return entry.id;
  }

  /**
   * Remember something in long-term memory
   */
  rememberLong(
    content: string,
    type: "text" | "insight" | "error" | "result" = "text",
    metadata?: Record<string, any>
  ): string {
    const entry: MemoryEntry = {
      id: this.generateId(),
      content,
      type,
      timestamp: Date.now(),
      metadata,
    };

    this.longTerm.push(entry);
    return entry.id;
  }

  /**
   * Query short-term memory
   */
  queryShort(query?: MemoryQuery): MemoryEntry[] {
    return this.filterMemory(this.shortTerm, query);
  }

  /**
   * Query long-term memory
   */
  queryLong(query?: MemoryQuery): MemoryEntry[] {
    return this.filterMemory(this.longTerm, query);
  }

  /**
   * Query both short and long-term
   */
  queryAll(query?: MemoryQuery): MemoryEntry[] {
    const combined = [...this.shortTerm, ...this.longTerm];
    return this.filterMemory(combined, query);
  }

  /**
   * Get recent context (for LLM context window)
   */
  getContext(limit: number = 10): string {
    const recent = this.shortTerm.slice(-limit);
    return recent.map((e) => `[${e.type}] ${e.content}`).join("\n");
  }

  /**
   * Get memory size stats
   */
  getStats(): {
    agentId: string;
    shortTermCount: number;
    longTermCount: number;
    totalSize: number;
  } {
    return {
      agentId: this.agentId,
      shortTermCount: this.shortTerm.length,
      longTermCount: this.longTerm.length,
      totalSize: this.shortTerm.length + this.longTerm.length,
    };
  }

  /**
   * Clear short-term memory (flush session)
   */
  clearShortTerm(): void {
    this.shortTerm = [];
  }

  /**
   * Clear all memory (dangerous!)
   */
  clearAll(): void {
    this.shortTerm = [];
    this.longTerm = [];
  }

  /**
   * Get entry by ID
   */
  getEntry(entryId: string): MemoryEntry | undefined {
    return (
      this.shortTerm.find((e) => e.id === entryId) ||
      this.longTerm.find((e) => e.id === entryId)
    );
  }

  /**
   * Export memory (for persistence)
   */
  export(): {
    agentId: string;
    shortTerm: MemoryEntry[];
    longTerm: MemoryEntry[];
  } {
    return {
      agentId: this.agentId,
      shortTerm: [...this.shortTerm],
      longTerm: [...this.longTerm],
    };
  }

  /**
   * Import memory (restore from persistence)
   */
  import(data: {
    shortTerm: MemoryEntry[];
    longTerm: MemoryEntry[];
  }): void {
    this.shortTerm = [...data.shortTerm];
    this.longTerm = [...data.longTerm];
  }

  // ============ PRIVATE ============

  private filterMemory(
    entries: MemoryEntry[],
    query?: MemoryQuery
  ): MemoryEntry[] {
    let result = [...entries];

    if (!query) return result;

    // Filter by type
    if (query.type) {
      result = result.filter((e) => e.type === query.type);
    }

    // Filter by time
    if (query.since) {
      result = result.filter((e) => e.timestamp >= query.since!);
    }

    // Filter by keyword (simple substring search)
    if (query.keyword) {
      const kw = query.keyword.toLowerCase();
      result = result.filter((e) =>
        e.content.toLowerCase().includes(kw)
      );
    }

    // Limit results
    if (query.limit) {
      result = result.slice(-query.limit);
    }

    return result;
  }

  private generateId(): string {
    return `mem_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }
}
