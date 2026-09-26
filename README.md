# Corbel ERP

A single-tenant desktop ERP & Point of Sale for modern wholesale, retail, and distribution businesses — built with **Tauri 2**, **React 19**, **Mantine 9**, and **TypeScript** on the frontend and **Rust (sqlx 0.9 + SQLite)** on the backend.

This is a working **v1.1.0 desktop** application — shipping inventory, invoicing, POS hardware support (barcode scanning & thermal printing), FBR/PRAL digital invoicing, purchase orders, double-entry accounting ledger, user management, and a 6-target import wizard with background jobs, live progress, conflict strategies, and 24-hour rollback.

---

## Features

- **Point of Sale (POS) & Counter Workflows** — Hardware Barcode Scanner integration (`F2` hotkey) with synthesized zero-latency audio feedback, continuous **80mm & 58mm Thermal Receipt** printing with zero margins, instant cashier change calculator, and 1-click WhatsApp bill dispatch with customer credit/khata alerts.
- **Authentication & roles** — bcrypt-hashed passwords, persistent login session, login rate limiting, roles: `owner` / `admin` / `employee` (DB-trigger enforced) plus **custom roles with a permission matrix**.
- **Role-Aware Settings** — 3-tier settings divided into Personal Workspace (all users), Counter & POS Operations (Cashiers & Admins), and Business Governance & Compliance (Admins & Owners).
- **Personalized Appearance** — Per-user accent colors and color schemes (`corbel_accent_${userId}`) decoupled from company invoice stationery branding.
- **Module system** — 8 modules seeded per company (`inventory`, `invoices`, `purchase_orders`, `reports`, `ledger`, `users`, `settings`, `import`); owner toggles on/off in Settings → Modules; sidebar hides disabled modules.
- **Forced first-login password change** — all new users must change their temporary password on first login; dedicated change-password screen blocks navigation until completed.
- **Dedicated Workflows** — Full-page customer registration, dedicated inline category and supplier managers replacing cramped popup modals.
- **Inventory** — categories, suppliers, products (paisa-based prices, tax, stock, units), stock movements, expiry batch tracking, and company-specific custom fields (JSON-driven, schema never changes per company).
- **Invoicing** — customers (with FBR fields: CNIC / NTN / STRN / buyer type), draft → finalize → paid lifecycle, transactional stock deduction on finalize, payments, invoice numbering/settings, and automatic posting to the accounting ledger.
- **FBR/PRAL Digital Invoicing** — outbox-pattern submission queue, FBR API payload builder, sandbox/production endpoints, exponential backoff retry (0→2m→10m→30m→2h, dead letter after 5 attempts), IRN lifecycle, credit/debit notes referencing original IRN, FBR-compliant QR codes, dedicated settings tab with test connection and queue status.
- **Multi-currency** — invoices in 50+ supported currencies with live exchange rates (exchangerate-api.com), invoice-level foreign currency, FX gain/loss accounting in the ledger, and dynamic currency formatting across all pages.
- **Invoice design system** — built-in designs (`wholesale_a4`, `thermal_80mm`, `thermal_58mm`, `compact_a5`), accent color, show/hide FBR QR block, footer fields (disclaimer / copyright / bank details), **user-uploaded `.xlsx` invoice template** with placeholder tokens, native **PDF export**, and **Excel invoice export**.
- **Purchase orders** — create → submit → receive (stock-in + expiry batch creation) → record payments, atomic PO numbering.
- **Accounting ledger** — seeded chart of accounts, double-entry journal posting (automatic from invoices/payments, plus manual entries), account statements, P&L.
- **Import wizard** — analyze and import historical data from **CSV / Excel (XLS/XLSX) / DOCX / PDF / images (OCR)** for **Products / Customers / Suppliers / Opening Stock / Sales Invoices / Purchase Bills** with automatic column mapping, conflict strategies (skip / overwrite / suffix), per-row error reporting, background jobs with live progress, per-target reusable templates with auto-map, ERP adapters (QuickBooks / Odoo / ERPNext / Tally), and a **24-hour rollback** window.
- **Search** — FTS5 full-text search across products, customers, and invoices.
- **Reports & export** — sales/stock/P&L/customer-ledger/product-movement reports with charts, CSV exports, and PDF report export.
- **Compliance tooling** — audit logging (PECA 2016), failed-login tracking, ETO 5-year retention summary + owner-only archival.
- **Observability & error handling** — unified `AppError` type (8 error codes: VALIDATION, NOT_FOUND, UNAUTHORIZED, FORBIDDEN, CONFLICT, RATE_LIMITED, DATABASE, INTERNAL) with structured message and details, serializes to JSON for Tauri IPC; `tracing` + `tracing-subscriber` with env-filter and JSON output; desktop SSE events (`fbr:queue:updated`, `import:progress`, `import:complete`, `notification:updated`); frontend `AppError` parsing with `isAppError()` type guard and user-friendly error messages per code.
- **Dashboard** — company overview, stat cards, low-stock alerts, recent movements, notification feed.
- **Theme & branding** — light / dark / auto mode, custom logo, accent color.
- **Backup & restore**, **auto-update** (GitHub Actions + minisign + `latest.json`).
- **Packaging** — NSIS installer (Windows x64).

## Tech Stack

| Layer     | Technology |
| --------- | ---------- |
| Desktop shell | Tauri 2 (`@tauri-apps/api` 2.11) |
| Frontend  | React 19, Mantine 9, Vite 7, TypeScript |
| Backend   | Rust (edition 2021), tokio |
| Database  | SQLite via sqlx 0.9 (migrations in `src-tauri/migrations/sqlite/`) |
| Parsing   | calamine (Excel), quick-xml (DOCX), csv, pdf-extract, image + tesseract (OCR) |
| HTTP      | reqwest (exchange rate API) |
| QR / PDF  | qrcode (SVG), hand-rolled `pdf.rs` |
| Icons     | Python/Pillow script `create-icons.py` |

## Getting Started

Prerequisites: Node.js 18+, Rust (stable), and the [Tauri system prerequisites](https://v2.tauri.app/start/prerequisites/) (WebView2, MSVC build tools, NSIS tooling).

```bash
# install frontend dependencies
npm install

# run the desktop app in dev mode (Vite on port 1420)
npm run tauri dev

# typecheck + build the frontend
npm run build

# check the Rust backend
cargo check --manifest-path src-tauri/Cargo.toml --all-targets

# run the Rust test suite (499 integration tests)
cargo test --manifest-path src-tauri/Cargo.toml --lib

# production build (NSIS installer)
npm run tauri build -- --bundles nsis
```

### Regenerating icons

```bash
python create-icons.py
```

### Regenerating the sample invoice template

```bash
python scripts/make_sample_invoice_template.py
```

## Project Structure

```
src/                      # React frontend
  api/backend.ts          # Tauri invoke() wrapper (Rust command bridge)
  types/backend.ts        # shared types
  utils/currency.ts       # currency formatting/parsing helpers
  theme/AppThemeProvider.tsx  # light / dark / auto theming
  components/             # AppShell, AppDateInput, NotificationBell, SearchBar, ...
  features/auth/          # SetupPage, LoginPage, ChangePasswordPage
  features/dashboard/     # DashboardPage, UserManagement
  features/inventory/     # InventoryPage + ImportWizard (6 targets + background jobs + rollback)
  features/invoices/      # InvoicePage (list/create/finalize/payments/print/PDF/Excel)
  features/purchase-orders/  # PurchaseOrderPage
  features/accounts/      # AccountsPage (chart of accounts, journal)
  features/reports/       # ReportsPage
  features/settings/      # SettingsPage (company, FBR integration, modules, theme, invoice design, backup)
  App.tsx                 # routing + auth guard
src-tauri/                # Rust backend
  migrations/sqlite/      # 001..019 schema migrations
  src/main.rs, lib.rs     # app bootstrap, DB init, invoke_handler
  src/commands/           # auth, company, users, inventory, invoices, purchase_orders,
                          # ledger, import_wizard, reports, export, roles, permissions,
                          # audit, notifications, retention, search, theme, backup, updater,
                          # currency, fbr
  src/db/                 # sqlite_migrate (migration runner + DB path)
  src/pdf.rs              # hand-rolled PDF generation (reports + invoices)
  tauri.conf.json         # app config, bundling, icons
capabilities/default.json # Tauri permissions
SAAS_SPECIFICATION.md     # product spec (v5.1) — SaaS target; see PROJECT_ANALYSIS.md
PROJECT_ANALYSIS.md       # gap analysis vs. the spec, status, roadmap
```

## Current Status & Known Limitations

See `PROJECT_ANALYSIS.md` for the full audit. Short version:

- **Working:** auth + roles, company setup, inventory + expiry, invoicing (draft/finalize/payments), FBR/PRAL digital invoicing (outbox queue, IRN, credit/debit notes, FBR QR), multi-currency with live exchange rates and FX gain/loss, invoice design (PDF/Excel/QR/templates), purchase orders, accounting ledger, reports + CSV/PDF export, FTS5 search, notifications, retention archival, backup/restore, auto-update, 6-target import wizard with background jobs + live progress + conflict strategies + 24-hour rollback, dark mode, NSIS installer, unified error handling (AppError with 8 codes), tracing observability, desktop SSE events, frontend error parsing.
- **Known gaps:** `notifications`/`retention`/`search`/`theme`/`fbr` lack automated tests; NSIS is the primary Windows installer target.
- **Not built (by design for the desktop phase):** the entire SaaS layer — PostgreSQL/multi-tenancy, super admin, packages/subscriptions, AI analytics.

The database file lives in the user's data directory (`dirs::data_dir()/corbel-erp/corbel.db`).
