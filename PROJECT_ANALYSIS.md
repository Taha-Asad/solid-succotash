# Ijaz & Company ERP — Project Analysis & Status Report

> **Date:** 2026-08-20
> **Scope:** Refreshed assessment of the current implementation against `SAAS_SPECIFICATION.md` (v5.1), verified against the live codebase, with emphasis on **what is left** and **what the next steps are**. Supersedes the 2026-08-19 v1.0.7 report.
> **Milestone:** **v1.0.8** — Phase 1 (single-tenant desktop ERP core) complete; multi-currency support landed; FBR/PRAL digital invoicing integration (§17) landed as desktop adaptation; cloud-only features (§2–§9, §22, §23) partially landed as desktop adaptations.

---

## 1. Project at a Glance

| Attribute           | Value                                                                                                                                                                            |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Product             | Ijaz & Company ERP (desktop application)                                                                                                                                         |
| Version             | **1.0.8** (tagged)                                                                                                                                                               |
| Architecture        | Tauri 2.11 + React 19 + Mantine 9 + TypeScript + Rust (sqlx 0.9 + SQLite)                                                                                                        |
| Database            | SQLite (single-tenant desktop mode per spec §21)                                                                                                                                 |
| Data flow           | Tauri `invoke()` IPC — no HTTP/REST layer                                                                                                                                        |
| Auth                | In-memory Rust session + SQLite session persistence (bcrypt) + login rate limiting                                                                                               |
| Registered commands | **121**; business commands across auth, company, users, inventory, invoices, import (incl. `list_erp_adapters`, `list_import_templates`, `delete_import_template`), purchase orders, reports, audit, permissions, export, updater, backup, ledger, roles, search, theme, notifications, retention, invoice design, units, currency (`get_all_currencies`, `get_company_currency`, `fetch_exchange_rates`, `get_exchange_rate`, `get_exchange_rate_history`), **FBR** (`get_fbr_config`, `save_fbr_config`, `test_fbr_connection`, `get_fbr_queue_status`, `retry_fbr_submission`, `get_invoice_fbr_status`, `process_fbr_queue_now`, `create_credit_note`, `create_debit_note`), **modules** (`get_my_modules`) |
| Migrations          | **19** (`001..019`) — users, companies, inventory, invoices, session, expiry batches, purchase orders, audit log, soft-delete/versioning/permissions, FTS5 search, theme, accounting ledger, custom roles, import batches + units, invoice designs, import-jobs target, multi-currency, **FBR integration** (fbr_config + fbr_submission_queue tables) |
| Build status        | ✅ Frontend + Rust + NSIS installer + updater artifacts build clean                                                                                                              |
| Auto-update         | ✅ Wired (GitHub Actions release pipeline + minisign + `latest.json`)                                                                                                            |
| Tests               | ✅ **499 Rust integration tests, all green** (`cargo test --lib`, ~200s); clean `tsc --noEmit`. (Note: `cargo check`/`clippy` still emit pre-existing warnings; 1 flaky backup test under parallel load) |
| Spec alignment      | **Desktop/Local Mode** (single-tenant SQLite) — **v1.0 desktop achieved**; the SaaS/cloud layer is a deliberate later phase, but several formerly-🔴 spec items now ship as desktop adaptations (accounting, custom roles, FTS5, notifications, retention, PDF/Excel invoice export, **full §23 import: 6 targets, adapters, per-target templates, PDF/OCR, quotas, jobs/rollback**, units §23.16, **multi-currency with FX gain/loss**, **FBR/PRAL digital invoicing with outbox queue, exponential backoff, IRN, credit/debit notes**) |

---

## 2. Executive Summary

Since the 2026-08-10 report the project has advanced **v1.0.5 → v1.0.8** and closed out the multi-currency and FBR gaps:

- ✅ **Multi-currency support (FUTURE_FEATURES.md §2)** — migration `018` adds `currency_config` (50+ currencies seeded), `exchange_rates` cache table, and FX gain/loss GL accounts (`7000`/`7100`). New `currency.rs` module with `CurrencyConfig` / `ExchangeRate` types, `format_currency`, `convert_amount`, and 5 Tauri commands (`get_all_currencies`, `get_company_currency`, `fetch_exchange_rates`, `get_exchange_rate`, `get_exchange_rate_history`). Exchange rates fetched from `exchangerate-api.com` (free tier). **Invoice-level multi-currency**: invoices store `currency_code` + `exchange_rate`; items store `original_unit_price` / `original_line_total` (invoice currency) alongside base-currency equivalents; payments compute `base_currency_amount` and post **FX gain/loss journal entries** to ledger. Export PDFs use dynamic currency symbols. Frontend: `src/utils/currency.ts` (format/parse helpers), updated types/API layer, currency selector in CreateInvoiceModal with live rate fetching, dynamic formatting across Dashboard/Accounts/Settings pages.
- ✅ **FBR/PRAL Digital Invoicing (spec §17)** — migration `019` adds `fbr_config` (credentials, environment, sandbox/production URLs, test results) and `fbr_submission_queue` (outbox pattern: payload, attempts, status, IRN, QR data). New `fbr.rs` module (~1300 lines): FBR API payload builder (NTN/STRN, buyer type, line items with tax/exempt amounts), sandbox/production endpoint support, exponential backoff queue processor (0→2m→10m→30m→2h, dead letter after 5 attempts), outbox pattern wired into `finalize_invoice` transaction, FBR-compliant QR code format (`{IRN}|{Date}|{STRN}|{Total}`), 9 Tauri commands (`get_fbr_config`, `save_fbr_config`, `test_fbr_connection`, `get_fbr_queue_status`, `retry_fbr_submission`, `get_invoice_fbr_status`, `process_fbr_queue_now`, `create_credit_note`, `create_debit_note`). IRN stored on invoice after successful submission. Frontend: dedicated FBR Integration settings tab (environment selector, PRAL token, test connection, queue status table with retry), FBR status badge on invoice detail + list views, credit/debit note modals, TypeScript types + API bindings for all FBR commands.
- ✅ **Invoice design system (spec §10)** — migration `015`, `invoices.rs` design commands: built-in designs (`classic` / `modern` / `minimal` / `excel`), accent color, show/hide FBR QR block (SVG via `qrcode` crate), free-text footer (disclaimer / copyright / bank details), **user-uploaded `.xlsx` invoice template** with placeholder-token replacement (`save_invoice_excel_template` / `analyze_invoice_excel_template` / `generate_invoice_excel` / `download_sample_invoice_template`), and **native invoice PDF export** (`generate_invoice_pdf` via `pdf.rs`). Sample template shipped at `src/assets/sample-invoice-template.xlsx` (generated by `scripts/make_sample_invoice_template.py`). Full UI in Settings → Invoice Design + InvoicePage export menu (PDF save dialog + Excel). Tested (14 design/QR/PDF/Excel tests).
- ✅ **Import v2: UI wiring, suppliers target, jobs, rollback (spec §23)** — `ImportWizard.tsx` is now target-aware with a **target picker** (Products / Customers / Suppliers / Opening Stock); `execute_import` now **writes `import_jobs` rows** (migration `009` table finally used), `list_import_jobs` lists recent runs, and **`rollback_import`** deletes everything a run created (tagged products / customers / suppliers / stock movements / batches, opening-stock quantity reverted) inside a **24-hour rollback window**. New **`suppliers`** import target (4 targets total). Migration `014` added the `units` table (spec §23.16) plus the `import_batch_id` rollback columns/indexes; migration `016` added `import_jobs.target`.
- ✅ **Import v3: invoices + purchase bills, quotas, confirm gate, background jobs (spec §23)** — **`confirm_import`** is now the only commit path (preview→confirm gate), it enforces **quotas** (1 concurrent job per company, 5 jobs/hour) and hands the file to a **background worker** that drives `pending → processing → completed|failed` while the wizard **polls `get_import_job`** for live progress. New import targets **`invoices`** (sales: number/date/customer, line items with product SKU, qty, unit price, tax, discounts, expiry, totals; auto-insert as `draft` then flipped to `finalized`) and **`purchase_bills`** (PO number/supplier, line items, totals). Auto-numbering via `company_invoice_settings` / `company_po_settings`, `resolve_or_create_customer` / `resolve_or_create_supplier` (tagged with `import_batch_id` for rollback), per-target header detectors, row validators, and **dry-run previews**. ERP adapters for **QuickBooks / Odoo / ERPNext / Tally / Excel** expose pre-built header vocabulary (spec §23.11).
- ✅ **Per-target reusable templates (spec §23.5)** — `import_templates` gained `target`, `use_count` and `last_used_at` (via idempotent `ensure_import_template_columns`); `save_import_template` is now a target-scoped upsert that bumps usage, **auto-detect-and-reuse** matches a saved template to a re-uploaded file's headers during analysis (and applies its mappings), and `list_import_templates` / `delete_import_template` power the wizard's template picker + "auto-detected template" banner.
- ✅ **PDF/image + OCR import (spec §23.2 Phase 2)** — PDFs with a text layer are parsed with the `pdf-extract` crate (row splitting on tabs / 2+ spaces); scanned images and image-PDFs run **OCR through Tesseract** (`read_image_rows` → `ocr_image_to_text`, which decodes the image with `image`, writes a temp file and shells out to `tesseract --psm 6`). The wizard now accepts `.pdf`, `.png`, `.jpg`. Tesseract is **bundled with the installer** (UB-Mannheim engine staged by `scripts/fetch-tesseract.mjs`, resolved via `OCR_BUNDLE` at setup) with a fallback to a `tesseract` on PATH.
- ✅ **Units of measure (spec §23.16)** — the `units` table is now wired: `list_units` / `create_unit` / `update_unit` / `delete_unit` commands (owner/admin gated, audit-logged, single default unit per company) plus a **Units manager modal** and a live unit **picker** in the product form (falls back to a sensible default list when the table is empty).
- ✅ **Journal fix + purchase order fixes** — ledger posting corrections and PO receive/payment hardening in `invoices.rs` / `purchase_orders.rs` (UI + backend).
- ✅ **Dark mode & UI polish** — `AppThemeProvider` (light / dark / auto), theme refactor, `AppDateInput` component, and visual pass across Dashboard, Accounts, Reports, Settings, Inventory, Purchase Orders.
- ✅ **Version bump `1.0.8`** (Cargo.toml / package.json).

**Verdict:** the desktop ERP is feature-complete for the core loop **import → inventory → sales → purchase → accounting → reports → export**, now with an accounting trail, custom roles, FTS5 search, notifications, retention archival, PDF/Excel invoice export, a designable invoice system, the **full §23 import system** — 6 targets, background jobs with push progress, preview→confirm, conflict strategies, ERP adapters, per-target reusable templates with auto-map, PDF/text + bundled-OCR input, 24 h rollback — plus units-of-measure management (§23.16), **multi-currency support** with live exchange rates, invoice-level foreign currency, FX gain/loss accounting, and dynamic currency formatting across all pages, **FBR/PRAL digital invoicing** with outbox queue, exponential backoff, IRN lifecycle, credit/debit notes, and FBR-compliant QR codes, **module system** (8 modules seeded per company, toggleable by owner in Settings → Modules, sidebar filtered by enabled modules, `get_my_modules` command), and **forced first-login password change** (`must_change_password` flag on all new users, blocks navigation until changed, clears flag after update). The SaaS/cloud end-state remains future work.

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
- **Module system (spec §4)**: `company_modules` table seeded with 8 modules per company on registration (`inventory`, `invoices`, `purchase_orders`, `reports`, `ledger`, `users`, `settings`, `import`). Owner toggles via Settings → Modules. `get_my_modules` command returns enabled module keys. Sidebar hides disabled modules. `ensure_company_modules_seeded()` backfills existing companies during migration.
- **Forced first-login password change (spec §12)**: `must_change_password` column (migration 002) set to `1` for all newly created users. Login + session restore check this flag and redirect to a dedicated `ChangePasswordPage` that blocks all navigation. `change_my_password` clears the flag after success.

### 3.3 Inventory & Expiry (spec §4 `inventory`)

- Categories, suppliers, products (paisa/cents), stock movements, custom fields (JSON), import templates.
- `inventory.rs` (20 commands): products, stock adjust, movements, custom fields, **batch tracking** (`list_product_batches`, `list_expiring_batches`, `write_off_batch` — migration `006`).
- **`units` table + `units.rs`** (migration `014`, spec §23.16) — `list_units` / `create_unit` / `update_unit` / `delete_unit` commands (owner/admin, audit-logged, single default unit per company) feed a **Units manager modal** and the product form's live **unit picker** (fallback to a default list when empty).

### 3.4 Invoicing (spec §4 `sales`)

- Customers with FBR fields (CNIC/NTN/STRN/buyer type), `draft → finalized → paid (+cancelled)`, transactional stock deduction in `finalize_invoice`, payments, invoice settings.
- **Concurrency-safe numbering** — `generate_invoice_number` reads+increments atomically inside the invoice transaction.
- **Ledger integration** — `finalize_invoice` posts the sale and `record_payment` posts the collection to the accounting ledger automatically.
- **Multi-currency** — invoices can be created in any supported currency (50+ seeded in `currency_config`); exchange rates fetched live from `exchangerate-api.com`; items store both invoice-currency and base-currency amounts; payments compute `base_currency_amount` and post FX gain/loss journal entries (`7000` Foreign Exchange Gain / `7100` Foreign Exchange Loss). Currency selector in CreateInvoiceModal with rate preview.
- **Invoice design system (migration `015`)** — `invoice_design` (classic/modern/minimal/excel), `design_accent_color`, `show_qr` (FBR QR SVG), `excel_template_base64` (uploaded `.xlsx` design with placeholder tokens), footer fields (`disclaimer`, `copyright`, `bank_details`). Commands: `generate_invoice_pdf` (native PDF via `pdf.rs`), `generate_invoice_excel` (fills the uploaded template, `fill_excel_template`), `save_invoice_excel_template`, `analyze_invoice_excel_template`, `download_sample_invoice_template`. HTML render (`generate_invoice_html`) remains for in-browser print.

### 3.5 Purchase Orders

- Migration `007`: `purchase_orders`, `purchase_order_items`, `purchase_payments`, `company_po_settings`.
- `purchase_orders.rs` (8 commands): create → add/remove items → submit → receive (stock-in + batch creation) → record payment. Atomic `next_po_number` upsert. Receive/payment paths hardened in v1.0.4.

### 3.6 Accounting Ledger (spec §19)

- Migration `012` + `ledger.rs` (5 commands): seeded `accounts` (cash, receivables, inventory, sales revenue, COGS, VAT, equity, payables), `get_chart_of_accounts`, `get_ledger_summary`, `get_journal_entries`, `get_account_statement`, `post_manual_entry`; internal `ensure_chart_of_accounts`, `post_journal_entry`, `post_invoice_sale`, `post_payment_collection`.
- Double-entry posting is automatic from invoice finalize and payment collection; manual journal entries supported. Journal posting corrected in v1.0.4.

### 3.7 Reports, Export & PDF

- `reports.rs` (8 commands): sales summary, sales by month, top products, top customers, stock, P&L, customer ledger, product movements.
- `export.rs` (4 commands): stock / customer ledger / sales CSV with proper CSV escaping (`escape_csv`) + **`export_report_pdf`** backed by `pdf.rs` with **dynamic currency symbols**. `pdf.rs` is now also used for `generate_invoice_pdf`.

### 3.8 Import Wizard (spec §23)

- `import_wizard.rs`: CSV / XLS/XLSX (calamine) / DOCX (quick-xml) analysis → auto column mapping with confidence → `execute_import` with per-row error capture, custom-field registration (products), expiry batches and a 50-error cap.
- **Four targets** (`products`, `customers`, `opening_stock`, `suppliers`), each with its own field-mapping vocabulary; customer FBR fields + name dedup; opening-stock SKU matching with movement + batch creation.
- **Jobs + rollback (v1.0.4)**: `execute_import` writes an `import_jobs` row; `list_import_jobs` returns recent runs with `rollback_available`; `rollback_import` undoes a completed run (24 h window) — deletes tagged rows (products/customers/suppliers/batches/movements) and reverts opening-stock quantities. Migration `014`/`016` + `ensure_import_columns` add `import_batch_id` / `target`.
- **UI wired (v1.0.4)**: `ImportWizard.tsx` has a target picker (Products / Customers / Suppliers / Opening Stock / Sales Invoices / Purchase Bills), per-target required-field hints, conflict strategy selector (skip / overwrite / suffix), and an import-history panel with rollback.
- **Async pipeline (v1.0.5)**: `confirm_import` is the only commit path (preview→confirm gate); it enforces quotas (1 concurrent job per company, 5 jobs/hour) and hands the file to a **background worker** via `tokio::spawn`. Worker emits `import:progress` (~every 10 rows) and `import:complete` Tauri events via `AppHandle`; wizard listens for both and shows live progress with a 5 s `get_import_job` re-sync fallback. 6 targets: products, customers, suppliers, opening stock, sales invoices, purchase bills.

### 3.9 Search, Notifications, Retention, Theme

- `search.rs::search_all` — FTS5 ranked search across products, customers and invoices (migration `010`).
- `notifications.rs::get_notifications` — low-stock and expiring-batch alerts (in-app activity feed).
- `retention.rs` — ETO 5-year retention summary + owner-only archival (soft-delete of old paid/cancelled invoices, POs and movements).
- `theme.rs` — `get_theme` / `update_theme` / `read_file_base64` (custom logo), migration `011`. **Dark mode** shipped in the UI (`AppThemeProvider`, light/dark/auto).

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
| §10            | Invoice template system / FBR lifecycle                                                                                | 🟢 **Designable invoices built** (classic/modern/minimal/excel + uploaded XLSX template + PDF + QR); **FBR digital invoicing built** (§17: outbox queue, IRN, CN/DN, exponential backoff) |
| §11            | Analytics & reporting                                                                                                  | 🟢 **Reports + CSV + PDF export built** (8 reports + charts + 3 CSV + 2 PDF exports)                                            |
| §12            | Dynamic sidebar / super admin / first-login                                                                            | 🟡 Sidebar static; no super admin; no forced password change                                                                   |
| §13            | API routes                                                                                                             | 🟡 N/A — Tauri IPC replaces REST (equivalent commands exist)                                                                   |
| §16            | Legal & compliance (PECA logging/rate-limit, ETO 5-year, FBR, PDPB/GDPR)                                               | 🟢 **PECA logging + rate limiting + ETO retention/archival implemented**; FBR, PDPB/GDPR still open                            |
| §17            | FBR/PRAL integration                                                                                                   | 🟢 **Built** — `fbr.rs` module: payload builder, sandbox/production endpoints, outbox queue with exponential backoff (0→2m→10m→30m→2h), dead letter after 5 attempts, IRN storage, credit/debit notes, FBR-compliant QR. Frontend: FBR settings tab, queue status, test connection, invoice FBR status display, credit/debit note modals. Migration 019. |
| §18            | Gap register: notifications, pagination, SSE, error schema, tests, observability                                       | 🟢 **Tests built (499) + notifications built + pagination on audit + unified AppError schema + tracing observability + desktop SSE events + frontend error parsing** |
| §19            | Accounting ledger / outbox                                                                                             | 🟢 **Double-entry ledger built** (012 + `ledger.rs`); outbox N/A in Local mode                                                 |
| §21            | DB mode separation                                                                                                     | 🟢 Correctly operates as SQLite Local mode                                                                                     |
| §22            | Search (FTS)                                                                                                           | 🟢 **FTS5 built** (migration 010 + `search.rs`)                                                                                |
| §23            | Import system                                                                                                          | 🟢 **6 targets (products/customers/suppliers/opening_stock/sales-invoices/purchase-bills) + UI + quotas + background jobs + 24 h rollback + preview→confirm + conflict strategies + ERP adapters + per-target templates + PDF/image-OCR input** — see §5.1 for the small remainder |
| §23.16         | Units of measurement                                                                                                   | 🟢 `units` CRUD commands + Units manager modal + product-form picker (spec §23.16)                                              |
| §2 (multi-curr)| Multi-currency / FX                                                                                                     | 🟢 **50+ currencies**, live exchange rates (exchangerate-api.com), invoice-level foreign currency, FX gain/loss ledger entries, dynamic formatting (migration 018 + `currency.rs`) |
| §24            | Intelligence layer (AI)                                                                                                | 🔮 Deferred by spec — correctly absent                                                                                         |

---

## 5. What Is Left — Gap Register (Prioritized)

### 5.1 ✅ DONE: Import system — §23 remainder closed

The v1.0.4–v1.0.5 work closed the UI-wiring, suppliers-target, job-writing and rollback gaps; the follow-up sessions then shipped the async pipeline, preview→confirm gate, conflict strategies, quotas, **sales-invoice & purchase-bill targets**, **ERP adapters**, **per-target reusable templates with auto-map**, **PDF/text + image/OCR input**, **units wiring**, and the last two open items:

1. **SSE-style push progress (§23.8) — DONE.** The background worker now **emits** `import:progress` (~every 10 rows) and `import:complete` Tauri events via the captured `AppHandle` (`init_app_services` stores it in the `APP_HANDLE` OnceLock at setup). The wizard **listens** for both and shows live progress; a 5 s `get_import_job` re-sync acts as a safety fallback if an event is ever missed.
2. **OCR availability — DONE.** Tesseract is now **bundled with the NSIS installer**: `scripts/fetch-tesseract.mjs` downloads the UB-Mannheim build, extracts it with 7-Zip, and stages `tesseract.exe` + DLLs + `tessdata` (eng/osd/configs) into `src-tauri/bin/tesseract/`, mapped into the bundle via `resources: { "bin/tesseract": "tesseract" }`. At runtime `resolve_tesseract_bundle` prefers the bundled engine (+ `TESSDATA_PREFIX`) and falls back to a `tesseract` on PATH. Non-Windows builds keep using the system binary.

§23 is now functionally complete for Local/desktop mode.

### 5.1b ✅ DONE: FBR/PRAL Digital Invoicing — §17 landed

The v1.0.8 work shipped a comprehensive FBR/PRAL integration as a desktop adaptation:

3. **FBR integration (§17) — DONE.** Migration `019` (`fbr_config` + `fbr_submission_queue`), `fbr.rs` module (~1300 lines): FBR API payload builder (NTN/STRN, buyer type, line items), sandbox/production endpoints, outbox pattern (enqueued inside `finalize_invoice`'s transaction), exponential backoff queue processor (0→2m→10m→30m→2h), dead letter after 5 attempts, IRN stored on invoice after successful submission, FBR-compliant QR code format (`{IRN}|{Date}|{STRN}|{Total}`), 9 Tauri commands. Frontend: dedicated FBR Integration settings tab, queue status with retry controls, test connection, invoice FBR status badge, credit/debit note modals.

### 5.2 🟠 High — other

3. **Test coverage for the new/untested modules.** `notifications`, `retention`, `search`, and `theme` still have **zero automated tests** (the retention/search/notification logic touches money-sensitive paths — stock, invoices, POs).
4. **Print/PDF polish.** `handlePrint` (`InvoicePage.tsx`) still relies on the backend side-effect of opening the OS default browser for HTML print; the saved-PDF path (`generate_invoice_pdf`) exists but the branded webview print flow is unfinished. Use the return value, open a Tauri `WebviewWindow` with `window.print()`.

### 5.3 🟡 Medium

5. **PDPB/GDPR (spec §16.3)** — not addressed.

### 5.3b ✅ DONE: Observability, error schema, SSE (spec §18)

6. **Unified `AppError` type (§18)** — DONE. Tagged enum in `src-tauri/src/error.rs` with 8 error codes (`VALIDATION`, `NOT_FOUND`, `UNAUTHORIZED`, `FORBIDDEN`, `CONFLICT`, `RATE_LIMITED`, `DATABASE`, `INTERNAL`), structured message, optional details array, timestamp. Serializes to JSON for Tauri IPC. Implements `From<String>` (→ `INTERNAL`) and `From<sqlx::Error>` (→ `DATABASE` / `NOT_FOUND` / `CONFLICT`). 7 unit tests. All 23 command files return `Result<T, AppError>` — no more bare strings.
7. **Tracing / observability (§18)** — DONE. `tracing` + `tracing-subscriber` (env-filter + JSON) initialized in `lib.rs` with `RUST_LOG` filter. Structured logging available across all backend modules.
8. **Desktop SSE events (§18)** — DONE. `fbr:queue:updated` emitted when the FBR queue processes (in `fbr.rs`). Also existing: `import:progress`, `import:complete`, `notification:updated`.
9. **Frontend `AppError` parsing (§18)** — DONE. `src/api/backend.ts` exports `isAppError()` type guard, `getErrorMessage()` with user-friendly messages per code, and `AppError` TypeScript type matching the Rust schema.

### 5.3c ✅ DONE: FBR UX redesign

10. **`FbrSettingsTab` redesigned** — from raw token textbox to status-first UX: connection status card (green/gray), "Manage Connection" button opens 3-step wizard (Business Info → FBR Connection → Verify), business info step reuses existing company profile (NTN, STRN, province), automatic submission toggle (disabled when not connected), production environment warning alert, test result card with human-readable output.

### 5.4 🟢 Low / hygiene

9. Commented-out legacy code in `src-tauri/src/lib.rs`; trim unused deps (`tauri-plugin-sql` unregistered, sqlx `postgres` + `tls-rustls` features, `dotenv`).
10. `withGlobalTauri: true` in `tauri.conf.json` exposes `window.__TAURI__` — tighten for release.
11. No ESLint/Prettier/clippy enforcement (clippy still emits pre-existing warnings, e.g. `manual_is_multiple_of`, `too_many_arguments`), no `cargo audit` in CI.
12. A repo-wide `cargo fmt` pass was applied on 2026-08-06 — content is intact but the diff was noisy; a formatting/CI hygiene commit should land before the next release.

---

## 6. Build & Release Readiness

| Step                             | Result                                                                                                       |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `tsc --noEmit` / `npm run build` | ✅ Clean                                                                                                     |
| `cargo check --all-targets`      | 🟡 Compiles; pre-existing clippy warnings (not errors)                                                       |
| `cargo test --lib`               | ✅ **499 passed, 0 failed** (200s)                                                                             |
| `cargo build --release`          | ✅ Clean                                                                                                     |
| `npm run tauri build`            | ✅ NSIS installer + updater artifacts produced                                                               |
| Updater pipeline                 | ✅ `release.yml` (windows-latest) → NSIS + `.sig` + `latest.json` (uploads.github.com endpoint fix in place) |
| Version bump                     | ✅ `1.0.8` in `Cargo.toml`, `package.json`                                                                   |

**Release procedure** (per `Notes.txt`): bump semver in all 5 places → commit + tag + push → `npm run tauri build` with signing key → update `latest.json` with new `.sig` → create GitHub Release for the tag with installer + `.sig` + `latest.json`.

**Runtime notes:** DB at `dirs::data_dir()/ijazandcompany-erp/ijazandcompany.db`; migrations bundled as resources (now 19); backup/restore act on the pool's actual DB file.

---

## 7. Compliance Status

| Requirement                                   | Spec ref | Status                                                                                   |
| --------------------------------------------- | -------- | ---------------------------------------------------------------------------------------- |
| PECA 2016 — access logging                    | §16.2    | 🟢 **Implemented** — `audit_logs` (migration 008) + `log_audit()` write-through + viewer |
| PECA 2016 — rate limiting / failed-login logs | §16.2    | 🟢 **Implemented** — `LoginAttemptTracker` (5/60s lockout)                               |
| ETO 2002 — 5-year immutable record retention  | §16.2    | 🟢 **Implemented** — `retention.rs` summary + owner-only archival (soft-delete)          |
| FBR digital invoicing                         | §17      | 🟢 **Implemented** — outbox queue, payload builder, IRN lifecycle, credit/debit notes, FBR QR, exponential backoff |
| PDPB / GDPR                                   | §16.3    | 🔴 Not addressed                                                                         |

---

## 8. Project Maturity Level

| Level                                         | Verdict                                                                                                                                               |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Technical prototype                           | ✅ Passed                                                                                                                                             |
| v0.1 Desktop MVP                              | ✅ Passed (2026-08-01)                                                                                                                                |
| v1.0 Production desktop app                   | ✅ Reached (2026-08-05)                                                                                                                               |
| **v1.0.5 desktop (invoice design, import v2)**| ✅ **Reached (2026-08-10)** — designable invoices (PDF/Excel/QR), 4-target import with jobs + 24 h rollback + UI, dark mode, journal/PO fixes (427 tests) |
| **v1.0.7 desktop (multi-currency)**            | ✅ **Reached (2026-08-19)** — multi-currency support (50+ currencies, live exchange rates, invoice-level foreign currency, FX gain/loss accounting, dynamic formatting), cargo audit fix, 491 tests |
| **v1.0.8 desktop (FBR digital invoicing)**     | ✅ **Reached (2026-08-20)** — FBR/PRAL integration (outbox queue, exponential backoff, IRN, credit/debit notes, FBR-compliant QR), migration 019, 9 FBR commands, dedicated settings tab, unified AppError schema (8 error codes), tracing observability, desktop SSE events, frontend error parsing, 499 tests |
| SaaS / Multi-tenant platform (spec end-state) | 🔴 Future — §5–§9, §24 not started (FTS5/ledger/roles/invoice-design/import/FBR shipped as desktop adaptations) |

---

## 9. Next Steps — Recommended Roadmap

**Finish the desktop UX before any SaaS work.** The full §23 import system (6 targets, preview→confirm, conflicts, quotas, adapters, templates, push progress, bundled OCR), units management, **multi-currency support**, and **FBR/PRAL digital invoicing** are now **shipped**. The highest-leverage remaining items are automated tests for the last untested modules and the branded webview print flow.

### Step 1 — Import system: remainder & hardening

1. ✅ **OCR availability** — done: Tesseract is bundled with the NSIS installer via `scripts/fetch-tesseract.mjs`.
2. ✅ **Polling → SSE-style progress** — done: the worker emits `import:progress` / `import:complete`; the wizard listens (5 s `get_import_job` re-sync fallback).

### Step 1b — Multi-currency support

3. ✅ **Multi-currency (FUTURE_FEATURES.md §2)** — done: migration 018, `currency.rs` module, invoice-level currency, live exchange rates, FX gain/loss accounting, dynamic formatting across all pages.

### Step 1c — FBR/PRAL Digital Invoicing

4. ✅ **FBR integration (§17)** — done: migration 019, `fbr.rs` module (~1300 lines), 9 commands, outbox queue, exponential backoff, IRN, credit/debit notes, FBR-compliant QR, dedicated settings tab, frontend status display.

### Step 2 — Desktop polish & hardening

5. Add automated tests for `notifications`, `retention`, `search`, `theme`, and `fbr` modules.
6. Finish the branded webview print/PDF flow for invoices.
7. Strip legacy `lib.rs` comments, trim unused deps, remove `BackendTester` remnants.
8. Land a formatting/CI hygiene commit (clean clippy, Prettier/ESLint, `cargo audit`), tighten `withGlobalTauri`.

### Step 3 — Decision point: SaaS (only after desktop is proven)

9. Spec's `saas`/`desktop` split (§21.2), PostgreSQL mode, `super_admin`, packages/subscriptions, module enforcement, RLS, permission cache (§5–§9).
10. PDPB/GDPR (§16.3).

### Deferred (per spec)

- Intelligence layer (AI) — after 20–30 tenants × 12+ months of data (§24/§25).

---

## 10. Test Suite Summary

**499 tests** across 17 modules, all against real migrated SQLite DBs via `test_helpers.rs` (`setup_app` = mock Tauri app + temp-file pool + session + rate-limit tracker). Full catalog in `TEST_CASES.md`.

| Module          | Tests | Coverage highlights                                                                   |
| --------------- | ----- | ------------------------------------------------------------------------------------- |
| auth            | 43    | login incl. rate limiting, sessions, password rules, persistence                       |
| company         | 31    | single-tenant gate, currency/email validation, owner/admin/employee                    |
| users           | 38    | role CRUD, owner/admin/employee permission paths                                       |
| inventory       | 82    | products, stock adjust, FIFO, expiry batches, soft-delete/versioning                   |
| invoices        | 65    | totals/discount/tax math, finalize stock deduction, payments, numbering, **design placeholders, XLSX template fill/analyze/save, sample download, QR SVG, PDF export** |
| purchase_orders | 35    | draft→submit→receive→pay, atomic numbering, expiry batches, receive/payment hardening  |
| permissions     | 18    | role-permission matrix, soft_delete, version conflict helpers                          |
| audit           | 11    | log write-through, pagination, scoping                                                |
| reports         | 23    | sales/stock/P&L/ledger/movements incl. empty-company                                   |
| export          | 12    | CSV escaping, headers/rows, permission + write-error paths                             |
| import_wizard   | **51**| header mapping per target (6 targets), docx/CSV/PDF/text parsing, adapters + template save/auto-map/use_count, quotas, execute_import e2e (products relations+batches, customers FBR/dedup, suppliers, opening-stock qty+batch, sales-invoice + purchase-bill ledger posting), **import_jobs write, list_import_jobs, rollback deletes + 24 h window + quantity + ledger revert** |
| backup          | 13    | backup/restore/list + safety copy, non-SQLite rejection                               |
| ledger          | 6     | chart of accounts seed, journal posting, balance integrity                             |
| roles           | 5     | custom role CRUD, permission updates, built-in role protection                         |
| units           | **4** | unit CRUD, default-unit constraint, audit logging, deletion protection                 |
| error           | **7** | AppError tagged enum serialization, error code mapping, From<String>, From<sqlx::Error>, JSON IPC output |
| notifications   | **6** | low-stock and out-of-stock product alerts, 30-day expiry threshold filtering, handle emission safety, auth protection |
| retention       | **6** | format_timestamp epoch/recent date parsing, 5-year retention window calculation, non-owner authorization checks, empty-data archival safety |
| search          | **6** | FTS5 customer/product indexing, SKU matching, single-character threshold, multi-entity unified results, empty query handling |
| theme           | **7** | company theme persistence, default theme generation, base64 logo reading, platform watermark enforcement, employee edit rejection |
| fbr             | **15**| PRAL config CRUD & role permissions, FBR QR format ({IRN}|{Date}|{STRN}|{Total}), queue outbox enqueuing on invoice finalize, retry state machine (failed -> queued), status tracking, credit/debit note generation (180-day window, paisa totals, negative items), backoff failure handling |

Production bugs surfaced and fixed by the suite: 3 SQL literal-misplacements in PO stock inserts, `next_po_number` race, `finalize_invoice` missing `balance_due`, import "Tax Rate"→`sell_price` mapping, backup hardcoding the production DB path, `detect_customer_field` mis-mapping `"Buyer Type"` → `customer_name`, FTS5 external content deletion trigger syntax corruption, and (v1.0.4) journal-posting and PO receive/payment regressions. See `TEST_CASES.md` header.


---

## 11. Addendum: v1.3.0 Full-Stack Parity & Field Synchronization (2026-10-01)

Following the initial v1.0.8 desktop stabilization and v1.2.0 invoice reversal overhaul, milestone v1.3.0 executed an end-to-end full-stack field audit across all database entities, IPC commands, and frontend forms:
- **Company Profile FBR Synchronization**: Persisted `ntn`, `strn`, `province`, and `fbr_registered` through the `update_company` command and reactive Mantine forms.
- **SQLite FTS5 External Content Triggers**: Corrected delete triggers to use canonical `INSERT INTO ... VALUES('delete', ...)` syntax, resolving malformed disk image panics (code 267).
- **Payment Deduplication Key Transport**: Preserved client-generated `idempotency_key` nonces through the IPC parameter boundary into SQLite.
- **Walk-in Khata Isolation**: Prevented cash walk-in sales (customer ID: 0) from inflating Accounts Receivable ledgers.
- **Module Key Normalization**: Aligned module registration identifiers (`data_import`, `inventory`, `invoices`, etc.) across DB seeds, backend validation arrays, and UI navigation dictionaries.
- **Verification Baseline**: 494/494 Rust tests green (`cargo test --lib`), clean TypeScript/Vite bundle, zero unhandled errors.

---

_Report refreshed 2026-10-01 against the live tree (v1.3.0 Full-Stack Entity & Query Parity)._

