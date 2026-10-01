# Future Features — Post v1.0 Roadmap

> Extracted from SAAS_SPECIFICATION.md §24 and the Architecture Risk Register.
> This file is the single source of truth for features deferred beyond v1.0.

---

## 1. AI Intelligence Layer (§24)

The intelligence layer is deliberately deferred because it requires 12–18
months of clean, organized transaction data from 20–30 active tenants before
models can produce trustworthy outputs.

### 1.1 Phased Rollout

| Phase | Capability | Stack | Prerequisite |
|-------|-----------|-------|-------------|
| **A** | Rule-based analytics | Pure SQL aggregation, no ML | Clean data for 6+ months |
| **B** | Statistical forecasting | Prophet/ARIMA via Python microservice, nightly training | Phase A stable |
| **C** | AI Assistant | Natural-language recommendations backed by external LLM, opt-in | Phase B + privacy audit |

### 1.2 Key Design Decisions

- **Event-driven training** — nightly batch, never synchronous with user requests.
- **Model registry** — every model version tracked with accuracy scores, training
  data hashes, and supersession history (§24.4).
- **Weighted data sufficiency score** — replaces fixed 500-invoice threshold with a
  weighted formula: transaction count, history length, product diversity, revenue
  consistency (§24.5).
- **Anonymization proxy** (Phase C) — product/customer names replaced with tokens
  before LLM calls; mapping held in-memory only (§24.6).
- **Explainability** — every recommendation carries structured reasoning (factors,
  data points, confidence scores). Unexplained recommendations cannot be acted on
  (§24.7).
- **Privacy** — all ML models per-tenant (no cross-tenant data), LLM calls require
  explicit opt-in, all queries audit-logged, tenants can withdraw consent (§24.8).

---

## 2. Multi-Currency Support (Status: Shipped in v1.0.8)

Landed in migration `018` and `src-tauri/src/commands/currency.rs`:
- Per-company base currency configuration (50+ currencies seeded in `currency_config`).
- Real-time exchange-rate feed integration via `exchangerate-api.com`.
- Multi-currency invoices with automatic conversion for P&L reporting.
- Foreign exchange gain/loss journal entries (`7000`/`7100`) posted automatically.

---

## 3. Tenant Sharding & Multi-Region (Status: Deferred to Cloud SaaS)

- Logical tenant sharding for SaaS deployment (separate database schemas per tenant group).
- Multi-region failover with read replicas.
- GDPR data-residency compliance (data stays in the tenant's region).

---

## 4. ERP Migration Adapters (Status: Shipped in v1.0.8)

Landed in `src-tauri/src/commands/import_wizard.rs`:
- Pre-built header vocabulary and field-mapping adapters for QuickBooks, Odoo, ERPNext, Tally, and Excel.
- Auto-detect template mapping on file upload with rollback support.

---

## 5. Plugin SDK (Status: Post-v1.0 Roadmap)

A plugin system allowing third-party extensions. See
[PLUGIN_SDK_SPEC.md](PLUGIN_SDK_SPEC.md) for the full specification.

---

## 6. Module Enablement via Feature Flags (Status: Shipped in v1.0.8 / v1.3.0)

Landed in migration `019`, `company.rs`, and UI Settings:
- 8 seeded modules (`inventory`, `invoices`, `purchase_orders`, `reports`, `ledger`, `users`, `settings`, `data_import`).
- Owner toggle via Settings → Modules and sidebar dynamic filtering.
- Full parity across migration seed, Rust command validation, and frontend module dictionaries.

---

*Last updated: 2026-10-01 (v1.3.0 Parity Refresh)*

