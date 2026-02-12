"use client";
import React, { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { fadeIn } from "../../../motion/presets";
import { theme } from "../../../styles/theme";

export type AgentFeedbackProps = {
  message?: string;
  visible?: boolean; // controlled visibility
  autoHide?: boolean; // default true
  durationMs?: number; // default 1800ms
  onHidden?: () => void;
  style?: React.CSSProperties; // container style override
};

/**
 * AgentFeedback
 * Small inline messages like: "Agent selected", "Delegating task".
 * Fade in/out only.
 */
const AgentFeedback = React.memo(function AgentFeedback({
  message,
  visible,
  autoHide = true,
  durationMs = 1800,
  onHidden,
  style,
}: AgentFeedbackProps) {
  const [show, setShow] = useState<boolean>(!!visible);

  useEffect(() => {
    // Sync controlled visibility
    if (typeof visible === "boolean") setShow(visible);
  }, [visible]);

  useEffect(() => {
    if (!autoHide || !show) return;
    const t = setTimeout(() => {
      setShow(false);
      onHidden?.();
    }, durationMs);
    return () => clearTimeout(t);
  }, [autoHide, show, durationMs, onHidden]);

  const wrap: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "4px 8px",
    borderRadius: theme.radius.sm,
    background: theme.colors.surfaceAlt,
    border: "1px solid #e5e7eb",
  };

  const text: React.CSSProperties = {
    fontSize: theme.typography.sizes.meta,
    color: "#6b7280",
    fontWeight: 500,
  };

  return (
    <AnimatePresence initial={false}>
      {show && message && (
        <motion.div key="agent-feedback" {...fadeIn({ duration: 0.18 })} exit={{ opacity: 0, transition: { duration: 0.16 } }} style={{ ...wrap, ...(style || {}) }}>
          <span style={{ width: 6, height: 6, borderRadius: 999, background: theme.colors.accent }} />
          <span style={text}>{message}</span>
        </motion.div>
      )}
    </AnimatePresence>
  );
});

export default AgentFeedback;
