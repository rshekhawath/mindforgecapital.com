"""
MultiFactor MultiAsset — Backtest
==================================
Universe: 6 ETFs (Nifty 50, Nifty Next 50, Nifty Midcap 150,
          Gold, Bharat Bond, NASDAQ)

Factor model: 3M/6M/12M momentum × volatility-adjustment × 40-week MA trend filter.
Rebalances monthly, weekly price data.

Outputs saved to outputs/
--------------------------
  01_summary.png
  02_growth.png
  03_drawdown.png
  04_rolling_sharpe.png
  05_annual_returns.png
  06_monthly_returns.png
  07_monthly_heatmap.png
  08_allocation_history.png
  09_return_distribution.png
  10_underwater.png
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
                       if r.std() > 0 else 0))
rolling_sharpe_b = (bnh_idx.pct_change()
    .rolling(52).apply(lambda r: (r.mean()*52 - RISK_FREE) / (r.std()*np.sqrt(52))
                       if r.std() > 0 else 0))
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
_save(fig, "01_summary.png")

# ─────────────────────────────────────────────────────────────────────────────
# CHART 2 — Growth of ₹10L
# ─────────────────────────────────────────────────────────────────────────────
fig, ax = plt.subplots(figsize=(12, 5))
dates = torque_idx.index
ax.plot(dates, torque_idx * INITIAL_AUM/100, color=STRATEGY_COLOR, lw=2.2,
        label="MultiFactor MultiAsset", zorder=3)
ax.plot(dates, bnh_idx * INITIAL_AUM/100, color=BNH_COLOR, lw=1.5, ls="--",
        label="Buy-Hold EW", zorder=2)
ax.fill_between(dates, torque_idx*INITIAL_AUM/100, bnh_idx*INITIAL_AUM/100,
                where=(torque_idx >= bnh_idx), alpha=0.15, color=GREEN)
ax.fill_between(dates, torque_idx*INITIAL_AUM/100, bnh_idx*INITIAL_AUM/100,
                where=(torque_idx < bnh_idx), alpha=0.10, color=RED)
ax.yaxis.set_major_formatter(mticker.FuncFormatter(lambda x, _: f"₹{x/100000:.1f}L"))
legend(ax)
style_ax(ax, f"Growth of ₹10L  |  Strategy {mt['CAGR']:.1%} CAGR  vs  BnH {mb['CAGR']:.1%}",
         "", "Portfolio value")
fmt_xaxis(ax)
fig.tight_layout(pad=1.5)
_save(fig, "02_growth.png")

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
_save(fig, "03_drawdown.png")

# ─────────────────────────────────────────────────────────────────────────────
# CHART 4 — Rolling 52-week Sharpe
# ─────────────────────────────────────────────────────────────────────────────
fig, ax = plt.subplots(figsize=(12, 4))
rs_t = rolling_sharpe_t.reindex(dates)
rs_b = rolling_sharpe_b.reindex(dates)
ax.plot(dates, rs_t, color=STRATEGY_COLOR, lw=2.0, label="MultiFactor MultiAsset")
ax.plot(dates, rs_b, color=BNH_COLOR, lw=1.5, ls="--", label="Buy-Hold EW")
ax.axhline(0, color=RED, lw=0.8, ls=":"); ax.axhline(1, color=GREEN, lw=0.6, ls="--", alpha=0.6)
legend(ax)
style_ax(ax, "Rolling 52-Week Sharpe Ratio", "", "Sharpe ratio")
fmt_xaxis(ax)
fig.tight_layout(pad=1.5)
_save(fig, "04_rolling_sharpe.png")

# ─────────────────────────────────────────────────────────────────────────────
# CHART 5 — Annual returns
# ─────────────────────────────────────────────────────────────────────────────
years_idx = t_annual.index.union(b_annual.index)
yr_labels = [dt.strftime("%Y") for dt in years_idx]
t_vals    = [t_annual.get(dt, np.nan)*100 for dt in years_idx]
b_vals    = [b_annual.get(dt, np.nan)*100 for dt in years_idx]
x = np.arange(len(yr_labels)); w = 0.35

fig, ax = plt.subplots(figsize=(10, 5))
bt = ax.bar(x - w/2, t_vals, w, color=STRATEGY_COLOR, alpha=0.9, label="MultiFactor MultiAsset", zorder=3)
ax.bar(x + w/2, b_vals, w, color=BNH_COLOR, alpha=0.7, label="Buy-Hold EW", zorder=3)
ax.set_xticks(x); ax.set_xticklabels(yr_labels, color=LGRAY)
ax.yaxis.set_major_formatter(mticker.FuncFormatter(lambda x, _: f"{x:.0f}%"))
ax.axhline(0, color=GRAY, lw=0.8)
for bar in bt:
    h = bar.get_height()
    if not np.isnan(h):
        ax.text(bar.get_x()+bar.get_width()/2, h+(0.5 if h>=0 else -2.5),
                f"{h:.1f}%", ha="center", va="bottom" if h>=0 else "top",
                fontsize=7.5, color=WHITE)
legend(ax)
style_ax(ax, "Annual Returns (%)", "Year", "Return (%)")
fig.tight_layout(pad=1.5)
_save(fig, "05_annual_returns.png")

# ─────────────────────────────────────────────────────────────────────────────
# CHART 6 — Monthly returns
# ─────────────────────────────────────────────────────────────────────────────
months_idx = t_monthly.index.union(b_monthly.index)
t_mvals    = [t_monthly.get(dt, np.nan)*100 for dt in months_idx]
b_mvals    = [b_monthly.get(dt, np.nan)*100 for dt in months_idx]
mlabels    = [dt.strftime("%b %y") for dt in months_idx]

fig, ax = plt.subplots(figsize=(16, 4))
x2 = np.arange(len(mlabels))
bar_colors = [STRATEGY_COLOR if (v >= 0) else RED for v in t_mvals]
ax.bar(x2, t_mvals, color=bar_colors, alpha=0.85, label="MultiFactor MultiAsset", zorder=3, width=0.7)
ax.plot(x2, b_mvals, color=BNH_COLOR, lw=1.2, ls="--", marker="o", markersize=2.5,
        label="Buy-Hold EW", zorder=4)
ax.set_xticks(x2[::3])
ax.set_xticklabels(mlabels[::3], rotation=45, ha="right", fontsize=7.5, color=LGRAY)
ax.axhline(0, color=GRAY, lw=0.6)
ax.yaxis.set_major_formatter(mticker.FuncFormatter(lambda x, _: f"{x:.0f}%"))
legend(ax)
style_ax(ax, "Monthly Returns (%)", "", "Return (%)")
fig.tight_layout(pad=1.5)
_save(fig, "06_monthly_returns.png")

# ─────────────────────────────────────────────────────────────────────────────
# CHART 7 — Monthly heatmap
# ─────────────────────────────────────────────────────────────────────────────
t_monthly_all = torque_idx.resample("ME").last().pct_change().dropna()
yrs    = sorted(t_monthly_all.index.year.unique())
mnames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"]
grid   = np.full((len(yrs), 12), np.nan)
for ri, yr in enumerate(yrs):
    for ci, m in enumerate(range(1, 13)):
        vals = t_monthly_all[(t_monthly_all.index.year==yr)&(t_monthly_all.index.month==m)]
        if len(vals):
            grid[ri, ci] = vals.iloc[0]*100

cmap = LinearSegmentedColormap.from_list("rg", [RED, CARD, CARD, GREEN], N=256)
vabs = max(np.nanmax(np.abs(grid[np.isfinite(grid)])), 1) if np.any(np.isfinite(grid)) else 10

fig, ax = plt.subplots(figsize=(13, max(3, len(yrs)*0.6+1)))
im = ax.imshow(grid, cmap=cmap, vmin=-vabs, vmax=vabs, aspect="auto")
ax.set_xticks(range(12)); ax.set_xticklabels(mnames, fontsize=9, color=LGRAY)
ax.set_yticks(range(len(yrs))); ax.set_yticklabels(yrs, fontsize=9, color=LGRAY)
for ri in range(len(yrs)):
    for ci in range(12):
        v = grid[ri, ci]
        if not np.isnan(v):
            txt_col = WHITE if abs(v) < vabs*0.5 else ("black" if v > 0 else WHITE)
            ax.text(ci, ri, f"{v:.1f}%", ha="center", va="center", fontsize=7.5, color=txt_col,
                    fontweight="bold" if abs(v) > 3 else "normal")
cbar = fig.colorbar(im, ax=ax, format="%.0f%%", shrink=0.7, pad=0.01)
cbar.ax.tick_params(colors=LGRAY, labelsize=8)
ax.set_facecolor(CARD); fig.patch.set_facecolor(BG)
for sp in ax.spines.values(): sp.set_visible(False)
ax.set_title("Monthly Returns Heatmap — MultiFactor MultiAsset",
             color=WHITE, fontsize=12, fontweight="bold", loc="left", pad=12)
fig.tight_layout()
_save(fig, "07_monthly_heatmap.png")

# ─────────────────────────────────────────────────────────────────────────────
# CHART 8 — Allocation history stacked area
# ─────────────────────────────────────────────────────────────────────────────
alloc_df = pd.DataFrame(
    {a: [d.get(a, 0)*100 for _, d in alloc_history] for a in assets},
    index=[w for w, _ in alloc_history]
)

fig, ax = plt.subplots(figsize=(14, 5))
bottom = np.zeros(len(alloc_df))
for a in assets:
    vals = alloc_df[a].values
    ax.fill_between(alloc_df.index, bottom, bottom+vals,
                    color=ASSET_COLORS[a], alpha=0.88, label=a, zorder=2)
    bottom += vals
ax.set_ylim(0, 100)
ax.yaxis.set_major_formatter(mticker.FuncFormatter(lambda x, _: f"{x:.0f}%"))
leg = ax.legend(loc="upper left", fontsize=8, framealpha=0.3, ncol=3,
                facecolor=CARD2, edgecolor=GRAY,
                handles=[mpatches.Patch(color=ASSET_COLORS[a], label=a) for a in assets])
for txt in leg.get_texts(): txt.set_color(WHITE)
style_ax(ax, "Monthly Allocation History", "", "Allocation (%)")
fmt_xaxis(ax)
fig.tight_layout(pad=1.5)
_save(fig, "08_allocation_history.png")

# ─────────────────────────────────────────────────────────────────────────────
# CHART 9 — Weekly return distribution
# ─────────────────────────────────────────────────────────────────────────────
t_rets = torque_idx.pct_change().dropna()*100
b_rets = bnh_idx.pct_change().dropna()*100
bins   = np.linspace(min(t_rets.min(), b_rets.min())-0.5,
                     max(t_rets.max(), b_rets.max())+0.5, 50)

fig, ax = plt.subplots(figsize=(10, 4.5))
ax.hist(t_rets, bins=bins, color=STRATEGY_COLOR, alpha=0.65,
        label="MultiFactor MultiAsset", zorder=3)
ax.hist(b_rets, bins=bins, color=BNH_COLOR, alpha=0.45,
        label="Buy-Hold EW", zorder=2)
ax.axvline(float(t_rets.mean()), color=STRATEGY_COLOR, lw=1.5, ls="--")
ax.axvline(float(b_rets.mean()), color=BNH_COLOR,      lw=1.2, ls="--")
ax.axvline(0, color=GRAY, lw=0.8)
ax.xaxis.set_major_formatter(mticker.FuncFormatter(lambda x, _: f"{x:.1f}%"))
legend(ax)
style_ax(ax, "Weekly Return Distribution", "Weekly return (%)", "Frequency")
fig.tight_layout(pad=1.5)
_save(fig, "09_return_distribution.png")

# ─────────────────────────────────────────────────────────────────────────────
# CHART 10 — Underwater
# ─────────────────────────────────────────────────────────────────────────────
fig, axes = plt.subplots(2, 1, figsize=(12, 6), sharex=True)
fig.patch.set_facecolor(BG)

for ax, idx, color, label in [
    (axes[0], torque_idx, STRATEGY_COLOR, "MultiFactor MultiAsset"),
    (axes[1], bnh_idx,    BNH_COLOR,      "Buy-Hold EW"),
]:
    dd_s = (idx / idx.cummax() - 1)*100
    ax.fill_between(idx.index, dd_s, 0, color=color, alpha=0.4)
    ax.plot(idx.index, dd_s, color=color, lw=1.2)
    ax.set_facecolor(CARD)
    ax.grid(True, color=GRID, linewidth=0.6, zorder=0, alpha=0.8)
    ax.set_axisbelow(True)
    for sp in ax.spines.values(): sp.set_color(GRAY); sp.set_linewidth(0.5)
    ax.tick_params(colors=LGRAY, labelsize=9)
    ax.yaxis.set_major_formatter(mticker.FuncFormatter(lambda x, _: f"{x:.0f}%"))
    ax.set_ylabel("Drawdown %", color=LGRAY, fontsize=9)
    ax.set_title(label, color=WHITE, fontsize=10, fontweight="bold", loc="left")
    mdd_v = float(dd_s.min())
    ax.annotate(f"Max DD: {mdd_v:.1f}%",
                xy=(dd_s.idxmin(), mdd_v),
                xytext=(20, 20), textcoords="offset points",
                arrowprops=dict(arrowstyle="->", color=LGRAY, lw=0.8),
                fontsize=8, color=LGRAY)

axes[0].set_title("Underwater Chart (Drawdown from Peak)",
                  color=WHITE, fontsize=12, fontweight="bold", loc="left", pad=10)
plt.setp(axes[1].xaxis.get_majorticklabels(), rotation=30, ha="right", color=LGRAY)
axes[1].xaxis.set_major_formatter(mdates.DateFormatter("%b '%y"))
axes[1].xaxis.set_major_locator(mdates.MonthLocator(interval=6))
fig.tight_layout(pad=1.5)
_save(fig, "10_underwater.png")

# ─────────────────────────────────────────────────────────────────────────────
# DONE
# ─────────────────────────────────────────────────────────────────────────────
print(f"""
✅  All charts saved to:
    {OUTPUTS_DIR}

    01_summary.png             — performance scorecard
    02_growth.png              — growth of ₹10L
    03_drawdown.png            — drawdown from peak
    04_rolling_sharpe.png      — 52-week rolling Sharpe
    05_annual_returns.png      — annual returns bar chart
    06_monthly_returns.png     — monthly returns bar chart
    07_monthly_heatmap.png     — green/red calendar heatmap
    08_allocation_history.png  — stacked allocation over time
    09_return_distribution.png — weekly return histogram
    10_underwater.png          — underwater chart
""")
