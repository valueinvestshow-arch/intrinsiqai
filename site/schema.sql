-- Run once: Cloudflare dashboard → Storage & Databases → D1 → intrinsiqai-waitlist → Console → paste → Execute.
-- The database is only reachable through this website's server functions; there is no public read access.

CREATE TABLE IF NOT EXISTS waitlist (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  email          TEXT NOT NULL UNIQUE CHECK (length(email) <= 254),
  current_method TEXT CHECK (current_method IS NULL OR length(current_method) <= 80),
  source         TEXT CHECK (source IS NULL OR source IN ('hero', 'final')),
  consent        INTEGER NOT NULL CHECK (consent = 1),
  consent_text   TEXT NOT NULL CHECK (length(consent_text) <= 300),
  consent_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  created_at     TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_waitlist_created ON waitlist (created_at);

-- Handy queries (same Console):
--   SELECT COUNT(*) FROM waitlist;
--   SELECT date(created_at) AS day, COUNT(*) FROM waitlist GROUP BY 1 ORDER BY 1 DESC;
-- Delete someone on request (GDPR right to erasure):
--   DELETE FROM waitlist WHERE email = 'person@example.com';
