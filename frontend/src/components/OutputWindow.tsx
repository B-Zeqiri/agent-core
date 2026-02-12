import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import WorkflowPanel from './WorkflowPanel';

interface OutputWindowProps {
  // Runtime can contain non-strings (backend/tooling metadata). We normalize defensively.
  messages: Array<unknown>;
  isRunning?: boolean;
  taskOutput?: string;
  taskInput?: string;
  footer?: React.ReactNode;
  onCancel?: () => void | Promise<void>;
  onRetry?: (input: string, agent?: string) => void | Promise<void>;
  onContinue?: (followUpText: string) => void;
  onNewTask?: () => void;
  conversationHistory?: Array<{
    input: string;
    output: string;
    timestamp: number;
  }>;

  // Passed by MainWorkspace (kept for compatibility)
  currentTask?: any;
  onTaskChange?: (task: any) => void;
  onStateChange?: (state: any) => void;
  uiState?: string;
  onTimelineUpdate?: (events: any[]) => void;

  // Optional edit-mode controls
  isEditingTask?: boolean;
  setIsEditingTask?: (value: boolean) => void;
  editedTaskInput?: string;
  setEditedTaskInput?: (value: string) => void;
}

function pickContent(raw?: string): string {
  if (!raw) return '';
  const text = String(raw);
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object') {
      return (
        (parsed.result as string) ||
        (parsed.output as string) ||
        (parsed.message as string) ||
        JSON.stringify(parsed, null, 2)
      );
    }
  } catch {
    // not JSON
  }
  return text;
}

function detectContentType(content: string): 'code' | 'json' | 'error' | 'text' {
  const trimmed = content.trim();
  if (!trimmed) return 'text';

  const startsWithError = /^(error|failed|exception|traceback|stack trace):/i.test(trimmed);
  const hasErrorStructure = /^Error:\s|^.*Error:\s|at\s+.*\(.*:\d+:\d+\)/i.test(trimmed);
  if (startsWithError || hasErrorStructure) return 'error';

  if (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    try {
      JSON.parse(trimmed);
      return 'json';
    } catch {
      // ignore
    }
  }

  const looksLikeCode =
    /```/.test(trimmed) ||
    /\b(function|const|let|var|class|import|export|async|await)\b/.test(trimmed) ||
    /<\w+.*>.*<\/\w+>/.test(trimmed) ||
    /\bdef\s+\w+\s*\(/.test(trimmed);

  if (looksLikeCode) return 'code';
  return 'text';
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function highlightCode(code: string): string {
  let cleanCode = code.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '');

  cleanCode = escapeHtml(cleanCode);

  cleanCode = cleanCode
    .replace(
      /\b(function|const|let|var|if|else|return|import|export|from|class|extends|async|await|try|catch|throw|new|this|super|static|public|private|protected|interface|type|enum)\b/g,
      '<span class="text-purple-400">$1</span>'
    )
    .replace(/(".*?"|'.*?'|`.*?`)/g, '<span class="text-green-400">$1</span>')
    .replace(/\b(\d+\.?\d*)\b/g, '<span class="text-blue-400">$1</span>')
    .replace(/(\/\/.*$)/gm, '<span class="text-gray-500">$1</span>')
    .replace(/(\/\*[\s\S]*?\*\/)/g, '<span class="text-gray-500">$1</span>');

  return cleanCode;
}

function isInternalEventLabel(label: string): boolean {
  const s = String(label || '').trim();
  if (!s) return false;

  // Hide low-level dot-events and framework steps
  // Examples: orchestrator.execute-workflow, task.started, agent.runtime.start, result.store
  const looksLikeDotEvent = /^[a-z]+(\.[a-z0-9-]+)+$/i.test(s);
  if (!looksLikeDotEvent) return false;

  return (
    s.startsWith('orchestrator.') ||
    s.startsWith('task.') ||
    s.startsWith('agent.') ||
    s.startsWith('result.') ||
    s.startsWith('tool.')
  );
}

function JsonViewer({ data }: { data: any }) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="space-y-2">
      <button
        onClick={() => setExpanded(v => !v)}
        className="flex items-center gap-2 text-brand-accent hover:text-brand-accent/80 transition-colors"
      >
        <span className="text-xs font-semibold uppercase tracking-wide">
          {expanded ? 'Hide JSON' : 'Show JSON'}
        </span>
      </button>
      {expanded && (
        <pre className="text-sm text-white font-mono whitespace-pre-wrap break-words overflow-x-auto bg-brand-dark/50 p-3 rounded border border-brand-border/50">
          {JSON.stringify(data, null, 2)}
        </pre>
      )}
    </div>
  );
}

export default function OutputWindow(props: OutputWindowProps) {
  const {
    isRunning = true,
    taskOutput,
    taskInput,
    footer,
    onCancel,
    onRetry,
    onContinue,
    onNewTask,
    conversationHistory = [],
    currentTask,
    uiState,
  } = props;

  const [taskDetails, setTaskDetails] = useState<null | {
    taskId: string;
    status: string;
    currentStep: string | null;
    cancelable: boolean;
    logs: Array<{
      ts: number;
      type: string;
      agentId: string;
      message: string;
      data?: any;
    }>;
    workflow?: any;
    graph?: {
      nodes: Array<{
        id: string;
        agentId: string;
        dependsOn: string[];
        status: 'pending' | 'running' | 'succeeded' | 'failed';
        role?: string;
      }>;
    } | null;
  }>(null);
  const detailsPollRef = useRef<number | null>(null);

  const [modelsOpen, setModelsOpen] = useState(false);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [modelsData, setModelsData] = useState<any>(null);
  const modelsButtonRef = useRef<HTMLButtonElement | null>(null);
  const modelsPopoverRef = useRef<HTMLDivElement | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const processingRef = useRef<HTMLDivElement>(null);
  const lastAnswerRef = useRef<HTMLDivElement>(null);
  const [stickToBottom, setStickToBottom] = useState(true);
  const [followOutput, setFollowOutput] = useState(true);

  const [isCancelling, setIsCancelling] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [copied, setCopied] = useState(false);

  const prevShowProcessingRef = useRef<boolean>(false);
  const prevHadAnswerRef = useRef<boolean>(false);

  const [continueText, setContinueText] = useState('');

  const [localIsEditing, setLocalIsEditing] = useState(false);
  const [localEditedInput, setLocalEditedInput] = useState(taskInput || '');

  const isEditingTask = props.isEditingTask ?? localIsEditing;
  const setIsEditingTask = props.setIsEditingTask ?? setLocalIsEditing;
  const editedTaskInput = props.editedTaskInput ?? localEditedInput;
  const setEditedTaskInput = props.setEditedTaskInput ?? setLocalEditedInput;

  const lastAutoEditTaskIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isEditingTask && taskInput) {
      setEditedTaskInput(taskInput);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskInput, isEditingTask]);

  const finalTaskOutput = pickContent(taskOutput);

  const statusText =
    (currentTask?.status as string) ||
    (uiState === 'running' ? 'in_progress' : uiState) ||
    'idle';

  const isTerminal = statusText === 'completed' || statusText === 'failed' || statusText === 'cancelled';

  const isActive =
    !isTerminal &&
    (isRunning || uiState === 'submitting' || uiState === 'queued' || uiState === 'running');

  // Phase 3: fetch task details (currentStep + logs)
  useEffect(() => {
    const taskId = currentTask?.id;
    if (!taskId || String(taskId).includes('pending')) {
      setTaskDetails(null);
      if (detailsPollRef.current != null) {
        window.clearInterval(detailsPollRef.current);
        detailsPollRef.current = null;
      }
      return;
    }

    let cancelled = false;

    const fetchDetails = async () => {
      try {
        const res = await fetch(`/api/task/${encodeURIComponent(taskId)}/details`);
        if (!res.ok) return;
        const data: any = await res.json();
        if (cancelled) return;
        if (data && data.ok) {
          const nextDetails = {
            taskId: data.taskId,
            status: String(data.status || ''),
            currentStep: typeof data.currentStep === 'string' ? data.currentStep : null,
            cancelable: Boolean(data.cancelable),
            logs: Array.isArray(data.logs) ? data.logs : [],
            workflow: data.workflow ?? null,
            graph: data.graph ?? null,
          };
          setTaskDetails(nextDetails);
        }
      } catch {
        // ignore
      }
    };

    // Initial fetch immediately
    void fetchDetails();

    // Poll while active; stop when terminal
    if (detailsPollRef.current != null) {
      window.clearInterval(detailsPollRef.current);
      detailsPollRef.current = null;
    }

    if (isActive) {
      detailsPollRef.current = window.setInterval(fetchDetails, 900);
    }

    return () => {
      cancelled = true;
      if (detailsPollRef.current != null) {
        window.clearInterval(detailsPollRef.current);
        detailsPollRef.current = null;
      }
    };
  }, [currentTask?.id, isActive]);

  useEffect(() => {
    if (!modelsOpen) return;

    const ac = new AbortController();
    setModelsLoading(true);
    setModelsError(null);

    (async () => {
      try {
        const res = await fetch('/api/models', { signal: ac.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        setModelsData(data);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (!/aborted/i.test(message)) setModelsError(message);
      } finally {
        setModelsLoading(false);
      }
    })();

    return () => ac.abort();
  }, [modelsOpen]);

  useEffect(() => {
    if (!modelsOpen) return;

    const onPointerDown = (ev: PointerEvent | MouseEvent) => {
      const target = ev.target as Node | null;
      if (!target) return;

      const inPopover = modelsPopoverRef.current?.contains(target);
      const inButton = modelsButtonRef.current?.contains(target);
      if (inPopover || inButton) return;

      setModelsOpen(false);
    };

    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [modelsOpen]);

  const lastConversation = conversationHistory.length
    ? conversationHistory[conversationHistory.length - 1]
    : null;

  const showProcessing = Boolean(
    !isTerminal &&
      (isActive ||
        (lastConversation &&
          !lastConversation.output &&
          uiState !== 'completed' &&
          uiState !== 'failed'))
  );

  useEffect(() => {
    if (!followOutput || !stickToBottom) {
      prevShowProcessingRef.current = showProcessing;
      prevHadAnswerRef.current = prevHadAnswerRef.current;
      return;
    }

    const lastConversationOutput = lastConversation ? pickContent(lastConversation.output) : '';
    const lastHasAnswer = Boolean(lastConversationOutput && lastConversationOutput.trim().length > 0);

    const firstTaskHasAnswer =
      conversationHistory.length === 0 && Boolean(finalTaskOutput && finalTaskOutput.trim().length > 0) && !showProcessing;

    const hasAnyAnswer = lastHasAnswer || firstTaskHasAnswer;

    // When processing starts, ensure the processing indicator is visible.
    if (showProcessing && !prevShowProcessingRef.current) {
      processingRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }

    // When an answer first appears, scroll to the start of that answer (so reading begins at the top).
    if (hasAnyAnswer && !prevHadAnswerRef.current) {
      lastAnswerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    prevShowProcessingRef.current = showProcessing;
    prevHadAnswerRef.current = hasAnyAnswer;
  }, [
    showProcessing,
    stickToBottom,
    followOutput,
    conversationHistory.length,
    lastConversation?.output,
    finalTaskOutput,
  ]);

  useEffect(() => {
    if (copied) {
      const t = setTimeout(() => setCopied(false), 1200);
      return () => clearTimeout(t);
    }
  }, [copied]);

  const isCompleted = statusText === 'completed';
  const isStopped = statusText === 'cancelled';
  const isErrored = statusText === 'failed';

  const showPostCompleteActions = !isActive && isCompleted;
  const showPostStopActions = !isActive && (isStopped || isErrored);

  // When a task is stopped (cancelled/failed), immediately enter edit mode.
  // When it becomes active again, exit edit mode so the field is read-only while running.
  useEffect(() => {
    const taskId = currentTask?.id ?? null;

    if (isActive) {
      if (isEditingTask) setIsEditingTask(false);
      lastAutoEditTaskIdRef.current = null;
      return;
    }

    if (showPostStopActions && taskId && lastAutoEditTaskIdRef.current !== taskId) {
      setIsEditingTask(true);
      setEditedTaskInput((taskInput ?? '').trim() ? (taskInput as string) : editedTaskInput);
      lastAutoEditTaskIdRef.current = taskId;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, showPostStopActions, currentTask?.id]);

  const statusBadgeClass = (() => {
    switch (statusText) {
      case 'completed':
        return 'border-brand-success/40 bg-brand-success/10 text-brand-success';
      case 'failed':
        return 'border-brand-error/40 bg-brand-error/10 text-brand-error';
      case 'cancelled':
        return 'border-brand-error/40 bg-brand-error/10 text-brand-error';
      case 'queued':
      case 'submitting':
      case 'pending':
      case 'in_progress':
      case 'running':
        return 'border-brand-accent/40 bg-brand-accent/10 text-brand-accent';
      default:
        return 'border-brand-border/60 bg-brand-panel/60 text-brand-muted';
    }
  })();

  const latestAnswerText = (() => {
    const last = conversationHistory.length ? conversationHistory[conversationHistory.length - 1] : null;
    if (last?.output) return pickContent(last.output);
    if (conversationHistory.length === 0 && finalTaskOutput) return finalTaskOutput;
    return '';
  })();

  const chatTurns = useMemo(() => {
    const turns: Array<{ input: string; output: string }> = [];
    if (conversationHistory.length > 0) {
      turns.push(...conversationHistory.map(t => ({ input: t.input, output: pickContent(t.output) })));
    }

    const normalizedInput = (taskInput || '').trim();
    if (normalizedInput) {
      const last = turns[turns.length - 1];
      const alreadyLast = last && last.input.trim() === normalizedInput;
      if (!alreadyLast) {
        turns.push({
          input: normalizedInput,
          output: conversationHistory.length === 0 ? finalTaskOutput : ''
        });
      }
    }

    return turns;
  }, [conversationHistory, taskInput, finalTaskOutput]);

  const handleRetry = async () => {
    if (!onRetry) return;
    const inputToUse = (showPostStopActions || isEditingTask ? editedTaskInput : taskInput) || '';
    const finalInput = inputToUse.trim();
    if (!finalInput) return;

    try {
      setIsRetrying(true);
      await onRetry(finalInput, currentTask?.agent);
    } finally {
      setIsRetrying(false);
    }
  };

  const retryInput = (showPostStopActions || isEditingTask ? editedTaskInput : taskInput) || '';
  const canRetry = retryInput.trim().length > 0;

  const renderOutputBlock = (content: string) => {
    const contentType = detectContentType(content);

    if (contentType === 'json') {
      try {
        return <JsonViewer data={JSON.parse(content)} />;
      } catch {
        // fallthrough
      }
    }

    if (contentType === 'code') {
      return (
        <pre
          className="text-sm font-mono whitespace-pre-wrap break-words overflow-x-auto bg-brand-dark/50 p-4 rounded border border-brand-border/50 leading-relaxed"
          dangerouslySetInnerHTML={{ __html: highlightCode(content) }}
        />
      );
    }

    if (contentType === 'error') {
      return (
        <div className="text-sm text-white font-mono whitespace-pre-wrap break-words overflow-x-auto bg-brand-error/10 p-4 rounded border border-brand-error/30 leading-relaxed">
          {content}
        </div>
      );
    }

    return <div className="text-sm text-white whitespace-pre-wrap break-words leading-relaxed">{content}</div>;
  };

  const visibleStep = taskDetails?.currentStep && !isInternalEventLabel(taskDetails.currentStep)
    ? taskDetails.currentStep
    : null;

  const visibleLogs = (taskDetails?.logs || []).filter(l => !isInternalEventLabel(String(l?.message || '')));

  const showDetailsStrip = Boolean(visibleStep || visibleLogs.length > 0);

  const workflowNodes = taskDetails?.graph?.nodes || [];

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-brand-dark border border-brand-border rounded-lg flex flex-col shadow-lg min-h-[260px] h-full flex-1 min-h-0"
    >
      <div className="px-4 py-3 border-b border-brand-accent/20 bg-gradient-to-r from-brand-dark to-brand-panel flex justify-between items-center">
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-brand-accent animate-pulse"></div>
          <span className="text-xs font-bold text-white uppercase tracking-wider">Chat</span>
          <span className={`ml-2 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded-full border ${statusBadgeClass}`}>
            {statusText}
          </span>
        </div>

        <div className="flex gap-2 items-center relative">
          <button
            ref={modelsButtonRef}
            onClick={() => setModelsOpen(v => !v)}
            className="px-3 py-1.5 text-xs font-semibold border rounded-md transition-all duration-200 bg-brand-panel border-brand-border text-white hover:bg-brand-panel/80"
            title="Model routing"
          >
            Models
          </button>

          {modelsOpen && (
            <div
              ref={modelsPopoverRef}
              className="absolute right-0 top-10 z-30 w-[420px] max-w-[85vw] bg-brand-panel border border-brand-border rounded-lg shadow-lg p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="text-xs font-semibold text-white/90 uppercase tracking-wide">Model routing</div>
                <div className="flex items-center gap-2">
                  <a
                    href="/api/models"
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs text-brand-accent hover:underline"
                    title="Open raw JSON"
                  >
                    JSON
                  </a>
                  <button
                    onClick={() => setModelsOpen(false)}
                    className="text-xs text-white/70 hover:text-white"
                    title="Close"
                  >
                    Close
                  </button>
                </div>
              </div>

              {modelsLoading && (
                <div className="mt-2 text-xs text-brand-muted">Loading…</div>
              )}

              {modelsError && (
                <div className="mt-2 text-xs text-brand-error">Failed: {modelsError}</div>
              )}

              {!modelsLoading && !modelsError && modelsData?.ok && (
                <div className="mt-2 space-y-2">
                  <div className="text-xs text-brand-muted">
                    <span className="text-white/80">Mode:</span> {modelsData.mode}
                  </div>

                  {Array.isArray(modelsData.chain) && modelsData.chain.length > 0 && (
                    <div className="text-xs text-brand-muted">
                      <span className="text-white/80">Chain:</span>{' '}
                      <span className="text-white/90">{modelsData.chain.join(' → ')}</span>
                    </div>
                  )}

                  <div className="grid grid-cols-1 gap-2">
                    {modelsData?.providers?.gpt4all && (
                      <div className="rounded-md border border-brand-border/60 bg-brand-dark/40 p-2">
                        <div className="text-xs font-semibold text-white/90">gpt4all</div>
                        <div className="mt-1 text-[11px] text-brand-muted break-words">{modelsData.providers.gpt4all.baseURL}</div>
                        <div className="text-[11px] text-brand-muted">{modelsData.providers.gpt4all.model}</div>
                      </div>
                    )}

                    {modelsData?.providers?.ollama && (
                      <div className="rounded-md border border-brand-border/60 bg-brand-dark/40 p-2">
                        <div className="text-xs font-semibold text-white/90">ollama</div>
                        <div className="mt-1 text-[11px] text-brand-muted break-words">{modelsData.providers.ollama.baseURL}</div>
                        <div className="text-[11px] text-brand-muted">{modelsData.providers.ollama.model}</div>
                      </div>
                    )}

                    {modelsData?.providers?.openai && (
                      <div className="rounded-md border border-brand-border/60 bg-brand-dark/40 p-2">
                        <div className="flex items-center justify-between">
                          <div className="text-xs font-semibold text-white/90">openai</div>
                          <div className="text-[11px] text-brand-muted">key: {modelsData.providers.openai.apiKeyPresent ? 'yes' : 'no'}</div>
                        </div>
                        <div className="mt-1 text-[11px] text-brand-muted break-words">{modelsData.providers.openai.baseURL}</div>
                        <div className="text-[11px] text-brand-muted">{modelsData.providers.openai.model}</div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {latestAnswerText && showPostCompleteActions && (
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(latestAnswerText);
                  setCopied(true);
                } catch {
                  // ignore
                }
              }}
              className={`px-3 py-1.5 text-xs font-semibold border rounded-md transition-all duration-200 bg-brand-panel border-brand-border text-white hover:bg-brand-panel/80 ${
                copied ? 'opacity-80' : ''
              }`}
              title="Copy latest answer"
            >
              {copied ? 'Copied' : 'Copy'}
            </motion.button>
          )}

          {onNewTask && showPostCompleteActions && (
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={e => {
                e.preventDefault();
                e.stopPropagation();
                onNewTask();
              }}
              className="px-3 py-1.5 text-xs font-semibold border rounded-md transition-all duration-200 bg-brand-accent text-white hover:bg-opacity-90"
              title="New task"
            >
              New
            </motion.button>
          )}
        </div>
      </div>

      {showDetailsStrip && (
        <div className="px-4 py-2 border-b border-brand-border/60 bg-brand-panel/40">
          {visibleStep && (
            <div className="text-xs text-brand-muted">
              <span className="font-semibold text-brand-text">Step:</span> {visibleStep}
            </div>
          )}
          {visibleLogs.length > 0 && (
            <div className="mt-1 text-[11px] text-brand-muted max-h-20 overflow-auto whitespace-pre-wrap break-words">
              {visibleLogs.slice(-6).map((l) => (
                <div key={`${l.ts}-${l.type}-${l.message}`} className="flex gap-2">
                  <span className="opacity-70">{new Date(l.ts).toLocaleTimeString()}</span>
                  <span className="opacity-90">{l.message}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {workflowNodes.length > 0 && (
        <div className="px-4 py-3 border-b border-brand-border/60 bg-brand-panel/30 shrink-0">
          <WorkflowPanel
            taskId={taskDetails?.taskId}
            status={taskDetails?.status}
            nodes={workflowNodes}
          />
        </div>
      )}

      <div
        ref={scrollRef}
        className="flex-1 bg-gradient-to-b from-brand-panel/30 to-brand-dark"
      >
        {/* ChatGPT-style transcript */}
        <div className="space-y-0">
          {currentTask?.status === 'cancelled' && (
            <div className="px-6 py-4 border-b border-brand-border/60 bg-brand-error/5">
              <div className="max-w-3xl mx-auto">
                <div className="text-xs font-semibold text-brand-error uppercase tracking-wide mb-1">Cancelled</div>
                <div className="text-sm text-white/90">This run was cancelled. You can retry, edit, or start a new task.</div>
              </div>
            </div>
          )}

          {chatTurns.map((turn, idx) => {
            const isLast = idx === chatTurns.length - 1;
            const showTypingForLast = isLast && showProcessing && !turn.output;

            return (
              <React.Fragment key={`${idx}-${turn.input.slice(0, 16)}`}>
                {/* User */}
                <div className="px-6 py-6 border-b border-brand-border/60 bg-brand-dark">
                  <div className="max-w-3xl mx-auto">
                    <div className="flex gap-4">
                      <div className="w-8 h-8 rounded-full bg-brand-accent/20 border border-brand-accent/30 flex items-center justify-center text-brand-accent font-bold">
                        U
                      </div>
                      <div className="flex-1">
                        {(isEditingTask || showPostStopActions) && isLast ? (
                          <textarea
                            value={editedTaskInput}
                            onChange={e => setEditedTaskInput(e.target.value)}
                            className="w-full bg-brand-panel border border-brand-border focus:border-brand-accent rounded-xl px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none resize-none"
                            rows={3}
                            placeholder="Edit your task..."
                            autoFocus
                          />
                        ) : (
                          <div className="text-sm text-white whitespace-pre-wrap break-words leading-relaxed">
                            {turn.input}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Assistant */}
                <div className="px-6 py-6 border-b border-brand-border/60 bg-brand-panel/30">
                  <div className="max-w-3xl mx-auto">
                    <div className="flex gap-4">
                      <div className="w-8 h-8 rounded-full bg-brand-success/20 border border-brand-success/30 flex items-center justify-center text-brand-success font-bold">
                        A
                      </div>
                      <div className="flex-1">
                        {turn.output ? (
                          <div
                            ref={isLast ? lastAnswerRef : undefined}
                            style={isLast ? { scrollMarginTop: 12 } : undefined}
                          >
                            {renderOutputBlock(turn.output)}
                          </div>
                        ) : showTypingForLast ? (
                          <div
                            ref={processingRef}
                            style={{ scrollMarginTop: 12 }}
                            className="text-sm text-white/80"
                          >
                            <div className="flex items-center gap-2">
                              <span className="text-white/80">Thinking</span>
                              <motion.span
                                className="inline-block w-2 h-2 rounded-full bg-brand-accent"
                                animate={{ y: [0, -6, 0] }}
                                transition={{ duration: 1.2, repeat: Infinity, delay: 0 }}
                              />
                              <motion.span
                                className="inline-block w-2 h-2 rounded-full bg-brand-accent"
                                animate={{ y: [0, -6, 0] }}
                                transition={{ duration: 1.2, repeat: Infinity, delay: 0.25 }}
                              />
                              <motion.span
                                className="inline-block w-2 h-2 rounded-full bg-brand-accent"
                                animate={{ y: [0, -6, 0] }}
                                transition={{ duration: 1.2, repeat: Infinity, delay: 0.5 }}
                              />
                            </div>
                          </div>
                        ) : (
                          <div className="text-sm text-white/50">(no output)</div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </React.Fragment>
            );
          })}

          {/* Scroll-to-bottom button (when user scrolls up) */}
          {!stickToBottom && (
            <div className="sticky bottom-4 z-10 flex justify-center pointer-events-none py-2">
              <button
                onClick={() => {
                  setFollowOutput(true);
                  setStickToBottom(true);
                  const el = scrollRef.current;
                  if (!el) return;
                  el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
                }}
                className="pointer-events-auto px-4 py-2 rounded-full bg-brand-panel border border-brand-border text-white text-sm shadow-lg hover:bg-brand-panel/80 transition"
              >
                Scroll to bottom
              </button>
            </div>
          )}
        </div>

        <div className="px-6 py-6">
          <div className="max-w-3xl mx-auto">{footer}</div>
        </div>
      </div>

      {/* Bottom composer */}
      {onContinue && (
        <div className="sticky bottom-0 z-20 mt-4 border-t border-brand-border bg-brand-dark/90 backdrop-blur supports-[backdrop-filter]:bg-brand-dark/70 p-4">
          <div className="max-w-3xl mx-auto">
            <div className="flex gap-2">
              <textarea
                value={continueText}
                onChange={e => setContinueText(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    const text = continueText.trim();
                    if (!text) return;
                    if (isActive) return;
                    if (currentTask?.status === 'cancelled') return;
                    setContinueText('');
                    onContinue(text);
                    setFollowOutput(true);
                    setStickToBottom(true);
                  }
                }}
                rows={2}
                placeholder={
                  currentTask?.status === 'cancelled'
                    ? 'Cancelled runs cannot be continued. Retry or start a new task.'
                    : 'Message…'
                }
                disabled={isActive || currentTask?.status === 'cancelled'}
                className="flex-1 bg-brand-panel border border-brand-border focus:border-brand-accent rounded-xl px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none resize-none disabled:opacity-60"
              />
              <button
                onClick={async () => {
                  if (isActive) {
                    if (!onCancel || isCancelling) return;
                    try {
                      setIsCancelling(true);
                      await onCancel();
                    } finally {
                      setIsCancelling(false);
                    }
                    return;
                  }

                  if (showPostStopActions) {
                    if (!canRetry || !onRetry || isRetrying) return;
                    await handleRetry();
                    return;
                  }

                  const text = continueText.trim();
                  if (!text) return;
                  if (currentTask?.status === 'cancelled') return;
                  setContinueText('');
                  onContinue(text);
                  setFollowOutput(true);
                  setStickToBottom(true);
                }}
                disabled={
                  (isActive && (!onCancel || isCancelling)) ||
                  (!isActive && showPostStopActions && (!canRetry || !onRetry || isRetrying)) ||
                  (!isActive && !showPostStopActions && (!continueText.trim() || currentTask?.status === 'cancelled'))
                }
                className={
                  isActive
                    ? 'px-4 py-2 rounded-xl bg-brand-error text-white font-semibold hover:bg-brand-error/80 disabled:opacity-50 disabled:cursor-not-allowed'
                    : showPostStopActions
                    ? 'px-4 py-2 rounded-xl bg-brand-panel border border-brand-accent text-brand-accent font-semibold hover:bg-brand-accent hover:text-white disabled:opacity-50 disabled:cursor-not-allowed'
                    : 'px-4 py-2 rounded-xl bg-brand-accent text-white font-semibold hover:bg-opacity-90 disabled:opacity-50 disabled:cursor-not-allowed'
                }
              >
                {isActive
                  ? (isCancelling ? 'Stopping…' : 'Stop')
                  : showPostStopActions
                  ? (isRetrying ? 'Retrying…' : 'Retry')
                  : 'Send'}
              </button>
            </div>
            <div className="mt-2 text-xs text-brand-muted">Enter to send • Shift+Enter for newline</div>
          </div>
        </div>
      )}
    </motion.div>
  );
}
