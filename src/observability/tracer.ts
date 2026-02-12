import { TraceEntry, MonitoringConfig, MessageTrace } from "./types";
import { v4 as uuidv4 } from "uuid";

export class Tracer {
  private traces: TraceEntry[] = [];
  private messageTraces: MessageTrace[] = [];
  private maxEntries: number = 10000;
  private sampleRate: number = 1.0;
  private enabled: boolean = true;

  constructor(config?: MonitoringConfig) {
    if (config) {
      this.enabled = config.enableTracing ?? true;
      this.maxEntries = config.maxTraceEntries ?? 10000;
      this.sampleRate = config.traceSampleRate ?? 1.0;
    }
  }

  private shouldTrace(): boolean {
    return this.enabled && Math.random() < this.sampleRate;
  }

  traceEvent(
    type: "message:sent" | "message:received" | "task:created" | "task:completed" | "task:failed",
    agentId: string,
    data: Record<string, any>
  ): string {
    if (!this.shouldTrace()) return "";
    const traceId = uuidv4();
    const entry: TraceEntry = {
      timestamp: Date.now(),
      traceId,
      type,
      agentId,
      data,
    };
    this.traces.push(entry);
    if (this.traces.length > this.maxEntries) {
      this.traces = this.traces.slice(-this.maxEntries);
    }
    return traceId;
  }

  traceMessage(from: string, to: string, type: string, payload: any, tag?: string): string {
    if (!this.shouldTrace()) return "";
    const id = uuidv4();
    const trace: MessageTrace = {
      id,
      from,
      to,
      tag,
      type,
      payload,
      timestamp: Date.now(),
      status: "pending",
    };
    this.messageTraces.push(trace);
    if (this.messageTraces.length > this.maxEntries) {
      this.messageTraces = this.messageTraces.slice(-this.maxEntries);
    }
    return id;
  }

  markMessageDelivered(messageId: string, deliveryTime?: number) {
    const msg = this.messageTraces.find((m) => m.id === messageId);
    if (msg) {
      msg.status = "delivered";
      msg.deliveryTime = deliveryTime ?? Date.now() - msg.timestamp;
    }
  }

  markMessageFailed(messageId: string) {
    const msg = this.messageTraces.find((m) => m.id === messageId);
    if (msg) msg.status = "failed";
  }

  getTraces(count?: number): TraceEntry[] {
    if (count === undefined) return this.traces;
    if (count === 0) return [];
    return this.traces.slice(-count);
  }

  getTracesByType(type: TraceEntry["type"], count?: number): TraceEntry[] {
    const filtered = this.traces.filter((t) => t.type === type);
    if (count === undefined) return filtered;
    if (count === 0) return [];
    return filtered.slice(-count);
  }

  getTracesByAgent(agentId: string, count?: number): TraceEntry[] {
    const filtered = this.traces.filter((t) => t.agentId === agentId);
    if (count === undefined) return filtered;
    if (count === 0) return [];
    return filtered.slice(-count);
  }

  getMessageTraces(count?: number): MessageTrace[] {
    if (count === undefined) return this.messageTraces;
    if (count === 0) return [];
    return this.messageTraces.slice(-count);
  }

  getMessageTracesByAgent(agentId: string, count?: number): MessageTrace[] {
    const filtered = this.messageTraces.filter((m) => m.from === agentId || m.to === agentId);
    if (count === undefined) return filtered;
    if (count === 0) return [];
    return filtered.slice(-count);
  }

  getMessageTrace(id: string): MessageTrace | undefined {
    return this.messageTraces.find((m) => m.id === id);
  }

  clearTraces() {
    this.traces = [];
    this.messageTraces = [];
  }

  getStatistics() {
    const byType: Record<string, number> = {};
    for (const trace of this.traces) {
      byType[trace.type] = (byType[trace.type] ?? 0) + 1;
    }
    const msgStats = {
      pending: this.messageTraces.filter((m) => m.status === "pending").length,
      delivered: this.messageTraces.filter((m) => m.status === "delivered").length,
      failed: this.messageTraces.filter((m) => m.status === "failed").length,
    };
    return {
      totalTraces: this.traces.length,
      byType,
      totalMessages: this.messageTraces.length,
      messageStats: msgStats,
    };
  }
}
