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
export const SA_CUSTOMIZER_KEY = "sa-platform-customizer-config";

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

export type AccentPreset = {
  key: string;
  name: string;
  hex: string;
  hover: string;
  gradient: string;
  onAccent: string;
};

export const ACCENT_PRESETS: AccentPreset[] = [
  {
    key: "gold",
    name: "Corbel Heritage Gold",
    hex: "#C9952A",
    hover: "#DFAB41",
    gradient: "linear-gradient(135deg, #D4A338 0%, #B8861E 100%)",
    onAccent: "#08090C",
  },
  {
    key: "emerald",
    name: "Emerald Sovereign",
    hex: "#10B981",
    hover: "#34D399",
    gradient: "linear-gradient(135deg, #10B981 0%, #059669 100%)",
    onAccent: "#08090C",
  },
  {
    key: "cobalt",
    name: "Cobalt Apex",
    hex: "#2563EB",
    hover: "#3B82F6",
    gradient: "linear-gradient(135deg, #3B82F6 0%, #1D4ED8 100%)",
    onAccent: "#FFFFFF",
  },
  {
    key: "amethyst",
    name: "Amethyst Royal",
    hex: "#8B5CF6",
    hover: "#A78BFA",
    gradient: "linear-gradient(135deg, #8B5CF6 0%, #6D28D9 100%)",
    onAccent: "#FFFFFF",
  },
  {
    key: "crimson",
    name: "Crimson Command",
    hex: "#EF4444",
    hover: "#F87171",
    gradient: "linear-gradient(135deg, #EF4444 0%, #DC2626 100%)",
    onAccent: "#FFFFFF",
  },
  {
    key: "mono",
    name: "Obsidian Neutral",
    hex: "#71717A",
    hover: "#A1A1AA",
    gradient: "linear-gradient(135deg, #71717A 0%, #52525B 100%)",
    onAccent: "#FFFFFF",
  },
];

export type CanvasToneKey = "pitch" | "charcoal" | "steel";

export type DensityMode = "comfortable" | "compact";

export type CockpitWidgetsConfig = {
  showQuickActions: boolean;
  showSystemTelemetry: boolean;
  showRecentTenants: boolean;
  showAuditStream: boolean;
};

export type SaCustomizerConfig = {
  accentKey: string;
  customHex?: string;
  canvasTone: CanvasToneKey;
  density: DensityMode;
  widgets: CockpitWidgetsConfig;
  brandTitle: string;
  brandSubtitle: string;
};

const DEFAULT_CONFIG: SaCustomizerConfig = {
  accentKey: "gold",
  customHex: undefined,
  canvasTone: "pitch",
  density: "comfortable",
  widgets: {
    showQuickActions: true,
    showSystemTelemetry: true,
    showRecentTenants: true,
    showAuditStream: true,
  },
  brandTitle: "Corbel",
  brandSubtitle: "by The Foolish Crow",
};

export function loadSaCustomizerConfig(): SaCustomizerConfig {
  try {
    const raw = localStorage.getItem(SA_CUSTOMIZER_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        ...DEFAULT_CONFIG,
        ...parsed,
        widgets: { ...DEFAULT_CONFIG.widgets, ...parsed.widgets },
      };
    }
  } catch {
    // ignore
  }
  return DEFAULT_CONFIG;
}

export function buildTokens(scheme: SaScheme, config: SaCustomizerConfig): SaTokens {
  const activePreset =
    ACCENT_PRESETS.find((p) => p.key === config.accentKey) ?? ACCENT_PRESETS[0];
  const accentHex = config.customHex?.trim() || activePreset.hex;
  const accentHover = activePreset.hover;
  const accentGradient = activePreset.gradient;
  const onAccent = activePreset.onAccent;

  if (scheme === "light") {
    return {
      bg: "#F8F9FA",
      bgSidebar: "#FFFFFF",
      bgDock: "#FFFFFF",
      dockActiveBg: accentHex,
      dockActiveColor: onAccent,
      dockInactiveColor: "#64748B",
      topbar: "#FFFFFF",
      panel: "#FFFFFF",
      panelStrong: "#F3F4F6",
      panelHover: "#E5E7EB",
      panelMint: `${accentHex}14`,
      border: "#E5E7EB",
      borderStrong: "#D1D5DB",
      text: "#111827",
      textSoft: "#4B5563",
      muted: "#6B7280",
      accent: accentHex,
      accentHover,
      accentOnAccent: onAccent,
      accentMuted: `${accentHex}18`,
      accent2: "#2563EB",
      accent3: "#7C3AED",
      cyan: "#0284C7",
      violet: "#7C3AED",
      gradient: accentGradient,
      gradientText: "#111827",
      success: "#059669",
      danger: "#DC2626",
      warning: "#D97706",
      gold: "#B8861E",
      shadow: "0 1px 3px 0 rgba(0, 0, 0, 0.05), 0 4px 12px -2px rgba(0, 0, 0, 0.04)",
    };
  }

  // Dark Canvas Tones
  let bg = "#08090C";
  let bgSidebar = "#0E1015";
  let panel = "#12151C";
  let panelStrong = "#181C26";
  let border = "#202532";
  let borderStrong = "#2E3547";

  if (config.canvasTone === "charcoal") {
    bg = "#121316";
    bgSidebar = "#18191E";
    panel = "#1E2026";
    panelStrong = "#252830";
    border = "#2B2E38";
    borderStrong = "#383C49";
  } else if (config.canvasTone === "steel") {
    bg = "#0B0E14";
    bgSidebar = "#11151F";
    panel = "#171C28";
    panelStrong = "#1E2434";
    border = "#252C3D";
    borderStrong = "#323B52";
  }

  return {
    bg,
    bgSidebar,
    bgDock: bgSidebar,
    dockActiveBg: accentHex,
    dockActiveColor: onAccent,
    dockInactiveColor: "#8E8E93",
    topbar: bgSidebar,
    panel,
    panelStrong,
    panelHover: "#202533",
    panelMint: `${accentHex}18`,
    border,
    borderStrong,
    text: "#F3F4F6",
    textSoft: "#9CA3AF",
    muted: "#6B7280",
    accent: accentHex,
    accentHover,
    accentOnAccent: onAccent,
    accentMuted: `${accentHex}20`,
    accent2: "#3B82F6",
    accent3: "#8B5CF6",
    cyan: "#0EA5E9",
    violet: "#A855F7",
    gradient: accentGradient,
    gradientText: "#F3F4F6",
    success: "#10B981",
    danger: "#EF4444",
    warning: "#F59E0B",
    gold: "#C9952A",
    shadow: "0 8px 32px -4px rgba(0, 0, 0, 0.65)",
  };
}

export function loadSaScheme(): SaScheme {
  try {
    const stored = localStorage.getItem(SA_THEME_KEY);
    if (stored === "light" || stored === "dark") return stored;
  } catch {
    // ignore
  }
  return "dark";
}

type SaThemeContextValue = {
  scheme: SaScheme;
  tokens: SaTokens;
  config: SaCustomizerConfig;
  setScheme: (scheme: SaScheme) => void;
  updateConfig: (partial: Partial<SaCustomizerConfig>) => void;
  toggleWidget: (key: keyof CockpitWidgetsConfig) => void;
  resetDefaults: () => void;
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
  const [config, setConfig] = useState<SaCustomizerConfig>(loadSaCustomizerConfig);

  const setScheme = useCallback((next: SaScheme) => {
    setSchemeState(next);
    try {
      localStorage.setItem(SA_THEME_KEY, next);
      if (typeof document !== "undefined") {
        document.documentElement.setAttribute("data-mantine-color-scheme", next);
      }
    } catch {
      // non-persistable
    }
  }, []);

  const updateConfig = useCallback((partial: Partial<SaCustomizerConfig>) => {
    setConfig((prev) => {
      const next = { ...prev, ...partial };
      try {
        localStorage.setItem(SA_CUSTOMIZER_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  const toggleWidget = useCallback((key: keyof CockpitWidgetsConfig) => {
    setConfig((prev) => {
      const next: SaCustomizerConfig = {
        ...prev,
        widgets: {
          ...prev.widgets,
          [key]: !prev.widgets[key],
        },
      };
      try {
        localStorage.setItem(SA_CUSTOMIZER_KEY, JSON.stringify(next));
      } catch {
        // ignore
      }
      return next;
    });
  }, []);

  const resetDefaults = useCallback(() => {
    setConfig(DEFAULT_CONFIG);
    try {
      localStorage.setItem(SA_CUSTOMIZER_KEY, JSON.stringify(DEFAULT_CONFIG));
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    if (typeof document !== "undefined") {
      document.documentElement.setAttribute("data-mantine-color-scheme", scheme);
    }
  }, [scheme]);

  const tokens = useMemo(
    () => buildTokens(scheme, config),
    [scheme, config],
  );

  const value = useMemo<SaThemeContextValue>(
    () => ({
      scheme,
      tokens,
      config,
      setScheme,
      updateConfig,
      toggleWidget,
      resetDefaults,
    }),
    [scheme, tokens, config, setScheme, updateConfig, toggleWidget, resetDefaults],
  );

  return <SaThemeCtx.Provider value={value}>{children}</SaThemeCtx.Provider>;
}

export function useSaTheme(): SaTokens {
  const ctx = useContext(SaThemeCtx);
  return ctx ? ctx.tokens : buildTokens("dark", DEFAULT_CONFIG);
}

export function useSaScheme() {
  const ctx = useContext(SaThemeCtx);
  if (!ctx) {
    return {
      scheme: "dark" as SaScheme,
      setScheme: () => {},
    };
  }
  return { scheme: ctx.scheme, setScheme: ctx.setScheme };
}

export function useSaCustomizer() {
  const ctx = useContext(SaThemeCtx);
  if (!ctx) {
    return {
      config: DEFAULT_CONFIG,
      updateConfig: () => {},
      toggleWidget: () => {},
      resetDefaults: () => {},
    };
  }
  return {
    config: ctx.config,
    updateConfig: ctx.updateConfig,
    toggleWidget: ctx.toggleWidget,
    resetDefaults: ctx.resetDefaults,
  };
}

export const SA: SaTokens = buildTokens("dark", DEFAULT_CONFIG);
