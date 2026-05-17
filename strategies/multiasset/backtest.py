"""
MultiFactor MultiAsset — Backtest
==================================
Universe: 6 ETFs (Nifty 50, Nifty Next 50, Nifty Midcap 150,
          Gold, Bharat Bond, NASDAQ)

Factor model: 3M/6M/12M momentum × volatility-adjustment × 40-week MA trend filter.
Rebalances monthly, weekly price data.

Outputs saved to outputs/
--------------------------
  summary.png
  growth.png
  rolling_returns.png
  drawdown.png
  fund_vs_bench.png
"""

import os, sys, warnings
import numpy as np
import pandas as pd
import yfinance as yf
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches
import matplotlib.ticker as mticker
import matplotlib.dates as mdates
from matplotlib.colors import LinearSegmentedColormap

# ── Shared modules ────────────────────────────────────────────────────────────
ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, ROOT_DIR)

from shared.config import MULTIASSET, BENCHMARKS, RISK_FREE
from shared.chart_theme import (
    BG, CARD, CARD2, ACCENT, ACCENT2, GREEN, RED, GOLD, TEAL,
    WHITE, LGRAY, GRAY, GRID,
    STRATEGY_COLOR, BNH_COLOR,
    style_ax, fmt_xaxis, legend, save,
)

warnings.filterwarnings("ignore")

# ─────────────────────────────────────────────────────────────────────────────
# CONFIG
# ─────────────────────────────────────────────────────────────────────────────
BASE_DIR    = os.path.dirname(os.path.abspath(__file__))
OUTPUTS_DIR = os.path.join(BASE_DIR, "outputs")
os.makedirs(OUTPUTS_DIR, exist_ok=True)

ASSETS        = MULTIASSET["ASSETS"]
# Benchmark: static, fixed-CAGR — sourced from shared.config.BENCHMARKS.
# The strategy comparison is anchored against Nifty 50 historical CAGR.
# Strategy logic is unchanged; only the benchmark series and reported
# benchmark metrics derive from this constant.
BENCH_CFG     = BENCHMARKS["multiasset"]
BENCH_LABEL   = BENCH_CFG["name"]
BENCH_SHORT   = BENCH_CFG["short"]
BENCH_CAGR    = BENCH_CFG["cagr"]
WEEKS_3M      = MULTIASSET["WEEKS_3M"]
WEEKS_6M      = MULTIASSET["WEEKS_6M"]
WEEKS_12M     = MULTIASSET["WEEKS_12M"]
MA_WEEKS      = MULTIASSET["MA_WEEKS"]
VOL_PENALTY   = MULTIASSET["VOL_PENALTY"]
VOL_ADJ_FLOOR = MULTIASSET["VOL_ADJ_FLOOR"]
TREND_PENALTY = MULTIASSET["TREND_PENALTY"]
INITIAL_AUM   = MULTIASSET["INITIAL_AUM"]

ASSET_COLORS = {
    "Nifty 50 ETF":         "#64748b",
    "Nifty Next 50 ETF":    "#0891b2",
    "Nifty Midcap 150 ETF": "#2563eb",
    "Gold ETF":             "#d97706",
    "Bharat Bond ETF":      "#059669",
    "NASDAQ ETF":           "#1a50d8",
}

def _save(fig, name):
    save(fig, name, OUTPUTS_DIR)

# ─────────────────────────────────────────────────────────────────────────────
# FETCH DATA
# ─────────────────────────────────────────────────────────────────────────────
print("Fetching weekly price data (5y)...")
prices = {}
for name, ticker in ASSETS.items():
    try:
        tk = yf.Ticker(ticker)
        df = tk.history(period="5y", interval="1d", auto_adjust=True)
        if df.empty:
            print(f"  ⚠  {name}: no data"); continue
        weekly = df["Close"].resample("W-FRI").last().dropna()
        prices[name] = weekly
        print(f"  ✓  {name}: {len(weekly)} weeks "
              f"({weekly.index[0].date()} → {weekly.index[-1].date()})")
    except Exception as e:
        print(f"  ✗  {name}: {e}")

price_df = pd.DataFrame(prices).ffill().dropna()
print(f"\nClean data: {len(price_df)} weeks × {len(price_df.columns)} assets")
print(f"Range: {price_df.index[0].date()} → {price_df.index[-1].date()}\n")

# Benchmark — static, fixed-CAGR exponential curve at BENCH_CAGR
# (no market data is fetched for the benchmark; values come from
# shared.config.BENCHMARKS so they can be refreshed centrally)
print(f"Benchmark: {BENCH_LABEL}  ·  fixed CAGR {BENCH_CAGR*100:.2f}%\n")

# ─────────────────────────────────────────────────────────────────────────────
# ALLOCATION
# ─────────────────────────────────────────────────────────────────────────────

def annualised_vol(series):
    return series.pct_change().dropna().std() * np.sqrt(52)

def compute_allocation(price_df, i):
    assets = list(price_df.columns)
    data   = {}
    for name in assets:
        close   = price_df[name]
        current = close.iloc[i]
        m3      = current / close.iloc[i - WEEKS_3M]  - 1
        m6      = current / close.iloc[i - WEEKS_6M]  - 1
        m12     = current / close.iloc[i - WEEKS_12M] - 1
        avg_mom = np.mean([m3, m6, m12])
        ma10    = close.iloc[max(0, i - MA_WEEKS + 1):i + 1].mean()
        above   = current > ma10
        vol     = annualised_vol(close.iloc[i - WEEKS_12M:i + 1])
        data[name] = {"avg_mom": avg_mom, "above_ma": above, "vol": vol}
    vols = np.array([d["vol"] for d in data.values()])
    vm, vs = vols.mean(), vols.std() if vols.std() > 0 else 1.0
    for d in data.values():
        d["vol_z"] = (d["vol"] - vm) / vs
    for d in data.values():
        vol_adj   = max(1.0 - VOL_PENALTY * d["vol_z"], VOL_ADJ_FLOOR)
        trend_adj = 1.0 if d["above_ma"] else TREND_PENALTY
        d["score"] = d["avg_mom"] * vol_adj * trend_adj
    scores = np.array([d["score"] for d in data.values()])
    shift  = abs(scores.min()) + 0.01 if scores.min() <= 0 else 0.0
    total  = sum(d["score"] + shift for d in data.values())
    return {name: (d["score"] + shift) / total for name, d in data.items()}

# ─────────────────────────────────────────────────────────────────────────────
# BACKTEST
# ─────────────────────────────────────────────────────────────────────────────
print("Running backtest...")
assets         = list(price_df.columns)
n_weeks        = len(price_df)
MIN_START      = WEEKS_12M + 1
portfolio_val  = INITIAL_AUM
holdings       = {}
weekly_records = []
alloc_history  = []

for i in range(n_weeks):
    week  = price_df.index[i]
    cur_p = price_df.iloc[i]
    if holdings:
        portfolio_val = sum(holdings.get(a, 0) * cur_p[a] for a in assets)
    if i < MIN_START:
        weekly_records.append({"week": week, "torque": portfolio_val, "bnh": INITIAL_AUM})
        continue
    is_rebal = (i == MIN_START) or (week.month != price_df.index[i - 1].month)
    if is_rebal:
        alloc    = compute_allocation(price_df, i)
        holdings = {name: (alloc[name] * portfolio_val) / cur_p[name] for name in assets}
        alloc_history.append((week, dict(alloc)))
    weekly_records.append({"week": week, "torque": portfolio_val, "bnh": None})

# Benchmark equity: smooth exponential at BENCH_CAGR. Stays flat at
# INITIAL_AUM during the strategy warm-up (so both lines visually start
# from the same plateau), then compounds at the configured rate.
weekly_growth = (1.0 + BENCH_CAGR) ** (1.0 / 52.0)
for idx_i, rec in enumerate(weekly_records):
    rec["bnh"] = (
        INITIAL_AUM * (weekly_growth ** (idx_i - MIN_START))
        if idx_i >= MIN_START
        else INITIAL_AUM
    )

results    = pd.DataFrame(weekly_records).set_index("week")
torque     = results["torque"].dropna()
bnh        = results["bnh"].dropna()
start_date = max(torque.index[0], bnh.index[0])
torque     = torque[torque.index >= start_date]
bnh        = bnh[bnh.index >= start_date]
torque_idx = torque / torque.iloc[0] * 100
bnh_idx    = bnh    / bnh.iloc[0]    * 100

# ─────────────────────────────────────────────────────────────────────────────
# METRICS
# ─────────────────────────────────────────────────────────────────────────────

def metrics(series, label):
    s      = series.dropna()
    mr     = s.pct_change().dropna()
    n_y    = len(s) / 52
    tot    = s.iloc[-1] / s.iloc[0] - 1
    cagr   = (1 + tot) ** (1 / n_y) - 1
    vol    = mr.std() * np.sqrt(52)
    sharpe = (cagr - RISK_FREE) / vol
    dd     = s / s.cummax() - 1
    mdd    = dd.min()
    calmar = cagr / abs(mdd) if mdd != 0 else np.nan
    win    = (mr > 0).sum() / len(mr)
    return {
        "Strategy": label, "Total Return": tot, "CAGR": cagr,
        "Volatility": vol, "Sharpe Ratio": sharpe, "Max Drawdown": mdd,
        "Calmar Ratio": calmar, "Win Rate": win,
        "Best Week": mr.max(), "Worst Week": mr.min(),
        "Final Value": s.iloc[-1] * (INITIAL_AUM / 100),
    }

mt = metrics(torque_idx, "MultiFactor MultiAsset")
mb = metrics(bnh_idx,    BENCH_LABEL)
# Override mb['CAGR'] with the *configured* benchmark CAGR — the static
# benchmark is a target, not a computed series. The series exists only to
# render a clean reference line on charts. The displayed metric is always
# the value from shared.config.BENCHMARKS.
mb["CAGR"] = BENCH_CAGR
# The benchmark is a static, smooth exponential at fixed CAGR — so volatility-
# derived metrics (Sharpe, Vol, Max DD, Win Rate, Best/Worst Week) are not
# meaningful and are displayed as "—" in the scorecard.
BENCH_IS_STATIC = True

rolling_sharpe_t = (torque_idx.pct_change()
    .rolling(52).apply(lambda r: (r.mean()*52 - RISK_FREE) / (r.std()*np.sqrt(52))
                       if r.std() > 1e-6 else np.nan))
rolling_sharpe_b = (bnh_idx.pct_change()
    .rolling(52).apply(lambda r: (r.mean()*52 - RISK_FREE) / (r.std()*np.sqrt(52))
                       if r.std() > 1e-6 else np.nan))
rolling_dd_t = torque_idx / torque_idx.cummax() - 1
rolling_dd_b = bnh_idx    / bnh_idx.cummax()    - 1

t_monthly = torque_idx.resample("ME").last().pct_change().dropna()
b_monthly = bnh_idx.resample("ME").last().pct_change().dropna()
t_annual  = torque_idx.resample("YE").last().pct_change().dropna()
b_annual  = bnh_idx.resample("YE").last().pct_change().dropna()

print("\nGenerating charts...")

STRAT_NAME    = "MultiFactor MultiAsset"
PERIOD_LABEL  = f"{price_df.index[0].date()} → {price_df.index[-1].date()}"

# ─────────────────────────────────────────────────────────────────────────────
# CHART 1 — Performance scorecard
# ─────────────────────────────────────────────────────────────────────────────
fig = plt.figure(figsize=(14, 6.5))
fig.patch.set_facecolor(BG)
ax  = fig.add_axes([0.03, 0.04, 0.94, 0.84])
ax.set_facecolor(CARD); ax.axis("off")

# Header band
fig.text(0.03, 0.945, STRAT_NAME, fontsize=17, fontweight="semibold",
         color=WHITE, ha="left", va="center")
fig.text(0.03, 0.905, f"Performance summary  ·  Backtest {PERIOD_LABEL}",
         fontsize=10.5, color=GRAY, ha="left", va="center")
fig.text(0.97, 0.945, "MindForge Capital", fontsize=10.5, color=GRAY,
         ha="right", va="center", style="italic")

# Hero row — three large KPIs
hero = [
    ("STRATEGY CAGR",   f"{mt['CAGR']*100:.1f}%",        ACCENT2),
    ("BENCHMARK CAGR",  f"{mb['CAGR']*100:.2f}%",        GRAY),
    ("ALPHA (annual)",  f"{(mt['CAGR']-mb['CAGR'])*100:+.2f}%", GREEN if mt['CAGR']>mb['CAGR'] else RED),
]
hero_y = 0.78
for i, (label, value, color) in enumerate(hero):
    x = 0.07 + i * 0.305
    ax.text(x, hero_y + 0.08, label, transform=ax.transAxes,
            fontsize=9, fontweight="semibold", color=GRAY,
            ha="left", va="bottom")
    ax.text(x, hero_y - 0.02, value, transform=ax.transAxes,
            fontsize=28, fontweight="bold", color=color,
            ha="left", va="top")

# Divider
ax.plot([0.03, 0.97], [0.68, 0.68], transform=ax.transAxes,
        color=GRID, lw=0.8, solid_capstyle="butt")

# Metrics grid (5 metrics × 2 columns of strat/bench)
DASH = "—"
metrics_rows = [
    ("Total return",  f"{mt['Total Return']:.1%}",  f"{mb['Total Return']:.1%}", True),
    ("Volatility",    f"{mt['Volatility']:.1%}",    DASH,                         False),
    ("Sharpe ratio",  f"{mt['Sharpe Ratio']:.2f}",  DASH,                         True),
    ("Max drawdown",  f"{mt['Max Drawdown']:.1%}",  DASH,                         False),
    ("Calmar ratio",  f"{mt['Calmar Ratio']:.2f}",  DASH,                         True),
    ("Win rate",      f"{mt['Win Rate']:.1%}",      DASH,                         True),
    ("Best week",     f"{mt['Best Week']:.1%}",     DASH,                         True),
    ("Final value",   f"₹{mt['Final Value']/100000:.1f}L",
                      f"₹{mb['Final Value']/100000:.1f}L",                        True),
]

table_top = 0.62
n_rows    = len(metrics_rows)
row_h     = 0.062
col_xs    = [0.05, 0.46, 0.66, 0.88]
ax.text(col_xs[0], table_top + 0.025, "METRIC",    transform=ax.transAxes,
        fontsize=8.5, fontweight="semibold", color=GRAY)
ax.text(col_xs[1], table_top + 0.025, "STRATEGY",  transform=ax.transAxes,
        fontsize=8.5, fontweight="semibold", color=GRAY)
ax.text(col_xs[2], table_top + 0.025, "BENCHMARK", transform=ax.transAxes,
        fontsize=8.5, fontweight="semibold", color=GRAY)
ax.text(col_xs[3], table_top + 0.025, "EDGE",      transform=ax.transAxes,
        fontsize=8.5, fontweight="semibold", color=GRAY)

for ri, (label, tv, bv, higher_better) in enumerate(metrics_rows):
    y = table_top - (ri + 1) * row_h
    # Subtle alternating row fill — adds rhythm without clutter
    if ri % 2 == 0:
        ax.add_patch(mpatches.Rectangle(
            (0.04, y - 0.02), 0.92, row_h - 0.005,
            transform=ax.transAxes, facecolor=CARD2, edgecolor="none", zorder=0))
    ax.text(col_xs[0], y, label, transform=ax.transAxes,
            fontsize=10.5, color=LGRAY, va="center")
    # Compare numerically when both values are numeric
    show_edge = (bv != DASH)
    if show_edge:
        try:
            tnum = float(tv.replace("₹","").replace("L","").replace("%",""))
            bnum = float(bv.replace("₹","").replace("L","").replace("%",""))
            t_wins = (higher_better and tnum > bnum) or (not higher_better and tnum < bnum)
        except ValueError:
            t_wins = False
        edge   = "Strategy" if t_wins else "Benchmark"
        ecolor = GREEN if t_wins else RED
    else:
        t_wins, edge, ecolor = True, DASH, GRAY
    ax.text(col_xs[1], y, tv, transform=ax.transAxes,
            fontsize=11, fontweight="semibold",
            color=WHITE, va="center")
    ax.text(col_xs[2], y, bv, transform=ax.transAxes,
            fontsize=11, color=GRAY, va="center")
    ax.text(col_xs[3], y, edge, transform=ax.transAxes,
            fontsize=10, color=ecolor, va="center", fontweight="semibold")

fig.text(0.03, 0.025,
         f"Benchmark: {BENCH_LABEL}  ·  Fixed CAGR {BENCH_CAGR*100:.2f}% "
         f"(public historical 5Y reference, sourced from NSE / NSE Indices factsheets).",
         ha="left", va="center", fontsize=8.5, color=GRAY, style="italic")
fig.text(0.97, 0.025, f"Simulated. Not investment advice.",
         ha="right", va="center", fontsize=8.5, color=GRAY)
_save(fig, "summary.png")

# ─────────────────────────────────────────────────────────────────────────────
# CHART 2 — Growth of ₹1,00,000
# ─────────────────────────────────────────────────────────────────────────────
DISPLAY_INITIAL = 100000
dates = torque_idx.index
port_growth_ma  = torque_idx / torque_idx.iloc[0] * DISPLAY_INITIAL
bench_growth_ma = bnh_idx    / bnh_idx.iloc[0]    * DISPLAY_INITIAL

fig, ax = plt.subplots(figsize=(13, 5.2))
ax.plot(dates, bench_growth_ma, color=BNH_COLOR, lw=1.6, ls=(0, (4, 3)),
        label=f"{BENCH_SHORT}  ·  {mb['CAGR']*100:.2f}% CAGR", zorder=2)
ax.plot(dates, port_growth_ma, color=STRATEGY_COLOR, lw=2.6,
        label=f"{STRAT_NAME}  ·  {mt['CAGR']*100:.1f}% CAGR", zorder=3)
ax.fill_between(dates, port_growth_ma, bench_growth_ma,
                where=(port_growth_ma >= bench_growth_ma),
                alpha=0.12, color=ACCENT2, linewidth=0, zorder=1)
ax.yaxis.set_major_formatter(mticker.FuncFormatter(
    lambda x, _: f"₹{x/100000:.1f}L" if x >= 100000 else f"₹{x:,.0f}"))
# Endpoint callouts
pv_ma = float(port_growth_ma.iloc[-1]); bv_ma = float(bench_growth_ma.iloc[-1])
pv_lbl = f"₹{pv_ma/100000:.1f}L"; bv_lbl = f"₹{bv_ma/100000:.1f}L"
ax.annotate(pv_lbl, xy=(dates[-1], pv_ma),
            xytext=(8, 0), textcoords="offset points",
            fontsize=10.5, color=ACCENT, fontweight="semibold",
            va="center", ha="left", annotation_clip=False)
ax.annotate(bv_lbl, xy=(dates[-1], bv_ma),
            xytext=(8, 0), textcoords="offset points",
            fontsize=10, color=GRAY,
            va="center", ha="left", annotation_clip=False)
style_ax(ax, "Growth of ₹1,00,000",
         "", "Portfolio value",
         subtitle=f"{STRAT_NAME} vs {BENCH_LABEL}  ·  {PERIOD_LABEL}")
fmt_xaxis(ax)
legend(ax, loc="upper left", ncols=2)
fig.tight_layout(pad=1.8)
_save(fig, "growth.png")

# ─────────────────────────────────────────────────────────────────────────────
# CHART 3 — Drawdown (strategy only — static benchmark has no DD)
# ─────────────────────────────────────────────────────────────────────────────
fig, ax = plt.subplots(figsize=(13, 4.5))
dd_pct = rolling_dd_t * 100
ax.fill_between(dates, dd_pct, 0, color=RED, alpha=0.18, linewidth=0, zorder=1)
ax.plot(dates, dd_pct, color=RED, lw=1.6, zorder=2,
        label=f"{STRAT_NAME}")
ax.axhline(0, color=GRAY, lw=0.6, zorder=0)
ax.yaxis.set_major_formatter(mticker.FuncFormatter(lambda x, _: f"{x:.0f}%"))
mdd_pt = dd_pct.idxmin(); mdd_v = float(dd_pct.min())
ax.scatter([mdd_pt], [mdd_v], s=22, color=RED, zorder=3)
ax.annotate(f"Max DD  {mdd_v:.1f}%",
            xy=(mdd_pt, mdd_v), xytext=(10, 14),
            textcoords="offset points", fontsize=9.5, color=RED,
            fontweight="semibold",
            arrowprops=dict(arrowstyle="-", color=RED, lw=0.6, alpha=0.7))
style_ax(ax, "Drawdown from peak",
         "", "Drawdown",
         subtitle=f"{STRAT_NAME}  ·  realised drawdowns over the backtest")
fmt_xaxis(ax)
legend(ax, loc="lower left")
fig.tight_layout(pad=1.8)
_save(fig, "drawdown.png")

# ─────────────────────────────────────────────────────────────────────────────
# CHART 4 — Rolling Returns (2-panel: 52-week CAGR + Sharpe)
# ─────────────────────────────────────────────────────────────────────────────
rolling_cagr_t = (torque_idx.pct_change()
    .rolling(52).apply(lambda r: (1 + r).prod() ** (52 / 52) - 1))
rolling_cagr_b_ma = pd.Series(BENCH_CAGR, index=dates)  # static line at BENCH_CAGR

fig, axes = plt.subplots(2, 1, figsize=(13, 8.5))
fig.patch.set_facecolor(BG)

ax = axes[0]
ax.plot(dates, rolling_cagr_b_ma * 100, color=BNH_COLOR, lw=1.6,
        ls=(0, (4, 3)), label=f"{BENCH_SHORT}  ·  {BENCH_CAGR*100:.2f}% CAGR (static)")
ax.plot(dates, rolling_cagr_t.reindex(dates) * 100,
        color=STRATEGY_COLOR, lw=2.2, label=STRAT_NAME)
ax.axhline(0, color=GRAY, lw=0.6, zorder=0)
ax.yaxis.set_major_formatter(mticker.FuncFormatter(lambda x, _: f"{x:.0f}%"))
style_ax(ax, "Rolling 52-week performance",
         "", "Rolling 52W CAGR",
         subtitle=f"{STRAT_NAME}  ·  trailing 12-month annualised return at each point")
fmt_xaxis(ax)
legend(ax, loc="upper left", ncols=2)

ax = axes[1]
rs_t = rolling_sharpe_t.reindex(dates)
ax.plot(dates, rs_t, color=STRATEGY_COLOR, lw=2.2, label=STRAT_NAME)
ax.axhline(0, color=GRAY, lw=0.6, zorder=0)
ax.axhline(1, color=GREEN, lw=0.7, ls=(0, (3, 3)), alpha=0.7,
           label="Sharpe = 1.0")
style_ax(ax, "Rolling Sharpe ratio",
         "", "Sharpe ratio (52W)",
         subtitle="Risk-adjusted return — strategy excess return per unit of volatility")
fmt_xaxis(ax)
legend(ax, loc="upper left", ncols=2)

fig.tight_layout(pad=2.4)
_save(fig, "rolling_returns.png")

# ─────────────────────────────────────────────────────────────────────────────
# CHART 5 — Fund vs Benchmark — Cumulative % Returns from 0%
# ─────────────────────────────────────────────────────────────────────────────
port_cum_ma  = (torque_idx / torque_idx.iloc[0] - 1) * 100
bench_cum_ma = (bnh_idx    / bnh_idx.iloc[0]    - 1) * 100

fig, ax = plt.subplots(figsize=(13, 5.2))
ax.plot(dates, bench_cum_ma, color=BNH_COLOR, lw=1.6, ls=(0, (4, 3)),
        label=f"{BENCH_SHORT}  ·  {mb['CAGR']*100:.2f}% CAGR", zorder=2)
ax.plot(dates, port_cum_ma, color=STRATEGY_COLOR, lw=2.6,
        label=f"{STRAT_NAME}  ·  {mt['CAGR']*100:.1f}% CAGR", zorder=3)
ax.fill_between(dates, port_cum_ma, bench_cum_ma,
                where=(port_cum_ma >= bench_cum_ma),
                alpha=0.12, color=ACCENT2, linewidth=0, zorder=1)
ax.axhline(0, color=GRAY, lw=0.6)
ax.yaxis.set_major_formatter(mticker.FuncFormatter(lambda x, _: f"{x:.0f}%"))
pv_cum = float(port_cum_ma.iloc[-1]); bv_cum = float(bench_cum_ma.iloc[-1])
ax.annotate(f"{pv_cum:+.0f}%", xy=(dates[-1], pv_cum),
            xytext=(8, 0), textcoords="offset points",
            fontsize=10.5, color=ACCENT, fontweight="semibold",
            va="center", ha="left", annotation_clip=False)
ax.annotate(f"{bv_cum:+.0f}%", xy=(dates[-1], bv_cum),
            xytext=(8, 0), textcoords="offset points",
            fontsize=10, color=GRAY,
            va="center", ha="left", annotation_clip=False)
style_ax(ax, "Cumulative returns",
         "", "Cumulative return",
         subtitle=f"{STRAT_NAME} vs {BENCH_LABEL}  ·  rebased to 0% at inception")
fmt_xaxis(ax)
legend(ax, loc="upper left", ncols=2)
fig.tight_layout(pad=1.8)
_save(fig, "fund_vs_bench.png")

# ─────────────────────────────────────────────────────────────────────────────
# SAVE STATS JSON
# ─────────────────────────────────────────────────────────────────────────────
import json as _json
from datetime import datetime as _dt

_alpha = mt["CAGR"] - mb["CAGR"]
_stats_out = {
    "cagr":         f"{mt['CAGR']*100:.1f}%",
    "bench_cagr":   f"{BENCH_CAGR*100:.2f}%",      # static, sourced from config
    "bench_name":   BENCH_LABEL,
    "alpha":        f"{_alpha*100:+.2f}%",
    "sharpe":       f"{mt['Sharpe Ratio']:.2f}",
    "bench_sharpe": "—",                            # not applicable for static bench
    "max_dd":       f"{mt['Max Drawdown']*100:.1f}%",
    "bench_max_dd": "—",                            # not applicable for static bench
    "last_updated": _dt.now().strftime("%b %Y"),
}
with open(os.path.join(OUTPUTS_DIR, "stats.json"), "w") as _f:
    _json.dump(_stats_out, _f, indent=2)
print(f"  ✓  stats.json")

print(f"""
✅  All charts saved to:
    {OUTPUTS_DIR}

    summary.png              — performance scorecard
    growth.png               — growth of ₹1,00,000
    rolling_returns.png      — rolling 52W CAGR + Sharpe
    drawdown.png             — drawdown from peak
    fund_vs_bench.png        — cumulative % returns from 0%
    stats.json               — key metrics for website injection
""")
