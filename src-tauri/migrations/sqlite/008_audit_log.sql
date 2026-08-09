-- ==========================================
-- Migration 008: AUDIT LOG
-- ==========================================
--
-- Records every mutating action for compliance (PECA §16.2).
-- Never deleted. Append-only.

CREATE TABLE IF NOT EXISTS audit_logs (
    id          TEXT PRIMARY KEY,
    company_id  TEXT NOT NULL,
    user_id     TEXT NOT NULL,
    user_email  TEXT NOT NULL,
    user_role   TEXT NOT NULL,
    action      TEXT NOT NULL,      -- 'create', 'update', 'delete', 'finalize', 'import', 'login', 'logout', 'backup', 'restore'
    resource    TEXT NOT NULL,      -- 'product', 'invoice', 'user', 'company', 'po', 'stock', 'session'
    resource_id TEXT,               -- the ID of the affected record
    details     TEXT,               -- JSON with old/new values or description
    ip_address  TEXT,
    created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_company
ON audit_logs(company_id, created_at);

CREATE INDEX IF NOT EXISTS idx_audit_user
ON audit_logs(user_id, created_at);

CREATE INDEX IF NOT EXISTS idx_audit_resource
ON audit_logs(resource, resource_id);

CREATE INDEX IF NOT EXISTS idx_audit_action
ON audit_logs(company_id, action, created_at);
