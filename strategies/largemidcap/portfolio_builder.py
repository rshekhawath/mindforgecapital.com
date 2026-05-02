"""
MultiFactor LargeMidcap 250 — Portfolio Builder
================================================
Universe  : Nifty LargeMidcap 250 (250 stocks)
            Loaded from universe.xlsx  →  sheet "Master Universe"
            Columns used:
              A  Symbol                 — NSE symbol
              B  Yahoo Finance Ticker   — e.g. INFY.NS
              C  Industry               — NSE official classification
              D  Company Name           — full name from NSE

Portfolio : Top 25 stocks, max 3 per sector, equal-weight

Factor Model  (empirically optimised for Indian Large & Midcap)
------------
  Momentum          45%  =  (12-1m return + 6m return) / 2
  Trend Strength    45%  =  price/SMA200 + annualised linreg slope (63-day)
  Low Volatility    05%  =  −252-day realised volatility
  52-Week High      03%  =  price / 52-week high
  Amihud Liquidity  02%  =  −Amihud illiquidity (60-day avg |ret|/₹turnover)

Run order
---------
  1. python universe_builder.py   →  regenerates universe.xlsx
  2. python portfolio_builder.py  →  today's portfolio (this script)
  3. python backtest.py           →  full historical backtest
"""

import os, sys, warnings
import numpy as np
import pandas as pd
import yfinance as yf
from datetime import datetime, timedelta

# ── Shared modules ────────────────────────────────────────────────────────────
ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, ROOT_DIR)

from shared.config import LARGEMIDCAP, RISK_FREE
from shared.backtest_engine import safe_zscore, extract_field

warnings.filterwarnings("ignore")

# ─────────────────────────────────────────────────────────────────────────────
# CONFIG
# ─────────────────────────────────────────────────────────────────────────────
BASE_DIR       = os.path.dirname(os.path.abspath(__file__))
UNIVERSE_PATH  = os.path.join(BASE_DIR, "universe.xlsx")
OUTPUTS_DIR    = os.path.join(BASE_DIR, "outputs")
os.makedirs(OUTPUTS_DIR, exist_ok=True)

UNIVERSE_SHEET = LARGEMIDCAP["UNIVERSE_SHEET"]
TOP_N          = LARGEMIDCAP["TOP_N"]
MAX_PER_SECTOR = LARGEMIDCAP["MAX_PER_SECTOR"]
W_MOMENTUM     = LARGEMIDCAP["W_MOMENTUM"]
W_TREND        = LARGEMIDCAP["W_TREND"]
W_LOWVOL       = LARGEMIDCAP["W_LOWVOL"]
W_HIGH52       = LARGEMIDCAP["W_HIGH52"]
W_AMIHUD       = LARGEMIDCAP["W_AMIHUD"]

# ─────────────────────────────────────────────────────────────────────────────
# STEP 1 · LOAD UNIVERSE
# ─────────────────────────────────────────────────────────────────────────────
print("=" * 65)
print("STEP 1 · Loading stock universe from universe.xlsx")
print("=" * 65)

if not os.path.exists(UNIVERSE_PATH):
    raise FileNotFoundError(
        f"Universe file not found:\n  {UNIVERSE_PATH}\n\n"
        "Run universe_builder.py first to generate universe.xlsx"
    )

df_universe = pd.read_excel(UNIVERSE_PATH, sheet_name=UNIVERSE_SHEET)
df_universe.columns = df_universe.columns.str.strip()

required_cols = ["Symbol", "Yahoo Finance Ticker", "Industry", "Company Name"]
missing_cols  = [c for c in required_cols if c not in df_universe.columns]
if missing_cols:
    raise ValueError(
        f"universe.xlsx is missing columns: {missing_cols}\n"
        f"Found: {list(df_universe.columns)}"
    )

dummy_mask  = df_universe["Symbol"].str.upper().str.startswith("DUMMY")
if dummy_mask.any():
    removed     = df_universe.loc[dummy_mask, "Yahoo Finance Ticker"].tolist()
    df_universe = df_universe[~dummy_mask].reset_index(drop=True)
    print(f"  Removed {len(removed)} NSE dummy placeholder(s): {removed}")

all_tickers = df_universe["Yahoo Finance Ticker"].dropna().str.strip().tolist()
sector_map  = dict(zip(df_universe["Yahoo Finance Ticker"], df_universe["Industry"]))
company_map = dict(zip(df_universe["Yahoo Finance Ticker"], df_universe["Company Name"]))

print(f"Universe loaded : {len(all_tickers)} tickers")
print(f"Industries      : {df_universe['Industry'].nunique()} — "
      f"{', '.join(sorted(df_universe['Industry'].dropna().unique()))}")

# ─────────────────────────────────────────────────────────────────────────────
# STEP 2 · DOWNLOAD OHLCV HISTORY
# ─────────────────────────────────────────────────────────────────────────────
print("\n" + "=" * 65)
print("STEP 2 · Downloading OHLCV history (Yahoo Finance)")
print("=" * 65)

end_date   = datetime.today()
start_date = end_date - timedelta(days=420)   # ~14 months for 252-day signals

raw = yf.download(all_tickers, start=start_date, end=end_date,
                  auto_adjust=True, progress=True)

prices  = extract_field(raw, "Close").ffill()
volumes = extract_field(raw, "Volume").fillna(0)

prices  = prices.dropna(axis=1, how="all").dropna(axis=1, thresh=252)
valid   = prices.columns.tolist()
volumes = volumes.reindex(columns=valid).fillna(0)

print(f"\n✓ Price data for {len(valid)}/{len(all_tickers)} tickers")
skipped = [t for t in all_tickers if t not in valid]
if skipped:
    print(f"  {len(skipped)} tickers skipped (insufficient history or no YF data):")
    for t in skipped:
        print(f"    {t}  [{company_map.get(t, '')}]")

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
    if n < 252:
        continue
    rec = {}

    # 1. Momentum: (12m-1m + 6m) / 2
    r12 = (p.iloc[-1] / p.iloc[-252]) - 1
    r6  = (p.iloc[-1] / p.iloc[-126]) - 1
    r1  = (p.iloc[-1] / p.iloc[-21])  - 1
    rec["Momentum"] = ((r12 - r1) + r6) / 2

    # 2. Trend Strength: SMA200 ratio + annualised linreg slope
    sma200       = p.iloc[-200:].mean()
    sma_ratio    = (p.iloc[-1] / sma200) - 1
    log_p        = np.log(p.iloc[-63:].values)
    x            = np.arange(len(log_p))
    slope, _     = np.polyfit(x, log_p, 1)
    rec["Trend"] = sma_ratio + (slope * 252)

    # 3. Low Volatility: −252-day realised vol
    daily_rets     = p.pct_change().iloc[-252:]
    rec["LowVol"]  = -(daily_rets.std() * np.sqrt(252))

    # 4. 52-Week High Proximity
    rec["High52"]  = p.iloc[-1] / p.iloc[-252:].max()

    # 5. Amihud Illiquidity (inverted → liquidity score)
    if len(v) >= 60 and v.iloc[-60:].sum() > 0:
        common_idx   = daily_rets.index.intersection(v.index)
        ret_60       = daily_rets.reindex(common_idx).iloc[-60:]
        vol_60       = v.reindex(common_idx).iloc[-60:]
        price_60     = p.reindex(common_idx).iloc[-60:]
        turnover     = (vol_60 * price_60).replace(0, np.nan)
        amihud       = (ret_60.abs() / turnover).mean()
        rec["Amihud"] = -amihud
    else:
        rec["Amihud"] = np.nan

    factor_data[t] = rec

factors = pd.DataFrame(factor_data).T
factors.index.name = "Ticker"

print(f"✓ Factors computed for {len(factors)} tickers")
print("\nFactor coverage:")
for col in ["Momentum", "Trend", "LowVol", "High52", "Amihud"]:
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
scores["Z_LowVol"]   = safe_zscore(factors["LowVol"])
scores["Z_High52"]   = safe_zscore(factors["High52"])
scores["Z_Amihud"]   = safe_zscore(factors["Amihud"])

scores["Final"] = (
    W_MOMENTUM * scores["Z_Momentum"] +
    W_TREND    * scores["Z_Trend"]    +
    W_LOWVOL   * scores["Z_LowVol"]   +
    W_HIGH52   * scores["Z_High52"]   +
    W_AMIHUD   * scores["Z_Amihud"]
)

scores["Industry"]     = [sector_map.get(t, f"_unk_{t}") for t in scores.index]
scores["Company Name"] = [company_map.get(t, "") for t in scores.index]
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
    """Replace internal _unk_ sector keys with 'Unknown' before saving."""
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

disp_cols = ["Company Name", "Z_Momentum", "Z_Trend", "Z_LowVol",
             "Z_High52", "Z_Amihud", "Final", "Industry", "Weight %"]
print(portfolio_save[[c for c in disp_cols if c in portfolio_save.columns]]
      .round(3).to_string())

print(f"""
Factor Weights Applied
  Momentum          {W_MOMENTUM*100:.0f}%   (12-1m + 6m price return)
  Trend Strength    {W_TREND*100:.0f}%   (SMA200 ratio + linreg slope)
  Low Volatility    {W_LOWVOL*100:.0f}%    (−252-day realised vol)
  52-Week High      {W_HIGH52*100:.0f}%    (price / 52-week high)
  Amihud Liquidity  {W_AMIHUD*100:.0f}%    (−avg |ret| / ₹turnover)
""")

print("Industry distribution:")
print(portfolio_save["Industry"].value_counts().to_string())
