#!/usr/bin/env python3
"""Build data for every NYSE / Nasdaq company from the SEC's free API (no key).

  python3 tools/fetch_all.py "<app name> <contact email>" out_dir [limit]

Reads the SEC ticker list, fetches each company's facts (under the SEC's 10 requests/second limit),
and writes out_dir/index.json plus out_dir/s/NNN.json shards of 25 companies each.
"""
import json, os, sys, threading, time, urllib.request, gzip
from concurrent.futures import ThreadPoolExecutor
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from build_company_data import build, Skip

UA, OUT = sys.argv[1], sys.argv[2]
LIMIT = int(sys.argv[3]) if len(sys.argv) > 3 else None
SHARD = 25
MERGE = {2115436: [34088]}  # a new holding company that carries on an older registrant's history
lock, last = threading.Lock(), [0.0]

def get(url):
    for attempt in range(5):
        with lock:  # global pacing: 8 requests a second
            wait = last[0] + 0.125 - time.time()
            if wait > 0: time.sleep(wait)
            last[0] = time.time()
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept-Encoding": "gzip"})
            with urllib.request.urlopen(req, timeout=60) as r:
                body = r.read()
                return json.loads(gzip.decompress(body) if r.headers.get("Content-Encoding") == "gzip" else body)
        except urllib.error.HTTPError as e:
            if e.code == 404: return None
            time.sleep(2 ** attempt)
        except Exception:
            time.sleep(2 ** attempt)
    return None

def tidy(name):
    small = {"Inc", "Corp", "Co", "Ltd", "Plc", "Lp", "Llc", "Sa", "Nv", "De", "Of", "And", "The"}
    out = " ".join(w if (w.isupper() and len(w) <= 4 and w.title() not in small) else w.title() for w in name.replace("/DE/", "").replace("/DE", "").split())
    return out.replace(" Inc", " Inc.").replace("Inc..", "Inc.").replace(" Corp", " Corp.").replace("Corp..", "Corp.").replace("Corp.oration", "Corporation")

listing = get("https://www.sec.gov/files/company_tickers_exchange.json")
by_cik = {}
for cik, name, ticker, exch in listing["data"]:
    if exch in ("Nasdaq", "NYSE"): by_cik.setdefault(cik, {"name": name, "tickers": [], "exch": exch})["tickers"].append(ticker)
ciks = list(by_cik)[:LIMIT]
print(len(ciks), "companies to fetch", flush=True)

skipped, done = {}, [0]
def work(cik):
    info = by_cik[cik]
    raw = get(f"https://data.sec.gov/api/xbrl/companyfacts/CIK{cik:010d}.json")
    res = None
    try:
        if raw is None: raise Skip("no structured data filed")
        for old in MERGE.get(cik, []):
            prior = get(f"https://data.sec.gov/api/xbrl/companyfacts/CIK{old:010d}.json") or {}
            for tx, tags in (prior.get("facts") or {}).items():
                for tag, node in tags.items():
                    mine = raw["facts"].setdefault(tx, {}).setdefault(tag, {"units": {}})
                    for unit, arr in node["units"].items():
                        have = {(f.get("start"), f["end"]) for f in mine["units"].get(unit, [])}
                        mine["units"].setdefault(unit, []).extend(f for f in arr if (f.get("start"), f["end"]) not in have)
        obj = build(raw, info["tickers"][0], tidy(info["name"]), max_quarters=48)
        obj["exchange"] = info["exch"]; obj["cik"] = cik; res = obj
    except Skip as e: skipped[cik] = str(e)
    except Exception as e: skipped[cik] = "error: " + type(e).__name__
    done[0] += 1
    if done[0] % 250 == 0: print(done[0], "fetched,", len(skipped), "skipped", flush=True)
    return res

with ThreadPoolExecutor(8) as ex: results = [r for r in ex.map(work, ciks) if r]
results.sort(key=lambda o: o["ticker"])
os.makedirs(os.path.join(OUT, "s"), exist_ok=True)
index = []
for n in range(0, len(results), SHARD):
    chunk = results[n:n + SHARD]
    json.dump({o["ticker"]: o for o in chunk}, open(os.path.join(OUT, "s", f"{n // SHARD:03d}.json"), "w"), separators=(",", ":"))
    for o in chunk: index.append([o["ticker"], o["name"], n // SHARD, o["exchange"], by_cik[o["cik"]]["tickers"][1:4]])
for cik, why in skipped.items():   # still listed, so still searchable: the page explains there is nothing to chart
    info = by_cik[cik]; index.append([info["tickers"][0], tidy(info["name"]), -1, info["exch"], info["tickers"][1:4], why])
order = {by_cik[c]["tickers"][0]: i for i, c in enumerate(ciks)}   # SEC lists largest companies first
index.sort(key=lambda r: order[r[0]])
json.dump({"built": time.strftime("%Y-%m-%d"), "companies": index}, open(os.path.join(OUT, "index.json"), "w"), separators=(",", ":"))
reasons = {}
for r in skipped.values(): reasons[r] = reasons.get(r, 0) + 1
json.dump({"reasons": reasons, "ciks": skipped}, open(os.path.join(OUT, "..", "skipped.json"), "w"))
print("DONE", len(results), "companies,", len(skipped), "skipped:", reasons, flush=True)
