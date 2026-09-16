#!/usr/bin/env python3
"""
refresh_data.py
===============
Headless full-universe data refresh for the static screener.

Re-fetches every NSE symbol from Yahoo Finance into screener.db using the
same fetch_stock_info() the Flask app uses (1-hour cache TTL means stale
rows are re-pulled live), then re-exports docs/screener/stocks.json via
export_static.py.

Failed fetches are NOT cached, so the previous good snapshot for a symbol
survives a flaky run.

Usage
-----
    python3 refresh_data.py            # full universe (~80-95 min)
    python3 refresh_data.py 100        # first N symbols only (smoke test)
"""
import csv, io, sys, time

import requests

import server            # Flask app object is created but never run
import export_static

NSE_ARCHIVE = "https://archives.nseindia.com/content/equities/"
NSE_HEADERS = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
                             "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36"}


def check_nse_renames(universe) -> None:
    """Name every universe symbol NSE has renamed. Warns only; never blocks."""
    try:
        listed_csv = requests.get(NSE_ARCHIVE + "EQUITY_L.csv", headers=NSE_HEADERS, timeout=20)
        change_csv = requests.get(NSE_ARCHIVE + "symbolchange.csv", headers=NSE_HEADERS, timeout=20)
        listed_csv.raise_for_status(); change_csv.raise_for_status()
        listed = {r[0].strip() for r in csv.reader(io.StringIO(listed_csv.text)) if r}
        renames = {}
        for r in csv.reader(io.StringIO(change_csv.content.decode("latin-1"))):
            if len(r) >= 4:
                old, new, when = (x.strip() for x in r[-3:])
                renames[old] = (new, when)
    except Exception as e:
        print(f"  (NSE symbol-change check skipped: {e})")
        return
    if len(listed) < 1000:
        print(f"  (NSE symbol-change check skipped: EQUITY_L.csv had only {len(listed)} rows)")
        return
    found = 0
    for sym in universe:
        if sym in listed or sym not in renames:
            continue
        new, when = renames[sym]
        for _ in range(5):                      # follow A -> B -> C chains
            if new in listed or new not in renames:
                break
            new, when = renames[new]
        if new in listed:
            found += 1
            print(f"  ⚠ NSE renamed {sym} -> {new} on {when}: Yahoo's {sym}.NS price is "
                  f"frozen. Replace it in NSE_EQUITY_UNIVERSE (screener/server.py).")
    if not found:
        print("  NSE symbol-change check: no universe symbol has been renamed.")


def main() -> int:
    # V29.7 — CREATE THE SCHEMA FIRST. server.py calls init_db() only under its
    # `if __name__ == "__main__"` guard, so importing it (as this script does)
    # never creates a table. On this Mac that has never mattered: screener.db has
    # existed since the Flask app was first run directly, so every refresh found
    # the schema already there. On a machine with NO database — a GitHub Actions
    # runner with a cold actions/cache, which is exactly how the V29.7 workflow
    # starts — the fetch loop writes nothing it can write, and export_static.main()
    # dies on `sqlite3.OperationalError: no such table: stock_cache`. Reproduced
    # from a bare clone before the workflow was trusted.
    # init_db() is idempotent (CREATE TABLE IF NOT EXISTS), so this is a no-op on
    # every machine that already has the file.
    server.init_db()

    symbols = server.NIFTY_UNIVERSE
    if len(sys.argv) > 1:
        symbols = symbols[: int(sys.argv[1])]

    total, ok, err = len(symbols), 0, 0
    t0 = time.time()
    for n, sym in enumerate(symbols, 1):
        try:
            d = server.fetch_stock_info(sym)
            if d and "error" not in d:
                ok += 1
            else:
                err += 1
                if err <= 20:
                    print(f"  ! {sym}: {(d or {}).get('error', 'no data')}", flush=True)
        except Exception as e:
            err += 1
            if err <= 20:
                print(f"  ! {sym}: {e}", flush=True)
        if n % 50 == 0 or n == total:
            el = time.time() - t0
            rate = n / el if el else 0
            eta = (total - n) / rate if rate else 0
            print(f"[{n}/{total}] ok={ok} err={err} "
                  f"elapsed={el/60:.1f}m eta={eta/60:.1f}m", flush=True)
        time.sleep(0.3)   # same pacing as the Flask bulk fetch

    print(f"\nFetch done: {ok} ok, {err} failed of {total}.")
    check_nse_renames(symbols)

    # V29.7 — say plainly when the run fetched nothing. Yahoo answers HTTP 429
    # once an IP has been hammered (this Mac hits it after back-to-back runs), and
    # fetch_stock_info() swallows that into {'error': …}, so a fully rate-limited
    # run looks identical to a successful one right up until the export is empty.
    # Nothing is aborted here on purpose: export_static.main() still writes what
    # the cache holds, which on a warm machine is the previous good snapshot. The
    # workflow's own row-count gate is what refuses to PUBLISH a truncated file.
    if total and ok == 0:
        print(f"!! every fetch failed ({err}/{total}) — likely a Yahoo rate limit (HTTP 429). "
              f"Exporting from cache only; nothing new was pulled.", flush=True)

    print("Exporting stocks.json ...")
    return export_static.main()


if __name__ == "__main__":
    raise SystemExit(main())
