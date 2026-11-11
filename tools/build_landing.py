#!/usr/bin/env python3
"""Build the landing page from src/landing.src.html:
  landing.html     the preview copy (fonts from Google Fonts)
  site/index.html  the deployable copy (self-hosted fonts, full HTML document)
"""
import re
s = open("src/landing.src.html").read()
open("landing.html", "w").write(s)
body = re.sub(r"<!--FONTS-->.*?<!--/FONTS-->", '<link rel="preload" href="/fonts/geologica-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>\n<link rel="stylesheet" href="/fonts/fonts.css">', s, flags=re.S)
cut = body.index('<header class="nav">')
head = body[:cut].replace('<meta name="claude:viewport-fit-sides" content="cover">\n', "")
doc = '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n' + head + "</head>\n<body>\n" + body[cut:] + "</body>\n</html>\n"
doc = doc.replace("<style>", "<style>\nhtml { padding-top: env(safe-area-inset-top, 0px); padding-bottom: env(safe-area-inset-bottom, 0px); }\n[hidden] { display: none !important; }", 1)
open("site/index.html", "w").write(doc)
print("built landing.html and site/index.html")
