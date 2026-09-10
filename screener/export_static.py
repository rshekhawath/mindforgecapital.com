#!/usr/bin/env python3
"""
export_static.py
================
Exports the screener SQLite cache (screener.db) into a single static JSON
bundle consumed by the always-live, server-less screener at
docs/screener/ (mindforgecapital.com/screener).

The static screener loads this one file and does all filtering / sorting /
search / company lookups client-side — no Flask, no local PC required.

Usage
-----
    python3 export_static.py

Output
------
    ../docs/screener/stocks.json   (single bundle: {generated_at, count, sectors, stocks:[...]})

Refresh workflow
----------------
    1. (optional) run the Flask server once and click "Fetch / Refresh Data"
       to repopulate screener.db from Yahoo Finance, OR run a bulk fetch.
    2. python3 export_static.py
    3. commit docs/screener/stocks.json and push  ->  GitHub Pages serves the
       refreshed snapshot.
"""

import sqlite3, json, os, math
from datetime import datetime, timezone
from urllib.parse import quote

HERE      = os.path.dirname(os.path.abspath(__file__))
DB_PATH   = os.path.join(HERE, "data", "screener.db")
OUT_DIR   = os.path.normpath(os.path.join(HERE, "..", "docs", "screener"))
OUT_PATH  = os.path.join(OUT_DIR, "stocks.json")


def sanitize(obj):
    """Recursively convert non-finite floats (NaN / Infinity) to None.
    Python's json module emits the literals NaN/Infinity, which are INVALID
    JSON and make browser JSON.parse() reject the whole file."""
    if isinstance(obj, float):
        return None if (math.isnan(obj) or math.isinf(obj)) else obj
    if isinstance(obj, dict):
        return {k: sanitize(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [sanitize(v) for v in obj]
    return obj


# ─────────────────────────────────────────────────────────────────────────────
# V25.7 — STOCK DIRECTORY
#
# The problem this solves: the ~4,250 per-stock URLs had no crawlable inbound
# link anywhere on the site. The only <a href="company.html?symbol=..."> on
# either lister lives INSIDE a JS template literal, rendered into a paginated
# table after a multi-MB fetch. So every company page was sitemap-only: Google
# would crawl it, but no internal link meant no internal PageRank reaching it,
# which is why deep pages with real content still rank like orphans.
#
# These pages fix that with plain <a> tags in the served HTML — a hub at
# /screener/stocks/ linking 27 letter pages, each linking its companies. Both
# per-stock surfaces (the research report and the Integrity scorecard) get a
# link, so equity flows to both. Generated here rather than hand-written so a
# newly listed company appears in the directory on the next data refresh
# instead of whenever someone remembers to edit 27 files.
# ─────────────────────────────────────────────────────────────────────────────

BUCKETS = ["0-9"] + [chr(c) for c in range(ord("A"), ord("Z") + 1)]


def _bucket_of(sym: str) -> str:
    """First character of the ticker, folded into one of the 27 buckets."""
    c = (sym or "").strip().upper()[:1]
    return c if "A" <= c <= "Z" else "0-9"


def _esc(s) -> str:
    """Escape for HTML text/attribute context."""
    return (str(s if s is not None else "")
            .replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            .replace('"', "&quot;"))


def _cr(v) -> str:
    """Market cap in crore → a short Indian-format label."""
    if not isinstance(v, (int, float)) or v <= 0:
        return ""
    if v >= 100000:
        return f"₹{v/100000:.2f}L Cr"
    if v >= 1000:
        return f"₹{v/1000:.2f}K Cr"
    return f"₹{v:,.0f} Cr"


def _px(v) -> str:
    """Last traded price → a compact rupee label. Sub-₹100 names (a large slice
    of the small-cap tail) keep two decimals; above that the paise are noise in
    a directory column."""
    if not isinstance(v, (int, float)) or v <= 0:
        return ""
    return f"₹{v:,.2f}" if v < 100 else f"₹{v:,.0f}"


def _chg(v):
    """Day change % → (label, direction-class). Direction drives the ink, so a
    flat/unknown day must NOT borrow the up colour: it gets its own muted class."""
    if not isinstance(v, (int, float)):
        return "", ""
    if v > 0.049:
        return f"+{v:.2f}%", "up"
    if v < -0.049:
        return f"{v:.2f}%", "dn"
    return "0.00%", "fl"


# ── V33.1 — THE STYLESHEET TOKEN IS NO LONGER A LITERAL IN THIS FILE ─────────
# These 28 pages carried `mfc-finish.css?v=NNNN` as a hardcoded string. That is
# the same file the other 21 hand-maintained pages link, and every release that
# touches it bumps the token on those 21 — so each release this generator was
# one refresh away from silently reverting the 28 back to the previous token.
# It has now happened at least three times:
#   V29.2  pinned at 2850 while the site was on 2910 — the 44px hamburger fix
#          never reached the pages Google actually lands on, for weeks
#   V31.4  reverted mid-session by the scheduled refresh
#   V33.1  found live: the site was on 3300, these 28 were back on 3120, so the
#          release's reduced-motion blanket and touch-target block were absent
#          from every stock-directory page
# Editing the literal fixes the symptom for exactly one release. Reading the
# token from a hand-maintained page makes drift impossible: whatever the rest of
# the site asks for, these pages ask for too. The literal below is only a
# fallback for the case where index.html cannot be read at all.
#
# V33.7: mfc-chrome.js had exactly the same literal, and it bit the same way —
# the 28 pages were bumped by hand this release while line 300 still said
# `?v=7`, so the next refresh would have reverted them. Reading BOTH tokens from
# index.html is the same fix applied to the second asset, so the helper below is
# now generic rather than mfc-finish-specific.
# (mfc-dir.css deliberately keeps its literal: index.html does not link it, and
# this generator is the ONLY writer of the 28 pages that do, so there is no
# second maintainer for it to drift away from.)
# V34.1 — READING FROM index.html CANNOT WORK FOR AN ASSET index.html DOES NOT
# LINK. The V33.7 fix above closed the drift for mfc-finish.css, which index.html
# does link, and left it wide open for mfc-chrome.js, which it does NOT: the page
# only mentions that script in two comments ("This page doesn't load
# mfc-chrome.js, so it registers inline"), the regex found no `?v=`, and every
# generation silently took the hardcoded fallback. Caught in V34.1 by diffing a
# generated page against disk after a bump: disk said 3380, the generator said
# 3370, and the next data refresh would have reverted all 28 pages — the exact
# failure V33.7 set out to end, one asset over.
#
# So read each asset from a page that actually REFERENCES it, trying several in
# order rather than trusting one. The fallbacks stay as a last resort for the
# case where none of the sources can be read at all.
_ASSET_SOURCES = ("index.html", "login.html", "scores/index.html")
_ASSET_FALLBACK = {"mfc-finish.css": "3400", "mfc-chrome.js": "3390"}


def _asset_ver(name: str) -> str:
    """The ?v token the rest of the site is currently using for a shared asset.

    Read from a hand-maintained page at generation time so these 28 generated
    pages can never ask for an older build of a shared asset than the 20
    hand-maintained pages do. Several sources are tried in order because no
    single page links every shared asset — index.html does not load
    mfc-chrome.js at all, which is how that one drifted. The fallback is only
    for the case where none of the sources can be read.
    """
    import re as _re
    for src in _ASSET_SOURCES:
        try:
            path = os.path.normpath(os.path.join(HERE, "..", "docs", src))
            with open(path, encoding="utf-8") as fh:
                m = _re.search(_re.escape(name) + r"\?v=(\d+)", fh.read())
            if m:
                return m.group(1)
        except Exception:
            continue
    return _ASSET_FALLBACK.get(name, "1")


# ── V36.6 — COLUMNAR WAS BUILT, MEASURED, AND REJECTED. DO NOT RE-ATTEMPT IT
#    WITHOUT RE-MEASURING THE CPU SIDE. ────────────────────────────────────────
# The plan for this release proposed re-shaping these bundles into one array per
# field — {"fields":[...],"data":{"symbol":[...],...}} — for "a 70% cut in bytes
# AND in parse time". The bytes claim is true. The parse-time claim is exactly
# backwards, and it is the half that decides the question.
#
# Built it, shipped it behind a decoder in both readers, and benchmarked the
# whole path to usable rows on the 2026-09-08 snapshot (2,126 rows, 97 fields):
#
#                       wire (gzip)   raw     JSON.parse   rehydrate   CPU total
#     row-per-object      0.757 MB   4.316 MB   24.8 ms       0 ms       24.8 ms
#     columnar            0.419 MB   1.387 MB   18.7 ms      64.0 ms     82.7 ms
#
# Adding the percentile-pool pass the Integrity Score page pays either way
# (69.8 ms for 30 factors over 2,126 rows), the totals are 94.6 ms against
# 152.5 ms — columnar costs +57.9 ms of main-thread CPU, a 61% increase in the
# work done before anything renders, to save 330 KB. On stocks.json the trade is
# the same shape: -477 KB for a comparable penalty.
#
# The reason is simple in hindsight: the row objects both readers need are built
# by C++ inside JSON.parse in the row shape, and by a JavaScript loop doing
# ~206,000 property assignments in the columnar shape. Two rehydrators were
# tried (column-major and row-major) and always-assign vs skip-nulls; all four
# land between 50 and 78 ms. Round-tripping is exact — 203,895 key/value pairs
# compared, 0 differences — so this is purely a performance question, and the
# answer is no.
#
# WHAT IS ACTUALLY WORTH DOING, and is deferred rather than dismissed: the
# per-stock company pages (2,126 of them, the largest surface Google lands
# strangers on) download the full 6.44 MB universe to render ONE row. They need
# that row plus the percentile pools. A precomputed screener/scored/<SYM>.json
# alongside one small pools file takes that page from 6.66 MB to well under
# 100 KB — a 60x cut, not 30% — and it removes the rehydration question instead
# of trading against it. The build already emits per-symbol files under
# screener/fin/ and screener/hist/, so the pattern exists.


def _finish_ver() -> str:
    """Back-compat alias — mfc-finish.css's token."""
    return _asset_ver("mfc-finish.css")


def _dir_page(title, desc, canon, h1, lede, body, crumb, day, extra_ld=None):
    """One directory page. The head mirrors the hand-maintained pages: same CSP,
    same PWA metadata, same FOUC-free theme boot, same nav — so the directory is
    indistinguishable from the rest of the site rather than an SEO annex."""
    ld = {
        "@context": "https://schema.org",
        "@graph": [
            {"@type": "BreadcrumbList", "itemListElement": crumb},
            {"@type": "CollectionPage", "@id": canon, "url": canon, "name": title,
             "description": desc, "inLanguage": "en-IN",
             "isPartOf": {"@type": "WebSite", "name": "MindForge Capital",
                          "url": "https://mindforgecapital.com/"}},
        ],
    }
    if extra_ld:
        ld["@graph"].append(extra_ld)
    return f"""<!DOCTYPE html>
<html lang="en-IN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; base-uri 'self'; object-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://script.google.com https://*.googleusercontent.com; form-action 'self' https://script.google.com; frame-src 'none'; media-src 'none'; worker-src 'self'; manifest-src 'self'; upgrade-insecure-requests">
<meta name="referrer" content="strict-origin-when-cross-origin">
<meta http-equiv="X-Content-Type-Options" content="nosniff">
<meta http-equiv="Cross-Origin-Opener-Policy" content="same-origin">
<!-- V28.7 clickjacking guard: every hand-written page on this site has carried this
     since V11.4, and the 28 pages this generator writes never did. Dropping the
     inert meta frame-ancestors directive is what made that visible: these pages were
     relying on a directive no browser honours, so their framing protection was the
     empty set. Byte-identical to the copy in index.html. -->
<script>/* V11.4 clickjacking guard: refuse cross-origin framing */(function(){{try{{if(window.self===window.top)return;var s=false;try{{s=window.top.location.origin===window.location.origin;}}catch(e){{s=false;}}if(!s){{try{{window.top.location.replace(window.location.href);}}catch(e){{document.documentElement.style.visibility="hidden";}}}}}}catch(e){{}}}})();</script>
<meta name="color-scheme" content="light">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="MindForge Capital">
<link rel="apple-touch-icon" href="/assets/apple-touch-icon.png">
<link rel="manifest" href="/manifest.json">
<link rel="icon" href="/assets/favicon-32.png" type="image/png">
<title>{_esc(title)}</title>
<meta name="description" content="{_esc(desc)}">
<link rel="canonical" href="{_esc(canon)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="MindForge Capital">
<meta property="og:locale" content="en_IN">
<meta property="og:title" content="{_esc(title)}">
<meta property="og:description" content="{_esc(desc)}">
<meta property="og:url" content="{_esc(canon)}">
<meta property="og:image" content="https://mindforgecapital.com/assets/og-card.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="MindForge Capital — systematic, factor-based investing for India">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:site" content="@MindForgeCap">
<meta name="twitter:title" content="{_esc(title)}">
<meta name="twitter:description" content="{_esc(desc)}">
<meta name="twitter:image" content="https://mindforgecapital.com/assets/og-card.png">
<meta name="theme-color" content="#1a50d8">
<!-- V29.2: mfc-finish.css was pinned here at ?v=2850 while the other 21 pages had
     moved to 2910, so these 28 pages asked for a SECOND cache entry of the same
     file — and sw.js serves assets cache-first keyed by the exact URL, so anyone
     who had visited a directory page before V29.0 kept being served the copy
     frozen at 2850. The V29.1 fix that pins the hamburger to a 44px tap target
     therefore never reached the one part of the site where it was measured
     smallest. Both stylesheets now move together with the rest of the site.
     (The standing audit greps this tree for the stylesheet-plus-version string
     and expects exactly one distinct value, so this note deliberately does not
     spell that pattern out — 28 copies of it would be 28 false hits.)
     V33.1: the token is no longer written here as a literal. It is read from
     the site's own index.html at generation time, so a refresh can no longer
     revert these pages to a stylesheet the rest of the site has moved past. -->
<link rel="stylesheet" href="/assets/mfc-dir.css?v=3560">
<link rel="stylesheet" href="/assets/mfc-finish.css?v={_finish_ver()}">
<!-- V29.2: this was the apply-only half of the site's theme script — it READ the
     saved preference but never built the nav toggle, so these 28 pages were the
     only ones on the site with no way to change theme. A visitor who arrived here
     from search (which is how this directory is reached) got whatever they had
     set elsewhere and no control. Now byte-identical to the copy every
     hand-maintained page carries; .mfc-theme-toggle is already styled in
     mfc-finish.css, which is linked above. -->
<script>/* MFC theme (V17.5): FOUC-free apply + injected nav toggle. Default LIGHT; dark is explicit opt-in. Self-contained, no deps. */
(function(){{var D=document,R=D.documentElement;
function get(){{try{{return localStorage.getItem('mfc-theme')==='dark'?'dark':'light';}}catch(e){{return'light';}}}}
function apply(t){{var _d=t==='dark';R.setAttribute('data-theme',_d?'dark':'light');try{{var _m=D.querySelector('meta[name="theme-color"]');if(_m)_m.setAttribute('content',_d?'#080d1a':'#1a50d8');}}catch(e){{}}}}
apply(get());
var SUN='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
var MOON='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';
function build(){{if(D.getElementById('mfc-theme-toggle'))return;
var inner=D.querySelector('nav .nav-inner')||D.querySelector('nav');if(!inner)return;
var b=D.createElement('button');b.id='mfc-theme-toggle';b.className='mfc-theme-toggle';b.type='button';
b.setAttribute('aria-label','Toggle dark mode');b.title='Toggle light / dark';
function sync(){{var t=R.getAttribute('data-theme');b.innerHTML=t==='dark'?SUN:MOON;b.setAttribute('aria-pressed',t==='dark'?'true':'false');}}
sync();b.addEventListener('click',function(){{var t=R.getAttribute('data-theme')==='dark'?'light':'dark';try{{R.classList.add('mfc-theming');clearTimeout(R._thmT);R._thmT=setTimeout(function(){{R.classList.remove('mfc-theming');}},560);}}catch(e){{}}apply(t);try{{localStorage.setItem('mfc-theme',t);}}catch(e){{}}sync();}});
var ham=inner.querySelector('.nav-hamburger');if(ham)inner.insertBefore(b,ham);else{{var lk=inner.querySelector('.nav-links');(lk||inner).appendChild(b);}}}}
if(D.readyState==='loading')D.addEventListener('DOMContentLoaded',build);else build();}})();</script>
<script type="application/ld+json">{json.dumps(ld, ensure_ascii=False, separators=(",", ":"))}</script>
<style id="mf-v317-skip">
/* V31.7 — WCAG 2.4.1 (Bypass Blocks). These 28 directory pages put the 9-item
   masthead in front of every listing and had no way past it; the rest of the
   site has shipped this link for many releases. Same rule as the hand-written
   pages carry. Braces are doubled because this template is an f-string. */
.skip-link{{position:absolute;top:-100px;left:16px;background:var(--accent);color:#fff;
  padding:14px 22px;font-size:14px;font-weight:600;text-decoration:none;z-index:1000;
  border-radius:0 0 10px 10px;box-shadow:0 8px 20px -8px rgba(26,80,216,0.55);transition:top .2s ease;}}
.skip-link:focus{{top:0;outline:none;}}
@media (prefers-reduced-motion: reduce){{.skip-link{{transition:none;}}}}
</style>
</head>
<body>
<a href="#main-content" class="skip-link">Skip to main content</a>
<nav>
  <div class="nav-inner">
    <a href="/" class="logo" aria-label="MindForge Capital — Home">
      <img src="/assets/LogoNav.png?v=b1f0c2" alt="MindForge Capital" decoding="async" width="44" height="36">
    </a>
    <div class="nav-links" id="primary-nav">
      <a href="/strategies.html">Strategies</a>
      <a href="/screener/" class="active">Scanner</a>
      <a href="/scores/">Integrity Score</a>
      <a href="/fii-dii/">FII/DII</a>
      <a href="/factor-report/">Factor Report</a>
      <a href="/calculator.html">Fee Calculator</a>
      <a href="/recover.html">Recover Access</a>
      <a href="/login.html">Sign In</a>
      <a href="/signup.html" class="nav-cta">Get Started</a>
    </div>
    <button class="nav-hamburger" aria-label="Open menu" aria-expanded="false" aria-controls="primary-nav"><span></span><span></span><span></span></button>
  </div>
</nav>

<!-- V32.0: these 28 pages carried a skip link to #main-content and no <main>
     landmark, so the keyboard bypass worked and the screen-reader one did not.
     Same id, same position, real landmark. -->
<main class="dir-wrap" id="main-content">
  <nav class="dir-crumb" aria-label="Breadcrumb">
    <a href="/">Home</a> <span aria-hidden="true">›</span>
    <a href="/screener/">Stock Scanner</a> <span aria-hidden="true">›</span>
    {crumb[-1]["name"] if len(crumb) > 2 else "Stock Directory"}
  </nav>
  <header class="dir-head">
    <h1>{_esc(h1)}</h1>
    <p class="dir-lede">{lede}</p>
  </header>
{body}
</main>

<footer class="dir-foot">
  Stock data is sourced from public filings for research and education only — <b>not investment advice</b> or a buy/sell recommendation. <b>Investments in the securities market are subject to market risks; read all the related documents carefully before investing.</b><br>
  SEBI-Registered Research Analyst · Sagar Shekhawath · INH-XXXXXXXXXXX · <a href="/disclosures.html">Disclosures &amp; Investor Charter</a><br>
  <span style="color:var(--text3)">Directory regenerated {day}.</span>
</footer>

<script defer src="/assets/mfc-chrome.js?v={_asset_ver('mfc-chrome.js')}"></script>
</body>
</html>
"""


def write_directory(stocks, out_dir, day):
    """Write /screener/stocks/index.html + the 27 per-letter pages.
    Returns the list of canonical URLs written, for the sitemap."""
    dir_out = os.path.join(out_dir, "stocks")
    os.makedirs(dir_out, exist_ok=True)

    listed = [s for s in stocks if s.get("symbol")]
    groups = {b: [] for b in BUCKETS}
    for s in listed:
        groups[_bucket_of(s["symbol"])].append(s)
    for b in groups:
        groups[b].sort(key=lambda s: (s.get("name") or s["symbol"]).upper())

    def az_rail(here=None):
        out = ['<nav class="dir-az" aria-label="Browse stocks by first letter">']
        for b in BUCKETS:
            n = len(groups[b])
            if not n:
                out.append(f'<span aria-disabled="true" title="No listings">{b}</span>')
            elif b == here:
                out.append(f'<a class="here" href="{b.lower()}.html" aria-current="page">{b}</a>')
            else:
                # Hub and letter pages share a directory, so the relative href is the same for both.
                out.append(f'<a href="{b.lower()}.html" title="{n} companies starting with {b}">{b}</a>')
        out.append("</nav>")
        return "\n".join(out)

    def card(s):
        sym = _esc(s["symbol"])
        nm = _esc(s.get("name") or s["symbol"])
        sec = _esc(s.get("sector") or "")
        mc = _cr(s.get("market_cap_cr"))
        bits = [f'<span class="sym">{sym}</span>']
        if sec and sec != "N/A":
            bits.append(f'<span class="dot">·</span><span class="sec">{sec}</span>')
        if mc:
            # .mc-d is the desktop copy; below 480px CSS hides it and reveals the
            # .mc-p copy inside the price column instead — see mfc-dir.css.
            bits.append(f'<span class="dot mc-d">·</span><span class="mc mc-d">{mc}</span>')
        # V28.0: .nm and .sec are ellipsis-clipped ("Cholamandalam Investment and
        # Finance Company Limited" needs 394px in a 313px box on a phone;
        # "Communication Services" 135px in 73px on desktop) and nothing on the
        # card carried the full strings, so a clipped name was unrecoverable.
        # One title on the anchor makes every field readable again.
        # V29.2: every letter page's own <meta description> has promised
        # "Share price, sector, market cap" since V25.7, and the card rendered
        # only the last two — the one field a visitor arriving from that search
        # result came for was the one field missing. current_price is 99%
        # populated and day_change 98%, so the promise is now kept. The pair
        # also gives a 215-row directory the only vertical rhythm it has: a
        # right-hand column of prices with the day's direction in the ink.
        px = _px(s.get("current_price"))
        chg, dirn = _chg(s.get("day_change"))
        raw_sec = s.get("sector") or ""
        meta_txt = " · ".join(
            [str(s["symbol"])]
            + ([raw_sec] if raw_sec and raw_sec != "N/A" else [])
            + ([mc] if mc else []))
        # The price belongs in the tooltip too — .nm and .sec are ellipsis-clipped
        # and below 480px there is no hover, so the title is the only full record.
        tip = _esc(f"{s.get('name') or s['symbol']} · {meta_txt}"
                   + (f" · {px}" if px else "")
                   + (f" ({chg} today)" if chg else ""))
        pxblock = ""
        if px:
            # aria-hidden on the arrow: it is redundant with the signed number
            # a screen reader already reads out, and "▲ +1.20%" announces as
            # "up pointing triangle plus one point two zero percent".
            arrow = {"up": "▲", "dn": "▼"}.get(dirn, "")
            pxblock = (f'<span class="di-px"><b class="pv">{px}</b>'
                       + (f'<i class="ch {dirn}">'
                          + (f'<span class="arw" aria-hidden="true">{arrow}</span>' if arrow else "")
                          + f'{chg}</i>' if chg else "")
                       + (f'<span class="mc-p">{mc}</span>' if mc else "")
                       + "</span>")
        return (f'<a class="dir-item" href="/scores/company.html?symbol={sym}" title="{tip}">'
                f'<span class="di-main"><span class="nm">{nm}</span>'
                f'<span class="mt">{"".join(bits)}</span></span>'
                f'{pxblock}</a>')

    written = []
    total = len(listed)

    # ── Hub ──────────────────────────────────────────────────────────────────
    top = sorted([s for s in listed if isinstance(s.get("market_cap_cr"), (int, float))],
                 key=lambda s: -s["market_cap_cr"])[:60]
    hub_body = [
        az_rail(),
        '<section class="dir-sec">',
        f'<h2>India\'s largest listed companies <span class="n">{len(top)} by market capitalisation</span></h2>',
        '<div class="dir-grid">',
        *[card(s) for s in top],
        "</div></section>",
        '<section class="dir-sec"><h2>Every letter</h2><div class="dir-cards">',
    ]
    for b in BUCKETS:
        n = len(groups[b])
        if not n:
            continue
        first = ", ".join(_esc((s.get("name") or s["symbol"])) for s in groups[b][:3])
        hub_body.append(
            f'<a class="dir-card" href="{b.lower()}.html"><h3>{b} — {n} companies</h3>'
            f'<p>{first}{" and more" if n > 3 else ""}</p></a>')
    hub_body.append("</div></section>")

    hub_canon = "https://mindforgecapital.com/screener/stocks/"
    # Title and description are both kept inside what Google actually renders
    # (~60 chars / ~155 chars); the long forms were being truncated mid-phrase.
    hub_desc = (f"Browse all {total:,} NSE-listed companies A to Z. Every stock links to a full "
                "research report — valuation, profitability, growth and an Integrity Score.")
    written.append(hub_canon)
    with open(os.path.join(dir_out, "index.html"), "w", encoding="utf-8") as f:
        f.write(_dir_page(
            title=f"All NSE Stocks A–Z — {total:,} Listed Companies | MindForge",
            desc=hub_desc, canon=hub_canon,
            h1="Every NSE-listed company, A to Z",
            lede=(f"A complete directory of the {total:,} companies listed on India's National Stock "
                  "Exchange. Each one links to a full research report — price, valuation, "
                  "profitability, growth, balance-sheet health and a 0–100 "
                  '<a href="/scores/">Integrity Score</a> — rebuilt daily from public filings. '
                  'Prefer to filter rather than browse? Use the '
                  '<a href="/screener/">Stock Scanner</a>.'),
            body="\n".join(hub_body),
            crumb=[
                {"@type": "ListItem", "position": 1, "name": "Home",
                 "item": "https://mindforgecapital.com/"},
                {"@type": "ListItem", "position": 2, "name": "Stock Scanner",
                 "item": "https://mindforgecapital.com/screener/"},
                {"@type": "ListItem", "position": 3, "name": "Stock Directory",
                 "item": hub_canon},
            ],
            day=day,
        ))

    # ── Letter pages ─────────────────────────────────────────────────────────
    for b in BUCKETS:
        rows = groups[b]
        if not rows:
            continue
        canon = f"https://mindforgecapital.com/screener/stocks/{b.lower()}.html"
        label = f"the digit {b}" if b == "0-9" else f"the letter {b}"
        body = [
            az_rail(here=b),
            '<section class="dir-sec">',
            f'<h2>{len(rows)} companies</h2>',
            '<div class="dir-grid">',
            *[card(s) for s in rows],
            "</div></section>",
        ]
        written.append(canon)
        with open(os.path.join(dir_out, f"{b.lower()}.html"), "w", encoding="utf-8") as f:
            f.write(_dir_page(
                title=f"NSE Stocks Starting With {b} — {len(rows)} Companies | MindForge Capital",
                desc=(f"All {len(rows)} NSE-listed companies whose ticker starts with {b}. "
                      "Share price, sector, market cap and a full research report for each, "
                      "refreshed daily."),
                canon=canon,
                h1=f"NSE stocks starting with {b}",
                lede=(f"{len(rows)} companies listed on the National Stock Exchange of India with a "
                      f"ticker beginning with {label}. Every name links to its research report — "
                      "valuation, profitability, growth, balance sheet and Integrity Score. "
                      'Back to the <a href="./">full directory</a>.'),
                body="\n".join(body),
                crumb=[
                    {"@type": "ListItem", "position": 1, "name": "Home",
                     "item": "https://mindforgecapital.com/"},
                    {"@type": "ListItem", "position": 2, "name": "Stock Directory",
                     "item": "https://mindforgecapital.com/screener/stocks/"},
                    {"@type": "ListItem", "position": 3, "name": f"Stocks starting with {b}",
                     "item": canon},
                ],
                day=day,
                extra_ld={
                    "@type": "ItemList", "name": f"NSE stocks starting with {b}",
                    "numberOfItems": len(rows),
                    "itemListElement": [
                        {"@type": "ListItem", "position": i + 1,
                         "name": s.get("name") or s["symbol"],
                         "url": "https://mindforgecapital.com/scores/company.html?symbol="
                                + quote(str(s["symbol"]))}
                        for i, s in enumerate(rows[:100])
                    ],
                },
            ))

    return written


# ── V36.6 — THE REDUCED UNIVERSE FOR THE PER-STOCK PAGES ──────────────────────
# docs/scores/company.html loaded the FULL 6.5 MB stocks.json — 1.64 MB over the
# wire — and it did so for exactly TWO fields: `description` and `website`, the
# only two the lite bundle drops. Everything else it needs is the 39 fields its
# seven universe-backed renderers (fillCap, renderScale, renderPeers,
# renderSectorContext, renderImplied, renderMarketPct, renderReRate) and the
# scorer actually read, out of 96 in the row.
#
# Those 2,126 pages are the largest surface Google lands strangers on and the
# slowest on the site. Measured on the 2026-09-09 snapshot:
#
#                                     raw        gzipped
#     stocks.json (before)          6.510 MB     1.644 MB
#     stocks-universe.json          1.780 MB     0.348 MB
#     prose/<SYM>.json                4.2 KB       2.0 KB
#     ------------------------------------------------------
#     after                         1.784 MB     0.350 MB   -79% wire, -73% parse
#
# This is strictly better than the columnar reshape rejected above, and for the
# opposite reason: it removes data the page never reads instead of re-encoding
# data it does, so BOTH bytes and parse time fall and there is no rehydration
# cost. The row shape is unchanged, so none of the seven renderers change.
#
# THE FACTOR KEYS ARE READ OUT OF scores-engine.js RATHER THAN LISTED HERE.
# Adding a factor to that file must widen this bundle or the new factor silently
# scores null for every stock on the company page while working fine on the list
# page — a two-surfaces-disagree bug of exactly the kind this codebase keeps
# finding. Same principle as _asset_ver(): read it from the source of truth.
_ENGINE_JS = os.path.join(HERE, "..", "docs", "scores", "scores-engine.js")

# Fields the seven company-page renderers read from the universe array, which
# are NOT factor keys. Derived by walking each function body; re-derive if a
# renderer starts reading something new.
_COMPANY_FIELDS = (
    "symbol", "name", "sector", "industry", "market_cap_cr",
    "enterprise_value_cr", "revenue_cr", "net_profit_cr", "current_price",
    "shares_outstanding", "float_pct", "employees", "eps", "pe_ratio",
    "pb_ratio", "sma_50", "sma_200", "52w_from_high_pct",
    # V36.7 — provenance: set only for a listing whose statements are reported
    # in a different currency from its quote (INFY, HCLTECH). The company page
    # says so rather than printing a translated figure silently.
    "financial_currency",
)

# The two the LITE bundle drops and the detail page exists to show.
_PROSE_FIELDS = ("description", "website")


def _engine_factor_keys() -> set:
    """Every `key: "..."` in scores-engine.js — the factors it percentile-ranks."""
    try:
        with open(_ENGINE_JS, encoding="utf-8") as fh:
            js = fh.read()
        import re as _re2   # module-level `re` is not imported here; _asset_ver
                            # also imports it locally, so follow that pattern
        keys = set(_re2.findall(r'key:\s*"([A-Za-z0-9_]+)"', js))
        if keys:
            return keys
    except Exception as exc:
        print(f"  !! could not read factor keys from scores-engine.js ({exc})")
    return set()


# Factor keys scores-engine.js DERIVES at score time rather than reading from
# the snapshot (price vs its 50/200-day averages). They have no column behind
# them by design, so they must not be reported as missing — a warning that fires
# on every run is a warning nobody reads.
_ENGINE_DERIVED = ("_p2s50", "_p2s200")


def _universe_fields(rows: list) -> list:
    """The field set the reduced universe must carry, in row order."""
    want = (set(_COMPANY_FIELDS) | _engine_factor_keys()) - set(_ENGINE_DERIVED)
    # V36.7 — scan EVERY row, not a sample. This read rows[:200] and dropped
    # `financial_currency` from the bundle because only 2 of 2,126 rows carry
    # it: the field is set only for a listing whose statements are reported in
    # a foreign currency, and the rest of the snapshot came from a cache
    # populated before the field existed. A sample cannot see a rare field, and
    # rare is exactly when provenance matters. 2,126 key-set unions is free.
    present = set()
    for r in rows:
        present |= set(r.keys())
    missing = sorted(w for w in want if w not in present)
    if missing:
        # Loud, not silent: a factor key with no column behind it scores null
        # for the whole universe and the page shows a dash with no explanation.
        print(f"  !! reduced universe: {len(missing)} requested field(s) are not "
              f"in the snapshot and will be absent: {', '.join(missing)}")
    order = [k for k in rows[0].keys() if k in want] if rows else []
    for k in sorted(want):
        if k not in order and k in present:
            order.append(k)
    return order


def _write_reduced_universe(bundle: dict, out_dir: str) -> None:
    rows = bundle.get("stocks") or []
    fields = _universe_fields(rows)
    uni = {k: v for k, v in bundle.items() if k != "stocks"}
    uni["universe_fields"] = fields
    uni["stocks"] = [{k: s[k] for k in fields if k in s} for s in rows]
    path = os.path.join(out_dir, "stocks-universe.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(uni, f, separators=(",", ":"), ensure_ascii=False, allow_nan=False)

    # One tiny file per symbol carrying only what the reduced universe omits.
    prose_dir = os.path.join(out_dir, "prose")
    os.makedirs(prose_dir, exist_ok=True)
    kept = set()
    for s in rows:
        sym = s.get("symbol")
        if not sym:
            continue
        name = _safe_name(sym)
        kept.add(name + ".json")
        rec = {"symbol": sym}
        for k in _PROSE_FIELDS:
            if s.get(k):
                rec[k] = s[k]
        with open(os.path.join(prose_dir, name + ".json"), "w", encoding="utf-8") as f:
            json.dump(rec, f, separators=(",", ":"), ensure_ascii=False, allow_nan=False)
    # A delisted symbol must not leave a stale file behind for a URL that now 404s
    # everywhere else on the site.
    for stale in os.listdir(prose_dir):
        if stale.endswith(".json") and stale not in kept:
            try:
                os.remove(os.path.join(prose_dir, stale))
            except OSError:
                pass
    print(f"  Universe: {len(fields)} of {len(rows[0]) if rows else 0} fields "
          f"({os.path.getsize(path)/1e6:.2f} MB) + {len(kept)} prose files")


def main() -> int:
    if not os.path.exists(DB_PATH):
        print(f"ERROR: database not found at {DB_PATH}")
        return 1

    os.makedirs(OUT_DIR, exist_ok=True)

    conn = sqlite3.connect(DB_PATH)
    rows = conn.execute(
        "SELECT data, updated_at FROM stock_cache ORDER BY symbol"
    ).fetchall()
    conn.close()

    stocks, sectors = [], set()
    skipped = 0
    latest_update = ""

    for data_json, updated_at in rows:
        try:
            d = json.loads(data_json)
        except Exception:
            skipped += 1
            continue
        if not d or "error" in d or not d.get("symbol"):
            skipped += 1
            continue
        # Fix the dividend-yield scaling: the cached value is the true yield x100
        # (yfinance fraction x 10000), so e.g. TCS shows 564 instead of 5.64%.
        # Prefer recomputing the trailing yield from the rupee dividend rate /
        # price; fall back to /100; otherwise leave (0 / None).
        def _fin(x):
            return isinstance(x, (int, float)) and not (math.isnan(x) or math.isinf(x))
        _dr, _px, _dy = d.get("dividend_rate"), d.get("current_price"), d.get("dividend_yield")
        if _fin(_dr) and _fin(_px) and _dr > 0 and _px > 0:
            d["dividend_yield"] = round(_dr / _px * 100, 2)
        elif _fin(_dy) and _dy > 0:
            d["dividend_yield"] = round(_dy / 100, 2)
        # Yahoo codes the National Stock Exchange as "NSI" — show the real name
        if d.get("exchange") in (None, "", "NSI"):
            d["exchange"] = "NSE"
        stocks.append(sanitize(d))
        sec = d.get("sector")
        if sec and sec not in ("N/A", ""):
            sectors.add(sec)
        if updated_at and updated_at > latest_update:
            latest_update = updated_at

    bundle = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "data_through": latest_update,        # newest per-stock refresh timestamp
        "count": len(stocks),
        "sectors": sorted(sectors),
        "stocks": stocks,
    }

    # Compact separators keep the file small; gzip on the CDN shrinks it ~4x more.
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(bundle, f, separators=(",", ":"), ensure_ascii=False, allow_nan=False)

    # V36.6 — the reduced universe + per-symbol prose that replace the full
    # bundle on the 2,126 per-stock pages. See _write_reduced_universe().
    _write_reduced_universe(bundle, OUT_DIR)

    # ── V15.2 (1): LITE bundle — full minus the two heavy free-text fields the list
    #    views never render (description alone is ~31% of the file). Both listers
    #    (Scanner + Integrity Score) load this; only the per-stock company page loads
    #    the full stocks.json (for its About tab). Every numeric field is retained,
    #    so filters / columns / scoring / inline reports work unchanged on lite.
    # V36.6 — short_pct and short_ratio join the drop list. They are 0 of 2,126
    # populated in every snapshot in git history (Yahoo does not report short
    # interest for Indian listings at all), nothing in docs/ reads either one,
    # and they were still being serialised as `null` on every row of a bundle
    # the Scanner downloads to render 30.
    #
    # The other five fields MEMORY.md listed as permanently dead — total_assets,
    # total_assets_cr, debt_to_assets, equity_multiplier, asset_turnover — are
    # NOT dropped: they were dead only because server.py read totalAssets off
    # `.info`, and V36.6 derives it from the balance-sheet frame instead. They
    # measure 90-97% populated now. Re-check coverage before ever calling a
    # field dead; "Yahoo never returns it" was true of four of these for one
    # release and wrong for the next.
    LITE_DROP = ("description", "website", "short_pct", "short_ratio")
    lite_bundle = {
        "generated_at": bundle["generated_at"],
        "data_through": latest_update,
        "count": len(stocks),
        "sectors": sorted(sectors),
        "stocks": [{k: v for k, v in s.items() if k not in LITE_DROP} for s in stocks],
    }
    lite_path = os.path.join(OUT_DIR, "stocks-lite.json")
    with open(lite_path, "w", encoding="utf-8") as f:
        json.dump(lite_bundle, f, separators=(",", ":"), ensure_ascii=False, allow_nan=False)

    # ── V15.2 (2): rolling per-stock HISTORY (price + P/E) so the company page can
    #    draw a trend. One tiny file per symbol (lazy-loaded for just that stock),
    #    appended one trading-day per refresh, capped at 120 points. Self-building.
    hist_dir = os.path.join(OUT_DIR, "hist")
    os.makedirs(hist_dir, exist_ok=True)
    day = (latest_update or datetime.now(timezone.utc).isoformat())[:10]
    hwritten = 0
    for s in stocks:
        sym = s.get("symbol")
        px = s.get("current_price")
        if not sym or not isinstance(px, (int, float)):
            continue
        pe = s.get("pe_ratio")
        pe = round(pe, 2) if isinstance(pe, (int, float)) else None
        fp = os.path.join(hist_dir, _safe_name(sym) + ".json")
        try:
            with open(fp, encoding="utf-8") as f:
                pts = json.load(f)
            if not isinstance(pts, list):
                pts = []
        except Exception:
            pts = []
        row = [day, round(px, 2), pe]
        if pts and pts[-1] and pts[-1][0] == day:
            pts[-1] = row          # same trading day → overwrite (idempotent re-runs)
        else:
            pts.append(row)
        pts = pts[-120:]
        with open(fp, "w", encoding="utf-8") as f:
            json.dump(pts, f, separators=(",", ":"), allow_nan=False)
        hwritten += 1

    # ── V15.2 (4): SEO sitemap of every stock's per-company pages. Referenced from
    #    robots.txt alongside the static sitemap.xml.
    #    V25.6: this used to emit ONLY the Integrity-Score URL, which left the OTHER
    #    per-stock page — /screener/company.html — in no sitemap at all, so BOTH were
    #    emitted, the screener one at the higher priority as "the richer of the two".
    #    V26.8 SUPERSEDES THAT: the two pages had converged. Once the shared deep-dive
    #    (assets/mfc-company.js) landed on both, /scores/company.html rendered every
    #    card the screener page did PLUS the Integrity-Score pillars and the P/E trend
    #    — a strict superset — so the site now has ONE canonical per-stock page and
    #    /screener/company.html is a redirect stub pointing at it. A sitemap must not
    #    advertise redirecting URLs, so only the canonical /scores/ URL is emitted
    #    now, inheriting the higher 0.6 priority. This halves the stock URL count
    #    (~4,250 → ~2,125) and concentrates the crawl budget on the real page.
    #    V25.7: the directory hub + letter pages are emitted first and listed at the
    #    TOP of this sitemap at the highest priority. They are the crawl entry point
    #    for the per-stock URLs below them — the only place on the site where those
    #    4,250 pages have a real <a href> pointing at them.
    dir_urls = write_directory(stocks, OUT_DIR, day)

    smap_path = os.path.join(OUT_DIR, "stocks-sitemap.xml")
    surfaces = [
        ("https://mindforgecapital.com/scores/company.html?symbol=", "0.6"),
    ]
    n_urls = 0
    with open(smap_path, "w", encoding="utf-8") as f:
        f.write('<?xml version="1.0" encoding="UTF-8"?>\n')
        f.write('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n')
        for u in dir_urls:
            f.write(f"  <url><loc>{u}</loc><lastmod>{day}</lastmod>"
                    f"<changefreq>daily</changefreq><priority>0.8</priority></url>\n")
            n_urls += 1
        for base, prio in surfaces:
            for s in stocks:
                sym = s.get("symbol")
                if not sym:
                    continue
                f.write(f"  <url><loc>{base}{quote(str(sym))}</loc>"
                        f"<lastmod>{day}</lastmod>"
                        f"<changefreq>daily</changefreq><priority>{prio}</priority></url>\n")
                n_urls += 1
        f.write("</urlset>\n")

    size_mb = os.path.getsize(OUT_PATH) / 1e6
    lite_mb = os.path.getsize(lite_path) / 1e6
    print(f"✓ Exported {len(stocks)} stocks ({len(sectors)} sectors), "
          f"skipped {skipped}.")
    print(f"  Data through: {latest_update or '(unknown)'}")
    print(f"  Wrote {OUT_PATH}  ({size_mb:.2f} MB)")
    print(f"  Wrote {lite_path}  ({lite_mb:.2f} MB, -{(1-lite_mb/size_mb)*100:.0f}%)")
    print(f"  History: {hwritten} per-symbol files (day {day}, cap 120)")
    print(f"  Directory: {len(dir_urls)} pages under {os.path.join(OUT_DIR, 'stocks')}")
    print(f"  Sitemap: {smap_path}  ({n_urls} URLs — directory + screener + scores)")
    return 0


def _safe_name(sym):
    """Filesystem-safe symbol for a per-stock history filename (NSE symbols can
    contain & / etc. — e.g. M&M, J&KBANK)."""
    import re
    return re.sub(r"[^A-Za-z0-9._-]", "_", str(sym))


if __name__ == "__main__":
    raise SystemExit(main())
