-- ==========================================
-- Migration 011: THEME & BRANDING SETTINGS
-- ==========================================
--
-- Each company can customize:
--   - Primary color (buttons, highlights)
--   - Secondary / accent colors
--   - Color scheme (light/dark/auto)
--   - Company logo (base64 or file path)
--   - Company tagline and ERP watermark text
--
-- Defaults match the current app theme (src/theme.ts):
--   primary   -> navy   #1D2B54 (brand[8] — buttons, headers, active)
--   secondary -> soft navy #2E4178 (navySoft)
--   accent    -> gold   #C9952A (gold[5] — highlights, emphasis)
--   scheme    -> light (app is forceColorScheme="light")

CREATE TABLE IF NOT EXISTS company_theme (
    company_id      TEXT PRIMARY KEY,

    -- Colors (hex values like "#2563eb")
    primary_color   TEXT NOT NULL DEFAULT '#1D2B54',
    secondary_color TEXT NOT NULL DEFAULT '#2E4178',
    accent_color    TEXT NOT NULL DEFAULT '#C9952A',

    -- Scheme
    color_scheme    TEXT NOT NULL DEFAULT 'light'
                        CHECK (color_scheme IN ('light', 'dark', 'auto')),

    -- Branding
    logo_path       TEXT,           -- file path to company logo
    logo_base64     TEXT,           -- base64-encoded logo (small images)
    company_tagline TEXT,           -- e.g. "Quality Electronics Since 2020"

    -- ERP watermark (shown in footer, small text)
    erp_watermark   TEXT NOT NULL DEFAULT 'Powered by Ijaz & Company ERP',

    created_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_company_theme_scheme
ON company_theme(color_scheme);
