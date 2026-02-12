/**
 * TaskStore - Persistent storage for task history and agent decisions
 * 
 * Stores:
 * - Complete task history
 * - Agent decision reasoning
 * - Input/output relationships
 * - Retry chains
 */

import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';

export interface TaskRecord {
  id: string;
  input: string;
  output?: string;
  rawOutput?: string;
  agentResult?: any;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
  agent?: string;
  agentSelectionReason?: string; // Why this agent was chosen
  startedAt: number;
  completedAt?: number;
  durationMs?: number;
  error?: string;
  errorCode?: string;
  failedLayer?: string;
  stackTrace?: string;
  suggestions?: string[];
  
  // Retry tracking
  isRetry?: boolean;
  originalTaskId?: string; // Link to original task if this is a retry
  retryCount?: number;
  retries?: string[]; // IDs of retry attempts
  
  // Agent decision metadata
  availableAgents?: string[]; // Which agents were considered
  agentScores?: Record<string, number>; // Scoring for agent selection
  manuallySelected?: boolean; // True if user manually selected the agent
  involvedAgents?: string[]; // Agents that actually executed the task
  
  // Conversation tracking
  conversationId?: string; // Groups related tasks in same conversation
  
  // Extended metadata
  messages?: string[];
  progress?: number;
  tags?: string[];
  userId?: string; // Future: multi-user support

  // Generation config (Creative/Deterministic)
  generation?: import('../models/generation').GenerationConfig;

  // System mode (Assist, Power, Autonomous)
  systemMode?: 'assist' | 'power' | 'autonomous';

  // Multi-agent mode enabled for this task
  multiAgentEnabled?: boolean;
}

export interface TaskQuery {
  status?: string | string[];
  agent?: string;
  startDate?: number;
  endDate?: number;
  isRetry?: boolean;
  originalTaskId?: string;
  limit?: number;
  offset?: number;
  sortBy?: 'startedAt' | 'completedAt' | 'durationMs';
  sortOrder?: 'asc' | 'desc';
}

export class TaskStore {
  private dbPath: string;
  private tasks: Map<string, TaskRecord>;
  private saveDebounceTimer?: NodeJS.Timeout;
  private readonly DEBOUNCE_MS = 1000;

  constructor(dbPath: string = path.join(__dirname, '../../data/tasks.json')) {
    this.dbPath = dbPath;
    this.tasks = new Map();
    this.loadFromDisk();
  }

  /**
   * Load tasks from disk
   */
  private loadFromDisk(): void {
    try {
      // Ensure directory exists
      const dir = path.dirname(this.dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Load existing data
      if (fs.existsSync(this.dbPath)) {
        const data = fs.readFileSync(this.dbPath, 'utf-8');
        const tasks: TaskRecord[] = JSON.parse(data);
        const now = Date.now();
        let changed = 0;

        tasks.forEach(task => {
          if (task.status === 'pending' || task.status === 'in_progress') {
            task.status = 'failed';
            task.error = task.error || 'Task failed after server restart';
            task.completedAt = task.completedAt || now;
            task.durationMs = task.durationMs || (task.startedAt ? task.completedAt - task.startedAt : undefined);
            changed += 1;
          }
          this.tasks.set(task.id, task);
        });

        if (changed > 0) {
          this.saveToDisk();
        }
        console.log(`✓ Loaded ${tasks.length} tasks from disk`);
      } else {
        // Create empty file
        this.saveToDisk();
      }
    } catch (error) {
      console.error('Error loading tasks from disk:', error);
      // Start with empty store if load fails
      this.tasks = new Map();
    }
  }

  /**
   * Save tasks to disk (debounced)
   */
  private saveToDisk(): void {
    if (this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer);
    }

    this.saveDebounceTimer = setTimeout(() => {
      try {
        const tasks = Array.from(this.tasks.values());
        fs.writeFileSync(this.dbPath, JSON.stringify(tasks, null, 2), 'utf-8');
      } catch (error) {
        console.error('Error saving tasks to disk:', error);
      }
    }, this.DEBOUNCE_MS);
  }

  /**
   * Create a new task record
   */
  createTask(input: string, metadata?: Partial<TaskRecord>): TaskRecord {
    const task: TaskRecord = {
      id: uuidv4(),
      input,
      status: 'pending',
      startedAt: Date.now(),
      ...metadata,
    };

    this.tasks.set(task.id, task);
    this.saveToDisk();
    return task;
  }

  /**
   * Update an existing task
   */
  updateTask(taskId: string, updates: Partial<TaskRecord>): TaskRecord | null {
    const task = this.tasks.get(taskId);
    if (!task) return null;

    const updated = { ...task, ...updates };
    
    // Auto-calculate duration if completing
    if (updates.status === 'completed' || updates.status === 'failed') {
      if (!updated.completedAt) {
        updated.completedAt = Date.now();
      }
      if (!updated.durationMs) {
        updated.durationMs = updated.completedAt - updated.startedAt;
      }
    }

    this.tasks.set(taskId, updated);
    this.saveToDisk();
    return updated;
  }

  /**
   * Rekey a task ID while preserving history references.
   */
  rekeyTask(oldTaskId: string, newTaskId: string): TaskRecord | null {
    if (oldTaskId === newTaskId) return this.tasks.get(oldTaskId) || null;
    const task = this.tasks.get(oldTaskId);
    if (!task) return null;
    if (this.tasks.has(newTaskId)) return null;

    const updated = { ...task, id: newTaskId };
    this.tasks.delete(oldTaskId);
    this.tasks.set(newTaskId, updated);

    for (const record of this.tasks.values()) {
      let changed = false;

      if (Array.isArray(record.retries) && record.retries.includes(oldTaskId)) {
        record.retries = record.retries.map((retryId) => (retryId === oldTaskId ? newTaskId : retryId));
        changed = true;
      }

      if (record.originalTaskId === oldTaskId) {
        record.originalTaskId = newTaskId;
        changed = true;
      }

      if (changed) {
        this.tasks.set(record.id, { ...record });
      }
    }

    this.saveToDisk();
    return updated;
  }

  /**
   * Get task by ID
   */
  getTask(taskId: string): TaskRecord | null {
    return this.tasks.get(taskId) || null;
  }

  /**
   * Create a retry task linked to original
   */
  createRetry(originalTaskId: string, input?: string): TaskRecord | null {
    const originalTask = this.tasks.get(originalTaskId);
    if (!originalTask) return null;

    const retryCount = (originalTask.retryCount || 0) + 1;
    
    // Create retry task
    const retryTask = this.createTask(input || originalTask.input, {
      isRetry: true,
      originalTaskId,
      retryCount,
      agent: originalTask.agent, // Suggest same agent
      tags: ['retry', ...(originalTask.tags || [])],
    });

    // Update original task to track retry
    const retries = originalTask.retries || [];
    retries.push(retryTask.id);
    this.updateTask(originalTaskId, { retries, retryCount });

    return retryTask;
  }

  /**
   * Get retry chain for a task
   */
  getRetryChain(taskId: string): TaskRecord[] {
    const task = this.tasks.get(taskId);
    if (!task) return [];

    const chain: TaskRecord[] = [task];

    // Get original task if this is a retry
    if (task.originalTaskId) {
      const original = this.tasks.get(task.originalTaskId);
      if (original) {
        chain.unshift(original);
      }
    }

    // Get all retries if this is original
    if (task.retries && task.retries.length > 0) {
      task.retries.forEach(retryId => {
        const retry = this.tasks.get(retryId);
        if (retry) {
          chain.push(retry);
        }
      });
    }

    return chain;
  }

  /**
   * Query tasks with filters
   */
  query(filters?: TaskQuery): TaskRecord[] {
    let results = Array.from(this.tasks.values());

    if (!filters) return results;

    // Filter by status
    if (filters.status) {
      const statuses = Array.isArray(filters.status) ? filters.status : [filters.status];
      results = results.filter(t => statuses.includes(t.status));
    }

    // Filter by agent
    if (filters.agent) {
      results = results.filter(t => t.agent === filters.agent);
    }

    // Filter by date range
    if (filters.startDate) {
      results = results.filter(t => t.startedAt >= filters.startDate!);
    }
    if (filters.endDate) {
      results = results.filter(t => t.startedAt <= filters.endDate!);
    }

    // Filter by retry status
    if (filters.isRetry !== undefined) {
      results = results.filter(t => t.isRetry === filters.isRetry);
    }

    // Filter by original task
    if (filters.originalTaskId) {
      results = results.filter(t => t.originalTaskId === filters.originalTaskId);
    }

    // Sort
    const sortBy = filters.sortBy || 'startedAt';
    const sortOrder = filters.sortOrder || 'desc';
    results.sort((a, b) => {
      const aVal = a[sortBy] || 0;
      const bVal = b[sortBy] || 0;
      return sortOrder === 'asc' ? aVal - bVal : bVal - aVal;
    });

    // Pagination
    const offset = filters.offset || 0;
    const limit = filters.limit || results.length;
    results = results.slice(offset, offset + limit);

    return results;
  }

  /**
   * Get statistics
   */
  getStats(): {
    total: number;
    byStatus: Record<string, number>;
    byAgent: Record<string, number>;
    avgDuration: number;
    successRate: number;
    retryRate: number;
  } {
    const tasks = Array.from(this.tasks.values());
    const total = tasks.length;

    const byStatus: Record<string, number> = {};
    const byAgent: Record<string, number> = {};
    let totalDuration = 0;
    let completedCount = 0;
    let retryCount = 0;

    tasks.forEach(task => {
      // Count by status
      byStatus[task.status] = (byStatus[task.status] || 0) + 1;

      // Count by agent
      if (task.agent) {
        byAgent[task.agent] = (byAgent[task.agent] || 0) + 1;
      }

      // Calculate average duration
      if (task.durationMs) {
        totalDuration += task.durationMs;
        completedCount++;
      }

      // Count retries
      if (task.isRetry) {
        retryCount++;
      }
    });

    const avgDuration = completedCount > 0 ? totalDuration / completedCount : 0;
    const successRate = total > 0 ? (byStatus['completed'] || 0) / total : 0;
    const retryRate = total > 0 ? retryCount / total : 0;

    return {
      total,
      byStatus,
      byAgent,
      avgDuration,
      successRate,
      retryRate,
    };
  }

  /**
   * Delete old tasks (cleanup)
   */
  deleteOlderThan(daysOld: number): number {
    const cutoffDate = Date.now() - (daysOld * 24 * 60 * 60 * 1000);
    let deletedCount = 0;

    this.tasks.forEach((task, id) => {
      if (task.startedAt < cutoffDate) {
        this.tasks.delete(id);
        deletedCount++;
      }
    });

    if (deletedCount > 0) {
      this.saveToDisk();
    }

    return deletedCount;
  }

  /**
   * Clear all tasks (use with caution!)
   */
  clear(): void {
    this.tasks.clear();
    this.saveToDisk();
  }

  /**
   * Clear all tasks and return count
   */
  clearAll(): number {
    const count = this.tasks.size;
    this.tasks.clear();
    this.saveToDisk();
    return count;
  }

  /**
   * Delete a specific task by ID
   */
  deleteTask(taskId: string): boolean {
    const existed = this.tasks.has(taskId);
    if (existed) {
      this.tasks.delete(taskId);
      this.saveToDisk();
    }
    return existed;
  }

  /**
   * Delete all tasks in a conversation by conversationId
   */
  deleteByConversationId(conversationId: string): number {
    let deletedCount = 0;
    const tasksToDelete: string[] = [];
    
    // Find all tasks with this conversationId
    for (const [taskId, task] of this.tasks.entries()) {
      if (task.conversationId === conversationId) {
        tasksToDelete.push(taskId);
      }
    }
    
    // Delete all found tasks
    for (const taskId of tasksToDelete) {
      this.tasks.delete(taskId);
      deletedCount++;
    }
    
    if (deletedCount > 0) {
      this.saveToDisk();
    }
    
    return deletedCount;
  }

  /**
   * Force immediate save to disk
   */
  flush(): void {
    if (this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer);
    }
    const tasks = Array.from(this.tasks.values());
    fs.writeFileSync(this.dbPath, JSON.stringify(tasks, null, 2), 'utf-8');
  }
}

// Singleton instance
export const taskStore = new TaskStore();
