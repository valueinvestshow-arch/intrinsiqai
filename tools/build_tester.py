#!/usr/bin/env python3
"""Inline company data files into the tester page.  python3 tools/build_tester.py tester.html data/adbe.json data/aapl.json"""
import json, sys
out, files = sys.argv[1], sys.argv[2:]
src = open("src/tester.src.html").read()
assert "/*__DATA__*/null" in src
data = {}
for f in files:
    d = json.load(open(f)); data[d["ticker"]] = d
open(out, "w").write(src.replace("/*__DATA__*/null", json.dumps(data, separators=(",", ":"))))
print("wrote", out, list(data))
