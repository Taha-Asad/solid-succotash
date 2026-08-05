# Ijaz & Company ERP — Project Analysis & Status Report

> **Date:** 2026-08-05
> **Scope:** Refreshed assessment of the current implementation against `SAAS_SPECIFICATION.md` (v5.1), verified against the live codebase, with emphasis on **what is left** and **what the next steps are**. Supersedes the 2026-08-05 v0.1.6 report.
> **Milestone:** **v1.0.0 released** — Phase 1 (single-tenant desktop ERP core + hardening) is complete.

---

## 1. Project at a Glance

| Attribute           | Value                                                                                                                                                                    |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Product             | Ijaz & Company ERP (desktop application)                                                                                                                                 |
| Version             | **1.0.0** (tagged)                                                                                                                                                       |
| Architecture        | Tauri 2.11 + React 19 + Mantine 9 + TypeScript + Rust (sqlx 0.9 + SQLite)                                                                                                |
| Database            | SQLite (single-tenant desktop mode per spec §21)                                                                                                                         |
| Data flow           | Tauri `invoke()` IPC — no HTTP/REST layer                                                                                                                                |
| Auth                | In-memory Rust session + SQLite session persistence (bcrypt) + login rate limiting                                                                                       |
| Registered commands | 78 (incl. `greet`); 77 business commands across auth, company, users, inventory, invoices, import, purchase orders, reports, audit, permissions, export, updater, backup |
| Migrations          | 9 (`001..009`) — users, companies, inventory, invoices, session, expiry batches, purchase orders, **audit log**, **soft-delete/versioning/permissions**                  |
| Build status        | ✅ Frontend + Rust + NSIS installer + updater artifacts build clean                                                                                                      |
| Auto-update         | ✅ Wired (GitHub Actions release pipeline + minisign + `latest.json`)                                                                                                    |
| Tests               | ✅ **366 Rust integration tests, all green** (`cargo test --lib`), zero warnings (`cargo check --all-targets`), clean `tsc --noEmit`. Cataloged in `TEST_CASES.md`       |
| Spec alignment      | **Desktop/Local Mode** (single-tenant SQLite) — **v1.0 desktop achieved**; the SaaS/cloud layer (Phase 1 of the spec proper) is a deliberate later phase                 |

---

## 2. Executive Summary

Since the 2026-08-01 audit the project has advanced **v0.1.0 → v1.0.0** and closed every desktop blocker identified for a production single-tenant release:

- ✅ **Audit logging (PECA §16.2)** — migration `008`, `audit.rs`, `log_audit()` write-through on every mutating command, read-only viewer (owner/admin) in Settings.
- ✅ **Login rate limiting (PECA §16.2)** — in-memory `LoginAttemptTracker` (5 failures → lockout, expiry, case-insensitive).
- ✅ **Automated tests (spec §18.9)** — 366 tests across all 13 command modules against real migrated SQLite DBs; documented in `TEST_CASES.md`.
- ✅ **Backup + restore + UI** — `restore_backup` added; working Settings page with **Backup & Restore** and **Audit Log** tabs.
- ✅ **Invoice/PO numbering concurrency** — sequence allocation moved inside the write transaction (`generate_invoice_number`, `next_po_number` atomic upsert).
- ✅ **Permissions model** — `permissions.rs` with seeded `role_permissions`, `check_permission` gate + owner short-circuit.
- ✅ **Soft-delete + optimistic locking (spec §8.10/§8.11)** — migration `009` adds `deleted_at`/`version`; helpers enforce 409-style conflicts.
- ✅ **CSV report export (spec §11.1)** — `export.rs`: stock, customer ledger, sales (with CSV escaping).
- ✅ **Customers page** — dedicated UI (`src/features/customers/`).

The app is a **release-ready single-tenant desktop ERP** covering the full core loop **import → inventory → sales → purchase → reports → export**, with distribution (NSIS), auto-update, audit trail, rate limiting, permissions and a regression-tested backend.

**Verdict:** **v1.0 desktop reached.** The spec's SaaS/cloud end-state (§2–§9, §17, §19, §22, §23) remains future work and must not start until the desktop product is proven in production.

---

## 3. What Is Achieved (Verified)

### 3.1 Auth, Company Setup, Users

- `auth.rs` (8 commands): login/logout (rate-limited), current user, profile/password change, persistent session (migration `005`). bcrypt 0.19, email normalization.
- `company.rs`: single-tenant registration gate, one company per installation enforced.
- `users.rs`: role management (`owner`/`admin`/`employee`) with DB-trigger enforcement + permission checks.

### 3.2 Permissions & Security Core

- `permissions.rs`: `check_permission` against seeded `role_permissions` (owner always allowed); `soft_delete`, `check_version`, `bump_version` helpers — migration `009`.
- `audit.rs`: `log_audit` write-through on every mutating command; `list_audit_logs` with pagination; owner/admin viewer.

### 3.3 Inventory & Expiry (spec §4 `inventory`)

- Categories, suppliers, products (paisa/cents), stock movements, custom fields (JSON), import templates.
- `inventory.rs` (20 commands): products, stock adjust, movements, custom fields, **batch tracking** (`list_product_batches`, `list_expiring_batches`, `write_off_batch` — migration `006`).

### 3.4 Invoicing (spec §4 `sales`)

- Customers with FBR fields (CNIC/NTN/STRN/buyer type), `draft → finalized → paid (+cancelled)`, transactional stock deduction in `finalize_invoice`, payments, invoice settings.
- **Concurrency-safe numbering** — `generate_invoice_number` reads+increments atomically inside the invoice transaction.
- `generate_invoice_html` renders a complete HTML invoice and opens it in the OS default browser (print works; webview-window polish is a minor outstanding item).

### 3.5 Purchase Orders

- Migration `007`: `purchase_orders`, `purchase_order_items`, `purchase_payments`, `company_po_settings`.
- `purchase_orders.rs` (8 commands): create → add/remove items → submit → receive (stock-in + batch creation) → record payment. Atomic `next_po_number` upsert.

### 3.6 Reports & Export

- `reports.rs` (8 commands): sales summary, sales by month, top products, top customers, stock, P&L, customer ledger, product movements.
- `export.rs` (3 commands): stock / customer ledger / sales CSV with proper CSV escaping (`escape_csv`).

### 3.7 Import Wizard (spec §23 Phase-1 generic)

- `import_wizard.rs`: CSV / XLS/XLSX (calamine) / DOCX (quick-xml) analysis → auto column mapping with confidence → `execute_import` with per-row error capture, custom-field registration, expiry batches and a 50-error cap.

### 3.8 Update & Backup

- `updater.rs`: `check_for_updates` / `install_update`; GitHub Actions release pipeline (NSIS + `.sig` + `latest.json`).
- `backup.rs`: `create_backup` / `restore_backup` / `list_backups`, operating on the pool's actual DB file (safety copy created before restore). Full UI in Settings.

### 3.9 Build & Packaging

- `tsc`/`vite build` clean; `cargo check --all-targets` clean (zero warnings); NSIS installer + `.sig` + `latest.json` pipeline proven.
- `bundle.targets = ["nsis", "app"]`. Dev tooling: `scripts/run-tauri.mjs` shim for Snap environments.

---

## 4. Spec Coverage Matrix (Desktop/Local relevance)

| Spec Section   | Feature                                                                                                                | Status                                                                                                                         |
| -------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| §2             | Roles & hierarchy (Super Admin, inventory_manager/sales_user/import_clerk, custom roles)                               | 🟡 Flat `owner/admin/employee` + `role_permissions` table (seeded); custom roles not built                                     |
| §3             | packages, subscriptions, company_modules, audit_logs, refresh_tokens, encrypted_secrets, invoice_sequences, accounting | 🟡 **audit_logs built**; rest N/A in Local mode                                                                                |
| §4             | Module system & enforcement                                                                                            | 🟡 No module system (sidebar is hardcoded)                                                                                     |
| §4 `purchases` | Purchase orders                                                                                                        | 🟢 **Built** (007 + commands + UI)                                                                                             |
| §5             | Super Admin dashboard                                                                                                  | 🔴 N/A in Local mode                                                                                                           |
| §6             | Company Admin dashboard                                                                                                | 🟡 Partial (settings/employees/customers exist; modules/subscription/tickets/templates/branches don't)                         |
| §7             | JWT + refresh + permission cache                                                                                       | 🟡 Desktop in-memory session + `role_permissions` cache instead (acceptable for Local mode)                                    |
| §8             | Security: audit, soft deletes, optimistic locking, rate limiting, archival                                             | 🟢 **Built** (audit 008, soft-delete/versioning 009, `LoginAttemptTracker`, `check_permission`); archival still pending        |
| §10            | Invoice template system / FBR lifecycle                                                                                | 🟡 Draft → finalize → paid works + HTML print; FBR/IRN/QR/CN/DN not built                                                      |
| §11            | Analytics & reporting                                                                                                  | 🟢 **Reports + CSV export built** (8 reports + charts + 3 CSV exports); PDF export pending                                     |
| §12            | Dynamic sidebar / super admin / first-login                                                                            | 🟡 Sidebar static; no super admin; no forced password change                                                                   |
| §13            | API routes                                                                                                             | 🟡 N/A — Tauri IPC replaces REST (equivalent commands exist)                                                                   |
| §16            | Legal & compliance (PECA logging/rate-limit, ETO 5-year, FBR, PDPB/GDPR)                                               | 🟢 **PECA access logging + rate limiting implemented**; ETO retention policy, FBR, PDPB/GDPR still open                        |
| §17            | FBR/PRAL integration                                                                                                   | 🔴 Not built (schema placeholders only)                                                                                        |
| §18            | Gap register: notifications, pagination, SSE, error schema, tests, observability                                       | 🟡 **Tests built (366)**; pagination exists on audit; notifications/SSE/error-schema/observability open                        |
| §19            | Accounting ledger / outbox                                                                                             | 🔴 Not built                                                                                                                   |
| §21            | DB mode separation                                                                                                     | 🟢 Correctly operates as SQLite Local mode                                                                                     |
| §22            | Search (FTS)                                                                                                           | 🔴 Not built                                                                                                                   |
| §23            | Import system                                                                                                          | 🟡 Phase-1 generic CSV/Excel/DOCX import works; **no job queue, no rollback, no SSE, no conflict strategy, no named adapters** |
| §24            | Intelligence layer (AI)                                                                                                | 🔮 Deferred by spec — correctly absent                                                                                         |

---

## 5. What Is Left — Gap Register (Prioritized)

### 🟠 High priority (post-v1.0 desktop)

1. **Print/PDF polish.** `handlePrint` (`InvoicePage.tsx`) still discards the returned path and relies on the backend side-effect of opening the OS default browser. Polish: open in a Tauri `WebviewWindow` with `window.print()` (direct "Save as PDF"), use the return value, add a branded printable template.
2. **Import safety net (spec §23.7/§23.12).** `execute_import` is single-shot: no `import_jobs` table, **no rollback**, no preview/confirm backend step, no duplicate/conflict strategy, no background execution with progress.
3. **FTS5 search (spec §22).** Inventory/customers/invoices search is all `LIKE %…%`.
4. **ETO 5-year retention policy + archival (spec §8.11).** History is kept but there is no retention/archive lifecycle or enforcement.

### 🟡 Medium priority

5. **Notifications/activity feed.** Low-stock + expiring-batch alerts surfaced in-app (queries already exist).
6. **PDF export for reports** — CSV export done; PDF remains.
7. **Custom roles / finer permission granularity** (spec §2) beyond the three static roles.
8. **FBR/PRAL integration (spec §17)** — customer/company FBR fields exist but no payloads, queue, IRN/QR. Largest single chunk of the spec; firmly a SaaS-phase item.
9. **Accounting ledger (spec §19)** — no chart of accounts / double-entry. Phase 3 of the spec.

### 🟢 Low priority / hygiene

10. `src-tauri/src/commands/expiry.rs` — empty legacy file (still `pub mod` in `mod.rs`); `src/BackendTester.tsx` — dead placeholder. Remove both.
11. Commented-out legacy code in `src-tauri/src/lib.rs:1–111`; trim unused deps (`tauri-plugin-sql` unregistered, sqlx `postgres` + `tls-rustls` features, `dotenv`).
12. `withGlobalTauri: true` in `tauri.conf.json` exposes `window.__TAURI__` — tighten for release.
13. No ESLint/Prettier/rustfmt/clippy enforcement, no `cargo audit` in CI.

---

## 6. Build & Release Readiness

| Step                             | Result                                                                                                       |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `tsc --noEmit` / `npm run build` | ✅ Clean                                                                                                     |
| `cargo check --all-targets`      | ✅ Clean (zero warnings)                                                                                     |
| `cargo test --lib`               | ✅ **366 passed, 0 failed**                                                                                  |
| `cargo build --release`          | ✅ Clean                                                                                                     |
| `npm run tauri build`            | ✅ NSIS installer + updater artifacts produced                                                               |
| Updater pipeline                 | ✅ `release.yml` (windows-latest) → NSIS + `.sig` + `latest.json` (uploads.github.com endpoint fix in place) |
| Version bump                     | ✅ `1.0.0` in `package.json`, `package-lock.json`, `Cargo.toml`, `Cargo.lock`, `tauri.conf.json`             |

**Release procedure** (per `Notes.txt`): bump semver in all 5 places → commit + tag + push → `npm run tauri build` with signing key → update `latest.json` with new `.sig` → create GitHub Release for the tag with installer + `.sig` + `latest.json`.

**Runtime notes:** DB at `dirs::data_dir()/ijazandcompany-erp/ijazandcompany.db`; migrations bundled as resources; backup/restore act on the pool's actual DB file.

---

## 7. Compliance Status

| Requirement                                   | Spec ref | Status                                                                                   |
| --------------------------------------------- | -------- | ---------------------------------------------------------------------------------------- |
| PECA 2016 — access logging                    | §16.2    | 🟢 **Implemented** — `audit_logs` (migration 008) + `log_audit()` write-through + viewer |
| PECA 2016 — rate limiting / failed-login logs | §16.2    | 🟢 **Implemented** — `LoginAttemptTracker` (5/60s lockout)                               |
| ETO 2002 — 5-year immutable record retention  | §16.2    | 🟡 History kept (append-only audit); no retention policy/archive                         |
| FBR digital invoicing                         | §17      | 🔴 Placeholder fields only                                                               |
| PDPB / GDPR                                   | §16.3    | 🔴 Not addressed                                                                         |

---

## 8. Project Maturity Level

| Level                                         | Verdict                                                                                                                                               |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Technical prototype                           | ✅ Passed                                                                                                                                             |
| v0.1 Desktop MVP                              | ✅ Passed (2026-08-01)                                                                                                                                |
| **v1.0 Production desktop app**               | ✅ **Reached (2026-08-05)** — audit, rate limiting, permissions, soft-delete/versioning, tests (366), backup/restore UI, atomic numbering, CSV export |
| SaaS / Multi-tenant platform (spec end-state) | 🔴 Future — §2–§9, §17, §19, §22, §23 layer not started                                                                                               |

---

## 9. Next Steps — Recommended Roadmap

**Finish desktop polish first; the SaaS layer stays a deliberate later phase.** The desktop product is now shippable; what remains is UX hardening plus the spec's cloud-only features.

### Step 1 — Desktop polish (1–3 weeks)

1. **Print/PDF in a webview window** — use the returned HTML path, open in a Tauri `WebviewWindow` with `window.print()` / save-as-PDF, branded template.
2. **Import safety net** — `import_jobs` tagging, duplicate/conflict strategy, rollback (§23.7, §23.12).
3. **Notifications/activity feed** — low-stock + expiring-batch alerts (queries exist).
4. **FTS5 search** — global search across products/customers/invoices (§22).
5. **Retention/archival policy** — ETO 5-year enforcement + archive (§8.11).

### Step 2 — Hygiene & engineering

6. Remove `expiry.rs` empty module + `BackendTester.tsx`; strip commented legacy code in `lib.rs`; trim unused deps (`tauri-plugin-sql`, sqlx postgres, dotenv).
7. Add ESLint/Prettier/rustfmt/clippy config + `cargo audit` in CI.
8. Tighten `withGlobalTauri`; pin `bundle.targets = ["nsis"]`.

### Step 3 — Decision point: SaaS (only after desktop is proven)

9. Stand up the spec's `saas`/`desktop` split (§21.2), PostgreSQL mode, `super_admin`, packages/subscriptions, module enforcement, RLS, permission cache (§2–§9).
10. FBR/PRAL integration with outbox queue (§17) — requires FBR sandbox registration.
11. Accounting ledger with double-entry posting (§19).
12. Import job queue + SSE + named ERP adapters (§23.3–§23.12).
13. Observability, backup/DR, CI hardening (§18, §20.7).

### Deferred (per spec)

- Intelligence layer (AI) — after 20–30 tenants × 12+ months of data (§24).

---

## 10. Test Suite Summary (Phase-1 hardening)

366 tests across 13 modules, all against real migrated SQLite DBs via `test_helpers.rs` (`setup_app` = mock Tauri app + temp-file pool + session + rate-limit tracker). Full catalog in `TEST_CASES.md`.

| Module          | Tests | Coverage highlights                                                     |
| --------------- | ----- | ----------------------------------------------------------------------- |
| auth            | 43    | login incl. rate limiting, sessions, password rules, persistence        |
| company         | 31    | single-tenant gate, currency/email validation, owner/admin/employee     |
| users           | 38    | role CRUD, owner/admin/employee permission paths                        |
| inventory       | 70    | products, stock adjust, FIFO, expiry batches, soft-delete/versioning    |
| invoices        | 47    | totals/discount/tax math, finalize stock deduction, payments, numbering |
| purchase_orders | 34    | draft→submit→receive→pay, atomic numbering, expiry batches              |
| permissions     | 18    | role-permission matrix, soft_delete, version conflict helpers           |
| audit           | 11    | log write-through, pagination, scoping                                  |
| reports         | 22    | sales/stock/P&L/ledger/movements incl. empty-company                    |
| export          | 12    | CSV escaping, headers/rows, permission + write-error paths              |
| import_wizard   | 27    | header mapping, docx/CSV parsing, execute_import end-to-end             |
| backup          | 13    | backup/restore/list + safety copy, non-SQLite rejection                 |

Production bugs surfaced and fixed by the suite: 3 SQL literal-misplacements in PO stock inserts, `next_po_number` race, `finalize_invoice` missing `balance_due`, import "Tax Rate"→`sell_price` mapping, and backup hardcoding the production DB path. See `TEST_CASES.md` header.

---

_Report refreshed 2026-08-05 against the live tree at v1.0.0. Verification: `cargo test --lib` (366 green), `cargo check --all-targets` (0 warnings), `tsc --noEmit` clean, direct inspection of all 9 migrations, 78 registered commands, and the release workflow._
