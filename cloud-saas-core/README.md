# Corbel Cloud — Standalone Multi-Tenant SuperAdmin Architecture

This directory preserves the cloud multi-tenant control plane extracted from the single-tenant desktop ERP.

## Architecture & Deployment Model

The Corbel platform follows a clean **Hub-and-Spoke** architecture:

1. **The Desktop Spoke (Corbel Desktop)**:
   - Single-tenant, offline-first desktop ERP running on local SQLite.
   - Used by shopkeepers/merchants for local point-of-sale, inventory, customer khata, thermal printing, and FBR invoicing.
   - Clean of any cross-tenant platform control plane or fake local superadmin.

2. **The Cloud Hub (This Service)**:
   - Centralized SaaS Web Application running on a cloud server (Next.js / Axum / PostgreSQL).
   - Responsible for:
     - Multi-tenant shop registration & onboarding.
     - Subscription package definitions & billing (Stripe / JazzCash / EasyPaisa / Wire).
     - Global platform analytics & telemetry (aggregate MRR, active installations).
     - Remote feature flag toggles & module activations.
     - Hosting the auto-updater release endpoint (`tauri-plugin-updater`).

## Contents

- `backend/saas/`: Rust command handlers for packages, subscriptions, tenant companies, feature flags, and MRR analytics.
- `backend/setup.rs`: First-time cloud super-admin seeding logic.
- `frontend/superadmin/`: Complete React/Mantine SuperAdmin UI (TenantsPage, PackagesPage, PlatformAnalyticsPage, PlatformOverviewPage, SuperAdminShell).
