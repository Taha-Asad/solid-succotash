# Ijaz & Company ERP

A single-tenant desktop ERP for Ijaz & Company — built with **Tauri 2**, **React 19**, **Mantine 9**, and **TypeScript** on the frontend and **Rust (sqlx 0.9 + SQLite)** on the backend.

This is a working **v1.0.5 desktop** application — the local, single-company mode of a planned multi-tenant SaaS platform (see `SAAS_SPECIFICATION.md` v5.1). It ships inventory, invoicing (with a designable invoice system), purchase orders, a double-entry accounting ledger, user management, and a 4-target import wizard with job history and 24-hour rollback.

---

## Features

- **Authentication & roles** — bcrypt-hashed passwords, persistent login session, login rate limiting, roles: `owner` / `admin` / `employee` (DB-trigger enforced) plus **custom roles with a permission matrix**.
- **Company setup** — one-time single-tenant registration; only one company per installation.
- **Inventory** — categories, suppliers, products (paisa-based prices, tax, stock, units), stock movements, expiry batch tracking, and company-specific custom fields (JSON-driven, schema never changes per company).
- **Invoicing** — customers (with FBR fields: CNIC / NTN / STRN / buyer type), draft → finalize → paid lifecycle, transactional stock deduction on finalize, payments, invoice numbering/settings, and automatic posting to the accounting ledger.
- **Invoice design system** — built-in designs (`classic` / `modern` / `minimal` / `excel`), accent color, show/hide FBR QR block, footer fields (disclaimer / copyright / bank details), **user-uploaded `.xlsx` invoice template** with placeholder tokens, native **PDF export**, and **Excel invoice export**.
- **Purchase orders** — create → submit → receive (stock-in + expiry batch creation) → record payments, atomic PO numbering.
- **Accounting ledger** — seeded chart of accounts, double-entry journal posting (automatic from invoices/payments, plus manual entries), account statements, P&L.
- **Import wizard** — analyze and import historical data from **CSV / Excel (XLS/XLSX) / DOCX** for **Products / Customers / Suppliers / Opening Stock** with automatic column mapping, per-row error reporting, job history, and a **24-hour rollback** window.
- **Search** — FTS5 full-text search across products, customers, and invoices.
- **Reports & export** — sales/stock/P&L/customer-ledger/product-movement reports with charts, CSV exports, and PDF report export.
- **Compliance tooling** — audit logging (PECA 2016), failed-login tracking, ETO 5-year retention summary + owner-only archival.
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
| Parsing   | calamine (Excel), quick-xml (DOCX), csv |
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

# run the Rust test suite (427 integration tests)
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
  theme/AppThemeProvider.tsx  # light / dark / auto theming
  components/             # AppShell, AppDateInput, NotificationBell, SearchBar, ...
  features/auth/          # SetupPage, LoginPage
  features/dashboard/     # DashboardPage, UserManagement
  features/inventory/     # InventoryPage + ImportWizard (4 targets + rollback)
  features/invoices/      # InvoicePage (list/create/finalize/payments/print/PDF/Excel)
  features/purchase-orders/  # PurchaseOrderPage
  features/accounts/      # AccountsPage (chart of accounts, journal)
  features/reports/       # ReportsPage
  features/settings/      # SettingsPage (company, theme, invoice design, backup)
  App.tsx                 # routing + auth guard
src-tauri/                # Rust backend
  migrations/sqlite/      # 001..016 schema migrations
  src/main.rs, lib.rs     # app bootstrap, DB init, invoke_handler
  src/commands/           # auth, company, users, inventory, invoices, purchase_orders,
                          # ledger, import_wizard, reports, export, roles, permissions,
                          # audit, notifications, retention, search, theme, backup, updater
  src/db/                 # sqlite_migrate (migration runner + DB path)
  src/pdf.rs              # hand-rolled PDF generation (reports + invoices)
  tauri.conf.json         # app config, bundling, icons
capabilities/default.json # Tauri permissions
SAAS_SPECIFICATION.md     # product spec (v5.1) — SaaS target; see PROJECT_ANALYSIS.md
PROJECT_ANALYSIS.md       # gap analysis vs. the spec, status, roadmap
```

## Current Status & Known Limitations

See `PROJECT_ANALYSIS.md` for the full audit. Short version:

- **Working:** auth + roles, company setup, inventory + expiry, invoicing (draft/finalize/payments), invoice design (PDF/Excel/QR/templates), purchase orders, accounting ledger, reports + CSV/PDF export, FTS5 search, notifications, retention archival, backup/restore, auto-update, 4-target import wizard with jobs + 24-hour rollback, dark mode, NSIS installer.
- **Known gaps:** import is still synchronous (no background progress / preview→confirm gate / conflict strategy, and no sales-invoice or purchase-bill import targets); units of measurement table exists but isn't wired to the UI; `notifications`/`retention`/`search`/`theme` lack automated tests; MSI bundler fails because of the `&` in the product name (`Ijaz & Company ERP`) — use `--bundles nsis` or rename the product to produce an MSI.
- **Not built (by design for the desktop phase):** the entire SaaS layer — PostgreSQL/multi-tenancy, super admin, packages/subscriptions, FBR/PRAL live filing, SSE, observability, AI analytics.

The database file lives in the user's data directory (`dirs::data_dir()/ijazandcompany-erp/ijazandcompany.db`).
