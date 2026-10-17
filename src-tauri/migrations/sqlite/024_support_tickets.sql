-- Migration 024: Support Tickets & Threaded Messages (SAAS_SPECIFICATION.md v5.2 §3.4)
-- Provides in-app support, billing, and upgrade helpdesk between tenants and Super Admin.

CREATE TABLE IF NOT EXISTS tickets (
    id          TEXT PRIMARY KEY,
    company_id  TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    created_by  TEXT NOT NULL REFERENCES users(id),
    subject     TEXT NOT NULL,
    category    TEXT NOT NULL DEFAULT 'issue' CHECK(category IN ('complaint','recommendation','issue','feature_request','billing','other')),
    priority    TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('low','normal','high','urgent')),
    status      TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','in_progress','resolved','closed')),
    assigned_to TEXT REFERENCES users(id),
    created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    resolved_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_tickets_company_id ON tickets(company_id);
CREATE INDEX IF NOT EXISTS idx_tickets_status ON tickets(status);

CREATE TABLE IF NOT EXISTS ticket_messages (
    id          TEXT PRIMARY KEY,
    ticket_id   TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
    user_id     TEXT NOT NULL REFERENCES users(id),
    sender_name TEXT NOT NULL DEFAULT '',
    sender_role TEXT NOT NULL DEFAULT '',
    message     TEXT NOT NULL,
    attachments TEXT NOT NULL DEFAULT '[]',
    created_at  TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_ticket_messages_ticket_id ON ticket_messages(ticket_id);
