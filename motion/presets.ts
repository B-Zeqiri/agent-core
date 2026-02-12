export type MotionPreset = {
  initial: Record<string, any>;
  animate: Record<string, any>;
  exit?: Record<string, any>;
  transition?: Record<string, any>;
};

/**
 * fadeIn
 * Opacity-based entrance/exit. Defaults to easing out over 300ms.
 */
export function fadeIn(options?: {
  delay?: number;
  duration?: number;
  from?: number; // starting opacity
  to?: number; // ending opacity
}): MotionPreset {
  const { delay = 0, duration = 0.3, from = 0, to = 1 } = options || {};
  return {
    initial: { opacity: from },
    animate: { opacity: to },
    exit: { opacity: 0 },
    transition: { duration, ease: "easeOut", delay },
  };
}

/**
 * slideUp
 * Y-translation entrance with slight opacity. Good for lists and messages.
 */
export function slideUp(options?: {
  delay?: number;
  duration?: number;
  distance?: number; // px to translate from
}): MotionPreset {
  const { delay = 0, duration = 0.35, distance = 12 } = options || {};
  return {
    initial: { opacity: 0, y: distance },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: distance },
    transition: { duration, ease: "easeOut", delay },
  };
}

/**
 * collapse
 * Content reveal/hide using scaleY and opacity. Works without layout dependencies.
 * Tip: apply CSS `overflow: hidden` to the container using this preset.
 */
export function collapse(options?: {
  delay?: number;
  duration?: number;
  originY?: number; // 0 (top) .. 1 (bottom)
}): MotionPreset {
  const { delay = 0, duration = 0.28, originY = 0 } = options || {};
  return {
    initial: { opacity: 0, scaleY: 0.96, transformOrigin: `50% ${originY * 100}%` },
    animate: { opacity: 1, scaleY: 1 },
    exit: { opacity: 0, scaleY: 0.96 },
    transition: { duration, ease: "easeOut", delay },
  };
}

/**
 * focusShift
 * Subtle scale + shadow emphasis for focused elements.
 */
export function focusShift(options?: {
  delay?: number;
  duration?: number;
  fromScale?: number;
  toScale?: number;
  shadow?: string; // CSS box-shadow string
}): MotionPreset {
  const { delay = 0, duration = 0.25, fromScale = 0.98, toScale = 1, shadow = "0 10px 30px rgba(37,99,235,0.18)" } = options || {};
  return {
    initial: { scale: fromScale, boxShadow: "none" },
    animate: { scale: toScale, boxShadow: shadow },
    exit: { scale: fromScale, boxShadow: "none" },
    transition: { duration, ease: "easeOut", delay },
  };
}

/**
 * Utility: combine presets (simple merge) for layered motions.
 */
export function combine(a: MotionPreset, b: MotionPreset): MotionPreset {
  return {
    initial: { ...(a.initial || {}), ...(b.initial || {}) },
    animate: { ...(a.animate || {}), ...(b.animate || {}) },
    exit: { ...(a.exit || {}), ...(b.exit || {}) },
    transition: { ...(a.transition || {}), ...(b.transition || {}) },
  };
}
