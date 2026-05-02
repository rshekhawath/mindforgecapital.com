"""
MultiFactor LargeMidcap 250 — Backtest
=======================================
Factor Model
------------
  Momentum          45%  =  (12-1m return + 6m return) / 2
  Trend Strength    45%  =  price/SMA200 + annualised linreg slope (63-day)
  Low Volatility    05%  =  −252-day realised volatility
  52-Week High      03%  =  price / 52-week high
  Amihud Liquidity  02%  =  −Amihud illiquidity (60-day avg |ret|/₹turnover)

Charts saved to outputs/
------------------------
  summary.png              — performance scorecard
  growth.png               — growth of ₹1,00,000 (fund + benchmark)
  rolling_returns.png      — rolling 12M CAGR (top) + rolling Sharpe (bottom)
  drawdown.png             — drawdown from peak (fund + benchmark)
  fund_vs_bench.png        — cumulative % returns from 0% (fund + benchmark)
  results.csv              — monthly returns data
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
from scipy.stats import norm as sp_norm
from datetime import datetime
from dateutil.relativedelta import relativedelta

# ── Shared modules ────────────────────────────────────────────────────────────
ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, ROOT_DIR)

from shared.config import LARGEMIDCAP, RISK_FREE
from shared.backtest_engine import (
    safe_zscore, extract_field, build_rebalancing_dates,
    period_return, compute_performance_stats,
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
BASE_DIR       = os.path.dirname(os.path.abspath(__file__))
UNIVERSE_PATH  = os.path.join(BASE_DIR, "universe.xlsx")
OUTPUTS_DIR    = os.path.join(BASE_DIR, "outputs")
os.makedirs(OUTPUTS_DIR, exist_ok=True)

UNIVERSE_SHEET   = LARGEMIDCAP["UNIVERSE_SHEET"]
TOP_N            = LARGEMIDCAP["TOP_N"]
MAX_PER_SECTOR   = LARGEMIDCAP["MAX_PER_SECTOR"]
BACKTEST_YEARS   = LARGEMIDCAP["BACKTEST_YEARS"]
TRANSACTION_COST = LARGEMIDCAP["TRANSACTION_COST"]
W_MOMENTUM       = LARGEMIDCAP["W_MOMENTUM"]
W_TREND          = LARGEMIDCAP["W_TREND"]
W_LOWVOL         = LARGEMIDCAP["W_LOWVOL"]
W_HIGH52         = LARGEMIDCAP["W_HIGH52"]
W_AMIHUD         = LARGEMIDCAP["W_AMIHUD"]

def _save(fig, name):
    save(fig, name, OUTPUTS_DIR)

# ─────────────────────────────────────────────────────────────────────────────
# STEP 1 · LOAD UNIVERSE
# ─────────────────────────────────────────────────────────────────────────────
print("=" * 60)
print("STEP 1 · Loading universe from universe.xlsx")
print("=" * 60)

if not os.path.exists(UNIVERSE_PATH):
    raise FileNotFoundError(
        f"Universe file not found:\n  {UNIVERSE_PATH}\n\n"
        "Run portfolio_builder.py first (which requires universe.xlsx)."
    )

df_universe = pd.read_excel(UNIVERSE_PATH, sheet_name=UNIVERSE_SHEET)
df_universe.columns = df_universe.columns.str.strip()

required_cols = ["Symbol", "Yahoo Finance Ticker", "Industry", "Company Name"]
missing_cols  = [c for c in required_cols if c not in df_universe.columns]
if missing_cols:
    raise ValueError(f"universe.xlsx missing columns: {missing_cols}")

dummy_mask  = df_universe["Symbol"].str.upper().str.startswith("DUMMY")
if dummy_mask.any():
    removed     = df_universe.loc[dummy_mask, "Yahoo Finance Ticker"].tolist()
    df_universe = df_universe[~dummy_mask].reset_index(drop=True)
    print(f"  Removed {len(removed)} NSE dummy placeholder(s): {removed}")

tickers    = df_universe["Yahoo Finance Ticker"].dropna().str.strip().tolist()
sector_map = dict(zip(df_universe["Yahoo Finance Ticker"], df_universe["Industry"]))
print(f"Universe: {len(tickers)} stocks across {df_universe['Industry'].nunique()} industries")

# ─────────────────────────────────────────────────────────────────────────────
# STEP 2 · DOWNLOAD OHLCV HISTORY
# ─────────────────────────────────────────────────────────────────────────────
print("\n" + "=" * 60)
print("STEP 2 · Downloading OHLCV history")
print("=" * 60)

end_date   = datetime.today()
start_date = end_date - relativedelta(years=BACKTEST_YEARS) - relativedelta(months=15)

raw = yf.download(tickers, start=start_date, end=end_date,
                  auto_adjust=True, progress=True)

prices  = extract_field(raw, "Close").ffill()
volumes = extract_field(raw, "Volume").fillna(0)

prices  = prices.dropna(axis=1, how="all").dropna(axis=1, thresh=300)
valid   = prices.columns.tolist()
volumes = volumes.reindex(columns=valid).fillna(0)
sector_map = {t: sector_map[t] for t in valid if t in sector_map}
print(f"\n✓ {len(valid)} tickers with sufficient history")

# ─────────────────────────────────────────────────────────────────────────────
# STEP 3 · REBALANCING DATES
# ─────────────────────────────────────────────────────────────────────────────
print("\n" + "=" * 60)
print("STEP 3 · Building monthly rebalancing schedule")
print("=" * 60)

rebal_dates = build_rebalancing_dates(prices, start_date, lookback_months=13)
print(f"Backtest period : {rebal_dates[0].date()} → {rebal_dates[-1].date()}")
print(f"Rebalancing dates: {len(rebal_dates)} months")

# ─────────────────────────────────────────────────────────────────────────────
# STRATEGY HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def select_portfolio(as_of):
    """Build the LargeMidcap factor portfolio as of a given date."""
    p_hist = prices.loc[:as_of]
    v_hist = volumes.loc[:as_of]
    recs   = {}

    for t in valid:
        p = p_hist[t].dropna()
        v = v_hist[t] if t in v_hist.columns else pd.Series(dtype=float)
        if len(p) < 252:
            continue
        rec = {}
        r12 = (p.iloc[-1] / p.iloc[-252]) - 1
        r6  = (p.iloc[-1] / p.iloc[-126]) - 1
        r1  = (p.iloc[-1] / p.iloc[-21])  - 1
        rec["Momentum"] = ((r12 - r1) + r6) / 2

        sma200       = p.iloc[-200:].mean()
        sma_ratio    = (p.iloc[-1] / sma200) - 1
        log_p        = np.log(p.iloc[-63:].values)
        x            = np.arange(len(log_p))
        slope, _     = np.polyfit(x, log_p, 1)
        rec["Trend"] = sma_ratio + (slope * 252)

        daily_rets     = p.pct_change().iloc[-252:]
        rec["LowVol"]  = -(daily_rets.std() * np.sqrt(252))
        rec["High52"]  = p.iloc[-1] / p.iloc[-252:].max()

        if len(v) >= 60 and v.iloc[-60:].sum() > 0:
            idx60        = daily_rets.index.intersection(v.index)
            r60          = daily_rets.reindex(idx60).iloc[-60:]
            v60          = v.reindex(idx60).iloc[-60:]
            p60          = p.reindex(idx60).iloc[-60:]
            turnover     = (v60 * p60).replace(0, np.nan)
            rec["Amihud"] = -(r60.abs() / turnover).mean()
        else:
            rec["Amihud"] = np.nan

        recs[t] = rec

    df = pd.DataFrame(recs).T.dropna(subset=["Momentum", "Trend", "LowVol", "High52"])
    if df.empty:
        return []

    df["Z_Mom"]    = safe_zscore(df["Momentum"])
    df["Z_Trend"]  = safe_zscore(df["Trend"])
    df["Z_LowVol"] = safe_zscore(df["LowVol"])
    df["Z_High52"] = safe_zscore(df["High52"])
    df["Z_Amihud"] = safe_zscore(df["Amihud"])

    df["Score"] = (
        W_MOMENTUM * df["Z_Mom"]    +
        W_TREND    * df["Z_Trend"]  +
        W_LOWVOL   * df["Z_LowVol"] +
        W_HIGH52   * df["Z_High52"] +
        W_AMIHUD   * df["Z_Amihud"]
    )
    df["Sector"] = df.index.map(sector_map)
    df = df.sort_values("Score", ascending=False)

    port = (
        df.groupby("Sector", group_keys=False)
          .apply(lambda g: g.head(MAX_PER_SECTOR))
          .sort_values("Score", ascending=False)
          .head(TOP_N)
    )
    return port.index.tolist()

# ─────────────────────────────────────────────────────────────────────────────
# STEP 4 · RUN BACKTEST
# ─────────────────────────────────────────────────────────────────────────────
print("\n" + "=" * 60)
print("STEP 4 · Running backtest")
print("=" * 60)

rows             = []
prev_holdings    = []
turnover_list    = []
holdings_history = []

for i in range(len(rebal_dates) - 1):
    start    = rebal_dates[i]
    end      = rebal_dates[i + 1]
    holdings = select_portfolio(start)
    if not holdings:
        continue

    port_ret  = period_return(prices, holdings, start, end)
    changed   = (len(set(holdings) ^ set(prev_holdings)) / TOP_N
                 if prev_holdings else 1.0)
    port_ret -= changed * TRANSACTION_COST
    bench_ret = period_return(prices, valid, start, end)

    rows.append({"Date": end, "Portfolio": port_ret,
                 "Benchmark": bench_ret, "N_Holdings": len(holdings)})
    turnover_list.append(changed)
    holdings_history.append((start, holdings))
    prev_holdings = holdings

    if i % 6 == 0:
        print(f"  {start.date()}  →  Portfolio: {port_ret*100:+.1f}%  "
              f"Benchmark: {bench_ret*100:+.1f}%  Holdings: {len(holdings)}")

# ─────────────────────────────────────────────────────────────────────────────
# STEP 5 · METRICS
# ─────────────────────────────────────────────────────────────────────────────
print("\n" + "=" * 60)
print("STEP 5 · Performance metrics")
print("=" * 60)

results = pd.DataFrame(rows).set_index("Date")
results["Port_Equity"]  = (1 + results["Portfolio"]).cumprod() * 100
results["Bench_Equity"] = (1 + results["Benchmark"]).cumprod() * 100

stats = compute_performance_stats(
    results["Portfolio"], results["Benchmark"],
    results["Port_Equity"], results["Bench_Equity"],
)
p_cagr    = stats["p_cagr"];   b_cagr  = stats["b_cagr"]
p_sharpe  = stats["p_sharpe"]; b_sharpe = stats["b_sharpe"]
p_dd      = stats["p_dd"];     b_dd    = stats["b_dd"]
alpha     = stats["alpha"];    beat_pct = stats["beat_pct"]
port_rets = stats["port_pct"]; bench_rets = stats["bench_pct"]
excess_rets = stats["excess_pct"]
var_95    = stats["var_95"];   cvar_95 = stats["cvar_95"]
p_vol     = stats["p_vol"];    b_vol   = stats["b_vol"]
p_win     = stats["p_win"];    b_win   = stats["b_win"]
p_total   = stats["p_total"];  b_total = stats["b_total"]
calmar_p  = stats["calmar_p"]; calmar_b = stats["calmar_b"]
avg_turn  = np.mean(turnover_list)

print(f"""
  CAGR        Portfolio: {p_cagr*100:.1f}%  |  Benchmark: {b_cagr*100:.1f}%
  Alpha (CAGR)  {alpha*100:+.1f}%
  Sharpe        Portfolio: {p_sharpe:.2f}  |  Benchmark: {b_sharpe:.2f}
  Max Drawdown  Portfolio: {p_dd*100:.1f}%  |  Benchmark: {b_dd*100:.1f}%
  Beats bench   {beat_pct*100:.0f}% of months
  VaR 95%       {var_95:.1f}%
""")

print("\nGenerating charts...")

# ─────────────────────────────────────────────────────────────────────────────
# CHART 1 — Summary scorecard
# ─────────────────────────────────────────────────────────────────────────────
fig, ax = plt.subplots(figsize=(11, 5.5))
ax.set_facecolor(CARD); fig.patch.set_facecolor(BG); ax.axis("off")

metrics_rows = [
    ("Total return",  f"{p_total:.1%}",        f"{b_total:.1%}",        True),
    ("CAGR",          f"{p_cagr:.1%}",          f"{b_cagr:.1%}",          True),
    ("Volatility",    f"{p_vol:.1%}",            f"{b_vol:.1%}",            False),
    ("Sharpe ratio",  f"{p_sharpe:.2f}",         f"{b_sharpe:.2f}",         True),
    ("Max drawdown",  f"{p_dd:.1%}",             f"{b_dd:.1%}",             False),
    ("Calmar ratio",  f"{calmar_p:.2f}",         f"{calmar_b:.2f}",         True),
    ("Win rate",      f"{p_win:.1%}",            f"{b_win:.1%}",            True),
    ("Best month",    f"{port_rets.max():.1f}%",  f"{bench_rets.max():.1f}%", True),
    ("Worst month",   f"{port_rets.min():.1f}%",  f"{bench_rets.min():.1f}%", False),
    ("Alpha (CAGR)",  f"{alpha*100:+.1f}%",      "—",                       True),
]

col_x   = [0.02, 0.42, 0.66, 0.88]
headers = ["Metric", "MultiFactor LargeMidcap", "EW Benchmark", "Edge"]
row_h   = 0.082
y_start = 0.92

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

ax.set_title("MultiFactor LargeMidcap 250 — Performance Summary",
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
        label=f"MultiFactor LargeMidcap 250  CAGR {p_cagr*100:.1f}%", zorder=3)
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
ROLL = 12
rolling_cagr_p = results["Portfolio"].rolling(ROLL).apply(lambda x: (1+x).prod()**(12/ROLL)-1)
rolling_cagr_b = results["Benchmark"].rolling(ROLL).apply(lambda x: (1+x).prod()**(12/ROLL)-1)
rolling_sharpe = results["Portfolio"].rolling(ROLL).apply(
    lambda x: (x.mean()/x.std())*np.sqrt(12) if x.std() > 1e-8 else np.nan)
rolling_sharpe_b = results["Benchmark"].rolling(ROLL).apply(
    lambda x: (x.mean()/x.std())*np.sqrt(12) if x.std() > 1e-8 else np.nan)

fig, axes = plt.subplots(2, 1, figsize=(14, 9))
fig.patch.set_facecolor(BG)
axes[0].set_title("MultiFactor LargeMidcap 250 — Rolling 12-Month Performance",
                   color=WHITE, fontsize=13, fontweight="bold", loc="left", pad=12)

ax = axes[0]
ax.plot(results.index, rolling_cagr_p * 100, color=STRATEGY_COLOR, lw=2.0,
        label="MultiFactor LargeMidcap 250")
ax.plot(results.index, rolling_cagr_b * 100, color=BNH_COLOR, lw=1.5, ls="--",
        label="EW Benchmark")
ax.axhline(0, color=RED, lw=0.8, ls=":")
ax.fill_between(results.index, rolling_cagr_p*100, 0, where=rolling_cagr_p>=0, alpha=0.10, color=GREEN)
ax.fill_between(results.index, rolling_cagr_p*100, 0, where=rolling_cagr_p<0,  alpha=0.10, color=RED)
legend(ax); style_ax(ax, "", "", "Rolling 12M CAGR %"); fmt_xaxis(ax)

ax = axes[1]
ax.plot(results.index, rolling_sharpe,   color=STRATEGY_COLOR, lw=2.0,
        label="MultiFactor LargeMidcap 250")
ax.plot(results.index, rolling_sharpe_b, color=BNH_COLOR, lw=1.5, ls="--",
        label="EW Benchmark")
ax.axhline(0,   color=RED,   lw=0.8, ls=":")
ax.axhline(1.0, color=GREEN, lw=0.6, ls="--", alpha=0.6)
ax.fill_between(results.index, rolling_sharpe, 0, where=rolling_sharpe>=0, alpha=0.12, color=STRATEGY_COLOR)
ax.fill_between(results.index, rolling_sharpe, 0, where=rolling_sharpe<0,  alpha=0.12, color=RED)
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
                label="MultiFactor LargeMidcap 250")
ax.plot(results.index, dd, color=STRATEGY_COLOR, lw=1.4)
ax.fill_between(results.index, dd_b, 0, color=BNH_COLOR, alpha=0.20, label="EW Benchmark")
ax.plot(results.index, dd_b, color=BNH_COLOR, lw=1.0, ls="--")
mdd_v = float(dd.min())
ax.annotate(f"Max DD: {mdd_v:.1f}%", xy=(dd.idxmin(), mdd_v),
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
        label=f"MultiFactor LargeMidcap 250  CAGR {p_cagr*100:.1f}%", zorder=3)
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
