/**
 * Tool Interface
 *
 * Abstract interface for all agent tools.
 *
 * Tools are controlled capabilities. Agents can only use tools
 * they have explicit permission for.
 *
 * Think: syscalls for agents. Kernel enforces permissions.
 */

export type ToolType =
  | "filesystem"
  | "web"
  | "code"
  | "shell"
  | "compute"
  | "custom";

export type ToolPermission =
  | "read"
  | "write"
  | "execute"
  | "network"
  | "system";

export interface ToolConfig {
  name: string;
  type: ToolType;
  description: string;
  requiredPermissions: ToolPermission[];
  timeout?: number;
  rateLimit?: number; // calls per minute
  metadata?: Record<string, any>;
}

export interface ToolCall {
  toolName: string;
  args: Record<string, any>;
  timeout?: number;
}

export interface ToolResult {
  success: boolean;
  data?: any;
  error?: string;
  executionTime: number;
  metadata?: Record<string, any>;
}

export interface ToolStats {
  name: string;
  type: ToolType;
  totalCalls: number;
  successfulCalls: number;
  failedCalls: number;
  avgExecutionTime: number;
  totalTokensUsed?: number;
  lastUsed: number;
  errors: Array<{ timestamp: number; error: string }>;
}

/**
 * Base Tool Interface
 *
 * All tools must implement this interface.
 */
export abstract class BaseTool {
  protected config: ToolConfig;
  protected stats: ToolStats;
  protected lastCallTime = 0;
  protected callCountWindow: number[] = []; // For rate limiting

  constructor(config: ToolConfig) {
    this.config = config;
    this.stats = {
      name: config.name,
      type: config.type,
      totalCalls: 0,
      successfulCalls: 0,
      failedCalls: 0,
      avgExecutionTime: 0,
      lastUsed: 0,
      errors: [],
    };
  }

  /**
   * Execute the tool
   */
  abstract execute(args: Record<string, any>): Promise<any>;

  /**
   * Validate arguments
   */
  abstract validate(args: Record<string, any>): {
    valid: boolean;
    errors?: string[];
  };

  /**
   * Check if tool is available/healthy
   */
  abstract isHealthy(): Promise<boolean>;

  /**
   * Get tool configuration
   */
  getConfig(): ToolConfig {
    return { ...this.config };
  }

  /**
   * Get tool statistics
   */
  getStats(): ToolStats {
    return {
      ...this.stats,
      errors: [...this.stats.errors],
    };
  }

  /**
   * Check rate limit
   */
  checkRateLimit(): boolean {
    if (!this.config.rateLimit) {
      return true;
    }

    const now = Date.now();
    const windowStart = now - 60000; // 1 minute window

    // Remove old calls outside window
    this.callCountWindow = this.callCountWindow.filter(
      (timestamp) => timestamp > windowStart
    );

    if (this.callCountWindow.length >= this.config.rateLimit) {
      return false;
    }

    return true;
  }

  /**
   * Record a call (for rate limiting and stats)
   */
  protected recordCall(success: boolean, executionTime: number, error?: string): void {
    this.stats.totalCalls++;
    this.stats.lastUsed = Date.now();
    this.callCountWindow.push(Date.now());

    if (success) {
      this.stats.successfulCalls++;
    } else {
      this.stats.failedCalls++;
      if (error) {
        this.stats.errors.push({
          timestamp: Date.now(),
          error,
        });

        // Keep only last 100 errors
        if (this.stats.errors.length > 100) {
          this.stats.errors.shift();
        }
      }
    }

    // Update rolling average execution time
    const prevTotal = this.stats.avgExecutionTime * (this.stats.totalCalls - 1);
    this.stats.avgExecutionTime = (prevTotal + executionTime) / this.stats.totalCalls;
  }

  /**
   * Helper: execute with timeout
   */
  protected async executeWithTimeout<T>(
    promise: Promise<T>,
    timeoutMs?: number
  ): Promise<T> {
    const timeout = timeoutMs || this.config.timeout || 30000;

    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(
          () => reject(new Error(`Tool execution timeout after ${timeout}ms`)),
          timeout
        )
      ),
    ]);
  }
}
