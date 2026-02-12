"use client";
import React, { useCallback, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { fadeIn, slideUp, focusShift } from "../../../motion/presets";
import { theme } from "../../../styles/theme";

export type TaskInputProps = {
  placeholder?: string;
  initialValue?: string;
  onSubmit?: (text: string) => Promise<{ taskId?: string } | void> | { taskId?: string } | void;
};

type SubmitResult = { taskId?: string } | void;

/**
 * TaskInput
 * Large, centered input with subtle focus animation.
 * Enter submits; on submit the input compresses/fades and transforms into a task card.
 */
export default function TaskInput({ placeholder = "What do you want to get done?", initialValue = "", onSubmit }: TaskInputProps) {
  const [value, setValue] = useState(initialValue);
  const [focused, setFocused] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submittedText, setSubmittedText] = useState<string | null>(null);
  const [taskId, setTaskId] = useState<string | undefined>(undefined);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const styles = useMemo(() => ({
    container: {
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      minHeight: "60vh",
      padding: theme.spacing.lg,
    } as React.CSSProperties,
    inputWrap: {
      width: "100%",
      maxWidth: 800,
      borderRadius: theme.radius.lg,
      background: theme.colors.surface,
      border: `1px solid #e5e7eb`,
      boxShadow: focused ? theme.shadows.medium : theme.shadows.subtle,
      transition: "box-shadow 200ms ease",
      overflow: "hidden",
    } as React.CSSProperties,
    textarea: {
      width: "100%",
      padding: "18px 20px",
      fontFamily: theme.typography.fontFamily,
      fontSize: theme.typography.sizes.title,
      lineHeight: theme.typography.lineHeights.relaxed,
      border: "none",
      outline: "none",
      resize: "none" as const,
      color: "#0f172a",
      background: theme.colors.surface,
    },
    footerRow: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      padding: "10px 16px",
      borderTop: "1px solid #e5e7eb",
      background: theme.colors.surfaceAlt,
      fontSize: theme.typography.sizes.meta,
      color: "#6b7280",
    } as React.CSSProperties,
    card: {
      width: "100%",
      maxWidth: 800,
      borderRadius: theme.radius.lg,
      background: theme.colors.surface,
      border: `1px solid #e5e7eb`,
      boxShadow: theme.shadows.soft,
      overflow: "hidden",
    } as React.CSSProperties,
    cardHeader: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      padding: "12px 16px",
      borderBottom: "1px solid #e5e7eb",
      background: theme.colors.surfaceAlt,
    } as React.CSSProperties,
    badgeReady: {
      background: "#ecfdf3",
      color: "#15803d",
      borderRadius: 999,
      padding: "4px 8px",
      fontSize: 12,
      fontWeight: 600,
    } as React.CSSProperties,
    body: {
      padding: "16px",
      whiteSpace: "pre-wrap" as const,
      color: "#0f172a",
      fontSize: theme.typography.sizes.body,
    } as React.CSSProperties,
    actions: {
      display: "flex",
      gap: 8,
      padding: "8px 12px",
    } as React.CSSProperties,
    button: {
      padding: "8px 12px",
      borderRadius: theme.radius.sm,
      border: "1px solid #e5e7eb",
      background: theme.colors.surface,
      cursor: "pointer",
    } as React.CSSProperties,
    primary: {
      background: theme.colors.accent,
      color: "#fff",
      borderColor: theme.colors.accent,
    } as React.CSSProperties,
  }), [focused]);

  const submit = useCallback(async () => {
    const text = value.trim();
    if (!text || isSubmitting) return;
    setIsSubmitting(true);

    // Animate: compress + fade then transform into card by toggling submitted state.
    setSubmittedText(text);

    try {
      const result: SubmitResult = await onSubmit?.(text);
      const id = (result && (result as { taskId?: string }).taskId) || undefined;
      if (id) setTaskId(id);
    } finally {
      setIsSubmitting(false);
    }
  }, [value, isSubmitting, onSubmit]);

  return (
    <div style={styles.container}>
      <AnimatePresence initial={false}>
        {!submittedText && (
          <motion.div
            key="input-wrap"
            {...fadeIn({ duration: 0.25 })}
            exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.22, ease: "easeOut" } }}
            whileHover={{ scale: 1.005 }}
            style={styles.inputWrap}
          >
            <motion.textarea
              {...focusShift({ duration: 0.18 })}
              value={value}
              ref={inputRef}
              placeholder={placeholder}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setValue(e.target.value)}
              onKeyDown={(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
              rows={3}
              style={styles.textarea}
            />
            <div style={styles.footerRow}>
              <span>Press Enter to submit • Shift+Enter for newline</span>
              <motion.button
                whileHover={{ scale: isSubmitting ? 1 : 1.03 }}
                whileTap={{ scale: isSubmitting ? 1 : 0.98 }}
                whileFocus={{ scale: isSubmitting ? 1 : 1.02 }}
                style={{ ...styles.button, ...(isSubmitting ? {} : styles.primary) }}
                onClick={submit}
                disabled={isSubmitting}
              >
                {isSubmitting ? "Submitting…" : "Send"}
              </motion.button>
            </div>
          </motion.div>
        )}

        {submittedText && (
          <motion.div key="task-card" {...slideUp({ duration: 0.28 })} style={styles.card}>
            <div style={styles.cardHeader}>
              <div style={{ fontWeight: 600, fontSize: theme.typography.sizes.section }}>Task</div>
              <span style={styles.badgeReady}>{taskId ? `Queued: ${taskId}` : "Queued"}</span>
            </div>
            <div style={styles.body}>{submittedText}</div>
            <div style={styles.actions}>
              <motion.button whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.98 }} whileFocus={{ scale: 1.02 }} style={styles.button} onClick={() => navigator.clipboard.writeText(submittedText || "")}>Copy</motion.button>
              <motion.button whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.98 }} whileFocus={{ scale: 1.02 }} style={{ ...styles.button, ...styles.primary }} onClick={() => setSubmittedText(null)}>Run Again</motion.button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
