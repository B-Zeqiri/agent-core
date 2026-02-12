/**
 * Filesystem Tool
 *
 * Read, write, and manage files.
 * Respects the sandbox — configurable root directory.
 */

import * as fs from "fs/promises";
import * as path from "path";
import { BaseTool, ToolConfig, ToolPermission } from "./tool.interface";

export class FileSystemTool extends BaseTool {
  private sandboxRoot: string;

  constructor(config: ToolConfig, sandboxRoot: string = process.cwd()) {
    super(config);
    this.sandboxRoot = sandboxRoot;
  }

  /**
   * Execute filesystem operations
   */
  async execute(args: Record<string, any>): Promise<any> {
    const startTime = Date.now();

    try {
      const validation = this.validate(args);
      if (!validation.valid) {
        throw new Error(validation.errors?.join(", ") || "Invalid arguments");
      }

      const operation = args.operation;
      const filePath = this.resolvePath(args.path);

      let result: any;

      switch (operation) {
        case "read":
          result = await this.read(filePath);
          break;
        case "write":
          result = await this.write(filePath, args.content);
          break;
        case "append":
          result = await this.append(filePath, args.content);
          break;
        case "delete":
          result = await this.delete(filePath);
          break;
        case "exists":
          result = await this.exists(filePath);
          break;
        case "list":
          result = await this.list(filePath);
          break;
        case "mkdir":
          result = await this.mkdir(filePath);
          break;
        default:
          throw new Error(`Unknown operation: ${operation}`);
      }

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

    if (!args.operation) {
      errors.push("operation is required");
    }

    if (!args.path) {
      errors.push("path is required");
    }

    if (args.operation === "write" && !args.content) {
      errors.push("content is required for write operation");
    }

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined,
    };
  }

  async isHealthy(): Promise<boolean> {
    try {
      await fs.access(this.sandboxRoot);
      return true;
    } catch (err) {
      return false;
    }
  }

  // ============ PRIVATE ============

  private resolvePath(filePath: string): string {
    const resolved = path.resolve(this.sandboxRoot, filePath);

    // Security: prevent directory traversal
    const relative = path.relative(this.sandboxRoot, resolved);
    if (relative.startsWith("..")) {
      throw new Error("Path traversal not allowed");
    }

    return resolved;
  }

  private async read(filePath: string): Promise<string> {
    return await fs.readFile(filePath, "utf-8");
  }

  private async write(filePath: string, content: string): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, content, "utf-8");
  }

  private async append(filePath: string, content: string): Promise<void> {
    await fs.appendFile(filePath, content, "utf-8");
  }

  private async delete(filePath: string): Promise<void> {
    try {
      const stat = await fs.stat(filePath);
      if (stat.isDirectory()) {
        await fs.rm(filePath, { recursive: true });
      } else {
        await fs.unlink(filePath);
      }
    } catch (err: any) {
      if (err.code !== "ENOENT") {
        throw err;
      }
    }
  }

  private async exists(filePath: string): Promise<boolean> {
    try {
      await fs.access(filePath);
      return true;
    } catch (err) {
      return false;
    }
  }

  private async list(dirPath: string): Promise<Array<{ name: string; type: string }>> {
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    return entries.map((entry) => ({
      name: entry.name,
      type: entry.isDirectory() ? "directory" : "file",
    }));
  }

  private async mkdir(dirPath: string): Promise<void> {
    await fs.mkdir(dirPath, { recursive: true });
  }
}
