// Share prices from Twelve Data, cached in D1 so each stock costs at most one lookup an hour.
// The key is the TWELVEDATA_API_KEY secret. Free plan: 8 lookups a minute, 800 a day, so nothing here
// fetches the whole market; prices are fetched when someone opens a company, and for stocks on a watchlist.

const FRESH_MS = 60 * 60 * 1000;          // reuse a cached price for an hour
export const BATCH = 8;                   // most symbols in one request on the free plan
const DAILY_BUDGET = 600;                 // lookups the scheduled job may spend a day, leaving room for people

const toVendor = (ticker) => ticker.replace("-", ".");   // SEC writes BRK-B, the price feed BRK.B

function parseQuote(q) {
  if (!q || q.status === "error" || q.code) return null;
  const price = parseFloat(q.close), pct = parseFloat(q.percent_change);
  if (!(price > 0)) return null;
  return { price, change_pct: Number.isFinite(pct) ? pct : null, as_of: String(q.datetime || "").slice(0, 10) || null };
}

// Fetch up to BATCH tickers in one request. Returns {ticker: quote} for the ones that came back.
async function fetchQuotes(env, tickers) {
  if (!env.TWELVEDATA_API_KEY || !tickers.length) return {};
  const url = "https://api.twelvedata.com/quote?symbol=" + encodeURIComponent(tickers.map(toVendor).join(","));
  let body;
  try {
    const res = await fetch(url, { headers: { Authorization: "apikey " + env.TWELVEDATA_API_KEY } });
    body = await res.json();
  } catch { return {}; }
  const out = {};
  if (tickers.length === 1) { const q = parseQuote(body); if (q) out[tickers[0]] = q; return out; }
  for (const t of tickers) { const q = parseQuote(body && body[toVendor(t)]); if (q) out[t] = q; }
  return out;
}

async function store(env, quotes) {
  const now = new Date().toISOString(), rows = Object.entries(quotes);
  if (!rows.length) return;
  await env.DB.batch(rows.map(([t, q]) => env.DB.prepare(
    "INSERT INTO prices (ticker, price, change_pct, as_of, fetched_at) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT (ticker) DO UPDATE SET price = excluded.price, change_pct = excluded.change_pct, as_of = excluded.as_of, fetched_at = excluded.fetched_at"
  ).bind(t, q.price, q.change_pct, q.as_of, now)));
}

const shape = (row, stale) => ({ ticker: row.ticker, price: row.price, change_pct: row.change_pct, as_of: row.as_of, stale });

// One price, fetched if the cached one is older than an hour. Falls back to the cached price if the feed says no.
export async function getPrice(env, ticker) {
  const row = await env.DB.prepare("SELECT ticker, price, change_pct, as_of, fetched_at FROM prices WHERE ticker = ?1").bind(ticker).first();
  if (row && Date.now() - Date.parse(row.fetched_at) < FRESH_MS) return shape(row, false);
  const got = await fetchQuotes(env, [ticker]);
  if (got[ticker]) { await store(env, got); return { ticker, ...got[ticker], stale: false }; }
  return row ? shape(row, true) : null;
}

// Cached prices only, for drawing a watchlist without spending lookups.
export async function cachedPrices(env, tickers) {
  if (!tickers.length) return [];
  const marks = tickers.map((_, i) => "?" + (i + 1)).join(",");
  const { results } = await env.DB.prepare(`SELECT ticker, price, change_pct, as_of FROM prices WHERE ticker IN (${marks})`).bind(...tickers).all();
  return results.map((r) => shape(r, false));
}

// ---- Scheduled job: refresh the stalest watchlist prices, then email anyone whose buy price was reached ----
async function sendEmail(env, to, subject, text, html) {
  if (!env.RESEND_API_KEY) return false;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: env.EMAIL_FROM_ALERTS || "BuyBelow <alerts@buybelow.io>", to: [to], subject, text, html }),
    });
    return res.ok;
  } catch { return false; }
}

export async function runPriceJob(env) {
  if (!env.DB || !env.TWELVEDATA_API_KEY) return { skipped: "not configured" };
  const day = new Date().toISOString().slice(0, 10), key = "price_job_spend_" + day;
  const spent = (await env.DB.prepare("SELECT value FROM meta WHERE key = ?1").bind(key).first())?.value || 0;
  if (spent >= DAILY_BUDGET) return { skipped: "daily budget used" };

  // Watchlist stocks whose price is missing or more than 20 hours old, stalest first.
  const cutoff = new Date(Date.now() - 20 * 3600e3).toISOString();
  const { results } = await env.DB.prepare(
    "SELECT w.ticker FROM watchlist w LEFT JOIN prices p ON p.ticker = w.ticker WHERE p.fetched_at IS NULL OR p.fetched_at < ?1 GROUP BY w.ticker ORDER BY MIN(COALESCE(p.fetched_at, '')) LIMIT ?2"
  ).bind(cutoff, BATCH).all();
  const tickers = results.map((r) => r.ticker);
  if (!tickers.length) return { refreshed: 0, alerts: 0 };

  const quotes = await fetchQuotes(env, tickers);
  await store(env, quotes);
  await env.DB.prepare("INSERT INTO meta (key, value) VALUES (?1, ?2) ON CONFLICT (key) DO UPDATE SET value = value + excluded.value").bind(key, tickers.length).run();

  // Buy price reached and not yet emailed. alerted_at is only set once the email has gone, so nothing is lost if sending fails.
  let alerts = 0;
  for (const [ticker, q] of Object.entries(quotes)) {
    const due = await env.DB.prepare(
      "SELECT w.user_id, w.buy_below, w.data, u.email FROM watchlist w JOIN users u ON u.id = w.user_id WHERE w.ticker = ?1 AND w.buy_below IS NOT NULL AND w.alerted_at IS NULL AND w.buy_below >= ?2 AND u.plan = 'premium'"
    ).bind(ticker, q.price).all();
    for (const row of due.results) {
      let d = {}; try { d = JSON.parse(row.data); } catch {}
      const name = d.name || ticker, base = d.values && d.values.base ? d.values.base.iv : null, money = (v) => "$" + Number(v).toFixed(2);
      const lines = [`${name} (${ticker}) closed at ${money(q.price)}, at or below your buy price of ${money(row.buy_below)}.`];
      if (base) lines.push(`Your base-case value is ${money(base)}.`);
      if (d.thesis) lines.push(`Your thesis: ${String(d.thesis).slice(0, 600)}`);
      lines.push("Check the latest results still support your assumptions before acting.", "https://buybelow.io/app", "BuyBelow is a research tool, not investment advice.");
      const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
      const sent = await sendEmail(env, row.email, `${ticker} hit your buy price at ${money(q.price)}`, lines.join("\n\n"), lines.map((l) => `<p>${esc(l)}</p>`).join(""));
      if (sent) { await env.DB.prepare("UPDATE watchlist SET alerted_at = ?1 WHERE user_id = ?2 AND ticker = ?3").bind(new Date().toISOString(), row.user_id, ticker).run(); alerts++; }
    }
  }
  return { refreshed: Object.keys(quotes).length, alerts };
}
