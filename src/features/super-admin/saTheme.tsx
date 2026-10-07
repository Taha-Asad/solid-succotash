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
  bg: "#121413",
  bgSidebar: "#181B19",
  bgDock: "#181B19",
  dockActiveBg: "#F08470",
  dockActiveColor: "#121413",
  dockInactiveColor: "#8E8A82",
  topbar: "#121413",
  panel: "#1A1D1B",
  panelStrong: "#242825",
  panelHover: "#2D322E",
  panelMint: "#33231F",
  border: "#2C312E",
  borderStrong: "#404642",
  text: "#F4F1EA",
  textSoft: "#A6A298",
  muted: "#76726A",
  accent: "#F08470", // Radiant Terracotta Ember (7.8:1 contrast on dark canvas)
  accentHover: "#F79B89",
  accentOnAccent: "#121413",
  accentMuted: "rgba(240, 132, 112, 0.12)",
  accent2: "#7E9BB8",
  accent3: "#B8A390",
  cyan: "#7AA2AD",
  violet: "#A192AB",
  gradient: "linear-gradient(135deg, #F08470 0%, #C85A46 100%)",
  gradientText: "#F4F1EA",
  success: "#4CAF50",
  danger: "#EF5350",
  warning: "#FFA726",
  gold: "#FFB74D",
  shadow: "0 10px 30px -8px rgba(0,0,0,0.5)",
};

const light: SaTokens = {
  bg: "#F7F5F0",
  bgSidebar: "#EDE9DF",
  bgDock: "#EDE9DF",
  dockActiveBg: "#B33924",
  dockActiveColor: "#FFFFFF",
  dockInactiveColor: "#6B7069",
  topbar: "#F7F5F0",
  panel: "#FFFFFF",
  panelStrong: "#F3EFE6",
  panelHover: "#EBE5D8",
  panelMint: "#FDF1EE",
  border: "#E2DDD2",
  borderStrong: "#C9C2B3",
  text: "#181B19",
  textSoft: "#4A5049",
  muted: "#70766E",
  accent: "#B33924", // Deep Burnt Terracotta (6.8:1 contrast on white and linen, zero wash-out!)
  accentHover: "#962D1A",
  accentOnAccent: "#FFFFFF",
  accentMuted: "rgba(179, 57, 36, 0.08)",
  accent2: "#48627E",
  accent3: "#7E6953",
  cyan: "#3F6B76",
  violet: "#6A5573",
  gradient: "linear-gradient(135deg, #B33924 0%, #8E2B1A 100%)",
  gradientText: "#181B19",
  success: "#2E7D32",
  danger: "#C62828",
  warning: "#E65100",
  gold: "#B26A00",
  shadow: "0 4px 20px -2px rgba(60, 50, 40, 0.06)",
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
