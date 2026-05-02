"""
MultiFactor SmallMicro 500 — Full Backtest
==========================================
Factor Model
------------
  Momentum          30%  =  (12-1m return + 6m return) / 2
  Trend Strength    25%  =  price/SMA200 + annualised linreg slope (63-day)
  Volume Breakout   20%  =  20-day avg volume / 60-day avg volume
  52-Week High      15%  =  price / 52-week high
  Rel. Volatility   10%  =  −(21-day vol / 252-day vol)

Outputs saved to outputs/
--------------------------
  summary.png
  growth.png
  rolling_returns.png
  drawdown.png
  fund_vs_bench.png
  results.csv
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
from matplotlib.gridspec import GridSpec
from matplotlib.colors import LinearSegmentedColormap
from scipy.stats import norm
from datetime import datetime
from dateutil.relativedelta import relativedelta

# ── Shared modules ────────────────────────────────────────────────────────────
ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, ROOT_DIR)

from shared.config import SMALLMICRO, RISK_FREE
from shared.backtest_engine import (
    safe_zscore, extract_field, build_rebalancing_dates,
    compute_performance_stats,
)
from shared.chart_theme import (
    BG, CARD, CARD2, ACCENT, ACCENT2, GREEN, RED, GOLD, TEAL,
    WHITE, LGRAY, GRAY, GRID, SECTOR_PALETTE,
    STRATEGY_COLOR, BNH_COLOR,
    style_ax, fmt_xaxis, legend, save, make_monthly_pivot,
)

warnings.filterwarnings("ignore")

# ─────────────────────────────────────────────────────────────────────────────
# CONFIG
# ─────────────────────────────────────────────────────────────────────────────
BASE_DIR         = os.path.dirname(os.path.abspath(__file__))
UNIVERSE_PATH    = os.path.join(BASE_DIR, "universe.xlsx")
OUTPUTS_DIR      = os.path.join(BASE_DIR, "outputs")
os.makedirs(OUTPUTS_DIR, exist_ok=True)

UNIVERSE_SHEET   = SMALLMICRO["UNIVERSE_SHEET"]
TOP_N            = SMALLMICRO["TOP_N"]
MAX_PER_SECTOR   = SMALLMICRO["MAX_PER_SECTOR"]
BACKTEST_YEARS   = SMALLMICRO["BACKTEST_YEARS"]
TRANSACTION_COST = SMALLMICRO["TRANSACTION_COST"]
W_MOMENTUM       = SMALLMICRO["W_MOMENTUM"]
W_TREND          = SMALLMICRO["W_TREND"]
W_VOLUME         = SMALLMICRO["W_VOLUME"]
W_HIGH52         = SMALLMICRO["W_HIGH52"]
W_RELVOL         = SMALLMICRO["W_RELVOL"]

def _save(fig, name):
    save(fig, name, OUTPUTS_DIR)

# ─────────────────────────────────────────────────────────────────────────────
# STEP 1 · LOAD UNIVERSE
# ─────────────────────────────────────────────────────────────────────────────
print("=" * 65)
print("STEP 1 · Loading universe from universe.xlsx")
print("=" * 65)

if not os.path.exists(UNIVERSE_PATH):
    raise FileNotFoundError(f"Universe file not found:\n  {UNIVERSE_PATH}")

df_universe = pd.read_excel(UNIVERSE_PATH, sheet_name=UNIVERSE_SHEET)
df_universe.columns = df_universe.columns.str.strip()

required_cols = ["Yahoo Finance Ticker", "Industry", "Index", "Company Name"]
missing_cols  = [c for c in required_cols if c not in df_universe.columns]
if missing_cols:
    raise ValueError(f"universe.xlsx missing columns: {missing_cols}")

dummy_mask  = df_universe["Symbol"].str.upper().str.startswith("DUMMY")
dummy_rows  = df_universe[dummy_mask]
df_universe = df_universe[~dummy_mask].reset_index(drop=True)
if not dummy_rows.empty:
    print(f"  Removed {len(dummy_rows)} NSE dummy placeholder(s): "
          f"{dummy_rows['Yahoo Finance Ticker'].tolist()}")

all_tickers = df_universe["Yahoo Finance Ticker"].dropna().str.strip().tolist()
sector_map  = {
    row["Yahoo Finance Ticker"]: row["Industry"]
    for _, row in df_universe.iterrows()
    if pd.notna(row["Yahoo Finance Ticker"]) and pd.notna(row["Industry"])
}
company_map = dict(zip(df_universe["Yahoo Finance Ticker"], df_universe["Company Name"]))
index_map   = dict(zip(df_universe["Yahoo Finance Ticker"], df_universe["Index"]))

print(f"Universe loaded : {len(all_tickers)} tickers")
print(f"Industries      : {df_universe['Industry'].nunique()}")
print(f"Index split     : "
      f"{(df_universe['Index'] == 'Smallcap 250').sum()} Smallcap 250  |  "
      f"{(df_universe['Index'] == 'Microcap 250').sum()} Microcap 250")

# ─────────────────────────────────────────────────────────────────────────────
# STEP 2 · DOWNLOAD PRICE HISTORY
# ─────────────────────────────────────────────────────────────────────────────
print("\n" + "=" * 65)
print("STEP 2 · Downloading price history")
print("=" * 65)

end_date   = datetime.today()
start_date = end_date - relativedelta(years=BACKTEST_YEARS) - relativedelta(months=15)

raw_prices = yf.download(all_tickers, start=start_date, end=end_date,
                          auto_adjust=True, progress=True)

prices  = extract_field(raw_prices, "Close").ffill()
volumes = extract_field(raw_prices, "Volume").fillna(0)

if prices.index.tz is not None:
    prices.index  = prices.index.tz_localize(None)
    volumes.index = volumes.index.tz_localize(None)

prices  = prices.dropna(axis=1, how="all").dropna(axis=1, thresh=200)
valid   = prices.columns.tolist()
volumes = volumes.reindex(columns=valid).fillna(0)
sector_map = {t: sector_map.get(t, f"_unk_{t}") for t in valid}

print(f"\n✓ {len(valid)}/{len(all_tickers)} tickers with sufficient price history")
skipped = [t for t in all_tickers if t not in valid]
if skipped:
    print(f"  {len(skipped)} tickers skipped (insufficient history / delisted)")

# ─────────────────────────────────────────────────────────────────────────────
# STEP 3 · REBALANCING DATES
# ─────────────────────────────────────────────────────────────────────────────
print("\n" + "=" * 65)
print("STEP 3 · Monthly rebalancing schedule")
print("=" * 65)

rebal_dates = build_rebalancing_dates(prices, start_date, lookback_months=13)
print(f"Backtest period  : {rebal_dates[0].date()} → {rebal_dates[-1].date()}")
print(f"Rebalancing dates: {len(rebal_dates)} months")

# ─────────────────────────────────────────────────────────────────────────────
# STRATEGY HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def select_portfolio(as_of):
    """Build the SmallMicro factor portfolio as of a given date."""
    p_hist = prices.loc[:as_of]
    v_hist = volumes.loc[:as_of]
    recs   = {}

    for t in valid:
        p = p_hist[t].dropna()
        v = v_hist[t] if t in v_hist.columns else pd.Series(dtype=float)
        n = len(p)
        if n < 63:
            continue
        rec = {}
        r12 = (p.iloc[-1] / p.iloc[-min(252, n)]) - 1
        r6  = (p.iloc[-1] / p.iloc[-min(126, n)]) - 1
        r1  = (p.iloc[-1] / p.iloc[-min(21,  n)]) - 1
        rec["Momentum"] = ((r12 - r1) + r6) / 2

        sma      = p.iloc[-min(200, n):].mean()
        sma_r    = (p.iloc[-1] / sma) - 1
        log_p    = np.log(p.iloc[-min(63, n):].values)
        x        = np.arange(len(log_p))
        slope, _ = np.polyfit(x, log_p, 1)
        rec["Trend"] = sma_r + (slope * 252)

        if len(v) >= 60 and v.iloc[-60:].sum() > 0:
            avg20 = v.iloc[-20:].mean()
            avg60 = v.iloc[-60:].mean()
            rec["VolBreak"] = avg20 / avg60 if avg60 > 0 else np.nan
        else:
            rec["VolBreak"] = np.nan

        rec["High52"] = p.iloc[-1] / p.iloc[-min(252, n):].max()

        rets = p.pct_change().dropna()
        if len(rets) >= 63:
            v21  = rets.iloc[-21:].std()  * np.sqrt(252)
            v252 = rets.iloc[-min(252, len(rets)):].std() * np.sqrt(252)
            rec["RelVol"] = -(v21 / v252) if v252 > 0 else np.nan
        else:
            rec["RelVol"] = np.nan

        recs[t] = rec

    df = pd.DataFrame(recs).T.dropna(subset=["Momentum", "Trend", "High52"])
    if df.empty:
        return []

    df["Z_Mom"]    = safe_zscore(df["Momentum"])
    df["Z_Trend"]  = safe_zscore(df["Trend"])
    df["Z_Vol"]    = safe_zscore(df["VolBreak"])
    df["Z_High52"] = safe_zscore(df["High52"])
    df["Z_RelVol"] = safe_zscore(df["RelVol"])
    df["Score"]    = (W_MOMENTUM * df["Z_Mom"]    +
                      W_TREND    * df["Z_Trend"]  +
                      W_VOLUME   * df["Z_Vol"]    +
                      W_HIGH52   * df["Z_High52"] +
                      W_RELVOL   * df["Z_RelVol"])
    df["Industry"] = df.index.map(lambda t: sector_map.get(t, f"_unk_{t}"))
    df = df.sort_values("Score", ascending=False)
    port = (df.groupby("Industry", group_keys=False)
               .apply(lambda g: g.head(MAX_PER_SECTOR))
               .sort_values("Score", ascending=False)
               .head(TOP_N))
    return port.index.tolist()

# ─────────────────────────────────────────────────────────────────────────────
# STEP 4 · RUN BACKTEST
# ─────────────────────────────────────────────────────────────────────────────
print("\n" + "=" * 65)
print("STEP 4 · Running backtest")
print("=" * 65)

port_equity_l    = [100.0];  bench_equity_l = [100.0]
port_rets_l      = [];       bench_rets_l   = []
holdings_history = {};       prev_holdings  = []

for i, d in enumerate(rebal_dates[:-1]):
    next_d   = rebal_dates[i + 1]
    holdings = select_portfolio(d)

    if not holdings:
        port_equity_l.append(port_equity_l[-1])
        bench_equity_l.append(bench_equity_l[-1])
        port_rets_l.append(0.0); bench_rets_l.append(0.0)
        continue

    holdings_history[d] = holdings
    turnover  = len(set(holdings) ^ set(prev_holdings)) / max(len(holdings), 1)
    tc_drag   = turnover * TRANSACTION_COST
    prev_holdings = holdings

    sub  = prices.loc[d:next_d, [h for h in holdings if h in prices.columns]]
    p0   = sub.iloc[0]; p1 = sub.iloc[-1]
    mask = p0.notna() & p1.notna() & (p0 != 0)
    pr   = float(((p1[mask]/p0[mask]) - 1).mean()) - tc_drag if mask.sum() > 0 else 0.0

    sub_b  = prices.loc[d:next_d]
    p0_b   = sub_b.iloc[0]; p1_b = sub_b.iloc[-1]
    mask_b = p0_b.notna() & p1_b.notna() & (p0_b != 0)
    br     = float(((p1_b[mask_b]/p0_b[mask_b]) - 1).mean()) if mask_b.sum() > 0 else 0.0

    port_equity_l.append(port_equity_l[-1] * (1 + pr))
    bench_equity_l.append(bench_equity_l[-1] * (1 + br))
    port_rets_l.append(pr * 100); bench_rets_l.append(br * 100)

    if (i + 1) % 12 == 0:
        print(f"  {d.strftime('%Y-%m')} — portfolio: {len(holdings)} stocks")

date_idx     = pd.DatetimeIndex([rebal_dates[0]] + rebal_dates[1:len(port_equity_l)])
port_equity  = pd.Series(port_equity_l,  index=date_idx)
bench_equity = pd.Series(bench_equity_l, index=date_idx)
port_rets    = pd.Series(port_rets_l,    index=date_idx[1:])
bench_rets   = pd.Series(bench_rets_l,   index=date_idx[1:])
excess_rets  = port_rets - bench_rets

results = pd.DataFrame({"Port_Equity": port_equity, "Bench_Equity": bench_equity}).dropna()

# ─────────────────────────────────────────────────────────────────────────────
# STEP 5 · METRICS
# ─────────────────────────────────────────────────────────────────────────────
stats = compute_performance_stats(
    port_rets / 100, bench_rets / 100, port_equity, bench_equity)
p_cagr   = stats["p_cagr"];   b_cagr   = stats["b_cagr"]
p_sharpe = stats["p_sharpe"]; b_sharpe = stats["b_sharpe"]
p_dd     = stats["p_dd"];     b_dd     = stats["b_dd"]
alpha    = stats["alpha"];    beat_pct = stats["beat_pct"]
p_total  = stats["p_total"];  b_total  = stats["b_total"]
p_vol    = stats["p_vol"];    b_vol    = stats["b_vol"]
p_win    = stats["p_win"];    b_win    = stats["b_win"]
calmar_p = stats["calmar_p"]; calmar_b = stats["calmar_b"]
var_95   = stats["var_95"];   cvar_95  = stats["cvar_95"]

print(f"\n{'Portfolio CAGR':<25} {p_cagr*100:>8.2f}%")
print(f"{'Benchmark CAGR':<25} {b_cagr*100:>8.2f}%")
print(f"{'Alpha (CAGR)':<25} {alpha*100:>+8.2f}%")
print(f"{'Portfolio Sharpe':<25} {p_sharpe:>8.2f}")
print(f"{'Max Drawdown':<25} {p_dd*100:>8.2f}%")
print(f"{'Win Rate (monthly)':<25} {beat_pct*100:>8.2f}%")

print("\nGenerating charts...")
os.makedirs(OUTPUTS_DIR, exist_ok=True)

# ─────────────────────────────────────────────────────────────────────────────
# CHART 1 — Summary scorecard
# ─────────────────────────────────────────────────────────────────────────────
fig, ax = plt.subplots(figsize=(11, 5.5))
ax.set_facecolor(CARD); fig.patch.set_facecolor(BG); ax.axis("off")

metrics_rows = [
    ("Total return",  f"{p_total:.1%}",         f"{b_total:.1%}",         True),
    ("CAGR",          f"{p_cagr*100:.1f}%",      f"{b_cagr*100:.1f}%",      True),
    ("Volatility",    f"{p_vol*100:.1f}%",        f"{b_vol*100:.1f}%",        False),
    ("Sharpe ratio",  f"{p_sharpe:.2f}",           f"{b_sharpe:.2f}",          True),
    ("Max drawdown",  f"{p_dd*100:.1f}%",         f"{b_dd*100:.1f}%",         False),
    ("Calmar ratio",  f"{calmar_p:.2f}",           f"{calmar_b:.2f}",          True),
    ("Win rate",      f"{p_win:.1%}",             f"{b_win:.1%}",             True),
    ("Best month",    f"{port_rets.max():.1f}%",  f"{bench_rets.max():.1f}%", True),
    ("Worst month",   f"{port_rets.min():.1f}%",  f"{bench_rets.min():.1f}%", False),
    ("Alpha (CAGR)",  f"{alpha*100:+.1f}%",       "—",                        True),
]

col_x   = [0.02, 0.42, 0.66, 0.88]
headers = ["Metric", "MultiFactor SmallMicro 500", "EW Benchmark", "Edge"]
row_h   = 0.082; y_start = 0.92

for xi, h in zip(col_x, headers):
    ax.text(xi, y_start, h, transform=ax.transAxes, fontsize=9.5,
            fontweight="bold", color=WHITE,
            bbox=dict(boxstyle="round,pad=0.3", facecolor=ACCENT, edgecolor="none", alpha=0.9))

for ri, (label, tv, bv, higher_better) in enumerate(metrics_rows):
    y = y_start - (ri + 1) * row_h
    row_bg = CARD2 if ri % 2 == 0 else CARD
    ax.add_patch(mpatches.FancyBboxPatch(
        (0, y - 0.025), 1, row_h * 0.95,
        transform=ax.transAxes, boxstyle="square,pad=0",
        facecolor=row_bg, edgecolor="none", zorder=0))
    try:
        tv_num = float(tv.replace("₹","").replace("L","").replace("%","")
                         .replace("−","-").replace("+",""))
        bv_num = float(bv.replace("₹","").replace("L","").replace("%","")
                         .replace("−","-").replace("+","").replace("—","0"))
    except ValueError:
        tv_num, bv_num = 0, 0
    t_wins = (higher_better and tv_num > bv_num) or (not higher_better and tv_num < bv_num)
    edge   = "Strategy ✓" if t_wins else "BnH ✓"
    ax.text(col_x[0], y, label, transform=ax.transAxes, fontsize=9, color=LGRAY)
    ax.text(col_x[1], y, tv,    transform=ax.transAxes, fontsize=9,
            color=GREEN if t_wins else RED, fontweight="bold")
    ax.text(col_x[2], y, bv,    transform=ax.transAxes, fontsize=9,
            color=RED if t_wins else GREEN)
    ax.text(col_x[3], y, edge,  transform=ax.transAxes, fontsize=9,
            color=TEAL if t_wins else GRAY)

ax.set_title("MultiFactor SmallMicro 500 — Performance Summary",
             color=WHITE, fontsize=13, fontweight="bold", loc="left", pad=16, y=1.01)
fig.text(0.99, 0.01,
         f"Backtest: {rebal_dates[0].date()} → {rebal_dates[-1].date()}",
         ha="right", va="bottom", fontsize=7.5, color=GRAY)
_save(fig, "summary.png")

# ─────────────────────────────────────────────────────────────────────────────
# CHART 2 — Growth of ₹1,00,000
# ─────────────────────────────────────────────────────────────────────────────
INITIAL = 100000
port_growth  = results["Port_Equity"]  / results["Port_Equity"].iloc[0]  * INITIAL
bench_growth = results["Bench_Equity"] / results["Bench_Equity"].iloc[0] * INITIAL

fig, ax = plt.subplots(figsize=(14, 6))
fig.patch.set_facecolor(BG)
ax.plot(results.index, port_growth, color=STRATEGY_COLOR, lw=2.2,
        label=f"MultiFactor SmallMicro 500  CAGR {p_cagr*100:.1f}%", zorder=3)
ax.plot(results.index, bench_growth, color=BNH_COLOR, lw=1.5, ls="--",
        label=f"Equal-Weight Benchmark  CAGR {b_cagr*100:.1f}%", zorder=2)
ax.fill_between(results.index, port_growth, bench_growth,
                where=port_growth >= bench_growth, alpha=0.15, color=GREEN)
ax.fill_between(results.index, port_growth, bench_growth,
                where=port_growth < bench_growth, alpha=0.10, color=RED)
ax.yaxis.set_major_formatter(mticker.FuncFormatter(
    lambda x, _: f"₹{x/100000:.1f}L" if x >= 100000 else f"₹{x:,.0f}"))
ax.annotate(
    f"Alpha: {alpha*100:+.1f}% CAGR\nSharpe: {p_sharpe:.2f}  |  Max DD: {p_dd*100:.1f}%\n"
    f"Beats benchmark {beat_pct*100:.0f}% of months",
    xy=(0.02, 0.97), xycoords="axes fraction", va="top", ha="left", fontsize=9, color=GOLD,
    bbox=dict(boxstyle="round,pad=0.4", fc=CARD2, ec=GOLD, alpha=0.85))
# Final value callouts at line endpoints
pv = float(port_growth.iloc[-1])
bv = float(bench_growth.iloc[-1])
pv_lbl = f"₹{pv/100000:.1f}L" if pv >= 100000 else f"₹{pv:,.0f}"
bv_lbl = f"₹{bv/100000:.1f}L" if bv >= 100000 else f"₹{bv:,.0f}"
ax.annotate(pv_lbl, xy=(port_growth.index[-1],  pv),
            xytext=(6, 2), textcoords="offset points",
            fontsize=9, color=STRATEGY_COLOR, fontweight="bold",
            va="bottom", ha="left", annotation_clip=False)
ax.annotate(bv_lbl, xy=(bench_growth.index[-1], bv),
            xytext=(6, -8), textcoords="offset points",
            fontsize=9, color=BNH_COLOR,
            va="top", ha="left", annotation_clip=False)
legend(ax, loc="upper left")
style_ax(ax, f"Growth of ₹1,00,000  |  Strategy {p_cagr*100:.1f}% CAGR  vs  Benchmark {b_cagr*100:.1f}%",
         "", "Portfolio value (₹)")
fmt_xaxis(ax)
fig.tight_layout(pad=2.0)
_save(fig, "growth.png")

# ─────────────────────────────────────────────────────────────────────────────
# CHART 3 — Rolling Returns (2-panel: CAGR + Sharpe)
# ─────────────────────────────────────────────────────────────────────────────
window = 12
rc_p = port_rets.rolling(window).apply(lambda x: ((1+x/100).prod())**(12/window)-1)*100
rc_b = bench_rets.rolling(window).apply(lambda x: ((1+x/100).prod())**(12/window)-1)*100
rf_m = (1 + RISK_FREE)**(1/12) - 1
rs   = ((port_rets/100 - rf_m).rolling(window)
        .apply(lambda x: x.mean()/x.std()*np.sqrt(12) if x.std() > 1e-8 else np.nan))
rs_b = ((bench_rets/100 - rf_m).rolling(window)
        .apply(lambda x: x.mean()/x.std()*np.sqrt(12) if x.std() > 1e-8 else np.nan))

fig, axes = plt.subplots(2, 1, figsize=(14, 9))
fig.patch.set_facecolor(BG)
axes[0].set_title("MultiFactor SmallMicro 500 — Rolling 12-Month Performance",
                   color=WHITE, fontsize=13, fontweight="bold", loc="left", pad=12)

ax = axes[0]
ax.plot(rc_p.index, rc_p, color=STRATEGY_COLOR, lw=2.0, label="MultiFactor SmallMicro 500")
ax.plot(rc_b.index, rc_b, color=BNH_COLOR, lw=1.5, ls="--", label="EW Benchmark")
ax.axhline(0, color=RED, lw=0.8, ls=":")
ax.fill_between(rc_p.index, rc_p, 0, where=rc_p>=0, alpha=0.10, color=GREEN)
ax.fill_between(rc_p.index, rc_p, 0, where=rc_p<0,  alpha=0.10, color=RED)
legend(ax); style_ax(ax, "", "", "Rolling 12M CAGR %"); fmt_xaxis(ax)

ax = axes[1]
ax.plot(rs.index,   rs,   color=STRATEGY_COLOR, lw=2.0, label="MultiFactor SmallMicro 500")
ax.plot(rs_b.index, rs_b, color=BNH_COLOR,       lw=1.5, ls="--", label="EW Benchmark")
ax.axhline(1.0, color=GREEN, lw=0.6, ls="--", alpha=0.7)
ax.axhline(0.0, color=RED,   lw=0.8, ls=":",  alpha=0.8)
ax.fill_between(rs.index, rs, 0, where=rs>=0, alpha=0.12, color=STRATEGY_COLOR)
ax.fill_between(rs.index, rs, 0, where=rs<0,  alpha=0.12, color=RED)
legend(ax); style_ax(ax, "", "", "Rolling Sharpe Ratio"); fmt_xaxis(ax)

fig.tight_layout(pad=2.0)
_save(fig, "rolling_returns.png")

# ─────────────────────────────────────────────────────────────────────────────
# CHART 4 — Drawdown from Peak
# ─────────────────────────────────────────────────────────────────────────────
dd   = (results["Port_Equity"]  - results["Port_Equity"].cummax())  / results["Port_Equity"].cummax()  * 100
dd_b = (results["Bench_Equity"] - results["Bench_Equity"].cummax()) / results["Bench_Equity"].cummax() * 100

fig, ax = plt.subplots(figsize=(14, 5))
fig.patch.set_facecolor(BG)
ax.fill_between(results.index, dd, 0, color=STRATEGY_COLOR, alpha=0.35,
                label="MultiFactor SmallMicro 500")
ax.plot(results.index, dd, color=STRATEGY_COLOR, lw=1.4)
ax.fill_between(results.index, dd_b, 0, color=BNH_COLOR, alpha=0.20, label="EW Benchmark")
ax.plot(results.index, dd_b, color=BNH_COLOR, lw=1.0, ls="--")
ax.annotate(f"Max DD: {dd.min():.1f}%", xy=(dd.idxmin(), dd.min()),
            xytext=(20, 20), textcoords="offset points",
            arrowprops=dict(arrowstyle="->", color=LGRAY, lw=0.8), fontsize=8, color=LGRAY)
legend(ax)
style_ax(ax, "Drawdown from Peak", "", "Drawdown (%)")
fmt_xaxis(ax)
fig.tight_layout(pad=2.0)
_save(fig, "drawdown.png")

# ─────────────────────────────────────────────────────────────────────────────
# CHART 5 — Fund vs Benchmark — Cumulative % Returns from 0%
# ─────────────────────────────────────────────────────────────────────────────
port_cum  = (results["Port_Equity"]  / results["Port_Equity"].iloc[0]  - 1) * 100
bench_cum = (results["Bench_Equity"] / results["Bench_Equity"].iloc[0] - 1) * 100

fig, ax = plt.subplots(figsize=(14, 6))
fig.patch.set_facecolor(BG)
ax.plot(results.index, port_cum, color=STRATEGY_COLOR, lw=2.2,
        label=f"MultiFactor SmallMicro 500  CAGR {p_cagr*100:.1f}%", zorder=3)
ax.plot(results.index, bench_cum, color=BNH_COLOR, lw=1.5, ls="--",
        label=f"Equal-Weight Benchmark  CAGR {b_cagr*100:.1f}%", zorder=2)
ax.fill_between(results.index, port_cum, bench_cum,
                where=port_cum >= bench_cum, alpha=0.15, color=GREEN)
ax.fill_between(results.index, port_cum, bench_cum,
                where=port_cum < bench_cum, alpha=0.10, color=RED)
ax.axhline(0, color=GRAY, lw=0.8, ls="--")
ax.yaxis.set_major_formatter(mticker.FuncFormatter(lambda x, _: f"{x:.0f}%"))
ax.annotate(
    f"Total: {port_cum.iloc[-1]:.1f}%  vs  Benchmark: {bench_cum.iloc[-1]:.1f}%",
    xy=(0.02, 0.97), xycoords="axes fraction", va="top", ha="left", fontsize=9, color=GOLD,
    bbox=dict(boxstyle="round,pad=0.4", fc=CARD2, ec=GOLD, alpha=0.85))
legend(ax, loc="upper left")
style_ax(ax, "Fund vs Benchmark — Cumulative Returns from 0%",
         "", "Cumulative Return (%)")
fmt_xaxis(ax)
fig.tight_layout(pad=2.0)
_save(fig, "fund_vs_bench.png")

# ─────────────────────────────────────────────────────────────────────────────
# SAVE CSV
# ─────────────────────────────────────────────────────────────────────────────
results.to_csv(os.path.join(OUTPUTS_DIR, "results.csv"))
print(f"  ✓  results.csv")

print(f"""
✅  All outputs saved to:
    {OUTPUTS_DIR}

    summary.png              — performance scorecard
    growth.png               — growth of ₹1,00,000
    rolling_returns.png      — rolling 12M CAGR + Sharpe
    drawdown.png             — drawdown from peak
    fund_vs_bench.png        — cumulative % returns from 0%
    results.csv              — monthly returns data
""")
