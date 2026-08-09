// ==========================================
// APP THEME PROVIDER
// ==========================================
//
// Lightweight wrapper around Mantine's color scheme hook. Exposes a tiny
// context (`useAppTheme`) so any component can read the resolved scheme,
// set it, or toggle it. The scheme is persisted to localStorage by Mantine
// and the `data-mantine-color-scheme` attribute on <html> flips the CSS
// variables defined in App.css, re-skinning the whole app instantly.

import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { useComputedColorScheme, useMantineColorScheme } from "@mantine/core";
import { Notifications } from "@mantine/notifications";

type ColorScheme = "light" | "dark" | "auto";

type AppThemeContext = {
  colorScheme: ColorScheme;
  setColorScheme: (scheme: ColorScheme) => void;
  toggleColorScheme: () => void;
  isDark: boolean;
};

const Ctx = createContext<AppThemeContext | null>(null);

export function AppThemeProvider({ children }: { children: ReactNode }) {
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  const computed = useComputedColorScheme("light");
  const isDark = computed === "dark";

  const toggleColorScheme = useCallback(() => {
    setColorScheme(isDark ? "light" : "dark");
  }, [isDark, setColorScheme]);

  const value = useMemo<AppThemeContext>(
    () => ({
      colorScheme: colorScheme as ColorScheme,
      setColorScheme: setColorScheme as (s: ColorScheme) => void,
      toggleColorScheme,
      isDark,
    }),
    [colorScheme, setColorScheme, toggleColorScheme, isDark],
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
