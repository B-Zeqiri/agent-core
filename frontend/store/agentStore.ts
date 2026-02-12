import { create } from "zustand";

export type AgentState = "READY" | "BUSY" | "IDLE";
export type Capability = string;

export type AgentInfo = {
  name: string;
  status: AgentState;
  currentTaskId?: string;
  lastUpdated: number;
};

function shallowEqualAgents(a: AgentInfo[], b: AgentInfo[]) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const left = a[i];
    const right = b[i];
    if (!right) return false;
    if (
      left.name !== right.name ||
      left.status !== right.status ||
      left.currentTaskId !== right.currentTaskId ||
      left.lastUpdated !== right.lastUpdated
    ) {
      return false;
    }
  }
  return true;
}

export interface AgentStoreState {
  apiOrigin: string;
  agents: AgentInfo[];
  activeAgents: AgentInfo[];
  idleAgents: AgentInfo[];
  capabilities: Record<string, Capability[]>; // by agent name

  // Derived
  activeCount: number;
  idleCount: number;

  // Actions
  setApiOrigin: (origin: string) => void;
  setCapabilities: (agentName: string, caps: Capability[]) => void;
  fetchAgents: () => Promise<void>;
  startPolling: (intervalMs?: number) => void;
  stopPolling: () => void;
}

function getDefaultOrigin() {
  if (typeof window !== "undefined") return window.location.origin;
  return "http://localhost:3000";
}

let pollTimer: ReturnType<typeof setInterval> | undefined;

export const useAgentStore = create<AgentStoreState>((set, get) => ({
  apiOrigin: getDefaultOrigin(),
  agents: [],
  activeAgents: [],
  idleAgents: [],
  capabilities: {},

  get activeCount() {
    return get().activeAgents.length;
  },
  get idleCount() {
    return get().idleAgents.length;
  },

  setApiOrigin(origin) {
    set({ apiOrigin: origin });
  },

  setCapabilities(agentName, caps) {
    const next = { ...get().capabilities, [agentName]: caps };
    set({ capabilities: next });
  },

  async fetchAgents() {
    const origin = get().apiOrigin;
    try {
      const res = await fetch(`${origin}/api/agents`);
      if (!res.ok) return;
      const agents: AgentInfo[] = await res.json();
      const prev = get().agents;
      if (shallowEqualAgents(prev, agents)) return;
      const active = agents.filter((a) => a.status !== "IDLE");
      const idle = agents.filter((a) => a.status === "IDLE");
      set({ agents, activeAgents: active, idleAgents: idle });
      // Initialize capabilities map entries if missing
      const caps = { ...get().capabilities };
      agents.forEach((a) => {
        if (!caps[a.name]) caps[a.name] = [];
      });
      set({ capabilities: caps });
    } catch (_) {
      // ignore transient errors
    }
  },

  startPolling(intervalMs = 3000) {
    if (pollTimer) clearInterval(pollTimer);
    const run = async () => {
      await get().fetchAgents();
    };
    run();
    pollTimer = setInterval(run, intervalMs);
  },

  stopPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = undefined;
  },
}));
