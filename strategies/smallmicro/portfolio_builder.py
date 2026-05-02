"""
MultiFactor SmallMicro 500 — Portfolio Builder
===============================================
Universe  : Nifty SmallCap 250 + Nifty MicroCap 250 (500 stocks)
            Loaded from universe.xlsx  →  sheet "Master Universe"
            Columns used:
              A  Symbol                 — NSE symbol
              B  Yahoo Finance Ticker   — e.g. INFY.NS
              C  Industry               — NSE official sector (22 categories)
              D  Index                  — Smallcap 250 / Microcap 250
              E  In Your File?          — Yes / NO – MISSING (all 500 used)
              F  Company Name           — full name

Portfolio : Top 50 stocks, max 3 per sector, equal-weight

Factor Model  (tuned for Indian Small & Microcap)
-------------------------------------------------
Why these factors differ from LargeMidcap:

  1. THIN LIQUIDITY — Volume Breakout confirms price strength comes with
     rising participation, filtering out illiquid spikes that reverse.

  2. HARDER MOMENTUM CRASHES — Trend Strength acts as a circuit breaker,
     reducing weight on momentum built on a fragile base.

  3. STRONG ANCHORING — Retail dominance makes 52-Week High proximity
     more predictive here than in largecap.

  4. RELATIVE VOLATILITY as regime filter — very low absolute vol in
     small/micro often means a frozen stock. Short/long-term vol ratio
     used instead: falling ratio (calming after run-up) is bullish.

  Momentum          30%  =  (12-1m return + 6m return) / 2
  Trend Strength    25%  =  price/SMA200 + annualised linreg slope (63-day)
  Volume Breakout   20%  =  20-day avg volume / 60-day avg volume
  52-Week High      15%  =  price / 52-week high
  Rel. Volatility   10%  =  −(21-day vol / 252-day vol)

Run order
---------
  1. python portfolio_builder.py  →  today's portfolio (this script)
  2. python backtest.py           →  full historical backtest
"""

import os, sys, warnings
import numpy as np
import pandas as pd
import yfinance as yf
from datetime import datetime, timedelta

# ── Shared modules ────────────────────────────────────────────────────────────
ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, ROOT_DIR)

from shared.config import SMALLMICRO
from shared.backtest_engine import safe_zscore, extract_field

warnings.filterwarnings("ignore")

# ─────────────────────────────────────────────────────────────────────────────
# CONFIG
# ─────────────────────────────────────────────────────────────────────────────
BASE_DIR       = os.path.dirname(os.path.abspath(__file__))
UNIVERSE_PATH  = os.path.join(BASE_DIR, "universe.xlsx")
OUTPUTS_DIR    = os.path.join(BASE_DIR, "outputs")
os.makedirs(OUTPUTS_DIR, exist_ok=True)

UNIVERSE_SHEET = SMALLMICRO["UNIVERSE_SHEET"]
TOP_N          = SMALLMICRO["TOP_N"]
MAX_PER_SECTOR = SMALLMICRO["MAX_PER_SECTOR"]
W_MOMENTUM     = SMALLMICRO["W_MOMENTUM"]
W_TREND        = SMALLMICRO["W_TREND"]
W_VOLUME       = SMALLMICRO["W_VOLUME"]
W_HIGH52       = SMALLMICRO["W_HIGH52"]
W_RELVOL       = SMALLMICRO["W_RELVOL"]

# ─────────────────────────────────────────────────────────────────────────────
# STEP 1 · LOAD UNIVERSE
# ─────────────────────────────────────────────────────────────────────────────
print("=" * 65)
print("STEP 1 · Loading stock universe from universe.xlsx")
print("=" * 65)

if not os.path.exists(UNIVERSE_PATH):
    raise FileNotFoundError(
        f"Universe file not found:\n  {UNIVERSE_PATH}\n\n"
        "Ensure universe.xlsx exists in the smallmicro/ strategy folder."
    )

df_universe = pd.read_excel(UNIVERSE_PATH, sheet_name=UNIVERSE_SHEET)
df_universe.columns = df_universe.columns.str.strip()

required_cols = ["Symbol", "Yahoo Finance Ticker", "Industry", "Index", "Company Name"]
missing_cols  = [c for c in required_cols if c not in df_universe.columns]
if missing_cols:
    raise ValueError(
        f"universe.xlsx is missing columns: {missing_cols}\n"
        f"Found: {list(df_universe.columns)}"
    )

dummy_mask   = df_universe["Symbol"].str.upper().str.startswith("DUMMY")
dummy_rows   = df_universe[dummy_mask]
df_universe  = df_universe[~dummy_mask].reset_index(drop=True)
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
print(f"Industries      : {df_universe['Industry'].nunique()} — "
      f"{', '.join(sorted(df_universe['Industry'].dropna().unique()))}")
print(f"Index split     : "
      f"{(df_universe['Index'] == 'Smallcap 250').sum()} Smallcap 250  |  "
      f"{(df_universe['Index'] == 'Microcap 250').sum()} Microcap 250")

# ─────────────────────────────────────────────────────────────────────────────
# STEP 2 · DOWNLOAD OHLCV HISTORY
# ─────────────────────────────────────────────────────────────────────────────
print("\n" + "=" * 65)
print("STEP 2 · Downloading OHLCV history (Yahoo Finance)")
print("=" * 65)

raw = yf.download(all_tickers, period="2y", auto_adjust=True, progress=True)

prices  = extract_field(raw, "Close").ffill()
volumes = extract_field(raw, "Volume").fillna(0)

prices  = prices.dropna(axis=1, how="all").dropna(axis=1, thresh=120)
valid   = prices.columns.tolist()
volumes = volumes.reindex(columns=valid).fillna(0)

print(f"\n✓ Price data for {len(valid)}/{len(all_tickers)} tickers")
missing_tickers = [t for t in all_tickers if t not in valid]
if missing_tickers:
    print(f"  {len(missing_tickers)} tickers skipped (recently listed, delisted, or no YF data):")
    for t in missing_tickers:
        print(f"    {t}  [{company_map.get(t, '')}]  [{index_map.get(t, '')}]")

# ─────────────────────────────────────────────────────────────────────────────
# STEP 3 · COMPUTE ALL 5 FACTORS
# ─────────────────────────────────────────────────────────────────────────────
print("\n" + "=" * 65)
print("STEP 3 · Computing factor scores")
print("=" * 65)

factor_data = {}

for t in valid:
    p = prices[t].dropna()
    v = volumes[t] if t in volumes.columns else pd.Series(dtype=float)
    n = len(p)
    if n < 63:
        continue
    rec = {}

    # 1. Momentum: (12m-1m + 6m) / 2
    r12 = (p.iloc[-1] / p.iloc[-min(252, n)]) - 1
    r6  = (p.iloc[-1] / p.iloc[-min(126, n)]) - 1
    r1  = (p.iloc[-1] / p.iloc[-min(21,  n)]) - 1
    rec["Momentum"] = ((r12 - r1) + r6) / 2

    # 2. Trend Strength: SMA200 ratio + annualised linreg slope
    sma_n        = min(200, n)
    sma          = p.iloc[-sma_n:].mean()
    sma_ratio    = (p.iloc[-1] / sma) - 1
    log_p        = np.log(p.iloc[-min(63, n):].values)
    x            = np.arange(len(log_p))
    slope, _     = np.polyfit(x, log_p, 1)
    rec["Trend"] = sma_ratio + (slope * 252)

    # 3. Volume Breakout: 20-day avg vol / 60-day avg vol
    if len(v) >= 60 and v.iloc[-60:].sum() > 0:
        avg_20         = v.iloc[-20:].mean()
        avg_60         = v.iloc[-60:].mean()
        rec["VolBreak"] = avg_20 / avg_60 if avg_60 > 0 else np.nan
    else:
        rec["VolBreak"] = np.nan

    # 4. 52-Week High Proximity
    high_n        = min(252, n)
    rec["High52"] = p.iloc[-1] / p.iloc[-high_n:].max()

    # 5. Relative Volatility: −(21-day σ / 252-day σ)
    rets = p.pct_change().dropna()
    if len(rets) >= 63:
        vol_21        = rets.iloc[-21:].std()  * np.sqrt(252)
        vol_252       = rets.iloc[-min(252, len(rets)):].std() * np.sqrt(252)
        rec["RelVol"] = -(vol_21 / vol_252) if vol_252 > 0 else np.nan
    else:
        rec["RelVol"] = np.nan

    factor_data[t] = rec

factors = pd.DataFrame(factor_data).T
factors.index.name = "Ticker"

print(f"✓ Factors computed for {len(factors)} tickers")
print("\nFactor coverage:")
for col in ["Momentum", "Trend", "VolBreak", "High52", "RelVol"]:
    n = factors[col].notna().sum()
    print(f"  {col:<12} {n}/{len(factors)}")

# ─────────────────────────────────────────────────────────────────────────────
# STEP 4 · COMPOSITE SCORE
# ─────────────────────────────────────────────────────────────────────────────
print("\n" + "=" * 65)
print("STEP 4 · Building composite score")
print("=" * 65)

scores = pd.DataFrame(index=factors.index)
scores["Z_Momentum"] = safe_zscore(factors["Momentum"])
scores["Z_Trend"]    = safe_zscore(factors["Trend"])
scores["Z_VolBreak"] = safe_zscore(factors["VolBreak"])
scores["Z_High52"]   = safe_zscore(factors["High52"])
scores["Z_RelVol"]   = safe_zscore(factors["RelVol"])

scores["Final"] = (
    W_MOMENTUM * scores["Z_Momentum"] +
    W_TREND    * scores["Z_Trend"]    +
    W_VOLUME   * scores["Z_VolBreak"] +
    W_HIGH52   * scores["Z_High52"]   +
    W_RELVOL   * scores["Z_RelVol"]
)

scores["Industry"]     = [sector_map.get(t, f"_unk_{t}") for t in scores.index]
scores["Company Name"] = [company_map.get(t, "") for t in scores.index]
scores["Index"]        = [index_map.get(t, "") for t in scores.index]
for col in factors.columns:
    scores[col] = factors[col]

scores = scores.sort_values("Final", ascending=False)

# ─────────────────────────────────────────────────────────────────────────────
# STEP 5 · SECTOR-CAPPED PORTFOLIO
# ─────────────────────────────────────────────────────────────────────────────
print("\n" + "=" * 65)
print(f"STEP 5 · Building portfolio (Top {TOP_N}, max {MAX_PER_SECTOR}/industry)")
print("=" * 65)

portfolio = (
    scores
    .groupby("Industry", group_keys=False)
    .apply(lambda g: g.head(MAX_PER_SECTOR))
    .sort_values("Final", ascending=False)
    .head(TOP_N)
)
portfolio["Weight %"] = round(100 / len(portfolio), 2)

# ─────────────────────────────────────────────────────────────────────────────
# STEP 6 · SAVE & DISPLAY
# ─────────────────────────────────────────────────────────────────────────────
def clean_unk(df):
    out = df.copy()
    out["Industry"] = out["Industry"].str.replace(r"^_unk_.*", "Unknown", regex=True)
    return out

portfolio_save = clean_unk(portfolio)
scores_save    = clean_unk(scores)

portfolio_path = os.path.join(OUTPUTS_DIR, "portfolio.csv")
scores_path    = os.path.join(OUTPUTS_DIR, "all_scores.csv")

portfolio_save.to_csv(portfolio_path)
scores_save.to_csv(scores_path)

print(f"\n✓ Portfolio   → {portfolio_path}")
print(f"✓ Full scores → {scores_path}")

print("\n" + "=" * 65)
print(f"  TOP {len(portfolio)} PORTFOLIO  (max {MAX_PER_SECTOR}/industry)")
print("=" * 65)

disp_cols = ["Company Name", "Index", "Z_Momentum", "Z_Trend", "Z_VolBreak",
             "Z_High52", "Z_RelVol", "Final", "Industry", "Weight %"]
print(portfolio_save[[c for c in disp_cols if c in portfolio_save.columns]]
      .round(3).to_string())

print(f"""
Factor Weights Applied
  Momentum          {W_MOMENTUM*100:.0f}%   (12-1m + 6m price return)
  Trend Strength    {W_TREND*100:.0f}%   (SMA200 ratio + linreg slope)
  Volume Breakout   {W_VOLUME*100:.0f}%   (20d avg vol / 60d avg vol)
  52-Week High      {W_HIGH52*100:.0f}%   (price / 52-week high)
  Rel. Volatility   {W_RELVOL*100:.0f}%   (−21d vol / 252d vol)
""")

print("Industry distribution:")
print(portfolio_save["Industry"].value_counts().to_string())

print("\nIndex distribution:")
print(portfolio_save["Index"].value_counts().to_string())
