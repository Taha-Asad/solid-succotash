// ==========================================
// DESIGN TOKENS + MANTINE THEME
// ==========================================
//
// Single source of truth for the "Corbel ERP" look:
// a refined deep-navy brand with an antique-gold accent
// on a clean cool canvas. Modern, premium, data-first.

import { createTheme, type MantineColorsTuple } from "@mantine/core";

// ---- Brand palette (navy) ---------------------------------------------

const brand: MantineColorsTuple = [
  "#EEF2FA", // 0  lightest — page tints, hover washes
  "#DCE4F3", // 1
  "#B9C8E6", // 2
  "#8FA4D1", // 3
  "#6480BB", // 4
  "#45619F", // 5
  "#354C85", // 6
  "#283A6B", // 7
  "#1D2B54", // 8  primary — buttons, headers, active states
  "#131C39", // 9  deepest — hero gradients
];

// ---- Accent palette (gold) --------------------------------------------

const gold: MantineColorsTuple = [
  "#FDF7E3", // 0
  "#F8EDC4", // 1
  "#F0DD93", // 2
  "#E6C965", // 3
  "#D9B03F", // 4
  "#C9952A", // 5
  "#AC7922", // 6
  "#8C611C", // 7
  "#6B4A16", // 8
  "#4F3610", // 9
];

// ---- Dark-mode neutral scale (clean Neutral Obsidian / Zinc scale) --
// Pure obsidian / neutral darks with zero bluish saturation.

const dark: MantineColorsTuple = [
  "#FAFAFA", // 0  primary text (zinc-50)
  "#E4E4E7", // 1  zinc-200
  "#D4D4D8", // 2  zinc-300
  "#A1A1AA", // 3  zinc-400
  "#71717A", // 4  zinc-500
  "#52525B", // 5  zinc-600
  "#3F3F46", // 6  zinc-700
  "#27272A", // 7  body borders / soft (matches --app-border: zinc-800)
  "#141416", // 8  card / surface (matches --app-surface)
  "#0A0A0C", // 9  deepest background (matches --app-bg)
];

// ---- Semantic tokens used directly by pages ---------------------------
//
// The surface/text tokens below read CSS variables that switch with the
// Mantine color scheme (light/dark), so pages automatically adapt. Brand
// colours (navy, gold) stay fixed.

export const INK = {
  navy: "#1D2B54",
  navySoft: "var(--app-soft)",
  navyDeep: "#0E1530",
  accent: "var(--app-accent, #C9952A)",
  accentSoft: "var(--app-accent-soft, rgba(201, 149, 42, 0.16))",
  gold: "var(--app-accent, #C9952A)",
  goldSoft: "var(--app-accent-soft, rgba(201, 149, 42, 0.16))",
  goldDeep: "var(--app-accent, #C9952A)",
  goldBright: "var(--app-accent-bright, #E6C965)",
  gradient: "var(--app-accent-gradient, linear-gradient(135deg, #C9952A 0%, #E6C965 100%))",
  onAccent: "var(--app-on-accent, #0A0A0C)",
  paper: "var(--app-bg)",
  border: "var(--app-border)",
  muted: "var(--app-muted)",
  text: "var(--app-text)",
  textSoft: "var(--app-text-soft)",
  onPrimary: "var(--app-on-primary)",
  success: "#1E8E5A",
  danger: "#D64545",
  warning: "#C08A1E",
  // Graph / accent hues used across charts
  chart: {
    navy: "#1D2B54",
    gold: "var(--app-accent, #C9952A)",
    teal: "#12A5A0",
    violet: "#7C6FD0",
    rose: "#D15B8A",
    blue: "#4C7DD8",
    green: "#2FA36B",
    orange: "#E1903B",
    red: "#D64545",
    slate: "#8A94A8",
  },
};

// ---- Mantine theme ------------------------------------------------------

export const theme = createTheme({
  primaryColor: "brand",
  primaryShade: 8,
  defaultRadius: "md",
  fontFamily:
    'Inter, "Segoe UI", Roboto, -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif',
  fontFamilyMonospace:
    'ui-monospace, "SF Mono", "Roboto Mono", "JetBrains Mono", Menlo, monospace',
  headings: {
    fontWeight: "700",
  },
  colors: {
    brand,
    gold,
    dark,
  },
  components: {
    Card: {
      defaultProps: {
        radius: "lg",
        padding: "md",
      },
    },
    Paper: {
      defaultProps: {
        radius: "lg",
      },
    },
    Table: {
      defaultProps: {
        verticalSpacing: "sm",
        horizontalSpacing: "md",
      },
    },
    Chip: {
      styles: {
        label: {
          "&[data-checked]": {
            backgroundColor: "var(--app-accent) !important",
            color: "var(--app-on-accent, #ffffff) !important",
            borderColor: "var(--app-accent) !important",
          },
        },
        icon: {
          "&[data-checked]": {
            color: "var(--app-on-accent, #ffffff) !important",
          },
        },
      },
    },
  },
});
