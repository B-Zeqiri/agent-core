/**
 * OpenAI Model Implementation
 *
 * Wrapper for OpenAI API (gpt-4, gpt-3.5-turbo, etc.)
 */

import { BaseModel, ModelConfig, GenerateOptions, GenerateResult } from "./model.interface";

export class OpenAIModel extends BaseModel {
  private client: any;

  constructor(config: ModelConfig) {
    super(config);

    if (!config.apiKey) {
      throw new Error("OpenAI model requires apiKey in config");
    }

    // Lazy load to avoid import issues if OpenAI SDK not installed
    try {
      const OpenAI = require("openai").default;
      this.client = new OpenAI({
        apiKey: config.apiKey,
        baseURL: config.baseUrl,
      });
    } catch (err) {
      throw new Error(`Failed to initialize OpenAI client: ${err}`);
    }
  }

  async generate(options: GenerateOptions): Promise<GenerateResult> {
    const startTime = Date.now();

    try {
      const response = await this.client.chat.completions.create({
        model: this.config.modelName,
        messages: options.messages,
        max_tokens: options.maxTokens || this.config.maxTokens || 1024,
        temperature: options.temperature ?? this.config.temperature ?? 0.7,
        top_p: options.topP ?? this.config.topP ?? 1,
      });

      const content = response.choices[0]?.message?.content || "";
      const tokensUsed = response.usage?.total_tokens || 0;
      const latency = Date.now() - startTime;

      this.updateStats(tokensUsed, latency, true);

      return {
        content,
        model: this.config.modelName,
        tokensUsed,
        metadata: {
          finishReason: response.choices[0]?.finish_reason,
          promptTokens: response.usage?.prompt_tokens,
          completionTokens: response.usage?.completion_tokens,
        },
      };
    } catch (err) {
      const latency = Date.now() - startTime;
      this.updateStats(0, latency, false);
      throw new Error(`OpenAI generation failed: ${err}`);
    }
  }

  async isHealthy(): Promise<boolean> {
    try {
      // Simple health check: try to list models
      await this.client.models.list();
      return true;
    } catch (err) {
      return false;
    }
  }

  getCapabilities() {
    // Different models have different capabilities
    const modelName = this.config.modelName.toLowerCase();

    if (modelName.includes("gpt-4")) {
      return {
        maxContextLength: 8192,
        supportsVision: true,
        supportsFunctionCalling: true,
        costPerMToken: 0.03, // approximate
      };
    }

    if (modelName.includes("gpt-3.5")) {
      return {
        maxContextLength: 4096,
        supportsVision: false,
        supportsFunctionCalling: true,
        costPerMToken: 0.002,
      };
    }

    return {
      maxContextLength: 4096,
      supportsVision: false,
      supportsFunctionCalling: false,
    };
  }
}
