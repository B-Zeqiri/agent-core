/**
 * MemoryManager
 *
 * Central memory controller for all agents.
 *
 * Responsibilities:
 * - Manage per-agent isolated memories
 * - Handle ACLs (access control lists)
 * - Optional vector search
 * - Persistence (TODO: Phase 2.5)
 *
 * Privacy is enforced:
 * - Agent A cannot access Agent B's memory by default
 * - Sharing must be explicit via shareMemory()
 */

import { AgentMemory, MemoryEntry, MemoryQuery } from "./agentMemory";
import { VectorStore } from "./vectorStore";

export interface MemoryACL {
  agentId: string;
  canReadFrom: Set<string>; // IDs of agents this agent can read from
  canWriteTo: Set<string>; // IDs of agents this agent can write to
}

export class MemoryManager {
  private agentMemories = new Map<string, AgentMemory>();
  private acls = new Map<string, MemoryACL>();
  private vectorStore = new VectorStore();
  private enableVectorSearch = false;

  constructor(enableVectorSearch: boolean = false) {
    this.enableVectorSearch = enableVectorSearch;
  }

  // ============ MEMORY CREATION & MANAGEMENT ============

  /**
   * Create memory for an agent
   */
  createAgentMemory(agentId: string, maxShortTermSize?: number): AgentMemory {
    if (this.agentMemories.has(agentId)) {
      throw new Error(`Memory already exists for agent ${agentId}`);
    }

    const memory = new AgentMemory(agentId, maxShortTermSize);
    this.agentMemories.set(agentId, memory);

    // Initialize ACL (can only access own memory by default)
    this.acls.set(agentId, {
      agentId,
      canReadFrom: new Set([agentId]),
      canWriteTo: new Set([agentId]),
    });

    return memory;
  }

  /**
   * Get agent's memory
   */
  getMemory(agentId: string): AgentMemory | undefined {
    return this.agentMemories.get(agentId);
  }

  /**
   * Delete agent's memory
   */
  deleteAgentMemory(agentId: string): boolean {
    return this.agentMemories.delete(agentId) && this.acls.delete(agentId);
  }

  /**
   * Check if agent has memory
   */
  hasMemory(agentId: string): boolean {
    return this.agentMemories.has(agentId);
  }

  // ============ ACL (ACCESS CONTROL) ============

  /**
   * Allow agent A to read from agent B's memory
   */
  shareMemoryRead(fromAgentId: string, toAgentId: string): void {
    const acl = this.getOrCreateACL(toAgentId);
    acl.canReadFrom.add(fromAgentId);
  }

  /**
   * Allow agent A to write to agent B's memory
   */
  shareMemoryWrite(fromAgentId: string, toAgentId: string): void {
    const acl = this.getOrCreateACL(toAgentId);
    acl.canWriteTo.add(fromAgentId);
  }

  /**
   * Revoke read access
   */
  revokeMemoryRead(fromAgentId: string, toAgentId: string): void {
    const acl = this.acls.get(toAgentId);
    if (acl) {
      acl.canReadFrom.delete(fromAgentId);
    }
  }

  /**
   * Revoke write access
   */
  revokeMemoryWrite(fromAgentId: string, toAgentId: string): void {
    const acl = this.acls.get(toAgentId);
    if (acl) {
      acl.canWriteTo.delete(fromAgentId);
    }
  }

  /**
   * Check if agent can read from another's memory
   */
  canRead(agentId: string, targetAgentId: string): boolean {
    const acl = this.acls.get(targetAgentId);
    return acl ? acl.canReadFrom.has(agentId) : false;
  }

  /**
   * Check if agent can write to another's memory
   */
  canWrite(agentId: string, targetAgentId: string): boolean {
    const acl = this.acls.get(targetAgentId);
    return acl ? acl.canWriteTo.has(agentId) : false;
  }

  /**
   * Get ACL for an agent
   */
  getACL(agentId: string): MemoryACL | undefined {
    return this.acls.get(agentId);
  }

  // ============ WRITE OPERATIONS ============

  /**
   * Write to short-term memory (with ACL check)
   */
  writeShort(
    agentId: string,
    targetAgentId: string,
    content: string,
    type: "text" | "insight" | "error" | "result" = "text",
    metadata?: Record<string, any>
  ): string {
    if (!this.canWrite(agentId, targetAgentId)) {
      throw new Error(
        `Agent ${agentId} cannot write to ${targetAgentId}'s memory`
      );
    }

    const memory = this.agentMemories.get(targetAgentId);
    if (!memory) {
      throw new Error(`No memory found for agent ${targetAgentId}`);
    }

    const entryId = memory.rememberShort(content, type, metadata);

    // Optional: index in vector store
    if (this.enableVectorSearch) {
      const embedding = this.simpleEmbedding(content);
      this.vectorStore.add(entryId, content, embedding, {
        agentId: targetAgentId,
        type,
      });
    }

    return entryId;
  }

  /**
   * Write to long-term memory (with ACL check)
   */
  writeLong(
    agentId: string,
    targetAgentId: string,
    content: string,
    type: "text" | "insight" | "error" | "result" = "text",
    metadata?: Record<string, any>
  ): string {
    if (!this.canWrite(agentId, targetAgentId)) {
      throw new Error(
        `Agent ${agentId} cannot write to ${targetAgentId}'s memory`
      );
    }

    const memory = this.agentMemories.get(targetAgentId);
    if (!memory) {
      throw new Error(`No memory found for agent ${targetAgentId}`);
    }

    const entryId = memory.rememberLong(content, type, metadata);

    // Optional: index in vector store
    if (this.enableVectorSearch) {
      const embedding = this.simpleEmbedding(content);
      this.vectorStore.add(entryId, content, embedding, {
        agentId: targetAgentId,
        type,
      });
    }

    return entryId;
  }

  // ============ READ OPERATIONS ============

  /**
   * Query memory (with ACL check)
   */
  query(
    agentId: string,
    targetAgentId: string,
    query?: MemoryQuery
  ): MemoryEntry[] {
    if (!this.canRead(agentId, targetAgentId)) {
      throw new Error(
        `Agent ${agentId} cannot read from ${targetAgentId}'s memory`
      );
    }

    const memory = this.agentMemories.get(targetAgentId);
    if (!memory) {
      throw new Error(`No memory found for agent ${targetAgentId}`);
    }

    return memory.queryAll(query);
  }

  /**
   * Get context (for LLM) with ACL check
   */
  getContext(agentId: string, targetAgentId: string, limit?: number): string {
    if (!this.canRead(agentId, targetAgentId)) {
      return "";
    }

    const memory = this.agentMemories.get(targetAgentId);
    if (!memory) {
      return "";
    }

    return memory.getContext(limit);
  }

  /**
   * Semantic search across all accessible memories
   */
  semanticSearch(agentId: string, query: string, limit: number = 5): MemoryEntry[] {
    if (!this.enableVectorSearch) {
      throw new Error("Vector search is disabled");
    }

    const queryEmbedding = this.simpleEmbedding(query);
    const results = this.vectorStore.search(queryEmbedding, limit);

    // Filter by ACL: only return memories the agent can read
    return results
      .filter((vec) => {
        const metadata = vec.metadata as Record<string, any>;
        return this.canRead(agentId, metadata.agentId);
      })
      .map((vec) => {
        const memory = this.agentMemories.get(
          (vec.metadata as Record<string, any>).agentId
        );
        if (!memory) return null;

        const entries = memory.queryAll();
        return entries.find((e) => e.id === vec.id);
      })
      .filter((e): e is MemoryEntry => e !== null);
  }

  // ============ STATISTICS ============

  /**
   * Get stats for all agents
   */
  getStats(): Array<{
    agentId: string;
    shortTermCount: number;
    longTermCount: number;
    totalSize: number;
    readable: string[];
    writable: string[];
  }> {
    return Array.from(this.agentMemories.entries()).map(([agentId, memory]) => {
      const stats = memory.getStats();
      const acl = this.acls.get(agentId);

      return {
        agentId: stats.agentId,
        shortTermCount: stats.shortTermCount,
        longTermCount: stats.longTermCount,
        totalSize: stats.totalSize,
        readable: acl ? Array.from(acl.canReadFrom) : [],
        writable: acl ? Array.from(acl.canWriteTo) : [],
      };
    });
  }

  // ============ UTILITY ============

  /**
   * Clear all memory (dangerous!)
   */
  clearAll(): void {
    this.agentMemories.clear();
    this.acls.clear();
    this.vectorStore.clear();
  }

  // ============ PRIVATE ============

  private getOrCreateACL(agentId: string): MemoryACL {
    if (!this.acls.has(agentId)) {
      this.acls.set(agentId, {
        agentId,
        canReadFrom: new Set([agentId]),
        canWriteTo: new Set([agentId]),
      });
    }
    return this.acls.get(agentId)!;
  }

  /**
   * Simple embedding (TODO: replace with real embeddings in Phase 3)
   * For now: hash of word frequencies
   */
  private simpleEmbedding(text: string): number[] {
    const words = text.toLowerCase().split(/\W+/);
    const freq = new Map<string, number>();

    words.forEach((word) => {
      freq.set(word, (freq.get(word) || 0) + 1);
    });

    // Create 100-dimensional vector
    const embedding = new Array(100).fill(0);
    let i = 0;

    for (const [word, count] of freq.entries()) {
      const idx = this.hashToIndex(word, 100);
      embedding[idx] = count;
      i++;
    }

    // Normalize
    const magnitude = Math.sqrt(
      embedding.reduce((sum, val) => sum + val * val, 0)
    );
    if (magnitude > 0) {
      return embedding.map((val) => val / magnitude);
    }

    return embedding;
  }

  private hashToIndex(str: string, size: number): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash = hash & hash;
    }
    return Math.abs(hash) % size;
  }
}

export const memoryManager = new MemoryManager();
