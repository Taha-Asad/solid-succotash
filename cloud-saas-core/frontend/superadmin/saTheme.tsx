// ==========================================
// SUPER ADMIN "PLATFORM" THEME TOKENS
// ==========================================
//
// The super admin console is intentionally a *different* product surface
// from the tenant workspace. It lives on a deep obsidian canvas with a
// cyan→indigo glow accent (vs. the navy/gold of the company UI) so it
// feels like an entirely separate command center, not a reskin.
//
// The platform supports both a dark "Obsidian" scheme (default) and a
// light scheme. Tokens are resolved through `SaThemeProvider` so every
// platform page can read the active palette via `useSaTheme()`.

import {
  createContext,
  useCallback,
  useContext,
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
  bg: "#05070F",
  bgSidebar: "rgba(9, 13, 26, 0.96)",
  topbar: "rgba(5, 7, 15, 0.6)",
  panel: "rgba(255, 255, 255, 0.035)",
  panelStrong: "rgba(255, 255, 255, 0.06)",
  panelHover: "rgba(255, 255, 255, 0.09)",
  border: "rgba(255, 255, 255, 0.09)",
  borderStrong: "rgba(255, 255, 255, 0.16)",
  text: "#E7ECF8",
  textSoft: "#9AA6C4",
  muted: "#5B6781",
  accent: "#38BDF8",
  accent2: "#818CF8",
  accent3: "#22D3EE",
  cyan: "#22D3EE",
  violet: "#818CF8",
  gradient: "linear-gradient(135deg, #38BDF8 0%, #818CF8 100%)",
  gradientText: "linear-gradient(135deg, #7DD3FC 0%, #A5B4FC 100%)",
  success: "#34D399",
  danger: "#F87171",
  warning: "#FBBF24",
  gold: "#C9952A",
  shadow: "0 24px 70px -24px rgba(0, 0, 0, 0.7)",
};

const light: SaTokens = {
  bg: "#EEF2FB",
  bgSidebar: "#FFFFFF",
  topbar: "rgba(255, 255, 255, 0.75)",
  panel: "#FFFFFF",
  panelStrong: "#F1F5FB",
  panelHover: "#E7EDF9",
  border: "rgba(15, 23, 42, 0.09)",
  borderStrong: "rgba(15, 23, 42, 0.16)",
  text: "#0F172A",
  textSoft: "#475569",
  muted: "#94A3B8",
  accent: "#0284C7",
  accent2: "#6366F1",
  accent3: "#0EA5E9",
  cyan: "#0284C7",
  violet: "#6366F1",
  gradient: "linear-gradient(135deg, #38BDF8 0%, #818CF8 100%)",
  gradientText: "linear-gradient(135deg, #0369A1 0%, #4F46E5 100%)",
  success: "#059669",
  danger: "#DC2626",
  warning: "#B45309",
  gold: "#A16207",
  shadow: "0 24px 70px -24px rgba(15, 23, 42, 0.18)",
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
    } catch {
      // non-persistable environment — no problem
    }
  }, []);

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

// Backward-compatible export used anywhere tokens are needed without a hook.
export const SA: SaTokens = dark;

export const SA_NAV = [
  {
    id: "overview",
    labelKey: "sa.nav.overview",
    section: "platform",
  },
  {
    id: "tenants",
    labelKey: "sa.nav.tenants",
    section: "platform",
  },
  {
    id: "packages",
    labelKey: "sa.nav.packages",
    section: "platform",
  },
];
