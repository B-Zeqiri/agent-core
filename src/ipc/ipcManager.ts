import { MessageBus } from "./messageBus";
import { IPCMessage } from "./types";
import { AgentRegistry } from "../kernel/registry";
import { v4 as uuidv4 } from "uuid";

export type IPCConfig = {
  maxPerWindow?: number; // messages per sender per window
  windowMs?: number;
};

export class IPCManager {
  private bus = new MessageBus();
  private inboxes: Map<string, IPCMessage[]> = new Map();
  private registry: AgentRegistry;
  private rateState: Map<string, { count: number; windowStart: number }> = new Map();
  private config: Required<IPCConfig>;

  // ACL state: agentId -> { allowedTags?: Set<string>, deniedTags?: Set<string> }
  private acl: Map<string, { allowedTags?: Set<string>; deniedTags?: Set<string> }> = new Map();

  constructor(registry: AgentRegistry, config?: IPCConfig) {
    this.registry = registry;
    this.config = {
      maxPerWindow: config?.maxPerWindow ?? 100,
      windowMs: config?.windowMs ?? 60_000,
    };
  }

  private checkAndConsumeRate(from: string) {
    if (from === "system") return;
    const now = Date.now();
    const state = this.rateState.get(from) || { count: 0, windowStart: now };
    if (now - state.windowStart > this.config.windowMs) {
      state.count = 0;
      state.windowStart = now;
    }
    if (state.count >= this.config.maxPerWindow) {
      throw new Error(`Rate limit exceeded for sender ${from}`);
    }
    state.count++;
    this.rateState.set(from, state);
  }

  private ensureSenderPermits(from: string, required: string[]) {
    if (from === "system") return;
    const sender = this.registry.get(from);
    if (!sender || !sender.permissions) throw new Error(`Sender ${from} not found or has no permissions`);
    const ok = required.some((r) => sender.permissions!.includes(r));
    if (!ok) throw new Error(`Sender ${from} not permitted to perform this IPC action`);
  }

  private canReceiveTag(agentId: string, tag: string): boolean {
    const acl = this.acl.get(agentId);
    if (!acl) return true; // no ACL = accept all
    if (acl.deniedTags && acl.deniedTags.has(tag)) return false;
    if (acl.allowedTags && acl.allowedTags.size > 0) return acl.allowedTags.has(tag);
    return true; // no allowlist = accept
  }

  grantTagPermission(agentId: string, tag: string): void {
    if (!this.acl.has(agentId)) this.acl.set(agentId, {});
    const acl = this.acl.get(agentId)!;
    if (!acl.allowedTags) acl.allowedTags = new Set();
    acl.allowedTags.add(tag);
    if (acl.deniedTags) acl.deniedTags.delete(tag);
  }

  revokeTagPermission(agentId: string, tag: string): void {
    const acl = this.acl.get(agentId);
    if (!acl) return;
    if (acl.allowedTags) acl.allowedTags.delete(tag);
  }

  denyTag(agentId: string, tag: string): void {
    if (!this.acl.has(agentId)) this.acl.set(agentId, {});
    const acl = this.acl.get(agentId)!;
    if (!acl.deniedTags) acl.deniedTags = new Set();
    acl.deniedTags.add(tag);
    if (acl.allowedTags) acl.allowedTags.delete(tag);
  }

  undenyTag(agentId: string, tag: string): void {
    const acl = this.acl.get(agentId);
    if (!acl || !acl.deniedTags) return;
    acl.deniedTags.delete(tag);
  }

  getTagACL(agentId: string): { allowed: string[]; denied: string[] } {
    const acl = this.acl.get(agentId);
    return {
      allowed: Array.from(acl?.allowedTags || []),
      denied: Array.from(acl?.deniedTags || []),
    };
  }

  clearTagACL(agentId: string): void {
    this.acl.delete(agentId);
  }

  sendToAgent(from: string, to: string, type: string, payload: any, allowedPermissions: string[] = ["ipc:send"], requireReceive: boolean = true): IPCMessage | undefined {
    // require sender permission (allow override for tag/broadcast)
    this.ensureSenderPermits(from, allowedPermissions);
    this.checkAndConsumeRate(from);

    const msg: IPCMessage = {
      id: uuidv4(),
      from,
      to,
      type,
      payload,
      timestamp: Date.now(),
    };


    // Check receiver permission (if agent exists)
    const receiver = this.registry.get(to);
    if (receiver && receiver.permissions && !receiver.permissions.includes("ipc:receive")) {
      if (requireReceive) {
        throw new Error(`Receiver ${to} not permitted to receive IPC messages`);
      }
      // skip recipient silently when broadcasting/tagging
      return undefined;
    }

    // store in inbox
    if (!this.inboxes.has(to)) this.inboxes.set(to, []);
    this.inboxes.get(to)!.push(msg);

    // publish on channel
    this.bus.publish(`agent:${to}`, msg);

    return msg;
  }

  sendToTag(from: string, tag: string, type: string, payload: any): IPCMessage[] {
    // Permission: sender needs ipc:send or ipc:send:tag
    // sendToAgent will enforce per-recipient checks and rate limiting; allow ipc:send:tag
    const agents = this.registry.getByTag(tag);
    const msgs: IPCMessage[] = [];
    for (const a of agents) {
      // Check ACL: agent must allow this tag
      if (!this.canReceiveTag(a.id, tag)) continue;
      const m = this.sendToAgent(from, a.id, type, payload, ["ipc:send", "ipc:send:tag"], false);
      if (m) msgs.push(m);
    }
    // also publish to tag channel
    for (const m of msgs) this.bus.publish(`tag:${tag}`, m);
    return msgs;
  }

  broadcast(from: string, type: string, payload: any): IPCMessage[] {
    // Permission: sender needs ipc:send or ipc:send:broadcast
    // sendToAgent will enforce per-recipient checks and rate limiting; allow ipc:send:broadcast
    const all = this.registry.getAll();
    const msgs: IPCMessage[] = [];
    for (const a of all) {
      // Check ACL: agent must allow broadcast (virtual "broadcast" tag)
      if (!this.canReceiveTag(a.id, "broadcast")) continue;
      const m = this.sendToAgent(from, a.id, type, payload, ["ipc:send", "ipc:send:broadcast"], false);
      if (m) msgs.push(m);
    }
    this.bus.publish("broadcast", { id: uuidv4(), from, type, payload, timestamp: Date.now() } as IPCMessage);
    return msgs;
  }

  subscribeAgent(agentId: string, handler: (msg: IPCMessage) => void) {
    return this.bus.subscribe(`agent:${agentId}`, handler);
  }

  subscribeTag(tag: string, handler: (msg: IPCMessage) => void) {
    return this.bus.subscribe(`tag:${tag}`, handler);
  }

  subscribeBroadcast(handler: (msg: IPCMessage) => void) {
    return this.bus.subscribe("broadcast", handler);
  }

  getInbox(agentId: string): IPCMessage[] {
    return this.inboxes.get(agentId) || [];
  }

  clearInbox(agentId: string) {
    this.inboxes.delete(agentId);
  }
}
