#!/usr/bin/env python3
"""Build the app page: src/tester.src.html -> tester.html (preview copy) and site/app.html (served at /app)."""
import re
s = open("src/tester.src.html").read()
open("tester.html", "w").write(s)
body = re.sub(r'<link rel="stylesheet" href="https://fonts.googleapis.com[^>]*>', '<link rel="preload" href="/fonts/dm-sans-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>\n<link rel="stylesheet" href="/fonts/fonts.css">', s, count=1)
body = body.replace("<title>BuyBelow Tester</title>", "<title>BuyBelow</title>").replace('<meta name="claude:viewport-fit-sides" content="cover">\n', "")
cut = body.index('<header class="bar">')
doc = '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n<meta name="robots" content="noindex, nofollow">\n' + body[:cut] + "</head>\n<body>\n" + body[cut:] + "</body>\n</html>\n"
doc = doc.replace("<style>", "<style>\nhtml { padding-top: env(safe-area-inset-top, 0px); padding-bottom: env(safe-area-inset-bottom, 0px); }\nbody { margin: 0; }\n[hidden] { display: none !important; }", 1)
open("site/app.html", "w").write(doc)
print("built tester.html and site/app.html")
