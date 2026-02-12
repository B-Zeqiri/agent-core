/**
 * Ollama Model Implementation
 *
 * Wrapper for Ollama local models
 * Runs on localhost (e.g., http://localhost:11434)
 */

import {
  BaseModel,
  ModelConfig,
  GenerateOptions,
  GenerateResult,
} from "./model.interface";

export class OllamaModel extends BaseModel {
  constructor(config: ModelConfig) {
    super(config);

    if (!config.baseUrl) {
      throw new Error(
        "Ollama model requires baseUrl (e.g., http://localhost:11434)"
      );
    }
  }

  async generate(options: GenerateOptions): Promise<GenerateResult> {
    const startTime = Date.now();

    try {
      const response = await fetch(`${this.config.baseUrl}/api/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: this.config.modelName,
          messages: options.messages,
          stream: false,
          options: {
            temperature: options.temperature ?? this.config.temperature ?? 0.7,
            top_p: options.topP ?? this.config.topP ?? 1,
            num_predict:
              options.maxTokens || this.config.maxTokens || 512,
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      const content = data.message?.content || "";
      
      // Ollama doesn't return token counts, estimate from content
      const tokensUsed = Math.ceil(content.split(/\s+/).length * 1.3);
      const latency = Date.now() - startTime;

      this.updateStats(tokensUsed, latency, true);

      return {
        content,
        model: this.config.modelName,
        tokensUsed,
        metadata: {
          totalDuration: data.total_duration,
          loadDuration: data.load_duration,
          promptEvalCount: data.prompt_eval_count,
          evalCount: data.eval_count,
        },
      };
    } catch (err) {
      const latency = Date.now() - startTime;
      this.updateStats(0, latency, false);
      throw new Error(`Ollama generation failed: ${err}`);
    }
  }

  async isHealthy(): Promise<boolean> {
    try {
      const response = await fetch(`${this.config.baseUrl}/api/tags`, {
        method: "GET",
      });
      return response.ok;
    } catch (err) {
      return false;
    }
  }

  getCapabilities() {
    const modelName = this.config.modelName.toLowerCase();

    // Ollama models vary widely, make educated guesses
    if (modelName.includes("mistral")) {
      return {
        maxContextLength: 8192,
        supportsVision: false,
        supportsFunctionCalling: false,
      };
    }

    if (modelName.includes("neural")) {
      return {
        maxContextLength: 4096,
        supportsVision: false,
        supportsFunctionCalling: false,
      };
    }

    if (modelName.includes("llama")) {
      return {
        maxContextLength: 4096,
        supportsVision: false,
        supportsFunctionCalling: false,
      };
    }

    // Default for unknown models
    return {
      maxContextLength: 2048,
      supportsVision: false,
      supportsFunctionCalling: false,
    };
  }
}
