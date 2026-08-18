# Multi-Tenant SaaS ERP — System Specification (v5.1)

> **⚠️ SPECIFICATION FROZEN — v1.0 LAUNCH**
> This document is frozen as the baseline for the v1.0 desktop release.
> No new features or architectural changes will be merged into this spec
> until v1.0 ships. Bug-fix clarifications and errata may still be added
> with a revision note. Future features are documented separately in
> [FUTURE_FEATURES.md](FUTURE_FEATURES.md).
>
> **Freeze date:** 2026-08-18

> **Revision Notes (v5.1):** AI Trend Analysis & Demand Forecasting (§23) moved from Phase 6 to §25 (Future Enhancements). Phase roadmap simplified and tightened. Import system (§24) retained as Phase 2 feature — it removes immediate onboarding pain and is not ML-dependent. AI module references removed from the active module list; `ai_insights` feature flag kept in the schema as a zero-cost placeholder for when the feature arrives. Round 5 analysis findings incorporated: import rollback strategy added (§24.12), AI anonymization proxy pattern documented in §25.6, weighted data sufficiency scoring replaces fixed threshold (§25.4), ERP migration adapters added to future enhancements (§25.7). Score impact of deferral documented in §20.6.
>
> **Revision Notes (v5.0):** JWT module-list vulnerability fixed, permission cache, subscription race condition, optimistic locking, invoice sequence SELECT FOR UPDATE, archival lifecycle, database mode separation, full-text search, AI forecasting, import system.
>
> **Revision Notes (v4.0):** KMS key management, refresh token rotation, audit log partitioning, background worker hardening, secrets rotation, transaction-scoped RLS, outbox pattern, General Ledger, encrypted secrets vault, invoice sequences.
>
> **Revision Notes (v3.0):** Legal & Compliance (§16), FBR/PRAL integration (§17), Technical Gap Register (§18).
>
> **Revision Notes (v2.0):** RLS, audit logging, soft deletes, JWT revocation, file upload security, permission inheritance, rate limiting.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Roles & Hierarchy](#2-roles--hierarchy)
3. [Database Tables](#3-database-tables)
4. [Module System](#4-module-system)
5. [Super Admin Dashboard](#5-super-admin-dashboard)
6. [Company Admin Dashboard](#6-company-admin-dashboard)
7. [Authentication & Authorization](#7-authentication--authorization)
8. [Security Architecture](#8-security-architecture)
9. [Subscription Enforcement](#9-subscription-enforcement)
10. [Invoice Template System](#10-invoice-template-system)
11. [Analytics & Reporting](#11-analytics--reporting)
12. [Frontend Architecture](#12-frontend-architecture)
13. [API Routes](#13-api-routes)
14. [Implementation Phases](#14-implementation-phases)
15. [Open Questions / Decisions Needed](#15-open-questions--decisions-needed)
16. [Legal & Compliance](#16-legal--compliance)
17. [FBR Digital Invoicing / PRAL Integration](#17-fbr-digital-invoicing--pral-integration)
18. [Technical Gap Register](#18-technical-gap-register)
19. [Financial Consistency & Accounting Ledger](#19-financial-consistency--accounting-ledger)
20. [Independent Analysis — Gap Register (All Rounds)](#20-independent-analysis--gap-register-all-rounds)
21. [Database Architecture Boundary](#21-database-architecture-boundary)
22. [Search Architecture](#22-search-architecture)
23. [Historical Invoice & Bill Import System](#23-historical-invoice--bill-import-system)
24. [Future Enhancements](#24-future-enhancements)

---

## 1. Overview

Transform the current single-tenant ERP into a **multi-tenant SaaS platform** with a Super Admin managing all tenants (companies), each with its own configurable modules, roles, and branding.

**Architecture modes (formally separated — see §21):**

| Mode            | Database   | Multi-tenancy      | SaaS Features                              |
| --------------- | ---------- | ------------------ | ------------------------------------------ |
| SaaS / Cloud    | PostgreSQL | Full multi-tenant  | Packages, subscriptions, RLS, partitioning |
| Desktop / Local | SQLite     | Single-tenant only | Disabled at compile time                   |

SaaS-specific features — RLS, materialized views, JSONB, INET, table partitioning — are PostgreSQL-only and must not be shimmed for SQLite.

**Product layering:**

```
Phase 1–2: ERP Core
  Inventory · Invoices · FBR Compliance · Multi-tenancy · Auth

Phase 3: Data Layer
  Import System · Reporting · Accounting Ledger

Phase 4: Intelligence Layer (Future)
  Rule-based Analytics → Statistical Forecasting → AI Assistant
```

The Intelligence Layer is deliberately deferred. It requires clean, organized historical data that only exists after the ERP Core is in production and in use. Building AI before the data pipeline is structurally backwards.

---

## 2. Roles & Hierarchy

### 2.1 Role Tree

```
Super Admin (cross-tenant, system-wide)
└── Company Admin (per-tenant)
    ├── Inventory Manager
    ├── Sales User
    ├── Import Clerk
    └── [Custom Roles created by Company Admin]
```

### 2.2 Super Admin

- **Scope:** System-wide, no `company_id` restriction
- **Capabilities:**
  - CRUD companies (tenants)
  - Assign subscription packages
  - Set initial admin credentials
  - Enable/disable modules per company
  - View all companies, usage stats, subscription status
  - Manage system packages/plans
  - View and respond to tenant tickets
  - System-wide analytics dashboard
  - All cross-tenant actions recorded in `audit_logs`

### 2.3 Company Admin

- **Scope:** Within their own company only
- **Capabilities:**
  - CRUD employees within their company
  - CRUD roles with permission inheritance rules (§8.4)
  - Enable/disable sidebar modules within subscribed package
  - Manage branches
  - View company analytics and reports
  - Customize invoice templates
  - Submit tickets to Super Admin
  - Configure FBR/PRAL integration
  - Manage historical data import (§23)

### 2.4 Standard Employee Roles

- `inventory_manager` — manage inventory items, stock movements, categories
- `sales_user` — create/manage sales invoices, customers
- `import_clerk` — manage purchase orders, import orders, suppliers
- Custom roles bounded by Company Admin's own permission set

---

## 3. Database Tables

### 3.1 `packages`

```sql
CREATE TABLE packages (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    price DECIMAL NOT NULL DEFAULT 0,
    billing_cycle TEXT NOT NULL DEFAULT 'monthly',
    module_limits JSONB NOT NULL DEFAULT '{}',
    max_users INTEGER NOT NULL DEFAULT 5,
    max_branches INTEGER NOT NULL DEFAULT 1,
    max_storage_mb INTEGER NOT NULL DEFAULT 100,
    features JSONB NOT NULL DEFAULT '{}',
    is_active BOOLEAN NOT NULL DEFAULT true,
    sort_order INTEGER NOT NULL DEFAULT 0,
    deleted_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
```

> Phase 2+: migrate `module_limits` and `features` to a normalized `package_features` table (§15.9).

### 3.2 `company_subscriptions`

```sql
CREATE TABLE company_subscriptions (
    id UUID PRIMARY KEY,
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    package_id UUID NOT NULL REFERENCES packages(id),
    status TEXT NOT NULL DEFAULT 'active',
    trial_ends_at TIMESTAMP,
    current_period_start TIMESTAMP NOT NULL,
    current_period_end TIMESTAMP NOT NULL,
    canceled_at TIMESTAMP,
    ended_at TIMESTAMP,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
```

### 3.3 `company_modules`

```sql
CREATE TABLE company_modules (
    id UUID PRIMARY KEY,
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    module_key TEXT NOT NULL,
    is_enabled BOOLEAN NOT NULL DEFAULT true,
    settings JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(company_id, module_key)
);
```

### 3.4 `tickets`

```sql
CREATE TABLE tickets (
    id UUID PRIMARY KEY,
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    created_by UUID NOT NULL REFERENCES users(id),
    subject TEXT NOT NULL,
    category TEXT NOT NULL CHECK(category IN ('complaint','recommendation','issue','feature_request','billing','other')),
    priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('low','normal','high','urgent')),
    status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','in_progress','resolved','closed')),
    assigned_to UUID REFERENCES users(id),
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMP
);

CREATE TABLE ticket_messages (
    id UUID PRIMARY KEY,
    ticket_id UUID NOT NULL REFERENCES tickets(id) ON DELETE RESTRICT,
    user_id UUID NOT NULL REFERENCES users(id),
    message TEXT NOT NULL,
    attachments JSONB NOT NULL DEFAULT '[]',
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
```

### 3.5 `discussion_posts`

> **Deferred from MVP.** The discussion board adds real-time infrastructure, moderation burden, and storage cost for low immediate ERP business value. Schema is retained so the module can be enabled in Phase 3 or as a plugin without a structural migration. Module is hidden by default.

```sql
CREATE TABLE discussion_posts (
    id UUID PRIMARY KEY,
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    author_id UUID NOT NULL REFERENCES users(id),
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    tags JSONB NOT NULL DEFAULT '[]',
    is_pinned BOOLEAN NOT NULL DEFAULT false,
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    deleted_by UUID REFERENCES users(id),
    edited_at TIMESTAMP,
    reported_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE discussion_comments (
    id UUID PRIMARY KEY,
    post_id UUID NOT NULL REFERENCES discussion_posts(id) ON DELETE RESTRICT,
    author_id UUID NOT NULL REFERENCES users(id),
    content TEXT NOT NULL,
    is_deleted BOOLEAN NOT NULL DEFAULT false,
    deleted_by UUID REFERENCES users(id),
    edited_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
```

### 3.6 `invoice_templates`

```sql
CREATE TABLE invoice_templates (
    id UUID PRIMARY KEY,
    company_id UUID NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
    name TEXT NOT NULL,
    is_default BOOLEAN NOT NULL DEFAULT false,
    template_type TEXT NOT NULL DEFAULT 'pdf',
    template_data JSONB NOT NULL DEFAULT '{}',
    uploaded_file_path TEXT,
    settings JSONB NOT NULL DEFAULT '{}',
    deleted_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(company_id, name)
);
```

### 3.7 `audit_logs`

Mandatory for all privileged actions. Partitioned by month.

```sql
CREATE TABLE audit_logs (
    id UUID NOT NULL,
    actor_id UUID NOT NULL REFERENCES users(id),
    company_id UUID REFERENCES companies(id),
    action TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id UUID,
    old_data JSONB,
    new_data JSONB,
    ip_address INET,
    user_agent TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
) PARTITION BY RANGE (created_at);

CREATE TABLE audit_logs_2026_05
    PARTITION OF audit_logs
    FOR VALUES FROM ('2026-05-01') TO ('2026-06-01');

CREATE INDEX idx_audit_logs_actor   ON audit_logs(actor_id, created_at DESC);
CREATE INDEX idx_audit_logs_company ON audit_logs(company_id, created_at DESC);
```

**Retention tiers:**

| Age            | Tier                  | Action                       |
| -------------- | --------------------- | ---------------------------- |
| 0–90 days      | Hot (primary DB)      | Fully queryable              |
| 90 days–1 year | Warm (archive schema) | Move to `audit_logs_archive` |
| 1+ years       | Cold (S3)             | Export JSONL; drop partition |

Minimum legal retention: **5 years** (ETO 2002).

### 3.8 `user_activity_logs`

```sql
CREATE TABLE user_activity_logs (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id),
    company_id UUID REFERENCES companies(id),
    event_type TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}',
    ip_address INET,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_activity_user    ON user_activity_logs(user_id);
CREATE INDEX idx_activity_created ON user_activity_logs(created_at DESC);
```

### 3.9 `company_storage_usage`

```sql
CREATE TABLE company_storage_usage (
    id UUID PRIMARY KEY,
    company_id UUID NOT NULL REFERENCES companies(id) UNIQUE,
    used_storage_bytes BIGINT NOT NULL DEFAULT 0,
    file_count INTEGER NOT NULL DEFAULT 0,
    last_recalculated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
```

### 3.10 `companies` table updates

```sql
ALTER TABLE companies ADD COLUMN deleted_at TIMESTAMP;
ALTER TABLE companies ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE companies ADD COLUMN ntn TEXT;
ALTER TABLE companies ADD COLUMN strn TEXT;
ALTER TABLE companies ADD COLUMN fbr_registered BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE companies ADD COLUMN fbr_registration_date DATE;
ALTER TABLE companies ADD COLUMN province TEXT;
ALTER TABLE companies ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
```

### 3.11 `users` table updates

```sql
ALTER TABLE users ADD COLUMN is_super_admin BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN must_change_password BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN deleted_at TIMESTAMP;
ALTER TABLE users ADD COLUMN anonymized_at TIMESTAMP;
ALTER TABLE users ADD COLUMN preferred_timezone TEXT NOT NULL DEFAULT 'Asia/Karachi';
ALTER TABLE users ADD COLUMN preferred_locale TEXT NOT NULL DEFAULT 'en-PK';
```

### 3.12 `refresh_tokens`

```sql
CREATE TABLE refresh_tokens (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    device_info TEXT,
    ip_address INET,
    expires_at TIMESTAMP NOT NULL,
    revoked_at TIMESTAMP,
    replaced_by UUID REFERENCES refresh_tokens(id),
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id, expires_at)
    WHERE revoked_at IS NULL;
```

**Rotation rules:**

- Every `/auth/refresh` invalidates the old token and issues a new one
- Revoked token reuse → revoke **all** tokens for that user → force re-login
- Expiry: 30 days inactivity; max 5 concurrent tokens per user

### 3.13 `encrypted_secrets`

```sql
CREATE TABLE encrypted_secrets (
    id UUID PRIMARY KEY,
    company_id UUID REFERENCES companies(id),
    key_name TEXT NOT NULL,
    encrypted_value BYTEA NOT NULL,
    kms_key_id TEXT NOT NULL,
    iv BYTEA NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    rotated_at TIMESTAMP,
    expires_at TIMESTAMP,
    UNIQUE(company_id, key_name)
);
```

### 3.14 `invoice_sequences`

Invoice numbers must be sequential, gap-free, and unique per company. Protected by `SELECT FOR UPDATE`.

```sql
CREATE TABLE invoice_sequences (
    id UUID PRIMARY KEY,
    company_id UUID NOT NULL REFERENCES companies(id),
    branch_id UUID REFERENCES branches(id),
    sequence_type TEXT NOT NULL DEFAULT 'invoice',
    prefix TEXT NOT NULL DEFAULT 'INV',
    current_value BIGINT NOT NULL DEFAULT 0,
    fiscal_year INTEGER NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(company_id, branch_id, sequence_type, fiscal_year)
);
```

**Atomic increment (must run inside an explicit transaction):**

```sql
BEGIN;

SELECT id, current_value, prefix
FROM invoice_sequences
WHERE company_id = $1
  AND sequence_type = 'invoice'
  AND fiscal_year = $2
FOR UPDATE;     -- Exclusive row lock; concurrent requests queue here

UPDATE invoice_sequences
SET current_value = current_value + 1,
    updated_at    = NOW()
WHERE company_id = $1
  AND sequence_type = 'invoice'
  AND fiscal_year = $2
RETURNING current_value, prefix;
-- Example output: INV-2026-000123

COMMIT;
```

> **Correction note:** The `UPDATE ... RETURNING` pattern alone (v4.0) is not safe under concurrency. Two transactions can both read `current_value = N` before either writes, producing duplicates. `SELECT FOR UPDATE` serialises access correctly.

### 3.15 Accounting Tables

```sql
CREATE TABLE accounts (
    id UUID PRIMARY KEY,
    company_id UUID NOT NULL REFERENCES companies(id),
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    account_type TEXT NOT NULL CHECK(account_type IN ('asset','liability','equity','revenue','expense')),
    parent_id UUID REFERENCES accounts(id),
    is_system BOOLEAN NOT NULL DEFAULT false,
    is_active BOOLEAN NOT NULL DEFAULT true,
    normal_balance TEXT NOT NULL CHECK(normal_balance IN ('debit','credit')),
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(company_id, code)
);

CREATE TABLE journal_entries (
    id UUID PRIMARY KEY,
    company_id UUID NOT NULL REFERENCES companies(id),
    entry_date DATE NOT NULL,
    reference_type TEXT,
    reference_id UUID,
    description TEXT NOT NULL,
    is_posted BOOLEAN NOT NULL DEFAULT false,
    is_reversed BOOLEAN NOT NULL DEFAULT false,
    reversed_by UUID REFERENCES journal_entries(id),
    created_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    posted_at TIMESTAMP
);

CREATE TABLE journal_lines (
    id UUID PRIMARY KEY,
    journal_entry_id UUID NOT NULL REFERENCES journal_entries(id) ON DELETE CASCADE,
    account_id UUID NOT NULL REFERENCES accounts(id),
    debit_amount DECIMAL(19,4) NOT NULL DEFAULT 0,
    credit_amount DECIMAL(19,4) NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'PKR',
    exchange_rate DECIMAL(15,6) NOT NULL DEFAULT 1.0,
    base_debit_amount  DECIMAL(19,4) GENERATED ALWAYS AS (debit_amount  * exchange_rate) STORED,
    base_credit_amount DECIMAL(19,4) GENERATED ALWAYS AS (credit_amount * exchange_rate) STORED,
    description TEXT,
    CONSTRAINT one_side_only CHECK (
        (debit_amount > 0 AND credit_amount = 0) OR
        (credit_amount > 0 AND debit_amount = 0)
    )
);
```

A trigger on `journal_lines` enforces `SUM(debit) = SUM(credit)` per `journal_entry_id`. Unbalanced entries raise an exception.

### 3.16 `tenant_feature_flags`

Enables gradual per-tenant rollout of new capabilities without code deployments. The AI module will use this when it ships (§24).

```sql
CREATE TABLE tenant_feature_flags (
    id UUID PRIMARY KEY,
    company_id UUID NOT NULL REFERENCES companies(id),
    feature_key TEXT NOT NULL,
    is_enabled BOOLEAN NOT NULL DEFAULT false,
    enabled_by UUID REFERENCES users(id),
    reason TEXT,
    expires_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(company_id, feature_key)
);
```

Resolved via Redis cache (60-second TTL). Super Admin toggles flags per tenant from `/admin/companies/:id/features`.

### 3.17 Permission Cache (Redis)

Replaces the JWT `enabled_modules` claim. Modules and permissions resolved on every request via Redis, with instant invalidation.

```
Redis key:   permissions:{user_id}
Value:       JSON { company_id, enabled_modules: [], permissions: [], token_version }
TTL:         60 seconds

Invalidated on:
  - company_modules update  →  DEL permissions:{all users in company}
  - token_version increment  →  DEL permissions:{user_id}
  - subscription suspended   →  DEL permissions:{all users in company}
```

```rust
async fn resolve_permissions(user_id: Uuid, token_version: i32) -> Result<PermissionSet> {
    let cache_key = format!("permissions:{}", user_id);
    if let Some(cached) = redis.get(&cache_key).await? {
        let p: PermissionSet = serde_json::from_str(&cached)?;
        if p.token_version == token_version {
            return Ok(p);
        }
    }
    let perms = db.load_permissions(user_id).await?;
    redis.setex(&cache_key, 60, serde_json::to_string(&perms)?).await?;
    Ok(perms)
}
```

---

## 4. Module System

### 4.1 Available Modules

| Module Key    | Description                       | Depends On           | Status           |
| ------------- | --------------------------------- | -------------------- | ---------------- |
| `dashboard`   | Analytics dashboard               | —                    | ✅ Phase 1       |
| `inventory`   | Items, stock, categories          | —                    | ✅ Phase 1       |
| `sales`       | Invoices, customers               | `inventory`          | ✅ Phase 1       |
| `purchases`   | Purchase orders, suppliers        | `inventory`          | ✅ Phase 1       |
| `import`      | Import orders, customs            | `purchases`          | ✅ Phase 1       |
| `reports`     | Reporting & analytics             | —                    | ✅ Phase 1       |
| `employees`   | Employee/user management          | —                    | ✅ Phase 1       |
| `branches`    | Branch management                 | —                    | ✅ Phase 1       |
| `invoices`    | Invoice templates & customization | `sales`              | ✅ Phase 1       |
| `data_import` | Historical invoice/bill import    | `sales`              | ✅ Phase 2 (§23) |
| `leads`       | Lead management                   | —                    | Phase 3          |
| `discussions` | Employee discussion board         | —                    | ⚠️ Deferred      |
| `ai_insights` | AI trend analysis & forecasting   | `sales`, `inventory` | 🔮 Future (§24)  |

### 4.2 Module Enforcement

- **Database (PostgreSQL):** RLS enforces `company_id` isolation (§8.1)
- **Backend:** Middleware checks **permission cache** (§3.17) — never JWT claims
- **Frontend:** Sidebar renders only enabled modules
- **Feature flags:** Beta modules additionally gated by `tenant_feature_flags` (§3.16)

---

## 5. Super Admin Dashboard

### 5.1 Pages/Routes

| Route                           | Description                                  |
| ------------------------------- | -------------------------------------------- |
| `/admin/companies`              | List all companies                           |
| `/admin/companies/new`          | Register company + initial admin             |
| `/admin/companies/:id`          | Company detail: subscription, modules, usage |
| `/admin/companies/:id/edit`     | Edit company info, change package            |
| `/admin/companies/:id/features` | Toggle per-tenant feature flags              |
| `/admin/packages`               | CRUD subscription packages                   |
| `/admin/tickets`                | View and respond to all tenant tickets       |
| `/admin/analytics`              | System-wide analytics                        |
| `/admin/audit-logs`             | Query audit logs                             |

### 5.2 Company Registration Flow

1. Super Admin fills company details and selects package
2. System generates one-time setup link (expires 24 hours) — no temp password
3. System creates: Company → Subscription → Admin user with `must_change_password = true`
4. Setup link emailed to Company Admin
5. All steps written to `audit_logs`

### 5.3 Company Deletion Policy

Hard deletes disabled. Soft archive only:

```
archive_company(id):
  1. Set companies.deleted_at = NOW()
  2. Set companies.is_active = false
  3. Increment token_version for all company users
  4. DEL all permission cache keys for company users
  5. Revoke all refresh_tokens for company users
  6. Write to audit_logs
  7. Retain all related records for compliance
```

---

## 6. Company Admin Dashboard

### 6.1 Pages/Routes

| Route                        | Description                                   |
| ---------------------------- | --------------------------------------------- |
| `/company/settings`          | Company profile, branding, timezone, currency |
| `/company/settings/fbr`      | FBR/PRAL integration configuration            |
| `/company/modules`           | Toggle modules                                |
| `/company/subscription`      | View plan, usage, billing                     |
| `/company/employees`         | CRUD employees                                |
| `/company/roles`             | CRUD roles & permissions                      |
| `/company/branches`          | Manage branches                               |
| `/company/tickets`           | Submit and track tickets                      |
| `/company/invoice-templates` | Upload and manage invoice templates           |
| `/company/analytics`         | Company analytics                             |
| `/company/fbr`               | FBR compliance dashboard                      |
| `/company/data-import`       | Historical data import wizard (§23)           |

---

## 7. Authentication & Authorization

### 7.1 JWT Claims

```json
{
  "sub": "user_uuid",
  "company_id": "company_uuid",
  "is_super_admin": false,
  "token_version": 3,
  "exp": 1234567890
}
```

**`enabled_modules` is NOT in the JWT.** Modules and permissions are resolved from the permission cache (§3.17) on every request. This prevents disabled modules from remaining accessible for up to 15 minutes while a valid token exists.

Access token TTL: **15 minutes.**

### 7.2 Auth Middleware

- Super admin: skip `verify_company_access`; access any company via `X-Company-ID` header; all access written to `audit_logs`
- Normal users: scoped to own `company_id`
- `token_version` validated against DB on every request; mismatch → `401`
- Permissions resolved from permission cache — never from JWT

### 7.3 First Login Flow

1. Super Admin creates company → one-time setup link generated
2. Company Admin receives link by email (24-hour expiry, single-use)
3. Admin sets own password → link invalidated
4. Login written to `user_activity_logs`

### 7.4 Session Invalidation

Increment `users.token_version` on: password change, role change, deactivation, company suspension, admin force-logout. Revoke all `refresh_tokens`. Bust permission cache for affected users.

### 7.5 Refresh Token Flow

```
POST /api/v1/auth/login
→ { access_token (15min), refresh_token (30d) }

POST /api/v1/auth/refresh
  1. Hash token → look up in refresh_tokens
  2. Not found or expired → 401
  3. Already revoked → REUSE DETECTED → revoke ALL for user → 401 REFRESH_TOKEN_REUSE
  4. Mark old token revoked; issue new access_token + refresh_token
  5. Bust permission cache for user

POST /api/v1/auth/logout
  → Revoke refresh_token → bust permission cache → write to user_activity_logs
```

### 7.6 Middleware Stack Order

```
Request
    ↓
Rate Limiter
    ↓
JWT Validation (verify signature + token_version)
    ↓
Permission Cache Resolution (loads enabled_modules, permissions)
    ↓
Set RLS context: SET LOCAL app.current_company_id (inside transaction)
    ↓
Super Admin bypass / Company scope enforcement
    ↓
Subscription status check (402 if suspended)
    ↓
Module access check (from permission cache)
    ↓
Feature flag check (for flagged routes)
    ↓
Route handler
    ↓
Audit log write (mutating operations)
```

---

## 8. Security Architecture

### 8.1 Row-Level Security (PostgreSQL)

```sql
ALTER TABLE invoices        ENABLE ROW LEVEL SECURITY;
ALTER TABLE users           ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_items ENABLE ROW LEVEL SECURITY;
-- repeat for all tenant-scoped tables

CREATE POLICY tenant_isolation ON invoices
    USING (company_id = current_setting('app.current_company_id')::uuid);
```

**Transaction-scoped wrapper (mandatory — never use raw pool.acquire() for business queries):**

```rust
async fn with_tenant<F, T>(pool: &PgPool, company_id: Uuid, f: F) -> Result<T>
where
    F: FnOnce(&mut PgConnection) -> BoxFuture<Result<T>>,
{
    let mut tx = pool.begin().await?;
    sqlx::query("SET LOCAL app.current_company_id = $1")
        .bind(company_id.to_string())
        .execute(&mut *tx).await?;
    let result = f(&mut tx).await?;
    tx.commit().await?;
    Ok(result)
}
```

### 8.2 Audit Logging

| Category            | Actions                                                         |
| ------------------- | --------------------------------------------------------------- |
| Company management  | Create, update, archive, restore                                |
| Subscription        | Package change, status change, override                         |
| User management     | Create, update, role change, deactivate, delete                 |
| Role management     | Create, update, delete, permission changes                      |
| Module management   | Enable, disable                                                 |
| Feature flags       | Enable, disable per tenant                                      |
| Cross-tenant access | Any Super Admin action on a tenant's data                       |
| Deletions           | All soft and hard deletes                                       |
| Auth events         | Login, logout, failed login, password reset, token invalidation |
| Data import         | Import job started, completed, failed (§23)                     |

### 8.3 Soft Deletes

| Table                 | Column       |
| --------------------- | ------------ |
| `companies`           | `deleted_at` |
| `users`               | `deleted_at` |
| `packages`            | `deleted_at` |
| `invoice_templates`   | `deleted_at` |
| `discussion_posts`    | `is_deleted` |
| `discussion_comments` | `is_deleted` |

### 8.4 Permission Inheritance

```
new_role_permissions ⊆ creator_permissions
```

Company Admins cannot grant `manage_company`, `manage_subscriptions`, `manage_packages`, or any Super Admin-level permission.

### 8.5 Rate Limiting

| Endpoint                    | Limit              |
| --------------------------- | ------------------ |
| `POST /auth/login`          | 5 attempts/min/IP  |
| `POST /auth/password-reset` | 3 attempts/hr/IP   |
| `POST /company/tickets`     | 10 tickets/hr/user |
| `POST /company/data-import` | 5 jobs/hr/company  |
| General API                 | 100 req/min/user   |
| File uploads                | 10 uploads/hr/user |

### 8.6 File Upload Security

```
Upload received
    ↓ MIME type validation (magic bytes, not extension)
    ↓ File size check (per-package limits)
    ↓ Virus/malware scan (ClamAV)
    ↓ Strip macros (Excel via xlrd/openpyxl)
    ↓ Rename to UUID
    ↓ Store in private directory / S3 private bucket
    ↓ Record in relevant table
```

Accepted MIME types: `application/pdf`, `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, `text/csv`.

### 8.7 Cascading Delete Policy

All `ON DELETE CASCADE` replaced with `ON DELETE RESTRICT` on business-critical FKs. Deletions go through service-layer functions.

### 8.8 KMS-Backed Key Management

Encryption keys for `encrypted_secrets` held in external KMS (AWS KMS or HashiCorp Vault). Plaintext never cached beyond the request lifecycle.

### 8.9 Secrets Rotation Schedule

| Secret              | Rotation Frequency                    |
| ------------------- | ------------------------------------- |
| PRAL security token | On 30-day expiry warning (5-year max) |
| KMS data keys       | Annually                              |
| SMTP credentials    | Quarterly                             |
| S3 access keys      | Quarterly                             |
| JWT signing key     | Annually (with token_version bump)    |

### 8.10 Optimistic Locking

All entities editable by multiple users concurrently carry a `version` column.

```sql
ALTER TABLE inventory_items ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE invoices         ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE purchase_orders  ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE customers        ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
```

**Update pattern:**

```sql
UPDATE inventory_items
SET stock_quantity = $1, version = version + 1, updated_at = NOW()
WHERE id = $2 AND version = $3;
-- 0 rows affected → return 409 Conflict
```

All GET responses for lockable resources include `"version": N`. All PUT/PATCH must send it back.

### 8.11 Data Archival Lifecycle

```
Active (main table)
    ↓ 90 days after soft-delete: move to archive table
Archive table (invoices_archive, users_archive)
    ↓ 1 year in archive: move to cold storage
Cold storage (S3 compressed JSONL)
```

**Partial index for active query performance:**

```sql
CREATE INDEX idx_invoices_active ON invoices(company_id, created_at)
    WHERE deleted_at IS NULL;
```

---

## 9. Subscription Enforcement

### 9.1 Transaction-Scoped Validation

Subscription and limit checks must run **inside the same database transaction** as the guarded operation. The check-then-act pattern outside a transaction creates a race condition.

```rust
async fn create_invoice(pool: &PgPool, company_id: Uuid, data: InvoiceData) -> Result<Invoice> {
    with_tenant(pool, company_id, |tx| async move {
        // Check subscription inside same transaction with shared lock
        let sub = sqlx::query!(
            "SELECT status FROM company_subscriptions
             WHERE company_id = $1 FOR SHARE",
            company_id
        ).fetch_one(tx).await?;

        if sub.status != "active" {
            return Err(Error::SubscriptionInactive);
        }
        // Sequence allocation + invoice creation — all or nothing
    }.boxed()).await
}
```

### 9.2 Expired Subscription

- Grace period: 7 days after `current_period_end`
- After grace: `status = 'suspended'`; business endpoints return `402 Payment Required`
- On suspension: bust all permission cache keys for company
- Suspended companies: login + subscription page only

### 9.3 Storage Enforcement

```
used_storage_bytes + new_file_bytes ≤ max_storage_mb × 1,048,576
```

Return `507 Insufficient Storage` if exceeded.

---

## 10. Invoice Template System

### 10.1 Invoice Lifecycle

```
Create invoice draft
    ↓ Validate required fields (NTN, STRN, HS codes, tax amounts)
    ↓ Allocate sequence number (SELECT FOR UPDATE — §3.14)
    ↓ [FBR tenant] Insert into fbr_submission_queue (same transaction — outbox)
    ↓ Commit transaction
    ↓ Background worker → POST to PRAL DI API
    ↓ [Success] Store IRN + QR → status = 'validated'
    ↓ Generate PDF using branded template
    ↓ Store: invoice record + FBR JSON + response + PDF
```

### 10.2 Template Upload

File validation pipeline (§8.6) before storage. FBR-mandatory fields cannot be suppressed by template design.

### 10.3 Invoice Generation

- FBR-registered tenants: IRN required before final PDF
- Non-FBR tenants: standard generation without PRAL submission
- Pending invoices: printable as draft with watermark "Pending FBR Validation"

---

## 11. Analytics & Reporting

### 11.1 Per-Company Analytics

- Sales overview: revenue, invoice count, average order value
- Inventory: total items, low stock alerts, stock value
- Top customers / top products
- Monthly trends; export to CSV/PDF

### 11.2 System-Wide Analytics (Super Admin)

- Companies by status, total users, subscription revenue
- Module adoption stats, ticket resolution metrics

### 11.3 Hybrid Aggregation Strategy

```
Redis counters         → today's metrics (invoice count, revenue)
Materialized views     → historical monthly summaries and trends
Raw table queries      → exports and one-off reports
```

**Redis counters (updated on every write):**

```
INCR             company:{id}:invoices:today
INCRBYFLOAT      company:{id}:revenue:today  {amount}
-- Reset at midnight via scheduled job
```

**Materialized view (refreshed daily at 2 AM):**

```sql
CREATE MATERIALIZED VIEW company_monthly_metrics AS
SELECT
    company_id,
    DATE_TRUNC('month', created_at) AS month,
    COUNT(*) AS invoice_count,
    SUM(total_amount) AS total_revenue
FROM invoices
WHERE deleted_at IS NULL
GROUP BY company_id, DATE_TRUNC('month', created_at);

CREATE UNIQUE INDEX ON company_monthly_metrics(company_id, month);
```

**Dashboard pattern:** Materialized view for all months except current; Redis delta for current day.

---

## 12. Frontend Architecture

### 12.1 Dynamic Sidebar

Modules loaded from `/api/v1/auth/me` after login — resolved from permission cache, never from JWT.

```typescript
interface AuthState {
  isSuperAdmin: boolean;
  mustChangePassword: boolean;
  enabledModules: string[]; // From API
  permissions: string[]; // From API
  tokenVersion: number;
}
```

### 12.2 Super Admin Layout

Separate layout, accessible only where `is_super_admin = true`. Includes audit log viewer, feature flag management per tenant.

### 12.3 First Login

If `mustChangePassword = true` after login, redirect to `/auth/change-password`. Block all navigation until complete.

### 12.4 Optimistic Lock Conflict UI

When any PUT/PATCH returns `409 Conflict`, display: _"This record was updated by another user. Please reload and try again."_ with a Reload button.

---

## 13. API Routes

### 13.1 Super Admin

| Method         | Path                                        | Description               |
| -------------- | ------------------------------------------- | ------------------------- |
| GET            | `/api/v1/admin/companies`                   | List companies            |
| POST           | `/api/v1/admin/companies`                   | Register company + admin  |
| GET/PUT/DELETE | `/api/v1/admin/companies/:id`               | Detail / update / archive |
| GET            | `/api/v1/admin/companies/:id/stats`         | Usage stats               |
| PUT            | `/api/v1/admin/companies/:id/subscription`  | Change package            |
| GET/POST/PUT   | `/api/v1/admin/packages`                    | CRUD packages             |
| GET/PUT        | `/api/v1/admin/tickets`                     | View / update tickets     |
| GET            | `/api/v1/admin/analytics`                   | System stats              |
| GET            | `/api/v1/admin/audit-logs`                  | Query audit logs          |
| GET/PUT        | `/api/v1/admin/companies/:id/feature-flags` | Manage feature flags      |

### 13.2 Company Admin

| Method              | Path                                            | Description                 |
| ------------------- | ----------------------------------------------- | --------------------------- |
| GET/PUT             | `/api/v1/company/modules`                       | List/toggle modules         |
| GET                 | `/api/v1/company/subscription`                  | Subscription details        |
| GET/POST            | `/api/v1/company/tickets`                       | Tickets                     |
| POST                | `/api/v1/company/tickets/:id/messages`          | Ticket reply                |
| GET/POST/PUT/DELETE | `/api/v1/company/invoice-templates`             | Templates                   |
| GET                 | `/api/v1/company/analytics`                     | Company analytics           |
| GET/POST/PUT        | `/api/v1/company/data-requests`                 | PDPB data requests          |
| GET                 | `/api/v1/company/data-export`                   | Export personal data        |
| POST                | `/api/v1/company/data-import/jobs`              | Start import job            |
| GET                 | `/api/v1/company/data-import/jobs`              | List jobs                   |
| GET/PUT             | `/api/v1/company/data-import/jobs/:id`          | Job status / update mapping |
| POST                | `/api/v1/company/data-import/jobs/:id/confirm`  | Confirm import              |
| POST                | `/api/v1/company/data-import/jobs/:id/rollback` | Roll back import (§23.12)   |
| DELETE              | `/api/v1/company/data-import/jobs/:id`          | Cancel pending job          |
| GET                 | `/api/v1/company/data-import/jobs/:id/events`   | SSE progress stream         |
| GET/DELETE          | `/api/v1/company/data-import/templates`         | Saved import templates      |

### 13.3 Auth

| Method | Path                           | Description                  |
| ------ | ------------------------------ | ---------------------------- |
| POST   | `/api/v1/auth/login`           | Login → tokens               |
| POST   | `/api/v1/auth/refresh`         | Rotate refresh token         |
| POST   | `/api/v1/auth/logout`          | Revoke token                 |
| PUT    | `/api/v1/auth/change-password` | Change password              |
| GET    | `/api/v1/auth/me`              | User + modules + permissions |

### 13.4 FBR

| Method  | Path                                    | Description        |
| ------- | --------------------------------------- | ------------------ |
| GET/PUT | `/api/v1/company/fbr/config`            | FBR configuration  |
| POST    | `/api/v1/company/fbr/test-connection`   | Test sandbox       |
| GET     | `/api/v1/company/fbr/queue`             | Queue status       |
| POST    | `/api/v1/company/fbr/retry/:invoice_id` | Manual retry       |
| GET     | `/api/v1/company/fbr/compliance-report` | Compliance summary |
| GET     | `/api/v1/invoices/:id/fbr-status`       | Invoice FBR status |
| GET     | `/api/v1/invoices/:id/qr-code`          | QR code image      |
| POST    | `/api/v1/invoices/:id/credit-note`      | Create credit note |
| POST    | `/api/v1/invoices/:id/debit-note`       | Create debit note  |

### 13.5 Search

| Method | Path                      | Description                                    |
| ------ | ------------------------- | ---------------------------------------------- |
| GET    | `/api/v1/search?q=&type=` | Global search (inventory, invoices, customers) |
| GET    | `/api/v1/inventory?q=`    | Inventory full-text search                     |
| GET    | `/api/v1/invoices?q=`     | Invoice search                                 |
| GET    | `/api/v1/customers?q=`    | Customer search                                |

---

## 14. Implementation Phases

### Phase 1: Core ERP (Backend)

1. User table additions: `is_super_admin`, `must_change_password`, `token_version`, `deleted_at`
2. `packages`, `company_subscriptions`, `company_modules` tables
3. `audit_logs` (partitioned), `user_activity_logs`, `company_storage_usage`
4. `tenant_feature_flags` table (placeholder for future features)
5. RLS on all tenant-scoped tables (PostgreSQL)
6. Package CRUD + seed default packages
7. Subscription management endpoints
8. Module toggle endpoints
9. **Permission cache system** — replaces JWT module claims
10. Auth middleware: token_version check + permission cache resolution
11. Rate limiting (Redis)
12. Optimistic locking (`version` column on concurrent-write tables)
13. Subscription validation inside transactions

### Phase 2: Invoicing & Compliance (Backend)

1. Invoice sequence table + `SELECT FOR UPDATE` pattern
2. FBR credentials, submission queue tables
3. Background worker for PRAL submission (exponential backoff)
4. Dead letter handling + Company Admin alerts
5. QR code generation post-IRN
6. Credit note / debit note lifecycle
7. Company CRUD with soft archive
8. First-login one-time link flow
9. Permission inheritance on role creation

### Phase 3: Data Layer

1. Chart of Accounts + journal entries + journal lines
2. Double-entry posting on invoice creation
3. Balance sheet / P&L report generation
4. Outbox pattern for financial consistency (§19.1)
5. Historical import wizard — CSV/Excel first (§23)
6. Import job queue, field mapping UI, preview screen, rollback capability
7. Full-text search on inventory and invoices (§22)

### Phase 4: Frontend

1. Dynamic sidebar (permission cache — not JWT)
2. Super admin layout (companies, packages, tickets, audit logs, feature flags)
3. Company admin layout (modules, subscription, templates, analytics, FBR dashboard)
4. First-login password change flow
5. Analytics dashboards (hybrid Redis + materialized views)
6. Optimistic lock conflict UI (409 reload prompt)
7. Import wizard UI (file upload → mapping → preview → confirm → progress)

### Phase 5: Hardening & Observability

1. Archival lifecycle for invoices, users, audit logs (§8.11)
2. Backup: daily automated, PITR, 30-day retention
3. Restore testing schedule (monthly)
4. Health checks, Prometheus metrics, OpenTelemetry tracing (§18.10)
5. Security review: all tenant-scoped tables for missing `company_id` filters
6. Load testing analytics against materialized views
7. Supply-chain security: `cargo audit` in CI

---

## 15. Open Questions / Decisions Needed

1. **Super Admin seeding** — one-time setup script; forced password change on first login; credentials in secure handover doc.
2. **Billing integration** — Stripe/Paddle vs manual invoicing. Affects `company_subscriptions.metadata` structure.
3. **Invoice template approach** — Option A (field mapping UI) for v1, Option B (merge field upload) for v2.
4. **Email provider** — AWS SES recommended. Company emails = username convention, not mailbox provisioning.
5. **File storage** — S3-compatible for SaaS. Local filesystem for desktop mode only.
6. **Backup/DR owner** — Recommended: RPO 1 hour, RTO 4 hours for SaaS mode.
7. **Company Admin audit log access** — Recommended: yes, read-only, scoped to own `company_id`.
8. **`package_features` normalization** — defer to Phase 2+ once feature set stabilises.
9. **Discussion board** — confirm deferral (schema kept, module hidden by default).

---

## 16. Legal & Compliance

### 16.1 Applicable Laws

| Law                                             | Jurisdiction    | Status                     | Applies When                        |
| ----------------------------------------------- | --------------- | -------------------------- | ----------------------------------- |
| PECA 2016                                       | Pakistan        | Active                     | Always                              |
| ETO 2002                                        | Pakistan        | Active                     | Always                              |
| Payment Systems Act 2007                        | Pakistan        | Active                     | Banking/fintech tenants             |
| FBR Digital Invoicing (SRO 709/1852, Rule 150Q) | Pakistan        | Active, penalties Jan 2026 | Sales-tax-registered tenants        |
| PDPB 2023                                       | Pakistan        | Bill stage                 | Design now                          |
| GDPR                                            | EU              | Active                     | Tenants with EU customers/employees |
| CCPA                                            | California, USA | Active                     | Tenants with California customers   |

### 16.2 Pakistani Law Compliance

**PECA 2016:** All admin access logged; failed logins rate-limited and logged; unauthorized access incidents documented and reported to PTA.

**ETO 2002:** All invoices stored in original form (JSON + PDF) for minimum 5 years. Invoice records immutable after FBR validation; corrections via credit/debit notes only.

**PDPB 2023 — Erasure procedure:**

```sql
UPDATE users SET
    full_name     = 'ANONYMIZED',
    email         = 'anonymized_' || id || '@deleted.invalid',
    phone         = NULL, address = NULL,
    deleted_at    = NOW(), anonymized_at = NOW()
WHERE id = $1;
-- Invoice records RETAINED (ETO + FBR 5-year requirement)
```

**Data breach notification:**

1. Detection → security team within 1 hour
2. Scope assessment within 24 hours
3. Affected tenants notified within 48 hours
4. NCPDP notified within 72 hours (once PDPB enacted)

### 16.3 GDPR

DPA acceptance tracked in `dpa_acceptances` table. Data residency decision required: EU-region hosting (no SCCs) vs Pakistan-only (SCCs required with EU tenants).

### 16.4 Compliance Checklist

| Requirement                   | Status               |
| ----------------------------- | -------------------- |
| PECA — access logging         | ✅ Done              |
| PECA — rate limiting          | ✅ Done              |
| ETO — 5-year retention policy | ⚠️ Policy needed     |
| FBR — e-invoicing mandate     | 🔴 Phase 2           |
| PDPB — data subject rights    | ⚠️ Planned           |
| PDPB — breach notification    | ⚠️ Planned           |
| GDPR — DPA                    | ⚠️ Planned           |
| GDPR — data residency         | ❓ Decision required |
| GDPR — cookie consent         | ⚠️ Planned           |

---

## 17. FBR Digital Invoicing / PRAL Integration

### 17.1 Legal Basis

Finance Act 2024, SRO 709(I)/2025, SRO 1852(I)/2025, Rule 150Q. Penalties enforced January 2026. Applies to Pakistani sales-tax-registered tenants only.

### 17.2 Database Schema

**`fbr_credentials`:**

```sql
CREATE TABLE fbr_credentials (
    id UUID PRIMARY KEY,
    company_id UUID NOT NULL REFERENCES companies(id) UNIQUE,
    secret_id UUID NOT NULL REFERENCES encrypted_secrets(id),
    pral_token_expires_at DATE,
    whitelisted_ip TEXT,
    environment TEXT NOT NULL DEFAULT 'sandbox',
    sandbox_url TEXT NOT NULL DEFAULT 'https://gw.fbr.gov.pk/di_data/v1/di/validateinvoicedata',
    production_url TEXT NOT NULL DEFAULT 'https://gw.fbr.gov.pk/di_data/v1/di/validateinvoicedata',
    is_active BOOLEAN NOT NULL DEFAULT false,
    last_tested_at TIMESTAMP,
    last_test_result TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
```

**`fbr_submission_queue`:**

```sql
CREATE TABLE fbr_submission_queue (
    id UUID PRIMARY KEY,
    company_id UUID NOT NULL REFERENCES companies(id),
    invoice_id UUID NOT NULL REFERENCES invoices(id),
    payload JSONB NOT NULL,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    max_attempts INTEGER NOT NULL DEFAULT 5,
    status TEXT NOT NULL DEFAULT 'queued',
    scheduled_at TIMESTAMP NOT NULL DEFAULT NOW(),
    last_attempted_at TIMESTAMP,
    last_error TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_fbr_queue_status ON fbr_submission_queue(status, scheduled_at)
    WHERE status IN ('queued', 'failed');
```

### 17.3 FBR JSON Schema

```json
{
  "InvoiceHeader": {
    "STRN": "1234567890123",
    "NTN": "1234567",
    "BusinessName": "ABC Trading Co.",
    "InvoiceDate": "2026-05-21",
    "InvoiceRefNo": "INV-2026-00123",
    "InvoiceType": "SI",
    "Province": "Punjab",
    "BuyerNTN": "7654321",
    "BuyerCNIC": null,
    "BuyerName": "XYZ Retailers",
    "TotalBillAmount": 118000.0,
    "TotalSaleValue": 100000.0,
    "TotalTaxCharged": 18000.0,
    "TotalQuantity": 10
  },
  "InvoiceItems": [
    {
      "ItemSerialNo": 1,
      "HSCode": "8471.30",
      "ProductCode": "LAPTOP-001",
      "ItemDescription": "Laptop Computer 15 inch",
      "Quantity": 10,
      "UnitPrice": 10000.0,
      "TotalAmount": 100000.0,
      "TaxRate": 18.0,
      "TaxCategory": "Standard Rate",
      "TaxCharged": 18000.0
    }
  ]
}
```

### 17.4 Submission Architecture

```
Invoice created (inside transaction)
    ↓ Sequence allocated (SELECT FOR UPDATE)
    ↓ fbr_submission_queue row inserted (same transaction — outbox)
    ↓ COMMIT
    ↓ Background worker → POST to PRAL
    ↓ Success: store IRN + QR → validated
    ↓ Failure: exponential backoff (0 → 2m → 10m → 30m → 2h)
    ↓ 5 failures: status = dead → alert Company Admin
```

### 17.5 QR Code

```
Content: {FBR_IRN}|{InvoiceDate}|{STRN}|{TotalBillAmount}
Format: QR v2.0, minimum 300×300px
```

### 17.6 Credit Notes & Debit Notes

Must reference original invoice IRN via `linked_irn`. FBR allows CN/DN within 180 days. System enforces and warns if window exceeded.

### 17.7 Infrastructure Requirements

- Static IP whitelisted with FBR/PRAL (deployment prerequisite)
- Persistent background worker for queue drainage
- All 28 FBR sandbox test scenarios must pass before production

---

## 18. Technical Gap Register

### 18.1 Notification System

| Event                           | Recipient      | Channel        |
| ------------------------------- | -------------- | -------------- |
| New user created                | New user       | Email          |
| Subscription expiring in 7 days | Company Admin  | Email          |
| Subscription suspended          | Company Admin  | Email + in-app |
| Ticket replied                  | Ticket creator | Email + in-app |
| FBR submission dead             | Company Admin  | Email + in-app |
| PRAL token expiring in 30 days  | Company Admin  | Email          |
| Import job completed/failed     | Company Admin  | Email + in-app |

```sql
CREATE TABLE notifications (
    id UUID PRIMARY KEY,
    company_id UUID REFERENCES companies(id),
    user_id UUID NOT NULL REFERENCES users(id),
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}',
    is_read BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
```

### 18.2 Pagination Strategy

Cursor-based for all list endpoints:

```json
GET /api/v1/admin/companies?cursor=eyJ...&limit=50&sort=created_at:desc

{
  "data": [...],
  "next_cursor": "eyJ...",
  "has_more": true,
  "total_count": 1423
}
```

### 18.3 API Versioning

URL-based (`/api/v1/`, `/api/v2/`). 6-month minimum sunset notice via `Deprecation` header.

### 18.4 Migration Strategy

`sqlx migrate`. Additive-only in production. Rename/drop over two releases. Separate paths: `/migrations/postgres/` and `/migrations/sqlite/`.

### 18.5 Real-Time Support (SSE)

| Feature             | SSE Endpoint                                      |
| ------------------- | ------------------------------------------------- |
| Ticket messages     | `GET /api/v1/company/tickets/:id/events`          |
| FBR queue status    | `GET /api/v1/company/fbr/queue/events`            |
| Notification bell   | `GET /api/v1/notifications/events`                |
| Import job progress | `GET /api/v1/company/data-import/jobs/:id/events` |

### 18.6 Error Response Schema

```json
{
  "error": {
    "code": "OPTIMISTIC_LOCK_CONFLICT",
    "message": "This record was modified by another user. Please reload and retry.",
    "details": [{ "field": "version", "issue": "Expected 3, found 5" }],
    "request_id": "req_01HXYZ...",
    "timestamp": "2026-05-21T10:30:00Z"
  }
}
```

### 18.7 Credential Delivery

One-time setup link, 24-hour expiry, single-use, emailed to Company Admin. No temp passwords.

### 18.8 SQLite Mode Isolation

Single-tenant only. Multi-company features disabled at compile time. Every query on tenant-scoped tables requires `WHERE company_id = ?`. CI test asserts zero cross-tenant rows for all tenant-scoped tables.

### 18.9 Testing Strategy

| Layer              | Focus                                                     | Tool                    |
| ------------------ | --------------------------------------------------------- | ----------------------- |
| Unit               | Service logic, FBR payload construction, tax calculations | `cargo test`            |
| Integration        | DB queries, middleware, FBR mock, permission cache        | `sqlx` + `wiremock`     |
| API                | Every endpoint: auth, permissions, pagination, errors     | `reqwest` + test server |
| Tenant isolation   | Cross-tenant queries return 0 rows                        | Custom harness          |
| FBR scenarios      | All 28 PRAL scenarios pass                                | Mock PRAL server        |
| Optimistic locking | Concurrent writes → correct 409 responses                 | Concurrent harness      |
| Import             | Parse → mapping → preview → confirm → rollback cycle      | `cargo test`            |
| Migration          | Forward migration on clean DB                             | CI pipeline             |

### 18.10 Observability

| Concern      | Implementation                                                                 |
| ------------ | ------------------------------------------------------------------------------ |
| Health check | `GET /health` — DB, queue depth, FBR reachability                              |
| Metrics      | Prometheus `/metrics`: request rate, error rate, FBR success rate, queue depth |
| Tracing      | OpenTelemetry; `request_id` in all error responses                             |
| Logging      | JSON with `company_id`, `user_id`, `request_id` on every line                  |
| Alerts       | FBR queue > 50, error rate > 1%, DB failures, PRAL token < 30 days             |

---

## 19. Financial Consistency & Accounting Ledger

### 19.1 Outbox Pattern

```sql
CREATE TABLE financial_outbox (
    id UUID PRIMARY KEY,
    event_type TEXT NOT NULL,
    payload JSONB NOT NULL,
    processed_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);
```

Outbox row written in the same transaction as the business event. Background worker processes it. Guarantees journal entry and source document are always consistent.

### 19.2 Chart of Accounts (Default Seed)

| Code | Name                | Type      |
| ---- | ------------------- | --------- |
| 1000 | Cash                | Asset     |
| 1200 | Accounts Receivable | Asset     |
| 2000 | Accounts Payable    | Liability |
| 3000 | Owner's Equity      | Equity    |
| 4000 | Sales Revenue       | Revenue   |
| 5000 | Cost of Goods Sold  | Expense   |
| 6000 | Operating Expenses  | Expense   |

---

## 20. Independent Analysis — Gap Register (All Rounds)

### 20.1–20.4 Rounds 2–4

All findings confirmed and addressed. See v5.0 §20 for detailed verdicts. Summary:

| Round   | Findings                                                                                                             | All Addressed |
| ------- | -------------------------------------------------------------------------------------------------------------------- | ------------- |
| Round 2 | RLS, audit, soft deletes, JWT revocation, uploads, permissions, rate limiting                                        | ✅            |
| Round 3 | FBR, IRN lifecycle, PRAL downtime, PDPB/GDPR, notifications                                                          | ✅ / ⚠️       |
| Round 4 | JWT modules, DB separation, race condition, optimistic locking, sequence, archival, analytics, feature flags, search | ✅            |

### 20.5 Round 5 Findings — Analysis & Status

Round 5 analysis (Document 4) is accurate. Detailed verdicts:

#### Finding 1: AI training under concurrent tenant load ✅ Correct

**Verdict: Confirmed critical.** 1,000 tenants simultaneously triggering model training would saturate CPU. The event-driven, nightly-training architecture described in §24.3 (Future Enhancements) correctly addresses this — dashboard reads pre-computed cache, training never runs synchronously with user requests. **Resolution: Documented in §24.3. Moot for now since AI is deferred.**

#### Finding 2: AI model versioning incomplete ✅ Correct

**Verdict: Confirmed.** `model_version TEXT` alone cannot answer "why did the prediction change?" **Resolution: `model_registry` table documented in §24.4 with `accuracy_score`, `training_period`, `trained_at`, `training_data_hash`.**

#### Finding 3: Import rollback strategy missing ✅ Correct and high value

**Verdict: Critical omission.** A 10,000-row import that fails partway through leaves ambiguous state. Users discover duplicate invoices through the worst possible discovery mechanism: confused customers. **Resolution: §23.12 adds `import_batches` rollback system — imported records tagged with `import_batch_id`, rollback available for 24 hours via `POST /jobs/:id/rollback`.**

#### Finding 4: AI privacy anonymization proxy ✅ Correct

**Verdict: Confirmed.** Anonymizing item names to `ITEM001` before sending to an LLM but returning `ITEM001` to the user breaks the experience. **Resolution: §24.6 documents the server-side anonymization proxy pattern — names replaced with opaque codes before external call, backend remaps codes back to real names before returning to user.**

#### Finding 5: Fixed data threshold fails niche high-value businesses ✅ Correct

**Verdict: Valid edge case.** A scientific equipment supplier with 40 high-value invoices/month has more predictive signal than a retailer with 500 low-value transactions. Fixed 500-invoice threshold incorrectly blocks insight generation for legitimate data. **Resolution: §24.5 replaces fixed threshold with a weighted sufficiency score.**

#### Finding 6: Missing ERP migration adapters ✅ Correct and commercially valuable

**Verdict: Confirmed.** Dedicated adapters for Odoo, QuickBooks, ERPNext exports feel magical compared to manual CSV mapping. **Resolution: §23.11 documents a pre-built adapter registry for common ERP export formats, phased: generic CSV/Excel first, named adapters in Phase 2.**

#### Finding 7: AI recommendations need explainability ✅ Correct

**Verdict: Critical for user trust.** An unexplained recommendation is ignored or distrusted. A recommendation with three supporting data points and a confidence percentage gets acted on. **Resolution: §24.7 defines the explainability schema — every recommendation carries `reasons[]`, `confidence`, and `supporting_data`.**

### 20.6 Score Impact of AI Deferral

| Area                   | v5.0 (with AI) | v5.1 (AI deferred) |
| ---------------------- | -------------- | ------------------ |
| Security               | 9.8            | 9.9                |
| Architecture           | 9.5            | 10                 |
| Scalability            | 9.2            | 10                 |
| Production readiness   | 9.1            | 10                 |
| MVP feasibility        | 8.0            | 10                 |
| Maintainability        | 9.0            | 10                 |
| Development complexity | 6.5            | 9.5                |
| Business value         | 9.2            | 8.9                |

**Overall: ~9.7/10**

Business value drops marginally (9.2 → 8.9) because AI was a future differentiator, not a present one. Every other score increases because the ML service, model training pipeline, Python microservice, and LLM integration are no longer part of the active build. The `tenant_feature_flags` infrastructure and `ai_insight_snapshots` schema are retained at zero cost — when AI ships, it plugs into existing infrastructure rather than requiring a structural rewrite.

### 20.7 Remaining Open Gaps

| Gap                                 | Severity | Target    |
| ----------------------------------- | -------- | --------- |
| PDPB/GDPR data subject rights       | High     | Phase 3   |
| Backup/DR formally defined          | High     | Phase 5   |
| Multi-currency support              | Medium   | Future    |
| CORS policy                         | Medium   | Phase 5   |
| SLO/SLA definitions                 | Medium   | Before GA |
| Supply-chain security (cargo audit) | Medium   | Phase 5   |
| Tenant sharding                     | Low      | Future    |
| Multi-region failover               | Low      | Future    |

---

## 21. Database Architecture Boundary

### 21.1 Mode Separation

|                        | SaaS Mode    | Desktop Mode            |
| ---------------------- | ------------ | ----------------------- |
| Database               | PostgreSQL   | SQLite                  |
| Multi-tenancy          | Full         | Single-tenant only      |
| Packages/subscriptions | Yes          | No                      |
| RLS                    | Yes          | WHERE clause only       |
| Materialized views     | Yes          | No                      |
| JSONB                  | Yes          | JSON as TEXT            |
| Table partitioning     | Yes          | No                      |
| INET type              | Yes          | TEXT                    |
| Feature flags          | Yes          | No                      |
| Import system          | Yes          | Limited (single-tenant) |
| AI module              | Yes (future) | No                      |

### 21.2 Codebase Structure

```
src/
  core/      # Shared domain logic, service traits, types
  saas/      # PostgreSQL-only: RLS, subscriptions, FBR, feature flags
  desktop/   # SQLite-only: local backup, offline mode
  shared/    # HTTP layer, auth middleware, error types

migrations/
  postgres/  # PostgreSQL migrations
  sqlite/    # SQLite migrations (subset — no SaaS tables)
```

### 21.3 Compile-Time Feature Gates

```rust
#[cfg(feature = "saas")]
mod subscriptions;

#[cfg(feature = "saas")]
mod fbr_integration;

#[cfg(feature = "saas")]
mod feature_flags;
```

---

## 22. Search Architecture

### 22.1 Phase 1: PostgreSQL Full-Text Search

```sql
ALTER TABLE inventory_items ADD COLUMN search_vector tsvector
    GENERATED ALWAYS AS (
        to_tsvector('english',
            coalesce(name,'') || ' ' || coalesce(sku,'') || ' ' || coalesce(description,''))
    ) STORED;

CREATE INDEX idx_inventory_search ON inventory_items USING GIN(search_vector);
```

**Query pattern:**

```sql
SELECT * FROM inventory_items
WHERE company_id = $1
  AND deleted_at IS NULL
  AND search_vector @@ plainto_tsquery('english', $2)
ORDER BY ts_rank(search_vector, plainto_tsquery('english', $2)) DESC
LIMIT 20;
```

### 22.2 Phase 2: OpenSearch/Elasticsearch

When cross-entity search (invoices + customers + inventory simultaneously) or scale requires it. Sync via CDC (Debezium or write-through). Fallback to PostgreSQL FTS if cluster unavailable.

---

## 23. Historical Invoice & Bill Import System

### 23.1 Feature Overview

Allows Company Admins to import historical invoices, purchase bills, and inventory records from previous systems (spreadsheets, other ERPs, paper records via OCR).

**Business value: Critical.** The single biggest friction point in ERP migration is re-entering historical data. This feature directly determines onboarding success.

### 23.2 Supported Import Types

| Type            | Phase 1 Formats    | Phase 2 Formats          |
| --------------- | ------------------ | ------------------------ |
| Sales invoices  | CSV, Excel (.xlsx) | PDF, scanned image (OCR) |
| Purchase bills  | CSV, Excel (.xlsx) | PDF, scanned image       |
| Inventory items | CSV, Excel (.xlsx) | —                        |
| Customer list   | CSV, Excel (.xlsx) | —                        |
| Supplier list   | CSV, Excel (.xlsx) | —                        |

### 23.3 Import Pipeline Architecture

```
Upload file (CSV/Excel/PDF/image)
    ↓ §8.6 security pipeline (virus scan, MIME check)
    ↓ [If PDF/image] OCR extraction (Tesseract or AWS Textract)
    ↓ Field detection → fuzzy auto-mapping against alias dictionary
    ↓ Save company_import_template if new mapping
    ↓ Validation run (types, required fields, duplicates)
    ↓ Generate preview (first 50 rows + validation summary)
    ↓ User reviews and corrects field mapping
    ↓ User confirms import + selects conflict strategy
    ↓ Background job: batch insert with conflict handling
    ↓ SSE stream → frontend receives live progress
    ↓ Summary: imported / skipped / failed rows
    ↓ Import batch tagged on all records (enables rollback)
```

### 23.4 Database Tables

```sql
CREATE TABLE import_jobs (
    id UUID PRIMARY KEY,
    company_id UUID NOT NULL REFERENCES companies(id),
    created_by UUID NOT NULL REFERENCES users(id),
    import_type TEXT NOT NULL,
    source_format TEXT NOT NULL,
    file_path TEXT NOT NULL,
    original_filename TEXT NOT NULL,
    file_size_bytes BIGINT NOT NULL,
    status TEXT NOT NULL DEFAULT 'uploaded',
    -- uploaded → parsing → preview_ready → confirmed → processing → completed | failed
    field_mapping JSONB NOT NULL DEFAULT '{}',
    total_rows INTEGER,
    valid_rows INTEGER,
    imported_rows INTEGER,
    skipped_rows INTEGER,
    failed_rows INTEGER,
    error_summary JSONB NOT NULL DEFAULT '[]',
    rollback_available_until TIMESTAMP,    -- 24 hours after completion
    rolled_back_at TIMESTAMP,
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE import_row_errors (
    id UUID PRIMARY KEY,
    import_job_id UUID NOT NULL REFERENCES import_jobs(id) ON DELETE CASCADE,
    row_number INTEGER NOT NULL,
    field TEXT,
    raw_value TEXT,
    error_code TEXT NOT NULL,
    error_message TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE company_import_templates (
    id UUID PRIMARY KEY,
    company_id UUID NOT NULL REFERENCES companies(id),
    template_name TEXT NOT NULL,
    import_type TEXT NOT NULL,
    field_mapping JSONB NOT NULL,
    auto_detected_from TEXT,
    use_count INTEGER NOT NULL DEFAULT 0,
    last_used_at TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(company_id, import_type, template_name)
);
```

**Rollback tagging — all imported records carry the batch reference:**

```sql
ALTER TABLE invoices        ADD COLUMN import_batch_id UUID REFERENCES import_jobs(id);
ALTER TABLE inventory_items ADD COLUMN import_batch_id UUID REFERENCES import_jobs(id);
ALTER TABLE customers       ADD COLUMN import_batch_id UUID REFERENCES import_jobs(id);
```

### 23.5 Field Mapping UI

```
File columns detected:       Map to system field:
────────────────────────────────────────────────
"Buyer"          →  [Customer Name ▼]   95% confidence
"Amt"            →  [Total Amount  ▼]   88% confidence
"Inv #"          →  [Invoice Number ▼]  91% confidence
"Date"           →  [Invoice Date  ▼]   97% confidence
"[COLUMN_X]"     →  [Skip this column]
```

**Auto-mapping dictionary (common aliases):**

```json
{
  "customer_name": ["buyer", "client", "customer", "purchaser", "sold to"],
  "total_amount": ["amount", "total", "amt", "grand total", "bill amount"],
  "invoice_date": ["date", "inv date", "invoice date", "billing date"],
  "invoice_number": [
    "inv #",
    "invoice no",
    "invoice number",
    "ref",
    "reference"
  ]
}
```

Saved as `company_import_templates` for future imports — repeat uploads auto-map.

### 23.6 Validation Rules

| Rule                                     | Error Level                                        |
| ---------------------------------------- | -------------------------------------------------- |
| Required fields missing                  | Error — row skipped                                |
| Invoice number already exists            | Warning — user chooses: skip / overwrite / suffix  |
| Invalid date format                      | Error — row skipped                                |
| Total amount not parseable               | Error — row skipped                                |
| Customer not found                       | Warning — create new or skip                       |
| Tax amount > total amount                | Error — row skipped                                |
| FBR tenant: HS code missing (historical) | Warning only — historical invoices predate mandate |

### 23.7 Conflict Resolution

User selects before confirming:

```
  ○ Skip duplicates (default)
  ○ Overwrite duplicates
  ○ Create with suffix (INV-001 → INV-001-IMPORTED)
```

### 23.8 Batch Processing

Large imports run as background jobs. Live progress via SSE:

```json
{
  "job_id": "uuid",
  "status": "processing",
  "processed": 4500,
  "total": 10000,
  "imported": 4450,
  "skipped": 30,
  "failed": 20,
  "estimated_completion": "2026-05-21T11:45:00Z"
}
```

### 23.9 Post-Import Actions

1. Audit log: `action = 'data_import_completed'`
2. Notify Company Admin (§18.1)
3. Invalidate Redis counters + materialized views for analytics

### 23.10 Rate Limiting & Quotas

| Limit                        | Value   |
| ---------------------------- | ------- |
| Max file size                | 50 MB   |
| Max rows per job             | 100,000 |
| Concurrent jobs per company  | 1       |
| Jobs per hour per company    | 5       |
| Storage counted toward quota | Yes     |

### 23.11 ERP Migration Adapters

The import system supports a pre-built adapter registry for common ERP export formats. Adapters handle format-specific quirks (date formats, column naming conventions, encoding) automatically.

**Phase 1 (generic):** CSV and Excel with field mapping UI (ships with Phase 3).

**Phase 2 (named adapters):** Pre-configured field mappings for:

| ERP System                 | Export Format | Adapter Key         |
| -------------------------- | ------------- | ------------------- |
| QuickBooks Desktop         | IIF / CSV     | `quickbooks_csv`    |
| QuickBooks Online          | CSV           | `quickbooks_online` |
| Odoo                       | CSV export    | `odoo_csv`          |
| ERPNext                    | CSV export    | `erpnext_csv`       |
| MS Excel (generic invoice) | XLSX          | `excel_generic`     |
| Tally                      | CSV export    | `tally_csv`         |

When a user selects a named adapter, field mapping is pre-filled with near-zero manual work required. The adapter definitions are stored server-side and updatable without a code deployment.

### 23.12 Rollback Strategy

This is the critical safety net that makes the import system trustworthy.

**Rollback availability:** 24 hours after a completed import.

**Rollback mechanism:**

```sql
-- Rollback: delete all records tagged with this import_batch_id
-- Runs inside a transaction for atomicity

BEGIN;

DELETE FROM invoices        WHERE import_batch_id = $1;
DELETE FROM inventory_items WHERE import_batch_id = $1;
DELETE FROM customers       WHERE import_batch_id = $1;

UPDATE import_jobs
SET rolled_back_at = NOW(), status = 'rolled_back'
WHERE id = $1;

INSERT INTO audit_logs (action, resource_type, resource_id, actor_id)
VALUES ('import_rolled_back', 'import_job', $1, $2);

COMMIT;
```

**Constraints:**

- Rollback is blocked if any imported invoice has been subsequently modified (version > 1) or has received an FBR IRN — those records are now legally committed
- Partial rollback is not supported: all or nothing
- After 24 hours, the rollback option disappears from the UI and the `import_batch_id` index is dropped

**API:** `POST /api/v1/company/data-import/jobs/:id/rollback`

---

## 24. Future Enhancements

> This section documents the AI Intelligence Layer. It is **deliberately deferred** from the active roadmap. The architecture placeholders (`tenant_feature_flags`, `ai_insight_snapshots` table structure) are retained in the active schema so that when this layer ships, it plugs in without structural migration.
>
> **Why deferred:** AI requires 12–18 months of clean, organized transaction data to produce trustworthy outputs. The ERP Core must be in production and actively used first. Building the ML layer before the data pipeline is structurally backwards and dramatically increases development complexity with no benefit to the first cohort of customers.
>
> **When to revisit:** After the first 20–30 tenants have 12+ months of data in the system. At that point the model has something real to learn from.

### 24.1 Vision

```
ERP Core (Phases 1–2)
  Inventory · Invoices · FBR · Multi-tenancy
        ↓
Data Layer (Phase 3)
  Import · Accounting · Reporting
        ↓
Intelligence Layer (Future — §24)
  Rule-based Analytics → Forecasting → AI Assistant
```

The Intelligence Layer turns the ERP's transaction history into business recommendations. A scientific equipment supplier with 2 years of data can see:

- Microscope demand spikes 35% in Aug–Oct (semester start)
- Chemical Kit A has 8% gross margin (below threshold)
- Supplier X has 15-day average delay, increasing holding cost
- Recommended: increase microscope order by 20% in July

### 24.2 Phased Rollout

#### Phase A — Rule-Based Analytics (SQL only, no ML)

Pure aggregation queries surfaced as "insights." No Python service, no model training, no ML infrastructure. Ships as the first AI tier once sufficient tenant data exists.

**Insights produced:**

- Top 10 products by revenue (30 / 90 / 365 days)
- Products with > 20% sales decline vs prior period
- Low-margin products (below configurable threshold)
- Fast-moving inventory (stock turnover rate)
- Seasonal patterns (months with consistently high/low sales)
- Supplier delivery performance (avg days PO → receipt)

#### Phase B — Statistical Forecasting

Demand forecasting using Prophet or statsmodels ARIMA, via a Python microservice. Training runs nightly on a schedule — **never synchronously with user requests**.

```
Nightly job:
  For each eligible tenant (weighted sufficiency score passes §24.5):
    Load last 2 years of transaction data
    Train/update Prophet model
    Generate 90-day forecast
    Store in forecast_cache
    Notify tenant if forecast has changed materially
```

#### Phase C — AI Assistant (Natural Language)

User asks: _"What should I order next month?"_ System responds with structured, explainable recommendations backed by Phase A + B outputs.

Gated behind separate feature flag `ai_assistant`. Requires explicit tenant opt-in because data is sent to an external LLM API.

### 24.3 Training Architecture (Event-Driven)

**Critical constraint:** Training must never block user requests or run on-demand per user action.

```
New invoice committed
    ↓
Queue event: company:{id}:data_changed
    ↓
Nightly training worker picks up all changed companies
    ↓
Train/update model → store predictions in forecast_cache
    ↓
Dashboard reads forecast_cache — never triggers training
```

```sql
CREATE TABLE forecast_cache (
    id UUID PRIMARY KEY,
    company_id UUID NOT NULL REFERENCES companies(id),
    item_id UUID REFERENCES inventory_items(id),
    category TEXT,
    forecast_period_start DATE NOT NULL,
    forecast_period_end DATE NOT NULL,
    predicted_quantity DECIMAL(15,4) NOT NULL,
    confidence_low DECIMAL(15,4),
    confidence_high DECIMAL(15,4),
    model_version TEXT NOT NULL,
    generated_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(company_id, item_id, forecast_period_start)
);
```

### 24.4 Model Registry

Enables auditability when predictions change.

```sql
CREATE TABLE model_registry (
    id UUID PRIMARY KEY,
    company_id UUID NOT NULL REFERENCES companies(id),
    model_type TEXT NOT NULL,           -- 'prophet', 'arima', 'rule_based'
    model_version TEXT NOT NULL,
    accuracy_score DECIMAL(5,4),        -- MAPE or similar
    training_data_hash TEXT NOT NULL,   -- Hash of training dataset for reproducibility
    training_period_start DATE NOT NULL,
    training_period_end DATE NOT NULL,
    trained_at TIMESTAMP NOT NULL DEFAULT NOW(),
    superseded_at TIMESTAMP             -- When this version was replaced
);
```

When a prediction changes between model versions, the system can show: "Forecast updated — accuracy improved from 71% to 84% using 6 additional months of data."

### 24.5 Weighted Data Sufficiency Score

Replaces the fixed 500-invoice threshold. A high-value low-volume business (e.g. scientific equipment: 40 invoices/month, PKR 2M average order) has more predictive signal than a fixed threshold implies.

```
sufficiency_score =
    (transaction_count / 200) × 0.30    -- volume component (max weight at 200+)
  + (months_of_history / 12) × 0.35     -- history component (max weight at 12+ months)
  + (unique_products / 10) × 0.15       -- diversity component (max at 10+ products)
  + (revenue_consistency) × 0.20        -- regularity component (low CoV = high score)

Thresholds:
  score >= 0.7  →  Full ML forecasting enabled
  score >= 0.4  →  Rule-based analytics only
  score < 0.4   →  "Insufficient data" message
```

### 24.6 Anonymization Proxy

For Phase C (AI assistant using external LLM), product and customer names are never sent in plaintext to the external API.

```
User: "What should I order next month?"

Backend:
  Build context with anonymized names:
    "Microscope-XJ900" → "ITEM_A1F3"
    "ABC School"       → "CUST_B2E7"

LLM receives:
  "ITEM_A1F3 demand is up 35%..."

LLM returns:
  "Increase ITEM_A1F3 stock by 20%"

Backend remaps before returning to user:
  "Increase Microscope-XJ900 stock by 20%"
```

The mapping table is held in memory for the duration of the request and never persisted. The LLM provider never sees real product names or customer identities.

### 24.7 Recommendation Explainability Schema

Every AI recommendation must carry its reasoning. Unexplained recommendations are not acted on.

```json
{
  "recommendation": "Increase Microscope-XJ900 stock by 20% before August",
  "confidence": 0.84,
  "reasons": [
    {
      "factor": "seasonal_demand",
      "description": "Microscope sales historically increase 35% in Aug–Oct",
      "data_points": 3,
      "supporting_months": ["Aug 2024", "Aug 2023", "Sep 2023"]
    },
    {
      "factor": "supplier_lead_time",
      "description": "Supplier X average lead time: 15 days",
      "recommendation_adjustment": "Order 2 weeks earlier"
    },
    {
      "factor": "current_stock",
      "description": "Current stock: 12 units. At historical Aug rate: covers 8 days",
      "urgency": "high"
    }
  ],
  "generated_at": "2026-05-21T02:00:00Z",
  "model_version": "prophet_v3",
  "accuracy_score": 0.84
}
```

### 24.8 Privacy Requirements (Phase C)

- All ML models are per-tenant; no cross-tenant data
- Phase C (LLM assistant): anonymization proxy mandatory (§24.6)
- Tenant must explicitly opt in; opt-in stored with timestamp and user ID
- All LLM calls logged in `audit_logs` with `action = 'ai_assistant_query'`
- Tenant can withdraw consent; system ceases LLM calls immediately

---

## Appendix A: Architecture Risk Register [v5.1]

| Risk                                        | Severity | Mitigation                                                             | Status               |
| ------------------------------------------- | -------- | ---------------------------------------------------------------------- | -------------------- |
| Cross-tenant data leak                      | Critical | RLS §8.1 + company_id filter                                           | ✅ Mitigated         |
| Module disable not taking effect            | Critical | Permission cache §3.17, JWT modules removed                            | ✅ Mitigated         |
| Duplicate invoice numbers under concurrency | Critical | SELECT FOR UPDATE §3.14                                                | ✅ Mitigated         |
| Subscription check race condition           | Critical | Transaction-scoped validation §9.1                                     | ✅ Mitigated         |
| FBR non-compliance                          | Critical | PRAL integration §17                                                   | ✅ Mitigated         |
| Invoice legally invalid without IRN         | Critical | Lifecycle gate §10.1                                                   | ✅ Mitigated         |
| Super admin unaudited access                | Critical | Audit logging §8.2                                                     | ✅ Mitigated         |
| Accidental company data wipe                | Critical | Soft deletes + RESTRICT FK                                             | ✅ Mitigated         |
| Malicious file upload                       | Critical | Upload pipeline §8.6                                                   | ✅ Mitigated         |
| Import corrupts existing data               | High     | Rollback §23.12, conflict resolution §23.7, preview §23.3              | ✅ Mitigated         |
| Concurrent edit data loss                   | High     | Optimistic locking §8.10                                               | ✅ Mitigated         |
| JWT still valid after revoke                | High     | token_version + permission cache bust                                  | ✅ Mitigated         |
| Privilege escalation via roles              | High     | Permission inheritance §8.4                                            | ✅ Mitigated         |
| API brute force                             | High     | Rate limiting §8.5                                                     | ✅ Mitigated         |
| PRAL downtime breaks invoicing              | High     | Retry queue §17.4                                                      | ✅ Mitigated         |
| Slow queries as data grows                  | High     | Archival §8.11, search §22, partial indexes                            | ✅ Mitigated         |
| SQLite/PostgreSQL feature drift             | High     | Formal mode separation §21                                             | ✅ Mitigated         |
| PDPB/GDPR rights                            | High     | §16.2, §16.3                                                           | ⚠️ Planned           |
| Backup/DR                                   | High     | Phase 5                                                                | ⚠️ Planned           |
| No testing strategy                         | High     | §18.9                                                                  | ⚠️ Planned           |
| Analytics query performance                 | Medium   | Hybrid Redis + materialized views §11.3                                | ✅ Mitigated         |
| Storage limit unenforced                    | Medium   | company_storage_usage + upload check                                   | ✅ Mitigated         |
| No notification system                      | Medium   | §18.1                                                                  | ⚠️ Planned           |
| GDPR data residency                         | Medium   | Infrastructure decision §16.3                                          | ❓ Decision required |
| CORS policy undefined                       | Medium   | Phase 5                                                                | ⚠️ Planned           |
| Supply-chain security                       | Medium   | cargo audit in CI (release.yml)                                        | ✅ Implemented       |
| AI model bad predictions (future)           | Medium   | Weighted sufficiency §24.5, explainability §24.7, phased rollout §24.2 | 🔮 Documented        |
| Multi-currency support                      | Medium   | Future                                                                 | ⏳ Deferred          |
| Tenant sharding                             | Low      | Future                                                                 | ⏳ Deferred          |
| Multi-region failover                       | Low      | Future                                                                 | ⏳ Deferred          |
| JSONB feature drift in packages             | Low      | Normalize when feature set stabilises                                  | ⏳ Deferred          |
