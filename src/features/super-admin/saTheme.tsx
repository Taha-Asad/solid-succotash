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
  "bg": "#161817",
  "bgSidebar": "#1D201E",
  "bgDock": "#1D201E",
  "dockActiveBg": "#EB8A7E",
  "dockActiveColor": "#161817",
  "dockInactiveColor": "#939690",
  "topbar": "#161817",
  "panel": "#222523",
  "panelStrong": "#2A2E2C",
  "panelHover": "#313634",
  "panelMint": "#3A2E2A",
  "border": "#343836",
  "borderStrong": "#494E4B",
  "text": "#EDEAE4",
  "textSoft": "#B8B5AE",
  "muted": "#8A8780",
  "accent": "#EB8A7E",
  "accent2": "#8FA7BF",
  "accent3": "#BFAFA0",
  "cyan": "#88A9B2",
  "violet": "#A99CB1",
  "gradient": "#EB8A7E",
  "gradientText": "#EDEAE4",
  "success": "#8A9E8C",
  "danger": "#E57373",
  "warning": "#E0A953",
  "gold": "#DDA658",
  "shadow": "0 12px 30px rgba(0,0,0,0.3)"
};

const light: SaTokens = {
  "bg": "#F4F0EA",
  "bgSidebar": "#EBE7DE",
  "bgDock": "#EBE7DE",
  "dockActiveBg": "#E0725F",
  "dockActiveColor": "#FFFFFF",
  "dockInactiveColor": "#757973",
  "topbar": "#F4F0EA",
  "panel": "#FFFFFF",
  "panelStrong": "#F8F6F1",
  "panelHover": "#F1EDE6",
  "panelMint": "#F4EAE6",
  "border": "#E3DDD3",
  "borderStrong": "#CBC4B6",
  "text": "#2D312E",
  "textSoft": "#5C605B",
  "muted": "#82857E",
  "accent": "#E0725F",
  "accent2": "#5A738E",
  "accent3": "#8E7C68",
  "cyan": "#557E88",
  "violet": "#7A6882",
  "gradient": "#E0725F",
  "gradientText": "#2D312E",
  "success": "#6E8B75",
  "danger": "#D9534F",
  "warning": "#D97706",
  "gold": "#C28B38",
  "shadow": "0 8px 24px -4px rgba(60, 50, 40, 0.05)"
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
