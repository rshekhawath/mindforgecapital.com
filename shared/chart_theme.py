"""
shared/chart_theme.py
=====================
MindForge Capital — shared matplotlib theme for institutional-grade charts.

A single source of truth for the visual identity used across every backtest's
PNG output. The look is deliberately minimal: a light, slightly-warm cream
background, a crisp typographic hierarchy, subtle gridlines, generous padding,
and a tight three-colour palette that makes strategy-vs-benchmark contrast
read at a glance — even in a printed research deck.

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
# COLOUR PALETTE  —  light, neutral, institutional-grade
# ─────────────────────────────────────────────────────────────────────────────
BG      = "#fafbfd"   # page background — near-white with a faint cool tint
CARD    = "#ffffff"   # plot surface
CARD2   = "#f3f6fb"   # alt row / subtle section background
ACCENT  = "#0c2d5e"   # deep navy — primary strategy ink
ACCENT2 = "#1a50d8"   # strategy line colour (vivid but not saturated)
ACCENT3 = "#3b82f6"   # accent highlights
GREEN   = "#0f9d58"   # positive
RED     = "#d93025"   # negative
GOLD    = "#c08a1e"   # amber accent
TEAL    = "#0e7c86"   # supporting accent
WHITE   = "#0c1831"   # primary text — near-black with a navy undertone
LGRAY   = "#3a4a66"   # secondary text
GRAY    = "#7a8aa0"   # muted text and tick labels
GRID    = "#e7ecf3"   # very subtle gridlines
PURP    = "#7c5cd3"   # supporting accent

STRATEGY_COLOR = ACCENT2
BNH_COLOR      = "#94a3b8"  # cool slate — clearly subordinate to strategy

# Sector palette — used in monthly heatmap / sector breakdown charts
SECTOR_PALETTE = [
    "#1a50d8", "#0f9d58", "#c08a1e", "#d93025", "#7c5cd3",
    "#0e7c86", "#db2777", "#ea580c", "#475569", "#65a30d",
    "#9333ea", "#0891b2",
]

# ─────────────────────────────────────────────────────────────────────────────
# GLOBAL RC — typography and base-font configuration applied at import time
# ─────────────────────────────────────────────────────────────────────────────
plt.rcParams.update({
    "font.family":        ["Helvetica Neue", "Helvetica", "Arial",
                           "DejaVu Sans", "sans-serif"],
    "font.size":           13,
    "axes.titlesize":      16,
    "axes.titleweight":    "semibold",
    "axes.labelsize":      13,
    "axes.labelweight":    "regular",
    "axes.edgecolor":      GRAY,
    "axes.linewidth":      0.8,
    "axes.titlecolor":     WHITE,
    "axes.labelcolor":     LGRAY,
    "axes.spines.top":     False,
    "axes.spines.right":   False,
    "xtick.color":         GRAY,
    "ytick.color":         GRAY,
    "xtick.labelsize":     12,
    "ytick.labelsize":     12,
    "xtick.direction":     "out",
    "ytick.direction":     "out",
    "xtick.major.size":    4,
    "ytick.major.size":    4,
    "xtick.major.width":   0.7,
    "ytick.major.width":   0.7,
    "grid.color":          GRID,
    "grid.linewidth":      0.8,
    "grid.alpha":          1.0,
    "legend.fontsize":     12,
    "legend.frameon":      False,
    "figure.facecolor":    BG,
    "axes.facecolor":      CARD,
    "savefig.facecolor":   BG,
    "savefig.edgecolor":   "none",
    "savefig.bbox":        "tight",
    "savefig.dpi":         200,
})

# ─────────────────────────────────────────────────────────────────────────────
# STYLE HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def style_ax(ax, title="", xlabel="", ylabel="", subtitle=""):
    """Apply MindForge institutional chart style to an Axes object.

    `subtitle` (optional) renders a small grey caption just under the title.
    """
    ax.set_facecolor(CARD)
    ax.figure.patch.set_facecolor(BG)
    # Horizontal gridlines only — keeps eye on price/value, not dates.
    ax.grid(True, which="major", axis="y",
            color=GRID, linewidth=0.8, zorder=0, alpha=1.0)
    ax.grid(False, axis="x")
    ax.set_axisbelow(True)
    for side in ("top", "right"):
        ax.spines[side].set_visible(False)
    for side in ("left", "bottom"):
        ax.spines[side].set_color(GRAY)
        ax.spines[side].set_linewidth(0.8)
    ax.tick_params(colors=GRAY, labelsize=12, length=4, width=0.7)
    ax.yaxis.label.set_color(LGRAY)
    ax.xaxis.label.set_color(LGRAY)
    if title:
        ax.set_title(title, color=WHITE, fontsize=16, fontweight="semibold",
                     pad=22 if subtitle else 14, loc="left")
    if subtitle:
        ax.text(0.0, 1.02, subtitle, transform=ax.transAxes,
                fontsize=12, color=GRAY, ha="left", va="bottom")
    if xlabel:
        ax.set_xlabel(xlabel, color=LGRAY, fontsize=13, labelpad=10)
    if ylabel:
        ax.set_ylabel(ylabel, color=LGRAY, fontsize=13, labelpad=10)


def fmt_xaxis(ax, interval=6):
    """Format x-axis as month ticks (`Mon 'YY`) without label rotation —
    keeps the chart calm and easy to scan."""
    ax.xaxis.set_major_formatter(mdates.DateFormatter("%b %Y"))
    ax.xaxis.set_major_locator(mdates.MonthLocator(interval=interval))
    plt.setp(ax.xaxis.get_majorticklabels(), rotation=0, ha="center",
             color=GRAY, fontsize=12)


def legend(ax, **kwargs):
    """Attach a clean, frameless legend (horizontal by default)."""
    kwargs.setdefault("loc", "upper left")
    kwargs.setdefault("frameon", False)
    kwargs.setdefault("ncols", 1)
    kwargs.setdefault("handlelength", 1.6)
    kwargs.setdefault("handletextpad", 0.6)
    kwargs.setdefault("columnspacing", 1.8)
    leg = ax.legend(fontsize=12, labelcolor=WHITE, **kwargs)
    for text in leg.get_texts():
        text.set_color(WHITE)
        text.set_fontweight("regular")
    return leg


def save(fig, name, output_dir):
    """Save *fig* at 200 dpi (publication quality), then close the figure."""
    path = os.path.join(output_dir, name)
    fig.savefig(path, dpi=200, bbox_inches="tight",
                facecolor=BG, edgecolor="none")
    plt.close(fig)
    print(f"  ✓  {name}")


def make_monthly_pivot(series):
    """Year × Month pivot table with an Annual column (values in %)."""
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
