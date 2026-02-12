/**
 * Model Interface
 *
 * Abstract interface for all LLM models.
 *
 * This is the abstraction layer — agents and kernel
 * never call OpenAI or GPT4All directly.
 *
 * Think: GPU driver for LLMs. Swap models like drivers.
 */

export type ModelType = "local" | "openai" | "ollama" | "custom";

export interface ModelConfig {
  name: string;
  type: ModelType;
  apiKey?: string;
  baseUrl?: string;
  modelName: string;
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  metadata?: Record<string, any>;
}

export interface Message {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface GenerateOptions {
  messages: Message[];
  maxTokens?: number;
  temperature?: number;
  topP?: number;
  stream?: boolean;
}

export interface GenerateResult {
  content: string;
  model: string;
  tokensUsed?: number;
  cached?: boolean;
  metadata?: Record<string, any>;
}

export interface ModelStats {
  name: string;
  type: ModelType;
  totalRequests: number;
  totalTokens: number;
  avgLatency: number;
  lastUsed: number;
  errors: number;
}

/**
 * Base Model Interface
 *
 * All models must implement this interface.
 */
export abstract class BaseModel {
  protected config: ModelConfig;
  protected stats: ModelStats;

  constructor(config: ModelConfig) {
    this.config = config;
    this.stats = {
      name: config.name,
      type: config.type,
      totalRequests: 0,
      totalTokens: 0,
      avgLatency: 0,
      lastUsed: 0,
      errors: 0,
    };
  }

  /**
   * Generate text completion
   */
  abstract generate(options: GenerateOptions): Promise<GenerateResult>;

  /**
   * Check if model is available/healthy
   */
  abstract isHealthy(): Promise<boolean>;

  /**
   * Get model capabilities
   */
  abstract getCapabilities(): {
    maxContextLength: number;
    supportsVision: boolean;
    supportsFunctionCalling: boolean;
    costPerMToken?: number;
  };

  /**
   * Get model statistics
   */
  getStats(): ModelStats {
    return { ...this.stats };
  }

  /**
   * Get configuration
   */
  getConfig(): ModelConfig {
    return { ...this.config };
  }

  /**
   * Update statistics (called after each request)
   */
  protected updateStats(tokensUsed: number, latency: number, success: boolean): void {
    this.stats.totalRequests++;
    this.stats.totalTokens += tokensUsed;
    this.stats.lastUsed = Date.now();

    if (!success) {
      this.stats.errors++;
    }

    // Update rolling average latency
    const prevTotal = this.stats.avgLatency * (this.stats.totalRequests - 1);
    this.stats.avgLatency = (prevTotal + latency) / this.stats.totalRequests;
  }
}
