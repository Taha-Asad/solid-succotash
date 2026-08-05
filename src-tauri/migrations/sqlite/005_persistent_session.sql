-- ==========================================
-- Migration 005: PERSISTENT SESSION
-- ==========================================
--
-- Stores the current login session so it survives app restarts.
-- Only ONE row ever exists (the current session).

CREATE TABLE IF NOT EXISTS app_session (
    id          TEXT PRIMARY KEY DEFAULT 'current',
    user_id     TEXT NOT NULL,
    saved_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
