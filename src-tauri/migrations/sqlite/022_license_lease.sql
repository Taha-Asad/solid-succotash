-- Migration 022: License Lease and Device Binding Table
CREATE TABLE IF NOT EXISTS _license_lease (
    id                  INTEGER PRIMARY KEY CHECK (id = 1), -- Single row invariant
    license_key         TEXT NOT NULL,
    client_name         TEXT NOT NULL,
    device_hwid         TEXT NOT NULL,
    lease_token         TEXT NOT NULL,
    last_verified_at    TEXT NOT NULL,
    grace_expires_at    TEXT NOT NULL,
    license_expires_at  TEXT,
    status              TEXT NOT NULL DEFAULT 'active',
    monotonic_counter   INTEGER NOT NULL DEFAULT 0
);
