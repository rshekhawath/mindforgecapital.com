"""
================================================================================
  MindForge Capital — Strategy Runner
================================================================================

Run manually before activating subscribers:
  cd ~/Desktop/MFC
  python3 runner/mindforge_runner.py

What it does
------------
  1. Refreshes both stock universes from live NSE data
  2. Runs multi-factor scoring for all 3 strategies
  3. Independently runs each portfolio_builder.py for cross-validation
  4. Compares results — prints ✅ Ready to Activate or ❌ Invalid Run
  5. If valid, posts the latest picks to Google Sheets (subscriber dashboard)

Setup
-----
  1. Copy .env.example → .env in the project root and fill in your
     MINDFORGE_APPS_SCRIPT_URL (see docs/SUBSCRIBER_SYSTEM_SETUP.md)
  2. Install dependencies:
       pip install -r requirements.txt

================================================================================
"""

import os, sys, warnings, json, time, subprocess
from datetime import datetime, timedelta
import numpy as np
import pandas as pd
import yfinance as yf
import requests

# ── Load .env if present (optional dependency: python-dotenv) ─────────────────
try:
    from dotenv import load_dotenv
    _env_path = os.path.join(os.path.dirname(__file__), "..", ".env")
    load_dotenv(_env_path)
except ImportError:
    pass  # fine — just use os.environ directly

# ── Shared modules ────────────────────────────────────────────────────────────
ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, ROOT_DIR)

from shared.config import LARGEMIDCAP, SMALLMICRO, MULTIASSET, RISK_FREE
from shared.backtest_engine import safe_zscore, extract_field

warnings.filterwarnings("ignore")

# ─────────────────────────────────────────────────────────────────────────────
# CONFIG  — sensitive values come from environment / .env
# ─────────────────────────────────────────────────────────────────────────────
APPS_SCRIPT_URL = os.environ.get("MINDFORGE_APPS_SCRIPT_URL", "")
if not APPS_SCRIPT_URL:
    raise EnvironmentError(
        "MINDFORGE_APPS_SCRIPT_URL is not set.\n\n"
        "Copy .env.example → .env in the project root and fill in the URL,\n"
        "or export the variable before running:\n"
        "  export MINDFORGE_APPS_SCRIPT_URL=https://script.google.com/macros/s/..."
    )

STRATEGIES = {
    "LargeMidcap": {
        "universe_path":   os.path.join(ROOT_DIR, "strategies", "largemidcap", "universe.xlsx"),
        "universe_sheet":  LARGEMIDCAP["UNIVERSE_SHEET"],
        "top_n":           LARGEMIDCAP["TOP_N"],
        "max_per_sector":  LARGEMIDCAP["MAX_PER_SECTOR"],
        "model":           "largemidcap",
        "builder_script":  os.path.join(ROOT_DIR, "strategies", "largemidcap", "portfolio_builder.py"),
        "builder_output":  os.path.join(ROOT_DIR, "strategies", "largemidcap", "outputs", "portfolio.csv"),
    },
    "SmallMicro": {
        "universe_path":   os.path.join(ROOT_DIR, "strategies", "smallmicro", "universe.xlsx"),
        "universe_sheet":  SMALLMICRO["UNIVERSE_SHEET"],
        "top_n":           SMALLMICRO["TOP_N"],
        "max_per_sector":  SMALLMICRO["MAX_PER_SECTOR"],
        "model":           "smallmicro",
        "builder_script":  os.path.join(ROOT_DIR, "strategies", "smallmicro", "portfolio_builder.py"),
        "builder_output":  os.path.join(ROOT_DIR, "strategies", "smallmicro", "outputs", "portfolio.csv"),
    },
}

MULTIASSET_ASSETS        = MULTIASSET["ASSETS"]
MULTIASSET_BUILDER       = os.path.join(ROOT_DIR, "strategies", "multiasset", "portfolio_builder.py")
MULTIASSET_BUILDER_OUTPUT = os.path.join(ROOT_DIR, "strategies", "multiasset", "outputs", "weekly_momentum_table.xlsx")

# Minimum overlap % between runner and portfolio_builder to pass validation
OVERLAP_THRESHOLD = 0.70   # 70 %

# Factor weights — LargeMidcap
LM_W = {k: LARGEMIDCAP[k]
        for k in ("W_MOMENTUM", "W_TREND", "W_LOWVOL", "W_HIGH52", "W_AMIHUD")}

# Factor weights — SmallMicro
SM_W = {k: SMALLMICRO[k]
        for k in ("W_MOMENTUM", "W_TREND", "W_VOLUME", "W_HIGH52", "W_RELVOL")}


# ─────────────────────────────────────────────────────────────────────────────
# HELPERS
# ─────────────────────────────────────────────────────────────────────────────

def _banner(text, width=70):
    print(f"\n{'─'*width}")
    print(f"  {text}")
    print(f"{'─'*width}")


def load_universe(path, sheet):
    if not os.path.exists(path):
        raise FileNotFoundError(f"Universe file not found: {path}")
    df = pd.read_excel(path, sheet_name=sheet)
    df.columns = df.columns.str.strip()
    dummy_mask  = df["Symbol"].str.upper().str.startswith("DUMMY")
    df          = df[~dummy_mask].reset_index(drop=True)
    tickers     = df["Yahoo Finance Ticker"].dropna().str.strip().tolist()
    sector_map  = dict(zip(df["Yahoo Finance Ticker"], df["Industry"]))
    company_map = dict(zip(df["Yahoo Finance Ticker"], df["Company Name"]))
    return tickers, sector_map, company_map, df


def download_prices(tickers, days=420):
    end     = datetime.today()
    start   = end - timedelta(days=days)
    raw     = yf.download(tickers, start=start, end=end, auto_adjust=True, progress=False)
    prices  = extract_field(raw, "Close").ffill()
    volumes = extract_field(raw, "Volume").fillna(0)
    prices  = prices.dropna(axis=1, how="all").dropna(axis=1, thresh=120)
    valid   = prices.columns.tolist()
    volumes = volumes.reindex(columns=valid).fillna(0)
    return prices, volumes, valid


def fetch_current_prices(tickers):
    result = {}
    try:
        data   = yf.download(tickers, period="2d", auto_adjust=True, progress=False)
        closes = extract_field(data, "Close")
        for t in tickers:
            if t in closes.columns:
                result[t] = float(closes[t].dropna().iloc[-1])
    except Exception as e:
        print(f"  ⚠  fetch_current_prices error: {e}")
    return result


def post_to_sheets(payload, label):
    try:
        resp = requests.post(APPS_SCRIPT_URL, json=payload, timeout=30)
        data = resp.json()
        if data.get("status") == "ok":
            print(f"  ✓  {label} saved — run_id: {data.get('run_id')}  "
                  f"stocks: {data.get('count')}")
        else:
            print(f"  ✗  {label} error: {data}")
    except Exception as e:
        print(f"  ✗  {label} POST failed: {e}")


# ─────────────────────────────────────────────────────────────────────────────
# FACTOR MODELS
# ─────────────────────────────────────────────────────────────────────────────

def score_largemidcap(prices, volumes, valid, sector_map, top_n, max_per_sector):
    factor_data = {}
    for t in valid:
        p = prices[t].dropna()
        v = volumes[t] if t in volumes.columns else pd.Series(dtype=float)
        if len(p) < 252:
            continue
        rec = {}
        r12 = (p.iloc[-1] / p.iloc[-252]) - 1
        r6  = (p.iloc[-1] / p.iloc[-126]) - 1
        r1  = (p.iloc[-1] / p.iloc[-21])  - 1
        rec["Momentum"] = ((r12 - r1) + r6) / 2
        sma200       = p.iloc[-200:].mean()
        log_p        = np.log(p.iloc[-63:].values)
        x            = np.arange(len(log_p))
        slope, _     = np.polyfit(x, log_p, 1)
        rec["Trend"] = ((p.iloc[-1] / sma200) - 1) + (slope * 252)
        daily_rets     = p.pct_change().iloc[-252:]
        rec["LowVol"]  = -(daily_rets.std() * np.sqrt(252))
        rec["High52"]  = p.iloc[-1] / p.iloc[-252:].max()
        if len(v) >= 60 and v.iloc[-60:].sum() > 0:
            idx60         = daily_rets.index.intersection(v.index)
            turnover      = (v.reindex(idx60).iloc[-60:] * p.reindex(idx60).iloc[-60:]).replace(0, np.nan)
            rec["Amihud"] = -(daily_rets.reindex(idx60).iloc[-60:].abs() / turnover).mean()
        else:
            rec["Amihud"] = np.nan
        factor_data[t] = rec

    df = pd.DataFrame(factor_data).T.dropna(subset=["Momentum", "Trend", "LowVol", "High52"])
    if df.empty:
        return []

    df["Z_Mom"]    = safe_zscore(df["Momentum"])
    df["Z_Trend"]  = safe_zscore(df["Trend"])
    df["Z_LowVol"] = safe_zscore(df["LowVol"])
    df["Z_High52"] = safe_zscore(df["High52"])
    df["Z_Amihud"] = safe_zscore(df["Amihud"])
    df["Score"]    = (
        LM_W["W_MOMENTUM"] * df["Z_Mom"]    +
        LM_W["W_TREND"]    * df["Z_Trend"]  +
        LM_W["W_LOWVOL"]   * df["Z_LowVol"] +
        LM_W["W_HIGH52"]   * df["Z_High52"] +
        LM_W["W_AMIHUD"]   * df["Z_Amihud"]
    )
    df["Sector"] = df.index.map(lambda t: sector_map.get(t, f"_unk_{t}"))
    df = df.sort_values("Score", ascending=False)
    port = (df.groupby("Sector", group_keys=False)
              .apply(lambda g: g.head(max_per_sector))
              .sort_values("Score", ascending=False)
              .head(top_n))
    return port.index.tolist()


def score_smallmicro(prices, volumes, valid, sector_map, top_n, max_per_sector):
    factor_data = {}
    for t in valid:
        p = prices[t].dropna()
        v = volumes[t] if t in volumes.columns else pd.Series(dtype=float)
        n = len(p)
        if n < 63:
            continue
        rec = {}
        r12 = (p.iloc[-1] / p.iloc[-min(252, n)]) - 1
        r6  = (p.iloc[-1] / p.iloc[-min(126, n)]) - 1
        r1  = (p.iloc[-1] / p.iloc[-min(21,  n)]) - 1
        rec["Momentum"] = ((r12 - r1) + r6) / 2
        sma        = p.iloc[-min(200, n):].mean()
        log_p      = np.log(p.iloc[-min(63, n):].values)
        x          = np.arange(len(log_p))
        slope, _   = np.polyfit(x, log_p, 1)
        rec["Trend"] = ((p.iloc[-1] / sma) - 1) + (slope * 252)
        if len(v) >= 60 and v.iloc[-60:].sum() > 0:
            rec["VolBreak"] = v.iloc[-20:].mean() / v.iloc[-60:].mean()
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
        factor_data[t] = rec

    df = pd.DataFrame(factor_data).T.dropna(subset=["Momentum", "Trend", "High52"])
    if df.empty:
        return []

    df["Z_Mom"]    = safe_zscore(df["Momentum"])
    df["Z_Trend"]  = safe_zscore(df["Trend"])
    df["Z_Vol"]    = safe_zscore(df["VolBreak"])
    df["Z_High52"] = safe_zscore(df["High52"])
    df["Z_RelVol"] = safe_zscore(df["RelVol"])
    df["Score"]    = (
        SM_W["W_MOMENTUM"] * df["Z_Mom"]    +
        SM_W["W_TREND"]    * df["Z_Trend"]  +
        SM_W["W_VOLUME"]   * df["Z_Vol"]    +
        SM_W["W_HIGH52"]   * df["Z_High52"] +
        SM_W["W_RELVOL"]   * df["Z_RelVol"]
    )
    df["Sector"] = df.index.map(lambda t: sector_map.get(t, f"_unk_{t}"))
    df = df.sort_values("Score", ascending=False)
    port = (df.groupby("Sector", group_keys=False)
              .apply(lambda g: g.head(max_per_sector))
              .sort_values("Score", ascending=False)
              .head(top_n))
    return port.index.tolist()


def score_multiasset():
    prices = {}
    for name, ticker in MULTIASSET_ASSETS.items():
        try:
            tk = yf.Ticker(ticker)
            df = tk.history(period="2y", interval="1d", auto_adjust=True)
            if not df.empty:
                prices[name] = df["Close"].dropna()
        except Exception:
            pass
    if not prices:
        return {}
    price_df = pd.DataFrame(prices).ffill().dropna()
    if len(price_df) < 60:
        return {}
    scores = {}
    for name in price_df.columns:
        p   = price_df[name]
        m3  = p.iloc[-1] / p.iloc[-min(65,  len(p))] - 1
        m6  = p.iloc[-1] / p.iloc[-min(126, len(p))] - 1
        m12 = p.iloc[-1] / p.iloc[-min(252, len(p))] - 1
        scores[name] = (m3 + m6 + m12) / 3
    total   = sum(max(v, 0) for v in scores.values()) or 1
    weights = {k: max(v, 0) / total for k, v in scores.items()}
    return weights


# ─────────────────────────────────────────────────────────────────────────────
# PHASE 0 — REFRESH UNIVERSES
# ─────────────────────────────────────────────────────────────────────────────

def run_universe_builders():
    """Run universe_builder.py for LargeMidcap and SmallMicro."""
    builders = {
        "LargeMidcap": os.path.join(ROOT_DIR, "strategies", "largemidcap", "universe_builder.py"),
        "SmallMicro":  os.path.join(ROOT_DIR, "strategies", "smallmicro",  "universe_builder.py"),
    }
    all_ok = True
    for name, script in builders.items():
        print(f"\n  Running universe_builder  [{name}] ...")
        if not os.path.exists(script):
            print(f"  ⚠  universe_builder.py not found for {name} — using existing universe.xlsx")
            continue
        result = subprocess.run(
            [sys.executable, script],
            capture_output=True, text=True
        )
        if result.returncode == 0:
            print(f"  ✓  {name} universe refreshed")
        else:
            print(f"  ✗  {name} universe_builder failed:")
            print(f"     {result.stderr.strip()[:400]}")
            all_ok = False
    return all_ok


# ─────────────────────────────────────────────────────────────────────────────
# PHASE 2 — RUN PORTFOLIO BUILDERS (independent validation)
# ─────────────────────────────────────────────────────────────────────────────

def run_portfolio_builders():
    """
    Run each portfolio_builder.py as a subprocess so it saves its own output
    independently of the runner.  Returns True if all builders succeeded.
    """
    scripts = {
        "LargeMidcap": STRATEGIES["LargeMidcap"]["builder_script"],
        "SmallMicro":  STRATEGIES["SmallMicro"]["builder_script"],
        "MultiAsset":  MULTIASSET_BUILDER,
    }
    all_ok = True
    for name, script in scripts.items():
        print(f"\n  Running portfolio_builder  [{name}] ...")
        if not os.path.exists(script):
            print(f"  ✗  portfolio_builder.py not found: {script}")
            all_ok = False
            continue
        result = subprocess.run(
            [sys.executable, script],
            capture_output=True, text=True,
            cwd=os.path.dirname(script)   # run from strategy's own folder
        )
        if result.returncode == 0:
            print(f"  ✓  {name} portfolio_builder completed")
        else:
            print(f"  ✗  {name} portfolio_builder failed:")
            print(f"     {result.stderr.strip()[:400]}")
            all_ok = False
    return all_ok


# ─────────────────────────────────────────────────────────────────────────────
# PHASE 3 — COMPARE & VALIDATE
# ─────────────────────────────────────────────────────────────────────────────

def compare_equity(strategy_name, runner_holdings, csv_path):
    """
    Compare runner's selected tickers with portfolio_builder's saved CSV.
    Returns (passed: bool, overlap_pct: float, details: str).
    """
    if not os.path.exists(csv_path):
        return False, 0.0, f"portfolio.csv not found: {csv_path}"

    try:
        df_pb = pd.read_csv(csv_path, index_col=0)
        pb_tickers = set(df_pb.index.str.strip().tolist())
    except Exception as e:
        return False, 0.0, f"Could not read portfolio.csv: {e}"

    runner_set  = set(runner_holdings)
    overlap     = runner_set & pb_tickers
    union       = runner_set | pb_tickers
    overlap_pct = len(overlap) / len(runner_set) if runner_set else 0.0

    details = (
        f"{strategy_name}: runner={len(runner_set)} stocks, "
        f"builder={len(pb_tickers)} stocks, "
        f"overlap={len(overlap)} ({overlap_pct:.0%})"
    )

    if overlap_pct < OVERLAP_THRESHOLD:
        only_runner  = runner_set  - pb_tickers
        only_builder = pb_tickers  - runner_set
        details += (
            f"\n     Only in runner : {sorted(only_runner)}"
            f"\n     Only in builder: {sorted(only_builder)}"
        )

    return overlap_pct >= OVERLAP_THRESHOLD, overlap_pct, details


def compare_multiasset(runner_weights):
    """
    Compare runner's MultiAsset weights with portfolio_builder's xlsx output.
    Passes if the top-ranked asset matches between the two runs.
    Returns (passed: bool, details: str).
    """
    if not os.path.exists(MULTIASSET_BUILDER_OUTPUT):
        return False, f"MultiAsset builder output not found: {MULTIASSET_BUILDER_OUTPUT}"

    try:
        df_pb = pd.read_excel(MULTIASSET_BUILDER_OUTPUT, sheet_name="Momentum_Signal")
        # portfolio_builder sorts by descending allocation, so row 0 is top asset
        top_pb = df_pb.sort_values("Allocation Weight", ascending=False).iloc[0]["Asset Name"]
    except Exception as e:
        return False, f"Could not read MultiAsset output: {e}"

    if not runner_weights:
        return False, "Runner returned no MultiAsset weights"

    top_runner = max(runner_weights, key=runner_weights.get)

    runner_ranked  = sorted(runner_weights, key=runner_weights.get, reverse=True)
    builder_ranked = df_pb.sort_values("Allocation Weight", ascending=False)["Asset Name"].tolist()

    # Pass if top asset matches, or if top-3 overlap ≥ 2/3
    top3_runner  = set(runner_ranked[:3])
    top3_builder = set(builder_ranked[:3])
    top3_overlap = len(top3_runner & top3_builder)

    passed  = (top_runner == top_pb) or (top3_overlap >= 2)
    details = (
        f"MultiAsset: runner top={top_runner}, builder top={top_pb}, "
        f"top-3 overlap={top3_overlap}/3"
    )
    return passed, details


# ─────────────────────────────────────────────────────────────────────────────
# MAIN
# ─────────────────────────────────────────────────────────────────────────────

def run():
    now    = datetime.now()
    run_dt = now.strftime("%Y%m%d_%H%M")
    print(f"\n{'='*70}")
    print(f"  MindForge Capital — Strategy Runner")
    print(f"  {now.strftime('%Y-%m-%d %H:%M')}")
    print(f"{'='*70}")

    # ── PHASE 0: Refresh universes ────────────────────────────────────────────
    _banner("PHASE 0 · Refreshing stock universes from NSE")
    universes_ok = run_universe_builders()
    if not universes_ok:
        print("\n  ⚠  One or more universe builders failed — continuing with existing files")

    # ── PHASE 1: Runner's own scoring (collect payloads, don't post yet) ──────
    _banner("PHASE 1 · Running multi-factor scoring")

    payloads         = {}
    runner_holdings  = {}   # strategy → list of yahoo tickers
    runner_ma_weights = {}  # MultiAsset weights

    # LargeMidcap
    print("\n  [ LargeMidcap 250 ]")
    cfg = STRATEGIES["LargeMidcap"]
    try:
        tickers, sector_map, company_map, df_u = load_universe(
            cfg["universe_path"], cfg["universe_sheet"])
        prices, volumes, valid = download_prices(tickers)
        holdings = score_largemidcap(prices, volumes, valid, sector_map,
                                     cfg["top_n"], cfg["max_per_sector"])
        live     = fetch_current_prices(holdings)
        stocks   = []
        for t in holdings:
            price = live.get(t)
            sym   = df_u.loc[df_u["Yahoo Finance Ticker"] == t, "Symbol"]
            stocks.append({
                "ticker":            sym.values[0] if len(sym) else t,
                "yahoo_ticker":      t,
                "company_name":      company_map.get(t, ""),
                "industry":          sector_map.get(t, "Unknown"),
                "recommended_price": round(price, 2) if price else None,
                "weight_pct":        round(100 / len(holdings), 2),
            })
        payloads["LargeMidcap"] = {
            "action":   "save_run",
            "run_id":   f"{run_dt}_LMC",
            "run_time": now.isoformat(),
            "strategy": "LargeMidcap",
            "stocks":   stocks,
        }
        runner_holdings["LargeMidcap"] = holdings
        print(f"  ✓  {len(stocks)} stocks selected")
    except Exception as e:
        print(f"  ✗  LargeMidcap scoring failed: {e}")

    # SmallMicro
    print("\n  [ SmallMicro 500 ]")
    cfg = STRATEGIES["SmallMicro"]
    try:
        tickers, sector_map, company_map, df_u = load_universe(
            cfg["universe_path"], cfg["universe_sheet"])
        prices, volumes, valid = download_prices(tickers)
        holdings = score_smallmicro(prices, volumes, valid, sector_map,
                                    cfg["top_n"], cfg["max_per_sector"])
        live     = fetch_current_prices(holdings)
        stocks   = []
        for t in holdings:
            price = live.get(t)
            sym   = df_u.loc[df_u["Yahoo Finance Ticker"] == t, "Symbol"]
            stocks.append({
                "ticker":            sym.values[0] if len(sym) else t,
                "yahoo_ticker":      t,
                "company_name":      company_map.get(t, ""),
                "industry":          sector_map.get(t, "Unknown"),
                "recommended_price": round(price, 2) if price else None,
                "weight_pct":        round(100 / len(holdings), 2),
            })
        payloads["SmallMicro"] = {
            "action":   "save_run",
            "run_id":   f"{run_dt}_SMC",
            "run_time": now.isoformat(),
            "strategy": "SmallMicro",
            "stocks":   stocks,
        }
        runner_holdings["SmallMicro"] = holdings
        print(f"  ✓  {len(stocks)} stocks selected")
    except Exception as e:
        print(f"  ✗  SmallMicro scoring failed: {e}")

    # MultiAsset
    print("\n  [ MultiAsset ]")
    try:
        weights = score_multiasset()
        stocks  = [
            {
                "ticker":            name,
                "yahoo_ticker":      MULTIASSET_ASSETS[name],
                "company_name":      name,
                "industry":          "ETF",
                "recommended_price": None,
                "weight_pct":        round(w * 100, 2),
            }
            for name, w in weights.items()
        ]
        payloads["MultiAsset"] = {
            "action":   "save_run",
            "run_id":   f"{run_dt}_MA",
            "run_time": now.isoformat(),
            "strategy": "MultiAsset",
            "stocks":   stocks,
        }
        runner_ma_weights = weights
        print(f"  ✓  {len(stocks)} assets scored")
    except Exception as e:
        print(f"  ✗  MultiAsset scoring failed: {e}")

    # Abort if runner itself failed for any strategy
    if len(payloads) < 3:
        failed = {"LargeMidcap", "SmallMicro", "MultiAsset"} - set(payloads.keys())
        print(f"\n{'='*70}")
        print(f"  ❌  INVALID RUN — Runner failed for: {', '.join(failed)}")
        print(f"{'='*70}\n")
        sys.exit(1)

    # ── PHASE 2: Independent portfolio_builder runs ───────────────────────────
    _banner("PHASE 2 · Running independent portfolio builders for cross-validation")
    builders_ok = run_portfolio_builders()

    # ── PHASE 3: Compare & validate ───────────────────────────────────────────
    _banner("PHASE 3 · Comparing results")

    validation_results = {}

    # LargeMidcap comparison
    lm_pass, lm_pct, lm_detail = compare_equity(
        "LargeMidcap",
        runner_holdings.get("LargeMidcap", []),
        STRATEGIES["LargeMidcap"]["builder_output"]
    )
    validation_results["LargeMidcap"] = lm_pass
    status = "✓  PASS" if lm_pass else "✗  FAIL"
    print(f"\n  {status}  {lm_detail}")

    # SmallMicro comparison
    sm_pass, sm_pct, sm_detail = compare_equity(
        "SmallMicro",
        runner_holdings.get("SmallMicro", []),
        STRATEGIES["SmallMicro"]["builder_output"]
    )
    validation_results["SmallMicro"] = sm_pass
    status = "✓  PASS" if sm_pass else "✗  FAIL"
    print(f"\n  {status}  {sm_detail}")

    # MultiAsset comparison
    ma_pass, ma_detail = compare_multiasset(runner_ma_weights)
    validation_results["MultiAsset"] = ma_pass
    status = "✓  PASS" if ma_pass else "✗  FAIL"
    print(f"\n  {status}  {ma_detail}")

    # ── VERDICT ───────────────────────────────────────────────────────────────
    all_passed = all(validation_results.values())

    print(f"\n{'='*70}")
    if all_passed:
        print(f"  ✅  READY TO ACTIVATE")
        print(f"      All 3 strategies passed cross-validation.")
        print(f"      Posting results to Google Sheets...")
        print(f"{'='*70}")

        # Post all payloads to sheets
        _banner("PHASE 4 · Posting to Google Sheets")
        for name, payload in payloads.items():
            post_to_sheets(payload, name)

        print(f"\n✅  Done — {datetime.now().strftime('%H:%M:%S')}")
        print(f"    You can now activate subscribers in the dashboard.\n")
    else:
        failed = [k for k, v in validation_results.items() if not v]
        print(f"  ❌  INVALID RUN — Do NOT activate subscribers")
        print(f"      Failed strategies: {', '.join(failed)}")
        print(f"      Results were NOT posted to Google Sheets.")
        print(f"{'='*70}")
        print(f"\n  Troubleshooting tips:")
        print(f"  • Check your internet connection (Yahoo Finance downloads)")
        print(f"  • Re-run universe_builder.py manually for the failed strategy")
        print(f"  • Review the portfolio_builder output CSVs under strategies/*/outputs/")
        print(f"  • If overlap is borderline, check that universe.xlsx is fresh\n")
        sys.exit(1)


if __name__ == "__main__":
    run()
