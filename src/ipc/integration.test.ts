import { Kernel } from "../kernel/kernel";
import { AgentRegistry } from "../kernel/registry";

const colors = { reset: "\x1b[0m", green: "\x1b[32m", red: "\x1b[31m", blue: "\x1b[34m" };
function pass(msg: string) { console.log(`${colors.green}✓${colors.reset} ${msg}`); }
function fail(msg: string) { console.log(`${colors.red}✗${colors.reset} ${msg}`); process.exit(1); }
async function assert(cond: boolean, msg: string) { if (cond) pass(msg); else fail(msg); }

async function run() {
  console.log(`\n${colors.blue}→ IPC Integration Tests${colors.reset}\n`);

  const registry = new AgentRegistry();
  const kernel = new Kernel(registry);

  let received = false;

  registry.register({ id: "k1", name: "K1", model: "local", state: "uninitialized", handler: async (t) => `ok:${t}`, onMessage: async (msg) => { if (msg.payload === 'ping') received = true; } });

  kernel.startAgent("k1");

  const ipc = kernel.getIPCManager();
  ipc.sendToAgent("system", "k1", "ping", "ping");

  await new Promise((r) => setTimeout(r, 20));
  await assert(received, "Agent received IPC message via Kernel integration");

  console.log(`\n${colors.green}IPC Kernel integration test passed${colors.reset}\n`);
}

run().catch((e) => { console.error(e); process.exit(1); });
