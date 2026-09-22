# Minimalist & Non-Technical UI/UX Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Overhaul the frontend UI/UX of `ijazandcompany` to match the airy, modern, human-crafted design of the Pinterest reference (Stella Walton dashboard), replacing rigid "AI slop" layouts with generous breathing room, collapsible sidebar toggle, a non-intrusive Dashboard Onboarding Checklist (eliminating the broken z-index tour), and a decomposed, human-friendly Settings Hub.

**Architecture:** 
1. Establish a soft aesthetic design system (`#F3F5F9` canvas, floating white cards, 18px radii, pill controls, subtle ambient shadows).
2. Introduce a collapsible AppShell with smooth sidebar width transitions (240px ↔ 68px icon rail) and uncluttered header.
3. Completely remove the intrusive, screen-locking `InteractiveTour.tsx` with its 4 overlay rects and z-index hacks, replacing it with a welcoming `DashboardOnboardingCard` widget on the Dashboard.
4. Modularize the 2,253-line `SettingsPage.tsx` into a 5-card Settings Hub (`CompanyProfileTab`, `InvoiceFbrTab`, `DataBackupTab`, `AppearanceTab`, `ModulesTab`) with clear breadcrumbs.

**Tech Stack:** React 19, TypeScript, Mantine v9, Framer Motion, Lucide React, Vite.

**Spec:** [Architectural Specification & Non-Technical UX Guide](file:///home/thefoolishcrow/.gemini/antigravity-cli/brain/e830fdf0-02a1-4967-b062-2aedc9ba5530/crow_parliament_sdlc_audit.md)

---

## Global Constraints
- Zero breaking changes to Tauri IPC command bindings (`invoke(...)`).
- Complete elimination of the screen-locking `InteractiveTour.tsx` to permanently solve all z-index collisions with Mantine modals and selects.
- All primary actions and text must use non-technical, human-friendly business terminology (e.g. "Sell", "Buy", "Backup to USB").
- TypeScript compilation must pass cleanly with `npm run build` (`tsc && vite build`).

## Review Focus
1. Collapsing the sidebar must not clip icon buttons or trigger horizontal scrollbars.
2. The Dashboard Onboarding Checklist must track real progress and be freely dismissible.
3. Settings sub-tabs must preserve all existing save/update operations (FBR, company, theme, backups).
4. Responsive behavior must look balanced on standard 1366x768 laptop displays as well as 1920x1080 desktops.
5. All interactive elements must maintain accessible contrast and touch-friendly padding.

---

### Task 1: Design Tokens & CSS Foundation
**Files:**
- Modify: `src/App.css`
- Modify: `src/theme.ts`

- [ ] Define the soft airy canvas background (`#F3F5F9` light, `#0E1322` dark) and floating card styles.
- [ ] Add utility classes for smooth pill inputs, ambient soft drop shadows, and generous card padding.
- [ ] Configure Mantine theme overrides for `border-radius: 18px` on cards and soft button styling.

---

### Task 2: Remove Intrusive Screen-Locking Tour
**Files:**
- Modify: `src/App.tsx`
- Modify: `src/onboarding/OnboardingProvider.tsx`
- Remove / bypass: `src/components/InteractiveTour.tsx`

- [ ] In `OnboardingProvider.tsx`, disable the automatic screen-dimming overlay and interactive tour mount.
- [ ] Retain the onboarding event bus listener (`bus.ts`) to quietly record user milestones (e.g. `hasAddedProduct`, `hasCreatedInvoice`, `hasCompanyProfile`) without blocking clicks.
- [ ] Verify that Mantine modals and selects no longer clash with z-index overrides.

---

### Task 3: Dashboard Hero & Getting-Started Onboarding Card
**Files:**
- Create: `src/features/dashboard/OnboardingCard.tsx`
- Modify: `src/features/dashboard/DashboardPage.tsx`

- [ ] Build `OnboardingCard.tsx` styled after the reference image's hero card ("Welcome back, Stella!").
- [ ] Include 4 clear setup steps:
  1. 🏢 *Setup Shop Profile* (Name, Phone, Tax NTN)
  2. 📦 *Add First Item* (or run Excel Import)
  3. 🧾 *Create First Invoice*
  4. 🛡️ *Save Safety Backup*
- [ ] Add progress indicator (e.g. "3 of 4 Ready"), quick action buttons that navigate to that screen, and a dismiss button ("×").
- [ ] Integrate into `DashboardPage.tsx` directly above the sales analytics.

---

### Task 4: Responsive AppShell with Sidebar Collapse Toggle
**Files:**
- Modify: `src/components/AppShell.tsx`

- [ ] Add `isCollapsed` state to `AppShell.tsx`, with a smooth toggle icon button in the sidebar header.
- [ ] When expanded: 240px width with brand name, tagline, navigation icons + labels.
- [ ] When collapsed: 68px width with icon rail and tooltip labels on hover.
- [ ] Modernize the topbar:
  - Clean pill search bar (`borderRadius: 9999px`) with generous internal padding.
  - Minimal date display on the right.
  - Unified action group for notifications, theme switch, language, and user profile.
- [ ] Apply generous padding and soft background to the main content container.

---

### Task 5: Modularize Settings Hub
**Files:**
- Create: `src/features/settings/SettingsHub.tsx`
- Create: `src/features/settings/tabs/CompanyProfileTab.tsx`
- Create: `src/features/settings/tabs/InvoiceFbrTab.tsx`
- Create: `src/features/settings/tabs/DataBackupTab.tsx`
- Create: `src/features/settings/tabs/AppearanceTab.tsx`
- Create: `src/features/settings/tabs/ModulesTab.tsx`
- Refactor: `src/features/settings/SettingsPage.tsx`

- [ ] Build `SettingsHub.tsx`: spacious 5-card grid with friendly icons, 1-line plain-English descriptions, and status pills.
- [ ] Extract company profile logic into `CompanyProfileTab.tsx`.
- [ ] Extract invoice design & FBR integration into `InvoiceFbrTab.tsx`.
- [ ] Extract 1-click backup & restore into `DataBackupTab.tsx`.
- [ ] Extract logo, theme colors, and language into `AppearanceTab.tsx`.
- [ ] Extract feature module switches into `ModulesTab.tsx`.
- [ ] Add a clean "← Back to Settings" header in each sub-view.
- [ ] Wire `SettingsPage.tsx` to render the Hub or the active sub-tab smoothly.

---

### Task 6: Verification & Build Check
**Files:**
- Run: `npm run build`

- [ ] Run `tsc && vite build` to verify 100% type safety and error-free bundle creation.
- [ ] Verify that no TypeScript or lint regressions exist.
- [ ] Present completion evidence to Taha.
