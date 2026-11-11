#!/usr/bin/env python3
"""Snapshot exchange rates against the US dollar (open.er-api.com, free, no key).

  python3 tools/fetch_fx.py out_dir        ->  out_dir/fx.json   {"asOf", "usdPer": {"CHF": 1.12, ...}}
"""
import json, subprocess, sys
body = subprocess.run(["curl", "-sS", "-m", "60", "https://open.er-api.com/v6/latest/USD"], capture_output=True, check=True).stdout
j = json.loads(body)
assert j.get("result") == "success", j
usd_per = {c: round(1 / r, 8) for c, r in j["rates"].items() if r}
json.dump({"asOf": j["time_last_update_utc"], "source": "open.er-api.com", "usdPer": usd_per}, open(sys.argv[1] + "/fx.json", "w"), separators=(",", ":"))
print(len(usd_per), "rates ->", sys.argv[1] + "/fx.json", {c: usd_per[c] for c in ("CHF", "EUR", "JPY", "CNY", "CAD")})
