import { Worker } from 'worker_threads';
import path from 'path';

export interface WorkerOptions {
  timeoutMs?: number;
  memoryMb?: number;
}

export function executeModuleInWorker(modulePath: string, exportName: string, args: any, opts?: WorkerOptions): Promise<any> {
  const absModulePath = path.isAbsolute(modulePath) ? modulePath : path.join(process.cwd(), modulePath);
  const timeout = opts?.timeoutMs ?? 5000;
  const memoryMb = opts?.memoryMb;

  const workerScript = `
    const { parentPort, workerData } = require('worker_threads');
    (async () => {
      try {
        const mod = require(workerData.modulePath);
        const fn = workerData.exportName ? mod[workerData.exportName] : mod;
        if (!fn) throw new Error('Export not found: ' + workerData.exportName);
        const res = await fn(workerData.args);
        parentPort.postMessage({ type: 'result', result: res });
      } catch (err) {
        parentPort.postMessage({ type: 'error', error: err && err.message ? err.message : String(err) });
      }
    })();
  `;

  return new Promise<any>((resolve, reject) => {
    const worker = new Worker(workerScript, {
      eval: true,
      workerData: { modulePath: absModulePath, exportName, args },
      resourceLimits: memoryMb ? { maxOldGenerationSizeMb: memoryMb } : undefined,
    });

    let finished = false;
    const timer = setTimeout(() => {
      if (finished) return;
      finished = true;
      try {
        worker.terminate();
      } catch (_) {}
      reject(new Error(`Worker timed out after ${timeout}ms`));
    }, timeout);

    worker.on('message', (msg) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (msg && msg.type === 'result') {
        resolve(msg.result);
      } else if (msg && msg.type === 'error') {
        reject(new Error(msg.error));
      } else {
        resolve(msg);
      }
    });

    worker.on('error', (err) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      reject(err);
    });

    worker.on('exit', (code) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (code === 0) {
        resolve(undefined);
      } else {
        reject(new Error('Worker exited with code ' + code));
      }
    });
  });
}
