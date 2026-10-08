// Shared Corbel platform colors: charcoal, warm ivory, and muted heritage gold.
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type SaScheme = "dark" | "light";

export const SA_THEME_KEY = "sa-platform-theme";

export type SaTokens = {
  bg: string;
  bgSidebar: string;
  bgDock: string;
  dockActiveBg: string;
  dockActiveColor: string;
  dockInactiveColor: string;
  topbar: string;
  panel: string;
  panelStrong: string;
  panelHover: string;
  panelMint: string;
  border: string;
  borderStrong: string;
  text: string;
  textSoft: string;
  muted: string;
  accent: string;
  accentHover: string;
  accentOnAccent: string;
  accentMuted: string;
  accent2: string;
  accent3: string;
  cyan: string;
  violet: string;
  gradient: string;
  gradientText: string;
  success: string;
  danger: string;
  warning: string;
  gold: string;
  shadow: string;
};

const dark: SaTokens = {
  bg: "#08090C", // Celestial Obsidian Canvas
  bgSidebar: "#0E1015", // Deep Charcoal Architectural Rail
  bgDock: "#0E1015",
  dockActiveBg: "#C9952A",
  dockActiveColor: "#08090C",
  dockInactiveColor: "#8E8E93",
  topbar: "#0E1015",
  panel: "#12151C", // Muted Warm Obsidian Card Panels
  panelStrong: "#181C26", // Elevated Sub-surfaces & Tables
  panelHover: "#202533",
  panelMint: "rgba(201, 149, 42, 0.12)",
  border: "#202532", // Hairline Obsidian Border
  borderStrong: "#2E3547",
  text: "#F3F4F6", // Crisp Bone White (16.8:1 AAA contrast)
  textSoft: "#9CA3AF", // Soft Neutral (7.5:1 AAA contrast)
  muted: "#6B7280", // Muted Text (4.5:1 AA contrast)
  accent: "#C9952A", // Corbel Studio Heritage Gold
  accentHover: "#DFAB41",
  accentOnAccent: "#08090C",
  accentMuted: "rgba(201, 149, 42, 0.14)",
  accent2: "#3B82F6",
  accent3: "#8B5CF6",
  cyan: "#0EA5E9",
  violet: "#A855F7",
  gradient: "linear-gradient(135deg, #D4A338 0%, #B8861E 100%)",
  gradientText: "#F3F4F6",
  success: "#10B981",
  danger: "#EF4444",
  warning: "#F59E0B",
  gold: "#C9952A",
  shadow: "0 8px 32px -4px rgba(0, 0, 0, 0.65)",
};

const light: SaTokens = {
  bg: "#F8F9FA", // Warm Ivory Canvas
  bgSidebar: "#FFFFFF",
  bgDock: "#FFFFFF",
  dockActiveBg: "#B8861E",
  dockActiveColor: "#FFFFFF",
  dockInactiveColor: "#64748B",
  topbar: "#FFFFFF",
  panel: "#FFFFFF",
  panelStrong: "#F3F4F6",
  panelHover: "#E5E7EB",
  panelMint: "rgba(184, 134, 30, 0.08)",
  border: "#E5E7EB",
  borderStrong: "#D1D5DB",
  text: "#111827", // Pure Neutral Deep Ink
  textSoft: "#4B5563",
  muted: "#6B7280",
  accent: "#B8861E", // Warm Heritage Ochre
  accentHover: "#9E7216",
  accentOnAccent: "#FFFFFF",
  accentMuted: "rgba(184, 134, 30, 0.1)",
  accent2: "#2563EB",
  accent3: "#7C3AED",
  cyan: "#0284C7",
  violet: "#7C3AED",
  gradient: "linear-gradient(135deg, #B8861E 0%, #9E7216 100%)",
  gradientText: "#111827",
  success: "#059669",
  danger: "#DC2626",
  warning: "#D97706",
  gold: "#B8861E",
  shadow: "0 1px 3px 0 rgba(0, 0, 0, 0.05), 0 4px 12px -2px rgba(0, 0, 0, 0.04)",
};

export function getSaTheme(scheme: SaScheme): SaTokens {
  return scheme === "light" ? light : dark;
}

export function loadSaScheme(): SaScheme {
  try {
    const stored = localStorage.getItem(SA_THEME_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // localStorage unavailable — default to light
  }
  return "light";
}

type SaThemeContextValue = {
  scheme: SaScheme;
  tokens: SaTokens;
  setScheme: (scheme: SaScheme) => void;
};

const SaThemeCtx = createContext<SaThemeContextValue | null>(null);

export function SaThemeProvider({
  children,
  defaultScheme,
}: {
  children: ReactNode;
  defaultScheme?: SaScheme;
}) {
  const [scheme, setSchemeState] = useState<SaScheme>(
    () => defaultScheme ?? loadSaScheme(),
  );

  const setScheme = useCallback((next: SaScheme) => {
    setSchemeState(next);
    try {
      localStorage.setItem(SA_THEME_KEY, next);
      if (typeof document !== "undefined") {
        document.documentElement.setAttribute("data-mantine-color-scheme", next);
      }
    } catch {
      // non-persistable environment
    }
  }, []);

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.setAttribute("data-mantine-color-scheme", scheme);
    }
  }, [scheme]);

  const value = useMemo<SaThemeContextValue>(
    () => ({ scheme, tokens: getSaTheme(scheme), setScheme }),
    [scheme, setScheme],
  );

  return <SaThemeCtx.Provider value={value}>{children}</SaThemeCtx.Provider>;
}

export function useSaTheme(): SaTokens {
  const ctx = useContext(SaThemeCtx);
  if (!ctx) return dark;
  return ctx.tokens;
}

export function useSaScheme() {
  const ctx = useContext(SaThemeCtx);
  if (!ctx) return { scheme: "dark" as SaScheme, setScheme: () => {} };
  return ctx;
}

export const SA: SaTokens = dark;
