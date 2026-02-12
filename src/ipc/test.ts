import { AgentRegistry } from "../kernel/registry";
import { IPCManager } from "./ipcManager";

const colors = { reset: "\x1b[0m", green: "\x1b[32m", red: "\x1b[31m", blue: "\x1b[34m" };
function pass(msg: string) { console.log(`${colors.green}✓${colors.reset} ${msg}`); }
function fail(msg: string) { console.log(`${colors.red}✗${colors.reset} ${msg}`); process.exit(1); }
async function assert(cond: boolean, msg: string) { if (cond) pass(msg); else fail(msg); }

async function run() {
  console.log(`\n${colors.blue}→ IPC Tests${colors.reset}\n`);

  const registry = new AgentRegistry();
  registry.register({ id: "a1", name: "A1", model: "m", state: "idle", handler: async (task: string) => `ack:${task}` });
  registry.register({ id: "a2", name: "A2", model: "m", state: "idle", tags: ["team"], handler: async (task: string) => `ack:${task}` });
  registry.register({ id: "a3", name: "A3", model: "m", state: "idle", tags: ["team"], handler: async (task: string) => `ack:${task}` });
  registry.register({ id: "a4", name: "A4", model: "m", state: "idle", tags: ["admin", "secret", "finance"], handler: async (task: string) => `ack:${task}` });

  // Create IPC manager (default limits)
  const ipc = new IPCManager(registry);

  // Initially no permissions: send should be denied
  let threw = false;
  try {
    ipc.sendToAgent("a1", "a2", "greeting", "hello");
  } catch (e) {
    threw = true;
  }
  await assert(threw, "Send denied when sender lacks permission");

  // Grant sender and receiver permissions
  const a1 = registry.get("a1")!;
  a1.permissions = ["ipc:send"];
  const a2 = registry.get("a2")!;
  a2.permissions = ["ipc:receive"];
  const a3 = registry.get("a3")!;
  a3.permissions = ["ipc:receive"];
  const a4 = registry.get("a4")!;
  a4.permissions = ["ipc:receive"];

  // direct message
  let received = false;
  const unsub = ipc.subscribeAgent("a2", (msg) => {
    if (msg.payload === "hello") received = true;
  });

  ipc.sendToAgent("a1", "a2", "greeting", "hello");
  await new Promise((r) => setTimeout(r, 10));
  await assert(received, "Agent a2 received direct message");
  unsub();

  // inbox contains message
  const inbox = ipc.getInbox("a2");
  await assert(inbox.length === 1 && inbox[0].payload === "hello", "Inbox stored message");

  // tag broadcast (a1 has ipc:send, allowed)
  let tagCount = 0;
  const unsubTag = ipc.subscribeTag("team", () => { tagCount++; });
  ipc.sendToTag("a1", "team", "notice", { x: 1 });
  await new Promise((r) => setTimeout(r, 10));
  await assert(tagCount === 2, "Both tag members received tag message");
  unsubTag();

  // broadcast (requires ipc:send or ipc:send:broadcast) - a1 has ipc:send
  let bc = 0;
  const unsubBc = ipc.subscribeBroadcast(() => { bc++; });
  ipc.broadcast("a1", "announce", "all");
  await new Promise((r) => setTimeout(r, 10));
  await assert(bc === 1, "Broadcast handler called");
  unsubBc();

  // Rate limiting: use a dedicated IPCManager with tight limits
  const ipcRate = new IPCManager(registry, { maxPerWindow: 2, windowMs: 1000 });
  // ensure permissions on registry (a1 already has ipc:send; a2 has ipc:receive)
  ipcRate.sendToAgent("a1", "a2", "r1", "x");
  ipcRate.sendToAgent("a1", "a2", "r2", "y");
  let rateThrew = false;
  try {
    ipcRate.sendToAgent("a1", "a2", "r3", "z");
  } catch (e) {
    rateThrew = true;
  }
  await assert(rateThrew, "Rate limit enforced for sender");

  // clear inbox
  ipc.clearInbox("a2");
  await assert(ipc.getInbox("a2").length === 0, "Inbox cleared");

  // ACL Tests: grant tag permission to a4
  ipc.grantTagPermission("a4", "admin");
  const acl = ipc.getTagACL("a4");
  await assert(acl.allowed.includes("admin") && acl.denied.length === 0, "grantTagPermission: a4 can receive admin tag");

  // ACL: send to granted tag
  let adminCount = 0;
  const unsubAdmin = ipc.subscribeTag("admin", () => { adminCount++; });
  ipc.sendToTag("a1", "admin", "admin-msg", { data: "x" });
  await new Promise((r) => setTimeout(r, 10));
  await assert(adminCount === 1, "sendToTag: a4 received admin message after grant");
  unsubAdmin();

  // ACL: send to non-granted tag (allowlist exists, so should NOT receive)
  let otherCount = 0;
  const unsubOther = ipc.subscribeTag("other", () => { otherCount++; });
  ipc.sendToTag("a1", "other", "other-msg", { data: "y" });
  await new Promise((r) => setTimeout(r, 10));
  await assert(otherCount === 0, "sendToTag: a4 denied other tag (not in allowlist)");
  unsubOther();

  // ACL: revoke tag permission
  ipc.revokeTagPermission("a4", "admin");
  const acl2 = ipc.getTagACL("a4");
  await assert(!acl2.allowed.includes("admin"), "revokeTagPermission: a4 no longer has admin in allowlist");

  // ACL: after revoke, allowlist is empty so agent accepts all tags again
  let afterRevoke = 0;
  const unsubAdminAfter = ipc.subscribeTag("admin", () => { afterRevoke++; });
  const adminMsgs = ipc.sendToTag("a1", "admin", "admin-msg2", { data: "y" });
  await new Promise((r) => setTimeout(r, 10));
  await assert(adminMsgs.length === 1, "sendToTag: a4 receives admin after revoke (no allowlist)");
  unsubAdminAfter();

  // ACL: deny tag (creates denylist)
  ipc.denyTag("a4", "secret");
  const acl3 = ipc.getTagACL("a4");
  await assert(acl3.denied.includes("secret"), "denyTag: secret in denylist");

  // ACL: send to denied tag (a4 should not receive)
  let deniedCount = 0;
  const unsubSecret = ipc.subscribeTag("secret", () => { deniedCount++; });
  const secretMsgs = ipc.sendToTag("a1", "secret", "secret-msg", { data: "z" });
  await new Promise((r) => setTimeout(r, 10));
  await assert(secretMsgs.length === 0, "sendToTag: a4 denied secret tag");
  unsubSecret();

  // ACL: undeny tag
  ipc.undenyTag("a4", "secret");
  const acl4 = ipc.getTagACL("a4");
  await assert(!acl4.denied.includes("secret"), "undenyTag: secret removed from denylist");

  // ACL: send to previously denied tag (a4 should receive now, no allowlist)
  let afterUndeny = 0;
  const unsubSecretAfter = ipc.subscribeTag("secret", () => { afterUndeny++; });
  const secretMsgs2 = ipc.sendToTag("a1", "secret", "secret-msg2", { data: "w" });
  await new Promise((r) => setTimeout(r, 10));
  await assert(secretMsgs2.length === 1, "sendToTag: a4 receives secret after undeny");
  unsubSecretAfter();

  // ACL: Clear a4's ACL for clean test state
  ipc.clearTagACL("a4");

  // ACL: broadcast deny on a3
  ipc.denyTag("a3", "broadcast");
  let bcCount = 0;
  const unsubBc2 = ipc.subscribeBroadcast(() => { bcCount++; });
  const bcMsgs = ipc.broadcast("a1", "announce2", "msg");
  await new Promise((r) => setTimeout(r, 10));
  // a1 is sender (skipped), a2 has no ACL (receives), a3 denied broadcast (skipped), a4 no ACL (receives) → 2 messages
  await assert(bcMsgs.length === 2, "broadcast: a3 denied (skipped), a2 and a4 receive");
  unsubBc2();

  // ACL: getTagACL with multiple tags on a3 (new agent for clean test)
  // First clear a3's existing broadcast deny
  ipc.clearTagACL("a3");
  ipc.grantTagPermission("a3", "alerts");
  ipc.grantTagPermission("a3", "logs");
  ipc.denyTag("a3", "internal");
  const acl5 = ipc.getTagACL("a3");
  await assert(
    acl5.allowed.includes("alerts") && acl5.allowed.includes("logs") && acl5.denied.includes("internal"),
    "getTagACL: returns correct allowed and denied lists"
  );

  // ACL: clearTagACL
  ipc.clearTagACL("a3");
  const acl6 = ipc.getTagACL("a3");
  await assert(acl6.allowed.length === 0 && acl6.denied.length === 0, "clearTagACL: a3 ACL cleared");

  // ACL: grant finance to a4 (will restrict to allowlist)
  ipc.grantTagPermission("a4", "finance");
  const acl7 = ipc.getTagACL("a4");
  await assert(acl7.allowed.includes("finance"), "grantTagPermission creates allowlist with finance");

  // ACL: send to finance tag (should receive)
  let financeCount = 0;
  const unsubFin = ipc.subscribeTag("finance", () => { financeCount++; });
  const finMsgs = ipc.sendToTag("a1", "finance", "fin", {});
  await new Promise((r) => setTimeout(r, 10));
  await assert(finMsgs.length === 1, "sendToTag: a4 receives finance (in allowlist)");
  unsubFin();

  // ACL: send to non-allowlisted tag (should NOT receive)
  const nonAllowMsgs = ipc.sendToTag("a1", "reports", "msg", {});
  await new Promise((r) => setTimeout(r, 10));
  await assert(nonAllowMsgs.length === 0, "sendToTag: a4 (with allowlist) denied non-allowlisted reports tag");

  console.log(`\n${colors.green}All IPC tests passed${colors.reset}\n`);
}

run().catch((e) => { console.error(e); process.exit(1); });
