import React, { useEffect } from 'react';
import { motion, AnimatePresence, useMotionValue, useSpring, useTransform } from 'framer-motion';
import { UIState, Task, TimelineEvent, GenerationConfig } from '../App';
import TaskInput from './TaskInput';
import TaskTimeline from './TaskTimeline';
import OutputWindow from './OutputWindow';
import { TaskHistory } from './TaskHistory';
import FailurePanel, { FailureDetails } from './FailurePanel';
import { ExplainabilityData } from './ExplainabilityPanel';

interface MainWorkspaceProps {
  uiState: UIState;
  currentTask: Task | null;
  onStateChange: (state: UIState) => void;
  onTaskChange: (task: Task | null) => void;
  onTimelineUpdate: (events: TimelineEvent[]) => void;
  onActiveAgentsChange?: (agents: string[]) => void;
}

function MainWorkspace({
  uiState,
  currentTask,
  onStateChange,
  onTaskChange,
  onTimelineUpdate,
  onActiveAgentsChange,
}: MainWorkspaceProps) {
  // Progress bar motion value

  const progressMotion = useMotionValue(0);
  const progressSpring = useSpring(progressMotion, { stiffness: 200, damping: 30 });
  const progressWidth = useTransform(progressSpring, v => `${v}%`);

  useEffect(() => {
    if (currentTask && typeof currentTask.progress === 'number') {
      progressMotion.set(Math.round(currentTask.progress));
    } else {
      progressMotion.set(0);
    }
  }, [currentTask && currentTask.progress]);
  const [conversationHistory, setConversationHistory] = React.useState<Array<{
    input: string;
    output: string;
    timestamp: number;
  }>>([]);

  const [generationConfig, setGenerationConfig] = React.useState<GenerationConfig>({
    mode: 'creative',
  });
  const autoMultiAgentPayload = React.useMemo(
    () => ({
      enabled: true,
      mode: 'auto',
      planner: 'rule',
      failurePolicy: { defaultAction: 'continue', retries: 0 },
    }),
    []
  );

  const currentTaskRef = React.useRef<Task | null>(null);
  const conversationHistoryRef = React.useRef(conversationHistory);

  useEffect(() => {
    currentTaskRef.current = currentTask;
  }, [currentTask]);

  useEffect(() => {
    conversationHistoryRef.current = conversationHistory;
  }, [conversationHistory]);
  const [failureDetails, setFailureDetails] = React.useState<FailureDetails | null>(null);
  const [isServerConnected, setIsServerConnected] = React.useState(true);
  const [lastConnectionCheck, setLastConnectionCheck] = React.useState<number>(Date.now());
  const [conversationId, setConversationId] = React.useState<string | null>(null);
  const conversationIdRef = React.useRef<string | null>(null);
  const [isEditingTask, setIsEditingTask] = React.useState(false);
  const [editedTaskInput, setEditedTaskInput] = React.useState('');
  const [explainability, setExplainability] = React.useState<ExplainabilityData | null>(null);
  const explainabilityAgentIdRef = React.useRef<string | null>(null);
  const [activePollInterval, setActivePollInterval] = React.useState<NodeJS.Timeout | null>(null);
  const activePollIntervalRef = React.useRef<NodeJS.Timeout | null>(null);
  const activeEventSourceRef = React.useRef<EventSource | null>(null);
  const activeTaskIdRef = React.useRef<string | null>(null);
  const runSeqRef = React.useRef(0);
  const suppressCancelPlaceholderRef = React.useRef(false);

  const showConversationDebug =
    String((import.meta as any).env?.VITE_DEBUG_CONVERSATION_ID || '').toLowerCase() === 'true' ||
    String((import.meta as any).env?.VITE_DEBUG_CONVERSATION_ID || '') === '1';

  const normalizeDisplayText = React.useCallback((raw: any): string => {
    if (raw == null) return '';
    if (typeof raw === 'string') {
      const text = raw;
      try {
        const parsed = JSON.parse(text);
        if (parsed && typeof parsed === 'object') {
          const extracted =
            (parsed as any).answer ||
            (parsed as any).result ||
            (parsed as any).output ||
            (parsed as any).message ||
            (parsed as any).text;
          return typeof extracted === 'string' ? extracted : JSON.stringify(extracted ?? parsed, null, 2);
        }
      } catch {
        // not JSON
      }
      return text
        .replace(/\\n/g, '\n')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\')
        .replace(/\\t/g, '\t');
    }
    if (typeof raw === 'object') {
      const obj: any = raw;
      const extracted = obj.answer || obj.result || obj.output || obj.message || obj.text;
      if (typeof extracted === 'string') return extracted;
      return JSON.stringify(extracted ?? obj, null, 2);
    }
    return String(raw);
  }, []);

  React.useEffect(() => {
    if (!onActiveAgentsChange) return;

    const id = currentTask?.id;
    const isActive =
      currentTask?.status === 'pending' ||
      currentTask?.status === 'in_progress' ||
      currentTask?.status === 'queued' ||
      uiState === 'submitting';

    if (!id || String(id).includes('pending') || !isActive) {
      onActiveAgentsChange([]);
      return;
    }

    let cancelled = false;

    const load = async () => {
      try {
        const res = await fetch(`/api/task/${encodeURIComponent(id)}/details`);
        if (!res.ok) return;
        const data: any = await res.json();
        if (cancelled || !data?.ok) return;

        const nodes = Array.isArray(data?.graph?.nodes) ? data.graph.nodes : [];
        const running = nodes
          .filter((n: any) => n?.status === 'running')
          .map((n: any) => String(n.agentId || ''))
          .filter(Boolean);

        if (running.length > 0) {
          onActiveAgentsChange(Array.from(new Set(running)));
        } else {
          const isRunning =
            data?.status === 'running' ||
            currentTask?.status === 'in_progress' ||
            currentTask?.status === 'running';
          const fallbackAgent =
            (typeof data?.agentId === 'string' && data.agentId) ||
            (typeof data?.agentName === 'string' && data.agentName) ||
            (typeof currentTask?.agent === 'string' && currentTask.agent) ||
            '';
          onActiveAgentsChange(isRunning && fallbackAgent ? [fallbackAgent] : []);
        }
      } catch {
        // ignore
      }
    };

    load();
    const t = setInterval(load, 1200);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [currentTask?.id, currentTask?.status, uiState, onActiveAgentsChange]);

  useEffect(() => {
    conversationIdRef.current = conversationId;
  }, [conversationId]);

  // Keep conversationId synced to backend TaskStore for the active task.
  // This prevents Continue from losing context due to client-side state races.
  React.useEffect(() => {
    const id = currentTask?.id;
    if (!id || String(id).includes('pending')) return;

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/history/${encodeURIComponent(id)}`);
        if (!res.ok) return;
        const record: any = await res.json();
        const conv =
          record && typeof record.conversationId === 'string' && record.conversationId
            ? record.conversationId
            : id;

        if (!cancelled && conv && conversationIdRef.current !== conv) {
          setConversationId(conv);
        }
      } catch {
        // ignore
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [currentTask?.id]);

  // Cleanup polling on unmount
  React.useEffect(() => {
    return () => {
      if (activePollIntervalRef.current) {
        clearInterval(activePollIntervalRef.current);
        activePollIntervalRef.current = null;
      }
      if (activeEventSourceRef.current) {
        activeEventSourceRef.current.close();
        activeEventSourceRef.current = null;
      }
    };
  }, []);

  const taskTypeLabelFromTags = React.useCallback((tags?: unknown): string | undefined => {
    if (!Array.isArray(tags)) return undefined;
    const first = tags.find(t => typeof t === 'string') as string | undefined;
    if (!first) return undefined;
    switch (first) {
      case 'web-dev':
        return 'Web Development';
      case 'research':
        return 'Research';
      case 'system':
        return 'System';
      default:
        return first;
    }
  }, []);

  // Fetch explainability details for the currently visible task.
  // Uses TaskStore history (reason + candidate agents) + per-agent success rate + scheduler load.
  React.useEffect(() => {
    const id = currentTask?.id;
    if (!id || id.includes('pending')) {
      setExplainability(null);
      explainabilityAgentIdRef.current = null;
      return;
    }

    let cancelled = false;

    const load = async () => {
      try {
        const historyRes = await fetch(`/api/history/${id}`);
        if (!historyRes.ok) return;
        const record: any = await historyRes.json();
        if (cancelled) return;

        const agentId = typeof record.agent === 'string' ? record.agent : undefined;
        explainabilityAgentIdRef.current = agentId || null;

        const base: ExplainabilityData = {
          taskTypeLabel: taskTypeLabelFromTags(record.tags),
          schedulerLabel: 'Kernel Scheduler v0.1',
          agentId,
          agentName: currentTask?.agent,
          manuallySelected: record.manuallySelected === true,
          agentSelectionReason:
            typeof record.agentSelectionReason === 'string' ? record.agentSelectionReason : undefined,
          availableAgents: Array.isArray(record.availableAgents) ? record.availableAgents : undefined,
        };

        setExplainability(base);

        if (agentId) {
          const statsRes = await fetch(`/api/history/agent/${encodeURIComponent(agentId)}/stats`);
          if (statsRes.ok) {
            const stats: any = await statsRes.json();
            if (!cancelled) {
              setExplainability(prev => ({
                ...(prev || base),
                successRatePercent:
                  typeof stats.successRatePercent === 'number' ? stats.successRatePercent : prev?.successRatePercent,
              }));
            }
          }
        }

        const schedRes = await fetch('/api/scheduler/status');
        if (schedRes.ok) {
          const sched: any = await schedRes.json();
          const slot =
            agentId && Array.isArray(sched?.agents)
              ? sched.agents.find((a: any) => a?.agentId === agentId)
              : null;
          const loadScore = typeof slot?.loadScore === 'number' ? slot.loadScore : undefined;
          if (!cancelled && loadScore != null) {
            setExplainability(prev => ({ ...(prev || base), loadScore }));
          }
        }
      } catch {
        // ignore explainability fetch errors
      }
    };

    load();

    return () => {
      cancelled = true;
    };
  }, [currentTask?.id, currentTask?.agent, taskTypeLabelFromTags]);

  // Keep load reasonably fresh while a task is active (light polling, no heavy history re-fetch).
  React.useEffect(() => {
    const agentId = explainabilityAgentIdRef.current;
    const isActive = currentTask?.status === 'pending' || currentTask?.status === 'in_progress';
    if (!agentId || !isActive) return;

    let cancelled = false;
    const t = setInterval(async () => {
      try {
        const res = await fetch('/api/scheduler/status');
        if (!res.ok) return;
        const sched: any = await res.json();
        const slot = Array.isArray(sched?.agents)
          ? sched.agents.find((a: any) => a?.agentId === agentId)
          : null;
        const loadScore = typeof slot?.loadScore === 'number' ? slot.loadScore : undefined;
        if (!cancelled && loadScore != null) {
          setExplainability(prev => (prev ? { ...prev, loadScore } : prev));
        }
      } catch {
        // ignore
      }
    }, 1500);

    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [currentTask?.status]);

  const stopActiveUpdates = React.useCallback(() => {
    activeTaskIdRef.current = null;

    if (activePollIntervalRef.current) {
      clearInterval(activePollIntervalRef.current);
      activePollIntervalRef.current = null;
    }
    if (activePollInterval) {
      clearInterval(activePollInterval);
      setActivePollInterval(null);
    }
    if (activeEventSourceRef.current) {
      activeEventSourceRef.current.close();
      activeEventSourceRef.current = null;
    }
  }, [activePollInterval]);

  // Check server connection
  React.useEffect(() => {
    const checkConnection = async () => {
      try {
        const res = await fetch('/api/status', { method: 'GET' });
        setIsServerConnected(res.ok);
        setLastConnectionCheck(Date.now());
      } catch (error) {
        setIsServerConnected(false);
        setLastConnectionCheck(Date.now());
      }
    };

    // Check immediately
    checkConnection();

    // Check every 3 seconds
    const interval = setInterval(checkConnection, 3000);

    return () => clearInterval(interval);
  }, []);

  const resetToNewTask = () => {
    // Clear any active polling
    if (activePollInterval) {
      clearInterval(activePollInterval);
      setActivePollInterval(null);
    }
    onStateChange('idle');
    onTaskChange(null);
    onTimelineUpdate([]);
    setConversationHistory([]);
    setFailureDetails(null);
    setConversationId(null);
  };



  const continueTask = async (followUpText: string) => {
    if (!currentTask) return;

    // Add previous result to conversation history if not already there.
    // IMPORTANT: do it in a single state update (avoid batched update race).
    if (currentTask.output && conversationHistory.length === 0) {
      let cleanOutput = '';
      if (typeof currentTask.output === 'string') {
        try {
          const parsed = JSON.parse(currentTask.output);
          cleanOutput = parsed.result || parsed.output || parsed.message || currentTask.output;
        } catch {
          cleanOutput = currentTask.output;
        }
      } else if (currentTask.output && typeof currentTask.output === 'object') {
        const outputObj = currentTask.output as any;
        cleanOutput = outputObj.result || outputObj.output || outputObj.message || JSON.stringify(currentTask.output, null, 2);
      } else {
        cleanOutput = String(currentTask.output);
      }
      
      // Clean escaped characters
      cleanOutput = cleanOutput
        .replace(/\\n/g, '\n')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\')
        .replace(/\\t/g, '\t');
      
      // Add BOTH initial task and new question in ONE setState call to avoid race conditions
      setConversationHistory([
        {
          input: currentTask.input,
          output: cleanOutput.trim(),
          timestamp: currentTask.startedAt,
        },
        {
          input: followUpText,
          output: '', // Empty until response comes back
          timestamp: Date.now(),
        }
      ]);
    } else {
      // Already have conversation history, just add the new question
      setConversationHistory(prev => {
        return [...prev, {
          input: followUpText,
          output: '', // Empty until response comes back
          timestamp: Date.now(),
        }];
      });
    }

    // Use same state transitions as initial task
    const effectiveGeneration: GenerationConfig =
      generationConfig.mode === 'deterministic' ? { ...generationConfig, temperature: 0 } : { mode: 'creative' };

    onStateChange('submitting');
    onTaskChange({
      id: 'pending...',
      status: 'submitting',
      agent: currentTask.agent,
      input: followUpText,
      progress: 0,
      messages: [],
      generation: effectiveGeneration,
      startedAt: Date.now(),
    });

    try {
      // Resolve canonical conversation id from backend to avoid client-side state races.
      let effectiveConversationId = conversationIdRef.current || conversationId;
      if (!effectiveConversationId) {
        try {
          const histRes = await fetch(`/api/history/${encodeURIComponent(currentTask.id)}`);
          if (histRes.ok) {
            const record: any = await histRes.json();
            if (record && typeof record.conversationId === 'string' && record.conversationId) {
              effectiveConversationId = record.conversationId;
            }
          }
        } catch {
          // ignore
        }
      }
      effectiveConversationId = effectiveConversationId || currentTask.id;

      const res = await fetch('/task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          input: followUpText,
          conversationId: effectiveConversationId,
          generation: effectiveGeneration,
          multiAgent: autoMultiAgentPayload,
        }),
      });

      if (!res.ok) throw new Error('Failed to submit continuation');

      const { taskId } = await res.json();

      onTaskChange({
        id: taskId,
        status: 'queued',
        agent: currentTask.agent,
        input: followUpText,
        progress: 0,
        messages: [],
        generation: effectiveGeneration,
        startedAt: Date.now(),
      });

      onStateChange('queued');

      // Start live updates (SSE preferred; polling fallback)
      startTaskUpdates(taskId);
    } catch (err) {
      console.error('Continue task error:', err);
      onStateChange('failed');
    }
  };

  const applyTaskSnapshot = React.useCallback(
    (task: any, taskId: string, stop: () => void) => {
      const latestTask = currentTaskRef.current;

      const cancelledMessage = 'Task was cancelled by user';
      const shouldSuppressCancelledPlaceholder =
        suppressCancelPlaceholderRef.current &&
        (task.status === 'pending' || task.status === 'in_progress' || task.status === 'queued') &&
        (task.result === cancelledMessage || task.reason === cancelledMessage || task.error === cancelledMessage);

      const normalizedOutput = shouldSuppressCancelledPlaceholder ? '' : normalizeDisplayText(task.result);
      const normalizedError = shouldSuppressCancelledPlaceholder
        ? ''
        : normalizeDisplayText(task.reason || task.error);

      // Single canonical update for current task
      onTaskChange({
        id: task.task_id || taskId,
        status: task.status,
        agent: task.agent || latestTask?.agent || '',
        input: task.input || latestTask?.input || '',
        progress: task.progress || 0,
        messages: task.messages || [],
        generation: task.generation || latestTask?.generation,
        output: normalizedOutput || undefined,
        error: normalizedError || undefined,
        startedAt: task.startedAt || latestTask?.startedAt || Date.now(),
        durationMs: task.durationMs,
      });

      const timelineEvents: TimelineEvent[] = [
        { layer: 'API Gateway', status: 'done', timestamp: Date.now() },
        { layer: 'Task Registry', status: 'done', timestamp: Date.now() },
      ];

      if (task.status === 'pending' || task.status === 'in_progress' || task.status === 'completed') {
        timelineEvents.push({
          layer: 'Orchestrator',
          status: task.status === 'completed' ? 'done' : 'active',
          timestamp: Date.now(),
        });
        timelineEvents.push({
          layer: 'Scheduler',
          status: task.status === 'completed' ? 'done' : 'active',
          timestamp: Date.now(),
        });
      }

      if (task.status === 'in_progress' || task.status === 'completed') {
        timelineEvents.push({
          layer: 'Agent Runtime',
          status: task.status === 'completed' ? 'done' : 'active',
          timestamp: Date.now(),
        });
        timelineEvents.push({
          layer: 'Model Adapter',
          status: task.status === 'completed' ? 'done' : 'active',
          timestamp: Date.now(),
        });
      }

      if (task.status === 'completed') {
        suppressCancelPlaceholderRef.current = false;
        timelineEvents.push({ layer: 'Result Store', status: 'done', timestamp: Date.now() });
        timelineEvents.push({ layer: 'Event Stream', status: 'done', timestamp: Date.now() });
        timelineEvents.push({ layer: 'Cleanup', status: 'done', timestamp: Date.now() });

        const cleanOutput = normalizedOutput;
        setConversationHistory(prev => {
          if (prev.length === 0) return prev;
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (!last.output) {
            updated[updated.length - 1] = { ...last, output: cleanOutput.trim() };
          }
          return updated;
        });

        onStateChange('completed');
        stop();
      } else if (task.status === 'failed') {
        suppressCancelPlaceholderRef.current = false;
        setFailureDetails({
          layer: task.failedLayer || 'Agent Runtime',
          error: normalizedError || 'Task execution failed',
          errorCode: task.errorCode,
          timestamp: Date.now(),
          stackTrace: task.stackTrace,
          suggestions: task.suggestions,
        });

        onStateChange('failed');
        stop();
      } else if (task.status === 'cancelled') {
        suppressCancelPlaceholderRef.current = false;
        setFailureDetails(null);
        onStateChange('completed');
        stop();
      }

      onTimelineUpdate(timelineEvents);

      if (task.status === 'in_progress') {
        onStateChange('running');
      }
    },
    [normalizeDisplayText, onStateChange, onTaskChange, onTimelineUpdate]
  );

  const pollTask = (taskId: string) => {
    stopActiveUpdates();
    activeTaskIdRef.current = taskId;

    const pollInterval = setInterval(async () => {
      try {
        // If this poller is no longer the active one (including cancel/retry setting activeTaskIdRef to null), stop.
        if (activeTaskIdRef.current !== taskId) {
          clearInterval(pollInterval);
          return;
        }

        const res = await fetch(`/api/task/${taskId}/status`);
        if (!res.ok) throw new Error('Task not found');

        const task = await res.json();
        applyTaskSnapshot(task, taskId, () => {
          clearInterval(pollInterval);
          activePollIntervalRef.current = null;
          setActivePollInterval(null);
        });
      } catch (err) {
        console.error('Poll error:', err);
        clearInterval(pollInterval);
        activePollIntervalRef.current = null;
        setActivePollInterval(null);
      }
    }, 800);

    activePollIntervalRef.current = pollInterval;
    setActivePollInterval(pollInterval);
  };

  const startTaskUpdates = React.useCallback(
    (taskId: string) => {
      stopActiveUpdates();
      activeTaskIdRef.current = taskId;

      try {
        const es = new EventSource(`/api/task/${taskId}/stream`);
        activeEventSourceRef.current = es;

        es.addEventListener('task', (evt: MessageEvent) => {
          if (activeTaskIdRef.current !== taskId) return;
          try {
            const payload = JSON.parse(String(evt.data));
            applyTaskSnapshot(payload, taskId, () => {
              if (activeEventSourceRef.current) {
                activeEventSourceRef.current.close();
                activeEventSourceRef.current = null;
              }
            });
          } catch (e) {
            console.error('Stream parse error:', e);
          }
        });

        es.onerror = () => {
          if (activeTaskIdRef.current !== taskId) return;
          if (activeEventSourceRef.current) {
            activeEventSourceRef.current.close();
            activeEventSourceRef.current = null;
          }
          pollTask(taskId);
        };
      } catch {
        pollTask(taskId);
      }
    },
    [applyTaskSnapshot, pollTask, stopActiveUpdates]
  );

  const cancelCurrentTask = async () => {
    const taskToCancel = currentTaskRef.current;
    if (!taskToCancel?.id) return;

    const cancelSeqAtStart = runSeqRef.current;
    const taskIdAtCancel = taskToCancel.id;

    // Stop any active streaming/polling immediately to prevent race updates after cancel.
    stopActiveUpdates();

    try {
      await fetch(`/api/task/${taskToCancel.id}/cancel`, { method: 'POST' });
    } catch (err) {
      console.error('Cancel task error:', err);
    } finally {
      // If user already started a new run (retry/new question), don't write cancelled placeholder
      // into the conversation or override the new task UI.
      if (runSeqRef.current !== cancelSeqAtStart) return;
      if (currentTaskRef.current?.id && currentTaskRef.current.id !== taskIdAtCancel) return;

      // Mark UI as cancelled, but don't inject a fake Agent answer into conversation history.
      const cancelledMessage = 'Task was cancelled by user';

      setFailureDetails(null);

      setConversationHistory(prev => {
        if (prev.length === 0) return prev;
        const updated = [...prev];
        const last = updated[updated.length - 1];
        // Keep the question, just keep output empty so retry can reuse the same slot.
        if (!last.output) updated[updated.length - 1] = { ...last, output: '' };
        return updated;
      });

      onTaskChange({
        ...taskToCancel,
        status: 'cancelled',
        error: cancelledMessage,
        output: taskToCancel.output,
      });

      // Treat cancel as a terminal state (not a failure panel).
      onStateChange('completed');
    }
  };

  const runTaskFromUI = async (input: string, agent?: string, opts?: { reuseTaskId?: string }) => {
    runSeqRef.current += 1;
    const trimmed = (input || '').trim();
    if (!trimmed) return;

    const active = currentTaskRef.current;
    const shouldReuseTaskId =
      Boolean(active?.id) &&
      Boolean(active?.status === 'cancelled' || active?.status === 'failed');

    // If we're retrying after stop/cancel, keep the same task id even if the input was edited.
    // This ensures Task History stays as a single Q&A (updated), not a new entry.
    const reuseTaskId =
      typeof opts?.reuseTaskId === 'string' && opts.reuseTaskId
        ? opts.reuseTaskId
        : shouldReuseTaskId
          ? active!.id
          : undefined;

    // We're starting a new run; don't let any stale cancel placeholder leak back in during queued/running.
    suppressCancelPlaceholderRef.current = true;

    // Clear any active streaming/polling before starting a new run.
    stopActiveUpdates();

    setFailureDetails(null);

    // If we're in a conversation, retry should clear the last entry output (e.g. cancelled message).
    setConversationHistory(prev => {
      if (prev.length === 0) return prev;
      const updated = [...prev];
      const last = updated[updated.length - 1];

      // If we're reusing the same task id (retry after stop), update the last question in-place
      // so we don't create an extra Q&A entry.
      if (reuseTaskId) {
        updated[updated.length - 1] = { ...last, input: trimmed, output: '' };
        return updated;
      }

      // If the retry is for the same last question, just clear its output.
      if (last.input.trim() === trimmed) {
        updated[updated.length - 1] = { ...last, output: '' };
        return updated;
      }

      // Otherwise, append a new question entry.
      updated.push({ input: trimmed, output: '', timestamp: Date.now() });
      return updated;
    });

    onStateChange('submitting');
    const effectiveGeneration: GenerationConfig =
      generationConfig.mode === 'deterministic' ? { ...generationConfig, temperature: 0 } : { mode: 'creative' };

    onTaskChange({
      id: 'pending...',
      status: 'submitting',
      agent: agent || currentTaskRef.current?.agent || '',
      input: trimmed,
      progress: 0,
      messages: [],
      generation: effectiveGeneration,
      output: undefined,
      error: undefined,
      startedAt: Date.now(),
    });

    try {
      const res = await fetch('/task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: trimmed,
          agent,
          taskId: reuseTaskId,
          conversationId: conversationId || undefined,
          generation: effectiveGeneration,
          multiAgent: autoMultiAgentPayload,
        }),
      });

      if (!res.ok) {
        let payload: any = null;
        try {
          payload = await res.json();
        } catch {
          // ignore
        }

        const reason =
          (payload && typeof payload.reason === 'string' && payload.reason) ||
          (payload && typeof payload.error === 'string' && payload.error) ||
          `Failed to submit task (HTTP ${res.status})`;

        // Provide a clear, actionable error when the backend prevents reusing a taskId
        // while the old run is still active.
        if (res.status === 409) {
          setFailureDetails({
            layer: 'API Gateway',
            error: reason,
            errorCode: 'TASK_RUNNING',
            timestamp: Date.now(),
            suggestions: [
              'Press Stop to cancel the running task',
              'Wait for the status to change to Cancelled',
              'Then press Retry again',
            ],
          });
        } else {
          setFailureDetails({
            layer: 'API Gateway',
            error: reason,
            errorCode: String(res.status),
            timestamp: Date.now(),
          });
        }

        onTaskChange({
          id: reuseTaskId || currentTaskRef.current?.id || 'pending...',
          status: 'failed',
          agent: agent || currentTaskRef.current?.agent || '',
          input: trimmed,
          progress: 0,
          messages: [],
          generation: effectiveGeneration,
          output: undefined,
          error: reason,
          startedAt: Date.now(),
        });

        onStateChange('failed');
        return;
      }

      const data = await res.json();
      const taskId = data?.taskId;
      if (!taskId || typeof taskId !== 'string') {
        throw new Error('Failed to submit task: missing taskId');
      }

      onTaskChange({
        id: taskId,
        status: 'queued',
        agent: agent || currentTaskRef.current?.agent || '',
        input: trimmed,
        progress: 0,
        messages: [],
        generation: effectiveGeneration,
        startedAt: Date.now(),
      });
      onStateChange('queued');
      startTaskUpdates(taskId);
    } catch (err) {
      console.error('Run task error:', err);
      setFailureDetails({
        layer: 'Network',
        error: err instanceof Error ? err.message : String(err),
        timestamp: Date.now(),
      });
      onStateChange('failed');
    }
  };

  // If a retry is requested while a task is still active, cancel it first and then retry
  // using the same taskId so we keep a single history entry and avoid backend 409s.
  const retryTaskFromUI = async (input: string, agent?: string) => {
    const active = currentTaskRef.current;
    const activeId = active?.id;
    const isActiveRun = activeId && activeId !== 'pending...' && (active?.status === 'pending' || active?.status === 'in_progress');

    if (isActiveRun) {
      await cancelCurrentTask();
      // Give the server a brief moment to apply the cancel before reusing the id.
      await new Promise((r) => setTimeout(r, 50));
      await runTaskFromUI(input, agent, { reuseTaskId: activeId });
      return;
    }

    await runTaskFromUI(input, agent);
  };

  return (
    <div className="flex flex-1 overflow-hidden gap-4 p-4">
      {/* Main content area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Server Connection Error Banner */}
        <AnimatePresence>
          {!isServerConnected && (
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="mb-4 p-4 bg-brand-error bg-opacity-10 border border-brand-error rounded-lg flex-shrink-0"
            >
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0">
                  <svg className="w-6 h-6 text-brand-error" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
                <div className="flex-1">
                  <h3 className="text-brand-error font-semibold mb-1">⚠️ Server Not Connected</h3>
                  <p className="text-sm text-brand-muted mb-3">
                    The backend server is not responding. You cannot submit tasks until the connection is restored.
                  </p>
                  <div className="flex flex-wrap gap-3 text-xs">
                    <div className="flex items-center gap-2 text-brand-muted">
                      <span className="font-mono bg-brand-dark px-2 py-1 rounded">npm run dev</span>
                      <span>Start the backend server in the project root</span>
                    </div>
                    <div className="flex items-center gap-2 text-brand-muted">
                      <span className="w-2 h-2 rounded-full bg-brand-error animate-pulse"></span>
                      <span>Last check: {Math.floor((Date.now() - lastConnectionCheck) / 1000)}s ago</span>
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => window.location.reload()}
                  className="flex-shrink-0 px-3 py-1.5 bg-brand-accent text-white text-sm rounded hover:bg-opacity-90 transition-all"
                >
                  Retry Connection
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence mode="wait">
          {uiState === 'idle' && (
            <motion.div
              key="idle"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex-1 flex items-center justify-center overflow-hidden"
            >
              <TaskInput
                onStateChange={onStateChange}
                onTaskChange={(task) => {
                  onTaskChange(task);
                  // Set conversationId from the first task's ID
                  if (task && task.id && !conversationId && !String(task.id).includes('pending')) {
                    setConversationId(task.id);
                  }
                }}
                generation={generationConfig}
                onGenerationChange={setGenerationConfig}
                onPollTask={startTaskUpdates}
              />
            </motion.div>
          )}

          {uiState !== 'idle' && currentTask && (
            <motion.div
              key="task"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex-1 flex flex-col overflow-hidden"
            >
              <div className="flex flex-col gap-4 overflow-y-auto h-full">
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className="bg-brand-panel border border-brand-border rounded-lg p-4 flex-shrink-0">
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-10 h-10 rounded-full border border-brand-accent/30 bg-brand-dark/60 flex items-center justify-center text-brand-accent">
                          {explainability?.agentId === 'research-agent' ? (
                            <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2}>
                              <circle cx="11" cy="11" r="7" />
                              <path d="M20 20l-3.5-3.5" />
                            </svg>
                          ) : explainability?.agentId === 'web-dev-agent' ? (
                            <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2}>
                              <path d="M8 17l-5-5 5-5" />
                              <path d="M16 7l5 5-5 5" />
                            </svg>
                          ) : explainability?.agentId === 'system-agent' ? (
                            <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2}>
                              <path d="M12 3l7 4v5c0 4.5-3.1 8.5-7 9-3.9-.5-7-4.5-7-9V7l7-4z" />
                              <path d="M9 12l2 2 4-4" />
                            </svg>
                          ) : (
                            <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2}>
                              <circle cx="12" cy="7" r="4" />
                              <path d="M4 21c2-4 14-4 16 0" />
                            </svg>
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-white truncate">
                            {explainability?.agentName || currentTask.agent || 'Agent'}
                          </div>
                          <div className="text-[11px] text-brand-muted font-mono truncate">
                            {currentTask.id.slice(0, 8)}…{currentTask.id.slice(-4)}
                          </div>
                        </div>
                      </div>
                      <div className="flex flex-wrap justify-end gap-2">
                        {explainability?.agentSelectionReason && /multi-agent/i.test(explainability.agentSelectionReason) && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wider border border-brand-accent/40 text-brand-accent">
                            multi-agent
                          </span>
                        )}
                        {explainability?.taskTypeLabel && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] uppercase tracking-wider border border-brand-border/60 text-brand-muted">
                            {explainability.taskTypeLabel}
                          </span>
                        )}
                      </div>
                    </div>

                    {explainability?.agentSelectionReason && (
                      <div className="mt-2 text-[11px] text-brand-muted line-clamp-1" title={explainability.agentSelectionReason}>
                        {explainability.agentSelectionReason}
                      </div>
                    )}

                    {showConversationDebug && (
                      <div className="mt-2 text-[11px] text-brand-muted font-mono truncate">
                        Conversation: {conversationId || '(none)'}
                      </div>
                    )}

                    {(uiState === 'submitting' || uiState === 'queued' || uiState === 'running') && (
                      <div className="mt-3">
                        <div className="w-full bg-brand-border rounded-full h-1 overflow-hidden relative">
                          <motion.div
                            className="h-full bg-gradient-to-r from-brand-accent via-blue-400 to-brand-accent rounded-full relative overflow-hidden"
                            style={{ width: progressWidth }}
                          >
                            <motion.div
                              className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent"
                              animate={{ x: [-200, 200] }}
                              transition={{ repeat: Infinity, duration: 1.5, ease: "linear" }}
                            />
                          </motion.div>
                        </div>
                      </div>
                    )}
                  </div>

                  <TaskTimeline status={currentTask.status} messages={currentTask.messages} agent={currentTask.agent} />
                </div>

                {/* Show Failure Panel for failed tasks */}
                {uiState === 'failed' && failureDetails && (
                  <FailurePanel
                    failure={failureDetails}
                    taskInput={currentTask.input}
                    onRetry={() => {
                      setFailureDetails(null);
                      void runTaskFromUI(currentTask.input, currentTask.agent);
                    }}
                    onDismiss={() => setFailureDetails(null)}
                  />
                )}

                {/* Output window is always mounted for any non-idle state (prevents scroll/state reset) */}
                {(!failureDetails || uiState !== 'failed') && (
                  <OutputWindow
                    messages={currentTask.messages}
                    isRunning={currentTask.status === 'pending' || currentTask.status === 'in_progress'}
                    taskOutput={currentTask.output}
                    taskInput={currentTask.input}
                    conversationHistory={conversationHistory}
                    onCancel={cancelCurrentTask}
                    onRetry={retryTaskFromUI}
                    onContinue={continueTask}
                    onNewTask={resetToNewTask}
                    currentTask={currentTask}
                    onTaskChange={onTaskChange}
                    onStateChange={onStateChange}
                    uiState={uiState}
                    onTimelineUpdate={onTimelineUpdate}
                    isEditingTask={isEditingTask}
                    setIsEditingTask={setIsEditingTask}
                    editedTaskInput={editedTaskInput}
                    setEditedTaskInput={setEditedTaskInput}
                  />
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Right sidebar */}
      <div className="w-80 flex-shrink-0">
        <TaskHistory />
      </div>
    </div>
  );
}

export default MainWorkspace;
