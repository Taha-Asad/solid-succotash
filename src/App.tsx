// ==========================================
// APP ROOT — State machine that decides which screen to show
// ==========================================
//
// On startup, the app asks one question at a time:
//
//   1. Has a company been registered?
//      No  → show SetupPage
//      Yes → continue
//
//   2. Is a user currently logged in?
//      No  → show LoginPage
//      Yes → show DashboardPage
//
// This file does NOT contain any UI for those screens.
// It only decides WHICH screen to show, then renders it.
// The actual screens live in src/features/...

import { useEffect, useState } from "react";

import {
  Center,
  Loader,
  Stack,
  Text,
  Title,
  Button,
} from "@mantine/core";

import {
  getCurrentUser,
  getErrorMessage,
  isCompanySetup,
  logoutUser,
  loadSavedSession,
  saveSession,
  clearSavedSession,
} from "./api/backend";

import LoginPage from "./features/auth/LoginPage";
import SetupPage from "./features/auth/SetupPage";
import DashboardPage from "./features/dashboard/DashboardPage";

import type { PublicUser, RegisterCompanyResult } from "./types/backend";

// ==========================================
// POSSIBLE SCREENS
// ==========================================

type AppScreen =
  | "loading" // checking database on startup
  | "setup" // no company yet → first-time setup form
  | "login" // company exists but nobody logged in
  | "dashboard" // logged in → main app
  | "fatal-error"; // something went very wrong

// ==========================================
// MAIN COMPONENT
// ==========================================

function App() {
  const [screen, setScreen] = useState<AppScreen>("loading");
  const [user, setUser] = useState<PublicUser | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>("");

  // ---- STARTUP LOGIC ----
  // Runs once when the app window opens

  useEffect(() => {
    async function startup() {
      try {
        // Question 1: Has a company been set up?
        const hasCompany = await isCompanySetup();

        if (!hasCompany) {
          setScreen("setup");
          return;
        }

        // Question 2: Is someone already logged in?
        // First try the in-memory session (fast)
        try {
          const currentUser = await getCurrentUser();
          setUser(currentUser);
          setScreen("dashboard");
          return;
        } catch {
          // No in-memory session — that's normal after restart
        }

        // Question 3: Try to restore saved session from SQLite
        try {
          const savedUser = await loadSavedSession();
          setUser(savedUser);
          setScreen("dashboard");
          return;
        } catch {
          // No saved session — show login
        }

        setScreen("login");
      } catch (error) {
        setErrorMessage(getErrorMessage(error));
        setScreen("fatal-error");
      }
    }

    startup();
  }, []); // empty array = run once on mount

  // ---- HANDLERS PASSED TO CHILDREN ----

  async function handleLogin(loggedInUser: PublicUser) {
    setUser(loggedInUser);
    setScreen("dashboard");
    // Save session to SQLite so it survives restart
    try {
      await saveSession();
    } catch {
      // Non-critical — user just has to log in again next time
    }
  }

  function handleSetupComplete(
    newUser: PublicUser,
    _result: RegisterCompanyResult,
  ) {
    // Company was just created and owner is auto-logged in
    setUser(newUser);
    setScreen("dashboard");
    // Save session after first setup
    saveSession().catch(() => {});
  }

  async function handleLogout() {
    try {
      await clearSavedSession();
      await logoutUser();
    } catch {
      // Even if logout fails, clear local state
    }
    setUser(null);
    setScreen("login");
  }

  // ---- RENDER THE CORRECT SCREEN ----

  if (screen === "loading") {
    return (
      <Center h="100vh">
        <Stack align="center" gap="md">
          <Loader size="lg" />
          <Text c="dimmed">Starting Ijaz & Company...</Text>
        </Stack>
      </Center>
    );
  }

  if (screen === "fatal-error") {
    return (
      <Center h="100vh">
        <Stack align="center" gap="md">
          <Title order={3} c="red">
            Application Error
          </Title>
          <Text c="dimmed">{errorMessage}</Text>
          <Button onClick={() => window.location.reload()}>
            Restart Application
          </Button>
        </Stack>
      </Center>
    );
  }

  if (screen === "setup") {
    return <SetupPage onSetupComplete={handleSetupComplete} />;
  }

  if (screen === "login") {
    return <LoginPage onLogin={handleLogin} />;
  }

  // screen === "dashboard"
  if (user) {
    return <DashboardPage user={user} onLogout={handleLogout} />;
  }

  // Should never reach here, but just in case
  return (
    <Center h="100vh">
      <Text c="dimmed">Something unexpected happened.</Text>
    </Center>
  );
}

export default App;
