// ==========================================
// APP THEME PROVIDER
// ==========================================
//
// Lightweight wrapper around Mantine's color scheme hook. Exposes a tiny
// context (`useAppTheme`) so any component can read the resolved scheme,
// set it, or toggle it. The scheme is persisted to localStorage by Mantine
// and the `data-mantine-color-scheme` attribute on <html> flips the CSS
// variables defined in App.css, re-skinning the whole app instantly.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useComputedColorScheme, useMantineColorScheme } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { getTheme } from "../api/backend";

export type ColorScheme = "light" | "dark" | "auto";

export const USER_ACCENT_PALETTES = [
  { name: "Corbel Gold", value: "#C9952A", description: "Studio Heritage Gold" },
  { name: "Sapphire Navy", value: "#2563EB", description: "Executive Professional" },
  { name: "Emerald Teal", value: "#059669", description: "Clean & Energetic" },
  { name: "Amethyst Purple", value: "#7C3AED", description: "Modern Creative" },
  { name: "Ruby Crimson", value: "#DC2626", description: "High-Visibility" },
  { name: "Amber Ochre", value: "#D97706", description: "Warm Merchant" },
] as const;

export type UserAccentColor = (typeof USER_ACCENT_PALETTES)[number]["value"];

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const r = parseInt(full.slice(0, 2), 16) || 0;
  const g = parseInt(full.slice(2, 4), 16) || 0;
  const b = parseInt(full.slice(4, 6), 16) || 0;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function getContrastingColor(hex: string): string {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const r = parseInt(full.slice(0, 2), 16) || 0;
  const g = parseInt(full.slice(2, 4), 16) || 0;
  const b = parseInt(full.slice(4, 6), 16) || 0;
  // Perceptual luminance calculation (ITU-R BT.709)
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b);
  return luminance > 165 ? "#0A0A0C" : "#ffffff";
}

function lightenHex(hex: string, percent: number): string {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  let r = parseInt(full.slice(0, 2), 16) || 0;
  let g = parseInt(full.slice(2, 4), 16) || 0;
  let b = parseInt(full.slice(4, 6), 16) || 0;
  r = Math.min(255, Math.round(r + (255 - r) * (percent / 100)));
  g = Math.min(255, Math.round(g + (255 - g) * (percent / 100)));
  b = Math.min(255, Math.round(b + (255 - b) * (percent / 100)));
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}

type AppThemeContext = {
  colorScheme: ColorScheme;
  setColorScheme: (scheme: ColorScheme) => void;
  toggleColorScheme: () => void;
  isDark: boolean;
  activeUserId: string | null;
  setActiveUserId: (id: string | null) => void;
  userAccent: string;
  setUserAccent: (accent: string) => void;
};

const Ctx = createContext<AppThemeContext | null>(null);

export function AppThemeProvider({ children }: { children: ReactNode }) {
  const { colorScheme, setColorScheme: mantineSetColorScheme } =
    useMantineColorScheme();
  const computed = useComputedColorScheme("light");
  const isDark = computed === "dark";

  const [activeUserId, setActiveUserIdState] = useState<string | null>(null);
  const [userAccent, setUserAccentState] = useState<string>(() => {
    if (typeof localStorage !== "undefined") {
      return localStorage.getItem("corbel_company_accent") || "#C9952A";
    }
    return "#C9952A";
  });

  // Load active company theme from backend on startup
  useEffect(() => {
    let cancelled = false;
    getTheme()
      .then((t) => {
        if (!cancelled && t?.accentColor) {
          setUserAccentState(t.accentColor);
          if (typeof localStorage !== "undefined") {
            localStorage.setItem("corbel_company_accent", t.accentColor);
          }
        }
      })
      .catch(() => {
        // Fall back to stored or default accent
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Listen for real-time theme updates dispatched from ThemeBrandingTab
  useEffect(() => {
    const handler = (e: Event) => {
      const custom = e as CustomEvent;
      if (custom?.detail?.accentColor) {
        const nextAccent = custom.detail.accentColor;
        setUserAccentState(nextAccent);
        if (typeof localStorage !== "undefined") {
          localStorage.setItem("corbel_company_accent", nextAccent);
          if (activeUserId) {
            localStorage.setItem(`corbel_accent_${activeUserId}`, nextAccent);
          }
        }
      }
    };
    window.addEventListener("corbel_theme_updated", handler);
    return () => window.removeEventListener("corbel_theme_updated", handler);
  }, [activeUserId]);

  // Apply user-scoped preferences whenever the active user changes
  const setActiveUserId = useCallback(
    (id: string | null) => {
      setActiveUserIdState(id);
      if (id) {
        // Load user-specific color scheme
        const savedScheme = localStorage.getItem(`corbel_color_scheme_${id}`);
        if (
          savedScheme === "light" ||
          savedScheme === "dark" ||
          savedScheme === "auto"
        ) {
          mantineSetColorScheme(savedScheme);
        }

        // Load user-specific accent color
        const savedAccent = localStorage.getItem(`corbel_accent_${id}`) ||
          localStorage.getItem("corbel_company_accent");
        if (savedAccent) {
          setUserAccentState(savedAccent);
        }
      }
    },
    [mantineSetColorScheme],
  );

  // Synchronize CSS custom properties with the user's accent color
  useEffect(() => {
    if (typeof document !== "undefined") {
      const bright = lightenHex(userAccent, 24);
      const onAccent = getContrastingColor(userAccent);
      const shadow = hexToRgba(userAccent, 0.35);
      const soft = hexToRgba(userAccent, isDark ? 0.20 : 0.12);

      document.documentElement.style.setProperty("--app-accent", userAccent);
      document.documentElement.style.setProperty("--app-accent-bright", bright);
      document.documentElement.style.setProperty("--app-accent-soft", soft);
      document.documentElement.style.setProperty("--app-accent-shadow", shadow);
      document.documentElement.style.setProperty("--app-on-accent", onAccent);
      document.documentElement.style.setProperty(
        "--app-accent-gradient",
        `linear-gradient(135deg, ${userAccent} 0%, ${bright} 100%)`,
      );
      // Legacy aliases
      document.documentElement.style.setProperty("--app-gold-deep", userAccent);
      document.documentElement.style.setProperty("--app-gold-soft", soft);
    }
  }, [userAccent, isDark]);

  const setColorScheme = useCallback(
    (scheme: ColorScheme) => {
      mantineSetColorScheme(scheme);
      if (activeUserId) {
        localStorage.setItem(`corbel_color_scheme_${activeUserId}`, scheme);
      }
    },
    [activeUserId, mantineSetColorScheme],
  );

  const toggleColorScheme = useCallback(() => {
    const nextScheme: ColorScheme = isDark ? "light" : "dark";
    setColorScheme(nextScheme);
  }, [isDark, setColorScheme]);

  const setUserAccent = useCallback(
    (accent: string) => {
      setUserAccentState(accent);
      if (typeof localStorage !== "undefined") {
        localStorage.setItem("corbel_company_accent", accent);
        if (activeUserId) {
          localStorage.setItem(`corbel_accent_${activeUserId}`, accent);
        }
      }
      if (typeof document !== "undefined") {
        document.documentElement.style.setProperty("--app-accent", accent);
        document.documentElement.style.setProperty(
          "--app-accent-soft",
          hexToRgba(accent, isDark ? 0.18 : 0.1),
        );
      }
    },
    [activeUserId, isDark],
  );

  const value = useMemo<AppThemeContext>(
    () => ({
      colorScheme: colorScheme as ColorScheme,
      setColorScheme,
      toggleColorScheme,
      isDark,
      activeUserId,
      setActiveUserId,
      userAccent,
      setUserAccent,
    }),
    [
      colorScheme,
      setColorScheme,
      toggleColorScheme,
      isDark,
      activeUserId,
      setActiveUserId,
      userAccent,
      setUserAccent,
    ],
  );

  return (
    <Ctx.Provider value={value}>
      <Notifications position="top-right" />
      {children}
    </Ctx.Provider>
  );
}

export function useAppTheme(): AppThemeContext {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAppTheme must be used inside AppThemeProvider");
  return ctx;
}

