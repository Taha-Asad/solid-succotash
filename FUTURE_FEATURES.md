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

## 2. Multi-Currency Support

Current system operates in a single currency (PKR by default). Future phases
will add:

- Per-company base currency configuration.
- Real-time exchange-rate feed integration.
- Multi-currency invoices with automatic conversion for P&L reporting.
- Currency-gain/loss journal entries.

---

## 3. Tenant Sharding & Multi-Region

- Logical tenant sharding for SaaS deployment (separate database schemas per
  tenant group).
- Multi-region failover with read replicas.
- GDPR data-residency compliance (data stays in the tenant's region).

---

## 4. ERP Migration Adapters

Adapters to import data from other popular ERP systems:

- QuickBooks Online / Desktop.
- Odoo (CSV/XML export).
- SAP Business One (B1IF or CSV).
- Tally ERP 9 (XML).

Each adapter implements a common `MigrationAdapter` trait with `discover`,
`map`, and `import` phases.

---

## 5. Plugin SDK

A plugin system allowing third-party extensions. See
[PLUGIN_SDK_SPEC.md](PLUGIN_SDK_SPEC.md) for the full specification.

---

## 6. Module Enablement via Feature Flags

The schema already supports per-company module and feature flags
(SAAS_SPECIFICATION.md §4). Future work:

- Self-serve module toggle in company admin dashboard.
- Usage-based pricing tiers tied to active module count.
- Module dependency resolution (e.g., `reports` requires `invoices`).

---

*Last updated: 2026-08-18*
