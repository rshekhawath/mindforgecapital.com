#!/usr/bin/env python3
"""
fetch_financials.py
===================
ADDITIVE multi-year financials + analyst layer for the company deep-dive pages.

Yahoo already hands the daily refresh (server.fetch_stock_info) the annual
income statement / balance sheet / cash-flow frames — but it keeps only single
derived metrics and throws the multi-year series away. This script pulls those
same frames (plus analyst price targets from ticker.info) and writes ONE small
file per symbol:

    docs/screener/fin/<SYMBOL>.json

It deliberately does NOT touch stocks.json, screener.db, hist/ or anything the
daily snapshot depends on — so a bad/slow run can never corrupt the live data.
The company page (assets/mfc-company.js) fetches /screener/fin/<SYMBOL>.json
lazily and renders the Financial-trends + Analyst modules only when it lands;
absent files simply mean those modules stay hidden (fail-soft).

Schema (all money in raw ₹; the UI converts to ₹ Cr):
    {
      "symbol": "RELIANCE", "updated": "2026-07-28", "currency": "INR",
      "annual": [   # oldest -> newest, up to 5 fiscal years
        {"year":"2022","revenue":..,"gross_profit":..,"operating_income":..,
         "ebitda":..,"net_income":..,"op_cashflow":..,"capex":..,"fcf":..,
         "total_assets":..,"total_equity":..,"total_debt":..,"eps":..,"shares":..},
        ...
      ],
      "analyst": {"current":..,"target_mean":..,"target_high":..,
                  "target_low":..,"recommendation":"buy","n_analysts":34}
    }

Usage
-----
    python3 fetch_financials.py                 # whole universe (skips fresh files)
    python3 fetch_financials.py 60              # first 60 symbols of the universe
    python3 fetch_financials.py --top 50        # 50 largest by market cap (stocks.json)
    python3 fetch_financials.py RELIANCE TCS     # specific symbols (always refetched)
    python3 fetch_financials.py --force 40       # ignore the freshness skip
"""
import json
import os
import sys
import time
from datetime import datetime, timezone

import server  # for NIFTY_UNIVERSE + get_yf_symbol (Flask app object is unused)

try:
    import yfinance as yf
except Exception as e:  # pragma: no cover
    print("yfinance is required:", e)
    raise SystemExit(1)

HERE = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(HERE, "..", "docs", "screener", "fin")
STOCKS_JSON = os.path.join(HERE, "..", "docs", "screener", "stocks.json")

FRESH_DAYS = 25  # a fin file younger than this is skipped on a plain run (statements move quarterly)
MAX_YEARS = 5


def _safe_name(sym):
    # Mirror export_static._safe_name so filenames line up with hist/.
    return "".join(c if (c.isalnum() or c in "-_") else "_" for c in str(sym)).upper()


def _num(v):
    try:
        if v is None:
            return None
        f = float(v)
        if f != f or f in (float("inf"), float("-inf")):
            return None
        return f
    except Exception:
        return None


def _pick(series, labels):
    """First present, non-null value among candidate row labels of a pandas Series."""
    if series is None:
        return None
    for lab in labels:
        try:
            if lab in series.index:
                v = _num(series.get(lab))
                if v is not None:
                    return v
        except Exception:
            pass
    return None


def _cols_desc(df):
    """Yahoo statement columns are period-end dates; return them newest-first, de-duped by year, no TTM."""
    if df is None or getattr(df, "empty", True):
        return []
    cols = list(df.columns)
    try:
        cols = sorted(cols, key=lambda c: str(c), reverse=True)
    except Exception:
        pass
    out, seen = [], set()
    for c in cols:
        y = str(c)[:4]
        if not y.isdigit():
            continue  # skip a 'TTM'-style column
        if y in seen:
            continue
        seen.add(y)
        out.append(c)
    return out


def build_symbol(sym):
    t = yf.Ticker(server.get_yf_symbol(sym))

    inc = getattr(t, "income_stmt", None)
    bs = getattr(t, "balance_sheet", None)
    cf = getattr(t, "cashflow", None)

    # Union of the year-columns across the three statements (income drives the axis).
    year_cols = _cols_desc(inc) or _cols_desc(bs) or _cols_desc(cf)
    year_cols = year_cols[:MAX_YEARS]

    annual = []
    for col in year_cols:
        y = str(col)[:4]
        inc_s = inc[col] if (inc is not None and not inc.empty and col in inc.columns) else None
        bs_s = bs[col] if (bs is not None and not bs.empty and col in bs.columns) else None
        cf_s = cf[col] if (cf is not None and not cf.empty and col in cf.columns) else None

        revenue = _pick(inc_s, ["Total Revenue", "Operating Revenue", "Total Revenue As Reported"])
        gross = _pick(inc_s, ["Gross Profit"])
        op_inc = _pick(inc_s, ["Operating Income", "Total Operating Income As Reported", "EBIT"])
        ebitda = _pick(inc_s, ["EBITDA", "Normalized EBITDA"])
        net_inc = _pick(inc_s, ["Net Income", "Net Income Common Stockholders",
                                "Net Income Continuous Operations", "Net Income From Continuing Operation Net Minority Interest"])
        eps = _pick(inc_s, ["Diluted EPS", "Basic EPS"])

        assets = _pick(bs_s, ["Total Assets"])
        equity = _pick(bs_s, ["Stockholders Equity", "Total Equity Gross Minority Interest",
                              "Common Stock Equity"])
        debt = _pick(bs_s, ["Total Debt"])
        if debt is None:
            ltd = _pick(bs_s, ["Long Term Debt"]) or 0
            cd = _pick(bs_s, ["Current Debt", "Current Debt And Capital Lease Obligation"]) or 0
            debt = (ltd + cd) or None
        shares = _pick(bs_s, ["Ordinary Shares Number", "Share Issued"])

        op_cf = _pick(cf_s, ["Operating Cash Flow", "Cash Flow From Continuing Operating Activities"])
        capex = _pick(cf_s, ["Capital Expenditure", "Purchase Of PPE"])
        fcf = _pick(cf_s, ["Free Cash Flow"])
        if fcf is None and op_cf is not None and capex is not None:
            fcf = op_cf + capex  # capex is reported negative

        rec = {"year": y}
        for k, v in (("revenue", revenue), ("gross_profit", gross), ("operating_income", op_inc),
                     ("ebitda", ebitda), ("net_income", net_inc), ("op_cashflow", op_cf),
                     ("capex", capex), ("fcf", fcf), ("total_assets", assets),
                     ("total_equity", equity), ("total_debt", debt), ("eps", eps), ("shares", shares)):
            if v is not None:
                rec[k] = round(v, 2) if abs(v) < 1e6 else round(v)
        annual.append(rec)

    # Drop rows Yahoo returned with no revenue spine (stray/partial NaN columns),
    # so the charts never show an empty year.
    annual = [a for a in annual if "revenue" in a]
    annual.reverse()  # oldest -> newest for left-to-right charts

    # Keep only if we have a usable revenue+net_income spine for >=2 years.
    usable = [a for a in annual if "revenue" in a and "net_income" in a]
    if len(usable) < 2:
        return None

    # Analyst view (often sparse for NSE names — fail-soft).
    info = {}
    try:
        info = t.info or {}
    except Exception:
        info = {}
    analyst = {}
    for k, src in (("current", "currentPrice"), ("target_mean", "targetMeanPrice"),
                   ("target_high", "targetHighPrice"), ("target_low", "targetLowPrice")):
        v = _num(info.get(src))
        if v is not None:
            analyst[k] = round(v, 2)
    rec_key = info.get("recommendationKey")
    if rec_key and str(rec_key).lower() not in ("none", "n/a", ""):
        analyst["recommendation"] = str(rec_key)
    n = _num(info.get("numberOfAnalystOpinions"))
    if n:
        analyst["n_analysts"] = int(n)

    return {
        "symbol": sym,
        "updated": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        "currency": info.get("currency", "INR"),
        "annual": annual,
        "analyst": analyst,
    }


def _is_fresh(path):
    try:
        mtime = datetime.fromtimestamp(os.path.getmtime(path), tz=timezone.utc)
        return (datetime.now(timezone.utc) - mtime).days < FRESH_DAYS
    except Exception:
        return False


def _resolve_symbols(args):
    force = False
    if "--force" in args:
        force = True
        args = [a for a in args if a != "--force"]
    if args and args[0] == "--top":
        n = int(args[1]) if len(args) > 1 else 50
        d = json.load(open(STOCKS_JSON, encoding="utf-8"))
        rows = [s for s in d["stocks"] if s.get("market_cap")]
        rows.sort(key=lambda s: s.get("market_cap") or 0, reverse=True)
        # respect freshness so the daily command's --top pass is cheap (only
        # newly-stale files re-fetch); pass --force for a full rebuild of the set.
        return [s["symbol"] for s in rows[:n]], False, force
    if args and args[0].isdigit():
        return server.NIFTY_UNIVERSE[: int(args[0])], False, force
    if args:
        return [a.upper() for a in args], True, force  # named symbols -> always refetch
    return server.NIFTY_UNIVERSE, False, force


def main():
    symbols, explicit, force = _resolve_symbols(sys.argv[1:])
    os.makedirs(OUT_DIR, exist_ok=True)
    total, ok, skip, err = len(symbols), 0, 0, 0
    t0 = time.time()
    for n, sym in enumerate(symbols, 1):
        out = os.path.join(OUT_DIR, _safe_name(sym) + ".json")
        if not explicit and not force and _is_fresh(out):
            skip += 1
        else:
            try:
                data = build_symbol(sym)
                if data:
                    with open(out, "w", encoding="utf-8") as f:
                        json.dump(data, f, separators=(",", ":"), allow_nan=False)
                    ok += 1
                else:
                    err += 1  # not enough data — leave any prior file untouched
            except Exception as e:
                err += 1
                print(f"  ! {sym}: {e}", flush=True)
            time.sleep(0.4)  # gentle Yahoo pacing (statements = a few calls per symbol)
        if n % 25 == 0 or n == total:
            el = time.time() - t0
            print(f"[{n}/{total}] ok={ok} skip={skip} err={err} elapsed={el/60:.1f}m", flush=True)
    print(f"\nFinancials done: {ok} written, {skip} fresh-skipped, {err} no-data/failed of {total}.")
    print(f"Output: {os.path.abspath(OUT_DIR)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
