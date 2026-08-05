# Ijaz & Company ERP

A single-tenant desktop ERP for Ijaz & Company — built with **Tauri 2**, **React 19**, **Mantine 9**, and **TypeScript** on the frontend and **Rust (sqlx 0.9 + SQLite)** on the backend.

This is a working **v0.1 desktop MVP** of a planned multi-tenant SaaS platform (see `SAAS_SPECIFICATION.md` v5.1). It currently runs as a local, single-company application with inventory, invoicing, user management, and a historical-data import wizard.

---

## Features

- **Authentication & roles** — bcrypt-hashed passwords, persistent login session, roles: `owner` / `admin` / `employee` (DB-trigger enforced).
- **Company setup** — one-time single-tenant registration; only one company per installation.
- **Inventory** — categories, suppliers, products (paisa-based prices, tax, stock, units), stock movements, and company-specific custom fields (JSON-driven, schema never changes per company).
- **Invoicing** — customers (with FBR fields: CNIC / NTN / STRN / buyer type), draft → finalize → paid lifecycle, transactional stock deduction on finalize, payments, invoice numbering/settings, and printable HTML invoices.
- **Import wizard** — analyze and import historical data from **CSV / Excel (XLS/XLSX) / DOCX** with automatic column mapping and per-row error reporting.
- **Dashboard** — company overview, stat cards, low-stock alerts, recent movements, user management.
- **Packaging** — NSIS installer (Windows x64).

## Tech Stack

| Layer     | Technology |
| --------- | ---------- |
| Desktop shell | Tauri 2 (`@tauri-apps/api` 2.11) |
| Frontend  | React 19, Mantine 9, Vite 7, TypeScript |
| Backend   | Rust (edition 2021), tokio |
| Database  | SQLite via sqlx 0.9 (migrations in `src-tauri/migrations/sqlite/`) |
| Parsing   | calamine (Excel), quick-xml (DOCX), csv |
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

# production build (NSIS installer)
npm run tauri build -- --bundles nsis
```

### Regenerating icons

```bash
python create-icons.py
```

## Project Structure

```
src/                      # React frontend
  api/backend.ts          # Tauri invoke() wrapper (Rust command bridge)
  types/backend.ts        # shared types
  features/auth/          # SetupPage, LoginPage
  features/dashboard/     # DashboardPage
  features/inventory/     # InventoryPage + ImportWizard
  features/invoices/      # InvoicePage (list/create/finalize/payments)
  App.tsx                 # screen state machine (loading|setup|login|dashboard)
src-tauri/                # Rust backend
  migrations/sqlite/      # 001..005 schema migrations
  src/main.rs, lib.rs     # app bootstrap, DB init, invoke_handler
  src/commands/           # auth, company, users, inventory, invoices, import_wizard
  src/db/                 # sqlite_migrate (migration runner + DB path)
  tauri.conf.json         # app config, bundling, icons
capabilities/default.json # Tauri permissions
SAAS_SPECIFICATION.md     # product spec (v5.1) — SaaS target; see PROJECT_ANALYSIS.md
PROJECT_ANALYSIS.md       # gap analysis vs. the spec, status, roadmap
```

## Current Status & Known Limitations

See `PROJECT_ANALYSIS.md` for the full audit. Short version:

- **Working:** auth, company setup, inventory, invoicing (draft/finalize/payments/HTML), import wizard, NSIS installer.
- **Known gaps:** printable invoice is HTML-only (PDF print flow unfinished), no audit logging, no login rate limiting, no automated tests, MSI bundler fails because of the `&` in the product name (`Ijaz & Company ERP`) — use `--bundles nsis` or rename the product to produce an MSI.
- **Not built (by design for v0.1):** the entire SaaS layer — PostgreSQL/multi-tenancy, super admin, packages/subscriptions, FBR/PRAL integration, accounting ledger, audit logs, notifications, search, AI analytics.

The database file lives in the user's data directory (`dirs::data_dir()/ijazandcompany-erp/ijazandcompany.db`).
