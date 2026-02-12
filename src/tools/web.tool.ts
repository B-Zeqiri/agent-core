/**
 * Web Tool
 *
 * Make HTTP requests to external APIs.
 * Includes request validation and rate limiting.
 */

import { BaseTool, ToolConfig } from "./tool.interface";

export class WebTool extends BaseTool {
  private allowedDomains: string[] = [];

  constructor(config: ToolConfig, allowedDomains?: string[]) {
    super(config);
    this.allowedDomains = allowedDomains || [];
  }

  /**
   * Execute web requests
   */
  async execute(args: Record<string, any>): Promise<any> {
    const startTime = Date.now();

    try {
      const validation = this.validate(args);
      if (!validation.valid) {
        throw new Error(validation.errors?.join(", ") || "Invalid arguments");
      }

      const result = await this.request(args);

      const executionTime = Date.now() - startTime;
      this.recordCall(true, executionTime);

      return result;
    } catch (err) {
      const executionTime = Date.now() - startTime;
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.recordCall(false, executionTime, errorMsg);
      throw err;
    }
  }

  validate(args: Record<string, any>) {
    const errors: string[] = [];

    if (!args.url) {
      errors.push("url is required");
    }

    if (args.url && !this.isValidUrl(args.url)) {
      errors.push("Invalid URL format");
    }

    if (args.method && !["GET", "POST", "PUT", "DELETE", "PATCH"].includes(args.method)) {
      errors.push("Invalid HTTP method");
    }

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  async isHealthy(): Promise<boolean> {
    // Web tool is healthy if we can make requests
    // Simple check: verify we're online
    try {
      await fetch("https://www.google.com", { method: "HEAD" });
      return true;
    } catch (err) {
      return false;
    }
  }

  // ============ PRIVATE ============

  private async request(args: Record<string, any>): Promise<any> {
    const url = args.url;
    const method = args.method || "GET";
    const headers = args.headers || {};
    const body = args.body;

    // Validate domain if allowlist is set
    if (this.allowedDomains.length > 0) {
      const domain = new URL(url).hostname;
      const allowed = this.allowedDomains.some(
        (d) => domain === d || domain.endsWith(`.${d}`)
      );
      if (!allowed) {
        throw new Error(
          `Domain ${domain} not in allowlist. Allowed: ${this.allowedDomains.join(", ")}`
        );
      }
    }

    const response = await this.executeWithTimeout(
      fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...headers,
        },
        body: body ? JSON.stringify(body) : undefined,
      })
    );

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const contentType = response.headers.get("content-type");

    if (contentType?.includes("application/json")) {
      return await response.json();
    }

    return await response.text();
  }

  private isValidUrl(url: string): boolean {
    try {
      new URL(url);
      return true;
    } catch (err) {
      return false;
    }
  }
}
