import { LogEntry, LogLevel, MonitoringConfig } from "./types";

export class Logger {
  private logs: LogEntry[] = [];
  private maxEntries: number = 10000;
  private logLevel: LogLevel = "info";
  private enabled: boolean = true;

  constructor(config?: MonitoringConfig) {
    if (config) {
      this.enabled = config.enableLogging ?? true;
      this.logLevel = config.logLevel ?? "info";
      this.maxEntries = config.maxLogEntries ?? 10000;
    }
  }

  private shouldLog(level: LogLevel): boolean {
    if (!this.enabled) return false;
    const levels: LogLevel[] = ["debug", "info", "warn", "error"];
    return levels.indexOf(level) >= levels.indexOf(this.logLevel);
  }

  debug(source: string, message: string, data?: Record<string, any>, agentId?: string) {
    if (this.shouldLog("debug")) this.addEntry("debug", source, message, data, agentId);
  }

  info(source: string, message: string, data?: Record<string, any>, agentId?: string) {
    if (this.shouldLog("info")) this.addEntry("info", source, message, data, agentId);
  }

  warn(source: string, message: string, data?: Record<string, any>, agentId?: string) {
    if (this.shouldLog("warn")) this.addEntry("warn", source, message, data, agentId);
  }

  error(source: string, message: string, data?: Record<string, any>, agentId?: string) {
    if (this.shouldLog("error")) this.addEntry("error", source, message, data, agentId);
  }

  private addEntry(level: LogLevel, source: string, message: string, data?: Record<string, any>, agentId?: string) {
    const entry: LogEntry = {
      timestamp: Date.now(),
      level,
      source,
      message,
      data,
      agentId,
    };
    this.logs.push(entry);
    if (this.logs.length > this.maxEntries) {
      this.logs = this.logs.slice(-this.maxEntries);
    }
  }

  getLogs(count?: number): LogEntry[] {
    if (count === undefined) return this.logs;
    if (count === 0) return [];
    return this.logs.slice(-count);
  }

  getLogsBySource(source: string, count?: number): LogEntry[] {
    const filtered = this.logs.filter((l) => l.source === source);
    if (count === undefined) return filtered;
    if (count === 0) return [];
    return filtered.slice(-count);
  }

  getLogsByLevel(level: LogLevel, count?: number): LogEntry[] {
    const filtered = this.logs.filter((l) => l.level === level);
    if (count === undefined) return filtered;
    if (count === 0) return [];
    return filtered.slice(-count);
  }

  getLogsByAgent(agentId: string, count?: number): LogEntry[] {
    const filtered = this.logs.filter((l) => l.agentId === agentId);
    if (count === undefined) return filtered;
    if (count === 0) return [];
    return filtered.slice(-count);
  }

  clearLogs() {
    this.logs = [];
  }

  getStatistics() {
    const byLevel: Record<LogLevel, number> = { debug: 0, info: 0, warn: 0, error: 0 };
    const bySource: Record<string, number> = {};
    for (const log of this.logs) {
      byLevel[log.level]++;
      bySource[log.source] = (bySource[log.source] ?? 0) + 1;
    }
    return { totalLogs: this.logs.length, byLevel, bySource };
  }
}
