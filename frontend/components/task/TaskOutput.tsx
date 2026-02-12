"use client";
import React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { slideUp } from "../../../motion/presets";
import { theme } from "../../../styles/theme";

export type TaskOutputProps = {
  status: "pending" | "in_progress" | "completed" | "failed";
  result?: string;
  title?: string;
};

/**
 * TaskOutput
 * Appears only when complete. Slides up. No streaming.
 * Provides clear formatting in a surface card.
 */
const TaskOutput = React.memo(function TaskOutput({ status, result = "", title = "Result" }: TaskOutputProps) {
  const isVisible = status === "completed";

  const styles = {
    card: {
      width: "100%",
      maxWidth: 900,
      borderRadius: theme.radius.lg,
      background: theme.colors.surface,
      border: `1px solid #e5e7eb`,
      boxShadow: theme.shadows.soft,
      overflow: "hidden",
    } as React.CSSProperties,
    header: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      padding: "12px 16px",
      borderBottom: "1px solid #e5e7eb",
      background: theme.colors.surfaceAlt,
    } as React.CSSProperties,
    title: {
      fontSize: theme.typography.sizes.section,
      fontWeight: 600,
      color: "#0f172a",
    } as React.CSSProperties,
    body: {
      padding: "16px",
      background: theme.colors.surface,
    } as React.CSSProperties,
    pre: {
      margin: 0,
      whiteSpace: "pre-wrap" as const,
      wordBreak: "break-word" as const,
      fontFamily: theme.typography.fontFamily,
      fontSize: theme.typography.sizes.body,
      color: "#0f172a",
      lineHeight: theme.typography.lineHeights.normal,
    } as React.CSSProperties,
  };

  return (
    <AnimatePresence initial={false}>
      {isVisible && (
        <motion.div key="task-output" {...slideUp({ duration: 0.28 })} style={styles.card} whileHover={{ scale: 1.005 }}>
          <div style={styles.header}>
            <div style={styles.title}>{title}</div>
            <span style={{ background: "#ecfdf3", color: "#15803d", borderRadius: 999, padding: "4px 8px", fontSize: 12, fontWeight: 600 }}>✓ Completed</span>
          </div>
          <div style={styles.body}>
            <pre style={styles.pre}>{result}</pre>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
});

export default TaskOutput;
