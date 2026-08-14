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
import "@mantine/dates/styles.css";
import "@mantine/notifications/styles.css";
import "./App.css";

import { MantineProvider } from "@mantine/core";

import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { theme } from "./theme";
import { AppThemeProvider } from "./theme/AppThemeProvider";
import { I18nProvider } from "./i18n/I18nProvider";
import ErrorBoundary from "./components/ErrorBoundary";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <I18nProvider>
        <MantineProvider theme={theme}>
          {/* AppThemeProvider syncs the scheme + hosts the Notifications layer */}
          <AppThemeProvider>
            <App />
          </AppThemeProvider>
        </MantineProvider>
      </I18nProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
