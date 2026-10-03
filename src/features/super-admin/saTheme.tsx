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
  bg: "#0B1411",
  bgSidebar: "#121E19",
  bgDock: "#19382B",
  dockActiveBg: "#2BB673",
  dockActiveColor: "#FFFFFF",
  dockInactiveColor: "#6EE7B7",
  topbar: "#121E19",
  panel: "#162720",
  panelStrong: "#1C3229",
  panelHover: "#233E33",
  panelMint: "#1F382E",
  border: "#244236",
  borderStrong: "#335E4D",
  text: "#F0FDF4",
  textSoft: "#BBF7D0",
  muted: "#86EFAC",
  accent: "#34D399",
  accent2: "#60A5FA",
  accent3: "#10B981",
  cyan: "#34D399",
  violet: "#818CF8",
  gradient: "linear-gradient(135deg, #34D399 0%, #059669 100%)",
  gradientText: "linear-gradient(135deg, #F0FDF4 0%, #34D399 100%)",
  success: "#34D399",
  danger: "#F87171",
  warning: "#FBBF24",
  gold: "#FBBF24",
  shadow: "0 20px 50px -15px rgba(0, 0, 0, 0.7)",
};

const light: SaTokens = {
  bg: "#F4F7F6",
  bgSidebar: "#FFFFFF",
  bgDock: "#2BB673",
  dockActiveBg: "#FFFFFF",
  dockActiveColor: "#2BB673",
  dockInactiveColor: "#E2FBEF",
  topbar: "#FFFFFF",
  panel: "#FFFFFF",
  panelStrong: "#F8FAF9",
  panelHover: "#F0F7F4",
  panelMint: "#EAF7F1",
  border: "#E8EEEC",
  borderStrong: "#D1DCD6",
  text: "#162D24",
  textSoft: "#3D5249",
  muted: "#7E938A",
  accent: "#2BB673",
  accent2: "#3B82F6",
  accent3: "#059669",
  cyan: "#2BB673",
  violet: "#6366F1",
  gradient: "linear-gradient(135deg, #2BB673 0%, #15803D 100%)",
  gradientText: "linear-gradient(135deg, #162D24 0%, #2BB673 100%)",
  success: "#2BB673",
  danger: "#EF4444",
  warning: "#F59E0B",
  gold: "#F59E0B",
  shadow: "0 8px 30px -10px rgba(0, 0, 0, 0.06)",
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
