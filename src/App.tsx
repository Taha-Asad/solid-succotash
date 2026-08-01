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
  // Container,
} from "@mantine/core";

import {
  getCurrentUser,
  getErrorMessage,
  isCompanySetup,
  logoutUser,
} from "./api/backend";

import SetupPage from "./features/auth/SetupPage";
import DashboardPage from "./features/dashboard/DashboardPage";

import LoginPage from "./features/auth/LoginPage";
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
        // (In desktop mode, the session lives in Rust's memory.
        //  If the app was restarted, no one is logged in.)
        try {
          const currentUser = await getCurrentUser();
          setUser(currentUser);
          setScreen("dashboard");
        } catch {
          // Not logged in — that's normal, not an error
          setScreen("login");
        }
      } catch (error) {
        setErrorMessage(getErrorMessage(error));
        setScreen("fatal-error");
      }
    }

    startup();
  }, []); // empty array = run once on mount

  // ---- HANDLERS PASSED TO CHILDREN ----

  function handleSetupComplete(
    newUser: PublicUser,
    _result: RegisterCompanyResult,
  ) {
    // Company was just created and owner is auto-logged in
    setUser(newUser);
    setScreen("dashboard");
  }

  function handleLogin(loggedInUser: PublicUser) {
    setUser(loggedInUser);
    setScreen("dashboard");
  }

  async function handleLogout() {
    try {
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
