/**
 * VectorStore
 *
 * Simple vector store for semantic search.
 *
 * Optional but powerful: allows agents to search memory
 * based on semantic similarity, not just keywords.
 *
 * For now: simple implementation using basic embedding similarity.
 * In production: use OpenAI embeddings or local models.
 */

export interface Vector {
  id: string;
  text: string;
  embedding: number[];
  metadata?: Record<string, any>;
}

export class VectorStore {
  private vectors: Vector[] = [];

  /**
   * Add a vector to the store
   */
  add(id: string, text: string, embedding: number[], metadata?: Record<string, any>): void {
    this.vectors.push({
      id,
      text,
      embedding,
      metadata,
    });
  }

  /**
   * Remove a vector
   */
  remove(id: string): boolean {
    const idx = this.vectors.findIndex((v) => v.id === id);
    if (idx === -1) return false;
    this.vectors.splice(idx, 1);
    return true;
  }

  /**
   * Find similar vectors (cosine similarity)
   */
  search(embedding: number[], limit: number = 5): Vector[] {
    const scored = this.vectors.map((v) => ({
      vector: v,
      score: this.cosineSimilarity(embedding, v.embedding),
    }));

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((s) => s.vector);
  }

  /**
   * Get vector by ID
   */
  get(id: string): Vector | undefined {
    return this.vectors.find((v) => v.id === id);
  }

  /**
   * Get all vectors
   */
  getAll(): Vector[] {
    return [...this.vectors];
  }

  /**
   * Clear the store
   */
  clear(): void {
    this.vectors = [];
  }

  /**
   * Get store size
   */
  size(): number {
    return this.vectors.length;
  }

  // ============ PRIVATE ============

  /**
   * Calculate cosine similarity between two vectors
   */
  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error("Vector dimensions must match");
    }

    const dotProduct = a.reduce((sum, val, i) => sum + val * b[i], 0);
    const magnitudeA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
    const magnitudeB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));

    if (magnitudeA === 0 || magnitudeB === 0) {
      return 0;
    }

    return dotProduct / (magnitudeA * magnitudeB);
  }
}
