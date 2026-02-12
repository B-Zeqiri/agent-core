import { Express, Request, Response } from "express";
import { Monitor } from "./monitor";

export class MonitoringAPI {
  constructor(private app: Express, private monitor: Monitor) {
    this.setupRoutes();
  }

  private setupRoutes() {
    // Logs endpoints
    this.app.get("/api/logs", (req: Request, res: Response) => {
      const count = req.query.count ? parseInt(req.query.count as string) : undefined;
      res.json(this.monitor.log.getLogs(count));
    });

    this.app.get("/api/logs/source/:source", (req: Request, res: Response) => {
      const count = req.query.count ? parseInt(req.query.count as string) : undefined;
      res.json(this.monitor.log.getLogsBySource(req.params.source, count));
    });

    this.app.get("/api/logs/level/:level", (req: Request, res: Response) => {
      const count = req.query.count ? parseInt(req.query.count as string) : undefined;
      res.json(this.monitor.log.getLogsByLevel(req.params.level as any, count));
    });

    this.app.get("/api/logs/agent/:agentId", (req: Request, res: Response) => {
      const count = req.query.count ? parseInt(req.query.count as string) : undefined;
      res.json(this.monitor.log.getLogsByAgent(req.params.agentId, count));
    });

    this.app.delete("/api/logs", (req: Request, res: Response) => {
      this.monitor.clearLogs();
      res.json({ ok: true });
    });

    // Traces endpoints
    this.app.get("/api/traces", (req: Request, res: Response) => {
      const count = req.query.count ? parseInt(req.query.count as string) : undefined;
      res.json(this.monitor.trace.getTraces(count));
    });

    this.app.get("/api/traces/type/:type", (req: Request, res: Response) => {
      const count = req.query.count ? parseInt(req.query.count as string) : undefined;
      res.json(this.monitor.trace.getTracesByType(req.params.type as any, count));
    });

    this.app.get("/api/traces/agent/:agentId", (req: Request, res: Response) => {
      const count = req.query.count ? parseInt(req.query.count as string) : undefined;
      res.json(this.monitor.trace.getTracesByAgent(req.params.agentId, count));
    });

    this.app.delete("/api/traces", (req: Request, res: Response) => {
      this.monitor.clearTraces();
      res.json({ ok: true });
    });

    // Messages endpoints
    this.app.get("/api/messages", (req: Request, res: Response) => {
      const count = req.query.count ? parseInt(req.query.count as string) : undefined;
      res.json(this.monitor.trace.getMessageTraces(count));
    });

    this.app.get("/api/messages/:id", (req: Request, res: Response) => {
      const msg = this.monitor.trace.getMessageTrace(req.params.id);
      if (!msg) {
        res.status(404).json({ error: "Message not found" });
        return;
      }
      res.json(msg);
    });

    this.app.get("/api/messages/agent/:agentId", (req: Request, res: Response) => {
      const count = req.query.count ? parseInt(req.query.count as string) : undefined;
      res.json(this.monitor.trace.getMessageTracesByAgent(req.params.agentId, count));
    });

    // Metrics endpoints
    this.app.get("/api/metrics/system", (req: Request, res: Response) => {
      res.json(this.monitor.getSystemMetrics());
    });

    this.app.get("/api/metrics/agents", (req: Request, res: Response) => {
      res.json(this.monitor.getAllAgentMetrics());
    });

    this.app.get("/api/metrics/agent/:agentId", (req: Request, res: Response) => {
      res.json(this.monitor.getAgentMetrics(req.params.agentId));
    });

    // History endpoints
    this.app.get("/api/history", (req: Request, res: Response) => {
      const minutes = req.query.minutes ? parseInt(req.query.minutes as string) : undefined;
      res.json(this.monitor.getSystemMetricsHistory(minutes));
    });

    // Health check
    this.app.get("/api/health", (req: Request, res: Response) => {
      const health = this.monitor.getHealth();
      const statusCode = health.healthy ? 200 : 503;
      res.status(statusCode).json(health);
    });

    // Logs statistics
    this.app.get("/api/logs/stats", (req: Request, res: Response) => {
      res.json(this.monitor.log.getStatistics());
    });

    // Traces statistics
    this.app.get("/api/traces/stats", (req: Request, res: Response) => {
      res.json(this.monitor.trace.getStatistics());
    });

    // Clear all
    this.app.delete("/api/monitor/clear", (req: Request, res: Response) => {
      this.monitor.clear();
      res.json({ ok: true });
    });
  }
}
