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
  equity_curve.png
  rolling_metrics.png
  monthly_heatmap_port.png
  monthly_heatmap_bench.png
  sector_exposure.png
  return_distribution.png
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
# CHART 2 — Equity Curve + Excess Returns + Drawdown
# ─────────────────────────────────────────────────────────────────────────────
fig, axes = plt.subplots(3, 1, figsize=(14, 12), gridspec_kw={"height_ratios": [3, 1, 1]})
fig.patch.set_facecolor(BG)

ax1 = axes[0]
ax1.plot(results.index, results["Port_Equity"],  color=STRATEGY_COLOR, lw=2.2,
         label=f"MultiFactor SmallMicro 500  CAGR {p_cagr*100:.1f}%", zorder=3)
ax1.plot(results.index, results["Bench_Equity"], color=BNH_COLOR, lw=1.5, ls="--",
         label=f"Equal-Weight Benchmark  CAGR {b_cagr*100:.1f}%", zorder=2)
ax1.fill_between(results.index, results["Port_Equity"], results["Bench_Equity"],
                 where=results["Port_Equity"] >= results["Bench_Equity"], alpha=0.15, color=GREEN)
ax1.fill_between(results.index, results["Port_Equity"], results["Bench_Equity"],
                 where=results["Port_Equity"] <  results["Bench_Equity"], alpha=0.10, color=RED)
ax1.set_yscale("log")
ax1.annotate(
    f"Alpha: {alpha*100:+.1f}% CAGR\nSharpe: {p_sharpe:.2f}  |  Max DD: {p_dd*100:.1f}%\n"
    f"Beats benchmark {beat_pct*100:.0f}% of months",
    xy=(0.02, 0.97), xycoords="axes fraction", va="top", ha="left", fontsize=9, color=GOLD,
    bbox=dict(boxstyle="round,pad=0.4", fc=CARD2, ec=GOLD, alpha=0.85))
legend(ax1, loc="upper left")
style_ax(ax1, f"Growth of ₹100  |  Strategy {p_cagr*100:.1f}% CAGR  vs  Benchmark {b_cagr*100:.1f}%",
         "", "Portfolio value (log, indexed to 100)")
fmt_xaxis(ax1)

ax2 = axes[1]
bar_colors = [GREEN if v >= 0 else RED for v in excess_rets]
ax2.bar(excess_rets.index, excess_rets, color=bar_colors, alpha=0.85, width=15, zorder=3)
ax2.axhline(0, color=GRAY, lw=0.8)
ax2.axhline(float(excess_rets.mean()), color=GOLD, lw=1.2, ls="--",
            label=f"Avg: {excess_rets.mean():+.2f}%/mo")
legend(ax2)
style_ax(ax2, "", "", "Excess return %"); fmt_xaxis(ax2)

ax3 = axes[2]
dd   = (results["Port_Equity"]  - results["Port_Equity"].cummax())  / results["Port_Equity"].cummax()  * 100
dd_b = (results["Bench_Equity"] - results["Bench_Equity"].cummax()) / results["Bench_Equity"].cummax() * 100
ax3.fill_between(results.index, dd,   0, color=STRATEGY_COLOR, alpha=0.35, label="MultiFactor SmallMicro 500")
ax3.plot(results.index, dd, color=STRATEGY_COLOR, lw=1.2)
ax3.fill_between(results.index, dd_b, 0, color=BNH_COLOR, alpha=0.20, label="EW Benchmark")
ax3.plot(results.index, dd_b, color=BNH_COLOR, lw=1.0, ls="--")
ax3.annotate(f"Max DD: {dd.min():.1f}%", xy=(dd.idxmin(), dd.min()),
             xytext=(20, 20), textcoords="offset points",
             arrowprops=dict(arrowstyle="->", color=LGRAY, lw=0.8), fontsize=8, color=LGRAY)
legend(ax3); style_ax(ax3, "", "", "Drawdown %"); fmt_xaxis(ax3)

fig.tight_layout(pad=2.0)
_save(fig, "equity_curve.png")

# ─────────────────────────────────────────────────────────────────────────────
# CHART 3 — Rolling 12-Month Metrics
# ─────────────────────────────────────────────────────────────────────────────
window = 12
rc_p = port_rets.rolling(window).apply(lambda x: ((1+x/100).prod())**(12/window)-1)*100
rc_b = bench_rets.rolling(window).apply(lambda x: ((1+x/100).prod())**(12/window)-1)*100
rf_m = (1 + RISK_FREE)**(1/12) - 1
rs   = ((port_rets/100 - rf_m).rolling(window)
        .apply(lambda x: x.mean()/x.std()*np.sqrt(12) if x.std() > 0 else 0))
rw   = (port_rets > bench_rets).rolling(window).mean() * 100
rv_p = port_rets.rolling(window).std() * np.sqrt(12)
rv_b = bench_rets.rolling(window).std() * np.sqrt(12)

fig, axes = plt.subplots(3, 1, figsize=(14, 11))
fig.patch.set_facecolor(BG)
axes[0].set_title("MultiFactor SmallMicro 500 — Rolling 12-Month Performance Metrics",
                   color=WHITE, fontsize=13, fontweight="bold", loc="left", pad=12)

ax = axes[0]
ax.plot(rc_p.index, rc_p, color=STRATEGY_COLOR, lw=2.0, label="MultiFactor SmallMicro 500")
ax.plot(rc_b.index, rc_b, color=BNH_COLOR, lw=1.5, ls="--", label="EW Benchmark")
ax.axhline(0, color=RED, lw=0.8, ls=":")
ax.fill_between(rc_p.index, rc_p, 0, where=rc_p>=0, alpha=0.10, color=GREEN)
ax.fill_between(rc_p.index, rc_p, 0, where=rc_p<0,  alpha=0.10, color=RED)
legend(ax); style_ax(ax, "", "", "Rolling CAGR %"); fmt_xaxis(ax)

ax = axes[1]
colors_sh = [GREEN if v > 1 else (GOLD if v > 0 else RED) for v in rs.fillna(0)]
ax.bar(rs.index, rs, color=colors_sh, alpha=0.80, width=15, zorder=3)
ax.axhline(1.0, color=GREEN, lw=0.6, ls="--", alpha=0.7, label="Sharpe = 1")
ax.axhline(0.0, color=RED,   lw=0.8, ls=":",  alpha=0.8)
legend(ax); style_ax(ax, "", "", "Rolling Sharpe ratio"); fmt_xaxis(ax)

ax  = axes[2]
ax2 = ax.twinx()
ax.set_facecolor(CARD); ax2.set_facecolor(CARD)
ax.bar(rw.index, rw, width=15, alpha=0.50, color=GOLD, label="12M win rate %", zorder=3)
ax.axhline(50, color=GRAY, lw=0.6, ls="--"); ax.set_ylim(0, 100)
ax2.plot(rv_p.index, rv_p, color=GREEN,    lw=1.5, label="Strategy vol")
ax2.plot(rv_b.index, rv_b, color=BNH_COLOR, lw=1.5, ls="--", label="Benchmark vol")
ax2.tick_params(colors=LGRAY, labelsize=9); ax2.yaxis.label.set_color(LGRAY)
ax2.spines["right"].set_color(GRAY); ax2.spines["right"].set_linewidth(0.5)
ax2.set_ylabel("Ann. Volatility %", color=LGRAY, fontsize=9)
l1, lb1 = ax.get_legend_handles_labels()
l2, lb2 = ax2.get_legend_handles_labels()
leg = ax.legend(l1+l2, lb1+lb2, fontsize=9, framealpha=0.15,
                facecolor=CARD2, edgecolor=GRAY, loc="upper left")
for txt in leg.get_texts(): txt.set_color(WHITE)
style_ax(ax, "", "", "Win Rate %"); fmt_xaxis(ax)

fig.tight_layout(pad=2.0)
_save(fig, "rolling_metrics.png")

# ─────────────────────────────────────────────────────────────────────────────
# CHART 4 — Monthly Heatmaps (portfolio + benchmark)
# ─────────────────────────────────────────────────────────────────────────────
cmap_rg = LinearSegmentedColormap.from_list("rg", [RED, CARD, CARD, GREEN], N=256)

for label, rets, fname in [
    ("Portfolio",  port_rets / 100,  "monthly_heatmap_port.png"),
    ("Benchmark",  bench_rets / 100, "monthly_heatmap_bench.png"),
]:
    hm = make_monthly_pivot(rets)
    finite = hm.values[np.isfinite(hm.values)]
    vabs   = max(np.nanpercentile(np.abs(finite), 95), 1) if len(finite) else 10

    fig, ax = plt.subplots(figsize=(15, max(4, len(hm)*0.6+1)))
    fig.patch.set_facecolor(BG); ax.set_facecolor(CARD)

    im = ax.imshow(hm.values, cmap=cmap_rg, vmin=-vabs, vmax=vabs, aspect="auto")
    ax.set_xticks(range(len(hm.columns))); ax.set_xticklabels(hm.columns, fontsize=8.5, color=LGRAY)
    ax.set_yticks(range(len(hm.index)));  ax.set_yticklabels(hm.index.astype(str), fontsize=8.5, color=LGRAY)

    for ri in range(hm.shape[0]):
        for ci in range(hm.shape[1]):
            v = hm.values[ri, ci]
            if np.isfinite(v):
                fw = "bold" if hm.columns[ci] == "Annual" or abs(v) > 3 else "normal"
                txt_col = WHITE if abs(v) < vabs*0.5 else ("black" if v > 0 else WHITE)
                ax.text(ci, ri, f"{v:.1f}%", ha="center", va="center",
                        fontsize=7.0, color=txt_col, fontweight=fw)

    if "Annual" in hm.columns:
        ann_c = list(hm.columns).index("Annual")
        ax.axvline(ann_c - 0.5, color=GOLD, lw=1.2)

    cbar = fig.colorbar(im, ax=ax, format="%.0f%%", shrink=0.7, pad=0.01)
    cbar.ax.tick_params(colors=LGRAY, labelsize=8)
    for sp in ax.spines.values(): sp.set_visible(False)
    ax.set_title(f"Monthly Returns Heatmap — MultiFactor SmallMicro 500 ({label})",
                 color=WHITE, fontsize=12, fontweight="bold", loc="left", pad=12)
    fig.tight_layout()
    _save(fig, fname)

# ─────────────────────────────────────────────────────────────────────────────
# CHART 5 — Sector / Industry Exposure
# ─────────────────────────────────────────────────────────────────────────────
if holdings_history:
    recs = [
        {"Date": d, "Industry": sector_map.get(t, "Unknown").replace(f"_unk_{t}", "Unknown")}
        for d, hs in holdings_history.items() for t in hs
    ]
    exp_df    = pd.DataFrame(recs)
    sec_freq  = exp_df["Industry"].value_counts()
    top_secs  = sec_freq.head(12).index.tolist()
    sec_pivot = exp_df.groupby(["Date","Industry"]).size().unstack(fill_value=0)
    sec_pivot = sec_pivot.reindex(columns=top_secs, fill_value=0)
    sec_colors = {s: SECTOR_PALETTE[i % len(SECTOR_PALETTE)] for i, s in enumerate(top_secs)}

    fig, axes = plt.subplots(2, 1, figsize=(14, 10), gridspec_kw={"height_ratios": [2, 1]})
    fig.patch.set_facecolor(BG)
    axes[0].set_title("MultiFactor SmallMicro 500 — Industry Exposure Over Time",
                       color=WHITE, fontsize=13, fontweight="bold", loc="left", pad=12)

    ax     = axes[0]
    bottom = np.zeros(len(sec_pivot))
    for sec in top_secs:
        vals_s = sec_pivot[sec].values
        ax.fill_between(sec_pivot.index, bottom, bottom + vals_s,
                        label=sec.replace(" / ", "/"), alpha=0.88, color=sec_colors[sec], zorder=2)
        bottom += vals_s
    ax.set_ylim(0, TOP_N + 3); ax.axhline(TOP_N, color=GRAY, lw=0.7, ls="--")
    leg = ax.legend(loc="upper right", fontsize=7, framealpha=0.3, ncol=2,
                    facecolor=CARD2, edgecolor=GRAY,
                    handles=[mpatches.Patch(color=sec_colors[s], label=s.replace(" / ","/"))
                             for s in top_secs])
    for txt in leg.get_texts(): txt.set_color(WHITE)
    style_ax(ax, "", "", "Stocks in Portfolio"); fmt_xaxis(ax)

    ax          = axes[1]
    total_slots = len(holdings_history) * TOP_N
    freq_pct    = (sec_freq / total_slots * 100).head(12)
    bar_colors  = [sec_colors.get(s, GRAY) for s in freq_pct.index]
    bars = ax.barh(range(len(freq_pct)), freq_pct.values, color=bar_colors, alpha=0.9, zorder=3)
    ax.set_yticks(range(len(freq_pct)))
    ax.set_yticklabels([s.replace(" / ","/") for s in freq_pct.index], color=LGRAY, fontsize=8)
    for bar, val in zip(bars, freq_pct.values):
        ax.text(val + 0.2, bar.get_y() + bar.get_height()/2,
                f"{val:.1f}%", va="center", color=WHITE, fontsize=7)
    style_ax(ax, "Average Industry Weight Across All Months", "% of All Portfolio Slots", "")

    fig.tight_layout(pad=2.0)
    _save(fig, "sector_exposure.png")

# ─────────────────────────────────────────────────────────────────────────────
# CHART 6 — Return Distribution & Risk
# ─────────────────────────────────────────────────────────────────────────────
fig = plt.figure(figsize=(16, 10))
fig.patch.set_facecolor(BG)
fig.suptitle("MultiFactor SmallMicro 500 — Return Distribution & Risk Analysis",
             color=WHITE, fontsize=13, fontweight="bold", y=1.01)
gs = GridSpec(2, 3, figure=fig, hspace=0.45, wspace=0.35)

ax = fig.add_subplot(gs[0, :2])
bins = np.linspace(min(port_rets.min(), bench_rets.min()) - 1,
                   max(port_rets.max(), bench_rets.max()) + 1, 36)
ax.hist(port_rets,  bins=bins, color=STRATEGY_COLOR, alpha=0.65,
        label="MultiFactor SmallMicro 500", edgecolor=BG, zorder=3)
ax.hist(bench_rets, bins=bins, color=BNH_COLOR, alpha=0.45,
        label="EW Benchmark", edgecolor=BG, zorder=2)
for rets2, color in [(port_rets, STRATEGY_COLOR), (bench_rets, BNH_COLOR)]:
    mu, sig = rets2.mean(), rets2.std()
    x2 = np.linspace(rets2.min(), rets2.max(), 200)
    y2 = norm.pdf(x2, mu, sig) * len(rets2) * (bins[1] - bins[0])
    ax.plot(x2, y2, color=color, lw=1.5, ls="--")
ax.axvline(var_95, color=RED, lw=1.5, ls="--", label=f"VaR 95%: {var_95:.1f}%")
ax.axvline(0, color=GRAY, lw=0.8)
legend(ax)
style_ax(ax, "Monthly Return Distribution", "Monthly return (%)", "Frequency")

ax = fig.add_subplot(gs[0, 2])
bex = np.linspace(excess_rets.min()-0.5, excess_rets.max()+0.5, 25)
cnt2, _ = np.histogram(excess_rets, bins=bex)
mid2 = (bex[:-1]+bex[1:])/2
for c2, m2, l2, r2 in zip(cnt2, mid2, bex[:-1], bex[1:]):
    ax.bar((l2+r2)/2, c2, width=(r2-l2)*0.9,
           color=GREEN if m2 >= 0 else RED, alpha=0.85, edgecolor=BG, zorder=3)
ax.axvline(0, color=GRAY, lw=0.8, ls="--")
ax.axvline(float(excess_rets.mean()), color=GOLD, lw=1.5, ls="--",
           label=f"Mean: {excess_rets.mean():+.2f}%")
legend(ax)
style_ax(ax, "Excess Return vs Benchmark", "Excess return (%)", "Frequency")

ax = fig.add_subplot(gs[1, 0])
sc_c = [GREEN if p > b else RED for p, b in zip(port_rets, bench_rets)]
ax.scatter(bench_rets, port_rets, c=sc_c, alpha=0.75, s=40, zorder=3)
lim = max(abs(bench_rets).max(), abs(port_rets).max()) + 2
ax.plot([-lim, lim], [-lim, lim], color=GRAY, lw=1, ls="--", label="No alpha line")
mr, br2 = np.polyfit(bench_rets, port_rets, 1)
xr2 = np.array([-lim, lim])
ax.plot(xr2, mr*xr2+br2, color=GOLD, lw=1.5, label=f"β={mr:.2f}  α={br2:.2f}%/mo")
ax.set_xlim(-lim, lim); ax.set_ylim(-lim, lim)
legend(ax)
style_ax(ax, "Portfolio vs Benchmark", "Benchmark return %", "Portfolio return %")

ax = fig.add_subplot(gs[1, 1])
ax.set_facecolor(CARD2); ax.axis("off")
up_m = bench_rets > 0; dn_m = bench_rets < 0
uc   = (port_rets[up_m].mean()/bench_rets[up_m].mean()
        if bench_rets[up_m].mean() != 0 else 0)
dc   = (port_rets[dn_m].mean()/bench_rets[dn_m].mean()
        if bench_rets[dn_m].mean() != 0 else 0)
table_rows = [
    ("Metric",          "Strategy",                                   "Benchmark"),
    ("CAGR",            f"{p_cagr*100:+.1f}%",                       f"{b_cagr*100:+.1f}%"),
    ("Sharpe",          f"{p_sharpe:.2f}",                            f"{b_sharpe:.2f}"),
    ("Mean monthly",    f"{port_rets.mean():+.2f}%",                  f"{bench_rets.mean():+.2f}%"),
    ("Ann. volatility", f"{port_rets.std()*np.sqrt(12):.1f}%",       f"{bench_rets.std()*np.sqrt(12):.1f}%"),
    ("Skewness",        f"{port_rets.skew():.2f}",                   f"{bench_rets.skew():.2f}"),
    ("VaR 95%",         f"{var_95:.1f}%",                            "—"),
    ("CVaR 95%",        f"{cvar_95:.1f}%",                           "—"),
    ("Max Drawdown",    f"{p_dd*100:.1f}%",                          f"{b_dd*100:.1f}%"),
    ("Best month",      f"{port_rets.max():+.1f}%",                  f"{bench_rets.max():+.1f}%"),
    ("Worst month",     f"{port_rets.min():+.1f}%",                  f"{bench_rets.min():+.1f}%"),
    ("Up capture",      f"{uc:.2f}×",                                "1.00×"),
    ("Down capture",    f"{dc:.2f}×",                                "1.00×"),
    ("Win rate",        f"{beat_pct*100:.1f}%",                      "—"),
]
row_h_t = 0.072
for ri, row in enumerate(table_rows):
    row_bg2 = CARD2 if ri % 2 == 0 else CARD
    ax.add_patch(mpatches.FancyBboxPatch(
        (0, 1 - (ri+1)*row_h_t - 0.005), 1, row_h_t*0.95,
        transform=ax.transAxes, boxstyle="square,pad=0",
        facecolor=row_bg2, edgecolor="none", zorder=0))
    for ci, cell in enumerate(row):
        ax.text(ci * 0.36 + 0.02, 1 - ri * row_h_t - 0.015, cell,
                transform=ax.transAxes, va="top",
                color=WHITE if ri == 0 else (LGRAY if ci == 0 else WHITE),
                fontweight="bold" if ri == 0 else "normal", fontsize=7.5)
ax.set_title("Risk Statistics", color=WHITE, fontsize=10, fontweight="bold", loc="left", pad=8)

ax = fig.add_subplot(gs[1, 2])
dds = (results["Port_Equity"] - results["Port_Equity"].cummax()) / results["Port_Equity"].cummax() * 100
ax.fill_between(results.index, dds, 0, color=RED, alpha=0.40)
ax.plot(results.index, dds, color=RED, lw=1.2)
mi = dds.idxmin()
ax.annotate(f"Max DD: {dds.min():.1f}%", xy=(mi, dds.min()),
            xytext=(20, 20), textcoords="offset points",
            arrowprops=dict(arrowstyle="->", color=LGRAY, lw=0.8), fontsize=8, color=LGRAY)
style_ax(ax, "Underwater Chart", "", "Drawdown %")
fmt_xaxis(ax, interval=12)

fig.tight_layout(pad=2.0)
_save(fig, "return_distribution.png")

# ─────────────────────────────────────────────────────────────────────────────
# SAVE CSV
# ─────────────────────────────────────────────────────────────────────────────
results.to_csv(os.path.join(OUTPUTS_DIR, "results.csv"))
print(f"  ✓  results.csv")

print(f"""
✅  All outputs saved to:
    {OUTPUTS_DIR}

    summary.png                   — performance scorecard
    equity_curve.png              — growth (log), excess returns, drawdown
    rolling_metrics.png           — rolling CAGR, Sharpe, win rate + vol
    monthly_heatmap_port.png      — portfolio monthly heatmap
    monthly_heatmap_bench.png     — benchmark monthly heatmap
    sector_exposure.png           — stacked industry allocation over time
    return_distribution.png       — histogram, scatter, risk table, underwater
    results.csv                   — monthly returns data
""")
