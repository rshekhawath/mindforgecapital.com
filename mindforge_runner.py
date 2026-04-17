#!/usr/bin/env python3
"""
================================================================================
  MindForge Capital — Strategy Runner
================================================================================

Runs daily at 9am, 12pm, 3pm IST on weekdays.
Applies multi-factor model to stock universes.
Saves results to Google Sheets via Apps Script.

Usage:
  python3 mindforge_runner.py

Setup:
  1. Replace APPS_SCRIPT_URL with your deployed Apps Script URL
  2. Replace universe_path in STRATEGIES config
  3. Install dependencies: pip install pandas openpyxl yfinance requests numpy scipy
  4. Set up cron job for 9:00, 12:00, 15:00 IST weekdays

Cron examples:
  0 9 * * 1-5 python3 /path/to/mindforge_runner.py  (9:00 AM)
  0 12 * * 1-5 python3 /path/to/mindforge_runner.py  (12:00 PM)
  0 15 * * 1-5 python3 /path/to/mindforge_runner.py  (3:00 PM)

================================================================================
"""

import os
import warnings
import numpy as np
import pandas as pd
import yfinance as yf
import requests
import json
from scipy.stats import zscore
from datetime import datetime, timedelta

warnings.filterwarnings("ignore")

# ─────────────────────────────────────────────────────────────────────────────
# CONFIG
# ─────────────────────────────────────────────────────────────────────────────

APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxOAkgF6naSDlx8q4mt1n3vJvd1gywpYT_iiYvt94ddYeqaniNI4ggM7idJTJHhA6RH8w/exec'  # Replace with deployed Apps Script URL

STRATEGIES = {
    "LargeMidcap": {
        "universe_path": "/Users/rshekhawath/Desktop/SmallCases/MultiFactor LargeMidcap 250/LargeMid_Universe_Master.xlsx",
        "top_n": 25,
        "max_per_sector": 3,
    },
    "SmallMicro": {
        "universe_path": "/Users/rshekhawath/Desktop/SmallCases/MultiFactor SmallMicro 500/Stock_Universe_SmallMicro_Master_Universe.xlsx",
        "top_n": 30,
        "max_per_sector": 4,
    }
}

MULTIASSET_ASSETS = {
    "Nifty 50 ETF": "NIFTYBEES.NS",
    "Nifty Next 50 ETF": "JUNIORBEES.NS",
    "Nifty Midcap 150 ETF": "MID150BEES.NS",
    "Gold ETF": "GOLDCASE.NS",
    "Bharat Bond ETF": "EBBETF0431.NS",
    "NASDAQ ETF": "MON100.NS",
}

# Factor weights (from LargeMidcap source_code.py)
W_MOMENTUM = 0.45
W_TREND = 0.45
W_LOWVOL = 0.05
W_HIGH52 = 0.03
W_AMIHUD = 0.02

# ─────────────────────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def safe_zscore(series: pd.Series) -> pd.Series:
    """Z-score normalization with NaN handling."""
    s = pd.to_numeric(series, errors="coerce").replace([np.inf, -np.inf], np.nan)
    if s.isna().all():
        return pd.Series(0.0, index=s.index)
    s = s.fillna(s.median())
    if s.std() == 0 or pd.isna(s.std()):
        return pd.Series(0.0, index=s.index)
    return pd.Series(zscore(s.values, nan_policy="omit"), index=s.index)


def load_universe(universe_path: str) -> pd.DataFrame:
    """Load stock universe from Excel."""
    if not os.path.exists(universe_path):
        raise FileNotFoundError(f"Universe file not found: {universe_path}")

    df = pd.read_excel(universe_path, sheet_name="Master Universe")
    df.columns = df.columns.str.strip()

    required_cols = ["Symbol", "Yahoo Finance Ticker", "Industry", "Company Name"]
    missing_cols = [c for c in required_cols if c not in df.columns]
    if missing_cols:
        raise ValueError(f"Missing columns: {missing_cols}")

    # Remove dummy rows
    dummy_mask = df["Symbol"].str.upper().str.startswith("DUMMY")
    if dummy_mask.any():
        df = df[~dummy_mask].reset_index(drop=True)

    return df


def download_ohlcv(tickers: list, lookback_days: int = 420) -> tuple:
    """Download OHLCV data from Yahoo Finance."""
    end_date = datetime.today()
    start_date = end_date - timedelta(days=lookback_days)

    raw = yf.download(tickers, start=start_date, end=end_date, auto_adjust=True, progress=False)

    # Extract price and volume
    def extract_field(raw_df, field):
        if isinstance(raw_df.columns, pd.MultiIndex):
            lvl0 = raw_df.columns.get_level_values(0).unique().tolist()
            if field in lvl0:
                return raw_df.xs(field, level=0, axis=1)
        return raw_df if field == "Close" else pd.DataFrame(index=raw_df.index)

    prices = extract_field(raw, "Close").ffill()
    volumes = extract_field(raw, "Volume").fillna(0)

    # Filter tickers with sufficient history
    prices = prices.dropna(axis=1, how="all").dropna(axis=1, thresh=252)
    valid = prices.columns.tolist()
    volumes = volumes.reindex(columns=valid).fillna(0)

    return prices, volumes, valid


def compute_factors(prices: pd.DataFrame, volumes: pd.DataFrame) -> pd.DataFrame:
    """Compute all 5 factor scores."""
    factor_data = {}

    for ticker in prices.columns:
        p = prices[ticker].dropna()
        v = volumes[ticker] if ticker in volumes.columns else pd.Series(dtype=float)
        n = len(p)

        if n < 252:
            continue

        rec = {}

        # 1. Momentum: (12m-1m + 6m) / 2
        r12 = (p.iloc[-1] / p.iloc[-252]) - 1
        r6 = (p.iloc[-1] / p.iloc[-126]) - 1
        r1 = (p.iloc[-1] / p.iloc[-21]) - 1
        rec["Momentum"] = ((r12 - r1) + r6) / 2

        # 2. Trend Strength: SMA200 ratio + annualised linreg slope
        sma200 = p.iloc[-200:].mean()
        sma_ratio = (p.iloc[-1] / sma200) - 1
        log_p = np.log(p.iloc[-63:].values)
        x = np.arange(len(log_p))
        slope, _ = np.polyfit(x, log_p, 1)
        rec["Trend"] = sma_ratio + (slope * 252)

        # 3. Low Volatility: −252-day realised vol
        daily_rets = p.pct_change().iloc[-252:]
        rec["LowVol"] = -(daily_rets.std() * np.sqrt(252))

        # 4. 52-Week High Proximity
        rec["High52"] = p.iloc[-1] / p.iloc[-252:].max()

        # 5. Amihud Illiquidity (inverted)
        if len(v) >= 60 and v.iloc[-60:].sum() > 0:
            common_idx = daily_rets.index.intersection(v.index)
            ret_60 = daily_rets.reindex(common_idx).iloc[-60:]
            vol_60 = v.reindex(common_idx).iloc[-60:]
            price_60 = p.reindex(common_idx).iloc[-60:]
            turnover = (vol_60 * price_60).replace(0, np.nan)
            amihud = (ret_60.abs() / turnover).mean()
            rec["Amihud"] = -amihud
        else:
            rec["Amihud"] = np.nan

        factor_data[ticker] = rec

    return pd.DataFrame(factor_data).T


def build_composite_score(factors: pd.DataFrame) -> pd.DataFrame:
    """Build composite factor score."""
    scores = pd.DataFrame(index=factors.index)

    scores["Z_Momentum"] = safe_zscore(factors["Momentum"])
    scores["Z_Trend"] = safe_zscore(factors["Trend"])
    scores["Z_LowVol"] = safe_zscore(factors["LowVol"])
    scores["Z_High52"] = safe_zscore(factors["High52"])
    scores["Z_Amihud"] = safe_zscore(factors["Amihud"])

    scores["Final"] = (
        W_MOMENTUM * scores["Z_Momentum"]
        + W_TREND * scores["Z_Trend"]
        + W_LOWVOL * scores["Z_LowVol"]
        + W_HIGH52 * scores["Z_High52"]
        + W_AMIHUD * scores["Z_Amihud"]
    )

    return scores.sort_values("Final", ascending=False)


def build_sector_capped_portfolio(
    scores: pd.DataFrame,
    sector_map: dict,
    company_map: dict,
    top_n: int = 25,
    max_per_sector: int = 3,
) -> pd.DataFrame:
    """Build sector-capped portfolio."""
    scores["Industry"] = [sector_map.get(t, f"_unk_{t}") for t in scores.index]
    scores["Company Name"] = [company_map.get(t, "") for t in scores.index]

    portfolio = (
        scores.groupby("Industry", group_keys=False)
        .apply(lambda g: g.head(max_per_sector))
        .sort_values("Final", ascending=False)
        .head(top_n)
    )

    portfolio["Weight %"] = round(100 / len(portfolio), 2)
    return portfolio


def fetch_current_price(ticker: str) -> float:
    """Fetch current price from Yahoo Finance."""
    try:
        hist = yf.Ticker(ticker).history(period="1d")
        if len(hist) > 0:
            return float(hist["Close"].iloc[-1])
    except Exception as e:
        print(f"  Error fetching price for {ticker}: {e}")
    return 0.0


def run_largemidcap():
    """Run LargeMidcap strategy."""
    print("\n" + "=" * 65)
    print("LargeMidcap 250 Strategy")
    print("=" * 65)

    config = STRATEGIES["LargeMidcap"]
    df_universe = load_universe(config["universe_path"])

    all_tickers = df_universe["Yahoo Finance Ticker"].dropna().str.strip().tolist()
    sector_map = dict(zip(df_universe["Yahoo Finance Ticker"], df_universe["Industry"]))
    company_map = dict(zip(df_universe["Yahoo Finance Ticker"], df_universe["Company Name"]))

    print(f"Universe: {len(all_tickers)} tickers")

    # Download data
    prices, volumes, valid = download_ohlcv(all_tickers)
    print(f"Downloaded: {len(valid)}/{len(all_tickers)} tickers")

    # Compute factors
    factors = compute_factors(prices, volumes)
    scores = build_composite_score(factors)

    # Build portfolio
    portfolio = build_sector_capped_portfolio(
        scores.copy(),
        sector_map,
        company_map,
        top_n=config["top_n"],
        max_per_sector=config["max_per_sector"],
    )

    print(f"Portfolio: {len(portfolio)} stocks selected")
    print("\nTop 10 holdings:")
    for idx, (ticker, row) in enumerate(portfolio.head(10).iterrows(), 1):
        print(f"  {idx}. {ticker} ({row['Company Name']}) - Score: {row['Final']:.3f}")

    # Prepare stocks for saving
    stocks = []
    for ticker, row in portfolio.iterrows():
        current_price = fetch_current_price(ticker)
        stocks.append({
            "ticker": ticker,
            "yahoo_ticker": ticker,
            "company_name": row["Company Name"],
            "industry": row["Industry"],
            "recommended_price": current_price,
            "weight_pct": row["Weight %"],
        })

    # Save to Apps Script  (name must match subscription strategy field)
    save_run("MultiFactor LargeMidcap 250", stocks)
    return stocks


def run_smallmicro():
    """Run SmallMicro strategy."""
    print("\n" + "=" * 65)
    print("SmallMicro 500 Strategy")
    print("=" * 65)

    config = STRATEGIES["SmallMicro"]
    df_universe = load_universe(config["universe_path"])

    all_tickers = df_universe["Yahoo Finance Ticker"].dropna().str.strip().tolist()
    sector_map = dict(zip(df_universe["Yahoo Finance Ticker"], df_universe["Industry"]))
    company_map = dict(zip(df_universe["Yahoo Finance Ticker"], df_universe["Company Name"]))

    print(f"Universe: {len(all_tickers)} tickers")

    # Download data
    prices, volumes, valid = download_ohlcv(all_tickers)
    print(f"Downloaded: {len(valid)}/{len(all_tickers)} tickers")

    # Compute factors
    factors = compute_factors(prices, volumes)
    scores = build_composite_score(factors)

    # Build portfolio
    portfolio = build_sector_capped_portfolio(
        scores.copy(),
        sector_map,
        company_map,
        top_n=config["top_n"],
        max_per_sector=config["max_per_sector"],
    )

    print(f"Portfolio: {len(portfolio)} stocks selected")
    print("\nTop 10 holdings:")
    for idx, (ticker, row) in enumerate(portfolio.head(10).iterrows(), 1):
        print(f"  {idx}. {ticker} ({row['Company Name']}) - Score: {row['Final']:.3f}")

    # Prepare stocks for saving
    stocks = []
    for ticker, row in portfolio.iterrows():
        current_price = fetch_current_price(ticker)
        stocks.append({
            "ticker": ticker,
            "yahoo_ticker": ticker,
            "company_name": row["Company Name"],
            "industry": row["Industry"],
            "recommended_price": current_price,
            "weight_pct": row["Weight %"],
        })

    # Save to Apps Script  (name must match subscription strategy field)
    save_run("MultiFactor SmallMicro 500", stocks)
    return stocks


def run_multiasset():
    """
    Run MultiAsset strategy using the full composite model from source_code.py:
      - 3M / 6M / 12M weekly momentum (avg)
      - Volatility penalty (52W annualised vol z-score)
      - Trend filter (10M MA; 50% penalty if below)
      - Score-proportional allocation (not equal weight)
    """
    print("\n" + "=" * 65)
    print("MultiAsset Strategy")
    print("=" * 65)

    # ── Config (mirrors source_code.py) ──────────────────────────
    WEEKS_3M      = 13
    WEEKS_6M      = 26
    WEEKS_12M     = 52
    MA_10_MONTHS  = 40   # weekly bars ≈ 10 months
    VOL_PENALTY   = 0.5
    VOL_ADJ_FLOOR = 0.2
    TREND_PENALTY = 0.5

    asset_name_map = {v: k for k, v in MULTIASSET_ASSETS.items()}
    tickers = list(MULTIASSET_ASSETS.values())

    # ── Download 3 years of daily data, resample to weekly ───────
    end_date   = datetime.today()
    start_date = end_date - timedelta(days=3 * 365 + 30)

    raw = yf.download(tickers, start=start_date, end=end_date,
                      auto_adjust=True, progress=False)

    if isinstance(raw.columns, pd.MultiIndex):
        daily_prices = raw.xs("Close", level=0, axis=1)
    else:
        daily_prices = raw[["Close"]] if "Close" in raw.columns else raw

    daily_prices = daily_prices.ffill()

    # Resample to weekly (Friday close)
    weekly = daily_prices.resample("W-FRI").last().dropna(how="all")
    print(f"Weekly rows available: {len(weekly)}")

    # ── Compute per-asset metrics ─────────────────────────────────
    asset_data = {}

    for ticker in tickers:
        if ticker not in weekly.columns:
            print(f"  ✗ {ticker}: no data — skipping")
            continue

        close = weekly[ticker].dropna()

        if len(close) < WEEKS_12M + MA_10_MONTHS:
            print(f"  ✗ {ticker}: only {len(close)} weekly rows — skipping")
            continue

        current = close.iloc[-1]
        p3  = close.iloc[-WEEKS_3M]
        p6  = close.iloc[-WEEKS_6M]
        p12 = close.iloc[-WEEKS_12M]
        m3  = (current / p3)  - 1
        m6  = (current / p6)  - 1
        m12 = (current / p12) - 1
        avg_mom = float(np.mean([m3, m6, m12]))

        ma10  = close.rolling(MA_10_MONTHS).mean().iloc[-1]
        above = bool(current > ma10)

        # 52-week annualised vol from weekly returns
        weekly_rets = close.iloc[-(WEEKS_12M + 1):].pct_change().dropna()
        vol_52w = float(weekly_rets.std() * np.sqrt(52))

        asset_data[ticker] = {
            "avg_mom": avg_mom,
            "above_ma": above,
            "vol_52w": vol_52w,
            "current": float(current),
        }
        print(f"  {asset_name_map.get(ticker, ticker)}: avg_mom={avg_mom:+.2%}  "
              f"above_ma={above}  vol={vol_52w:.2%}")

    if not asset_data:
        print("✗ No usable asset data — aborting MultiAsset run")
        return []

    # ── Step 1: vol z-score across universe ──────────────────────
    vols     = np.array([d["vol_52w"] for d in asset_data.values()])
    vol_mean = float(vols.mean())
    vol_std  = float(vols.std()) if vols.std() > 0 else 1.0
    for d in asset_data.values():
        d["vol_z"] = (d["vol_52w"] - vol_mean) / vol_std

    # ── Step 2: composite score ───────────────────────────────────
    for d in asset_data.values():
        vol_adj   = max(1.0 - VOL_PENALTY * d["vol_z"], VOL_ADJ_FLOOR)
        trend_adj = 1.0 if d["above_ma"] else TREND_PENALTY
        d["score"] = d["avg_mom"] * vol_adj * trend_adj

    # ── Step 3: shift positive → normalise to weights ────────────
    scores_arr = np.array([d["score"] for d in asset_data.values()])
    shift = float(abs(scores_arr.min()) + 0.01) if scores_arr.min() <= 0 else 0.0
    total = sum(d["score"] + shift for d in asset_data.values())
    alloc = {ticker: (d["score"] + shift) / total
             for ticker, d in asset_data.items()}

    # ── Build stock list sorted by weight desc ────────────────────
    stocks = []
    for ticker in sorted(alloc, key=lambda x: -alloc[x]):
        current_price = fetch_current_price(ticker)
        weight_pct    = round(alloc[ticker] * 100, 2)
        asset_name    = asset_name_map.get(ticker, ticker)
        stocks.append({
            "ticker":            ticker,
            "yahoo_ticker":      ticker,
            "company_name":      asset_name,
            "industry":          "MultiAsset",
            "recommended_price": current_price,
            "weight_pct":        weight_pct,
        })
        print(f"  {asset_name:<25} weight={weight_pct:.1f}%  "
              f"score={asset_data[ticker]['score']:+.4f}")

    total_w = sum(s["weight_pct"] for s in stocks)
    print(f"\n  Total weight: {total_w:.1f}%  |  Assets: {len(stocks)}")

    # Save to Apps Script  (name must match subscription strategy field)
    save_run("MultiFactor MultiAsset", stocks)
    return stocks


def save_run(strategy: str, stocks: list):
    """Save run results to Apps Script."""
    from datetime import datetime

    # Unique 3-letter codes per strategy — all names start with "MultiFactor"
    # so strategy[:3] was always "MUL", causing run_id collisions across strategies.
    STRATEGY_CODES = {
        "MultiFactor LargeMidcap 250": "LMC",
        "MultiFactor SmallMicro 500":  "SMC",
        "MultiFactor MultiAsset":      "MAS",
    }
    code = STRATEGY_CODES.get(strategy, strategy.replace(" ", "")[:4].upper())
    run_id = datetime.now().strftime("%Y%m%d_%H%M") + "_" + code

    payload = {
        "action": "save_run",
        "run_id": run_id,
        "run_time": datetime.now().isoformat(),
        "strategy": strategy,
        "stocks": stocks,
    }

    try:
        response = requests.post(APPS_SCRIPT_URL, json=payload, timeout=60)
        if response.status_code == 200:
            data = response.json()
            if data.get("status") == "ok":
                print(f"✓ Saved {len(stocks)} stocks for {strategy} (run_id={run_id})")
            else:
                print(f"✗ Save failed: {data.get('error', 'Unknown error')}")
        else:
            print(f"✗ HTTP {response.status_code}: {response.text}")
    except Exception as e:
        print(f"✗ Failed to save {strategy}: {e}")


# ─────────────────────────────────────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("\n" + "=" * 65)
    print(f"MindForge Strategy Runner — {datetime.now().strftime('%Y-%m-%d %H:%M:%S IST')}")
    print("=" * 65)

    if not APPS_SCRIPT_URL or "PLACEHOLDER" in APPS_SCRIPT_URL:
        print("\nERROR: APPS_SCRIPT_URL not set in mindforge_runner.py!")
        exit(1)

    try:
        run_largemidcap()
        run_smallmicro()
        run_multiasset()

        print("\n" + "=" * 65)
        print("✓ All strategies saved. Dashboard will update for new subscribers.")
        print("=" * 65)

    except Exception as e:
        print(f"\n✗ Error: {e}")
        import traceback
        traceback.print_exc()
        exit(1)
