# Ijaz & Company ERP — Project Analysis & Status Report

> **Date:** 2026-08-06
> **Scope:** Refreshed assessment of the current implementation against `SAAS_SPECIFICATION.md` (v5.1), verified against the live codebase, with emphasis on **what is left** and **what the next steps are**. Supersedes the 2026-08-05 v1.0.0 report.
> **Milestone:** **v1.0.2** — Phase 1 (single-tenant desktop ERP core) complete; cloud-only features (§2–§9, §17, §19, §22, §23) partially landed as desktop adaptations.

---

## 1. Project at a Glance

| Attribute           | Value                                                                                                                                                                            |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Product             | Ijaz & Company ERP (desktop application)                                                                                                                                         |
| Version             | **1.0.2** (tagged)                                                                                                                                                               |
| Architecture        | Tauri 2.11 + React 19 + Mantine 9 + TypeScript + Rust (sqlx 0.9 + SQLite)                                                                                                        |
| Database            | SQLite (single-tenant desktop mode per spec §21)                                                                                                                                 |
| Data flow           | Tauri `invoke()` IPC — no HTTP/REST layer                                                                                                                                        |
| Auth                | In-memory Rust session + SQLite session persistence (bcrypt) + login rate limiting                                                                                               |
| Registered commands | **96** (incl. `greet`); 95 business commands across auth, company, users, inventory, invoices, import, purchase orders, reports, audit, permissions, export, updater, backup, **ledger, roles, search, theme, notifications, retention** |
| Migrations          | **13** (`001..013`) — users, companies, inventory, invoices, session, expiry batches, purchase orders, audit log, soft-delete/versioning/permissions, **FTS5 search, theme, accounting ledger, custom roles** |
| Build status        | ✅ Frontend + Rust + NSIS installer + updater artifacts build clean                                                                                                              |
| Auto-update         | ✅ Wired (GitHub Actions release pipeline + minisign + `latest.json`)                                                                                                            |
| Tests               | ✅ **385 Rust integration tests, all green** (`cargo test --lib`); clean `tsc --noEmit`. (Note: `cargo check`/`clippy` currently emit pre-existing warnings after a repo-wide `cargo fmt` pass) |
| Spec alignment      | **Desktop/Local Mode** (single-tenant SQLite) — **v1.0 desktop achieved**; the SaaS/cloud layer is a deliberate later phase, but several formerly-🔴 spec items now ship as desktop adaptations (accounting, custom roles, FTS5, notifications, retention, PDF export) |

---

## 2. Executive Summary

Since the 2026-08-05 report the project has advanced **v1.0.0 → v1.0.2** and closed out most of the previously-open "medium priority" desktop items:

- ✅ **Accounting ledger (spec §19)** — migration `012`, `ledger.rs`: seeded chart of accounts, double-entry `post_journal_entry`, automatic posting on invoice finalize (`post_invoice_sale`) and payment collection (`post_payment_collection`), journal entries, account statement, manual entry. Tested (6 tests).
- ✅ **Custom roles (spec §2)** — migration `013`, `roles.rs`: `create_custom_role`, `update_role_permissions`, `delete_custom_role`, `get_my_permissions`, built-in role protection. Tested (5 tests).
- ✅ **FTS5 full-text search (spec §22)** — migration `010` (products/customers/invoices FTS virtual tables + sync triggers), `search.rs::search_all` with ranked, company-scoped results.
- ✅ **Notifications / activity feed (spec §18.1)** — `notifications.rs::get_notifications`: low-stock + expiring-batch alerts (queries already existed).
- ✅ **ETO retention policy & archival (spec §8.11 / §16.2)** — `retention.rs`: `get_retention_summary` (archivable invoices/POs/movements by 5-year cutoff) + `archive_old_records` (owner-only soft-archive).
- ✅ **PDF report export (spec §11.1)** — `export_report_pdf` + `pdf.rs` (minimal hand-rolled PDF: title/table layout), alongside the existing 3 CSV exports.
- ✅ **Theme settings (spec §11)** — `theme.rs`: `get_theme` / `update_theme` / `read_file_base64` (custom logo).
- ✅ **Import wizard: three targets (spec §23 Phase-1)** — `execute_import` now dispatches on `ImportRequest.target`:
  - `products` (default, unchanged)
  - **`customers`** — FBR-aware vocabulary (`detect_customer_field`: name, email, phone, address, CNIC, NTN, STRN, buyer type), duplicate suppression by name (case-insensitive), buyer-type validation.
  - **`opening_stock`** — `detect_opening_stock_field` (SKU/code, name, quantity, cost price, expiry), SKU-matched stock addition with movement recording and expiry-batch creation (unit cost from file or product), rejects unknown SKUs and negative quantities.

**Verdict:** the desktop ERP is feature-complete for the core loop **import → inventory → sales → purchase → accounting → reports → export**, now with an accounting trail, custom roles, FTS5 search, notifications, retention archival and PDF export. The largest remaining functional gap is the **import system's production safety layer** (§23.3–§23.12) and wiring the new import targets into the UI. The SaaS/cloud end-state remains future work.

---

## 3. What Is Achieved (Verified)

### 3.1 Auth, Company Setup, Users

- `auth.rs` (8 commands): login/logout (rate-limited), current user, profile/password change, persistent session (migration `005`). bcrypt 0.19, email normalization.
- `company.rs`: single-tenant registration gate, one company per installation enforced.
- `users.rs`: role management (`owner`/`admin`/`employee`) with DB-trigger enforcement + permission checks.

### 3.2 Permissions, Roles & Security Core

- `permissions.rs`: `check_permission` against seeded `role_permissions` (owner always allowed); `soft_delete`, `check_version`, `bump_version` helpers — migration `009`.
- **`roles.rs` (custom roles, §2)**: create/update/delete custom roles, per-role permission matrix, `get_my_permissions`; built-in roles protected from deletion — migration `013`.
- `audit.rs`: `log_audit` write-through on every mutating command; `list_audit_logs` with pagination; owner/admin viewer.

### 3.3 Inventory & Expiry (spec §4 `inventory`)

- Categories, suppliers, products (paisa/cents), stock movements, custom fields (JSON), import templates.
- `inventory.rs` (20 commands): products, stock adjust, movements, custom fields, **batch tracking** (`list_product_batches`, `list_expiring_batches`, `write_off_batch` — migration `006`).

### 3.4 Invoicing (spec §4 `sales`)

- Customers with FBR fields (CNIC/NTN/STRN/buyer type), `draft → finalized → paid (+cancelled)`, transactional stock deduction in `finalize_invoice`, payments, invoice settings.
- **Concurrency-safe numbering** — `generate_invoice_number` reads+increments atomically inside the invoice transaction.
- **Ledger integration** — `finalize_invoice` posts the sale and `record_payment` posts the collection to the accounting ledger automatically.
- `generate_invoice_html` renders a complete HTML invoice and opens it in the OS default browser (print works; webview-window polish is a minor outstanding item).

### 3.5 Purchase Orders

- Migration `007`: `purchase_orders`, `purchase_order_items`, `purchase_payments`, `company_po_settings`.
- `purchase_orders.rs` (8 commands): create → add/remove items → submit → receive (stock-in + batch creation) → record payment. Atomic `next_po_number` upsert.

### 3.6 Accounting Ledger (spec §19)

- Migration `012` + `ledger.rs` (5 commands): seeded `accounts` (cash, receivables, inventory, sales revenue, COGS, VAT, equity, payables), `get_chart_of_accounts`, `get_ledger_summary`, `get_journal_entries`, `get_account_statement`, `post_manual_entry`; internal `ensure_chart_of_accounts`, `post_journal_entry`, `post_invoice_sale`, `post_payment_collection`.
- Double-entry posting is automatic from invoice finalize and payment collection; manual journal entries supported.

### 3.7 Reports, Export & PDF

- `reports.rs` (8 commands): sales summary, sales by month, top products, top customers, stock, P&L, customer ledger, product movements.
- `export.rs` (4 commands): stock / customer ledger / sales CSV with proper CSV escaping (`escape_csv`) + **`export_report_pdf`** backed by `pdf.rs`.

### 3.8 Import Wizard (spec §23 Phase-1)

- `import_wizard.rs`: CSV / XLS/XLSX (calamine) / DOCX (quick-xml) analysis → auto column mapping with confidence → `execute_import` with per-row error capture, custom-field registration (products), expiry batches and a 50-error cap.
- **Three targets** (`products`, `customers`, `opening_stock`), each with its own field-mapping vocabulary; customer FBR fields + name dedup; opening-stock SKU matching with movement + batch creation. Tests: **35**.
- ⚠️ **Backend-only so far** — the `ImportWizard.tsx` UI is still products-only; `analyzeImportFile`/`executeImport` in `backend.ts` do not pass `target`, so customers/opening-stock import is unreachable from the UI. See §5.1.

### 3.9 Search, Notifications, Retention, Theme

- `search.rs::search_all` — FTS5 ranked search across products, customers and invoices (migration `010`).
- `notifications.rs::get_notifications` — low-stock and expiring-batch alerts (in-app activity feed).
- `retention.rs` — ETO 5-year retention summary + owner-only archival (soft-delete of old paid/cancelled invoices, POs and movements).
- `theme.rs` — `get_theme` / `update_theme` / `read_file_base64` (custom logo), migration `011`.

### 3.10 Update & Backup

- `updater.rs`: `check_for_updates` / `install_update`; GitHub Actions release pipeline (NSIS + `.sig` + `latest.json`).
- `backup.rs`: `create_backup` / `restore_backup` / `list_backups`, operating on the pool's actual DB file (safety copy created before restore). Full UI in Settings.

### 3.11 Build & Packaging

- `tsc`/`vite build` clean; NSIS installer + `.sig` + `latest.json` pipeline proven.
- `bundle.targets = ["nsis", "app"]`. Dev tooling: `scripts/run-tauri.mjs` shim for Snap environments.

---

## 4. Spec Coverage Matrix (Desktop/Local relevance)

| Spec Section   | Feature                                                                                                                | Status                                                                                                                         |
| -------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| §2             | Roles & hierarchy (Super Admin, inventory_manager/sales_user/import_clerk, custom roles)                               | 🟢 **Custom roles built** (`roles.rs`, migration 013); Super Admin N/A in Local mode                                           |
| §3             | packages, subscriptions, company_modules, audit_logs, refresh_tokens, encrypted_secrets, invoice_sequences, accounting | 🟡 **audit_logs + accounting built**; rest N/A in Local mode                                                                   |
| §4             | Module system & enforcement                                                                                            | 🟡 No module system (sidebar is hardcoded)                                                                                     |
| §4 `purchases` | Purchase orders                                                                                                        | 🟢 **Built** (007 + commands + UI)                                                                                             |
| §5             | Super Admin dashboard                                                                                                  | 🔴 N/A in Local mode                                                                                                           |
| §6             | Company Admin dashboard                                                                                                | 🟡 Partial (settings/employees/customers exist; modules/subscription/tickets/branches don't)                                   |
| §7             | JWT + refresh + permission cache                                                                                       | 🟡 Desktop in-memory session + `role_permissions` cache instead (acceptable for Local mode)                                    |
| §8             | Security: audit, soft deletes, optimistic locking, rate limiting, archival                                             | 🟢 **Built** (audit 008, soft-delete/versioning 009, `LoginAttemptTracker`, `check_permission`, **retention archival** `retention.rs`) |
| §10            | Invoice template system / FBR lifecycle                                                                                | 🟡 Draft → finalize → paid works + HTML print + ledger posting; FBR/IRN/QR/CN/DN not built                                    |
| §11            | Analytics & reporting                                                                                                  | 🟢 **Reports + CSV + PDF export built** (8 reports + charts + 3 CSV + 1 PDF export)                                            |
| §12            | Dynamic sidebar / super admin / first-login                                                                            | 🟡 Sidebar static; no super admin; no forced password change                                                                   |
| §13            | API routes                                                                                                             | 🟡 N/A — Tauri IPC replaces REST (equivalent commands exist)                                                                   |
| §16            | Legal & compliance (PECA logging/rate-limit, ETO 5-year, FBR, PDPB/GDPR)                                               | 🟢 **PECA logging + rate limiting + ETO retention/archival implemented**; FBR, PDPB/GDPR still open                            |
| §17            | FBR/PRAL integration                                                                                                   | 🔴 Not built (schema placeholders only)                                                                                        |
| §18            | Gap register: notifications, pagination, SSE, error schema, tests, observability                                       | 🟡 **Tests built (385) + notifications built + pagination on audit**; SSE/error-schema/observability open                      |
| §19            | Accounting ledger / outbox                                                                                             | 🟢 **Double-entry ledger built** (012 + `ledger.rs`); outbox N/A in Local mode                                                 |
| §21            | DB mode separation                                                                                                     | 🟢 Correctly operates as SQLite Local mode                                                                                     |
| §22            | Search (FTS)                                                                                                           | 🟢 **FTS5 built** (migration 010 + `search.rs`)                                                                                |
| §23            | Import system                                                                                                          | 🟡 Phase-1 targets (products/customers/opening_stock) work; **no job queue, no rollback, no preview/confirm, no conflict strategy, no SSE, no named adapters, UI not wired** — see §5.1 |
| §24            | Intelligence layer (AI)                                                                                                | 🔮 Deferred by spec — correctly absent                                                                                         |

---

## 5. What Is Left — Gap Register (Prioritized)

### 5.1 🟠 HIGH: Import system — requirements from the import-wizard work that were NOT achieved

The previous import-wizard work landed the three backend targets and their mapping vocabularies, but the following §23 requirements remain **unachieved** and should be treated as the next work package:

1. **Frontend target wiring.** `ImportWizard.tsx` is products-only and `analyzeImportFile`/`executeImport` in `backend.ts:307/315` never pass `target`. The `customers` and `opening_stock` backends are **unreachable from the UI** until a target picker is added and the wizard's product-specific assumptions (e.g. the `hasSku`/`hasExpiry` gates at `ImportWizard.tsx:416-418`) are made target-aware.
2. **Sales invoice & purchase bill import types (§23.2).** The spec's primary targets — historical invoices and purchase bills — are not implemented; only `products` / `customers` / `opening_stock` exist (`IMPORT_TARGETS`, `import_wizard.rs:125`).
3. **Supplier list import (§23.2).** No `suppliers` target despite suppliers already existing in inventory.
4. **Background job execution + live progress (§23.3, §23.8).** `execute_import` is synchronous and single-shot; the `import_jobs` table (migration `009`) is defined but **never written** — no `import_jobs` rows, no job lifecycle (`pending → processing → completed|failed`), no SSE progress stream.
5. **Preview → confirm gate (§23.3).** `analyze_import_file` produces a preview, but there is no separate confirmation step; `execute_import` commits immediately on the user's first action.
6. **User-selectable conflict strategy (§23.7).** No `Skip / Overwrite / Suffix` choice. Behavior is fixed per target: customers skip by name, duplicate product SKUs error the row, opening stock accumulates on top of existing quantity.
7. **Rollback (§23.12).** No `import_batch_id` tagging on imported products/customers/stock, no rollback command, no 24-hour rollback window. An import that fails partway or was mis-mapped cannot be undone except by manual cleanup.
8. **Named ERP adapters (§23.11).** No pre-built mappings for QuickBooks (IIF/CSV), Odoo, ERPNext, Tally, MS Excel generic.
9. **Import rate limits & quotas (§23.10).** No max file size / max rows / concurrency / per-hour caps on import jobs.
10. **PDF/image + OCR import (§23.2 Phase 2).** PDF files are explicitly rejected; no OCR path.
11. **Per-target reusable templates (§23.5).** `import_templates` (migration `003`) has no `import_type`/target column, no auto-detect-and-reuse on repeat uploads, no `use_count`/`last_used_at`.

**Recommendation:** ship items 1–7 as "Import v2" before any SaaS work — they are the difference between a demo-grade import and a trustworthy production onboarding path.

### 5.2 🟠 High — other

12. **Print/PDF polish.** `handlePrint` (`InvoicePage.tsx`) discards the returned path and relies on the backend side-effect of opening the OS default browser. Polish: open in a Tauri `WebviewWindow` with `window.print()` (direct "Save as PDF"), use the return value, add a branded printable template.
13. **Test coverage for the new modules.** `notifications`, `retention`, `search`, and `theme` have **zero automated tests** (the retention/search/notification logic touches money-sensitive paths — stock, invoices, POs).

### 5.3 🟡 Medium

14. **FBR/PRAL integration (spec §17)** — customer/company FBR fields exist but no payloads, queue, IRN/QR. Largest single chunk of the spec; firmly a SaaS-phase item.
15. **PDPB/GDPR (spec §16.3)** — not addressed.
16. **Module system / dynamic sidebar / forced first-login password change (spec §4, §12).**
17. **SSE, unified error schema, observability (spec §18).**

### 5.4 🟢 Low / hygiene

18. `src/BackendTester.tsx` — dead placeholder. Remove it.
19. Commented-out legacy code in `src-tauri/src/lib.rs:1–111`; trim unused deps (`tauri-plugin-sql` unregistered, sqlx `postgres` + `tls-rustls` features, `dotenv`).
20. `withGlobalTauri: true` in `tauri.conf.json` exposes `window.__TAURI__` — tighten for release.
21. **Repo-wide `cargo fmt` was run on 2026-08-06 and reformatted ~15 files that already had uncommitted work** (auth, backup, export, inventory, invoices, notifications, purchase_orders, retention, users, lib.rs, etc.). Content is intact, but the working-tree diff is noisy; a dedicated formatting commit (or pre-commit hook) should land before the next release.
22. No ESLint/Prettier/clippy enforcement (clippy currently emits pre-existing warnings, e.g. `manual_is_multiple_of`, `too_many_arguments`), no `cargo audit` in CI.

---

## 6. Build & Release Readiness

| Step                             | Result                                                                                                       |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `tsc --noEmit` / `npm run build` | ✅ Clean                                                                                                     |
| `cargo check --all-targets`      | 🟡 Compiles; pre-existing clippy warnings (not errors) after 2026-08-06 fmt pass                             |
| `cargo test --lib`               | ✅ **385 passed, 0 failed**                                                                                  |
| `cargo build --release`          | ✅ Clean                                                                                                     |
| `npm run tauri build`            | ✅ NSIS installer + updater artifacts produced                                                               |
| Updater pipeline                 | ✅ `release.yml` (windows-latest) → NSIS + `.sig` + `latest.json` (uploads.github.com endpoint fix in place) |
| Version bump                     | ✅ `1.0.2` in `package.json`, `package-lock.json`, `Cargo.toml`, `Cargo.lock`, `tauri.conf.json`             |

**Release procedure** (per `Notes.txt`): bump semver in all 5 places → commit + tag + push → `npm run tauri build` with signing key → update `latest.json` with new `.sig` → create GitHub Release for the tag with installer + `.sig` + `latest.json`.

**Runtime notes:** DB at `dirs::data_dir()/ijazandcompany-erp/ijazandcompany.db`; migrations bundled as resources (now 13); backup/restore act on the pool's actual DB file.

---

## 7. Compliance Status

| Requirement                                   | Spec ref | Status                                                                                   |
| --------------------------------------------- | -------- | ---------------------------------------------------------------------------------------- |
| PECA 2016 — access logging                    | §16.2    | 🟢 **Implemented** — `audit_logs` (migration 008) + `log_audit()` write-through + viewer |
| PECA 2016 — rate limiting / failed-login logs | §16.2    | 🟢 **Implemented** — `LoginAttemptTracker` (5/60s lockout)                               |
| ETO 2002 — 5-year immutable record retention  | §16.2    | 🟢 **Implemented** — `retention.rs` summary + owner-only archival (soft-delete)          |
| FBR digital invoicing                         | §17      | 🔴 Placeholder fields only                                                               |
| PDPB / GDPR                                   | §16.3    | 🔴 Not addressed                                                                         |

---

## 8. Project Maturity Level

| Level                                         | Verdict                                                                                                                                               |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Technical prototype                           | ✅ Passed                                                                                                                                             |
| v0.1 Desktop MVP                              | ✅ Passed (2026-08-01)                                                                                                                                |
| v1.0 Production desktop app                   | ✅ Reached (2026-08-05)                                                                                                                               |
| **v1.0.2 desktop (accounting, roles, FTS5)**  | ✅ **Reached (2026-08-06)** — double-entry ledger, custom roles, FTS5 search, notifications, ETO retention/archival, PDF export, 3-target import backend (385 tests) |
| SaaS / Multi-tenant platform (spec end-state) | 🔴 Future — §5–§9, §17, §23.3–§23.12, §24 not started (FTS5/ledger/roles shipped as desktop adaptations)                                              |

---

## 9. Next Steps — Recommended Roadmap

**Finish the import system and desktop UX before any SaaS work.** The desktop core loop is complete; the import wizard is now the highest-leverage remaining feature.

### Step 1 — Import v2 (the not-achieved §23 requirements)

1. **Wire the UI** — add a target picker (Products / Customers / Opening Stock) in `ImportWizard.tsx` and pass `target` through `analyzeImportFile`/`executeImport`; make the wizard target-aware (per-target "required columns" hints, per-target results display).
2. **Preview → confirm** — a review step showing first-50-row preview + validation summary before commit.
3. **Conflict strategy** — user-selectable Skip / Overwrite / Suffix (§23.7).
4. **Job queue + progress** — start writing `import_jobs` (migration `009` already defines the table); async execution with polled/SSE progress (§23.3, §23.8).
5. **Rollback** — `import_batch_id` tagging + a 24-hour rollback command (§23.12).
6. **Add the missing targets** — sales invoices, purchase bills, suppliers (§23.2).
7. **Import quotas** — max file size / rows / concurrency (§23.10).

### Step 2 — Desktop polish & hardening

8. Print/PDF in a webview window (return value used, branded template).
9. Add automated tests for `notifications`, `retention`, `search`, `theme`.
10. Remove `BackendTester.tsx`, strip legacy `lib.rs` comments, trim unused deps.
11. Land a formatting/CI hygiene commit (clean clippy, Prettier/ESLint, `cargo audit`), tighten `withGlobalTauri`.

### Step 3 — Decision point: SaaS (only after desktop is proven)

12. Spec's `saas`/`desktop` split (§21.2), PostgreSQL mode, `super_admin`, packages/subscriptions, module enforcement, RLS, permission cache (§5–§9).
13. FBR/PRAL integration with outbox queue (§17) — requires FBR sandbox registration.
14. PDPB/GDPR, SSE, unified error schema, observability (§16.3, §18).

### Deferred (per spec)

- Intelligence layer (AI) — after 20–30 tenants × 12+ months of data (§24/§25).

---

## 10. Test Suite Summary

385 tests across 14 modules, all against real migrated SQLite DBs via `test_helpers.rs` (`setup_app` = mock Tauri app + temp-file pool + session + rate-limit tracker). Full catalog in `TEST_CASES.md` (⚠️ the counts below supersede `TEST_CASES.md`, which still shows the older `import_wizard.rs — 27 tests` and does not yet list `ledger`/`roles`).

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
| import_wizard   | **35**| header mapping per target, docx/CSV parsing, execute_import e2e: products relations+batches, customers FBR/dedup/missing-name, opening-stock qty+batch/unknown-SKU |
| backup          | 13    | backup/restore/list + safety copy, non-SQLite rejection                 |
| ledger          | 6     | chart of accounts seed, journal posting, balance integrity              |
| roles           | 5     | custom role CRUD, permission updates, built-in role protection          |
| notifications   | 0     | **⚠️ no tests**                                                          |
| retention       | 0     | **⚠️ no tests**                                                          |
| search          | 0     | **⚠️ no tests**                                                          |
| theme           | 0     | **⚠️ no tests**                                                          |

Production bugs surfaced and fixed by the suite: 3 SQL literal-misplacements in PO stock inserts, `next_po_number` race, `finalize_invoice` missing `balance_due`, import "Tax Rate"→`sell_price` mapping, backup hardcoding the production DB path, and (2026-08-06) `detect_customer_field` mis-mapping `"Buyer Type"` → `customer_name` because substring matching hit the `"buyer"` name alias before the buyer-type check. See `TEST_CASES.md` header.

---

_Report refreshed 2026-08-06 against the live tree at v1.0.2. Verification: `cargo test --lib` (385 green), `tsc --noEmit` clean, direct inspection of all 13 migrations, 96 registered commands, the import-wizard targets (`products`/`customers`/`opening_stock`), and the release workflow._
