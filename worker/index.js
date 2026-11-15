// BuyBelow site Worker: serves the static pages in site/ and the two small API routes.
import * as waitlist from "./api/waitlist.js";
import * as exporter from "./api/export.js";

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === "/api/waitlist") return request.method === "POST" ? waitlist.onRequestPost({ request, env }) : waitlist.onRequest();
    if (pathname === "/api/export") return request.method === "GET" ? exporter.onRequestGet({ request, env }) : exporter.onRequest();
    if (pathname.startsWith("/api/")) return new Response(JSON.stringify({ error: "Not found." }), { status: 404, headers: { "Content-Type": "application/json; charset=utf-8" } });
    return env.ASSETS.fetch(request);
  },
};
