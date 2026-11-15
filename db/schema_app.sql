-- Accounts and watchlists for the BuyBelow app. Run once on the D1 database, after db/schema.sql.
-- Nothing here stores a password: people sign in with a link sent to their email.

CREATE TABLE IF NOT EXISTS users (
  id         TEXT PRIMARY KEY,                                   -- random id, never the email
  email      TEXT NOT NULL UNIQUE CHECK (length(email) <= 254),
  plan       TEXT NOT NULL DEFAULT 'free' CHECK (plan IN ('free', 'premium')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- One-time sign-in links. Only a hash of the token is kept, so a leaked database cannot be used to sign in.
CREATE TABLE IF NOT EXISTS login_tokens (
  token_hash TEXT PRIMARY KEY,
  email      TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at TEXT NOT NULL,
  used_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_login_tokens_email ON login_tokens (email, created_at);

-- Signed-in browsers. Again only a hash of the session token is stored.
CREATE TABLE IF NOT EXISTS sessions (
  id_hash    TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);

-- One saved valuation per person per stock.
CREATE TABLE IF NOT EXISTS watchlist (
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  ticker     TEXT NOT NULL CHECK (length(ticker) <= 12),
  buy_below  REAL,                                               -- the price that triggers the email
  alerted_at TEXT,                                               -- when the email was last sent, so it is sent once
  data       TEXT NOT NULL CHECK (length(data) <= 8192),         -- the saved cases, assumptions and thesis, as JSON
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (user_id, ticker)
);
