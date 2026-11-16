// Share prices for subscribers.
//   GET /api/price/:ticker          -> the latest price, fetched if the cached one is over an hour old
//   GET /api/prices?tickers=A,B,C   -> cached prices only (for the watchlist)
import { json, currentUser, isSubscribed } from "../lib.js";
import { getPrice, cachedPrices } from "../prices.js";

const TICKER = /^[A-Z0-9][A-Z0-9.\-]{0,11}$/;
const SOURCE = "Twelve Data";

async function subscriber(request, env) {
  const user = await currentUser(request, env);
  if (!user) return json({ error: "Sign in first." }, 401);
  if (!isSubscribed(user)) return json({ error: "BuyBelow needs a subscription.", subscribe: true }, 402);
  return null;
}

export async function one({ request, env }, ticker) {
  const refused = await subscriber(request, env); if (refused) return refused;
  ticker = String(ticker || "").toUpperCase();
  if (!TICKER.test(ticker)) return json({ error: "Unknown ticker." }, 400);
  if (!env.TWELVEDATA_API_KEY) return json({ error: "Prices are not connected yet." }, 503);
  const p = await getPrice(env, ticker);
  if (!p) return json({ error: "No price available for that ticker right now." }, 404);
  return json({ ...p, source: SOURCE });
}

export async function many({ request, env }) {
  const refused = await subscriber(request, env); if (refused) return refused;
  const tickers = [...new Set((new URL(request.url).searchParams.get("tickers") || "").toUpperCase().split(",").filter((t) => TICKER.test(t)))].slice(0, 100);
  return json({ prices: await cachedPrices(env, tickers), source: SOURCE });
}
