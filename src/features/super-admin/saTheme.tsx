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
  bg: "#0B0F19",
  bgSidebar: "#111827",
  bgDock: "#15803D",
  dockActiveBg: "#22C55E",
  dockActiveColor: "#FFFFFF",
  dockInactiveColor: "#86EFAC",
  topbar: "#111827",
  panel: "#1F2937",
  panelStrong: "#374151",
  panelHover: "#283548",
  panelMint: "#0E3A2F",
  border: "#374151",
  borderStrong: "#4B5563",
  text: "#F9FAFB",
  textSoft: "#E5E7EB",
  muted: "#9CA3AF",
  accent: "#22C55E",
  accent2: "#3B82F6",
  accent3: "#10B981",
  cyan: "#06B6D4",
  violet: "#8B5CF6",
  gradient: "linear-gradient(135deg, #22C55E 0%, #16A34A 100%)",
  gradientText: "linear-gradient(135deg, #F9FAFB 0%, #22C55E 100%)",
  success: "#22C55E",
  danger: "#EF4444",
  warning: "#F59E0B",
  gold: "#F59E0B",
  shadow: "0 20px 50px -15px rgba(0, 0, 0, 0.85)",
};

const light: SaTokens = {
  bg: "#EDFAF3",
  bgSidebar: "#FFFFFF",
  bgDock: "#2BB673",
  dockActiveBg: "#FFFFFF",
  dockActiveColor: "#2BB673",
  dockInactiveColor: "rgba(255, 255, 255, 0.8)",
  topbar: "#FFFFFF",
  panel: "#FFFFFF",
  panelStrong: "#F8FAF9",
  panelHover: "#F1F5F9",
  panelMint: "#E8F8F0",
  border: "#E2E8F0",
  borderStrong: "#CBD5E1",
  text: "#1E293B",
  textSoft: "#334155",
  muted: "#94A3B8",
  accent: "#2BB673",
  accent2: "#3B82F6",
  accent3: "#10B981",
  cyan: "#06B6D4",
  violet: "#6366F1",
  gradient: "linear-gradient(135deg, #34C77B 0%, #2BB673 100%)",
  gradientText: "linear-gradient(135deg, #1E293B 0%, #2BB673 100%)",
  success: "#2BB673",
  danger: "#EF4444",
  warning: "#F59E0B",
  gold: "#F59E0B",
  shadow: "0 10px 30px -5px rgba(43, 182, 115, 0.12)",
};

export function getSaTheme(scheme: SaScheme): SaTokens {
  return scheme === "light" ? light : dark;
}

export function loadSaScheme(): SaScheme {
  try {
    const migrated = localStorage.getItem("sa-theme-migrated-slab-v1");
    if (!migrated) {
      localStorage.setItem("sa-theme-migrated-slab-v1", "true");
      localStorage.setItem(SA_THEME_KEY, "light");
      return "light";
    }
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
