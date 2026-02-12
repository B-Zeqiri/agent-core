import { Logger } from "./logger";
import { Tracer } from "./tracer";
import { SystemMetrics, AgentMetrics, MonitoringConfig, HistoryWindow } from "./types";
import { Kernel } from "../kernel/kernel";

export class Monitor {
  private logger: Logger;
  private tracer: Tracer;
  private kernel: Kernel;
  private agentMetrics: Map<string, AgentMetrics> = new Map();
  private systemMetricsHistory: SystemMetrics[] = [];
  private maxMetricsHistory: number = 1000;

  constructor(kernel: Kernel, config?: MonitoringConfig) {
    this.kernel = kernel;
    this.logger = new Logger(config);
    this.tracer = new Tracer(config);
  }

  // Logging API (expose after initialization)
  get log(): Logger {
    return this.logger;
  }

  get trace(): Tracer {
    return this.tracer;
  }

  // System Metrics
  getSystemMetrics(): SystemMetrics {
    const stats = this.kernel.getStats();
    const agents = this.kernel.getRegistry().getAll();
    const messageCount = this.tracer.getMessageTraces().length;

    const avgLatency = stats.executionTimes.length > 0 ? stats.executionTimes.reduce((a: number, b: number) => a + b, 0) / stats.executionTimes.length : 0;
    const errorRate = stats.completedCount + stats.failedCount > 0 ? stats.failedCount / (stats.completedCount + stats.failedCount) : 0;

    const metrics: SystemMetrics = {
      timestamp: Date.now(),
      activeAgents: agents.filter((a) => a.state === "idle" || a.state === "running").length,
      pendingTasks: stats.taskCount,
      completedTasks: stats.completedCount,
      failedTasks: stats.failedCount,
      messageCount,
      averageLatency: avgLatency,
      errorRate,
    };

    this.systemMetricsHistory.push(metrics);
    if (this.systemMetricsHistory.length > this.maxMetricsHistory) {
      this.systemMetricsHistory = this.systemMetricsHistory.slice(-this.maxMetricsHistory);
    }

    return metrics;
  }

  getAgentMetrics(agentId: string): AgentMetrics {
    let metrics = this.agentMetrics.get(agentId);
    if (!metrics) {
      metrics = {
        agentId,
        tasksCompleted: 0,
        tasksFailed: 0,
        averageExecutionTime: 0,
        messagesReceived: 0,
        messagesSent: 0,
        lastActive: Date.now(),
      };
      this.agentMetrics.set(agentId, metrics);
    }
    return metrics;
  }

  recordTaskCompletion(agentId: string, executionTime: number) {
    const metrics = this.getAgentMetrics(agentId);
    metrics.tasksCompleted++;
    metrics.averageExecutionTime = (metrics.averageExecutionTime * (metrics.tasksCompleted - 1) + executionTime) / metrics.tasksCompleted;
    metrics.lastActive = Date.now();
  }

  recordTaskFailure(agentId: string) {
    const metrics = this.getAgentMetrics(agentId);
    metrics.tasksFailed++;
    metrics.lastActive = Date.now();
  }

  recordMessageSent(agentId: string, count: number = 1) {
    const metrics = this.getAgentMetrics(agentId);
    metrics.messagesSent += count;
    metrics.lastActive = Date.now();
  }

  recordMessageReceived(agentId: string, count: number = 1) {
    const metrics = this.getAgentMetrics(agentId);
    metrics.messagesReceived += count;
    metrics.lastActive = Date.now();
  }

  getAllAgentMetrics(): AgentMetrics[] {
    return Array.from(this.agentMetrics.values());
  }

  getSystemMetricsHistory(minutes?: number): HistoryWindow {
    let logs = this.logger.getLogs();
    let traces = this.tracer.getTraces();
    let messages = this.tracer.getMessageTraces();

    if (minutes) {
      const cutoff = Date.now() - minutes * 60 * 1000;
      logs = logs.filter((l) => l.timestamp >= cutoff);
      traces = traces.filter((t) => t.timestamp >= cutoff);
      messages = messages.filter((m) => m.timestamp >= cutoff);
    }

    return { minutes: minutes || 0, logs, traces, messages };
  }

  // Health Check
  getHealth() {
    const systemMetrics = this.getSystemMetrics();
    const agents = this.kernel.getRegistry().getAll();
    return {
      healthy: systemMetrics.errorRate < 0.1 && agents.length > 0,
      systemMetrics,
      agentCount: agents.length,
      uptime: process.uptime(),
    };
  }

  // Clear Methods
  clearLogs() {
    this.logger.clearLogs();
  }

  clearTraces() {
    this.tracer.clearTraces();
  }

  clear() {
    this.clearLogs();
    this.clearTraces();
    this.agentMetrics.clear();
    this.systemMetricsHistory = [];
  }
}
