# Multi-Tenant Hybrid SaaS & Desktop ERP — System Specification (v5.2)

> **CANONICAL SPECIFICATION — v5.2 (Reconciled Architecture)**
> This document supersedes [`SAAS_SPECIFICATION_DEPRECATED.md`](file:///run/media/thefoolishcrow/New%20Volume/Obsidian/TheFallenCrow/ijazandcompany/SAAS_SPECIFICATION_DEPRECATED.md) (v5.1).
> It serves as the single source of truth for **Corbel ERP (The Foolish Crow Studio)** across backend implementation, database schema, licensing, and UI/UX designer handoff.
>
> **Last Reconciled:** 2026-10-17
> **Author & Sovereign Architect:** Taha Asadullah (`@thefoolishcrow`)

> **Revision Notes (v5.2 — Reconciled Production Architecture):**
> 1. **Hybrid Offline-First SQLite + Neon Cloud Control Plane (§1 & §21)**: Replaced the v5.1 compile-time mode exclusion with a unified hybrid model. Every desktop `.exe` runs zero-latency local SQLite for daily ERP operations (offline-first) while bidirectionally syncing tenants, users, packages, subscriptions, hardware leases, and support tickets with Neon Cloud PostgreSQL when online.
> 2. **First-Run 14-Day Auto-Trial + Self-Setup Onboarding (§5.2 & §7.3)**: Any new `.exe` installation automatically receives a 14-day hardware-bound trial (`CRBL-TR14-XXXX-XXXX`) and opens `SetupPage` (with a 1-click toggle to `LoginPage` for existing cloud accounts) plus direct founder/support contact channels for Taha Asadullah. Completing `SetupPage` creates the company, owner, and a 14-day `trial` subscription on `pkg-basic` (3,400 PKR) and syncs immediately to Neon Cloud.
> 3. **Dual-Layer Entitlement Governance (§9)**: Combines **Company Subscription Enforcement** (`trial` -> `active` -> 7-day `past_due` grace -> `suspended`) with **Background Hardware HWID Fleet Tracking** (`_license_lease` + `tenant_licenses` + `device_activations`) so Super Admin can monitor, extend (`+14d`/`+30d`), or block specific PCs.
> 4. **Canonical Commercial Package Catalog (§3.1 & §14.1.6)**: Standardized across SQLite and Neon Cloud to three PKR tiers:
>    - `pkg-basic` (**Basic** — **3,400 PKR/mo**, 5 users, 1 branch, 512 MB storage)
>    - `pkg-standard` (**Standard** — **4,200 PKR/mo**, 15 users, 3 branches, 2,048 MB storage, includes `import`, `data_import`, `branches`)
>    - `pkg-premium` (**Premium** — **6,000 PKR/mo**, 100 users, 10 branches, 10,240 MB storage, includes `fbr` fiscalization, `import`, `data_import`, full multi-branch & priority support)
> 5. **Unified 2-Gate Module & Business Mode Model (§4)**: Gate 1 = Commercial Package + `company_modules`; Gate 2 = Operational `business_mode` (`retail`, `wholesale`, `distribution`) + employee `custom_roles` RBAC.
> 6. **Day-15 Read-Only + Support Access on Expiry (§9.2)**: When a 14-day trial or subscription expires (and the PC is not explicitly kill-switched by Super Admin), the tenant enters **Read-Only Mode**: they can log in, view existing invoices/reports, inspect their subscription, and contact Taha Asadullah or submit a **Support Ticket** (`/company/tickets`), while all mutating ERP commands (`create_invoice`, `create_product`, `create_purchase_order`, etc.) are blocked by `require_active_subscription`.
> 7. **Support Tickets & Threaded Messaging (§3.4, §5.1, §6.1)**: Restored full bidirectional support ticketing (`tickets` + `ticket_messages`) between Company Admins and Super Admin.

---

## Table of Contents

1. [Overview & Hybrid Architecture](#1-overview--hybrid-architecture)
2. [Roles & Hierarchy](#2-roles--hierarchy)
3. [Database Tables & Canonical Schemas](#3-database-tables--canonical-schemas)
4. [Unified 2-Gate Module & Business Mode System](#4-unified-2-gate-module--business-mode-system)
5. [Super Admin Control Plane](#5-super-admin-control-plane)
6. [Company Admin & Tenant Workspace](#6-company-admin--tenant-workspace)
7. [Authentication, Onboarding & First-Run Flow](#7-authentication-onboarding--first-run-flow)
8. [Security Architecture](#8-security-architecture)
9. [Dual-Layer Subscription & Hardware Fleet Enforcement](#9-dual-layer-subscription--hardware-fleet-enforcement)
10. [Invoice Template System](#10-invoice-template-system)
11. [Analytics & Reporting](#11-analytics--reporting)
12. [Frontend Architecture](#12-frontend-architecture)
13. [Tauri IPC Commands & API Contract](#13-tauri-ipc-commands--api-contract)
14. [Implementation Phases](#14-implementation-phases)
15. [Resolved Architecture Decisions](#15-resolved-architecture-decisions)
16. [Legal & Compliance (Pakistan PECA, ETO, FBR, PDPB)](#16-legal--compliance-pakistan-peca-eto-fbr-pdpb)
17. [FBR Digital Invoicing / PRAL Integration](#17-fbr-digital-invoicing--pral-integration)
18. [Technical Gap Register & Observability](#18-technical-gap-register--observability)
19. [Financial Consistency & Double-Entry Accounting Ledger](#19-financial-consistency--double-entry-accounting-ledger)
20. [Historical Invoice & Bill Import System](#20-historical-invoice--bill-import-system)
21. [Database Synchronization Boundary (SQLite <-> Neon PostgreSQL)](#21-database-synchronization-boundary-sqlite---neon-postgresql)
22. [Search Architecture (SQLite FTS5 & PostgreSQL FTS)](#22-search-architecture-sqlite-fts5--postgresql-fts)
23. [Future Enhancements (AI Intelligence Layer)](#23-future-enhancements-ai-intelligence-layer)

---

## 1. Overview & Hybrid Architecture

Corbel ERP is a **Multi-Tenant Hybrid SaaS & Desktop ERP** built with **Rust (Tauri v2)**, **SQLite (Offline-First Local Engine)**, **Neon Serverless PostgreSQL (Cloud Control Plane)**, and **React 19 + TypeScript + Mantine v8**.

| Layer | Database | Responsibility | Synchronization Rule |
| :--- | :--- | :--- | :--- |
| **Local Operational Store** | SQLite (`corbel.db`, WAL mode) | Zero-latency POS, Inventory, Invoices, Customers, Purchase Orders, Double-Entry Ledger, FTS5 Search, Local Backups | Always available offline; tenant-scoped via `WHERE company_id = ?` |
| **Cloud Control Plane** | Neon PostgreSQL | Cross-tenant Super Admin directory, Commercial Packages, Subscriptions, Module Overrides, Hardware HWID Fleet (`tenant_licenses` + `device_activations`), Support Tickets (`tickets` + `ticket_messages`), Multi-machine User Auth | Bidirectionally synced via idempotent `ON CONFLICT DO UPDATE` upserts (`src-tauri/src/db/neon.rs`) |

---

## 2. Roles & Hierarchy

### 2.1 Role Tree

```
Super Admin (cross-tenant, system-wide: is_super_admin = true, role = 'super_admin')
└── Company Owner / Admin (per-tenant: role = 'owner' | 'admin')
    ├── Inventory Manager (custom_roles or standard role)
    ├── Sales User / Cashier
    ├── Import / Procurement Clerk
    └── [Custom Roles created by Company Admin via migration 013_custom_roles.sql]
```

### 2.2 Super Admin (`CROSS-DIR` / Sovereign Operator)
- **Scope:** System-wide across all tenant companies in Neon Cloud + local cache.
- **Capabilities:**
  - Provision new sovereign tenants (`register_tenant`) or monitor self-registered 14-day trial tenants (`register_company`).
  - Assign & switch subscription packages (`3,400` / `4,200` / `6,000` PKR) and lifecycle statuses (`active`, `trial`, `past_due`, `suspended`, `cancelled`).
  - Monitor hardware device fleet (`device_hwid`, `device_name`, `os_info`), extend trials (`+14 Days`, `+30 Days`), or trigger remote device kill-switches (`Block` / `Unblock`).
  - Enable/disable modules (`company_modules`) and feature flags (`tenant_feature_flags`) per tenant.
  - View and respond to tenant **Support Tickets** (`/admin/tickets`).
  - View platform MRR, tenant growth, and audit logs.

### 2.3 Company Owner / Admin
- **Scope:** Strictly isolated to their own `company_id`.
- **Capabilities:**
  - Complete first-run company registration (`SetupPage`) with automatic 14-day trial.
  - Switch operational `business_mode` (`retail`, `wholesale`, `distribution`) and toggle modules allowed within their subscribed package.
  - Manage employees (`users`) and custom role permission matrices (`custom_roles` + `role_permissions`).
  - Configure FBR/PRAL credentials, custom invoice templates, multi-currency rates, and historical data imports.
  - View subscription status, contact Taha Asadullah directly, and submit/reply to **Support Tickets** (`/company/tickets`).

---

## 3. Database Tables & Canonical Schemas

### 3.1 `packages` (Canonical 3,400 / 4,200 / 6,000 PKR Commercial Catalog)

Both SQLite (`packages`) and Neon PostgreSQL (`packages`) enforce the exact same 3 default commercial tiers using `ON CONFLICT (id) DO UPDATE` (never `INSERT OR REPLACE`, which violates foreign keys on `company_subscriptions`):

| Package ID | Name | Monthly Price (PKR) | Max Users | Max Branches | Max Storage (MB) | Enabled Module Limits (`module_limits`) | Features (`features`) |
| :--- | :--- | :---: | :---: | :---: | :---: | :--- | :--- |
| `pkg-basic` | **Basic** | **3,400** | 5 | 1 | 512 | `{"dashboard":1,"inventory":1,"sales":1,"invoices":1,"customers":1,"purchases":1,"purchase_orders":1,"pos":1,"ledger":1,"reports":1,"employees":1,"users":1,"settings":1,"branches":0,"import":0,"data_import":0,"fbr":0}` | `{"pos":true,"ledger":true,"fbr":false,"data_import":false,"import":false}` |
| `pkg-standard` | **Standard** | **4,200** | 15 | 3 | 2,048 | `{"dashboard":1,"inventory":1,"sales":1,"invoices":1,"customers":1,"purchases":1,"purchase_orders":1,"pos":1,"ledger":1,"reports":1,"employees":1,"users":1,"settings":1,"branches":1,"import":1,"data_import":1,"fbr":0}` | `{"pos":true,"ledger":true,"fbr":false,"data_import":true,"import":true,"branches":true}` |
| `pkg-premium` | **Premium** | **6,000** | 100 | 10 | 10,240 | `{"dashboard":1,"inventory":1,"sales":1,"invoices":1,"customers":1,"purchases":1,"purchase_orders":1,"pos":1,"ledger":1,"reports":1,"employees":1,"users":1,"settings":1,"branches":1,"import":1,"data_import":1,"fbr":1}` | `{"pos":true,"ledger":true,"fbr":true,"data_import":true,"import":true,"branches":true,"custom_roles":true,"audit_trail":true}` |

### 3.2 `company_subscriptions`

```sql
CREATE TABLE company_subscriptions (
    id                   TEXT PRIMARY KEY,
    company_id           TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    package_id           TEXT NOT NULL REFERENCES packages(id),
    status               TEXT NOT NULL DEFAULT 'trial'
                             CHECK (status IN ('active', 'trial', 'past_due', 'suspended', 'cancelled', 'ended')),
    trial_ends_at        TEXT,
    current_period_start TEXT NOT NULL,
    current_period_end   TEXT NOT NULL,
    canceled_at          TEXT,
    ended_at             TEXT,
    metadata             TEXT NOT NULL DEFAULT '{}',
    created_at           TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at           TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

### 3.3 `company_modules`

```sql
CREATE TABLE company_modules (
    id          TEXT PRIMARY KEY,
    company_id  TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    module_key  TEXT NOT NULL,
    is_enabled  BOOLEAN NOT NULL DEFAULT TRUE,
    settings    TEXT NOT NULL DEFAULT '{}',
    created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(company_id, module_key)
);
```

### 3.4 `tickets` & `ticket_messages` (Support & Upgrade Helpdesk)

```sql
CREATE TABLE tickets (
    id          TEXT PRIMARY KEY,
    company_id  TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    created_by  TEXT NOT NULL REFERENCES users(id),
    subject     TEXT NOT NULL,
    category    TEXT NOT NULL CHECK(category IN ('complaint','recommendation','issue','feature_request','billing','other')),
    priority    TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('low','normal','high','urgent')),
    status      TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','in_progress','resolved','closed')),
    assigned_to TEXT REFERENCES users(id),
    created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at TEXT
);

CREATE TABLE ticket_messages (
    id          TEXT PRIMARY KEY,
    ticket_id   TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    user_id     TEXT NOT NULL REFERENCES users(id),
    sender_name TEXT NOT NULL DEFAULT '',
    sender_role TEXT NOT NULL DEFAULT '',
    message     TEXT NOT NULL,
    attachments TEXT NOT NULL DEFAULT '[]',
    created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

### 3.5 Hardware Licensing Tables (`_license_lease`, `tenant_licenses`, `device_activations`)
- **Local SQLite (`_license_lease`)**: Stores single-row (`id = 1`) hardware-bound lease (`license_key`, `client_name`, `device_hwid`, `last_verified_at`, `grace_expires_at`, `license_expires_at`, `status`, `monotonic_counter`).
- **Neon Cloud (`tenant_licenses` & `device_activations`)**: Tracks every issued or auto-provisioned 14-day trial license (`CRBL-TR14-XXXX-XXXX`) and physical workstation (`device_hwid`, `device_name`, `os_info`, `app_version`, `is_blocked`, `block_reason`).

### 3.6 Core ERP, Accounting, FBR & Import Tables
- **Companies & Users (`001`, `002`, `017`)**: `companies` (`ntn`, `strn`, `fbr_registered`, `province`, `version`, `deleted_at`), `users` (`is_super_admin`, `must_change_password`, `token_version`, `deleted_at`).
- **Inventory & Batches (`003`, `006`, `014`, `021`)**: `categories`, `products` (`barcode`, `sku`, `hs_code`, `tax_rate`, `version`), `stock_movements`, `stock_batches`, `units`.
- **Invoices & Sequences (`004`, `015`, `020`)**: `customers`, `invoices` (`version`, `import_batch_id`), `invoice_items`, `invoice_payments`, `invoice_sequences`, `invoice_designs`.
- **Purchase Orders (`007`)**: `suppliers`, `purchase_orders` (`version`), `purchase_order_items`.
- **Double-Entry Accounting Ledger (`012`)**: `accounts`, `journal_entries`, `journal_lines` (enforcing `SUM(debit) = SUM(credit)`).
- **Custom Roles & Permissions (`013`)**: `custom_roles`, `role_permissions`.
- **Historical Data Import (`014`, `016`)**: `import_jobs`, `import_row_errors`, `company_import_templates`.
- **Multi-Currency (`018`)**: `currencies`, `exchange_rates`.
- **FBR Digital Invoicing (`019`)**: `fbr_credentials`, `fbr_submission_queue`.

---

## 4. Unified 2-Gate Module & Business Mode System

### 4.1 Gate 1: Commercial Package & Super Admin Module Entitlement
A module is eligible for a company if and only if:
1. It is a **Core Module** (`dashboard`, `inventory`, `invoices`, `customers`, `reports`, `settings`, `users`) **OR** permitted by the company's active package (`module_limits` / `features`).
2. Its row in `company_modules` has `is_enabled = true`.

### 4.2 Gate 2: Operational Business Mode & Employee RBAC
Within the modules unlocked by Gate 1, the company's selected **Business Mode** (`business_mode` in `theme_settings`: `retail`, `wholesale`, `distribution`) tailors the operational workflow:
- **`retail` Mode**: Prioritizes `pos` (Point of Sale barcode checkout, thermal receipts, shift cash drawer) + fast walk-in invoicing.
- **`wholesale` Mode**: Prioritizes credit terms, bulk tier pricing, `purchase_orders`, customer receivables, and `ledger`.
- **`distribution` Mode**: Prioritizes `purchase_orders`, `stock_batches` (batch/lot & expiry dates), multi-branch stock transfers, and route/delivery invoicing.
- **Employee RBAC (`custom_roles`)**: Non-owner employees only see modules where their assigned role grants `view = true`.

---

## 5. Super Admin Control Plane

### 5.1 Super Admin Views (`SuperAdminShell`)
1. **Overview (`overview`)**: Platform KPIs (MRR, Active Tenants, Active Users, Trial Conversion) + recent tenant activity.
2. **Tenants (`tenants`)**: Full tenant directory, `RegisterTenantDrawer` (Provision Sovereign Tenant), `TenantDetailDrawer` (toggle `company_modules`, `tenant_feature_flags`, reset admin password, change subscription plan), `EditTenantModal`.
3. **Fleet Licensing (`licensing`)**: Hardware device fleet (`device_activations` & `tenant_licenses`), remote `Block` / `Unblock` kill-switch, `+14 Days` / `+30 Days` trial extension, manual key generator.
4. **Commercial Packages (`packages`)**: Manage `Basic (3,400 PKR)`, `Standard (4,200 PKR)`, `Premium (6,000 PKR)`, and custom enterprise tiers.
5. **Support Tickets (`tickets`)**: Cross-tenant helpdesk inbox to view, filter (`open`, `in_progress`, `resolved`, `closed`), reply to, and resolve tenant billing/upgrade/support tickets.
6. **Analytics & Governance (`analytics` & `settings`)**: Revenue breakdown by package, subscription status counts, audit logs, and platform configuration.

---

## 6. Company Admin & Tenant Workspace

### 6.1 Tenant Views (`AppShell`)
- **Operational Modules**: `dashboard`, `pos`, `invoices`, `customers`, `inventory`, `purchase_orders`, `ledger`, `reports`, `fbr`, `import` (Historical Import Wizard).
- **Settings & Governance (`SettingsPage`)**:
  - **Company & Tax Profile**: Legal name, NTN, STRN, Province, FBR Sandbox/Production credentials.
  - **Business Mode & Modules**: Switch between `Retail`, `Wholesale`, and `Distribution`; toggle package-permitted modules.
  - **Subscription & Support Tickets**: View current plan (`Basic 3,400` / `Standard 4,200` / `Premium 6,000` / `14-Day Trial`), remaining trial days, direct contact details for **Taha Asadullah**, and the **Support Tickets** thread panel (`/company/tickets`).
  - **Users & Custom Roles**: Manage staff accounts and granular RBAC permissions.
  - **Backup & Restore**: Local encrypted/SQLite snapshots.

---

## 7. Authentication, Onboarding & First-Run Flow

### 7.1 First-Run `.exe` Startup State Machine (`src/App.tsx`)
When a user launches the `.exe`:
1. **Step 1 — Hardware & Trial Check (`check_license_status`)**:
   - If `_license_lease` is empty (brand-new install), automatically provisions a **14-Day Evaluation Trial (`CRBL-TR14-XXXX-XXXX`)** bound to the PC's `device_hwid` and registers the device in Neon Cloud (`ensure_auto_trial_device`).
   - If the device was explicitly **blocked/revoked by Super Admin**, shows `LicenseLockedScreen`.
2. **Step 2 — Company Setup vs. Login Check (`is_company_setup`)**:
   - If `is_company_setup()` is `false` (no company in local SQLite yet), shows **`SetupPage`** so the prospect can immediately register their business and owner account for their 14-day trial.
   - `SetupPage` includes:
     - **"Already have an account? Sign in"** button to switch to `LoginPage` (for existing cloud tenants or employees logging in on a new PC).
     - **Direct Contact / Help Footer** with Taha Asadullah's contact details so prospects can reach out during onboarding.
   - `LoginPage` includes:
     - **"New to Corbel ERP? Start your 14-Day Free Trial"** button (when no local company exists or to register) + Direct Contact info for Taha Asadullah.
3. **Step 3 — `register_company` Execution**:
   - Creates the `companies` row, `users` (`role = 'owner'`), seeds default `company_modules`, creates a **14-day `trial` subscription** on `pkg-basic` (`3,400 PKR`), updates `_license_lease.client_name` with the company name, and syncs all records to Neon Cloud PostgreSQL.

---

## 8. Security Architecture

- **Tenant Isolation**: Every SQLite query filters by `company_id = ?`; Neon Cloud queries scope by `company_id` and validate Super Admin privileges (`require_super_admin`).
- **Password & Session Security**: Argon2 / Bcrypt password hashing, brute-force rate limiting (`LoginAttemptTracker`), `must_change_password` enforcement on admin-reset credentials, and `token_version` invalidation on company archive/deactivation.
- **Optimistic Locking (§8.10)**: `version` column on `companies`, `products`, `invoices`, `purchase_orders`, and `customers`.
- **Audit Logging (§8.2)**: Privileged mutations recorded in `audit_logs`.

---

## 9. Dual-Layer Subscription & Hardware Fleet Enforcement

### 9.1 Active vs. Expired Subscription States
- **`trial`**: Valid for 14 days from company creation (`trial_ends_at = created_at + 14 days`). Full access to package modules.
- **`active`**: Paid subscription (`Basic 3,400`, `Standard 4,200`, or `Premium 6,000`). Valid through `current_period_end`.
- **`past_due`**: 7-day grace period after `current_period_end`. Full access with renewal warning banner.
- **`suspended` / Expired Trial (>14 days)**:
  - **Read-Only + Support Mode (§9.2)**: The tenant **can still log in**, view their existing invoices/inventory/ledger/reports, view their subscription status, and **create/reply to Support Tickets (`/company/tickets`)** or contact Taha Asadullah to upgrade.
  - **Write Guard (`require_active_subscription`)**: All mutating business commands (`create_invoice`, `create_product`, `create_purchase_order`, `create_customer`) check `require_active_subscription(pool, &company_id)` and return a clear `Validation` error when the trial or subscription has expired.
- **Hardware Kill-Switch (`device_activations.is_blocked = true` or `tenant_licenses.status = 'revoked'`)**:
  - Triggered explicitly by Super Admin in Fleet Licensing. Hard-locks the workstation at `LicenseLockedScreen` before login.

---

## 10–23. Retained Core ERP Subsystems

Sections 10 through 23 of v5.1 are retained in full and governed by the hybrid architecture above:
- **§10 Invoice Template System**: `invoice_designs` custom branding & FBR mandatory fields.
- **§11 Analytics & Reporting**: Per-company P&L, Balance Sheet, Inventory Valuation, Aging Receivables, and Super Admin MRR analytics.
- **§13 Tauri IPC Commands**: Typed Rust commands in `src-tauri/src/commands/` bridged via `src/api/backend.ts`.
- **§16 & §17 Legal & FBR Digital Invoicing**: PRAL sandbox/production queue (`fbr_submission_queue`), IRN & QR code generation, credit/debit notes.
- **§19 Financial Consistency & Accounting Ledger**: Double-entry `accounts`, `journal_entries`, and `journal_lines`.
- **§20 Historical Invoice & Bill Import System**: CSV/Excel/OCR import wizard (`import_jobs`) with field mapping and batch tracking.
- **§22 Search Architecture**: SQLite FTS5 full-text search across inventory, customers, and invoices.
- **§23 Future Enhancements**: Deferred AI Intelligence Layer (`tenant_feature_flags` placeholder retained).
