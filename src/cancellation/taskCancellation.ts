const taskAbortControllers = new Map<string, AbortController>();

function toAbortError(signal: AbortSignal): Error {
  const reason = (signal as any).reason;
  if (reason instanceof Error) return reason;
  if (reason == null) return new Error('Task aborted');
  return new Error(typeof reason === 'string' ? reason : JSON.stringify(reason));
}

export function getOrCreateTaskAbortController(taskId: string): AbortController {
  const existing = taskAbortControllers.get(taskId);
  // If a previous run was cancelled/aborted but the controller hasn't been
  // cleaned up yet, a retry with the same taskId must not inherit an already-
  // aborted signal.
  if (existing && !existing.signal.aborted) return existing;
  const controller = new AbortController();
  taskAbortControllers.set(taskId, controller);
  return controller;
}

export function getTaskAbortSignal(taskId: string): AbortSignal | undefined {
  return taskAbortControllers.get(taskId)?.signal;
}

export function hasTaskAbortController(taskId: string): boolean {
  return taskAbortControllers.has(taskId);
}

export function abortTask(taskId: string, reason?: unknown): boolean {
  const controller = taskAbortControllers.get(taskId);
  if (!controller) return false;

  try {
    (controller as any).abort?.(reason);
  } catch {
    controller.abort();
  }

  return true;
}

export function cleanupTaskAbortController(taskId: string): void {
  taskAbortControllers.delete(taskId);
}

export function raceWithAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(toAbortError(signal));

  return Promise.race([
    promise,
    new Promise<never>((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(toAbortError(signal)), { once: true });
    }),
  ]);
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal && signal.aborted) {
    throw toAbortError(signal);
  }
}
