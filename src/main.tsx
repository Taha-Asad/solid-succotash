// ==========================================
// APPLICATION ENTRY POINT
// ==========================================
//
// This is the FIRST file that runs when your app starts.
// It does three things:
//
//   1. Imports Mantine's CSS styles (Mantine needs these to look right)
//   2. Wraps your App in MantineProvider (gives every component access
//      to Mantine's theme, colors, spacing, etc.)
//   3. Mounts everything into the HTML div with id="root"
//
// MantineProvider must wrap your ENTIRE app, exactly once, at the top.
// If you nest a second MantineProvider inside, styles break.

import "@mantine/core/styles.css";
import "@mantine/notifications/styles.css";
import "./App.css";

import { MantineProvider } from "@mantine/core";
import { Notifications } from "@mantine/notifications";

import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { theme } from "./theme";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <MantineProvider theme={theme} forceColorScheme="light">
      {/* Notifications shows toast messages (success, error popups) */}
      <Notifications position="top-right" />
      <App />
    </MantineProvider>
  </React.StrictMode>,
);
