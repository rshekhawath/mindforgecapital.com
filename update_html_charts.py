#!/usr/bin/env python3
"""
update_html_charts.py
=====================
Re-embeds the latest backtest PNG files into all MindForge Capital HTML files.

Run this script after any backtest to keep the website up to date:
    python update_html_charts.py

This script lives inside MindForge Capital/.
HTML files are in the same folder; PNG folders are one level up in MFC/.
"""

import base64
import re
import sys
from pathlib import Path

# Script lives inside  MindForge Capital/
# HTML files  → same directory as this script
# PNG folders → one level up (MFC/)
WEB  = Path(__file__).parent          # …/MindForge Capital/
BASE = WEB.parent                     # …/MFC/

# ── Colour used for console output ────────────────────────────────────────────
GREEN  = "\033[92m"
YELLOW = "\033[93m"
RED    = "\033[91m"
RESET  = "\033[0m"
BOLD   = "\033[1m"

def b64(png_path: Path) -> str:
    """Read a PNG and return its base64-encoded string."""
    with open(png_path, "rb") as f:
        return base64.b64encode(f.read()).decode("utf-8")

def replace_imgs_in_section(content: str, start_marker: str, end_marker: str,
                             pngs: list[Path]) -> tuple[str, int]:
    """
    Within the slice of *content* bounded by start_marker…end_marker,
    replace each  <img src="data:image/...">  tag in sequence with
    the corresponding PNG from *pngs*.

    Returns (new_content, number_of_replacements_made).
    """
    IMG_RE = re.compile(
        r'(<img\s+src=")data:image/[^;]+;base64,[^"]*("(?:\s[^>]*)?>)',
        re.DOTALL
    )

    start_idx = content.find(start_marker)
    end_idx   = content.find(end_marker, start_idx)
    if start_idx == -1:
        print(f"  {YELLOW}⚠  section marker not found: {start_marker!r}{RESET}")
        return content, 0
    if end_idx == -1:
        end_idx = len(content)           # use rest of file if no end marker

    section   = content[start_idx:end_idx]
    replaced  = 0
    png_iter  = iter(pngs)

    def replacer(m):
        nonlocal replaced
        try:
            png = next(png_iter)
        except StopIteration:
            return m.group(0)            # more img tags than PNGs — leave intact
        if not png.exists():
            print(f"  {RED}✗  PNG not found: {png}{RESET}")
            return m.group(0)
        replaced += 1
        return f'{m.group(1)}data:image/png;base64,{b64(png)}{m.group(2)}'

    new_section = IMG_RE.sub(replacer, section)
    return content[:start_idx] + new_section + content[end_idx:], replaced


# ── Chart manifest ─────────────────────────────────────────────────────────────
# Each entry: (html_path, section_start_marker, section_end_marker, [png_paths])
#
# For strategies.html the same file appears 3 times with different section markers.
# For the standalone pages (largemidcap.html, etc.) use a unique heading marker.

LM  = BASE / "strategies" / "largemidcap" / "outputs"
SM  = BASE / "strategies" / "smallmicro"  / "outputs"
MA  = BASE / "strategies" / "multiasset"  / "outputs"
# WEB is already defined above as Path(__file__).parent

TASKS = [

    # ── strategies.html — MultiAsset section ─────────────────────────────────
    (
        WEB / "strategies.html",
        "<!-- BACKTEST CHARTS -->",
        "<!-- ── LARGEMIDCAP ── -->",
        [
            MA / "01_summary.png",
            MA / "02_growth.png",
            MA / "03_drawdown.png",
            MA / "04_rolling_sharpe.png",
            MA / "05_annual_returns.png",
            MA / "06_monthly_returns.png",
            MA / "07_monthly_heatmap.png",
            MA / "08_allocation_history.png",
            MA / "09_return_distribution.png",
            MA / "10_underwater.png",
        ],
    ),

    # ── strategies.html — LargeMidcap 250 section ────────────────────────────
    (
        WEB / "strategies.html",
        "<!-- LARGEMIDCAP BACKTEST CHARTS -->",
        "<!-- ── SMALLMICRO ── -->",
        [
            LM / "summary.png",
            LM / "equity_curve.png",
            LM / "rolling_metrics.png",
            LM / "return_distribution.png",
            LM / "monthly_heatmap.png",
            LM / "sector_exposure.png",
        ],
    ),

    # ── strategies.html — SmallMicro 500 section ─────────────────────────────
    (
        WEB / "strategies.html",
        "<!-- SMALLMICRO BACKTEST CHARTS -->",
        "<!-- end tabs-wrap -->",
        [
            SM / "summary.png",
            SM / "equity_curve.png",
            SM / "rolling_metrics.png",
            SM / "return_distribution.png",
            SM / "monthly_heatmap_port.png",
            SM / "monthly_heatmap_bench.png",
            SM / "sector_exposure.png",
        ],
    ),

    # ── largemidcap.html — standalone backtest section ───────────────────────
    (
        WEB / "largemidcap.html",
        "<div class=\"section-label\">Backtest Results</div>",
        "<section class=\"content-section\" style=\"border-top:none;\">",
        [
            LM / "summary.png",
            LM / "equity_curve.png",
            LM / "rolling_metrics.png",
            LM / "return_distribution.png",
            LM / "monthly_heatmap.png",
            LM / "sector_exposure.png",
        ],
    ),

    # ── smallmicro.html — standalone backtest section ────────────────────────
    (
        WEB / "smallmicro.html",
        "<div class=\"section-label\">Backtest Results</div>",
        "<section class=\"content-section\" style=\"border-top:none;\">",
        [
            SM / "summary.png",
            SM / "equity_curve.png",
            SM / "rolling_metrics.png",
            SM / "return_distribution.png",
            SM / "monthly_heatmap_port.png",
            SM / "monthly_heatmap_bench.png",
            SM / "sector_exposure.png",
        ],
    ),

    # ── multiasset.html — standalone backtest section ─────────────────────────
    (
        WEB / "multiasset.html",
        "<div class=\"section-label\">Backtest Results</div>",
        "<section class=\"content-section\" style=\"border-top:none;\">",
        [
            MA / "01_summary.png",
            MA / "02_growth.png",
            MA / "03_drawdown.png",
            MA / "04_rolling_sharpe.png",
            MA / "05_annual_returns.png",
            MA / "06_monthly_returns.png",
            MA / "07_monthly_heatmap.png",
            MA / "08_allocation_history.png",
            MA / "09_return_distribution.png",
            MA / "10_underwater.png",
        ],
    ),
]


def main():
    print(f"\n{BOLD}MindForge Capital — HTML chart updater{RESET}")
    print("=" * 48)

    # Group tasks by HTML file so each file is read/written once
    from collections import defaultdict
    by_file = defaultdict(list)
    for html, start, end, pngs in TASKS:
        by_file[html].append((start, end, pngs))

    total_replaced = 0
    files_updated  = 0

    for html_path, section_tasks in by_file.items():
        print(f"\n{BOLD}{html_path.name}{RESET}")
        with open(html_path, "r", encoding="utf-8") as f:
            content = f.read()

        file_replaced = 0
        for start_marker, end_marker, pngs in section_tasks:
            # Verify PNGs exist before touching the file
            missing = [p for p in pngs if not p.exists()]
            if missing:
                for m in missing:
                    print(f"  {RED}✗  missing PNG: {m.name}{RESET}")
                print(f"  {YELLOW}⚠  skipping section — fix missing files first{RESET}")
                continue

            content, n = replace_imgs_in_section(content, start_marker, end_marker, pngs)
            section_label = start_marker.strip("<!- >").strip()[:40]
            print(f"  {GREEN}✓{RESET}  {section_label:<42} {n} image(s) updated")
            file_replaced += n

        if file_replaced:
            with open(html_path, "w", encoding="utf-8") as f:
                f.write(content)
            size_kb = html_path.stat().st_size // 1024
            print(f"  → saved  ({size_kb} KB)")
            total_replaced += file_replaced
            files_updated  += 1
        else:
            print(f"  → no changes written")

    print(f"\n{BOLD}Done.{RESET}  {total_replaced} image(s) refreshed across {files_updated} file(s).\n")


if __name__ == "__main__":
    main()
