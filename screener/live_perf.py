"""
screener/live_perf.py  (V24.2)
==============================
Generates docs/live-perf.json — the PUBLIC live-portfolio aggregate that powers
the site's "this cycle" figures (homepage hero + strategy pages).

What it publishes, and deliberately does NOT publish
----------------------------------------------------
Per strategy: the weight-weighted % return of the CURRENT model portfolio since
the last rebalance, the real benchmark index's return over the same window, the
holding count and currency. NO tickers, NO names, NO weights — members pay for
the picks; the public gets only the aggregate. Do not add per-stock fields.

Methodology — kept in lockstep with the member dashboard
--------------------------------------------------------
The dashboard's headline (dashboard.html renderProfitHeadline, V16.3) is
    Σ(weight · r) / Σweight   with   r = live / recommended_price − 1
where recommended_price was stamped by runner/publish.py as the LATEST CLOSE at
publish time. This script mirrors that: rec = last close on/before the publish
date (read from portfolio.csv's mtime — all the files come from one publish
run), live = latest close. Same picks (the same portfolio.csv files publish.py
POSTed), same weights, same basis → the public aggregate matches what members
see, minus intraday timing.

Benchmarks are the REAL index paths over the same window, reusing the V23.8
mapping in IP/shared/benchmark.py (reconstructed LargeMidcap 250 / Smallcap 250
/ Nifty 50).

Coverage guard: if fewer than 80% of a strategy's names return prices, that
strategy publishes null rather than a half-measured number.

Run: python3 screener/live_perf.py        (wired into refresh-stocks.command +
commands/refresh-stocks.command, so it refreshes with every data cycle)
"""
from __future__ import annotations

import csv
import json
import os
import sys
import warnings
from datetime import datetime, timezone
from pathlib import Path

warnings.filterwarnings("ignore")

ROOT = Path(__file__).resolve().parent.parent
IP = ROOT / "IP"
OUT = ROOT / "docs" / "live-perf.json"
sys.path.insert(0, str(IP))

from shared.benchmark import REAL_BENCHMARKS  # noqa: E402  (V23.8 real-index map)

# key → (folder, yahoo suffix, display name, currency) — keys match the site's
# MFSTAT shorthand (lm/sm/ma); suffixes mirror runner/publish.py.
STRATS = {
    "lm": ("largemidcap", ".NS", "LargeMidcap 250", "₹"),
    "sm": ("smallmicro",  ".NS", "SmallMicro 500",  "₹"),
    "ma": ("multiasset",  ".NS", "MultiAsset",      "₹"),
}
BENCH_SHORT = {
    "lm": "Nifty LargeMidcap 250", "sm": "Nifty Smallcap 250", "ma": "Nifty 50",
}
STRAT_TO_BENCHKEY = {
    "lm": "largemidcap", "sm": "smallmicro", "ma": "multiasset",
}


def load_picks(folder: str, suffix: str) -> list[dict]:
    p = IP / "strategies" / folder / "outputs" / "portfolio.csv"
    rows = []
    with p.open() as f:
        for row in csv.DictReader(f):
            sym = row["Ticker"].strip()
            bare = sym.removesuffix(suffix) if suffix else sym
            try:
                w = float(row.get("Weight %", "0") or 0)
            except ValueError:
                w = 0.0
            rows.append({"yahoo": bare + suffix, "w": w or 1.0})
    return rows


def rebalance_date() -> datetime:
    """All the portfolio.csv files come from one publish run — take the newest
    mtime and insist the set is coherent (same run, within a day)."""
    mts = []
    for folder, *_ in STRATS.values():
        mts.append((IP / "strategies" / folder / "outputs" / "portfolio.csv").stat().st_mtime)
    if max(mts) - min(mts) > 86400:
        raise RuntimeError("portfolio.csv files span >1 day — mixed publish runs; refusing")
    return datetime.fromtimestamp(max(mts))


def main() -> None:
    import pandas as pd
    import yfinance as yf

    rebal = rebalance_date()
    rebal_ts = pd.Timestamp(rebal.date())

    all_syms = sorted({r["yahoo"] for k in STRATS for r in load_picks(*STRATS[k][:2])})
    print(f"live-perf: {len(all_syms)} tickers · rebalance {rebal:%Y-%m-%d}")
    raw = yf.download(all_syms, start=(rebal_ts - pd.Timedelta(days=12)).date(),
                      auto_adjust=True, progress=False)
    close = raw["Close"] if "Close" in getattr(raw.columns, "levels", [raw.columns])[0] else raw
    if isinstance(close, pd.Series):
        close = close.to_frame(all_syms[0])
    if getattr(close.index, "tz", None) is not None:
        close.index = close.index.tz_localize(None)

    def px(sym, upto=None):
        if sym not in close.columns:
            return None
        s = close[sym].dropna()
        if upto is not None:
            s = s.loc[:upto]
        return float(s.iloc[-1]) if len(s) else None

    strategies, as_of = {}, None
    for key, (folder, suffix, name, curr) in STRATS.items():
        picks = load_picks(folder, suffix)
        w_sum = w_ret = 0.0
        priced = 0
        for r in picks:
            rec, live = px(r["yahoo"], rebal_ts), px(r["yahoo"])
            if not rec or not live:
                continue
            priced += 1
            w_sum += r["w"]
            w_ret += r["w"] * (live / rec - 1.0)
        ok = picks and priced / len(picks) >= 0.8 and w_sum > 0
        live_pct = round(w_ret / w_sum * 100, 2) if ok else None
        if not ok:
            print(f"  !! {key}: only {priced}/{len(picks)} priced — publishing null")

        bcfg = REAL_BENCHMARKS[STRAT_TO_BENCHKEY[key]]
        b_ret, b_ok = 0.0, True
        for tkr, wt in bcfg["tickers"].items():
            b = yf.download(tkr, start=(rebal_ts - pd.Timedelta(days=12)).date(),
                            auto_adjust=True, progress=False)["Close"]
            if isinstance(b, pd.DataFrame):
                b = b.iloc[:, 0]
            b = b.dropna()
            if getattr(b.index, "tz", None) is not None:
                b.index = b.index.tz_localize(None)
            b0 = b.loc[:rebal_ts]
            if b0.empty or b.empty:
                b_ok = False
                break
            b_ret += wt * (float(b.iloc[-1]) / float(b0.iloc[-1]) - 1.0)
            as_of = max(as_of or b.index[-1], b.index[-1])
        strategies[key] = {
            "name": name,
            "live_pct": live_pct,
            "bench_pct": round(b_ret * 100, 2) if b_ok else None,
            "bench_name": BENCH_SHORT[key],
            "n": len(picks),
            "currency": curr,
        }
        print(f"  {key}: live {live_pct}%  bench {strategies[key]['bench_pct']}%  ({priced}/{len(picks)} priced)")

    data_through = None
    for sym in all_syms:
        if sym in close.columns and len(close[sym].dropna()):
            d = close[sym].dropna().index[-1]
            data_through = max(data_through or d, d)

    out = {
        "generated_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "rebalance_date": rebal.strftime("%Y-%m-%d"),
        "data_through": (max(data_through, as_of) if data_through is not None and as_of is not None
                         else data_through or as_of).strftime("%Y-%m-%d"),
        "basis": ("Weight-weighted model-portfolio movement since the last rebalance; "
                  "closing prices; baseline = last close on/before the rebalance date. "
                  "Model portfolio, not audited client returns."),
        "strategies": strategies,
    }
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n")
    print(f"wrote {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
