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
  equity_curve.png         — equity curve, excess returns, drawdown
  rolling_metrics.png      — rolling 12M CAGR, Sharpe, win rate + vol
  monthly_heatmap.png      — month-by-month return heatmap
  sector_exposure.png      — sector stacked area + frequency bar
  return_distribution.png  — histogram, scatter, risk table, underwater
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
# CHART 2 — Equity Curve
# ─────────────────────────────────────────────────────────────────────────────
fig, axes = plt.subplots(3, 1, figsize=(14, 12),
                          gridspec_kw={"height_ratios": [3, 1, 1]})
fig.patch.set_facecolor(BG)

ax1 = axes[0]
ax1.plot(results.index, results["Port_Equity"], color=STRATEGY_COLOR, lw=2.2,
         label=f"MultiFactor LargeMidcap 250  CAGR {p_cagr*100:.1f}%", zorder=3)
ax1.plot(results.index, results["Bench_Equity"], color=BNH_COLOR, lw=1.5, ls="--",
         label=f"Equal-Weight Benchmark  CAGR {b_cagr*100:.1f}%", zorder=2)
ax1.fill_between(results.index, results["Port_Equity"], results["Bench_Equity"],
                 where=results["Port_Equity"] >= results["Bench_Equity"],
                 alpha=0.15, color=GREEN)
ax1.fill_between(results.index, results["Port_Equity"], results["Bench_Equity"],
                 where=results["Port_Equity"] < results["Bench_Equity"],
                 alpha=0.10, color=RED)
ax1.annotate(
    f"Alpha: {alpha*100:+.1f}% CAGR\nSharpe: {p_sharpe:.2f}  |  Max DD: {p_dd*100:.1f}%\n"
    f"Beats benchmark {beat_pct*100:.0f}% of months",
    xy=(0.02, 0.97), xycoords="axes fraction", va="top", ha="left", fontsize=9, color=GOLD,
    bbox=dict(boxstyle="round,pad=0.4", fc=CARD2, ec=GOLD, alpha=0.85))
legend(ax1, loc="upper left")
style_ax(ax1, f"Growth of ₹100  |  Strategy {p_cagr*100:.1f}% CAGR  vs  Benchmark {b_cagr*100:.1f}%",
         "", "Portfolio value (indexed to 100)")
fmt_xaxis(ax1)

ax2 = axes[1]
excess     = results["Portfolio"] - results["Benchmark"]
bar_colors = [GREEN if x >= 0 else RED for x in excess]
ax2.bar(results.index, excess * 100, color=bar_colors, width=20, alpha=0.85, zorder=3)
ax2.axhline(0, color=GRAY, lw=0.8)
style_ax(ax2, "", "", "Excess return %")
fmt_xaxis(ax2)

ax3 = axes[2]
dd = (results["Port_Equity"] - results["Port_Equity"].cummax()) / results["Port_Equity"].cummax() * 100
ax3.fill_between(results.index, dd, 0, color=STRATEGY_COLOR, alpha=0.35, label="MultiFactor LargeMidcap 250")
ax3.plot(results.index, dd, color=STRATEGY_COLOR, lw=1.2)
dd_b = (results["Bench_Equity"] - results["Bench_Equity"].cummax()) / results["Bench_Equity"].cummax() * 100
ax3.fill_between(results.index, dd_b, 0, color=BNH_COLOR, alpha=0.20, label="EW Benchmark")
ax3.plot(results.index, dd_b, color=BNH_COLOR, lw=1.0, ls="--")
mdd_v = float(dd.min())
ax3.annotate(f"Max DD: {mdd_v:.1f}%", xy=(dd.idxmin(), mdd_v),
             xytext=(20, 20), textcoords="offset points",
             arrowprops=dict(arrowstyle="->", color=LGRAY, lw=0.8), fontsize=8, color=LGRAY)
legend(ax3)
style_ax(ax3, "", "", "Drawdown %")
fmt_xaxis(ax3)

fig.tight_layout(pad=2.0)
_save(fig, "equity_curve.png")

# ─────────────────────────────────────────────────────────────────────────────
# CHART 3 — Rolling Metrics
# ─────────────────────────────────────────────────────────────────────────────
ROLL = 12
rolling_cagr_p  = results["Portfolio"].rolling(ROLL).apply(lambda x: (1+x).prod()**(12/ROLL)-1)
rolling_cagr_b  = results["Benchmark"].rolling(ROLL).apply(lambda x: (1+x).prod()**(12/ROLL)-1)
rolling_sharpe  = results["Portfolio"].rolling(ROLL).apply(
    lambda x: (x.mean()/x.std())*np.sqrt(12) if x.std() > 0 else 0)
rolling_win     = (results["Portfolio"] > results["Benchmark"]).rolling(ROLL).mean() * 100
rolling_vol_p   = results["Portfolio"].rolling(ROLL).std() * np.sqrt(12) * 100
rolling_vol_b   = results["Benchmark"].rolling(ROLL).std() * np.sqrt(12) * 100

fig, axes = plt.subplots(3, 1, figsize=(14, 11))
fig.patch.set_facecolor(BG)
axes[0].set_title("MultiFactor LargeMidcap 250 — Rolling 12-Month Performance Metrics",
                   color=WHITE, fontsize=13, fontweight="bold", loc="left", pad=12)

ax = axes[0]
ax.plot(results.index, rolling_cagr_p * 100, color=STRATEGY_COLOR, lw=2.0, label="MultiFactor LargeMidcap 250")
ax.plot(results.index, rolling_cagr_b * 100, color=BNH_COLOR, lw=1.5, ls="--", label="EW Benchmark")
ax.axhline(0, color=RED, lw=0.8, ls=":")
ax.fill_between(results.index, rolling_cagr_p*100, 0, where=rolling_cagr_p>=0, alpha=0.10, color=GREEN)
ax.fill_between(results.index, rolling_cagr_p*100, 0, where=rolling_cagr_p<0,  alpha=0.10, color=RED)
legend(ax); style_ax(ax, "", "", "Rolling CAGR %"); fmt_xaxis(ax)

ax = axes[1]
ax.plot(results.index, rolling_sharpe, color=STRATEGY_COLOR, lw=2.0, label="MultiFactor LargeMidcap 250")
ax.axhline(0, color=RED, lw=0.8, ls=":")
ax.axhline(1.0, color=GREEN, lw=0.6, ls="--", alpha=0.6)
ax.fill_between(results.index, rolling_sharpe, 0, where=rolling_sharpe>=0, alpha=0.12, color=STRATEGY_COLOR)
ax.fill_between(results.index, rolling_sharpe, 0, where=rolling_sharpe<0,  alpha=0.12, color=RED)
legend(ax); style_ax(ax, "", "", "Rolling Sharpe ratio"); fmt_xaxis(ax)

ax  = axes[2]
ax2 = ax.twinx()
ax.set_facecolor(CARD); ax2.set_facecolor(CARD)
ax.bar(results.index, rolling_win, width=20, alpha=0.50, color=GOLD, label="12M win rate %", zorder=3)
ax.axhline(50, color=GRAY, lw=0.6, ls="--")
ax.set_ylim(0, 100)
ax2.plot(results.index, rolling_vol_p, color=GREEN,    lw=1.5, label="Strategy vol")
ax2.plot(results.index, rolling_vol_b, color=BNH_COLOR, lw=1.5, ls="--", label="Benchmark vol")
ax2.tick_params(colors=LGRAY, labelsize=9)
ax2.yaxis.label.set_color(LGRAY)
ax2.spines["right"].set_color(GRAY); ax2.spines["right"].set_linewidth(0.5)
ax2.set_ylabel("Ann. Volatility %", color=LGRAY, fontsize=9)
l1, lb1 = ax.get_legend_handles_labels()
l2, lb2 = ax2.get_legend_handles_labels()
leg = ax.legend(l1+l2, lb1+lb2, fontsize=9, framealpha=0.15, facecolor=CARD2, edgecolor=GRAY, loc="upper left")
for txt in leg.get_texts(): txt.set_color(WHITE)
style_ax(ax, "", "", "Win Rate %"); fmt_xaxis(ax)

fig.tight_layout(pad=2.0)
_save(fig, "rolling_metrics.png")

# ─────────────────────────────────────────────────────────────────────────────
# CHART 4 — Monthly Heatmap
# ─────────────────────────────────────────────────────────────────────────────
port_pv  = make_monthly_pivot(results["Portfolio"])
bench_pv = make_monthly_pivot(results["Benchmark"])

cmap = LinearSegmentedColormap.from_list("rg", [RED, CARD, CARD, GREEN], N=256)

fig, axes = plt.subplots(2, 1, figsize=(16, max(5, len(port_pv)*0.7 + 3)))
fig.patch.set_facecolor(BG)
axes[0].set_title("Monthly Returns Heatmap — MultiFactor LargeMidcap 250",
                   color=WHITE, fontsize=13, fontweight="bold", loc="left", pad=12)

for ax, pv, subtitle in zip(
    axes,
    [port_pv, bench_pv],
    ["Strategy (Mom45·Trend45·LowVol5·High52·3·Amihud2)", "Equal-Weight Benchmark"]
):
    ax.set_facecolor(CARD)
    vals   = pv.values.astype(float)
    finite = vals[np.isfinite(vals)]
    vabs   = max(np.nanpercentile(np.abs(finite), 95), 1) if len(finite) else 10

    im = ax.imshow(vals, cmap=cmap, vmin=-vabs, vmax=vabs, aspect="auto")
    ax.set_xticks(range(len(pv.columns)))
    ax.set_xticklabels(pv.columns, fontsize=8.5, color=LGRAY)
    ax.set_yticks(range(len(pv.index)))
    ax.set_yticklabels(pv.index, fontsize=8.5, color=LGRAY)
    ax.set_title(subtitle, color=GOLD, fontsize=9.5, pad=6, loc="left")

    for ri in range(len(pv.index)):
        for ci in range(len(pv.columns)):
            v = vals[ri, ci]
            if np.isfinite(v):
                fw      = "bold" if pv.columns[ci] == "Annual" or abs(v) > 3 else "normal"
                txt_col = WHITE if abs(v) < vabs * 0.5 else ("black" if v > 0 else WHITE)
                ax.text(ci, ri, f"{v:.1f}%", ha="center", va="center",
                        fontsize=7.0, color=txt_col, fontweight=fw)

    ann_c = list(pv.columns).index("Annual")
    ax.axvline(ann_c - 0.5, color=GOLD, lw=1.2)
    cbar = fig.colorbar(im, ax=ax, format="%.0f%%", shrink=0.7, pad=0.01)
    cbar.ax.tick_params(colors=LGRAY, labelsize=8)
    for sp in ax.spines.values(): sp.set_visible(False)

fig.tight_layout(pad=2.0)
_save(fig, "monthly_heatmap.png")

# ─────────────────────────────────────────────────────────────────────────────
# CHART 5 — Sector Exposure
# ─────────────────────────────────────────────────────────────────────────────
sec_records = [{"Date": dt, "Sector": sector_map.get(t, "Unknown")}
               for dt, hlds in holdings_history for t in hlds]
df_sec = pd.DataFrame(sec_records)

if not df_sec.empty:
    sec_pivot  = df_sec.groupby(["Date","Sector"]).size().unstack(fill_value=0)
    sec_freq   = df_sec["Sector"].value_counts()
    top_secs   = sec_freq.head(12).index.tolist()
    sec_pivot  = sec_pivot.reindex(columns=top_secs, fill_value=0)
    sec_colors = {s: SECTOR_PALETTE[i % len(SECTOR_PALETTE)] for i, s in enumerate(top_secs)}

    fig, axes = plt.subplots(2, 1, figsize=(14, 10),
                              gridspec_kw={"height_ratios": [2, 1]})
    fig.patch.set_facecolor(BG)
    axes[0].set_title("MultiFactor LargeMidcap 250 — Sector Exposure Over Time",
                       color=WHITE, fontsize=13, fontweight="bold", loc="left", pad=12)

    ax     = axes[0]
    bottom = np.zeros(len(sec_pivot))
    for sec in top_secs:
        vals_s = sec_pivot[sec].values
        ax.fill_between(sec_pivot.index, bottom, bottom + vals_s,
                        label=sec.replace(" / ", "/"), alpha=0.88, color=sec_colors[sec], zorder=2)
        bottom += vals_s
    ax.set_ylim(0, TOP_N + 2)
    ax.axhline(TOP_N, color=GRAY, lw=0.7, ls="--")
    leg = ax.legend(loc="upper right", fontsize=8, framealpha=0.3, ncol=2,
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
    style_ax(ax, "Average Sector Weight Across All Months", "% of All Portfolio Slots", "")

    fig.tight_layout(pad=2.0)
    _save(fig, "sector_exposure.png")

# ─────────────────────────────────────────────────────────────────────────────
# CHART 6 — Return Distribution & Risk
# ─────────────────────────────────────────────────────────────────────────────
fig = plt.figure(figsize=(16, 10))
fig.patch.set_facecolor(BG)
fig.suptitle("MultiFactor LargeMidcap 250 — Return Distribution & Risk Analysis",
             color=WHITE, fontsize=13, fontweight="bold", y=1.01)
gs = GridSpec(2, 3, figure=fig, hspace=0.45, wspace=0.35)

ax = fig.add_subplot(gs[0, :2])
bins = np.linspace(min(port_rets.min(), bench_rets.min()) - 1,
                   max(port_rets.max(), bench_rets.max()) + 1, 36)
ax.hist(port_rets,  bins=bins, color=STRATEGY_COLOR, alpha=0.65,
        label="MultiFactor LargeMidcap 250", edgecolor=BG, zorder=3)
ax.hist(bench_rets, bins=bins, color=BNH_COLOR, alpha=0.45,
        label="EW Benchmark", edgecolor=BG, zorder=2)
for rets, color in [(port_rets, STRATEGY_COLOR), (bench_rets, BNH_COLOR)]:
    mu, sig = rets.mean(), rets.std()
    x = np.linspace(rets.min(), rets.max(), 200)
    y = sp_norm.pdf(x, mu, sig) * len(rets) * (bins[1] - bins[0])
    ax.plot(x, y, color=color, lw=1.5, ls="--")
ax.axvline(var_95, color=RED, lw=1.5, ls="--", label=f"VaR 95%: {var_95:.1f}%")
ax.axvline(0, color=GRAY, lw=0.8)
legend(ax)
style_ax(ax, "Monthly Return Distribution", "Monthly return (%)", "Frequency")

ax = fig.add_subplot(gs[0, 2])
bins_ex = np.linspace(excess_rets.min() - 0.5, excess_rets.max() + 0.5, 25)
mid     = (bins_ex[:-1] + bins_ex[1:]) / 2
counts, _ = np.histogram(excess_rets, bins=bins_ex)
for cnt, m, l, r in zip(counts, mid, bins_ex[:-1], bins_ex[1:]):
    ax.bar((l+r)/2, cnt, width=(r-l)*0.9,
           color=GREEN if m >= 0 else RED, alpha=0.85, edgecolor=BG, zorder=3)
ax.axvline(0, color=GRAY, lw=0.8, ls="--")
ax.axvline(excess_rets.mean(), color=GOLD, lw=1.5, ls="--",
           label=f"Mean: {excess_rets.mean():+.2f}%")
legend(ax)
style_ax(ax, "Excess Return vs Benchmark", "Excess return (%)", "Frequency")

ax = fig.add_subplot(gs[1, 0])
sc_colors = [GREEN if p > b else RED for p, b in zip(port_rets, bench_rets)]
ax.scatter(bench_rets, port_rets, c=sc_colors, alpha=0.75, s=40, zorder=3)
lim = max(abs(bench_rets).max(), abs(port_rets).max()) + 2
ax.plot([-lim, lim], [-lim, lim], color=GRAY, lw=1, ls="--", label="No alpha line")
m_reg, b_reg = np.polyfit(bench_rets, port_rets, 1)
xr = np.array([-lim, lim])
ax.plot(xr, m_reg*xr + b_reg, color=GOLD, lw=1.5,
        label=f"β={m_reg:.2f}  α={b_reg:.2f}%/mo")
ax.set_xlim(-lim, lim); ax.set_ylim(-lim, lim)
legend(ax)
style_ax(ax, "Portfolio vs Benchmark", "Benchmark return %", "Portfolio return %")

ax = fig.add_subplot(gs[1, 1])
ax.set_facecolor(CARD2); ax.axis("off")
p_skew = float(port_rets.skew())
b_skew = float(bench_rets.skew())
up_mask = bench_rets > 0; dn_mask = bench_rets < 0
up_cap  = (port_rets[up_mask].mean() / bench_rets[up_mask].mean()
           if bench_rets[up_mask].mean() != 0 else 0)
dn_cap  = (port_rets[dn_mask].mean() / bench_rets[dn_mask].mean()
           if bench_rets[dn_mask].mean() != 0 else 0)
table_rows = [
    ("Metric",          "Strategy",                               "Benchmark"),
    ("Mean monthly",    f"{port_rets.mean():+.2f}%",             f"{bench_rets.mean():+.2f}%"),
    ("Ann. volatility", f"{port_rets.std()*np.sqrt(12):.1f}%",  f"{bench_rets.std()*np.sqrt(12):.1f}%"),
    ("Skewness",        f"{p_skew:.2f}",                         f"{b_skew:.2f}"),
    ("VaR 95%",         f"{var_95:.1f}%",                        "—"),
    ("CVaR 95%",        f"{cvar_95:.1f}%",                       "—"),
    ("Best month",      f"{port_rets.max():+.1f}%",              f"{bench_rets.max():+.1f}%"),
    ("Worst month",     f"{port_rets.min():+.1f}%",              f"{bench_rets.min():+.1f}%"),
    ("Up capture",      f"{up_cap:.2f}×",                        "1.00×"),
    ("Down capture",    f"{dn_cap:.2f}×",                        "1.00×"),
]
row_h_t = 0.082
for ri, row in enumerate(table_rows):
    row_bg2 = CARD2 if ri % 2 == 0 else CARD
    ax.add_patch(mpatches.FancyBboxPatch(
        (0, 1 - (ri+1)*row_h_t - 0.01), 1, row_h_t*0.95,
        transform=ax.transAxes, boxstyle="square,pad=0",
        facecolor=row_bg2, edgecolor="none", zorder=0))
    for ci, cell in enumerate(row):
        ax.text(ci * 0.36 + 0.02, 1 - ri * row_h_t - 0.02, cell,
                transform=ax.transAxes, va="top",
                color=WHITE if ri == 0 else (LGRAY if ci == 0 else WHITE),
                fontweight="bold" if ri == 0 else "normal", fontsize=8)
ax.set_title("Risk Statistics", color=WHITE, fontsize=10, fontweight="bold", loc="left", pad=8)

ax = fig.add_subplot(gs[1, 2])
dd_u = (results["Port_Equity"] - results["Port_Equity"].cummax()) / results["Port_Equity"].cummax() * 100
ax.fill_between(results.index, dd_u, 0, color=RED, alpha=0.40)
ax.plot(results.index, dd_u, color=RED, lw=1.2)
min_idx = dd_u.idxmin()
ax.annotate(f"Max DD: {dd_u.min():.1f}%", xy=(min_idx, dd_u.min()),
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

    summary.png              — performance scorecard
    equity_curve.png         — growth, excess returns, drawdown
    rolling_metrics.png      — rolling CAGR, Sharpe, win rate + vol
    monthly_heatmap.png      — green/red calendar heatmap
    sector_exposure.png      — stacked sector allocation over time
    return_distribution.png  — histogram, scatter, risk table, underwater
    results.csv              — monthly returns data
""")
