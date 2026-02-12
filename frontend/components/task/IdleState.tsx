"use client";
import React, { useMemo } from "react";
import { motion } from "framer-motion";
import { fadeIn } from "../../../motion/presets";
import { theme } from "../../../styles/theme";

export type IdleStateProps = {
  title?: string;
  description?: string;
  ctaLabel?: string;
  onStart?: () => void;
  className?: string;
};

/**
 * IdleState
 * Calm message with subtle animated background and a CTA to start a task.
 */
const IdleState = React.memo(function IdleState({
  title = "Nothing running",
  description = "Calm system. Start a task when you're ready.",
  ctaLabel = "Start a task",
  onStart,
  className,
}: IdleStateProps) {
  const styles = useMemo(() => ({
    wrap: {
      position: "relative" as const,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      minHeight: "48vh",
      borderRadius: theme.radius.lg,
      overflow: "hidden",
      border: "1px solid #e5e7eb",
      background: theme.colors.surface,
      boxShadow: theme.shadows.subtle,
    },
    bg: {
      position: "absolute" as const,
      inset: 0,
      background: `radial-gradient(1200px 600px at 20% 20%, rgba(37,99,235,0.08), transparent 70%), radial-gradient(900px 500px at 80% 80%, rgba(37,99,235,0.06), transparent 70%)`,
      pointerEvents: "none" as const,
    },
    content: {
      position: "relative" as const,
      zIndex: 1,
      textAlign: "center" as const,
      padding: "24px",
    },
    title: {
      fontSize: theme.typography.sizes.section,
      fontWeight: 600,
      color: "#0f172a",
    },
    desc: {
      marginTop: 6,
      fontSize: theme.typography.sizes.body,
      color: "#6b7280",
    },
    actions: {
      marginTop: 12,
      display: "flex",
      justifyContent: "center",
    },
    button: {
      padding: "10px 14px",
      borderRadius: theme.radius.md,
      border: `1px solid ${theme.colors.accent}`,
      background: theme.colors.accent,
      color: "#ffffff",
      fontWeight: 600,
      cursor: "pointer",
      boxShadow: "0 10px 30px rgba(37,99,235,0.20)",
    },
  }), []);

  return (
    <motion.div
      {...fadeIn({ duration: 0.25 })}
      className={className}
      style={styles.wrap}
      aria-live="polite"
    >
      <motion.div
        style={styles.bg}
        animate={{ opacity: [0.8, 1, 0.9, 1] }}
        transition={{ duration: 4, ease: "easeInOut", repeat: Infinity }}
      />
      <div style={styles.content}>
        <div style={styles.title}>{title}</div>
        <div style={styles.desc}>{description}</div>
        <div style={styles.actions}>
          <motion.button whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.98 }} whileFocus={{ scale: 1.02 }} style={styles.button} onClick={onStart}>{ctaLabel}</motion.button>
        </div>
      </div>
    </motion.div>
  );
});

export default IdleState;
