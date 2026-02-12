"use client";
import React, { useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { fadeIn } from "../../../motion/presets";
import { theme } from "../../../styles/theme";

export type ErrorKind = "permission" | "tool" | "model" | "generic";

export type TaskErrorProps = {
  visible: boolean;
  kind?: ErrorKind;
  message?: string;
  onRetry?: () => void;
  className?: string;
};

/**
 * TaskError
 * Inline, non-modal error notice. No alerts.
 * Visual: red accent line (left border), soft tinted surface.
 * Motion: gentle shake on appear (fade in + small x oscillation).
 */
const TaskError = React.memo(function TaskError({ visible, kind = "generic", message, onRetry, className }: TaskErrorProps) {
  const styles = useMemo(() => ({
    wrap: {
      width: "100%",
      maxWidth: 900,
      borderRadius: theme.radius.lg,
      background: "#fff5f5",
      border: "1px solid #fecaca",
      boxShadow: theme.shadows.subtle,
      overflow: "hidden",
      display: "flex",
      alignItems: "stretch",
    } as React.CSSProperties,
    accent: {
      width: 4,
      background: "#ef4444",
    } as React.CSSProperties,
    body: {
      flex: 1,
      padding: "12px 16px",
    } as React.CSSProperties,
    title: {
      fontSize: theme.typography.sizes.section,
      fontWeight: 600,
      color: "#b91c1c",
      marginBottom: 4,
    } as React.CSSProperties,
    text: {
      fontSize: theme.typography.sizes.body,
      color: "#7f1d1d",
      whiteSpace: "pre-wrap" as const,
    } as React.CSSProperties,
    actions: {
      padding: "8px 12px",
      display: "flex",
      gap: 8,
      borderTop: "1px solid #fecaca",
      background: "#fff5f5",
    } as React.CSSProperties,
    button: {
      padding: "8px 12px",
      borderRadius: theme.radius.sm,
      border: "1px solid #fecaca",
      background: "#ffffff",
      color: "#b91c1c",
      cursor: "pointer",
    } as React.CSSProperties,
  }), []);

  const title =
    kind === "permission"
      ? "Permission error"
      : kind === "tool"
      ? "Tool failure"
      : kind === "model"
      ? "Model unavailable"
      : "Error";

  const shake = {
    initial: { opacity: 0, x: 0 },
    animate: { opacity: 1, x: [0, -4, 4, -3, 3, 0] },
    exit: { opacity: 0, x: 0 },
    transition: { duration: 0.5, ease: "easeOut" },
  };

  return (
    <AnimatePresence initial={false}>
      {visible && (
        <motion.div key="task-error" {...fadeIn({ duration: 0.2 })} style={{ display: "flex", justifyContent: "center" }}>
          <motion.div {...shake} className={className} style={styles.wrap}>
            <div style={styles.accent} />
            <div style={{ flex: 1 }}>
              <div style={styles.body}>
                <div style={styles.title}>{title}</div>
                {message && <div style={styles.text}>{message}</div>}
              </div>
              <div style={styles.actions}>
                {onRetry && (
                  <button style={styles.button} onClick={onRetry}>Retry</button>
                )}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
});

export default TaskError;
