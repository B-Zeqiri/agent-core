import { BaseTool } from "../tools/tool.interface";

export interface SecurityOptions {
  defaultTimeoutMs?: number;
}

export class SecurityManager {
  private defaultTimeoutMs: number;

  constructor(opts?: SecurityOptions) {
    this.defaultTimeoutMs = opts?.defaultTimeoutMs ?? 5000; // 5s default
  }

  async executeWithTimeout<T>(agentId: string, fn: () => Promise<T>, timeoutMs?: number): Promise<T> {
    const t = timeoutMs ?? this.defaultTimeoutMs;

    return new Promise<T>((resolve, reject) => {
      let finished = false;

      const timer = setTimeout(() => {
        if (finished) return;
        finished = true;
        const err = new Error(`Execution timed out after ${t}ms`);
        (err as any).code = "ETIMEDOUT";
        reject(err);
      }, t);

      fn()
        .then((res) => {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          resolve(res);
        })
        .catch((err) => {
          if (finished) return;
          finished = true;
          clearTimeout(timer);
          reject(err);
        });
    });
  }

  async enforceToolCall(agentId: string, tool: BaseTool, args: any): Promise<any> {
    const toolCfg = tool.getConfig();
    const timeout = (toolCfg as any).timeout ?? (toolCfg as any).timeoutMs as number | undefined;
    return this.executeWithTimeout(agentId, () => tool.execute(args), timeout);
  }
}

export const securityManager = new SecurityManager();
