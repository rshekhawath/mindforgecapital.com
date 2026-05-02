"""
shared/chart_theme.py
=====================
MindForge Capital — shared matplotlib chart theme.

All three strategy backtests share this identical visual palette.
Import everything you need with:

    from shared.chart_theme import (
        BG, CARD, CARD2, ACCENT, ACCENT2, GREEN, RED, GOLD, TEAL,
        WHITE, LGRAY, GRAY, GRID, SECTOR_PALETTE,
        STRATEGY_COLOR, BNH_COLOR,
        style_ax, fmt_xaxis, legend, save, make_monthly_pivot,
    )
"""

import os
import numpy as np
import matplotlib.pyplot as plt
import matplotlib.dates as mdates

# ─────────────────────────────────────────────────────────────────────────────
# COLOUR PALETTE  (light blue-white, matching mindforge.capital website)
# ─────────────────────────────────────────────────────────────────────────────
BG      = "#f0f5ff"   # light blue-white page background
CARD    = "#ffffff"   # white card surface
CARD2   = "#e4eeff"   # tinted section background
ACCENT  = "#1a50d8"   # primary blue
ACCENT2 = "#2563eb"   # secondary blue
ACCENT3 = "#3b82f6"   # tertiary blue
GREEN   = "#059669"   # green  (darkened for contrast on white)
RED     = "#dc2626"   # red    (darkened for contrast on white)
GOLD    = "#d97706"   # amber  (visible on light background)
TEAL    = "#0891b2"   # teal
WHITE   = "#0c1831"   # dark heading / label text  (repurposed as dark ink)
LGRAY   = "#1e3a5f"   # secondary dark text
GRAY    = "#64748b"   # muted text
GRID    = "#dde3ef"   # subtle light grid lines
PURP    = "#a78bfa"   # soft purple (sector palette)

STRATEGY_COLOR = ACCENT2    # sky blue for strategy line
BNH_COLOR      = "#94a3b8"  # muted slate for benchmark line

# 12-colour sector palette — all from website palette family
SECTOR_PALETTE = [
    "#d97706", "#059669", "#2563eb", "#dc2626", "#7c3aed",
    "#ea580c", "#10b981", "#db2777", "#0891b2", "#65a30d",
    "#9333ea", "#f59e0b",
]

# ─────────────────────────────────────────────────────────────────────────────
# STYLE HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def style_ax(ax, title="", xlabel="", ylabel=""):
    """Apply MindForge chart style to an Axes object."""
    ax.set_facecolor(CARD)
    ax.figure.patch.set_facecolor(BG)
    ax.grid(True, color=GRID, linewidth=0.6, zorder=0, alpha=0.8)
    ax.set_axisbelow(True)
    for spine in ax.spines.values():
        spine.set_color(GRAY)
        spine.set_linewidth(0.5)
    ax.tick_params(colors=LGRAY, labelsize=9)
    ax.yaxis.label.set_color(LGRAY)
    ax.xaxis.label.set_color(LGRAY)
    if title:
        ax.set_title(title, color=WHITE, fontsize=12, fontweight="bold",
                     pad=12, loc="left")
    if xlabel:
        ax.set_xlabel(xlabel, color=LGRAY, fontsize=9)
    if ylabel:
        ax.set_ylabel(ylabel, color=LGRAY, fontsize=9)


def fmt_xaxis(ax, interval=6):
    """Format x-axis as month ticks with 30° label rotation."""
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%b '%y"))
    ax.xaxis.set_major_locator(mdates.MonthLocator(interval=interval))
    plt.setp(ax.xaxis.get_majorticklabels(), rotation=30, ha="right", color=LGRAY)


def legend(ax, **kwargs):
    """Attach a styled legend to the Axes."""
    leg = ax.legend(fontsize=9, framealpha=0.7, labelcolor=WHITE,
                    facecolor=CARD, edgecolor=GRAY, **kwargs)
    for text in leg.get_texts():
        text.set_color(WHITE)


def save(fig, name, output_dir):
    """
    Save *fig* as *name* inside *output_dir* at 150 dpi, then close the figure.

    Parameters
    ----------
    fig        : matplotlib Figure
    name       : str   filename (e.g. "bt2_equity_curve.png")
    output_dir : str   directory to write into (must already exist)
    """
    path = os.path.join(output_dir, name)
    fig.savefig(path, dpi=150, bbox_inches="tight",
                facecolor=BG, edgecolor="none")
    plt.close(fig)
    print(f"  ✓  {name}")


def make_monthly_pivot(series):
    """
    Convert a monthly-frequency return Series (values as fractions, not %)
    into a Year × Month pivot table with an Annual column.

    Returns a DataFrame with month-name columns + 'Annual'.
    """
    MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
    df = series.rename("ret").to_frame()
    df["Year"]  = df.index.year
    df["Month"] = df.index.month
    pv = df.pivot_table(values="ret", index="Year", columns="Month",
                        aggfunc="sum") * 100
    pv.columns = [MONTH_LABELS[m - 1] for m in pv.columns]
    pv["Annual"] = pv[MONTH_LABELS].apply(
        lambda r: ((1 + r.dropna() / 100).prod() - 1) * 100, axis=1)
    return pv
