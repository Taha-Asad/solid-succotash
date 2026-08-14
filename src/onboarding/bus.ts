// ==========================================
// ONBOARDING EVENT BUS
// ==========================================
//
// A tiny module-level pub/sub so the interactive tutorial can detect when
// the user has REALLY performed an action — not just clicked "Next".
//
// Pages across the app call `reportOnboardingEvent(...)` at the exact moment
// a real task succeeds (product created, invoice finalized, settings saved,
// a module opened, …). The OnboardingProvider subscribes and advances the
// tutorial step as soon as the matching action is observed.

export type OnboardingEvent =
  | { type: "navigate"; module: string }
  | { type: "logged-in" }
  | { type: "product-created" }
  | { type: "wizard-opened" }
  | { type: "wizard-closed" }
  | { type: "import-completed" }
  | { type: "invoice-created" }
  | { type: "invoice-finalized" }
  | { type: "settings-saved" };

type Listener = (event: OnboardingEvent) => void;

const listeners = new Set<Listener>();

export function reportOnboardingEvent(event: OnboardingEvent): void {
  for (const listener of Array.from(listeners)) {
    try {
      listener(event);
    } catch {
      // A misbehaving listener must never break the caller.
    }
  }
}

export function subscribeOnboarding(
  listener: Listener,
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
