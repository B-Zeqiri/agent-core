import { motion, AnimatePresence } from 'framer-motion';
import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import './custom-blur.css';

interface TaskHistoryItem {
  id: string;
  taskText: string; // input
  agent: string;
  involvedAgents?: string[];
  status: 'completed' | 'failed' | 'running' | 'pending' | 'in_progress' | 'cancelled';
  duration: number; // in ms
  resultPreview: string;
  fullResult?: string; // Full result for modal
  timestamp: number;
  manuallySelected?: boolean; // True if user manually selected the agent
  
  // New fields from TaskStore
  agentSelectionReason?: string;
  isRetry?: boolean;
  originalTaskId?: string;
  retryCount?: number;
  availableAgents?: string[];
  conversationId?: string; // Links related questions in same conversation
  multiAgentEnabled?: boolean;
}

const MAX_HISTORY_ITEMS = 50; // Increased from 20
const STORAGE_KEY = 'agent-core-task-history';
const SYNC_INTERVAL = 5000; // Sync with backend every 5 seconds

export function TaskHistory() {
  const [history, setHistory] = useState<TaskHistoryItem[]>([]);
  const [selectedTask, setSelectedTask] = useState<TaskHistoryItem | null>(null);
  const [modalConversation, setModalConversation] = useState<TaskHistoryItem[] | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [taskToDelete, setTaskToDelete] = useState<string | null>(null);
  const [showClearAllConfirm, setShowClearAllConfirm] = useState(false);
  const [showRetryConfirm, setShowRetryConfirm] = useState<string | null>(null);

  // Load history from backend on mount
  useEffect(() => {
    loadHistoryFromBackend();

    // Sync with backend periodically
    const interval = setInterval(loadHistoryFromBackend, SYNC_INTERVAL);

    // Listen for new task completions
    const handleTaskComplete = (event: CustomEvent<TaskHistoryItem>) => {
      addToHistory(event.detail);
      // Reload from backend to get full metadata
      setTimeout(loadHistoryFromBackend, 1000);
    };

    // Listen for task updates
    const handleTaskUpdate = (event: CustomEvent<{ taskId: string; updates: Partial<TaskHistoryItem> }>) => {
      const { taskId, updates } = event.detail;
      setHistory(prev => {
        const updated = prev.map(task => 
          task.id === taskId ? { ...task, ...updates } : task
        );
        return updated;
      });
    };

    window.addEventListener('taskComplete' as any, handleTaskComplete);
    window.addEventListener('taskUpdate' as any, handleTaskUpdate);
    
    return () => {
      clearInterval(interval);
      window.removeEventListener('taskComplete' as any, handleTaskComplete);
      window.removeEventListener('taskUpdate' as any, handleTaskUpdate);
    };
  }, []);

  // Load history from backend
  const loadHistoryFromBackend = async () => {
    try {
      const response = await fetch(`/api/history?limit=${MAX_HISTORY_ITEMS}&sortBy=startedAt&sortOrder=desc`);
      
      if (response.ok) {
        const data = await response.json();
        const backendTasks: TaskHistoryItem[] = data.tasks.map((task: any) => {
          // Extract clean output (just the answer, no metadata)
          let cleanOutput = task.output || task.error || 'No output';
          
          try {
            // If output is JSON string, parse and extract meaningful content
            const parsed = typeof cleanOutput === 'string' ? JSON.parse(cleanOutput) : cleanOutput;
            if (typeof parsed === 'object') {
              // Priority order for extracting answer
              cleanOutput = parsed.answer || parsed.result || parsed.output || 
                           parsed.content || parsed.message || parsed.text ||
                           JSON.stringify(parsed, null, 2);
            }
          } catch {
            // Not JSON, use as-is
          }
          
          // Clean escaped characters
          if (typeof cleanOutput === 'string') {
            cleanOutput = cleanOutput
              .replace(/\\n/g, '\n')
              .replace(/\\"/g, '"')
              .replace(/\\\\/g, '\\')
              .replace(/\\t/g, '\t');
          }
          
          return {
            id: task.id,
            taskText: task.input,
            agent: task.agent || 'Unknown',
            involvedAgents: Array.isArray(task.involvedAgents) ? task.involvedAgents : undefined,
            status: task.status,
            duration: task.durationMs || 0,
            resultPreview: cleanOutput.substring(0, 150) + (cleanOutput.length > 150 ? '...' : ''),
            fullResult: cleanOutput,
            timestamp: task.startedAt,
            manuallySelected: task.manuallySelected,
            agentSelectionReason: task.agentSelectionReason,
            isRetry: task.isRetry,
            originalTaskId: task.originalTaskId,
            retryCount: task.retryCount,
            availableAgents: task.availableAgents,
            conversationId: task.conversationId,
            multiAgentEnabled: task.multiAgentEnabled === true,
          };
        });

        const needsAgents = backendTasks
          .filter(
            (task) =>
              (task.status === 'pending' || task.status === 'in_progress' || task.status === 'running') &&
              (!task.involvedAgents || task.involvedAgents.length < 2)
          )
          .slice(0, 6);

        if (needsAgents.length > 0) {
          const enriched = await Promise.allSettled(
            needsAgents.map(async (task) => {
              const res = await fetch(`/api/task/${encodeURIComponent(task.id)}/details`);
              if (!res.ok) return null;
              const data = await res.json();
              const nodes = Array.isArray(data?.graph?.nodes) ? data.graph.nodes : [];
              const agents = Array.from(
                new Set(
                  nodes
                    .map((n: any) => String(n?.agentId || ''))
                    .filter((id: string) => id.length > 0)
                )
              );
              return agents.length > 1 ? { id: task.id, agents } : null;
            })
          );

          const byId = new Map<string, string[]>();
          enriched.forEach((result) => {
            if (result.status === 'fulfilled' && result.value) {
              byId.set(result.value.id, result.value.agents);
            }
          });

          const merged = backendTasks.map((task) => {
            const agents = byId.get(task.id);
            if (agents) {
              return { ...task, involvedAgents: agents };
            }
            return task;
          });

          setHistory(merged);
          localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
          return;
        }

        setHistory(backendTasks);

        // Also update localStorage as fallback
        localStorage.setItem(STORAGE_KEY, JSON.stringify(backendTasks));
      }
    } catch (error) {
      console.error('Failed to load history from backend:', error);
      // Fallback to localStorage
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        try {
          setHistory(JSON.parse(stored));
        } catch (e) {
          console.error('Failed to parse stored history:', e);
        }
      }
    } finally {
    }
  };

  // Retry a failed task
  const retryTask = async (taskId: string) => {
    try {
      const response = await fetch(`/api/history/${taskId}/retry`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      
      if (response.ok) {
        const data = await response.json();
        console.log(`Retry created: ${data.retryTaskId} for original: ${data.originalTaskId}`);
        
        // Reload history to show the retry
        setTimeout(loadHistoryFromBackend, 1000);
        
        // Close modal
        setSelectedTask(null);
        setModalConversation(null);
        setShowRetryConfirm(null);
      } else {
        console.error('Failed to create retry');
      }
    } catch (error) {
      console.error('Error retrying task:', error);
    }
  };

  // Close expanded task when clicking anywhere on the page
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      // Check if click is outside task items (allow clicking on task to toggle)
      if (!target.closest('.task-history-item')) {
        setSelectedTask(null);
      }
    };

    if (selectedTask) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
  }, [selectedTask]);

  const addToHistory = (item: TaskHistoryItem) => {
    setHistory(prev => {
      const newHistory = [item, ...prev].slice(0, MAX_HISTORY_ITEMS);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(newHistory));
      return newHistory;
    });
  };

  const clearHistory = async () => {
    try {
      // Delete all tasks from backend
      const response = await fetch('/api/history', {
        method: 'DELETE',
      });
      
      if (response.ok) {
        setHistory([]);
        localStorage.removeItem(STORAGE_KEY);
      } else {
        console.error('Failed to clear history from backend');
      }
    } catch (error) {
      console.error('Error clearing history:', error);
    }
  };

  const deleteTask = async (taskId: string) => {
    try {
      // Find the task to get its conversationId
      const taskToDelete = history.find(t => t.id === taskId);
      const conversationId = taskToDelete?.conversationId;
      
      // Delete from backend (will delete entire conversation if conversationId exists)
      const response = await fetch(`/api/task/${taskId}`, {
        method: 'DELETE',
      });
      
      if (response.ok) {
        setHistory(prev => {
          // If task has conversationId, remove all tasks with same conversationId
          const newHistory = conversationId
            ? prev.filter(item => item.conversationId !== conversationId)
            : prev.filter(item => item.id !== taskId);
          localStorage.setItem(STORAGE_KEY, JSON.stringify(newHistory));
          return newHistory;
        });
        
        // Clear selected task if it was deleted
        if (conversationId && selectedTask?.conversationId === conversationId) {
          setSelectedTask(null);
        } else if (selectedTask?.id === taskId) {
          setSelectedTask(null);
        }
        
        // Clear modal if conversation was deleted
        if (conversationId && modalConversation?.some(t => t.conversationId === conversationId)) {
          setModalConversation(null);
        } else if (modalConversation?.some(t => t.id === taskId)) {
          setModalConversation(null);
        }
      } else {
        console.error('Failed to delete task from backend');
      }
    } catch (error) {
      console.error('Error deleting task:', error);
    }
  };

  const formatDuration = (ms: number): string => {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60000).toFixed(1)}m`;
  };

  const formatTime = (timestamp: number): string => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays === 1) return 'Yesterday';
    return date.toLocaleDateString();
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return 'text-brand-success';
      case 'failed': return 'text-brand-error';
      case 'cancelled': return 'text-orange-400';
      case 'running': return 'text-brand-accent';
      default: return 'text-gray-400';
    }
  };

  const getStatusBg = (status: string) => {
    switch (status) {
      case 'completed': return 'bg-brand-success/10 border-brand-success/30';
      case 'failed': return 'bg-brand-error/10 border-brand-error/30';
      case 'cancelled': return 'bg-orange-500/10 border-orange-500/30';
      case 'running': return 'bg-brand-accent/10 border-brand-accent/30';
      default: return 'bg-gray-500/10 border-gray-500/30';
    }
  };

  // Content type detection (same as OutputWindow)
  const detectContentType = (content: string): 'code' | 'json' | 'error' | 'text' => {
    if (!content) return 'text';
    if (/error|failed|exception|traceback/i.test(content)) return 'error';
    try {
      JSON.parse(content);
      return 'json';
    } catch {}
    if (/function|const|let|var|class|import|export|=>|{|}|\(|\)|<\w+>|def\s+\w+|print\(/.test(content)) {
      return 'code';
    }
    return 'text';
  };

  const highlightCode = (code: string): string => {
    let highlighted = code.replace(/```[\w]*\n?|```/g, '');
    highlighted = highlighted.replace(/\b(function|const|let|var|if|else|return|class|import|export|from|async|await|try|catch|throw|new|this|super|extends|interface|type|enum|namespace|public|private|protected|static|readonly|def|print|for|while|break|continue)\b/g, '<span class="text-purple-400">$1</span>');
    highlighted = highlighted.replace(/(['"`])(.*?)\1/g, '<span class="text-green-400">$1$2$1</span>');
    highlighted = highlighted.replace(/\b(\d+\.?\d*)\b/g, '<span class="text-blue-400">$1</span>');
    highlighted = highlighted.replace(/(\/\/.*$|\/\*[\s\S]*?\*\/)/gm, '<span class="text-gray-500">$1</span>');
    return highlighted;
  };

  // Filter history based on search query
  const filteredHistory = searchQuery
    ? history.filter(item => 
        item.taskText.toLowerCase().includes(searchQuery.toLowerCase()) ||
        item.agent.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (item.involvedAgents || []).some(a => a.toLowerCase().includes(searchQuery.toLowerCase())) ||
        item.status.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : history;

  // Group tasks by conversation
  interface ConversationGroup {
    conversationId: string;
    tasks: TaskHistoryItem[];
    firstTask: TaskHistoryItem;
    latestTask: TaskHistoryItem;
  }

  const conversationGroups: ConversationGroup[] = [];
  const seenConversations = new Set<string>();

  filteredHistory.forEach(task => {
    const convId = task.conversationId || task.id; // Use task ID if no conversation ID
    
    if (!seenConversations.has(convId)) {
      const tasksInConversation = filteredHistory
        .filter(t => (t.conversationId || t.id) === convId)
        .sort((a, b) => a.timestamp - b.timestamp); // Sort by timestamp (oldest first)
      
      conversationGroups.push({
        conversationId: convId,
        tasks: tasksInConversation,
        firstTask: tasksInConversation[0],
        latestTask: tasksInConversation[tasksInConversation.length - 1],
      });
      
      seenConversations.add(convId);
    }
  });

  return (
    <div className="h-full flex flex-col bg-brand-panel/30 backdrop-blur-md border-l border-brand-border/30">
      {/* Header */}
      <div className="flex flex-col gap-2 p-4 border-b border-brand-border/30">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-brand-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <h2 className="text-sm font-bold text-white uppercase tracking-wide">Task History</h2>
            <span className="text-xs text-gray-400 font-mono">({history.length})</span>
          </div>
          {history.length > 0 && (
            <button
              onClick={() => setShowClearAllConfirm(true)}
              className="text-xs text-brand-error/70 hover:text-brand-error transition-colors"
            >
              Clear All
            </button>
          )}
        </div>
        {/* Search Field */}
        {history.length > 0 && (
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search tasks..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-3 py-2 text-xs bg-brand-dark/50 border border-brand-border/30 rounded text-white placeholder-gray-500 focus:outline-none focus:border-brand-accent/50 transition-colors"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white transition-colors"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        )}
      </div>

      {/* History List */}
      <div 
        className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-brand-accent/30 scrollbar-track-transparent"
        onClick={() => setSelectedTask(null)}
      >
        {filteredHistory.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-8">
            <svg className="w-16 h-16 text-gray-600 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            <p className="text-sm text-gray-400">{searchQuery ? 'No matching tasks' : 'No tasks yet'}</p>
            <p className="text-xs text-gray-500 mt-1">{searchQuery ? 'Try a different search term' : 'Your completed tasks will appear here'}</p>
          </div>
        ) : (
          <div className="p-3 space-y-2">
            <AnimatePresence>
              {conversationGroups.map((group, idx) => {
                const isMultiTurn = group.tasks.length > 1;
                const item = group.firstTask;
                const displayTask = group.latestTask;
                
                return (
                  <motion.div
                    key={group.conversationId}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20 }}
                    transition={{ delay: idx * 0.05 }}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedTask(selectedTask?.id === group.conversationId ? null : { ...item, id: group.conversationId });
                    }}
                    className={`task-history-item p-3 rounded-lg border transition-all cursor-pointer ${
                      selectedTask?.id === group.conversationId
                        ? 'bg-brand-accent/10 border-brand-accent/50 shadow-lg'
                        : 'bg-brand-dark/30 border-brand-border/20 hover:border-brand-accent/30 hover:bg-brand-dark/50'
                    }`}
                  >
                    {/* Task Header */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0 space-y-2">
                        {/* Task title */}
                        <h3 className="text-sm text-white leading-snug line-clamp-2 uppercase">
                          {item.taskText}
                        </h3>
                        
                        {/* Metadata row */}
                        <div className="flex items-center gap-3 flex-wrap">
                          {/* Timestamp */}
                          <span className="inline-flex items-center gap-1.5 text-xs text-gray-400">
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            {formatTime(item.timestamp)}
                          </span>
                          
                          {/* Agent badge */}
                          <span 
                            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold transition-all ${
                              item.manuallySelected 
                                ? 'bg-gradient-to-r from-orange-500/15 to-orange-600/15 text-orange-300 border border-orange-500/40 shadow-sm shadow-orange-500/20' 
                                : 'bg-gradient-to-r from-blue-500/15 to-cyan-500/15 text-cyan-300 border border-cyan-500/40 shadow-sm shadow-cyan-500/20'
                            }`}
                            title={item.manuallySelected ? 'Manually selected agent' : 'Auto-selected agent'}
                          >
                            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                            </svg>
                            {displayTask.agent}
                          </span>

                          {(displayTask.multiAgentEnabled || (displayTask.involvedAgents && displayTask.involvedAgents.length > 1)) && (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold tracking-wide bg-gradient-to-r from-amber-500/15 via-orange-500/10 to-rose-500/15 border border-amber-400/40 text-amber-200 shadow-sm shadow-amber-500/20">
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-300 animate-pulse" />
                              {displayTask.involvedAgents && displayTask.involvedAgents.length > 1
                                ? `+${displayTask.involvedAgents.length - 1} agents`
                                : 'multi-agent'}
                            </span>
                          )}
                          
                          {/* Conversation badge */}
                          {isMultiTurn && (
                            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-semibold bg-gradient-to-r from-purple-500/15 to-pink-500/15 text-purple-300 border border-purple-500/40 shadow-sm shadow-purple-500/20">
                              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8h2a2 2 0 012 2v6a2 2 0 01-2 2h-2v4l-4-4H9a1.994 1.994 0 01-1.414-.586m0 0L11 14h4a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2v4l.586-.586z" />
                              </svg>
                              {group.tasks.length} Q&A
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className={`flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold border ${getStatusBg(group.latestTask.status)}`}>
                          <div className={`w-1.5 h-1.5 rounded-full ${
                            group.latestTask.status === 'completed' ? 'bg-brand-success' :
                            group.latestTask.status === 'failed' ? 'bg-brand-error' :
                            group.latestTask.status === 'cancelled' ? 'bg-orange-400' :
                            'bg-brand-accent animate-pulse'
                          }`}></div>
                          <span className={getStatusColor(group.latestTask.status)}>
                            {group.latestTask.status}
                          </span>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setTaskToDelete(item.id);
                          }}
                          className="p-1 text-gray-400 hover:text-brand-error transition-colors rounded hover:bg-brand-error/10"
                          title="Delete task"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </div>

                    {/* Duration */}
                    <div className="flex items-center gap-1 text-xs text-gray-500">
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span>{formatDuration(item.duration)}</span>
                    </div>

                    {/* Expandable preview - shows all Q&A */}
                    <AnimatePresence>
                      {selectedTask?.id === group.conversationId && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: 'auto' }}
                          exit={{ opacity: 0, height: 0 }}
                          className="overflow-hidden"
                        >
                          <div className="mt-3 pt-3 border-t border-brand-border/20 space-y-3">
                            {group.tasks.map((task, taskIdx) => (
                              <div key={task.id} className="space-y-2">
                                {/* Question */}
                                <div className="flex items-start gap-2">
                                  <div className="flex-shrink-0 w-6 h-6 rounded-full bg-brand-accent/20 flex items-center justify-center">
                                    <span className="text-xs font-bold text-brand-accent">Q{taskIdx + 1}</span>
                                  </div>
                                  <div className="flex-1 text-xs text-gray-200 bg-brand-dark/30 p-2 rounded border border-brand-border/10">
                                    {task.taskText}
                                  </div>
                                </div>
                                
                                {/* Answer - Only show for single tasks, hide for multi-turn conversations */}
                                {task.fullResult && !isMultiTurn && (
                                  <div className="flex items-start gap-2 ml-8">
                                    <div className="flex-shrink-0 w-6 h-6 rounded-full bg-green-500/20 flex items-center justify-center">
                                      <span className="text-xs font-bold text-green-400">A{taskIdx + 1}</span>
                                    </div>
                                    <div className="flex-1 text-xs text-gray-300 font-mono bg-brand-dark/50 p-2 rounded border border-brand-border/20 max-h-32 overflow-y-auto scrollbar-thin scrollbar-thumb-brand-accent/20">
                                      {task.resultPreview}
                                    </div>
                                  </div>
                                )}
                              </div>
                            ))}
                            
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setModalConversation(group.tasks);
                              }}
                              className="mt-2 w-full px-3 py-1.5 text-xs font-semibold text-brand-accent border border-brand-accent/30 rounded hover:bg-brand-accent/10 transition-colors flex items-center justify-center gap-2"
                            >
                              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                              </svg>
                              View Full Conversation
                            </button>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* Clear All Confirmation Modal */}
      <AnimatePresence>
        {showClearAllConfirm && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowClearAllConfirm(false)}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200]"
            />
            
            {/* Confirmation Dialog */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="fixed inset-0 flex items-center justify-center z-[201] pointer-events-none"
            >
              <div className="bg-brand-panel border border-brand-border/50 rounded-xl shadow-2xl p-6 m-4 max-w-md w-full pointer-events-auto">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-12 h-12 rounded-full bg-brand-error/20 flex items-center justify-center">
                    <svg className="w-6 h-6 text-brand-error" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-white">Clear All Tasks</h3>
                    <p className="text-sm text-gray-400">This action cannot be undone</p>
                  </div>
                </div>
                
                <p className="text-sm text-gray-300 mb-6">
                  Are you sure you want to delete all, {history.length} task{history.length !== 1 ? 's' : ''} from your history?
                </p>
                
                <div className="flex gap-3">
                  <button
                    onClick={() => setShowClearAllConfirm(false)}
                    className="flex-1 px-4 py-2 bg-brand-dark/50 border border-brand-border/30 rounded-lg text-sm font-semibold text-white hover:bg-brand-dark/70 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      clearHistory();
                      setShowClearAllConfirm(false);
                    }}
                    className="flex-1 px-4 py-2 bg-brand-error border border-brand-error rounded-lg text-sm font-semibold text-white hover:bg-brand-error/80 transition-colors"
                  >
                    Clear All
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Delete Confirmation Modal */}
      <AnimatePresence>
        {taskToDelete && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setTaskToDelete(null)}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200]"
            />
            
            {/* Confirmation Dialog */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="fixed inset-0 flex items-center justify-center z-[201] pointer-events-none"
            >
              <div className="bg-brand-panel border border-brand-border/50 rounded-xl shadow-2xl p-6 m-4 max-w-md w-full pointer-events-auto">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-12 h-12 rounded-full bg-brand-error/20 flex items-center justify-center">
                    <svg className="w-6 h-6 text-brand-error" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-white">Delete Task</h3>
                    <p className="text-sm text-gray-400">This action cannot be undone</p>
                  </div>
                </div>
                
                <p className="text-sm text-gray-300 mb-6">
                  Are you sure you want to delete this task from your history?
                </p>
                
                <div className="flex gap-3">
                  <button
                    onClick={() => setTaskToDelete(null)}
                    className="flex-1 px-4 py-2 bg-brand-dark/50 border border-brand-border/30 rounded-lg text-sm font-semibold text-white hover:bg-brand-dark/70 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      deleteTask(taskToDelete);
                      setTaskToDelete(null);
                    }}
                    className="flex-1 px-4 py-2 bg-brand-error border border-brand-error rounded-lg text-sm font-semibold text-white hover:bg-brand-error/80 transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      {/* Modal for Full Result - Takes half of entire viewport */}
      {createPortal(
        <AnimatePresence>
          {modalConversation && (
            <>
              {/* Backdrop */}
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3, ease: "easeInOut" }}
                onClick={() => setModalConversation(null)}
                className="fixed inset-0 bg-black/5 backdrop-blur-[2px] z-[100]"
              />
              
              {/* Modal - Right 50% of Viewport */}
              <motion.div
                initial={{ opacity: 0, x: '100%' }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: '100%' }}
                transition={{ 
                  type: "spring", 
                  damping: 25, 
                  stiffness: 200,
                  duration: 0.3
                }}
                className="fixed right-0 top-0 h-screen w-[80vw] max-w-[80vw] min-w-[400px] z-[101]"
              >
              <div 
                className="relative bg-brand-panel border border-brand-border/30 shadow-2xl h-full overflow-hidden flex flex-col w-full"
                onClick={(e) => e.stopPropagation()}
              >
                {/* Modal Header */}
                <div className="flex items-start justify-between p-6 border-b border-brand-border/30 flex-shrink-0">
                  <div className="flex-1">
                    <h3 className="text-lg font-bold text-white mb-2">
                      {modalConversation.length > 1 
                        ? `Conversation (${modalConversation.length} messages)` 
                        : modalConversation[0].taskText}
                    </h3>
                    <div className="flex items-center gap-4 text-xs text-gray-400">
                      <div className="flex items-center gap-1">
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 3v2m6-2v2M9 19v2m6-2v2M5 9H3m2 6H3m18-6h-2m2 6h-2M7 19h10a2 2 0 002-2V7a2 2 0 00-2-2H7a2 2 0 00-2 2v10a2 2 0 002 2zM9 9h6v6H9V9z" />
                        </svg>
                        <span className={`font-mono ${modalConversation[0].manuallySelected ? 'text-orange-500' : 'text-brand-accent'}`}>
                          {modalConversation[0].agent}
                        </span>
                      </div>
                      {modalConversation.length > 1 && (
                        <div className="flex items-center gap-1 px-2 py-0.5 rounded bg-purple-500/20 text-purple-300 border border-purple-500/30">
                          <span className="text-xs font-bold">{modalConversation.length} Q&A</span>
                        </div>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => setModalConversation(null)}
                    className="ml-4 p-2 hover:bg-brand-accent/10 rounded-lg transition-colors"
                  >
                    <svg className="w-5 h-5 text-gray-400 hover:text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                {/* Modal Body with Smart Rendering */}
                <div className="flex-1 p-6 overflow-y-auto scrollbar-thin scrollbar-thumb-brand-accent/30 space-y-6">
                  {/* Show all Q&A pairs in the conversation */}
                  {modalConversation.map((task, idx) => (
                    <div key={task.id} className="space-y-4">
                      {/* Question */}
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <div className="flex-shrink-0 w-8 h-8 rounded-full bg-brand-accent/20 flex items-center justify-center">
                            <span className="text-sm font-bold text-brand-accent">Q{idx + 1}</span>
                          </div>
                          <div className="text-sm font-semibold text-white">{task.taskText}</div>
                        </div>
                        <div className="ml-10 flex items-center gap-3 text-xs text-gray-400">
                          <div className="flex items-center gap-1">
                            <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            <span>{formatDuration(task.duration)}</span>
                          </div>
                          <div className={`flex items-center gap-1 px-2 py-0.5 rounded border ${getStatusBg(task.status)}`}>
                            <div className={`w-1.5 h-1.5 rounded-full ${
                              task.status === 'completed' ? 'bg-brand-success' :
                              task.status === 'failed' ? 'bg-brand-error' :
                              task.status === 'cancelled' ? 'bg-orange-400' :
                              'bg-brand-accent'
                            }`}></div>
                            <span className={getStatusColor(task.status)}>{task.status}</span>
                          </div>
                          {task.agentSelectionReason && (
                            <div className="text-xs text-purple-400">Agent reasoning available</div>
                          )}
                        </div>
                      </div>

                      {/* Answer */}
                      {task.fullResult && (
                        <div className="ml-10 space-y-2">
                          <div className="flex items-center gap-2">
                            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center">
                              <span className="text-sm font-bold text-green-400">A{idx + 1}</span>
                            </div>
                            <div className="text-sm font-semibold text-green-400">Answer</div>
                          </div>
                          
                          {/* Render answer based on content type */}
                          {(() => {
                            const content = task.fullResult;
                            const contentType = detectContentType(content);

                            if (contentType === 'json') {
                              try {
                                const parsed = JSON.parse(content);
                                return (
                                  <div className="ml-10">
                                    <pre className="text-sm font-mono bg-brand-dark/50 p-4 rounded border border-brand-border/50 overflow-x-auto whitespace-pre-wrap">
                                      {JSON.stringify(parsed, null, 2)}
                                    </pre>
                                  </div>
                                );
                              } catch {
                                // Fallback to text
                              }
                            }

                            if (contentType === 'code') {
                              return (
                                <div className="ml-10">
                                  <pre 
                                    className="text-sm font-mono whitespace-pre-wrap break-words overflow-x-auto bg-brand-dark/50 p-4 rounded border border-brand-border/50 leading-relaxed"
                                    dangerouslySetInnerHTML={{ __html: highlightCode(content) }}
                                  />
                                </div>
                              );
                            }

                            // Only show error styling if task actually failed
                            if (task.status === 'failed') {
                              return (
                                <div className="ml-10">
                                  <div className="text-sm text-white font-mono whitespace-pre-wrap break-words overflow-x-auto bg-brand-error/10 p-4 rounded border border-brand-error/30 leading-relaxed">
                                    {content}
                                  </div>
                                </div>
                              );
                            }

                            return (
                              <div className="ml-10">
                                <div className="text-sm text-gray-300 whitespace-pre-wrap break-words leading-relaxed bg-brand-dark/30 p-4 rounded border border-brand-border/20">
                                  {content}
                                </div>
                              </div>
                            );
                          })()}
                        </div>
                      )}

                      {/* Agent Decision Reasoning (expandable) */}
                      {task.agentSelectionReason && (
                        <div className="ml-10 bg-brand-accent/5 border border-brand-accent/20 rounded-lg p-3">
                          <div className="flex items-center gap-2 mb-2">
                            <svg className="w-4 h-4 text-brand-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                            </svg>
                            <span className="text-xs font-semibold text-brand-accent">Agent Selection Reasoning</span>
                          </div>
                          <p className="text-xs text-gray-300">{task.agentSelectionReason}</p>
                          {task.availableAgents && task.availableAgents.length > 0 && (
                            <div className="mt-2 text-xs text-gray-400">
                              Available agents: {task.availableAgents.join(', ')}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Divider between Q&A pairs (except last one) */}
                      {idx < modalConversation.length - 1 && (
                        <div className="border-t border-brand-border/20 my-6"></div>
                      )}
                    </div>
                  ))}
                </div>

                {/* Modal Footer with Actions */}
                <div className="border-t border-brand-border/30 p-4 flex items-center justify-between flex-shrink-0">
                  <div className="text-xs text-gray-400">
                    Started: {formatTime(modalConversation[0].timestamp)}
                  </div>
                  <div className="flex gap-2">
                    {modalConversation[modalConversation.length - 1].status === 'failed' && (
                      <button
                        onClick={() => setShowRetryConfirm(modalConversation[modalConversation.length - 1].id)}
                        className="px-4 py-2 bg-brand-accent/10 border border-brand-accent text-brand-accent text-sm rounded-lg hover:bg-brand-accent hover:text-white transition-all flex items-center gap-2"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                        Retry Last Task
                      </button>
                    )}
                    <button
                      onClick={() => {
                        const allContent = modalConversation.map((t, i) => 
                          `Q${i + 1}: ${t.taskText}\n\nA${i + 1}: ${t.fullResult || t.resultPreview}\n\n`
                        ).join('---\n\n');
                        navigator.clipboard.writeText(allContent);
                      }}
                      className="px-4 py-2 bg-brand-dark/50 border border-brand-border text-gray-300 text-sm rounded-lg hover:bg-brand-dark hover:text-white transition-all flex items-center gap-2"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                      Copy All
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
            </>
          )}
        </AnimatePresence>,
        document.body
      )}

      {/* Retry Confirmation Modal */}
      <AnimatePresence>
        {showRetryConfirm && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowRetryConfirm(null)}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[300]"
            />
            
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="fixed inset-0 flex items-center justify-center z-[301] pointer-events-none"
            >
              <div className="bg-brand-panel border border-brand-border/50 rounded-xl shadow-2xl p-6 m-4 max-w-md w-full pointer-events-auto">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-12 h-12 rounded-full bg-brand-accent/20 flex items-center justify-center">
                    <svg className="w-6 h-6 text-brand-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="text-lg font-bold text-white">Retry Task</h3>
                    <p className="text-sm text-gray-400">Submit this task again</p>
                  </div>
                </div>
                
                <p className="text-sm text-gray-300 mb-6">
                  This will create a new task with the same input and agent. The retry will be linked to the original task for tracking.
                </p>
                
                <div className="flex gap-3">
                  <button
                    onClick={() => setShowRetryConfirm(null)}
                    className="flex-1 px-4 py-2 bg-brand-dark/50 border border-brand-border/30 rounded-lg text-sm font-semibold text-white hover:bg-brand-dark/70 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => {
                      retryTask(showRetryConfirm);
                      setShowRetryConfirm(null);
                    }}
                    className="flex-1 px-4 py-2 bg-brand-accent border border-brand-accent rounded-lg text-sm font-semibold text-white hover:bg-brand-accent/80 transition-colors flex items-center justify-center gap-2"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    Retry Now
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}

// Helper function to add task to history (call this from other components)
export function addTaskToHistory(item: Omit<TaskHistoryItem, 'id' | 'timestamp'>) {
  const taskItem: TaskHistoryItem = {
    id: `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    timestamp: Date.now(),
    ...item,
  };
  
  window.dispatchEvent(new CustomEvent('taskComplete', { detail: taskItem }));
  return taskItem.id; // Return the ID so it can be tracked
}

// Helper function to update an existing task in history
export function updateTaskInHistory(taskId: string, updates: Partial<Omit<TaskHistoryItem, 'id' | 'timestamp'>>) {
  window.dispatchEvent(new CustomEvent('taskUpdate', { detail: { taskId, updates } }));
}
