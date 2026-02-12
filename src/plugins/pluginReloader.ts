import type { Kernel } from "../kernel/kernel";
import type { Orchestrator } from "../orchestration/orchestrator";
import type { KernelScheduler } from "../scheduler/kernelScheduler";

import { loadAllPluginAgents } from "./pluginLoader";
import { pluginDefinitionToKernelAgent, type PluginRuntimeServices } from "./pluginRuntime";

export interface UiAgentInfoLike {
  id: string;
  name: string;
  status: string;
  currentTaskId?: string;
  lastUpdated: number;
}

export interface PluginReloadResult {
  discoveredEntryPaths: string[];
  loaded: Array<{ id: string; name: string; entryPath: string }>;
  removed: string[];
  skippedBusy: string[];
  errors: Array<{ entryPath: string; error: string }>;
}

function isPluginAgentId(id: string): boolean {
  return typeof id === "string" && id.startsWith("plugin:");
}

function getBusyUiAgentIds(uiAgents: UiAgentInfoLike[]): Set<string> {
  const busy = new Set<string>();
  for (const a of uiAgents) {
    if (isPluginAgentId(a.id) && (a.status === "BUSY" || a.status === "RUNNING")) {
      busy.add(a.id);
    }
  }
  return busy;
}

function upsertUiAgent(uiAgents: UiAgentInfoLike[], agentId: string, agentName: string): void {
  const idx = uiAgents.findIndex((a) => a.id === agentId);
  const now = Date.now();
  if (idx === -1) {
    uiAgents.push({ id: agentId, name: agentName, status: "READY", lastUpdated: now });
  } else {
    uiAgents[idx] = { ...uiAgents[idx], name: agentName, lastUpdated: now };
    if (uiAgents[idx].status !== "BUSY") {
      uiAgents[idx].status = "READY";
    }
  }
}

function removeUiAgent(uiAgents: UiAgentInfoLike[], agentId: string): void {
  const idx = uiAgents.findIndex((a) => a.id === agentId);
  if (idx !== -1) uiAgents.splice(idx, 1);
}

export function reloadAllPluginAgents(params: {
  kernel: Kernel;
  orchestrator: Orchestrator;
  scheduler: KernelScheduler;
  uiAgents: UiAgentInfoLike[];
  services?: PluginRuntimeServices;
  pluginsRoot?: string;
}): PluginReloadResult {
  const { kernel, orchestrator, scheduler, uiAgents, services, pluginsRoot } = params;

  const busyIds = getBusyUiAgentIds(uiAgents);

  // Track current plugin agents (kernel-based source of truth)
  const currentKernelPluginIds = new Set(
    kernel
      .listAgents()
      .filter((a) => isPluginAgentId(a.id) || a.metadata?.kind === "plugin" || a.tags?.includes("plugin"))
      .map((a) => a.id)
  );

  const loaded = [] as PluginReloadResult["loaded"];
  const errors: PluginReloadResult["errors"] = [];

  const pluginModules = (() => {
    try {
      return loadAllPluginAgents(pluginsRoot ? { pluginsRoot } : undefined);
    } catch (err) {
      errors.push({ entryPath: pluginsRoot ?? "plugins", error: err instanceof Error ? err.message : String(err) });
      return [];
    }
  })();

  const discoveredEntryPaths = pluginModules.map((p) => p.entryPath);

  // Convert definitions to kernel agents first so we know the intended IDs.
  const newKernelAgents: Array<{ agentId: string; agentName: string; entryPath: string; kernelAgent: any }> = [];
  for (const p of pluginModules) {
    try {
      const kernelAgent = pluginDefinitionToKernelAgent(p.definition, services);
      newKernelAgents.push({ agentId: kernelAgent.id, agentName: kernelAgent.name, entryPath: p.entryPath, kernelAgent });
    } catch (err) {
      errors.push({ entryPath: p.entryPath, error: err instanceof Error ? err.message : String(err) });
    }
  }

  const newIds = new Set(newKernelAgents.map((a) => a.agentId));

  // Remove plugin agents that are no longer present.
  const removed: string[] = [];
  const skippedBusy: string[] = [];

  for (const oldId of currentKernelPluginIds) {
    if (!newIds.has(oldId)) {
      if (busyIds.has(oldId)) {
        skippedBusy.push(oldId);
        continue;
      }
      kernel.unregisterAgent(oldId);
      orchestrator.unregisterAgent(oldId);
      scheduler.unregisterAgent(oldId);
      removeUiAgent(uiAgents, oldId);
      removed.push(oldId);
    }
  }

  // Update/add agents.
  for (const a of newKernelAgents) {
    if (busyIds.has(a.agentId)) {
      skippedBusy.push(a.agentId);
      continue;
    }

    // Replace if already registered
    if (kernel.getAgent(a.agentId)) {
      kernel.unregisterAgent(a.agentId);
    }

    kernel.registerAgent(a.kernelAgent);
    orchestrator.registerAgent(a.kernelAgent);
    scheduler.registerAgent(a.kernelAgent.id, a.kernelAgent.name);

    upsertUiAgent(uiAgents, a.kernelAgent.id, a.kernelAgent.name);
    loaded.push({ id: a.kernelAgent.id, name: a.kernelAgent.name, entryPath: a.entryPath });
  }

  return {
    discoveredEntryPaths,
    loaded,
    removed,
    skippedBusy: Array.from(new Set(skippedBusy)),
    errors,
  };
}
