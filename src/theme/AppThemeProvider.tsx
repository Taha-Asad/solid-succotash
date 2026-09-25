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
  const [userAccent, setUserAccentState] = useState<string>("#C9952A");

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
        const savedAccent = localStorage.getItem(`corbel_accent_${id}`);
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
      document.documentElement.style.setProperty("--app-accent", userAccent);
      document.documentElement.style.setProperty(
        "--app-accent-soft",
        hexToRgba(userAccent, isDark ? 0.18 : 0.1),
      );
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
      if (activeUserId) {
        localStorage.setItem(`corbel_accent_${activeUserId}`, accent);
      }
    },
    [activeUserId],
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

