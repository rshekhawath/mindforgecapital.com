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

from shared.config import MULTIASSET, RISK_FREE
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

bnh_prices   = price_df.iloc[MIN_START]
bnh_holdings = {a: (INITIAL_AUM / len(assets)) / bnh_prices[a] for a in assets}
for idx_i, rec in enumerate(weekly_records):
    cur_p    = price_df.iloc[idx_i]
    rec["bnh"] = sum(bnh_holdings[a] * cur_p[a] for a in assets) if idx_i >= MIN_START else INITIAL_AUM

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
mb = metrics(bnh_idx,    "Buy-Hold EW")

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

# ─────────────────────────────────────────────────────────────────────────────
# CHART 1 — Summary scorecard
# ─────────────────────────────────────────────────────────────────────────────
fig, ax = plt.subplots(figsize=(11, 5.5))
ax.set_facecolor(CARD); fig.patch.set_facecolor(BG); ax.axis("off")

metrics_rows = [
    ("Total return",  f"{mt['Total Return']:.1%}",  f"{mb['Total Return']:.1%}",  True),
    ("CAGR",          f"{mt['CAGR']:.1%}",          f"{mb['CAGR']:.1%}",          True),
    ("Volatility",    f"{mt['Volatility']:.1%}",    f"{mb['Volatility']:.1%}",    False),
    ("Sharpe ratio",  f"{mt['Sharpe Ratio']:.2f}",  f"{mb['Sharpe Ratio']:.2f}",  True),
    ("Max drawdown",  f"{mt['Max Drawdown']:.1%}",  f"{mb['Max Drawdown']:.1%}",  False),
    ("Calmar ratio",  f"{mt['Calmar Ratio']:.2f}",  f"{mb['Calmar Ratio']:.2f}",  True),
    ("Win rate",      f"{mt['Win Rate']:.1%}",      f"{mb['Win Rate']:.1%}",      True),
    ("Best week",     f"{mt['Best Week']:.1%}",     f"{mb['Best Week']:.1%}",     True),
    ("Worst week",    f"{mt['Worst Week']:.1%}",    f"{mb['Worst Week']:.1%}",    False),
    ("Final value ₹", f"₹{mt['Final Value']/100000:.1f}L",
                      f"₹{mb['Final Value']/100000:.1f}L", True),
]

col_x   = [0.02, 0.42, 0.66, 0.88]
headers = ["Metric", "MultiFactor MultiAsset", "Buy-Hold EW", "Edge"]
row_h   = 0.082; y_start = 0.92

for xi, h in zip(col_x, headers):
    ax.text(xi, y_start, h, transform=ax.transAxes, fontsize=9.5,
            fontweight="bold", color=WHITE,
            bbox=dict(boxstyle="round,pad=0.3", facecolor=ACCENT, edgecolor="none", alpha=0.9))

for ri, (label, tv, bv, higher_better) in enumerate(metrics_rows):
    y      = y_start - (ri + 1) * row_h
    row_bg = CARD2 if ri % 2 == 0 else CARD
    ax.add_patch(mpatches.FancyBboxPatch(
        (0, y - 0.025), 1, row_h * 0.95,
        transform=ax.transAxes, boxstyle="square,pad=0",
        facecolor=row_bg, edgecolor="none", zorder=0))
    tv_num = float(tv.replace("₹","").replace("L","").replace("%","").replace("−","-")) if tv != "—" else 0
    bv_num = float(bv.replace("₹","").replace("L","").replace("%","").replace("−","-")) if bv != "—" else 0
    t_wins = (higher_better and tv_num > bv_num) or (not higher_better and tv_num < bv_num)
    edge   = "Strategy ✓" if t_wins else "BnH ✓"
    ax.text(col_x[0], y, label, transform=ax.transAxes, fontsize=9, color=LGRAY)
    ax.text(col_x[1], y, tv,    transform=ax.transAxes, fontsize=9,
            color=GREEN if t_wins else RED, fontweight="bold")
    ax.text(col_x[2], y, bv,    transform=ax.transAxes, fontsize=9,
            color=RED if t_wins else GREEN)
    ax.text(col_x[3], y, edge,  transform=ax.transAxes, fontsize=9,
            color=TEAL if t_wins else GRAY)

ax.set_title("MultiFactor MultiAsset — Performance Summary",
             color=WHITE, fontsize=13, fontweight="bold", loc="left", pad=16, y=1.01)
fig.text(0.99, 0.01, f"Backtest: {price_df.index[MIN_START].date()} → {price_df.index[-1].date()}",
         ha="right", va="bottom", fontsize=7.5, color=GRAY)
_save(fig, "summary.png")

# ─────────────────────────────────────────────────────────────────────────────
# CHART 2 — Growth of ₹1,00,000
# ─────────────────────────────────────────────────────────────────────────────
DISPLAY_INITIAL = 100000
dates = torque_idx.index
port_growth_ma  = torque_idx / torque_idx.iloc[0] * DISPLAY_INITIAL
bench_growth_ma = bnh_idx    / bnh_idx.iloc[0]    * DISPLAY_INITIAL

fig, ax = plt.subplots(figsize=(12, 5))
ax.plot(dates, port_growth_ma, color=STRATEGY_COLOR, lw=2.2,
        label=f"MultiFactor MultiAsset  CAGR {mt['CAGR']:.1%}", zorder=3)
ax.plot(dates, bench_growth_ma, color=BNH_COLOR, lw=1.5, ls="--",
        label=f"Buy-Hold EW  CAGR {mb['CAGR']:.1%}", zorder=2)
ax.fill_between(dates, port_growth_ma, bench_growth_ma,
                where=(port_growth_ma >= bench_growth_ma), alpha=0.15, color=GREEN)
ax.fill_between(dates, port_growth_ma, bench_growth_ma,
                where=(port_growth_ma < bench_growth_ma), alpha=0.10, color=RED)
ax.yaxis.set_major_formatter(mticker.FuncFormatter(
    lambda x, _: f"₹{x/100000:.1f}L" if x >= 100000 else f"₹{x:,.0f}"))
# Final value callouts at line endpoints
pv_ma = float(port_growth_ma.iloc[-1])
bv_ma = float(bench_growth_ma.iloc[-1])
pv_ma_lbl = f"₹{pv_ma/100000:.1f}L" if pv_ma >= 100000 else f"₹{pv_ma:,.0f}"
bv_ma_lbl = f"₹{bv_ma/100000:.1f}L" if bv_ma >= 100000 else f"₹{bv_ma:,.0f}"
ax.annotate(pv_ma_lbl, xy=(dates[-1], pv_ma),
            xytext=(6, 2), textcoords="offset points",
            fontsize=9, color=STRATEGY_COLOR, fontweight="bold",
            va="bottom", ha="left", annotation_clip=False)
ax.annotate(bv_ma_lbl, xy=(dates[-1], bv_ma),
            xytext=(6, -8), textcoords="offset points",
            fontsize=9, color=BNH_COLOR,
            va="top", ha="left", annotation_clip=False)
legend(ax)
style_ax(ax, f"Growth of ₹1,00,000  |  Strategy {mt['CAGR']:.1%} CAGR  vs  BnH {mb['CAGR']:.1%}",
         "", "Portfolio value (₹)")
fmt_xaxis(ax)
fig.tight_layout(pad=1.5)
_save(fig, "growth.png")

# ─────────────────────────────────────────────────────────────────────────────
# CHART 3 — Drawdown
# ─────────────────────────────────────────────────────────────────────────────
fig, ax = plt.subplots(figsize=(12, 4))
ax.fill_between(dates, rolling_dd_t*100, 0, alpha=0.35, color=STRATEGY_COLOR, label="MultiFactor MultiAsset")
ax.fill_between(dates, rolling_dd_b*100, 0, alpha=0.20, color=BNH_COLOR, label="Buy-Hold EW")
ax.plot(dates, rolling_dd_t*100, color=STRATEGY_COLOR, lw=1.4)
ax.plot(dates, rolling_dd_b*100, color=BNH_COLOR, lw=1.0, ls="--")
ax.yaxis.set_major_formatter(mticker.FuncFormatter(lambda x, _: f"{x:.0f}%"))
legend(ax)
style_ax(ax, "Drawdown from Peak", "", "Drawdown (%)")
fmt_xaxis(ax)
fig.tight_layout(pad=1.5)
_save(fig, "drawdown.png")

# ─────────────────────────────────────────────────────────────────────────────
# CHART 4 — Rolling Returns (2-panel: 52-week CAGR + Sharpe)
# ─────────────────────────────────────────────────────────────────────────────
rolling_cagr_t = (torque_idx.pct_change()
    .rolling(52).apply(lambda r: (1 + r).prod() ** (52 / 52) - 1))
rolling_cagr_b_ma = (bnh_idx.pct_change()
    .rolling(52).apply(lambda r: (1 + r).prod() ** (52 / 52) - 1))

fig, axes = plt.subplots(2, 1, figsize=(12, 9))
fig.patch.set_facecolor(BG)
axes[0].set_title("MultiFactor MultiAsset — Rolling 52-Week Performance",
                   color=WHITE, fontsize=13, fontweight="bold", loc="left", pad=12)

ax = axes[0]
ax.plot(dates, rolling_cagr_t.reindex(dates) * 100, color=STRATEGY_COLOR, lw=2.0,
        label="MultiFactor MultiAsset")
ax.plot(dates, rolling_cagr_b_ma.reindex(dates) * 100, color=BNH_COLOR, lw=1.5, ls="--",
        label="Buy-Hold EW")
ax.axhline(0, color=RED, lw=0.8, ls=":")
ax.fill_between(dates, (rolling_cagr_t.reindex(dates) * 100).fillna(0), 0,
                where=(rolling_cagr_t.reindex(dates).fillna(0) >= 0), alpha=0.10, color=GREEN)
ax.fill_between(dates, (rolling_cagr_t.reindex(dates) * 100).fillna(0), 0,
                where=(rolling_cagr_t.reindex(dates).fillna(0) < 0),  alpha=0.10, color=RED)
legend(ax); style_ax(ax, "", "", "Rolling 52W CAGR %"); fmt_xaxis(ax)

ax = axes[1]
rs_t = rolling_sharpe_t.reindex(dates)
rs_b = rolling_sharpe_b.reindex(dates)
ax.plot(dates, rs_t, color=STRATEGY_COLOR, lw=2.0, label="MultiFactor MultiAsset")
ax.plot(dates, rs_b, color=BNH_COLOR, lw=1.5, ls="--", label="Buy-Hold EW")
ax.axhline(0, color=RED, lw=0.8, ls=":"); ax.axhline(1, color=GREEN, lw=0.6, ls="--", alpha=0.6)
legend(ax)
style_ax(ax, "", "", "Rolling Sharpe Ratio")
fmt_xaxis(ax)
fig.tight_layout(pad=1.5)
_save(fig, "rolling_returns.png")

# ─────────────────────────────────────────────────────────────────────────────
# CHART 5 — Fund vs Benchmark — Cumulative % Returns from 0%
# ─────────────────────────────────────────────────────────────────────────────
port_cum_ma  = (torque_idx / torque_idx.iloc[0] - 1) * 100
bench_cum_ma = (bnh_idx    / bnh_idx.iloc[0]    - 1) * 100

fig, ax = plt.subplots(figsize=(12, 5))
fig.patch.set_facecolor(BG)
ax.plot(dates, port_cum_ma, color=STRATEGY_COLOR, lw=2.2,
        label=f"MultiFactor MultiAsset  CAGR {mt['CAGR']:.1%}", zorder=3)
ax.plot(dates, bench_cum_ma, color=BNH_COLOR, lw=1.5, ls="--",
        label=f"Buy-Hold EW  CAGR {mb['CAGR']:.1%}", zorder=2)
ax.fill_between(dates, port_cum_ma, bench_cum_ma,
                where=(port_cum_ma >= bench_cum_ma), alpha=0.15, color=GREEN)
ax.fill_between(dates, port_cum_ma, bench_cum_ma,
                where=(port_cum_ma < bench_cum_ma), alpha=0.10, color=RED)
ax.axhline(0, color=GRAY, lw=0.8, ls="--")
ax.yaxis.set_major_formatter(mticker.FuncFormatter(lambda x, _: f"{x:.0f}%"))
ax.annotate(
    f"Total: {port_cum_ma.iloc[-1]:.1f}%  vs  Benchmark: {bench_cum_ma.iloc[-1]:.1f}%",
    xy=(0.02, 0.97), xycoords="axes fraction", va="top", ha="left", fontsize=9, color=GOLD,
    bbox=dict(boxstyle="round,pad=0.4", fc=CARD2, ec=GOLD, alpha=0.85))
legend(ax)
style_ax(ax, "Fund vs Benchmark — Cumulative Returns from 0%",
         "", "Cumulative Return (%)")
fmt_xaxis(ax)
fig.tight_layout(pad=1.5)
_save(fig, "fund_vs_bench.png")

# ─────────────────────────────────────────────────────────────────────────────
# DONE
# ─────────────────────────────────────────────────────────────────────────────
print(f"""
✅  All charts saved to:
    {OUTPUTS_DIR}

    summary.png              — performance scorecard
    growth.png               — growth of ₹1,00,000
    rolling_returns.png      — rolling 52W CAGR + Sharpe
    drawdown.png             — drawdown from peak
    fund_vs_bench.png        — cumulative % returns from 0%
""")
