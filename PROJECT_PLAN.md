# Ijaz & Company ERP — Project Plan (v1.0.2 → v1.1.0 Launch)

> Status: ACTIVE — created 2026-08-06. Companion to `PROJECT_ANALYSIS.md`.
> Direction: **Finish & ship the single-tenant desktop ERP to one real business**
> before any SaaS/platform work (mentor directive: stop architecting, ship, get a customer).
> FBR scope: **QR on invoice now; IRN/queue/retry pipeline later** (needs sandbox credentials).

---

## 1. Working Principle

> *"You're a solo developer. Don't compete with SAP/Oracle/Dynamics.
> Compete with Excel + WhatsApp + paper registers."*

Every work item below answers one question: **does it help a real business switch to us?**
If it only grows architecture, it goes to `FUTURE_FEATURES.md`, not this plan.

Cadence: one small shippable slice per day (tracked as todos), not weekly mega-tasks.
Validation: one real business (father's) live on the app = the definition of done for v1.1.0.

---

## 2. Work Packages by Importance

### 🔴 P0 — CRITICAL (blocks launch)
| # | Item | What | How |
|---|------|------|-----|
| 1 | Import safety layer | `import_jobs` lifecycle written; `import_batch_id` tagging; 24h `rollback_import`; conflict strategy `skip/overwrite/suffix`; `dry_run` preview mode; file-size/row quotas | `import_wizard.rs` + migration 014; new `ImportRequest` fields; new `rollback_import` + `list_import_jobs` commands |
| 2 | Import UI wiring | Target picker (Products/Customers/Opening Stock/Suppliers); pass `target` through IPC; target-aware hints + results; preview→confirm panel | `ImportWizard.tsx`, `backend.ts`; replace hard-coded product gates |
| 3 | FBR QR on invoice | FBR-standard QR (invoice no, date, seller/buyer NTN, amounts, tax) as SVG in invoice HTML; `show_qr` toggle in invoice settings | `qrcode` crate; `invoices.rs` FBR section; `company_invoice_settings`; settings UI |
| 4 | Print/PDF polish | Print via Tauri `WebviewWindow` + `window.print()` (Save-as-PDF); use returned HTML path; branded template | `invoices.rs` (use `app_handle`), `InvoicePage.tsx` `handlePrint` |
| 5 | Ship + validate | v1.1.0 release; install on father's business; onboard via import wizard + theme/logo; 2-week feedback loop | Release pipeline; onboarding runbook |

### 🟠 P1 — HIGH (completes the feature set)
| # | Item | What | How |
|---|------|------|-----|
| 6 | Suppliers target | `suppliers` import target reusing resolve-or-create pattern | `import_wizard.rs` + `detect_supplier_field` |
| 7 | Units module | Managed units table + picker on product form (replaces free-text) | migration 014 + `inventory.rs` + product UI |
| 8 | Missing tests | Automated coverage for notifications/retention/search/theme | new test modules |

### 🟡 P2 — MEDIUM (hardening & hygiene)
| # | Item | What | How |
|---|------|------|-----|
| 9 | Dead code & deps | Remove `BackendTester.tsx`; strip `lib.rs:1-111`; trim `tauri-plugin-sql`, sqlx postgres/dotenv; tighten `withGlobalTauri` | file edits + Cargo.toml |
| 10 | CI/quality | Clippy-clean (~50 warnings), `cargo audit` in CI, commit the 2026-08-06 fmt diff separately | clippy config, release.yml |

### 📄 P3 — DOCUMENTS (mentor discipline — do first, near-zero cost)
| # | Artifact | Purpose | Status |
|---|----------|---------|--------|
| 11 | `PROJECT_PLAN.md` | This file — categorized plan + cadence | Created |
| 12 | Freeze banner on `SAAS_SPECIFICATION.md` | "Version 1.0 Architecture — FROZEN"; new ideas must not edit the spec | Pending |
| 13 | `FUTURE_FEATURES.md` | Bucket for all deferred ideas (AI, forecasting, portals, gamification, SaaS layer, FBR IRN pipeline…) | Pending |
| 14 | `PLUGIN_SDK_SPEC.md` | The one missing architecture doc — a *contract* (no code): what a plugin may register | Pending |

---

## 3. The Mentor's Document Artifacts (planned contents)

### 3.1 Freeze the core specification
Add to the top of `SAAS_SPECIFICATION.md`:

```
Version 1.0 Architecture
Status: FROZEN
Last change: 2026-08-06
New ideas → FUTURE_FEATURES.md (NOT this file)
```

### 3.2 `FUTURE_FEATURES.md` (idea bucket — nothing here blocks v1)
- AI / forecasting / demand prediction
- Multi-tenant SaaS core: PostgreSQL mode, super admin, branches, subscriptions/packages, plugin framework
- FBR IRN pipeline: payloads, queue, retry, offline, status tracking (needs FBR sandbox)
- Customer portals, mobile app, gamification, discussion boards, workflow automation
- International tax systems, advanced analytics, internationalization

### 3.3 `PLUGIN_SDK_SPEC.md` (contract only, written before SaaS)
Define the registration surface a future plugin must conform to:

```
Plugin
 ├─ Registers: Menus, Permissions, Routes, API commands
 ├─ DB: migration files, dynamic fields
 ├─ UI: navigation items, settings sections, import templates, reports
 ├─ Lifecycle: install / enable / disable / uninstall hooks
 └─ Isolation: scoped storage, permission grants, version compatibility
```

Intent: freeze the plugin contract **now** so every future module ships through the same door.

---

## 4. Execution Order

1. **Day 0–1:** Create P3 documents (freeze banner, FUTURE_FEATURES.md, PLUGIN_SDK_SPEC.md, PROJECT_PLAN.md)
2. **Week 1–2:** P0-1 + P0-2 (import v2 backend + UI)
3. **Week 2:** P0-3 (QR) + P0-4 (print polish)
4. **Week 3:** P1 items (suppliers, units, missing tests)
5. **Week 4:** P0-5 (release + live onboarding + feedback loop)
6. **Ongoing:** P2 hygiene merged in without dedicated time

## 5. Definition of Done (v1.1.0)
- [ ] A real business uses the app daily for inventory, invoices, purchases
- [ ] Import wizard reaches all targets with preview→confirm→rollback
- [ ] Invoices carry FBR QR; print/PDF works without a browser
- [ ] Theme/logo/watermark configured per company
- [ ] 385+ tests green, clippy clean, CI runs `cargo audit`
