/**
 * Event Bus
 * 
 * Pub/Sub event system for real-time updates and event streaming
 */

export type EventType = 
  | 'task.queued'
  | 'task.scheduled'
  | 'task.started'
  | 'task.step'
  | 'task.progress'
  | 'task.completed'
  | 'task.failed'
  | 'task.cancelled'
  | 'tool.called'
  | 'tool.completed'
  | 'agent.registered'
  | 'agent.busy'
  | 'agent.idle';

export interface TaskEvent {
  type: EventType;
  taskId: string;
  agentId: string;
  timestamp: number;
  data?: any;
}

export interface EventListener {
  (event: TaskEvent): void | Promise<void>;
}

export class EventBus {
  private listeners: Map<EventType, Set<EventListener>> = new Map();
  private eventHistory: TaskEvent[] = [];
  private maxHistorySize: number = 1000;

  constructor() {
    // Initialize all event types
    const eventTypes: EventType[] = [
      'task.queued',
      'task.scheduled',
      'task.started',
      'task.step',
      'task.progress',
      'task.completed',
      'task.failed',
      'task.cancelled',
      'tool.called',
      'tool.completed',
      'agent.registered',
      'agent.busy',
      'agent.idle',
    ];

    eventTypes.forEach((type) => {
      this.listeners.set(type, new Set());
    });
  }

  /**
   * Subscribe to specific event type
   */
  on(eventType: EventType, listener: EventListener): () => void {
    const typeListeners = this.listeners.get(eventType);
    if (!typeListeners) {
      throw new Error(`Unknown event type: ${eventType}`);
    }

    typeListeners.add(listener);

    // Return unsubscribe function
    return () => {
      typeListeners.delete(listener);
    };
  }

  /**
   * Subscribe to event and listen only once
   */
  once(eventType: EventType, listener: EventListener): () => void {
    const wrappedListener: EventListener = (event) => {
      unsubscribe();
      listener(event);
    };

    const unsubscribe = this.on(eventType, wrappedListener);
    return unsubscribe;
  }

  /**
   * Publish an event
   */
  async emit(eventType: EventType, taskId: string, agentId: string, data?: any): Promise<void> {
    const event: TaskEvent = {
      type: eventType,
      taskId,
      agentId,
      timestamp: Date.now(),
      data,
    };

    // Store in history
    this.eventHistory.push(event);
    if (this.eventHistory.length > this.maxHistorySize) {
      this.eventHistory.shift();
    }

    // Emit to all listeners
    const typeListeners = this.listeners.get(eventType);
    if (typeListeners) {
      const promises = Array.from(typeListeners).map((listener) =>
        Promise.resolve(listener(event)).catch((error) => {
          console.error(`Error in event listener for ${eventType}:`, error);
        })
      );
      await Promise.all(promises);
    }
  }

  /**
   * Get event history for a specific task
   */
  getTaskHistory(taskId: string): TaskEvent[] {
    return this.eventHistory.filter((e) => e.taskId === taskId);
  }

  /**
   * Get event history for a specific agent
   */
  getAgentHistory(agentId: string): TaskEvent[] {
    return this.eventHistory.filter((e) => e.agentId === agentId);
  }

  /**
   * Get all recent events
   */
  getRecentEvents(limit: number = 50): TaskEvent[] {
    return this.eventHistory.slice(-limit);
  }

  /**
   * Get events within a time range
   */
  getEventsByTimeRange(startMs: number, endMs: number): TaskEvent[] {
    return this.eventHistory.filter(
      (e) => e.timestamp >= startMs && e.timestamp <= endMs
    );
  }

  /**
   * Get statistics
   */
  getStats() {
    const now = Date.now();
    const last1Hour = this.eventHistory.filter((e) => now - e.timestamp < 60 * 60 * 1000);
    const last24Hours = this.eventHistory.filter((e) => now - e.timestamp < 24 * 60 * 60 * 1000);

    const eventTypeCounts = new Map<EventType, number>();
    last24Hours.forEach((e) => {
      eventTypeCounts.set(e.type, (eventTypeCounts.get(e.type) || 0) + 1);
    });

    return {
      totalEvents: this.eventHistory.length,
      last1HourEvents: last1Hour.length,
      last24HourEvents: last24Hours.length,
      eventTypeCounts: Object.fromEntries(eventTypeCounts),
      oldestEvent: this.eventHistory.length > 0 ? this.eventHistory[0].timestamp : null,
      newestEvent: this.eventHistory.length > 0 ? this.eventHistory[this.eventHistory.length - 1].timestamp : null,
    };
  }

  /**
   * Clear event history
   */
  clearHistory(): void {
    this.eventHistory = [];
  }

  /**
   * Get number of listeners for an event type
   */
  listenerCount(eventType: EventType): number {
    return this.listeners.get(eventType)?.size || 0;
  }

  /**
   * Remove all listeners for an event type
   */
  removeAllListeners(eventType?: EventType): void {
    if (eventType) {
      this.listeners.set(eventType, new Set());
    } else {
      this.listeners.forEach((set) => set.clear());
    }
  }
}

// Export singleton
export const eventBus = new EventBus();
