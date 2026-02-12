import React, { useMemo } from 'react';
import { motion } from 'framer-motion';

type WorkflowNode = {
  id: string;
  agentId: string;
  dependsOn: string[];
  status: 'pending' | 'running' | 'succeeded' | 'failed';
};

type WorkflowPanelProps = {
  taskId?: string | null;
  status?: string | null;
  nodes?: WorkflowNode[];
};

type AgentMeta = {
  id: string;
  label: string;
  icon: React.ReactNode;
};

const agentMeta: AgentMeta[] = [
  {
    id: 'research-agent',
    label: 'Research',
    icon: (
      <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2}>
        <circle cx="11" cy="11" r="7" />
        <path d="M20 20l-3.5-3.5" />
      </svg>
    ),
  },
  {
    id: 'web-dev-agent',
    label: 'Build',
    icon: (
      <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2}>
        <path d="M8 17l-5-5 5-5" />
        <path d="M16 7l5 5-5 5" />
      </svg>
    ),
  },
  {
    id: 'system-agent',
    label: 'Review',
    icon: (
      <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2}>
        <path d="M12 3l7 4v5c0 4.5-3.1 8.5-7 9-3.9-.5-7-4.5-7-9V7l7-4z" />
        <path d="M9 12l2 2 4-4" />
      </svg>
    ),
  },
];

const fallbackMeta: AgentMeta = {
  id: 'unknown',
  label: 'Agent',
  icon: (
    <svg viewBox="0 0 24 24" className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2}>
      <circle cx="12" cy="7" r="4" />
      <path d="M4 21c2-4 14-4 16 0" />
    </svg>
  ),
};

function getAgentMeta(id: string): AgentMeta {
  return agentMeta.find((a) => a.id === id) || { ...fallbackMeta, id };
}

function computeLevels(nodes: WorkflowNode[]) {
  const byId = new Map(nodes.map((n) => [n.id, n] as const));
  const cache = new Map<string, number>();

  const levelFor = (id: string): number => {
    if (cache.has(id)) return cache.get(id) as number;
    const node = byId.get(id);
    if (!node || !node.dependsOn || node.dependsOn.length === 0) {
      cache.set(id, 0);
      return 0;
    }
    const level = 1 + Math.max(...node.dependsOn.map(levelFor));
    cache.set(id, level);
    return level;
  };

  const columns = new Map<number, WorkflowNode[]>();
  nodes.forEach((node) => {
    const level = levelFor(node.id);
    const list = columns.get(level) || [];
    list.push(node);
    columns.set(level, list);
  });

  return Array.from(columns.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([, list]) => list);
}

function statusStyles(status: WorkflowNode['status']) {
  switch (status) {
    case 'running':
      return {
        ring: 'border-emerald-400/60 shadow-emerald-400/30',
        dot: 'bg-emerald-300',
        glow: 'from-emerald-400/15 to-cyan-400/10',
      };
    case 'succeeded':
      return {
        ring: 'border-sky-400/60 shadow-sky-400/30',
        dot: 'bg-sky-300',
        glow: 'from-sky-400/15 to-blue-400/10',
      };
    case 'failed':
      return {
        ring: 'border-rose-400/70 shadow-rose-400/30',
        dot: 'bg-rose-300',
        glow: 'from-rose-400/15 to-amber-400/10',
      };
    default:
      return {
        ring: 'border-slate-500/40 shadow-slate-400/10',
        dot: 'bg-slate-400',
        glow: 'from-slate-500/10 to-slate-600/10',
      };
  }
}

export default function WorkflowPanel({ taskId, status, nodes = [] }: WorkflowPanelProps) {
  const columns = useMemo(() => computeLevels(nodes), [nodes]);
  const visible = nodes.length > 1;

  const panelStyle: React.CSSProperties = {
    ['--wf-panel' as any]: 'rgba(14, 18, 28, 0.9)',
    ['--wf-border' as any]: 'rgba(255, 255, 255, 0.08)',
  };

  if (!visible) {
    return (
      <div
        className="rounded-2xl border border-brand-border/40 bg-brand-panel/40 backdrop-blur-xl p-5"
        style={panelStyle}
      >
        <div className="text-xs uppercase tracking-[0.3em] text-brand-muted">Workflow</div>
        <div className="mt-3 text-sm text-brand-muted">
          Multi-agent runs will appear here.
        </div>
      </div>
    );
  }

  return (
    <div
      className="rounded-2xl border bg-[var(--wf-panel)] border-[var(--wf-border)] backdrop-blur-xl p-5 shadow-2xl"
      style={panelStyle}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[11px] uppercase tracking-[0.34em] text-brand-muted">Workflow</div>
          <div className="mt-2 text-base font-semibold text-white">Multi-agent path</div>
          {taskId && (
            <div className="mt-1 text-[11px] text-brand-muted/80 font-mono">{taskId.slice(0, 8)}...</div>
          )}
        </div>
        <span className="text-[11px] px-2 py-1 rounded-full border border-brand-border/50 text-brand-muted/80">
          {status || 'running'}
        </span>
      </div>

      <div className="mt-6 flex items-stretch gap-4">
        {columns.map((column, columnIndex) => (
          <div key={`col-${columnIndex}`} className="flex items-center gap-4">
            <div className="flex flex-col items-center gap-4">
              {column.map((node, nodeIndex) => {
                const meta = getAgentMeta(node.agentId);
                const styles = statusStyles(node.status);
                const label = `${meta.label} (${node.status})`;

                return (
                  <motion.div
                    key={`${node.id}-${nodeIndex}`}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.04 * (columnIndex + nodeIndex), duration: 0.35 }}
                    className="relative"
                  >
                    <div
                      className={
                        'relative w-12 h-12 rounded-full border shadow-lg ' +
                        styles.ring +
                        ' bg-gradient-to-br ' +
                        styles.glow
                      }
                      title={label}
                      aria-label={label}
                    >
                      <div className="absolute inset-0 flex items-center justify-center text-white/90">
                        {meta.icon}
                      </div>
                      <div className={`absolute -right-1 -top-1 w-3 h-3 rounded-full border border-brand-panel ${styles.dot}`} />
                      {node.status === 'running' && (
                        <div className="absolute inset-0 rounded-full animate-ping border border-emerald-400/40" />
                      )}
                    </div>
                    <div className="mt-2 text-[10px] text-brand-muted text-center uppercase tracking-[0.28em]">
                      {node.id}
                    </div>
                  </motion.div>
                );
              })}
            </div>

            {columnIndex < columns.length - 1 && (
              <div className="w-10 h-full flex items-center">
                <div className="h-0.5 w-full bg-gradient-to-r from-brand-accent/40 via-brand-accent/10 to-transparent" />
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 text-[11px] text-brand-muted">
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-300" />
          Running
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-sky-300" />
          Complete
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-rose-300" />
          Failed
        </div>
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full bg-slate-400" />
          Pending
        </div>
      </div>
    </div>
  );
}
