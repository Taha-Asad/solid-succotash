// ==========================================
// DESIGN TOKENS + MANTINE THEME
// ==========================================
//
// Single source of truth for the "Ijaz & Company" look:
// a deep ink-navy brand with a warm antique-gold accent,
// on a soft warm paper background. Easy on the eyes,
// with enough formality to feel like a proper ledger.

import { createTheme, type MantineColorsTuple } from "@mantine/core";

// ---- Brand palette (navy) ---------------------------------------------

const brand: MantineColorsTuple = [
  "#EDF1FA", // 0  lightest — page tints, hover washes
  "#D9E1F2", // 1
  "#B4C2E4", // 2
  "#8CA0D2", // 3
  "#667CBE", // 4
  "#4A5FA3", // 5
  "#3B4E88", // 6
  "#2C3E6D", // 7
  "#1F3053", // 8  primary — buttons, headers, active states
  "#16213B", // 9  deepest — hero gradients
];

// ---- Accent palette (gold) --------------------------------------------

const gold: MantineColorsTuple = [
  "#FBF5E2", // 0
  "#F6EAC7", // 1
  "#EED99B", // 2
  "#E3C36C", // 3
  "#D7AC45", // 4
  "#C7952F", // 5
  "#AA7A24", // 6
  "#8F6D1D", // 7
  "#705516", // 8
  "#533F10", // 9
];

// ---- Semantic tokens used directly by the pages ------------------------

export const INK = {
  navy: brand[8],
  navySoft: "#2C406F",
  navyDeep: "#131B32",
  gold: "#BE9033",
  goldSoft: gold[1],
  goldDeep: "#8F6D1D",
  goldBright: "#E7C25E",
  paper: "#FBFAF6",
  border: "#E6E2D6",
  muted: "#687184",
  success: "#2F7D4F",
  danger: "#C2403C",
  warning: "#B0751C",
};

// ---- Mantine theme ------------------------------------------------------
//
// Mapping the brand into Mantine's color system means every built-in
// component (buttons, inputs, focus rings, tables, badges, alerts)
// inherits the navy/gold identity instead of the default blue.

export const theme = createTheme({
  primaryColor: "brand",
  primaryShade: 8,
  defaultRadius: "md",
  fontFamily:
    'Inter, "Segoe UI", Roboto, -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif',
  headings: {
    fontWeight: "700",
  },
  colors: {
    brand,
    gold,
  },
});
