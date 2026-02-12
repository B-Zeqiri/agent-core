import { Agent } from "./types";

/**
 * AgentRegistry
 * 
 * Manages agent discovery, loading, and metadata.
 * Separates agent lifecycle from kernel execution.
 */
export class AgentRegistry {
  private agents = new Map<string, Agent>();
  private tags = new Map<string, Set<string>>(); // tag -> agentIds

  /**
   * Register an agent
   */
  register(agent: Agent): void {
    if (this.agents.has(agent.id)) {
      throw new Error(`Agent ${agent.id} already registered`);
    }

    this.agents.set(agent.id, {
      ...agent,
      state: "uninitialized",
    });

    // Index tags
    if (agent.tags) {
      agent.tags.forEach((tag) => {
        if (!this.tags.has(tag)) {
          this.tags.set(tag, new Set());
        }
        this.tags.get(tag)!.add(agent.id);
      });
    }
  }

  /**
   * Unregister an agent
   */
  unregister(agentId: string): boolean {
    const agent = this.agents.get(agentId);
    if (!agent) return false;

    // Remove from tags
    if (agent.tags) {
      agent.tags.forEach((tag) => {
        this.tags.get(tag)?.delete(agentId);
        if (this.tags.get(tag)?.size === 0) {
          this.tags.delete(tag);
        }
      });
    }

    this.agents.delete(agentId);
    return true;
  }

  /**
   * Get agent by ID
   */
  get(agentId: string): Agent | undefined {
    return this.agents.get(agentId);
  }

  /**
   * Get all agents
   */
  getAll(): Agent[] {
    return Array.from(this.agents.values());
  }

  /**
   * Get agents by tag
   */
  getByTag(tag: string): Agent[] {
    const agentIds = this.tags.get(tag) || new Set();
    return Array.from(agentIds)
      .map((id) => this.agents.get(id)!)
      .filter(Boolean);
  }

  /**
   * List all available tags
   */
  getTags(): string[] {
    return Array.from(this.tags.keys());
  }

  /**
   * Check if agent exists
   */
  exists(agentId: string): boolean {
    return this.agents.has(agentId);
  }

  /**
   * Get count of registered agents
   */
  count(): number {
    return this.agents.size;
  }

  /**
   * Clear all agents (for testing)
   */
  clear(): void {
    this.agents.clear();
    this.tags.clear();
  }
}

export const defaultRegistry = new AgentRegistry();
