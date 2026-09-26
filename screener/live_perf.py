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
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

warnings.filterwarnings("ignore")

ROOT = Path(__file__).resolve().parent.parent
IP = ROOT / "IP"
OUT = ROOT / "docs" / "live-perf.json"
# V35.3 — the same figures, kept instead of overwritten. See append_history().
HIST = ROOT / "docs" / "live-history.json"
HIST_MAX = 36          # three years of monthly cycles; older ones drop off the front
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
    return datetime.fromtimestamp(max(mts), IST)


# ── V39.3 — COMPLETED SESSIONS ONLY ─────────────────────────────────────────
# On 25 Sep 2026 this script ran at 09:12 IST, before the open. yfinance hands
# back TODAY's daily bar as soon as the session starts, `px()` took the last
# row, and every benchmark published was the 25 Sep OPENING print (Nifty 50
# −4.34%, LargeMidcap composite −4.34%, Smallcap 250 −1.08% — each equal to the
# open to the basis point) while the pages said "closes through 25 Sept". A
# sealed live-history row is final, so a pre-open run just before a publish
# would have frozen an opening print into the live record for good.
#
# The rule now: a bar counts only once its session has CLOSED and been printed
# as a close. Before 16:00 IST that means yesterday at the latest (NSE closes
# at 15:30; the extra half hour is for the closing price to settle at the data
# vendor). MFC_LIVE_NOW overrides the clock so the rule can be tested.
IST = ZoneInfo("Asia/Kolkata")
SESSION_FINAL = time(16, 0)


def now_ist() -> datetime:
    override = os.environ.get("MFC_LIVE_NOW", "").strip()
    if override:
        dt = datetime.fromisoformat(override)
        return dt if dt.tzinfo else dt.replace(tzinfo=IST)
    return datetime.now(IST)


def last_complete_day(now: datetime) -> date:
    """Newest calendar day whose session (if it had one) has closed."""
    now = now.astimezone(IST)
    return now.date() if now.time() >= SESSION_FINAL else now.date() - timedelta(days=1)


def baseline_day(published: datetime) -> date:
    """The session whose close the published picks were priced from.

    publish.py stamps each pick's recommended price as the latest close at
    publish time, and the dashboard measures from that price. A book published
    after the close (31 Aug 2026, 20:36) is priced off that day's close; one
    published before it is priced off the previous session's. The public figure
    has to start from the same close or it measures a different cycle from the
    one members see."""
    return last_complete_day(published)


def main() -> None:
    import pandas as pd
    import yfinance as yf

    dry = "--dry-run" in sys.argv          # V39.3 — compute and print, write nothing
    now = now_ist()
    done = pd.Timestamp(last_complete_day(now))   # newest bar allowed to count
    rebal = rebalance_date()
    base = baseline_day(rebal)
    rebal_ts = pd.Timestamp(base)          # baseline = last close on/before this day

    def completed(frame):
        """Drop any bar whose session has not closed yet (see SESSION_FINAL)."""
        return frame.loc[frame.index.normalize() <= done]

    all_syms = sorted({r["yahoo"] for k in STRATS for r in load_picks(*STRATS[k][:2])})
    print(f"live-perf: {len(all_syms)} tickers · rebalance {rebal:%Y-%m-%d %H:%M} · "
          f"baseline close {base} · completed sessions through {done.date()}"
          + (" · DRY RUN" if dry else ""))
    raw = yf.download(all_syms, start=(rebal_ts - pd.Timedelta(days=12)).date(),
                      auto_adjust=True, progress=False)
    close = raw["Close"] if "Close" in getattr(raw.columns, "levels", [raw.columns])[0] else raw
    if isinstance(close, pd.Series):
        close = close.to_frame(all_syms[0])
    if getattr(close.index, "tz", None) is not None:
        close.index = close.index.tz_localize(None)
    close = completed(close)

    # V39.3 — ONE DATE FOR EVERY FIGURE. Yahoo does not publish every
    # instrument's bar at the same moment: on 26 Sep 2026 the stocks had their
    # 25 Sep close while most MultiAsset ETFs still stopped at 24 Sep. Taking
    # each ticker's own last bar then measured the ETFs to the 24th against a
    # Nifty 50 to the 25th, under one "closes through 25 Sept" label. So find
    # the latest completed session on which EVERY strategy has at least 80% of
    # its picks priced (the same coverage rule the figures already use), and
    # measure everything — picks and benchmarks — through that one session.
    picks_by_key = {k: load_picks(*STRATS[k][:2]) for k in STRATS}

    def latest_covered(picks):
        cols = [r["yahoo"] for r in picks if r["yahoo"] in close.columns]
        if not picks or not cols:
            return None
        cov = close[cols].notna().sum(axis=1) / len(picks)
        ok = cov[cov >= 0.8]
        return ok.index[-1] if len(ok) else None

    covered = [d for d in (latest_covered(p) for p in picks_by_key.values()) if d is not None]
    common = min(covered) if covered else None
    if common is not None:
        close = close.loc[:common]
        print(f"  measuring every figure through the {common.date()} close")

    def px(sym, upto=None):
        if sym not in close.columns:
            return None
        s = close[sym].dropna()
        if upto is not None:
            s = s.loc[:upto]
        return float(s.iloc[-1]) if len(s) else None

    strategies, as_of = {}, None
    for key, (folder, suffix, name, curr) in STRATS.items():
        picks = picks_by_key[key]
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
        b_ret, b_ok, legs = 0.0, True, []
        for tkr, wt in bcfg["tickers"].items():
            b = yf.download(tkr, start=(rebal_ts - pd.Timedelta(days=12)).date(),
                            auto_adjust=True, progress=False)["Close"]
            if isinstance(b, pd.DataFrame):
                b = b.iloc[:, 0]
            b = b.dropna()
            if getattr(b.index, "tz", None) is not None:
                b.index = b.index.tz_localize(None)
            b = completed(b)
            if common is not None:
                b = b.loc[:common]
            b0 = b.loc[:rebal_ts]
            if b0.empty or b.empty:
                b_ok = False
                break
            b_ret += wt * (float(b.iloc[-1]) / float(b0.iloc[-1]) - 1.0)
            # V39.3 — publish each leg's baseline level so the member dashboard
            # can price the benchmark at the SAME moment as the member's live
            # figure, instead of subtracting this run's close from a live price.
            legs.append({"t": tkr, "w": wt, "base": round(float(b0.iloc[-1]), 4)})
            as_of = max(as_of or b.index[-1], b.index[-1])
        strategies[key] = {
            "name": name,
            "live_pct": live_pct,
            "bench_pct": round(b_ret * 100, 2) if b_ok else None,
            "bench_name": BENCH_SHORT[key],
            "n": len(picks),
            "currency": curr,
        }
        if b_ok:
            strategies[key]["bench_legs"] = legs
        print(f"  {key}: live {live_pct}%  bench {strategies[key]['bench_pct']}%  ({priced}/{len(picks)} priced)")

    data_through = None
    for sym in all_syms:
        if sym in close.columns and len(close[sym].dropna()):
            d = close[sym].dropna().index[-1]
            data_through = max(data_through or d, d)

    out = {
        "generated_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "rebalance_date": rebal.strftime("%Y-%m-%d"),
        "baseline_date": base.isoformat(),
        "data_through": (max(data_through, as_of) if data_through is not None and as_of is not None
                         else data_through or as_of).strftime("%Y-%m-%d"),
        "basis": ("Weight-weighted model-portfolio movement since the last rebalance; "
                  "closing prices of completed sessions only; baseline = the close the "
                  "published picks were priced from. Model portfolio, not audited client returns."),
        "strategies": strategies,
    }
    # V38.9 — history first, so the cycle count it returns can be published
    # inside live-perf.json. append_history() only reads `out`; it never needed
    # the file on disk, so the reorder is safe and keeps the count derived in
    # exactly one place.
    record = append_history(out, write=not dry)
    if record:
        out["record"] = record
    if dry:
        print(json.dumps(out, ensure_ascii=False, indent=1))
        print("dry run — nothing written")
        return
    OUT.write_text(json.dumps(out, ensure_ascii=False, indent=1) + "\n")
    print(f"wrote {OUT.relative_to(ROOT)}")


def append_history(out: dict, write: bool = True) -> dict | None:
    """Roll this run's figures into docs/live-history.json — the LIVE track record.

    V35.3. Everything the member dashboard could say about performance was about
    the cycle in progress: one number, one benchmark comparison, both wiped by the
    next publish. A member on month seven had no record of months one to six, and
    the most credibility-bearing thing this service owns was invisible on the one
    page members actually open. The figures already existed and were already
    computed on the same basis the dashboard's own headline uses (see the module
    docstring) — they were simply overwritten every run.

    Shape: one entry per rebalance_date, newest last.

    THE CURRENT CYCLE IS PROVISIONAL AND IS REWRITTEN ON EVERY RUN — it is still
    moving. Every earlier entry is SEALED and never touched again: a published
    track record that silently restates itself is worth nothing. A sealed entry's
    figure is therefore the last one measured before the next rebalance published,
    and `data_through` on that entry says exactly which date that was, so the
    window a number describes is always recoverable from the file itself.

    Aggregate only — no tickers, no names, no weights, same rule as live-perf.json.
    Members pay for the picks; the public gets the shape of the result.
    """
    try:
        prev = json.loads(HIST.read_text()) if HIST.exists() else {}
        cycles = prev.get("cycles") or []
        if not isinstance(cycles, list):
            cycles = []
    except Exception as exc:                       # a corrupt file must not stop a publish
        print(f"  !! live-history: could not read existing file ({exc}) — starting fresh")
        cycles = []

    rebal = out["rebalance_date"]
    entry = {
        "rebalance_date": rebal,
        "data_through": out["data_through"],
        "sealed": False,
        "strategies": {
            k: {"live_pct": v["live_pct"], "bench_pct": v["bench_pct"],
                "bench_name": v["bench_name"], "n": v["n"]}
            for k, v in out["strategies"].items()
        },
    }
    # Replace the entry for this rebalance if we have written one before; a run
    # never appends a second row for a cycle it has already recorded.
    cycles = [c for c in cycles if c.get("rebalance_date") != rebal]
    cycles.append(entry)
    cycles.sort(key=lambda c: c.get("rebalance_date") or "")
    # V39.3 — a row is sealed at whatever the LAST run before the new book
    # measured. If that run stopped short of the close the new book is priced
    # from, the sessions in between belong to no cycle, and a sealed row can
    # never be corrected afterwards (the old picks are overwritten by then).
    # This cannot repair it; it makes sure nobody learns about it by accident.
    base = out.get("baseline_date") or ""
    for c in cycles:
        sealing = not c.get("sealed") and (c.get("rebalance_date") or "") < rebal
        if sealing and base and (c.get("data_through") or "") < base:
            print(f"  !! live-history: sealing the {c.get('rebalance_date')} cycle at "
                  f"{c.get('data_through')}, but the new book is priced from the {base} close — "
                  f"the sessions in between are in no cycle. Next time run the stock refresh "
                  f"AFTER the close and BEFORE runner/publish.py.")
    for c in cycles:
        c["sealed"] = (c.get("rebalance_date") or "") < rebal
    cycles = cycles[-HIST_MAX:]

    if not write:
        sealed = sum(1 for c in cycles if c.get("sealed"))
        return {"count": len(cycles), "sealed": sealed,
                "first_rebalance": (cycles[0].get("rebalance_date") if cycles else None)}

    HIST.write_text(json.dumps({
        "generated_utc": out["generated_utc"],
        "basis": ("One entry per monthly rebalance. Each figure is the weight-weighted "
                  "movement of the model portfolio over that cycle, against the same real "
                  "index, on the same basis as live-perf.json. The newest entry is the "
                  "cycle in progress and still moves; every earlier entry is final and is "
                  "never rewritten. Model portfolio, not audited client returns."),
        "cycles": cycles,
    }, ensure_ascii=False, indent=1) + "\n")
    sealed = sum(1 for c in cycles if c.get("sealed"))
    print(f"wrote {HIST.relative_to(ROOT)} — {len(cycles)} cycle(s), {sealed} sealed")
    # V38.9 — hand the counts back so live-perf.json can publish HOW YOUNG the
    # live record is beside the figure itself. Every surface that prints a live
    # cycle % was printing it without a sample size, and the first number a
    # first-time reader meets on this site is that one. "−0.04% this cycle"
    # reads as performance; "−0.04% this cycle · live record: 1 cycle" reads as
    # what it actually is. The count has to travel WITH the number, and it has
    # to be derived here, where the history is, or it goes stale the first month
    # nobody remembers to edit the HTML.
    return {
        "count": len(cycles),
        "sealed": sealed,
        "first_rebalance": (cycles[0].get("rebalance_date") if cycles else None),
    }


if __name__ == "__main__":
    main()
