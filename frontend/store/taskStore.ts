import { create } from "zustand";

export type TaskStatus = "idle" | "queued" | "in_progress" | "completed" | "failed";
export type TimelineState = "pending" | "active" | "completed" | "failed";

export type TimelineStep = {
  id: string;
  label: string;
  state: TimelineState;
};

type CurrentTask = { id: string; input: string };

export interface TaskStoreState {
  apiOrigin: string;
  currentTask?: CurrentTask;
  status: TaskStatus;
  steps: TimelineStep[];
  output?: string;
  error?: string;

  // Actions
  setApiOrigin: (origin: string) => void;
  reset: () => void;
  submit: (input: string) => Promise<void>;
  stopPolling: () => void;
}

function getDefaultOrigin() {
  if (typeof window !== "undefined") return window.location.origin;
  return "http://localhost:3000";
}

function defaultSteps(): TimelineStep[] {
  return [
    { id: "understanding", label: "Understanding task", state: "pending" },
    { id: "selecting", label: "Selecting agent", state: "pending" },
    { id: "running", label: "Running tools", state: "pending" },
    { id: "finalizing", label: "Finalizing output", state: "pending" },
  ];
}

function deriveSteps(status: TaskStatus): TimelineStep[] {
  const base = defaultSteps();
  switch (status) {
    case "queued":
      return [
        { ...base[0], state: "active" },
        { ...base[1], state: "pending" },
        { ...base[2], state: "pending" },
        { ...base[3], state: "pending" },
      ];
    case "in_progress":
      return [
        { ...base[0], state: "completed" },
        { ...base[1], state: "completed" },
        { ...base[2], state: "active" },
        { ...base[3], state: "pending" },
      ];
    case "completed":
      return [
        { ...base[0], state: "completed" },
        { ...base[1], state: "completed" },
        { ...base[2], state: "completed" },
        { ...base[3], state: "completed" },
      ];
    case "failed":
      return [
        { ...base[0], state: "completed" },
        { ...base[1], state: "completed" },
        { ...base[2], state: "completed" },
        { ...base[3], state: "failed" },
      ];
    case "idle":
    default:
      return base;
  }
}

let pollTimer: ReturnType<typeof setInterval> | undefined;

export const useTaskStore = create<TaskStoreState>((set, get) => ({
  apiOrigin: getDefaultOrigin(),
  currentTask: undefined,
  status: "idle",
  steps: defaultSteps(),
  output: undefined,
  error: undefined,

  setApiOrigin(origin) {
    set({ apiOrigin: origin });
  },

  reset() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = undefined;
    set({ currentTask: undefined, status: "idle", steps: defaultSteps(), output: undefined, error: undefined });
  },

  stopPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = undefined;
  },

  async submit(input: string) {
    const origin = get().apiOrigin;
    const payload = { input };
    // set queued state immediately
    set({ currentTask: { id: "", input }, status: "queued", steps: deriveSteps("queued"), output: undefined, error: undefined });

    let taskId: string | undefined;
    try {
      const res = await fetch(`${origin}/task`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        set({ status: "failed", steps: deriveSteps("failed"), error: (data?.reason || data?.error || "Submit failed") });
        return;
      }
      taskId = data?.task_id || data?.id;
      if (!taskId) {
        set({ status: "failed", steps: deriveSteps("failed"), error: "No task id returned" });
        return;
      }
      set((s) => ({ currentTask: { id: taskId!, input: s.currentTask?.input || input }, status: "in_progress", steps: deriveSteps("in_progress") }));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      set({ status: "failed", steps: deriveSteps("failed"), error: message });
      return;
    }

    // Start polling status
    const poll = async () => {
      try {
        const res = await fetch(`${origin}/api/task/${taskId}/status`);
        if (!res.ok) return;
        const data = await res.json();
        const status: TaskStatus = (data?.status as TaskStatus) || "in_progress";
        const currentStatus = get().status;
        if (status === "completed") {
          set({ status, steps: deriveSteps(status), output: data?.result, error: undefined });
          get().stopPolling();
          return;
        }
        if (status === "failed") {
          set({ status, steps: deriveSteps(status), error: data?.reason || "Task failed" });
          get().stopPolling();
          return;
        }
        if (status === currentStatus) return; // avoid redundant re-renders
        set({ status, steps: deriveSteps(status) });
      } catch {
        // ignore transient errors
      }
    };

    // immediate poll then interval
    await poll();
    pollTimer = setInterval(poll, 1500);
  },
}));
