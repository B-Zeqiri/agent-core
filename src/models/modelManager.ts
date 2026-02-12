/**
 * ModelManager
 *
 * Central controller for all LLM models.
 *
 * Responsibilities:
 * - Manage multiple models
 * - Select best model for task
 * - Handle fallbacks
 * - Load balance
 * - Track usage and costs
 */

import { BaseModel, ModelConfig, GenerateOptions, GenerateResult, ModelStats } from "./model.interface";
import { OpenAIModel } from "./openai.model";
import { GPT4AllModel } from "./gpt4all.model";
import { OllamaModel } from "./ollama.model";

export interface ModelRoute {
  name: string;
  condition: (agentId: string, taskType: string) => boolean;
  fallbacks: string[];
}

export class ModelManager {
  private models = new Map<string, BaseModel>();
  private defaultModel: string = "";
  private routes: ModelRoute[] = [];

  /**
   * Register a model (can be instance or config)
   */
  registerModel(configOrModel: ModelConfig | BaseModel): BaseModel {
    let model: BaseModel;

    if (configOrModel instanceof BaseModel) {
      model = configOrModel;
    } else {
      const config = configOrModel;
      switch (config.type) {
        case "openai":
          model = new OpenAIModel(config);
          break;
        case "local":
          model = new GPT4AllModel(config);
          break;
        case "ollama":
          model = new OllamaModel(config);
          break;
        default:
          throw new Error(`Unknown model type: ${config.type}`);
      }
    }

    const name = model.getConfig().name;
    this.models.set(name, model);

    // Set first model as default
    if (!this.defaultModel) {
      this.defaultModel = name;
    }

    return model;
  }

  /**
   * Get model by name
   */
  getModel(name: string): BaseModel | undefined {
    return this.models.get(name);
  }

  /**
   * Get all registered models
   */
  getModels(): BaseModel[] {
    return Array.from(this.models.values());
  }

  /**
   * Set default model
   */
  setDefault(name: string): void {
    if (!this.models.has(name)) {
      throw new Error(`Model ${name} not registered`);
    }
    this.defaultModel = name;
  }

  /**
   * Get current default model
   */
  getDefault(): BaseModel {
    const model = this.models.get(this.defaultModel);
    if (!model) {
      throw new Error("No default model set");
    }
    return model;
  }

  /**
   * Add a routing rule
   * Routes agent/task combinations to specific models
   */
  addRoute(route: ModelRoute): void {
    this.routes.push(route);
  }

  /**
   * Get best model for a task (with fallbacks)
   */
  selectModel(
    agentId: string,
    taskType: string,
    preferLocal: boolean = false
  ): BaseModel {
    // Check routing rules
    for (const route of this.routes) {
      if (route.condition(agentId, taskType)) {
        const primary = this.models.get(route.name);
        if (primary) {
          return primary;
        }

        // Try fallbacks
        for (const fallback of route.fallbacks) {
          const model = this.models.get(fallback);
          if (model) {
            return model;
          }
        }
      }
    }

    // Local-first preference
    if (preferLocal) {
      for (const [, model] of this.models) {
        const config = model.getConfig();
        if (config.type === "local" || config.type === "ollama") {
          return model;
        }
      }
    }

    // Fall back to default
    return this.getDefault();
  }

  /**
   * Generate text through the best available model
   */
  async generate(
    options: GenerateOptions,
    agentId: string = "default",
    taskType: string = "general",
    preferLocal: boolean = false
  ): Promise<GenerateResult> {
    const model = this.selectModel(agentId, taskType, preferLocal);
    return model.generate(options);
  }

  /**
   * Generate with automatic fallback
   */
  async generateWithFallback(
    options: GenerateOptions,
    agentId: string = "default",
    taskType: string = "general"
  ): Promise<GenerateResult> {
    const candidates = Array.from(this.models.values()).sort((a, b) => {
      // Sort by health, recent usage, then error rate
      return b.getStats().totalRequests - a.getStats().totalRequests;
    });

    let lastError: Error | null = null;

    for (const model of candidates) {
      try {
        const healthy = await model.isHealthy();
        if (!healthy) {
          continue;
        }

        return await model.generate(options);
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        continue;
      }
    }

    throw lastError || new Error("No models available");
  }

  /**
   * Health check all models
   */
  async healthCheck(): Promise<Record<string, boolean>> {
    const results: Record<string, boolean> = {};

    for (const [name, model] of this.models) {
      try {
        results[name] = await model.isHealthy();
      } catch (err) {
        results[name] = false;
      }
    }

    return results;
  }

  /**
   * Get statistics for all models
   */
  getStats(): Record<string, ModelStats> {
    const stats: Record<string, ModelStats> = {};

    for (const [name, model] of this.models) {
      stats[name] = model.getStats();
    }

    return stats;
  }

  /**
   * Get capabilities for all models
   */
  getCapabilities(): Record<string, any> {
    const caps: Record<string, any> = {};

    for (const [name, model] of this.models) {
      caps[name] = {
        config: model.getConfig(),
        capabilities: model.getCapabilities(),
        stats: model.getStats(),
      };
    }

    return caps;
  }

  /**
   * Remove a model
   */
  removeModel(name: string): boolean {
    if (this.defaultModel === name) {
      const firstKey = this.models.keys().next().value;
      if (firstKey) {
        this.defaultModel = firstKey;
      }
    }

    return this.models.delete(name);
  }

  /**
   * Clear all models
   */
  clear(): void {
    this.models.clear();
    this.routes = [];
    this.defaultModel = "";
  }
}

export const modelManager = new ModelManager();
