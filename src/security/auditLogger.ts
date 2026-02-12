/**
 * Audit Logger
 *
 * Tracks security-relevant events: tool executions, timeouts, permission denials, etc.
 */

export interface AuditEvent {
  timestamp: number;
  eventType: 'tool-call' | 'tool-timeout' | 'permission-denied' | 'rate-limit-exceeded' | 'execution-error';
  agentId: string;
  toolName?: string;
  details: Record<string, any>;
}

export class AuditLogger {
  private events: AuditEvent[] = [];
  private maxEvents: number;

  constructor(maxEvents: number = 10000) {
    this.maxEvents = maxEvents;
  }

  log(event: Omit<AuditEvent, 'timestamp'>): void {
    const auditEvent: AuditEvent = {
      ...event,
      timestamp: Date.now(),
    };

    this.events.push(auditEvent);

    // Keep only recent events
    if (this.events.length > this.maxEvents) {
      this.events.shift();
    }
  }

  getEvents(filter?: { agentId?: string; toolName?: string; eventType?: string; limit?: number }): AuditEvent[] {
    let result = this.events;

    if (filter?.agentId) {
      result = result.filter(e => e.agentId === filter.agentId);
    }

    if (filter?.toolName) {
      result = result.filter(e => e.toolName === filter.toolName);
    }

    if (filter?.eventType) {
      result = result.filter(e => e.eventType === filter.eventType as any);
    }

    const limit = filter?.limit ?? 100;
    return result.slice(-limit);
  }

  getStats(): Record<string, any> {
    const stats: Record<string, any> = {
      totalEvents: this.events.length,
      byType: {} as Record<string, number>,
      byAgent: {} as Record<string, number>,
      byTool: {} as Record<string, number>,
    };

    this.events.forEach(e => {
      stats.byType[e.eventType] = (stats.byType[e.eventType] ?? 0) + 1;
      stats.byAgent[e.agentId] = (stats.byAgent[e.agentId] ?? 0) + 1;
      if (e.toolName) {
        stats.byTool[e.toolName] = (stats.byTool[e.toolName] ?? 0) + 1;
      }
    });

    return stats;
  }

  clear(): void {
    this.events = [];
  }
}

export const auditLogger = new AuditLogger();
