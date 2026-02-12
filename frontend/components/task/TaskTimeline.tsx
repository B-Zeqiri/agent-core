"use client";
import React, { useMemo } from "react";
import { motion } from "framer-motion";
import { fadeIn, slideUp, focusShift, combine } from "../../../motion/presets";
import { theme } from "../../../styles/theme";

export type TimelineState = "pending" | "active" | "completed" | "failed";

export type TimelineStep = {
  id: string;
  label: string;
  state: TimelineState;
};

export type TaskTimelineProps = {
  steps: TimelineStep[];
  onStepClick?: (step: TimelineStep) => void;
};

function marker(state: TimelineState): React.ReactNode {
  if (state === "completed") {
    return <span style={{ background: "#ecfdf3", color: "#15803d", padding: "2px 6px", borderRadius: 999, fontSize: 12, fontWeight: 600 }}>✓</span>;
  }
  if (state === "failed") {
    return <span style={{ background: "#fdecea", color: "#b91c1c", padding: "2px 6px", borderRadius: 999, fontSize: 12, fontWeight: 600 }}>✗</span>;
  }
  const dotStyle: React.CSSProperties = {
    width: 10,
    height: 10,
    borderRadius: 999,
    background: theme.colors.accent,
    boxShadow: state === "active" ? "0 0 0 6px rgba(37,99,235,0.15)" : "none",
  };
  return <div style={dotStyle} />;
}

function presetFor(state: TimelineState) {
  switch (state) {
    case "pending":
      return fadeIn({ duration: 0.25, from: 0.6 });
    case "active":
      return combine(fadeIn({ duration: 0.25 }), focusShift({ duration: 0.22 }));
    case "completed":
      return slideUp({ duration: 0.28, distance: 8 });
    case "failed":
      return slideUp({ duration: 0.28, distance: 8 });
    default:
      return fadeIn({ duration: 0.2 });
  }
}

const TaskTimeline = React.memo(function TaskTimeline({ steps, onStepClick }: TaskTimelineProps) {
  const styles = useMemo(() => ({
    wrap: {
      display: "grid",
      gridTemplateColumns: "1fr",
      gap: 12,
    } as React.CSSProperties,
    step: (state: TimelineState): React.CSSProperties => ({
      display: "flex",
      alignItems: "center",
      gap: 10,
      padding: "10px 12px",
      borderRadius: theme.radius.md,
      border: "1px solid #e5e7eb",
      background: state === "active" ? theme.colors.surfaceAlt : theme.colors.surface,
      boxShadow: state === "active" ? theme.shadows.soft : theme.shadows.subtle,
      opacity: state === "pending" ? 0.8 : 1,
      cursor: onStepClick ? "pointer" : "default",
    }) as React.CSSProperties,
    label: (state: TimelineState): React.CSSProperties => ({
      color: state === "failed" ? "#b91c1c" : "#0f172a",
      fontSize: theme.typography.sizes.body,
      fontWeight: state === "active" ? 600 : 500,
    }) as React.CSSProperties,
  }), [onStepClick]);

  return (
    <div style={styles.wrap}>
      {steps.map((s) => (
          <motion.div
          key={s.id}
          {...presetFor(s.state)}
          transition={{ type: 'spring', stiffness: 280, damping: 24 }}
          onClick={() => onStepClick?.(s)}
          style={styles.step(s.state)}
              whileHover={onStepClick ? { scale: 1.02 } : undefined}
              whileFocus={onStepClick ? { scale: 1.02 } : undefined}
        >
          {marker(s.state)}
          <div style={styles.label(s.state)}>{s.label}</div>
        </motion.div>
      ))}
    </div>
  );
});

export default TaskTimeline;
