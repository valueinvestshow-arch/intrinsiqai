#!/usr/bin/env python3
"""Snapshot the last sale price of every US-listed stock from Nasdaq's public screener (no key).

  python3 tools/fetch_prices.py out_dir        ->  out_dir/prices.json

One request covers NYSE, Nasdaq and NYSE American. This endpoint feeds nasdaq.com and is not a
licensed data product: fine for a prototype, replace with a licensed feed before launch.
"""
import json, subprocess, sys, time

URL = "https://api.nasdaq.com/api/screener/stocks?tableonly=true&limit=25&offset=0&download=true"
# curl, because the endpoint turns away Python's default HTTP client.
body = subprocess.run(["curl", "-sS", "-m", "90", "-H", "User-Agent: Mozilla/5.0 (compatible; research-prototype)", "-H", "Accept: application/json", URL], capture_output=True, check=True).stdout
rows = json.loads(body)["data"]["rows"]

def num(v):
    try: return float(str(v).replace("$", "").replace(",", "").replace("%", ""))
    except ValueError: return None

out = {}
for r in rows:
    price = num(r.get("lastsale"))
    if not price: continue
    out[r["symbol"].strip().replace("/", "-").replace("^", "-P")] = [price, num(r.get("pctchange")), num(r.get("marketCap")), r.get("sector") or "", r.get("industry") or ""]
json.dump({"asOf": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "source": "Nasdaq screener, last sale", "p": out}, open(sys.argv[1] + "/prices.json", "w"), separators=(",", ":"))
print(len(out), "prices ->", sys.argv[1] + "/prices.json")
