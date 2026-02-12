import { Kernel } from "../kernel/kernel";
import { AgentRegistry } from "../kernel/registry";
import { Orchestrator } from "../orchestration/orchestrator";
import { KernelScheduler } from "../scheduler/kernelScheduler";
import { registerDefaultTools } from "./defaultTools";
import { abortPluginTask } from "./cancellation";
import { reloadAllPluginAgents } from "./pluginReloader";
import fs from 'fs';
import path from 'path';

function ensureTestPlugins() {
  const pluginsRoot = path.join(process.cwd(), 'plugins');
  fs.mkdirSync(pluginsRoot, { recursive: true });

  const helloDir = path.join(pluginsRoot, 'hello-world');
  const slowDir = path.join(pluginsRoot, 'slow-cancel');
  fs.mkdirSync(helloDir, { recursive: true });
  fs.mkdirSync(slowDir, { recursive: true });

  const helloAgentTs = `import { defineAgent } from "@agentos/sdk";

export default defineAgent({
  name: "hello-world",
  version: "1.0.0",
  capabilities: ["text"],
  permissions: { tools: [], memory: [] },
  async run(task) {
    return { type: "text", content: "hello: " + String(task.input ?? "") };
  },
});
`;

  const slowAgentTs = `import { defineAgent } from "@agentos/sdk";

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new Error("aborted"));
    const t = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new Error("aborted"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export default defineAgent({
  name: "slow-cancel",
  version: "1.0.0",
  capabilities: ["text"],
  permissions: { tools: [], memory: [] },
  async run(_task, ctx) {
    await sleep(10000, ctx.signal);
    return { type: "text", content: "finished" };
  },
});
`;

  fs.writeFileSync(path.join(helloDir, 'agent.ts'), helloAgentTs, 'utf-8');
  fs.writeFileSync(path.join(slowDir, 'agent.ts'), slowAgentTs, 'utf-8');

  return {
    cleanup() {
      try {
        fs.rmSync(helloDir, { recursive: true, force: true });
      } catch {}
      try {
        fs.rmSync(slowDir, { recursive: true, force: true });
      } catch {}
    },
  };
}

async function main() {
  registerDefaultTools();

  const testPlugins = ensureTestPlugins();

  const registry = new AgentRegistry();
  const kernel = new Kernel(registry);
  const orchestrator = new Orchestrator({ maxConcurrentTasks: 10 });
  const scheduler = new KernelScheduler();

  // Hot-reload path: should be safe to call repeatedly and should not duplicate agents.
  const uiAgents: Array<{ id: string; name: string; status: string; lastUpdated: number }> = [];
  const first = reloadAllPluginAgents({
    kernel,
    orchestrator,
    scheduler,
    uiAgents,
    services: { env: { model: "local", mode: "dev" }, timeoutMs: 15000 },
  });
  if (first.loaded.length === 0) {
    throw new Error("Expected reloadAllPluginAgents() to load at least one plugin");
  }

  const second = reloadAllPluginAgents({
    kernel,
    orchestrator,
    scheduler,
    uiAgents,
    services: { env: { model: "local", mode: "dev" }, timeoutMs: 15000 },
  });
  if (uiAgents.length !== new Set(uiAgents.map((a) => a.id)).size) {
    throw new Error("Expected uiAgents to have unique ids after repeated reload");
  }
  console.log("✓ Plugin hot-reload (idempotent) verified");

  // Kernel should now have plugin agents registered.
  if (!kernel.getAgent("plugin:hello-world")) {
    throw new Error("Expected plugin:hello-world to be registered after reload");
  }
  if (!kernel.getAgent("plugin:slow-cancel")) {
    throw new Error("Expected plugin:slow-cancel to be registered after reload");
  }

  const helloAgentId = "plugin:hello-world";
  const { output } = await kernel.runAgent(helloAgentId, "Phase 2 test");

  const parsed = JSON.parse(output);
  if (!parsed?.ok) {
    throw new Error(`Expected ok=true, got: ${output}`);
  }
  if (parsed?.result?.type !== "text") {
    throw new Error(`Expected text result, got: ${output}`);
  }

  console.log("✓ Plugin agent executed successfully");
  console.log("Result:", parsed.result.content);

  // Hard-cancel test (should stop an in-flight plugin)
  const slowAgentId = "plugin:slow-cancel";
  const cancelTaskId = `cancel-test-${Date.now()}`;

  const runPromise = kernel.runAgent(
    slowAgentId,
    JSON.stringify({ taskId: cancelTaskId, query: "please wait" })
  );

  await new Promise((r) => setTimeout(r, 100));
  const aborted = abortPluginTask(cancelTaskId);
  if (!aborted) {
    throw new Error("Expected abortPluginTask() to return true for active run");
  }

  let cancelled = false;
  try {
    await runPromise;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    cancelled = /cancel|abort/i.test(msg);
  }

  if (!cancelled) {
    throw new Error("Expected slow-cancel run to be aborted/cancelled");
  }

  console.log("✓ Hard cancellation aborts plugin execution");

  testPlugins.cleanup();
}

main().catch((err) => {
  console.error("Plugins test failed:", err);
  process.exitCode = 1;
});
