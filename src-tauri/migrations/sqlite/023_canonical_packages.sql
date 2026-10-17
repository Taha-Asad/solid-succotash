-- =============================================================================
-- Migration 023: Canonical Commercial Package Tiers (SAAS_SPECIFICATION v5.2 §4.3)
-- =============================================================================
-- Aligns local SQLite packages with Neon Cloud and SAAS_SPECIFICATION.md v5.2:
--   - pkg-basic    (Basic):    3,400 PKR / month (5 users, 1 branch, 512 MB)
--   - pkg-standard (Standard): 4,200 PKR / month (15 users, 3 branches, 2048 MB)
--   - pkg-premium  (Premium):  6,000 PKR / month (100 users, 10 branches, 10240 MB)
-- Also deactivates legacy pkg-starter / pkg-pro / pkg-enterprise rows if unused.

INSERT INTO packages
    (id, name, description, price, billing_cycle, module_limits,
     max_users, max_branches, max_storage_mb, features, is_active, sort_order)
VALUES
    ('pkg-basic',
     'Basic',
     'Single branch, 5 users, core ERP modules.',
     3400,
     'monthly',
     '{"dashboard":1,"inventory":1,"sales":1,"purchases":1,"reports":1,"employees":1,"branches":0,"invoices":1,"import":0}',
     5, 1, 512,
     '{"fbr":false,"data_import":false}',
     1, 1),

    ('pkg-standard',
     'Standard',
     'Up to 3 branches, 15 users, import + invoice customization.',
     4200,
     'monthly',
     '{"dashboard":1,"inventory":1,"sales":1,"purchases":1,"reports":1,"employees":1,"branches":1,"invoices":1,"import":1,"data_import":1}',
     15, 3, 2048,
     '{"fbr":false,"data_import":true}',
     1, 2),

    ('pkg-premium',
     'Premium',
     'Up to 10 branches, 100 users, FBR compliance, priority support.',
     6000,
     'monthly',
     '{"dashboard":1,"inventory":1,"sales":1,"purchases":1,"reports":1,"employees":1,"branches":1,"invoices":1,"import":1,"data_import":1}',
     100, 10, 10240,
     '{"fbr":true,"data_import":true}',
     1, 3)
ON CONFLICT(id) DO UPDATE SET
    name = excluded.name,
    description = excluded.description,
    price = excluded.price,
    billing_cycle = excluded.billing_cycle,
    module_limits = excluded.module_limits,
    max_users = excluded.max_users,
    max_branches = excluded.max_branches,
    max_storage_mb = excluded.max_storage_mb,
    features = excluded.features,
    is_active = 1,
    sort_order = excluded.sort_order,
    updated_at = datetime('now');

-- Soft-deactivate legacy starter/pro/enterprise IDs if no subscription references them
UPDATE packages
SET is_active = 0,
    updated_at = datetime('now')
WHERE id IN ('pkg-starter', 'pkg-pro', 'pkg-enterprise')
  AND id NOT IN (SELECT DISTINCT package_id FROM company_subscriptions);
