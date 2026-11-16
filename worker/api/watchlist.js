// A signed-in person's saved valuations.
//   GET    /api/watchlist            -> every saved stock
//   PUT    /api/watchlist/:ticker    -> save or replace one  {buy_below, data}
//   DELETE /api/watchlist/:ticker    -> remove one
// Subscribers only. Enforced here, not in the page.
import { json, sameSite, readJson, currentUser, isSubscribed } from "../lib.js";

const needSub = () => json({ error: "BuyBelow needs a subscription.", subscribe: true }, 402);

const TICKER = /^[A-Z0-9][A-Z0-9.\-]{0,11}$/;

export async function list({ request, env }) {
  const user = await currentUser(request, env);
  if (!user) return json({ error: "Sign in first." }, 401);
  if (!isSubscribed(user)) return needSub();
  const { results } = await env.DB.prepare("SELECT ticker, buy_below, alerted_at, data, updated_at FROM watchlist WHERE user_id = ?1 ORDER BY ticker").bind(user.id).all();
  return json({ items: results.map((r) => ({ ticker: r.ticker, buy_below: r.buy_below, alerted_at: r.alerted_at, updated_at: r.updated_at, data: JSON.parse(r.data) })) });
}

export async function save({ request, env }, ticker) {
  if (!sameSite(request)) return json({ error: "Not allowed." }, 403);
  const user = await currentUser(request, env);
  if (!user) return json({ error: "Sign in first." }, 401);
  ticker = String(ticker || "").toUpperCase();
  if (!TICKER.test(ticker)) return json({ error: "Unknown ticker." }, 400);
  if (!isSubscribed(user)) return needSub();

  const body = await readJson(request, 12288);
  if (!body || typeof body.data !== "object" || body.data === null) return json({ error: "Nothing to save." }, 400);
  const data = JSON.stringify(body.data);
  if (data.length > 8192) return json({ error: "That valuation is too large to save." }, 413);
  const buyBelow = Number.isFinite(body.buy_below) && body.buy_below > 0 ? body.buy_below : null;

  // A changed buy price re-arms the alert.
  await env.DB.prepare(
    "INSERT INTO watchlist (user_id, ticker, buy_below, data) VALUES (?1, ?2, ?3, ?4) ON CONFLICT (user_id, ticker) DO UPDATE SET buy_below = excluded.buy_below, data = excluded.data, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), alerted_at = CASE WHEN watchlist.buy_below IS excluded.buy_below THEN watchlist.alerted_at ELSE NULL END"
  ).bind(user.id, ticker, buyBelow, data).run();
  return json({ ok: true });
}

export async function remove({ request, env }, ticker) {
  if (!sameSite(request)) return json({ error: "Not allowed." }, 403);
  const user = await currentUser(request, env);
  if (!user) return json({ error: "Sign in first." }, 401);
  await env.DB.prepare("DELETE FROM watchlist WHERE user_id = ?1 AND ticker = ?2").bind(user.id, String(ticker || "").toUpperCase()).run();
  return json({ ok: true });
}
