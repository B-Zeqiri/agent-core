/**
 * Result Store
 * 
 * Persistent storage for task results with expiration and caching
 */

export interface StoredResult {
  taskId: string;
  agentId: string;
  result: string;
  modelUsed: string;
  executionTimeMs: number;
  tokensUsed?: number;
  storedAt: number;
  expiresAt: number;
  metadata?: Record<string, any>;
}

export interface ResultStoreConfig {
  expirationHours?: number;
  maxResults?: number;
}

export class ResultStore {
  private results: Map<string, StoredResult> = new Map();
  private expirationHours: number;
  private maxResults: number;

  constructor(config: ResultStoreConfig = {}) {
    this.expirationHours = config.expirationHours || 24;
    this.maxResults = config.maxResults || 1000;

    // Cleanup expired results every hour
    setInterval(() => this.cleanup(), 60 * 60 * 1000);
  }

  /**
   * Store a result with automatic expiration
   */
  store(taskId: string, result: any): StoredResult {
    const now = Date.now();
    const expiresAt = now + this.expirationHours * 60 * 60 * 1000;

    const storedResult: StoredResult = {
      taskId,
      agentId: result.agentId || 'unknown',
      result: result.content || result.result || String(result),
      modelUsed: result.model || 'unknown',
      executionTimeMs: result.executionTimeMs || 0,
      tokensUsed: result.tokensUsed,
      storedAt: now,
      expiresAt,
      metadata: result.metadata,
    };

    this.results.set(taskId, storedResult);

    // Enforce max results limit
    if (this.results.size > this.maxResults) {
      const oldestKey = Array.from(this.results.entries()).sort(
        (a, b) => a[1].storedAt - b[1].storedAt
      )[0][0];
      this.results.delete(oldestKey);
    }

    return storedResult;
  }

  /**
   * Retrieve a result by task ID
   */
  retrieve(taskId: string): StoredResult | null {
    const result = this.results.get(taskId);
    if (!result) return null;

    // Check expiration
    if (Date.now() > result.expiresAt) {
      this.results.delete(taskId);
      return null;
    }

    return result;
  }

  /**
   * Check if result exists and is still valid
   */
  has(taskId: string): boolean {
    const result = this.results.get(taskId);
    if (!result) return false;

    // Check expiration
    if (Date.now() > result.expiresAt) {
      this.results.delete(taskId);
      return false;
    }

    return true;
  }

  /**
   * Get all results for an agent
   */
  getByAgent(agentId: string): StoredResult[] {
    return Array.from(this.results.values()).filter(
      (result) =>
        result.agentId === agentId && Date.now() <= result.expiresAt
    );
  }

  /**
   * Get all results within a time range
   */
  getByTimeRange(startMs: number, endMs: number): StoredResult[] {
    return Array.from(this.results.values()).filter(
      (result) =>
        result.storedAt >= startMs &&
        result.storedAt <= endMs &&
        Date.now() <= result.expiresAt
    );
  }

  /**
   * Clear a specific result
   */
  clear(taskId: string): boolean {
    return this.results.delete(taskId);
  }

  /**
   * Clear all results
   */
  clearAll(): void {
    this.results.clear();
  }

  /**
   * Get store statistics
   */
  getStats() {
    const now = Date.now();
    const validResults = Array.from(this.results.values()).filter(
      (r) => now <= r.expiresAt
    );

    const executionTimes = validResults.map((r) => r.executionTimeMs);
    const avgExecutionTime =
      executionTimes.length > 0
        ? executionTimes.reduce((a, b) => a + b, 0) / executionTimes.length
        : 0;

    return {
      totalResults: validResults.length,
      avgExecutionTimeMs: Math.round(avgExecutionTime),
      oldestResultAge:
        validResults.length > 0
          ? now - Math.min(...validResults.map((r) => r.storedAt))
          : 0,
      newestResultAge:
        validResults.length > 0
          ? now - Math.max(...validResults.map((r) => r.storedAt))
          : 0,
    };
  }

  /**
   * Remove expired results
   */
  private cleanup(): void {
    const now = Date.now();
    const keysToDelete: string[] = [];

    this.results.forEach((result, key) => {
      if (now > result.expiresAt) {
        keysToDelete.push(key);
      }
    });

    keysToDelete.forEach((key) => this.results.delete(key));
  }
}

// Export singleton
export const resultStore = new ResultStore({
  expirationHours: 24,
  maxResults: 1000,
});
