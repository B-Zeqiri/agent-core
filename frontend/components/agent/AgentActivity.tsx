"use client";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { theme } from "../../../styles/theme";

export type AgentInfo = {
  name: string;
  status: "READY" | "BUSY" | "IDLE";
  currentTaskId?: string;
  lastUpdated: number;
};

export type AgentActivityProps = {
  showLabels?: boolean; // default false
  autoFetch?: boolean; // default true
  intervalMs?: number; // default 3000
  initialCount?: number; // if provided, skips first fetch
  maxDots?: number; // cap dots for visualization (default 8)
};

/**
 * AgentActivity
 * Abstract presence visualization: pulsing indicators with soft glow.
 * No avatars. No names by default.
 */
function AgentActivity({
  showLabels = false,
  autoFetch = true,
  intervalMs = 3000,
  initialCount,
  maxDots = 8,
}: AgentActivityProps) {
  const [count, setCount] = useState<number>(initialCount ?? 0);
  const [busyCount, setBusyCount] = useState<number>(0);
  const lastCounts = useRef({ count: initialCount ?? 0, busy: 0 });

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;
    async function load() {
      try {
        const res = await fetch("/api/agents");
        if (!res.ok) return;
        const agents: AgentInfo[] = await res.json();
        const active = agents.filter((a) => a.status !== "IDLE");
        const busy = agents.filter((a) => a.status === "BUSY");
        const nextCount = active.length || agents.length || 0;
        const nextBusy = busy.length || 0;
        if (nextCount !== lastCounts.current.count) setCount(nextCount);
        if (nextBusy !== lastCounts.current.busy) setBusyCount(nextBusy);
        lastCounts.current = { count: nextCount, busy: nextBusy };
      } catch {
        // ignore transient errors
      }
    }
    if (autoFetch) {
      load();
      timer = setInterval(load, intervalMs);
    }
    return () => timer && clearInterval(timer);
  }, [autoFetch, intervalMs]);

  const styles = useMemo(() => ({
    wrap: {
      display: "flex",
      alignItems: "center",
      gap: 8,
    } as React.CSSProperties,
    dots: {
      display: "flex",
      alignItems: "center",
      gap: 8,
    } as React.CSSProperties,
    dot: (emphasized: boolean): React.CSSProperties => ({
      width: 10,
      height: 10,
      borderRadius: 999,
      background: theme.colors.accent,
      boxShadow: emphasized
        ? "0 0 0 10px rgba(37,99,235,0.16)"
        : "0 0 0 8px rgba(37,99,235,0.08)",
    }),
    label: {
      fontSize: theme.typography.sizes.meta,
      color: "#6b7280",
    } as React.CSSProperties,
  }), []);

  const dots = Math.max(0, Math.min(count, maxDots));
  const busy = Math.max(0, Math.min(busyCount, dots));

  return (
    <div style={styles.wrap}>
      <div style={styles.dots} aria-hidden>
        {Array.from({ length: dots || 1 }).map((_, i) => {
          const emphasized = i < busy;
          return (
            <motion.div
              key={i}
              style={styles.dot(emphasized)}
              animate={{ scale: [1, 1.08, 1] }}
              transition={{ duration: 1.6, ease: "easeInOut", repeat: Infinity }}
              whileHover={{ scale: 1.15 }}
            />
          );
        })}
      </div>
      {showLabels && (
        <span style={styles.label}>{count} active</span>
      )}
    </div>
  );
}

export default React.memo(AgentActivity);
