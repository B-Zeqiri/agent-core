import { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

type AgentCard = {
  id: string;
  label: string;
  accent: string;
  description: string;
};

type ApiAgent = {
  id: string;
  name: string;
  type?: string;
  metadata?: Record<string, any>;
};

type AgentMetric = {
  agentId: string;
  agentName: string;
  windowHours: number;
  total: number;
  completed: number;
  failed: number;
  cancelled: number;
  successRatePercent: number;
  avgExecutionTimeMs: number;
  failureReasons: Array<{ reason: string; count: number }>;
  cost: {
    currency: 'USD';
    estimated: boolean;
    estimatedTokens: number;
    estimatedCostUsd: number;
  };
  updatedAt: number;
};

interface AgentSidebarProps {
  activeAgent?: string;
  activeAgents?: string[];
}

function AgentSidebar({ activeAgent, activeAgents = [] }: AgentSidebarProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [metrics, setMetrics] = useState<Record<string, AgentMetric>>({});
  const [agentCards, setAgentCards] = useState<AgentCard[]>([
    {
      id: 'web-dev-agent',
      label: 'WebDev',
      accent: 'from-blue-500/25 to-brand-accent/10',
      description: 'Web development and frontend tasks',
    },
    {
      id: 'research-agent',
      label: 'Research',
      accent: 'from-violet-500/25 to-fuchsia-500/10',
      description: 'Research and information analysis',
    },
    {
      id: 'system-agent',
      label: 'System',
      accent: 'from-emerald-500/25 to-emerald-400/10',
      description: 'System diagnostics and monitoring',
    },
  ]);

  const cardFromAgent = (agent: ApiAgent): AgentCard => {
    if (agent.id === 'web-dev-agent') {
      return {
        id: agent.id,
        label: 'WebDev',
        accent: 'from-blue-500/25 to-brand-accent/10',
        description: 'Web development and frontend tasks',
      };
    }
    if (agent.id === 'research-agent') {
      return {
        id: agent.id,
        label: 'Research',
        accent: 'from-violet-500/25 to-fuchsia-500/10',
        description: 'Research and information analysis',
      };
    }
    if (agent.id === 'system-agent') {
      return {
        id: agent.id,
        label: 'System',
        accent: 'from-emerald-500/25 to-emerald-400/10',
        description: 'System diagnostics and monitoring',
      };
    }

    const description =
      (typeof agent.metadata?.description === 'string' && agent.metadata.description.trim()) ||
      (typeof agent.metadata?.meta?.description === 'string' && agent.metadata.meta.description.trim()) ||
      (agent.type === 'plugin' ? 'Plugin agent' : 'Agent');

    const labelBase = (agent.name || agent.id).replace(/\s*Agent\s*$/i, '').trim();
    const label = labelBase || agent.id;

    return {
      id: agent.id,
      label,
      accent: 'from-brand-accent/18 to-brand-success/10',
      description,
    };
  };

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const [agentsRes, metricsRes] = await Promise.allSettled([
          fetch('/api/agents'),
          fetch('/api/metrics/agents'),
        ]);

        if (!cancelled && agentsRes.status === 'fulfilled' && agentsRes.value.ok) {
          const data = (await agentsRes.value.json()) as unknown;
          if (Array.isArray(data)) {
            const apiAgents = data as ApiAgent[];
            const nextCards = apiAgents.map(cardFromAgent);

            const order = new Map<string, number>([
              ['web-dev-agent', 1],
              ['research-agent', 2],
              ['system-agent', 3],
            ]);
            nextCards.sort((a, b) => {
              const ao = order.get(a.id) ?? 99;
              const bo = order.get(b.id) ?? 99;
              if (ao !== bo) return ao - bo;
              return a.label.localeCompare(b.label);
            });

            setAgentCards(nextCards);
          }
        }

        if (!cancelled && metricsRes.status === 'fulfilled' && metricsRes.value.ok) {
          const data = (await metricsRes.value.json()) as any;
          if (!data || !Array.isArray(data.agents)) return;

          const next: Record<string, AgentMetric> = {};
          for (const a of data.agents as AgentMetric[]) {
            next[a.agentId] = a;
          }
          setMetrics(next);
        }
      } catch {
        // ignore
      }
    };

    load();
    const t = setInterval(load, 2500);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  const fmtMs = (ms: number) => {
    if (!ms) return '—';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
  };

  const isAgentActive = (card: AgentCard) => {
    const activeList = activeAgents.length > 0 ? activeAgents : [activeAgent || ''];
    const idLower = card.id.toLowerCase();
    const labelLower = card.label.toLowerCase();
    return activeList.some((entry) => {
      const activeLower = entry.toLowerCase();
      return (
        activeLower === idLower ||
        activeLower.includes(idLower) ||
        activeLower.includes(labelLower) ||
        activeLower.includes(labelLower.replace('dev', ''))
      );
    });
  };

  const sortedCards = [...agentCards].sort((a, b) => {
    const aActive = isAgentActive(a);
    const bActive = isAgentActive(b);
    if (aActive !== bActive) return aActive ? -1 : 1;
    return a.label.localeCompare(b.label);
  });

  return (
    <div className="w-full flex-1 min-h-0 bg-gradient-to-b from-brand-dark/80 to-brand-panel/80 backdrop-blur-2xl border border-brand-accent/20 rounded-lg p-4 overflow-y-auto shadow-2xl">
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-4 pb-3 border-b border-brand-accent/20"
      >
        <h2 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2">
          <motion.div
            className="w-1.5 h-1.5 rounded-full bg-brand-accent"
            animate={{
              scale: [1, 1.3, 1],
              opacity: [1, 0.5, 1]
            }}
            transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
          />
          Agents
        </h2>
      </motion.div>
      <div className="space-y-3">
        {sortedCards.map((card, idx) => {
          const m = metrics[card.id];

          const isActive = isAgentActive(card);

          const success = typeof m?.successRatePercent === 'number' ? m.successRatePercent : 0;
          const avg = typeof m?.avgExecutionTimeMs === 'number' ? m.avgExecutionTimeMs : 0;
          const cost = m?.cost?.estimatedCostUsd;

          const expanded = expandedId === card.id;

          return (
            <motion.div
              key={card.id}
              initial={{ opacity: 0, x: -16 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: idx * 0.06, type: 'spring', stiffness: 320, damping: 26 }}
              whileHover={{ scale: 1.01, x: 4 }}
              onClick={() => setExpandedId(expanded ? null : card.id)}
              className={
                'relative ' +
                'cursor-pointer select-none rounded-2xl border backdrop-blur-xl transition-all duration-300 ' +
                (isActive
                  ? 'border-brand-success/40 bg-gradient-to-r from-brand-accent/18 to-brand-success/10 shadow-xl shadow-brand-accent/20'
                  : 'border-brand-border/50 bg-brand-panel/40 hover:border-brand-accent/30 hover:bg-brand-panel/60')
              }
            >
              <div className={`relative px-4 py-3 rounded-2xl bg-gradient-to-r ${card.accent}`}>
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <div className="text-white font-semibold">{card.label}</div>
                      {isActive && (
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-brand-success/15 border border-brand-success/30 text-brand-success font-semibold">
                          Active
                        </span>
                      )}
                    </div>
                    <div className="text-[11px] text-brand-muted mt-0.5">{card.description}</div>
                  </div>

                  <motion.div
                    className={
                      'w-2.5 h-2.5 rounded-full ' +
                      (isActive
                        ? 'bg-brand-success shadow-lg shadow-brand-success/60'
                        : 'bg-brand-muted/40')
                    }
                    animate={isActive ? { scale: [1, 1.25, 1], opacity: [1, 0.6, 1] } : {}}
                    transition={isActive ? { repeat: Infinity, duration: 2, ease: 'easeInOut' } : {}}
                  />
                </div>

                <div className="mt-3 grid grid-cols-3 gap-3">
                  <div>
                    <div className="text-[10px] text-brand-muted">Success</div>
                    <div className="text-sm text-white font-semibold">{success}%</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-brand-muted">Avg time</div>
                    <div className="text-sm text-white font-semibold">{fmtMs(avg)}</div>
                  </div>
                  <div>
                    <div className="text-[10px] text-brand-muted">Cost</div>
                    <div className="text-sm text-white font-semibold">
                      {typeof cost === 'number' ? `≈ $${cost.toFixed(cost < 0.01 ? 4 : 2)}` : '—'}
                    </div>
                  </div>
                </div>

                <div className="mt-3 h-1.5 rounded-full bg-black/20 overflow-hidden">
                  <motion.div
                    className="h-full rounded-full bg-white/70"
                    initial={false}
                    animate={{ width: `${Math.max(0, Math.min(100, success))}%` }}
                    transition={{ type: 'spring', stiffness: 220, damping: 30 }}
                  />
                </div>
              </div>

              <AnimatePresence>
                {expanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.22 }}
                    className="px-4 pb-4"
                  >
                    <div className="mt-3 rounded-xl border border-brand-border/40 bg-brand-dark/30 p-3">
                      <div className="flex items-center justify-between">
                        <div className="text-xs text-white font-semibold">Last {m?.windowHours ?? 24}h</div>
                        <div className="text-[11px] text-brand-muted">Tap to collapse</div>
                      </div>

                      <div className="mt-2 text-[11px] text-brand-muted">
                        {m
                          ? `${m.total} total · ${m.completed} ok · ${m.failed} failed · ${m.cancelled} cancelled`
                          : 'Loading…'}
                      </div>

                      {m?.failureReasons?.length ? (
                        <div className="mt-3">
                          <div className="text-[11px] text-brand-muted mb-2">Top failure reasons</div>
                          <div className="space-y-1">
                            {m.failureReasons.map((r) => (
                              <div key={r.reason} className="flex items-center justify-between gap-2">
                                <div className="text-[12px] text-white/90 truncate">{r.reason}</div>
                                <div className="text-[11px] text-brand-muted flex-shrink-0">{r.count}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      ) : (
                        <div className="mt-3 text-[11px] text-brand-muted">No failures in this window.</div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}

export default AgentSidebar;
