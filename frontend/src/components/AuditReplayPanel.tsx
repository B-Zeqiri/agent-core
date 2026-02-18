import React from 'react';

export type AuditEvent = {
  id: string;
  timestamp: number;
  eventType: string;
  agentId: string;
  taskId?: string;
  toolName?: string;
  details?: Record<string, unknown>;
};

export type ReplayEvent = {
  id: string;
  taskId: string;
  agentId: string;
  kind: 'model' | 'tool';
  name?: string;
  input?: unknown;
  output?: unknown;
  error?: string;
  startedAt: number;
  completedAt?: number;
  durationMs?: number;
  metadata?: Record<string, unknown>;
};

function formatTime(ts?: number) {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString();
}

function toPreview(value: unknown, maxLength: number = 240): string {
  if (value == null) return '';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

export default function AuditReplayPanel({ taskId }: { taskId?: string }) {
  const [auditEvents, setAuditEvents] = React.useState<AuditEvent[]>([]);
  const [replayEvents, setReplayEvents] = React.useState<ReplayEvent[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [replayMode, setReplayMode] = React.useState<string | null>(null);
  const [replayOutput, setReplayOutput] = React.useState<string | null>(null);
  const [replayError, setReplayError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!taskId) return;
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      try {
        const [auditRes, replayRes] = await Promise.all([
          fetch(`/api/audit?taskId=${encodeURIComponent(taskId)}&limit=200`),
          fetch(`/api/replay/${encodeURIComponent(taskId)}?limit=200`),
        ]);

        if (cancelled) return;

        if (auditRes.ok) {
          const payload = await auditRes.json();
          setAuditEvents(Array.isArray(payload?.events) ? payload.events : []);
        }
        if (replayRes.ok) {
          const payload = await replayRes.json();
          setReplayEvents(Array.isArray(payload?.events) ? payload.events : []);
        }
      } catch {
        // ignore transient errors
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [taskId]);

  const handleReplay = async () => {
    if (!taskId) return;
    setReplayError(null);
    setReplayOutput(null);
    setReplayMode(null);

    try {
      const res = await fetch(`/api/replay/${encodeURIComponent(taskId)}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fallback: true }),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || 'Replay failed');
      }

      const payload = await res.json();
      setReplayMode(payload?.mode ?? null);
      setReplayOutput(payload?.output ?? null);
      if (Array.isArray(payload?.steps)) {
        setReplayEvents(payload.steps);
      }
    } catch (error) {
      setReplayError(error instanceof Error ? error.message : String(error));
    }
  };

  if (!taskId) return null;

  return (
    <div className="mt-3 rounded-lg border border-brand-border bg-brand-panel/70 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="text-xs font-semibold text-brand-text tracking-wide">Explainability trace</div>
        <button
          className="px-2 py-1 text-[11px] rounded border border-brand-border/60 bg-brand-dark/40 text-brand-text hover:bg-brand-dark/60"
          onClick={handleReplay}
        >
          Replay
        </button>
      </div>

      {loading && <div className="mt-2 text-[11px] text-brand-muted">Loading audit + replay data...</div>}

      <div className="mt-2 grid gap-3 md:grid-cols-2">
        <div className="space-y-1">
          <div className="text-[11px] text-brand-muted">Audit events ({auditEvents.length})</div>
          {auditEvents.length === 0 && !loading && (
            <div className="text-[11px] text-brand-muted">No audit events yet.</div>
          )}
          {auditEvents.slice(-8).map((event) => (
            <div key={event.id} className="text-[11px] text-brand-text/90 truncate">
              [{formatTime(event.timestamp)}] {event.eventType} · {event.agentId}
              {event.toolName ? ` · ${event.toolName}` : ''}
            </div>
          ))}
        </div>

        <div className="space-y-1">
          <div className="text-[11px] text-brand-muted">Replay steps ({replayEvents.length})</div>
          {replayMode && <div className="text-[11px] text-brand-muted">Replay mode: {replayMode}</div>}
          {replayError && <div className="text-[11px] text-brand-error">Replay error: {replayError}</div>}
          {replayOutput && (
            <div className="text-[11px] text-brand-text/90 line-clamp-3" title={replayOutput}>
              Output: {toPreview(replayOutput)}
            </div>
          )}
          {replayEvents.length === 0 && !loading && (
            <div className="text-[11px] text-brand-muted">No replay data yet.</div>
          )}
          {replayEvents.slice(-6).map((event) => (
            <div key={event.id} className="text-[11px] text-brand-text/90 truncate">
              [{formatTime(event.startedAt)}] {event.kind} · {event.name || 'step'}
              {event.error ? ' · error' : ''}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
