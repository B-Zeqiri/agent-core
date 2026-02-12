import { toolManager } from "../tools/toolManager";
import { WebTool } from "../tools/web.tool";
import { FileSystemTool } from "../tools/fs.tool";
import { CodeTool } from "../tools/code.tool";

export function registerDefaultTools(): void {
  // Web
  if (!toolManager.getTool("web.fetch")) {
    toolManager.registerTool(
      new WebTool({
        name: "web.fetch",
        type: "web",
        description: "Make outbound HTTP requests",
        requiredPermissions: ["network"],
        timeout: 15000,
        rateLimit: 60,
      })
    );
  }

  // Filesystem
  if (!toolManager.getTool("fs")) {
    toolManager.registerTool(
      new FileSystemTool({
        name: "fs",
        type: "filesystem",
        description: "Read/write files inside sandbox",
        requiredPermissions: ["read", "write"],
        timeout: 15000,
        rateLimit: 120,
      })
    );
  }

  // Code
  if (!toolManager.getTool("code.analyze")) {
    toolManager.registerTool(
      new CodeTool({
        name: "code.analyze",
        type: "code",
        description: "Analyze/format/parse/lint code",
        requiredPermissions: ["read"],
        timeout: 10000,
        rateLimit: 240,
      })
    );
  }
}
