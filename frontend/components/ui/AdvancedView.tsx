"use client";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { fadeIn } from "../../../motion/presets";
import { theme } from "../../../styles/theme";

export type LogEntry = {
  ts: number;
  level: "info" | "success" | "error";
  message: string;
};

export type ToolCall = { ts?: number; name: string; args?: Record<string, unknown> };
export type StateChange = { ts?: number; key: string; value: unknown };

export type AdvancedViewProps = {
  visible: boolean;
  onClose?: () => void;
  apiOrigin?: string;
  fetchLogs?: boolean; // default true
  intervalMs?: number; // default 3000
  toolCalls?: ToolCall[];
  stateChanges?: StateChange[];
};

/**
 * AdvancedView
 * Slide-in panel showing Agent logs, Tool calls, and State changes.
 * Motion: panel slides in; content uses minimal fade. No decoration.
 */
const AdvancedView = React.memo(function AdvancedView({
  visible,
  onClose,
  apiOrigin,
  fetchLogs = true,
  intervalMs = 3000,
  toolCalls = [],
  stateChanges = [],
}: AdvancedViewProps) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const lastLogSignature = useRef<string>("");

  useEffect(() => {
    if (!fetchLogs || !visible) return;
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    async function load() {
      try {
        const origin = apiOrigin || (typeof window !== "undefined" ? window.location.origin : "http://localhost:3000");
        const res = await fetch(`${origin}/api/logs`);
        if (!res.ok || cancelled) return;
        const data: LogEntry[] = await res.json();
        const signature = data.length ? `${data.length}-${data[data.length - 1]?.ts}` : "0";
        if (signature === lastLogSignature.current) return;
        lastLogSignature.current = signature;
        setLogs(data);
      } catch {
        // ignore transient errors
      }
    }
    load();
    timer = setInterval(load, intervalMs);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [fetchLogs, intervalMs, apiOrigin, visible]);

  const styles = useMemo(() => ({
    overlay: {
      position: "fixed" as const,
      inset: 0,
      display: "flex",
      justifyContent: "flex-end",
      pointerEvents: "none" as const,
    },
    panel: {
      width: 420,
      maxWidth: "80vw",
      height: "100vh",
      pointerEvents: "auto" as const,
      background: theme.colors.surface,
      borderLeft: "1px solid #e5e7eb",
      display: "grid",
      gridTemplateRows: "auto 1fr",
    } as React.CSSProperties,
    header: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "10px 12px",
      borderBottom: "1px solid #e5e7eb",
    } as React.CSSProperties,
    title: {
      fontSize: theme.typography.sizes.body,
      fontWeight: 600,
      color: "#0f172a",
    } as React.CSSProperties,
    closeBtn: {
      padding: "6px 8px",
      border: "1px solid #e5e7eb",
      borderRadius: theme.radius.sm,
      background: theme.colors.surface,
      cursor: "pointer",
    } as React.CSSProperties,
    content: {
      display: "grid",
      gridTemplateRows: "1fr 1fr 1fr",
    } as React.CSSProperties,
    section: {
      borderBottom: "1px solid #e5e7eb",
      padding: "8px 10px",
      overflow: "auto" as const,
    } as React.CSSProperties,
    sectionTitle: {
      fontSize: theme.typography.sizes.meta,
      color: "#6b7280",
      marginBottom: 6,
    } as React.CSSProperties,
    line: {
      fontSize: theme.typography.sizes.meta,
      color: "#0f172a",
      whiteSpace: "nowrap" as const,
      textOverflow: "ellipsis" as const,
      overflow: "hidden" as const,
    } as React.CSSProperties,
  }), []);

  return (
    <AnimatePresence initial={false}>
      {visible && (
        <motion.div key="overlay" {...fadeIn({ duration: 0.12 })} style={styles.overlay}>
          <motion.div
            key="panel"
            initial={{ x: 420 }}
            animate={{ x: 0 }}
            exit={{ x: 420 }}
            transition={{ duration: 0.22, ease: "easeOut" }}
            style={styles.panel}
          >
            <div style={styles.header}>
              <div style={styles.title}>Advanced View</div>
              <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.98 }} whileFocus={{ scale: 1.02 }} style={styles.closeBtn} onClick={onClose}>Close</motion.button>
            </div>
            <div style={styles.content}>
              <div style={styles.section}>
                <div style={styles.sectionTitle}>Agent logs</div>
                {logs.slice(-100).map((l, i) => (
                  <motion.div key={i} style={styles.line} whileHover={{ x: 2 }}>
                    [{new Date(l.ts).toLocaleTimeString()}] {l.message}
                  </motion.div>
                ))}
              </div>
              <div style={styles.section}>
                <div style={styles.sectionTitle}>Tool calls</div>
                {toolCalls.length === 0 && <div style={styles.line}>—</div>}
                {toolCalls.map((t, i) => (
                  <motion.div key={i} style={styles.line} whileHover={{ x: 2 }}>
                    [{t.ts ? new Date(t.ts).toLocaleTimeString() : ""}] {t.name}
                  </motion.div>
                ))}
              </div>
              <div style={styles.section}>
                <div style={styles.sectionTitle}>State changes</div>
                {stateChanges.length === 0 && <div style={styles.line}>—</div>}
                {stateChanges.map((s, i) => (
                  <motion.div key={i} style={styles.line} whileHover={{ x: 2 }}>
                    [{s.ts ? new Date(s.ts).toLocaleTimeString() : ""}] {s.key}: {JSON.stringify(s.value)}
                  </motion.div>
                ))}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
});

export default AdvancedView;
