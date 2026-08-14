// ==========================================
// ONBOARDING TUTORIAL — STEP SCRIPT
// ==========================================
//
// Unlike the old tour (which only pointed at things and said what they were),
// this tutorial teaches by DOING. Every "task" step is gated: the app is
// dimmed and locked, the user must actually perform the action (open the
// module, add a product, create an invoice, save settings) before they can
// move on — like a game tutorial.
//
// Real actions are detected through the onboarding event bus:
//   src/onboarding/bus.ts

import type { ReactNode } from "react";
import {
  Sparkles,
  Package,
  Boxes,
  Plus,
  FileSpreadsheet,
  ReceiptText,
  CheckCircle2,
  Settings2,
  PartyPopper,
  KeyRound,
  Save,
} from "lucide-react";

import type { OnboardingEvent } from "./bus";
import type { UserRole } from "../types/backend";

export interface OnboardingStep {
  id: string;
  /** "info" = read & continue. "task" = must perform the action first. */
  kind: "info" | "task";
  titleKey: string;
  contentKey: string;
  /** Hint shown on task steps while we are waiting for the action. */
  hintKey?: string;
  icon: ReactNode;
  /** CSS selector for the spotlighted element. */
  selector?: string;
  /**
   * When this element is present, it becomes the spotlight target instead of
   * `selector` (e.g. the Import Wizard replaces the inventory page once open).
   */
  freeRegion?: string;
  /** Centered card, no spotlight. */
  center?: boolean;
  /**
   * Roles that can perform this step. Steps without `roles` are shown to
   * everyone. Steps whose target is hidden for restricted roles (e.g. the
   * Import button) must be filtered out — otherwise a role that cannot
   * perform the action would be stuck behind an impossible task.
   */
  roles?: UserRole[];
  /** Event types that complete this task step. */
  completeOn?: OnboardingEvent["type"][];
  /** Richer completion matching (e.g. which module was opened). */
  matches?: (event: OnboardingEvent) => boolean;
}

// ----- Shared completion matchers -----------------------------------------

const navigateTo =
  (module: string) =>
  (event: OnboardingEvent): boolean =>
    event.type === "navigate" && event.module === module;

// ----- Login phase (shown only while the user is on the sign-in screen) ----

export const LOGIN_STEPS: OnboardingStep[] = [
  {
    id: "login",
    kind: "task",
    titleKey: "onb.login.title",
    contentKey: "onb.login.content",
    hintKey: "onb.login.hint",
    icon: <KeyRound size={26} />,
    selector: '[data-tour="login-form"]',
    completeOn: ["logged-in"],
  },
];

// ----- App phase (the full interactive walkthrough) ------------------------

export const APP_STEPS: OnboardingStep[] = [
  {
    id: "welcome",
    kind: "info",
    titleKey: "onb.welcome.title",
    contentKey: "onb.welcome.content",
    icon: <Sparkles size={28} />,
    center: true,
  },
  {
    id: "nav-inventory",
    kind: "task",
    titleKey: "onb.navInventory.title",
    contentKey: "onb.navInventory.content",
    hintKey: "onb.navInventory.hint",
    icon: <Package size={18} />,
    selector: '[data-tour="nav-inventory"]',
    matches: navigateTo("inventory"),
  },
  {
    id: "inventory-overview",
    kind: "info",
    titleKey: "onb.inventoryOverview.title",
    contentKey: "onb.inventoryOverview.content",
    icon: <Boxes size={18} />,
    selector: '[data-tour="content"]',
  },
  {
    id: "add-product",
    kind: "task",
    titleKey: "onb.addProduct.title",
    contentKey: "onb.addProduct.content",
    hintKey: "onb.addProduct.hint",
    icon: <Plus size={18} />,
    selector: '[data-tour="add-product"]',
    roles: ["owner", "admin"],
    completeOn: ["product-created"],
  },
  {
    id: "import",
    kind: "task",
    titleKey: "onb.import.title",
    contentKey: "onb.import.content",
    hintKey: "onb.import.hint",
    icon: <FileSpreadsheet size={18} />,
    selector: '[data-tour="import-button"]',
    freeRegion: '[data-tour="import-wizard"]',
    roles: ["owner", "admin"],
    completeOn: ["wizard-closed", "import-completed"],
  },
  {
    id: "nav-invoices",
    kind: "task",
    titleKey: "onb.navInvoices.title",
    contentKey: "onb.navInvoices.content",
    hintKey: "onb.navInvoices.hint",
    icon: <ReceiptText size={18} />,
    selector: '[data-tour="nav-invoices"]',
    matches: navigateTo("invoices"),
  },
  {
    id: "create-invoice",
    kind: "task",
    titleKey: "onb.createInvoice.title",
    contentKey: "onb.createInvoice.content",
    hintKey: "onb.createInvoice.hint",
    icon: <ReceiptText size={18} />,
    selector: '[data-tour="new-invoice"]',
    roles: ["owner", "admin"],
    completeOn: ["invoice-created"],
  },
  {
    id: "finalize-invoice",
    kind: "info",
    titleKey: "onb.finalizeInvoice.title",
    contentKey: "onb.finalizeInvoice.content",
    icon: <CheckCircle2 size={18} />,
    selector: '[data-tour="invoice-detail"]',
  },
  {
    id: "nav-settings",
    kind: "task",
    titleKey: "onb.navSettings.title",
    contentKey: "onb.navSettings.content",
    hintKey: "onb.navSettings.hint",
    icon: <Settings2 size={18} />,
    selector: '[data-tour="nav-settings"]',
    matches: navigateTo("settings"),
  },
  {
    id: "update-company",
    kind: "task",
    titleKey: "onb.updateCompany.title",
    contentKey: "onb.updateCompany.content",
    hintKey: "onb.updateCompany.hint",
    icon: <Save size={18} />,
    selector: '[data-tour="settings-save"]',
    completeOn: ["settings-saved"],
  },
  {
    id: "done",
    kind: "info",
    titleKey: "onb.done.title",
    contentKey: "onb.done.content",
    icon: <PartyPopper size={30} />,
    center: true,
  },
];

export const APP_TOTAL = APP_STEPS.length;
export const LOGIN_TOTAL = LOGIN_STEPS.length;

export function isAppStepComplete(
  step: OnboardingStep,
  event: OnboardingEvent,
): boolean {
  if (step.matches) {
    if (step.matches(event)) return true;
  }
  if (step.completeOn?.includes(event.type)) return true;
  return false;
}

/**
 * Drop steps the given role cannot perform. Steps that carry a `roles` list
 * are only kept when the user's role is in that list, mirroring the nav and
 * per-page `canManage` gating. This keeps the mandatory walkthrough from
 * blocking restricted roles on actions their UI never offers (e.g. Import).
 */
export function filterStepsForRole(
  steps: OnboardingStep[],
  role: UserRole | undefined,
): OnboardingStep[] {
  if (!role) return steps;
  return steps.filter((s) => !s.roles || s.roles.includes(role));
}
