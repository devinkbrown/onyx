#!/usr/bin/env python3
"""Render the FULL master roadmap into the Ink & Vermillion page."""
import base64
import pathlib
import re
import markdown

ROOT = pathlib.Path("/home/kain")
ONYX = ROOT / "onyx"
SRC = ROOT / "ONYX_ONYX_MASTER_ROADMAP.md"

# ---- load + clean markdown ------------------------------------------------
raw = SRC.read_text()
lines = raw.splitlines()
out, skip_toc = [], False
for ln in lines:
    if ln.strip().startswith("<!--"):
        continue                       # SPDX / comment lines
    if ln.strip() == "## Table of contents":
        skip_toc = True                # drop the doc's own inline TOC…
        continue
    if skip_toc:
        if ln.strip() == "---":        # …until its closing rule
            skip_toc = False
        continue
    out.append(ln)
# drop the leading H1 + subtitle (the hero carries them)
text = "\n".join(out)
text = re.sub(r"^# Onyx Server × Onyx — Master Roadmap\s*\n", "", text, count=1)
text = re.sub(r"^### \*A north-star.*?\*\s*\n", "", text, count=1, flags=re.S)
# drop the closing italic sign-off rule noise if any leading '---'
text = text.lstrip("\n")
if text.startswith("---"):
    text = text[3:].lstrip("\n")

md = markdown.Markdown(extensions=["tables", "fenced_code", "sane_lists", "toc", "attr_list"])
body = md.convert(text)

# wrap tables so wide ones scroll inside their own container
body = re.sub(r"<table>", '<div class="tbl"><table>', body)
body = re.sub(r"</table>", "</table></div>", body)

# ---- sidebar nav from the real heading ids --------------------------------
def collect_sections(tokens):
    secs = []
    def walk(nodes):
        for n in nodes:
            if n["level"] == 2:
                subs = [(c["id"], c["name"]) for c in n.get("children", []) if c["level"] == 3]
                secs.append((n["id"], n["name"], subs))
            else:
                walk(n.get("children", []))
    walk(tokens)
    return secs

sections = collect_sections(md.toc_tokens)
nav_items = []
for sid, sname, subs in sections:
    sub_html = ""
    if subs:
        lis = "".join(f'<li><a href="#{cid}">{cname}</a></li>' for cid, cname in subs)
        sub_html = f'<ul class="toc-sub">{lis}</ul>'
    nav_items.append(f'<li><a class="toc-top" href="#{sid}">{sname}</a>{sub_html}</li>')
nav_html = '<ul class="toc-list">' + "".join(nav_items) + "</ul>"

# ---- fonts ----------------------------------------------------------------
def datauri(p):
    return "data:font/woff2;base64," + base64.b64encode(pathlib.Path(p).read_bytes()).decode()

FRAUNCES = datauri(ONYX / "dist/assets/fraunces-latin-wght-normal-ukD16Tqj.woff2")
JBMONO = datauri(ONYX / "dist/assets/jetbrains-mono-latin-wght-normal-B9CIFXIH.woff2")

CSS = (ONYX / "scratchpad/roadmap.css").read_text()
CSS = CSS.replace("__FRAUNCES__", FRAUNCES).replace("__JBMONO__", JBMONO)

HTML = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Onyx Server × Onyx — Master Roadmap</title>
<meta name="description" content="Sovereign Realtime — the complete Onyx Server × Onyx master roadmap: four eras, twelve versions, in the Ink & Vermillion design system.">
<meta name="color-scheme" content="dark light">
<meta name="theme-color" content="#1a1512" media="(prefers-color-scheme: dark)">
<meta name="theme-color" content="#ede4d3" media="(prefers-color-scheme: light)">
<meta property="og:title" content="Onyx Server × Onyx — Sovereign Realtime">
<meta property="og:description" content="Four eras, twelve versions. Discord's comfort, Signal's secrets, IRC's openness — on a mesh no company can switch off.">
<meta property="og:type" content="website">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect x='4' y='4' width='24' height='24' rx='5' fill='none' stroke='%23de3b26' stroke-width='3'/><text x='16' y='24' font-size='19' text-anchor='middle' fill='%23de3b26' font-family='Georgia,serif'>龍</text></svg>">
<style>
{CSS}
</style>
</head>
<body>
<div class="rm-root">
  <canvas id="ink-canvas" aria-hidden="true"></canvas>
  <button class="rm-toggle" id="themeToggle" type="button" aria-label="Switch light or dark theme"><span id="themeLabel">Ink</span></button>

  <header class="rm-hero">
    <div class="rm-hero-inner">
      <div class="rm-seal" aria-hidden="true">龍</div>
      <p class="rm-eyebrow">Onyx Server × Onyx · Master Roadmap</p>
      <h1>Sovereign<br><span class="em">Realtime</span></h1>
      <p class="rm-lede">The network that <b>remembers you</b>, <b>reaches you</b>, <b>keeps your secrets</b>, and <b>belongs to no one</b>.</p>
      <p class="rm-pitch">Discord's comfort, Signal's secrets, IRC's openness — on a mesh no company can switch off, from a binary you can <code>docker run</code> in sixty seconds.</p>
    </div>
  </header>

  <div class="rm-doc">
    <aside class="rm-nav" aria-label="Contents">
      <p class="rm-nav-title">Contents</p>
      {nav_html}
    </aside>
    <main class="rmdoc">
{body}
    </main>
  </div>
</div>
<script>
{(ONYX / "scratchpad/roadmap.js").read_text()}
</script>
</body>
</html>
"""

for dest in [ONYX / "public/roadmap/index.html", ONYX / "out/roadmap/index.html"]:
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(HTML)

print("sections:", len(sections))
print("body chars:", len(body))
print("total html KB:", len(HTML) // 1024)
