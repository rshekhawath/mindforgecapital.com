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
     spell that pattern out — 28 copies of it would be 28 false hits.) -->
<link rel="stylesheet" href="/assets/mfc-dir.css?v=2920">
<link rel="stylesheet" href="/assets/mfc-finish.css?v=3000">
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
</head>
<body>
<nav>
  <div class="nav-inner">
    <a href="/" class="logo" aria-label="MindForge Capital — Home">
      <img src="/assets/LogoNav.png" alt="MindForge Capital" decoding="async" height="36">
    </a>
    <div class="nav-links" id="primary-nav">
      <a href="/strategies.html">Strategies</a>
      <a href="/screener/" class="active">Scanner</a>
      <a href="/scores/">Integrity Score</a>
      <a href="/fii-dii/">FII/DII</a>
      <a href="/factor-report/">Factor Report</a>
      <a href="/calculator.html">Fee Calculator</a>
      <a href="/login.html">Sign In</a>
      <a href="/signup.html" class="nav-cta">Get Started</a>
    </div>
    <button class="nav-hamburger" aria-label="Open menu" aria-expanded="false" aria-controls="primary-nav"><span></span><span></span><span></span></button>
  </div>
</nav>

<div class="dir-wrap">
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
</div>

<footer class="dir-foot">
  Stock data is sourced from public filings for research and education only — <b>not investment advice</b> or a buy/sell recommendation. <b>Investments in the securities market are subject to market risks; read all the related documents carefully before investing.</b><br>
  SEBI-Registered Research Analyst · Sagar Shekhawath · INH-XXXXXXXXXXX · <a href="/disclosures.html">Disclosures &amp; Investor Charter</a><br>
  <span style="opacity:.7">Directory regenerated {day}.</span>
</footer>

<script defer src="/assets/mfc-chrome.js?v=6"></script>
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

    # ── V15.2 (1): LITE bundle — full minus the two heavy free-text fields the list
    #    views never render (description alone is ~31% of the file). Both listers
    #    (Scanner + Integrity Score) load this; only the per-stock company page loads
    #    the full stocks.json (for its About tab). Every numeric field is retained,
    #    so filters / columns / scoring / inline reports work unchanged on lite.
    LITE_DROP = ("description", "website")
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
