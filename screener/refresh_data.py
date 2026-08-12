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
    python3 refresh_data.py            # full universe (~35-60 min)
    python3 refresh_data.py 100        # first N symbols only (smoke test)
"""
import sys, time

import server            # Flask app object is created but never run
import export_static


def main() -> int:
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
        except Exception:
            err += 1
        if n % 50 == 0 or n == total:
            el = time.time() - t0
            rate = n / el if el else 0
            eta = (total - n) / rate if rate else 0
            print(f"[{n}/{total}] ok={ok} err={err} "
                  f"elapsed={el/60:.1f}m eta={eta/60:.1f}m", flush=True)
        time.sleep(0.3)   # same pacing as the Flask bulk fetch

    print(f"\nFetch done: {ok} ok, {err} failed of {total}.")
    print("Exporting stocks.json ...")
    return export_static.main()


if __name__ == "__main__":
    raise SystemExit(main())
