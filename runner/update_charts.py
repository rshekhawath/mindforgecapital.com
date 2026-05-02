#!/usr/bin/env python3
"""
runner/update_charts.py
=======================
Refreshes backtest chart PNGs in the website by:
  1. Copying the latest PNG from strategies/<name>/outputs/ to
     web/assets/charts/<strategy>_<name>.png
  2. Updating the cache-busting ?v=<hash> in every <img> tag in
     web/*.html that points at the chart.

Run this script after any backtest:
    python3 runner/update_charts.py

Layout assumptions
------------------
  This script lives in       MFC/runner/
  HTML files                  MFC/web/
  Chart originals (PNG)       MFC/strategies/<name>/outputs/
  Public chart copies         MFC/web/assets/charts/    (deployed)

Why external files (not inline base64)?
---------------------------------------
Inline base64 inflates each HTML file by ~33% over the raw PNG and
forces the browser to download every chart before the page can render.
External files are cached, downloaded in parallel, and load lazily.
"""

import hashlib
import re
import shutil
from collections import defaultdict
from pathlib import Path

# ── Paths ─────────────────────────────────────────────────────────────────────
RUNNER = Path(__file__).resolve().parent
BASE   = RUNNER.parent
WEB    = BASE / "web"
CHARTS = WEB / "assets" / "charts"
CHARTS.mkdir(parents=True, exist_ok=True)

LM = BASE / "strategies" / "largemidcap" / "outputs"
SM = BASE / "strategies" / "smallmicro"  / "outputs"
MA = BASE / "strategies" / "multiasset"  / "outputs"

# ── Console colours ───────────────────────────────────────────────────────────
GREEN, YELLOW, RED, RESET, BOLD = "\033[92m", "\033[93m", "\033[91m", "\033[0m", "\033[1m"


def short_hash(path: Path) -> str:
    return hashlib.md5(path.read_bytes()).hexdigest()[:8]


# ── Chart manifest ────────────────────────────────────────────────────────────
# Each entry: (html_path, start_marker, end_marker, [(strategy, png_name), ...])
# `strategy` is the subfolder name under strategies/; png_name is the file
# inside strategies/<strategy>/outputs/. The deployed copy is named
# {strategy}_{png_name} in web/assets/charts/.
TASKS = [
    # strategies.html — MultiAsset section
    (
        WEB / "strategies.html",
        "<!-- BACKTEST CHARTS -->",
        "<!-- ── LARGEMIDCAP ── -->",
        [("multiasset", n) for n in [
            "01_summary.png", "02_growth.png", "03_drawdown.png",
            "04_rolling_sharpe.png", "05_annual_returns.png",
            "06_monthly_returns.png", "07_monthly_heatmap.png",
            "08_allocation_history.png", "09_return_distribution.png",
            "10_underwater.png",
        ]],
    ),
    # strategies.html — LargeMidcap section
    (
        WEB / "strategies.html",
        "<!-- LARGEMIDCAP BACKTEST CHARTS -->",
        "<!-- ── SMALLMICRO ── -->",
        [("largemidcap", n) for n in [
            "summary.png", "equity_curve.png", "rolling_metrics.png",
            "return_distribution.png", "monthly_heatmap.png", "sector_exposure.png",
        ]],
    ),
    # strategies.html — SmallMicro section
    (
        WEB / "strategies.html",
        "<!-- SMALLMICRO BACKTEST CHARTS -->",
        "<!-- end tabs-wrap -->",
        [("smallmicro", n) for n in [
            "summary.png", "equity_curve.png", "rolling_metrics.png",
            "return_distribution.png", "monthly_heatmap_port.png",
            "monthly_heatmap_bench.png", "sector_exposure.png",
        ]],
    ),
    # largemidcap.html standalone
    (
        WEB / "largemidcap.html",
        '<div class="section-label">Backtest Results</div>',
        '<section class="content-section" style="border-top:none;">',
        [("largemidcap", n) for n in [
            "summary.png", "equity_curve.png", "rolling_metrics.png",
            "return_distribution.png", "monthly_heatmap.png", "sector_exposure.png",
        ]],
    ),
    # smallmicro.html standalone
    (
        WEB / "smallmicro.html",
        '<div class="section-label">Backtest Results</div>',
        '<section class="content-section" style="border-top:none;">',
        [("smallmicro", n) for n in [
            "summary.png", "equity_curve.png", "rolling_metrics.png",
            "return_distribution.png", "monthly_heatmap_port.png",
            "monthly_heatmap_bench.png", "sector_exposure.png",
        ]],
    ),
    # multiasset.html standalone
    (
        WEB / "multiasset.html",
        '<div class="section-label">Backtest Results</div>',
        '<section class="content-section" style="border-top:none;">',
        [("multiasset", n) for n in [
            "01_summary.png", "02_growth.png", "03_drawdown.png",
            "04_rolling_sharpe.png", "05_annual_returns.png",
            "06_monthly_returns.png", "07_monthly_heatmap.png",
            "08_allocation_history.png", "09_return_distribution.png",
            "10_underwater.png",
        ]],
    ),
]

# Matches an <img> tag whose src points anywhere under assets/charts/.
# Captures: (1) attrs before src, (2) full chart filename incl. extension,
# (3) old ?v=<hash> querystring (may be empty), (4) attrs after src.
IMG_RE = re.compile(
    r'<img\s+([^>]*?)src="assets/charts/([^"?]+)(\?v=[^"]*)?"([^>]*)>',
    re.DOTALL,
)


def update_section(content: str, start_marker: str, end_marker: str,
                   slots: list) -> tuple:
    """Within [start_marker, end_marker), replace each chart img's src in order."""
    s = content.find(start_marker)
    if s == -1:
        print(f"  {YELLOW}⚠  section marker not found: {start_marker!r}{RESET}")
        return content, 0
    e = content.find(end_marker, s)
    if e == -1:
        e = len(content)

    section = content[s:e]
    matches = list(IMG_RE.finditer(section))
    if len(matches) < len(slots):
        print(f"  {YELLOW}⚠  expected {len(slots)} img tags in section, found {len(matches)}{RESET}")

    # Build new section by walking matches in order and substituting
    out = []
    cursor = 0
    n = 0
    for m, (strategy, png_name) in zip(matches, slots):
        src_png = (BASE / "strategies" / strategy / "outputs" / png_name)
        if not src_png.exists():
            print(f"  {RED}✗  missing PNG: {src_png.relative_to(BASE)}{RESET}")
            continue
        deployed = CHARTS / f"{strategy}_{png_name}"
        # Copy fresh PNG to public location
        shutil.copyfile(src_png, deployed)
        h = short_hash(deployed)

        # Preserve any pre-existing attrs (e.g. class, alt) and ensure the
        # canonical chart attrs are present.
        pre = m.group(1).strip()
        post = m.group(4).strip()
        attrs = " ".join(filter(None, [pre, post])).strip()
        # CSS class .bt-chart-img sizes the chart to fit its container — without
        # it, charts render at natural pixel size and overflow the layout.
        if "bt-chart-img" not in attrs:
            attrs = 'class="bt-chart-img"' + ((" " + attrs) if attrs else "")
        if "alt=" not in attrs:
            attrs += ' alt=""'
        if "loading=" not in attrs:
            attrs += ' loading="lazy"'
        if "decoding=" not in attrs:
            attrs += ' decoding="async"'

        new_tag = f'<img src="assets/charts/{strategy}_{png_name}?v={h}" {attrs}>'
        out.append(section[cursor:m.start()])
        out.append(new_tag)
        cursor = m.end()
        n += 1
    out.append(section[cursor:])

    return content[:s] + "".join(out) + content[e:], n


def main():
    print(f"\n{BOLD}MindForge Capital — chart refresh{RESET}")
    print("=" * 48)

    by_file = defaultdict(list)
    for html, start, end, slots in TASKS:
        by_file[html].append((start, end, slots))

    total_replaced = 0
    files_updated = 0

    for html_path, sections in by_file.items():
        print(f"\n{BOLD}{html_path.name}{RESET}")
        if not html_path.exists():
            print(f"  {RED}✗  missing: {html_path}{RESET}")
            continue

        content = html_path.read_text(encoding="utf-8")
        original = content
        file_n = 0
        for start_marker, end_marker, slots in sections:
            content, n = update_section(content, start_marker, end_marker, slots)
            label = start_marker.strip("<!- >").strip()[:38]
            flag = GREEN + "✓" + RESET if n else YELLOW + "·" + RESET
            print(f"  {flag}  {label:<40} {n} image(s)")
            file_n += n

        if content != original:
            html_path.write_text(content, encoding="utf-8")
            size_kb = html_path.stat().st_size // 1024
            print(f"  → saved  ({size_kb} KB)")
            total_replaced += file_n
            files_updated += 1
        else:
            print(f"  → no changes written")

    print(f"\n{BOLD}Done.{RESET}  {total_replaced} chart(s) refreshed across "
          f"{files_updated} file(s).  Public copies live in "
          f"{CHARTS.relative_to(BASE)}.\n")


if __name__ == "__main__":
    main()
