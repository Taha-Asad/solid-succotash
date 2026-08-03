// ==========================================
// DESIGN TOKENS + MANTINE THEME
// ==========================================
//
// Single source of truth for the "Ijaz & Company" look:
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

// ---- Semantic tokens used directly by pages ---------------------------

export const INK = {
  navy: "#1D2B54",
  navySoft: "#2E4178",
  navyDeep: "#0E1530",
  gold: "#C9952A",
  goldSoft: gold[1],
  goldDeep: "#8C611C",
  goldBright: "#E6C965",
  paper: "#F6F8FC",
  border: "#E3E8F1",
  muted: "#5C6B84",
  success: "#1E8E5A",
  danger: "#D64545",
  warning: "#C08A1E",
  // Graph / accent hues used across charts
  chart: {
    navy: "#1D2B54",
    gold: "#C9952A",
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
  },
  components: {
    Card: {
      defaultProps: {
        radius: "lg",
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
  },
});
