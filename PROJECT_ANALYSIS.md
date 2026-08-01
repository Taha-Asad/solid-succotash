# Ijaz & Company ERP — Project Analysis & Status Report

> **Date:** 2026-08-01
> **Scope:** Critical assessment of the current implementation against `SAAS_SPECIFICATION.md` (v5.1), build-readiness verification, achieved/approved scope, and next-phase roadmap.

---

## 1. Project at a Glance

| Attribute      | Value                                                          |
| -------------- | -------------------------------------------------------------- |
| Product        | Ijaz & Company ERP (desktop application)                       |
| Version        | 0.1.0                                                          |
| Architecture   | Tauri 2.11.5 + React 19 + Mantine 9 + TypeScript + Rust (sqlx 0.9) |
| Database       | SQLite (single-tenant desktop mode per spec §21)               |
| Data flow      | Tauri `invoke()` IPC — no HTTP/REST layer                      |
| Auth           | In-memory Rust session + SQLite session persistence (bcrypt)   |
| Build status   | ✅ Frontend + Rust release exe + **NSIS installer** build clean |
|                | ⚠️ **MSI (WiX) bundling fails** — see §6.2                     |
| Tests          | ❌ None (no Rust `#[test]`, no frontend test suite)             |
| Spec alignment | This is spec **Desktop/Local Mode** (single-tenant SQLite) — a working Phase-1 core, with **none** of the SaaS/cloud layer built |

---

## 2. Executive Summary

The project is a **working single-tenant desktop ERP core**, not yet the multi-tenant SaaS platform described in the specification. It is best understood as **spec "Desktop/Local Mode"** (§21.1) with a solid Phase-1 (ERP Core) implementation:

- ✅ Auth + company setup + user management
- ✅ Inventory (categories, suppliers, products, stock movements, custom fields)
- ✅ Invoicing (draft → finalize with transactional stock deduction → payments) + FBR placeholder fields
- ✅ Historical data import wizard (CSV / Excel / DOCX → products) — the spec's highest-value onboarding feature (§23)
- ✅ Installer production pipeline (NSIS) proven working

What is **not** built is the entire **SaaS/cloud layer** (PostgreSQL, RLS, packages, subscriptions, super admin, FBR/PRAL, accounting ledger, audit logs, notifications, search, analytics engine) plus several Phase-1 desktop quality items (working print/PDF, purchase orders, reports, audit trail, tests, code cleanup).

**Verdict:** the current build is a legitimate **v0.1 desktop MVP** that can be approved for internal use, but it is **not** production-ready for external distribution yet (broken print/PDF, no audit logging, zero tests, MSI bundler defect).

---

## 3. What Is Achieved (Verified)

### 3.1 Authentication & Company Setup
- `src-tauri/src/commands/auth.rs` — `login_user`, `logout_user`, `current_user`, `update_my_profile`, `change_my_password`, plus `save_session` / `load_saved_session` / `clear_saved_session` (persistent session, migration `005_persistent_session.sql`).
- Passwords hashed with **bcrypt 0.19**; emails normalized; login rate protection is absent but sessions are stored.
- `src-tauri/src/commands/company.rs` — `register_company` (creates company + owner atomically in a transaction), `is_company_setup` (single-tenant gate), `get_company`, `update_company`. Only **one** company per installation is enforced (company_count > 0 → error).
- Roles: `owner`, `admin`, `employee`, enforced by SQLite triggers (`002_create_companies.sql`) and unique index `idx_users_one_owner_per_company`.
- Frontend: `LoginPage`, `SetupPage`, and an App state-machine (`src/App.tsx`) routing loading → setup → login → dashboard, with session restore on restart.

### 3.2 User Management
- `src-tauri/src/commands/users.rs` — `list_company_users`, `create_company_user` (admin/employee), `update_company_user_role`, `set_company_user_active`. Employee role is restricted from creating/finalizing invoices in the backend (`invoices.rs`).

### 3.3 Inventory (spec §4 `inventory`, §3 schema)
- Categories, suppliers, products (SKU, prices stored in **paisa/cents** to avoid float errors, tax rate, stock, unit), stock movements (`purchase`/`sale`/`adjustment`/`return`/`damage`).
- Custom fields: `company_field_settings` (text/number/date/dropdown, visibility, order, validation JSON) + `products.custom_fields` JSON blob — matches the spec's "core columns + company-discovered JSON" principle in migration `003`.
- Import templates (`import_templates`) saved for reuse.
- `src/features/inventory/InventoryPage.tsx` — full UI for all of the above.

### 3.4 Invoicing (spec §4 `sales`, §10 lifecycle simplified)
- Customers with FBR fields: `cnic`, `ntn`, `strn`, `buyer_type` (`004_create_invoices.sql`).
- Invoice lifecycle `draft → finalized → paid` (+ `cancelled`), paisa amounts, per-item tax rate/discount, payment records with methods.
- `finalize_invoice` (`invoices.rs:640`) runs in a **transaction**: verifies draft + non-zero total, checks stock, deducts stock, records stock movements (negative qty), commits — a real safety win.
- `record_payment` updates `amount_paid` / `balance_due`.
- Invoice settings: prefix, next number, default due days, footer, terms (`company_invoice_settings`).
- `generate_invoice_html` (`invoices.rs:1042`) builds a printable HTML invoice (company, customer, items, totals, payments).
- Frontend: `src/features/invoices/InvoicePage.tsx` — customers, invoice create/detail, item add/remove, finalize, payments, settings.

### 3.5 Import Wizard (spec §23 — the highest business value feature)
- `src-tauri/src/commands/import_wizard.rs` — `analyze_import_file` supports **CSV, XLS/XLSX (calamine), DOCX (quick-xml 0.41)**; auto column→field mapping with confidence scores; header/sample/total-row analysis.
- `execute_import` creates discovered custom fields (`detect_field_type`) and inserts products with per-row error capture (`ImportResult.errors`).
- Frontend `ImportWizard.tsx` — upload → preview mapping → confirm → result, with Mantine success/error notifications.
- This is the **generic CSV/Excel adapter** of spec §23.11 Phase 1 (named ERP adapters like QuickBooks/Odoo are Phase 2).

### 3.6 Dashboard
- `DashboardPage.tsx` — company info, stat cards, inventory overview, low-stock alerts, recent movements, company users management. Basic analytics only; no revenue-trend reporting or exports (spec §11).

### 3.7 Build & Packaging
- Frontend: `tsc && vite build` clean.
- Rust: `cargo check --all-targets` clean (zero warnings), release exe builds.
- **NSIS installer produced:** `src-tauri/target/release/bundle/nsis/Ijaz & Company ERP_0.1.0_x64-setup.exe`.
- Icons regenerated (branded blue "I&C / ERP"); migrations bundled via `bundle.resources` and found at runtime through an updated `find_migrations_dir()` that covers exe-adjacent and `resources/` layouts (`db/sqlite_migrate.rs:239`).

---

## 4. Spec Coverage Matrix

| Spec Section | Feature | Status |
| --- | --- | --- |
| §2 | Roles & hierarchy (Super Admin, Company Admin, inventory_manager/sales_user/import_clerk, custom roles) | 🔴 Not built — flat `owner/admin/employee` only; `super_admin` role is **rejected** by the role trigger |
| §3 | packages, subscriptions, company_modules, feature flags, audit_logs, refresh_tokens, encrypted_secrets, invoice_sequences, accounting tables | 🔴 Not built |
| §4 | Module system & enforcement | 🔴 No module system (sidebar is hardcoded) |
| §5 | Super Admin dashboard | 🔴 Not built |
| §6 | Company Admin dashboard | 🟡 Partial (settings, employees exist; modules/subscription/tickets/templates/branches don't) |
| §7 | JWT + refresh + permission cache | 🔴 Not built — desktop in-memory session instead (acceptable for Local mode, but not §7) |
| §8 | Security: RLS, audit, soft deletes, permission inheritance, rate limiting, upload pipeline, optimistic locking, archival | 🟡 Partial — soft-active flags, DB triggers for integrity; **no audit log, no rate limiting, no optimistic locking, no archival** |
| §9 | Subscription enforcement | 🔴 N/A in Local mode |
| §10 | Invoice template system / FBR lifecycle | 🟡 Draft → finalize → paid works; FBR/IRN/QR/CN/DN not built |
| §11 | Analytics & reporting | 🟡 Basic stat cards only |
| §12 | Frontend dynamic sidebar / super admin layout / first-login | 🟡 Sidebar static; no super admin; no forced password change |
| §13 | API routes | 🔴 N/A — Tauri IPC replaces REST (equivalent commands exist for core entities) |
| §16 | Legal & compliance (PECA logging/rate-limit, ETO 5-year, FBR, PDPB/GDPR) | 🔴 PECA access logging and rate limiting **not** implemented; FBR fields exist but no integration |
| §17 | FBR/PRAL integration | 🔴 Not built (only schema placeholders) |
| §18 | Gap register: notifications, pagination, SSE, error schema, tests, observability | 🔴 Not built |
| §19 | Accounting ledger / outbox | 🔴 Not built |
| §21 | DB mode separation (Postgres SaaS vs SQLite Local) | 🟢 Project correctly operates as **SQLite Local mode**; SaaS codebase split not created |
| §22 | Search (FTS) | 🔴 Not built |
| §23 | Historical import system | 🟡 Phase-1 CSV/Excel/DOCX import works; **no job queue, no preview API, no rollback, no conflict strategy, no SSE** |
| §24 | Intelligence layer (AI) | 🔮 Deferred by spec — correctly absent |

---

## 5. Critical Gaps & Issues (Prioritized)

### 🔴 Blockers for production release
1. **Print/PDF is a no-op in the UI.** `generate_invoice_html` returns an HTML string, but `InvoicePage.tsx:635` (`handlePrint`) awaits and **discards** the result — the Print button does nothing visible. No PDF file is produced and no print window opens.
2. **MSI (WiX) bundling fails.** `productName = "Ijaz & Company ERP"` contains `&`, which is written unescaped into the WiX source → `main.wxs:17` → `candle` fails with `CNDL0104` (XML EntityName parse error). NSIS works; MSI does not. **Fix options:** (a) switch to NSIS-only installer, or (b) rename the product (e.g. "Ijaz and Company ERP").
3. **Zero automated tests** (no `cargo test`, no frontend tests) while spec §18.9 mandates a testing strategy. High regression risk for invoicing/stock/import logic.

### 🟠 High priority
4. **No audit logging** — contradicts PECA 2016 (§16.2) "all admin access logged" and spec §8.2. Every mutating command (`create_*`, `update_*`, `finalize`, `adjust_stock`, `execute_import`) should write an `audit_logs` row.
5. **No rate limiting on login** — PECA-required; brute force protection missing (spec §8.5).
6. **`backend.ts` is heavily polluted** with ~805 lines of dead commented-out duplicate code (active code starts ~line 806); `types/backend.ts` and `BackendTester.tsx` have the same problem. Maintainability and review hazard.
7. **Employee permission model is thin** — most commands only check "logged in"; only a couple gate `employee`. No per-module or per-action permission system (spec §4.2, §8.4).

### 🟡 Medium priority
8. **Invoice numbering is not concurrency-safe** — `generate_invoice_number` (`invoices.rs:208`) reads `next_number` then increments outside a transaction/lock; gaps occur on failure and multi-user edits could collide (spec §3.14 requires `SELECT FOR UPDATE`).
9. **No reports/exports** (monthly revenue, top products, stock valuation, CSV/PDF export — spec §11).
10. **No purchase orders / purchases module** despite `suppliers` existing (spec §4 `purchases`).
11. **Dead dependencies bloat the binary:** `tauri-plugin-sql` (not registered in `lib.rs`), sqlx `postgres` + `tls-rustls` features, `dotenv`, `tauri-plugin-opener` backend unused. Trim via `cargo machete`/manual.
12. **`withGlobalTauri: true`** exposes Tauri internals on `window.__TAURI__` — unnecessary for a packaged app; tighten later.
13. **No soft-delete/restore flows** for most entities (only `is_active` flags; no archive commands), and no `version` optimistic-lock columns (spec §8.10).

### 🟢 Low priority / hygiene
14. `index.html` title/favicon still say "Tauri + React + Typescript" / `vite.svg`.
15. `BackendTester.tsx` is orphaned.
16. `cargo` dead-code: commented `greet` usage, unused deps (§11).

---

## 6. Build & Release Readiness

### 6.1 Verified results
| Step | Result |
| --- | --- |
| `tsc --noEmit` | ✅ Clean |
| `npm run build` | ✅ Clean (one advisory: JS chunk >500 kB — consider code-splitting) |
| `cargo check --all-targets` | ✅ Zero warnings |
| `cargo build --release` | ✅ `ijazandcompany.exe` |
| `npm run tauri build` (all) | ⚠️ Exe + frontend OK; **MSI fails** at WiX `candle` (see §5.2) |
| `npm run tauri build -- --bundles nsis` | ✅ **`Ijaz & Company ERP_0.1.0_x64-setup.exe` produced** |

### 6.2 The one build defect
`src-tauri/tauri.conf.json` → `productName: "Ijaz & Company ERP"`. Tauri emits `Name="Ijaz & Company ERP"` into the WiX `.wxs` without XML-escaping `&`, so WiX's compiler rejects it. This is a Tauri/WiX limitation; the **& must not appear in `productName`** if MSI is required. NSIS is unaffected. Recommended: NSIS-only for now, or rename to "Ijaz and Company ERP".

### 6.3 Runtime deployment notes (all verified in code)
- DB lives at `dirs::data_dir()/ijazandcompany-erp/ijazandcompany.db` (Roaming AppData) — **not** in the app's data dir; acceptable but unusual.
- Migrations are bundled as resources (`tauri.conf.json` → `"resources": ["migrations/sqlite/*"]`) and resolved at runtime via exe-adjacent / `resources/` candidates (`db/sqlite_migrate.rs`).
- `find_migrations_dir()` was updated during this analysis to also check `<exe>/resources/migrations/sqlite` so the packaged installer finds migrations (previously it only handled dev + exe-adjacent paths).

---

## 7. Compliance Status

| Requirement | Spec ref | Status |
| --- | --- | --- |
| PECA 2016 — access logging | §16.2 | 🔴 Missing |
| PECA 2016 — rate limiting / failed-login logs | §16.2 | 🔴 Missing |
| ETO 2002 — 5-year immutable record retention | §16.2 | 🟡 Schema keeps history; no policy/archive |
| FBR digital invoicing | §17 | 🔴 Placeholder fields only |
| PDPB / GDPR | §16.3 | 🔴 Not addressed |

---

## 8. Code Quality & Technical Debt

- **Dead-code pollution:** `src/api/backend.ts` (~805 commented lines), `src/types/backend.ts`, `src/BackendTester.tsx` — should be cleaned (with user preference: comment out rather than delete any still-referenced pieces).
- **No lint/format enforcement:** no ESLint/Prettier config, no `rustfmt` CI check, no `cargo clippy` in CI.
- **No tests** at any layer.
- **Unused dependencies** and a large Mantine bundle (9 packages) inflating the JS chunk.
- **Positive:** core business logic is transaction-aware where it matters (company setup, invoice finalize), errors are surfaced as readable strings, money uses integer paisa, and role/company integrity is enforced at the DB-trigger level.

---

## 9. Project Maturity Level

| Level | Verdict |
| --- | --- |
| Technical prototype | ✅ Passed — core flows run end-to-end |
| **v0.1 Desktop MVP (current)** | ✅ **Reached** — usable for internal/limited rollout |
| v1.0 Production desktop app | ⚠️ Not yet — print/PDF, audit, tests, MSI decision |
| SaaS / Multi-tenant platform (spec end-state) | 🔴 Future — entire §5–§9, §17, §19, §22 layer missing |

---

## 10. What Can Be Approved

1. **Internal / pilot approval (v0.1):** single-tenant desktop ERP for inventory + invoicing + import on one machine, with NSIS installer. No external distribution.
2. **Schema & money-handling design approval:** paisa-based integer amounts, JSON custom fields, transactional stock deduction, DB-level integrity triggers.
3. **Import wizard approval:** analyze → map → import for CSV/Excel/DOCX is genuinely functional and matches spec §23 Phase-1 intent.

**NOT approvable for external production:** missing audit trail (PECA), broken print/PDF, zero tests, MSI installer defect, no backup/restore.

---

## 11. Next Phase — Recommended Roadmap

The spec's own architecture (§21) keeps Desktop/Local (SQLite) and SaaS (PostgreSQL) separate. The pragmatic next phase is to **finish the Desktop ERP Core (v0.1 → v1.0)** before any SaaS work.

### Phase 1A — Close v1.0 desktop blockers (0–2 weeks)
1. Fix print/PDF — open the generated HTML in a Tauri webview window (or `print` via a hidden window) and/or save as PDF through the browser print path.
2. Decide & configure the installer target: set `bundle.targets = "nsis"` (keep `&` name) **or** rename product for MSI. Verify both bundlers.
3. Add audit logging table + writes on all mutating commands (PECA §16.2).
4. Add login rate limiting (simple in-memory throttling).
5. Add a test harness: `cargo test` for invoice math/stock deduction/import parsing; a few vitest tests for key UI logic.
6. Clean dead code from `backend.ts`, `types/backend.ts`, remove `BackendTester.tsx`, trim unused deps.

### Phase 1B — Round out ERP Core (1–2 months)
7. Purchases module (purchase orders → goods-received → supplier stock-in), closing the inventory loop.
8. Reports & exports: monthly revenue, top products/customers, stock valuation, low-stock, CSV/PDF export (§11.1).
9. Concurrency-safe invoice numbering (`SELECT FOR UPDATE`-style within the transaction) + `version` optimistic locking on core entities (§3.14, §8.10).
10. Soft-delete/archive for invoices, users, products with retention notes (ETO §16.2).
11. Basic search across inventory/invoices/customers (§22 SQLite FTS5).
12. Invoicing polish: branded printable template, batch invoice creation, credit/debit notes.

### Phase 2 — Decision point: SaaS (only after v1.0 is solid)
13. Stand up PostgreSQL mode, `super_admin`, packages/subscriptions, module enforcement, RLS, permission cache (§2–§9).
14. FBR/PRAL integration with outbox queue (§17) — requires a registered FBR sandbox.
15. Accounting ledger with double-entry posting on invoices (§19).
16. Import job queue + preview + rollback + conflict strategies + named ERP adapters (§23.3–§23.12).
17. Observability, backup/DR, CI pipeline with clippy + cargo audit (§18, §20.7).

### Deferred (per spec)
- Intelligence layer (AI) — only after 20–30 tenants × 12+ months of data (§24).

---

## 12. Immediate Action Items (from this analysis)

- [ ] `tauri.conf.json`: set `bundle.targets` to `nsis` OR change `productName` to remove `&` (unblocks MSI).
- [ ] Wire `generate_invoice_html` return value into a real print/PDF window in `InvoicePage.tsx`.
- [ ] Add `audit_logs` migration + write-through on mutating commands.
- [ ] Add login throttling.
- [ ] Create `cargo test` coverage for: invoice totals/tax/discount math, stock deduction in `finalize_invoice`, import parsing (CSV/XLSX/DOCX), migration runner on a temp DB.
- [ ] Clean ~805 dead commented lines in `src/api/backend.ts`, `src/types/backend.ts`; remove `BackendTester.tsx`; trim unused Cargo deps.
- [ ] Update `index.html` title/favicon branding.

---

*Document generated as part of a full project audit. Build verification was performed live: `tsc`, `vite build`, `cargo check --all-targets`, `cargo build --release`, and `tauri build` (NSIS).*
