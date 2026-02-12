import {
  abortTask,
  cleanupTaskAbortController,
  getOrCreateTaskAbortController,
  hasTaskAbortController,
} from '../cancellation/taskCancellation';

// Backwards-compatible API (Phase 2.5) — now backed by the global registry
export function registerPluginAbortController(taskId: string, controller: AbortController): void {
  const existing = getOrCreateTaskAbortController(taskId);
  if (existing !== controller) {
    controller.signal.addEventListener(
      'abort',
      () => {
        abortTask(taskId, (controller.signal as any).reason);
      },
      { once: true }
    );
  }
}

export function cleanupPluginAbortController(taskId: string): void {
  cleanupTaskAbortController(taskId);
}

export function abortPluginTask(taskId: string): boolean {
  return abortTask(taskId, 'Task cancelled');
}

export function hasPluginTask(taskId: string): boolean {
  return hasTaskAbortController(taskId);
}
