"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.theme = void 0;
exports.toCSSVariables = toCSSVariables;
exports.applyThemeVariables = applyThemeVariables;
exports.theme = {
    colors: {
        background: "#f6f7fb",
        surface: "#ffffff",
        surfaceAlt: "#f3f4f6",
        accent: "#2563eb",
    },
    radius: {
        xs: "6px",
        sm: "8px",
        md: "12px",
        lg: "16px",
        xl: "20px",
    },
    shadows: {
        subtle: "0 2px 6px rgba(0,0,0,0.05)",
        soft: "0 6px 18px rgba(0,0,0,0.08)",
        medium: "0 10px 30px rgba(0,0,0,0.12)",
        strong: "0 16px 40px rgba(0,0,0,0.16)",
    },
    spacing: {
        none: "0px",
        xs: "4px",
        sm: "8px",
        md: "12px",
        lg: "16px",
        xl: "24px",
        xxl: "32px",
    },
    typography: {
        fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Noto Sans', 'Apple Color Emoji', 'Segoe UI Emoji'",
        weights: {
            regular: 400,
            medium: 500,
            semibold: 600,
            bold: 700,
        },
        sizes: {
            xs: "12px",
            sm: "13px",
            base: "14px",
            lg: "15px",
            xl: "18px",
            xxl: "24px",
            display: "30px",
            title: "30px",
            section: "18px",
            body: "14px",
            meta: "12px",
        },
        lineHeights: {
            tight: "1.2",
            snug: "1.3",
            normal: "1.5",
            relaxed: "1.7",
        },
    },
};
function toCSSVariables(t = exports.theme) {
    return {
        "--color-bg": t.colors.background,
        "--color-surface": t.colors.surface,
        "--color-surface-alt": t.colors.surfaceAlt,
        "--color-accent": t.colors.accent,
        "--radius-xs": t.radius.xs,
        "--radius-sm": t.radius.sm,
        "--radius-md": t.radius.md,
        "--radius-lg": t.radius.lg,
        "--radius-xl": t.radius.xl,
        "--shadow-subtle": t.shadows.subtle,
        "--shadow-soft": t.shadows.soft,
        "--shadow-medium": t.shadows.medium,
        "--shadow-strong": t.shadows.strong,
        "--space-none": t.spacing.none,
        "--space-xs": t.spacing.xs,
        "--space-sm": t.spacing.sm,
        "--space-md": t.spacing.md,
        "--space-lg": t.spacing.lg,
        "--space-xl": t.spacing.xl,
        "--space-xxl": t.spacing.xxl,
        "--font-family": t.typography.fontFamily,
        "--font-weight-regular": String(t.typography.weights.regular),
        "--font-weight-medium": String(t.typography.weights.medium),
        "--font-weight-semibold": String(t.typography.weights.semibold),
        "--font-weight-bold": String(t.typography.weights.bold),
        "--font-size-xs": t.typography.sizes.xs,
        "--font-size-sm": t.typography.sizes.sm,
        "--font-size-base": t.typography.sizes.base,
        "--font-size-lg": t.typography.sizes.lg,
        "--font-size-xl": t.typography.sizes.xl,
        "--font-size-xxl": t.typography.sizes.xxl,
        "--font-size-display": t.typography.sizes.display,
        "--font-size-title": t.typography.sizes.title,
        "--font-size-section": t.typography.sizes.section,
        "--font-size-body": t.typography.sizes.body,
        "--font-size-meta": t.typography.sizes.meta,
        "--line-tight": t.typography.lineHeights.tight,
        "--line-snug": t.typography.lineHeights.snug,
        "--line-normal": t.typography.lineHeights.normal,
        "--line-relaxed": t.typography.lineHeights.relaxed,
    };
}
function applyThemeVariables(vars = toCSSVariables()) {
    if (typeof document === "undefined")
        return;
    const root = document.documentElement;
    Object.entries(vars).forEach(([key, value]) => {
        root.style.setProperty(key, value);
    });
}
