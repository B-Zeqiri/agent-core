import * as fs from "fs";
import * as path from "path";
import { LoadedPluginAgent } from "./types";

function isAgentDefinition(obj: any): boolean {
  return (
    !!obj &&
    typeof obj === "object" &&
    !!obj.meta &&
    typeof obj.meta === "object" &&
    typeof obj.meta.name === "string" &&
    typeof obj.meta.version === "string" &&
    Array.isArray(obj.meta.capabilities) &&
    typeof obj.run === "function"
  );
}

export function discoverPluginEntryPaths(pluginsRoot: string): string[] {
  if (!fs.existsSync(pluginsRoot)) return [];

  const entries = fs
    .readdirSync(pluginsRoot, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => path.join(pluginsRoot, d.name, "agent.ts"))
    .filter((p) => fs.existsSync(p));

  return entries;
}

export function loadPluginAgentFromPath(entryPath: string): LoadedPluginAgent {
  try {
    // Bust require cache to support hot-reload in dev.
    const resolved = require.resolve(entryPath);
    delete require.cache[resolved];
  } catch {
    // ignore (resolve may fail depending on ts-node hooks)
  }

  // ts-node hooks allow requiring TS directly in dev/test.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require(entryPath);

  const definition = mod?.default ?? mod?.agent ?? mod;
  if (!isAgentDefinition(definition)) {
    throw new Error(
      `Plugin at ${entryPath} did not export a valid AgentDefinition (expected default export of defineAgent(...))`
    );
  }

  return { definition, entryPath };
}

export function loadAllPluginAgents(opts?: {
  pluginsRoot?: string;
}): LoadedPluginAgent[] {
  const pluginsRoot =
    opts?.pluginsRoot ?? path.join(process.cwd(), "plugins");

  const entryPaths = discoverPluginEntryPaths(pluginsRoot);
  return entryPaths.map(loadPluginAgentFromPath);
}
