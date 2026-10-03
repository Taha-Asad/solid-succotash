// ==========================================
// SUPER ADMIN "PLATFORM" THEME TOKENS
// ==========================================
//
// The super admin console is the executive command deck of The Foolish Crow.
// Designed with crisp, physical surface architecture, high-contrast typography
// (WCAG 2.2 AA compliant), and zero muddy semi-transparent sludge.
//
// Supports Obsidian (Dark) and Daylight (Light) schemes with razor-sharp contrast.

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
  topbar: string;
  panel: string;
  panelStrong: string;
  panelHover: string;
  border: string;
  borderStrong: string;
  text: string;
  textSoft: string;
  muted: string;
  accent: string;
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
  bg: "#0B111E",
  bgSidebar: "#101726",
  topbar: "#101726",
  panel: "#162035",
  panelStrong: "#1F2D4A",
  panelHover: "#27385B",
  border: "#2E4066",
  borderStrong: "#3D5485",
  text: "#FFFFFF",
  textSoft: "#E2E8F0",
  muted: "#94A3B8",
  accent: "#38BDF8",
  accent2: "#818CF8",
  accent3: "#0284C7",
  cyan: "#38BDF8",
  violet: "#818CF8",
  gradient: "linear-gradient(135deg, #0284C7 0%, #2563EB 100%)",
  gradientText: "linear-gradient(135deg, #38BDF8 0%, #818CF8 100%)",
  success: "#34D399",
  danger: "#F87171",
  warning: "#FBBF24",
  gold: "#EAB308",
  shadow: "0 20px 50px -15px rgba(0, 0, 0, 0.7)",
};

const light: SaTokens = {
  bg: "#F8FAFC",
  bgSidebar: "#FFFFFF",
  topbar: "#FFFFFF",
  panel: "#FFFFFF",
  panelStrong: "#F1F5F9",
  panelHover: "#E2E8F0",
  border: "#E2E8F0",
  borderStrong: "#CBD5E1",
  text: "#0F172A",
  textSoft: "#334155",
  muted: "#64748B",
  accent: "#0284C7",
  accent2: "#4F46E5",
  accent3: "#0369A1",
  cyan: "#0284C7",
  violet: "#4F46E5",
  gradient: "linear-gradient(135deg, #0284C7 0%, #2563EB 100%)",
  gradientText: "linear-gradient(135deg, #0369A1 0%, #1D4ED8 100%)",
  success: "#059669",
  danger: "#DC2626",
  warning: "#D97706",
  gold: "#CA8A04",
  shadow: "0 16px 40px -16px rgba(15, 23, 42, 0.12)",
};

export function getSaTheme(scheme: SaScheme): SaTokens {
  return scheme === "light" ? light : dark;
}

export function loadSaScheme(): SaScheme {
  try {
    const stored = localStorage.getItem(SA_THEME_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // localStorage unavailable — default to dark
  }
  return "dark";
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
