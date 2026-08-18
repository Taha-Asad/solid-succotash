// ==========================================
// ONBOARDING PROVIDER — state machine + gating
// ==========================================
//
// Drives the interactive, mandatory-first-run tutorial.
//
// Phases:
//   login  → shown on the sign-in screen the first time (teaches login)
//   app    → the full walkthrough inside the workspace (login → import →
//            inventory → invoices → settings). Blocks the rest of the app
//            until every step is actually performed.
//   idle   → nothing shown (tutorial completed, or replay finished/skipped)
//
// Progress is persisted per user in localStorage, so a user who quits in the
// middle resumes exactly where they left off.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { subscribeOnboarding, type OnboardingEvent } from "./bus";
import {
  APP_STEPS,
  LOGIN_STEPS,
  filterStepsForRole,
  isAppStepComplete,
  type OnboardingStep,
} from "./onboardingSteps";
import type { UserRole } from "../types/backend";

import InteractiveTour from "../components/InteractiveTour";

// ----- Types ---------------------------------------------------------------

export type OnboardingPhase = "idle" | "login" | "app";

interface OnboardingContextValue {
  /** Starts the full walkthrough in non-mandatory (replay) mode. */
  startReplay: () => void;
}

// ----- Persistence keys ----------------------------------------------------

const LOGIN_SEEN_KEY = "ijaz_onboarding_login_seen";

function appProgressKey(userId: string): string {
  return `ijaz_onboarding_${userId}`;
}

function readStoredStep(userId: string): { done: boolean; step: number | null } {
  try {
    const raw = localStorage.getItem(appProgressKey(userId));
    if (!raw) {
      // Users who already went through the older "point & describe" tour are
      // established users — don't force the new mandatory walkthrough on them.
      if (localStorage.getItem(`ijaz_tour_seen_${userId}`) === "1") {
        return { done: true, step: null };
      }
      return { done: false, step: null };
    }
    const parsed = JSON.parse(raw) as { step?: number; done?: boolean };
    if (parsed.done) return { done: true, step: null };
    if (typeof parsed.step === "number" && parsed.step >= 0)
      return { done: false, step: parsed.step };
    return { done: false, step: 0 };
  } catch {
    return { done: false, step: null };
  }
}

function storeProgress(userId: string, step: number): void {
  try {
    localStorage.setItem(appProgressKey(userId), JSON.stringify({ step }));
  } catch {
    // non-persistable environment — tutorial simply restarts next time
  }
}

function storeDone(userId: string): void {
  try {
    localStorage.setItem(appProgressKey(userId), JSON.stringify({ done: true }));
  } catch {
    // non-persistable environment — no problem
  }
}

function markLoginSeen(): void {
  try {
    localStorage.setItem(LOGIN_SEEN_KEY, "1");
  } catch {
    // non-persistable environment — no problem
  }
}

function isLoginSeen(): boolean {
  try {
    return localStorage.getItem(LOGIN_SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

// ----- Context -------------------------------------------------------------

const OnboardingCtx = createContext<OnboardingContextValue | null>(null);

export function OnboardingProvider({
  screen,
  user,
  children,
}: {
  /** Which screen the app is currently showing. */
  screen: "loading" | "setup" | "login" | "dashboard" | "fatal-error";
  user: { id: string; role: UserRole; isSuperAdmin: boolean } | null;
  children: ReactNode;
}) {
  const [phase, setPhase] = useState<OnboardingPhase>("idle");
  const [stepIndex, setStepIndex] = useState(0);
  const [force, setForce] = useState(true);
  const [taskComplete, setTaskComplete] = useState(false);

  // The app walkthrough is filtered to the current role so restricted roles
  // are never asked to perform actions their UI does not offer (e.g. Import).
  const appSteps = useMemo(
    () => filterStepsForRole(APP_STEPS, user?.role),
    [user?.role],
  );

  const phaseRef = useRef<OnboardingPhase>(phase);
  const stepIndexRef = useRef(stepIndex);
  const taskCompleteRef = useRef(taskComplete);
  const userIdRef = useRef<string | null>(null);
  const forceRef = useRef(force);
  const appStepsRef = useRef<OnboardingStep[]>(appSteps);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);
  useEffect(() => {
    stepIndexRef.current = stepIndex;
  }, [stepIndex]);
  useEffect(() => {
    taskCompleteRef.current = taskComplete;
  }, [taskComplete]);
  useEffect(() => {
    forceRef.current = force;
  }, [force]);
  useEffect(() => {
    appStepsRef.current = appSteps;
  }, [appSteps]);

  const steps: OnboardingStep[] =
    phase === "login" ? LOGIN_STEPS : appSteps;
  const currentStep = phase === "idle" ? null : steps[stepIndex] ?? null;

  // ----- Reset a fresh phase ------------------------------------------------

  const startPhase = useCallback(
    (nextPhase: OnboardingPhase, startIndex: number, mandatory: boolean) => {
      setPhase(nextPhase);
      setStepIndex(startIndex);
      setForce(mandatory);
      setTaskComplete(false);
    },
    [],
  );

  // ----- Drive phase from the app screen -------------------------------------

  useEffect(() => {
    if (screen === "login") {
      if (!isLoginSeen()) {
        startPhase("login", 0, true);
      }
      return;
    }

    if (screen === "dashboard" && user && !user.isSuperAdmin) {
      // Reaching the dashboard means the user has gotten past login.
      markLoginSeen();
      userIdRef.current = user.id;

      const progress = readStoredStep(user.id);
      if (progress.done) {
        // Already finished the tutorial — nothing to show.
        setPhase((p) => (p === "app" || p === "login" ? "idle" : p));
        return;
      }

      // Fresh user → start from step 0; returning user → resume where they left off.
      startPhase("app", Math.min(progress.step ?? 0, appSteps.length - 1), true);
      return;
    }

    // setup / loading / fatal-error / super-admin dashboard → nothing
    setPhase((p) => (p === "app" || p === "login" ? "idle" : p));
  }, [screen, user, startPhase]);

  // ----- Listen for real user actions ----------------------------------------

  useEffect(() => {
    return subscribeOnboarding((event: OnboardingEvent) => {
      const p = phaseRef.current;
      if (p === "login") {
        if (event.type === "logged-in") {
          markLoginSeen();
          startPhase("idle", 0, true);
        }
        return;
      }

      if (p === "app") {
        const step = appStepsRef.current[stepIndexRef.current];
        if (!step) return;
        // Only mandatory mode performs/gates on real actions. Replay is
        // read-only: no task gating, no progress writes.
        if (step.kind === "task" && !taskCompleteRef.current && forceRef.current) {
          if (isAppStepComplete(step, event)) {
            setTaskComplete(true);
            if (userIdRef.current) {
              storeProgress(userIdRef.current, stepIndexRef.current);
            }
          }
        }
      }
    });
  }, [startPhase]);

  // ----- Deadlock guard: skip a task whose target can never appear -----------
  // (e.g. a restricted role without "Add Product"). Never blocks the user.
  // Timeout is 8 seconds to give slow page transitions ample time to mount.
  //
  // IMPORTANT: steps with a `completeOn` event are gated on the user actually
  // performing the action (e.g. add-product requires navigating to inventory
  // first). Auto-completing these would skip the step before the user reaches
  // the right page. Only auto-complete steps with NO completion event — those
  // are truly unreachable (e.g. a button hidden for the current role).

  useEffect(() => {
    if (phase !== "app") return;
    if (!forceRef.current) return;
    const step = appStepsRef.current[stepIndex];
    if (!step || step.kind !== "task") return;
    if (!step.selector || step.center) return;

    // Skip steps that have a user-action completion event — those should only
    // be completed by the user actually doing the work, never auto-completed.
    if (step.completeOn && step.completeOn.length > 0) return;

    const timer = window.setTimeout(() => {
      if (taskCompleteRef.current) return;
      // Only auto-complete if the element truly does not exist in the DOM
      // AND no Mantine modal is open (the target might be behind a modal).
      const modalOpen = document.querySelector("[data-modal-content]");
      if (modalOpen) return;
      if (!document.querySelector(step.selector!)) {
        setTaskComplete(true);
        if (userIdRef.current) storeProgress(userIdRef.current, stepIndex);
      }
    }, 8000);

    return () => window.clearTimeout(timer);
  }, [phase, stepIndex]);

  // ----- Actions --------------------------------------------------------------

  const next = useCallback(() => {
    const p = phaseRef.current;
    if (p === "idle") return;
    const list = p === "login" ? LOGIN_STEPS : appStepsRef.current;
    const step = list[stepIndexRef.current];
    if (!step) return;

    // Tasks must actually be performed first — but only in mandatory mode.
    // In replay mode the app is never locked, so "Continue" always advances.
    if (step.kind === "task" && !taskCompleteRef.current && forceRef.current)
      return;

    const isLast = stepIndexRef.current >= list.length - 1;
    if (isLast) {
      // Finished — persist and leave.
      if (p === "app" && userIdRef.current) {
        storeDone(userIdRef.current);
      }
      if (p === "login") markLoginSeen();
      setPhase("idle");
      return;
    }

    const nextIndex = stepIndexRef.current + 1;
    setStepIndex(nextIndex);
    setTaskComplete(false);
    if (p === "app" && userIdRef.current && forceRef.current) {
      storeProgress(userIdRef.current, nextIndex);
    }
  }, []);

  const close = useCallback(() => {
    // Closing is only reachable in replay mode (the mandatory tour hides the
    // close button and ignores Escape). Store "done" so a replay interrupted
    // midway does not force a fresh mandatory walkthrough on the next launch.
    setPhase("idle");
    if (userIdRef.current) storeDone(userIdRef.current);
  }, []);

  const startReplay = useCallback(() => {
    startPhase("app", 0, false);
  }, [startPhase]);

  const value = useMemo<OnboardingContextValue>(
    () => ({ startReplay }),
    [startReplay],
  );

  return (
    <OnboardingCtx.Provider value={value}>
      {children}

      {phase !== "idle" && currentStep && (
        <InteractiveTour
          steps={steps}
          stepIndex={stepIndex}
          force={force}
          taskComplete={taskComplete}
          onNext={next}
          onClose={close}
        />
      )}
    </OnboardingCtx.Provider>
  );
}

export function useOnboarding(): OnboardingContextValue {
  const ctx = useContext(OnboardingCtx);
  if (!ctx) throw new Error("useOnboarding must be used inside OnboardingProvider");
  return ctx;
}
