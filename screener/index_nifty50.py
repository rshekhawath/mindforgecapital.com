#!/usr/bin/env python3
"""
screener/index_nifty50.py  (V43.3 — C2, "Your SIP against the index")
====================================================================
One small PUBLIC data file for /calculators/sip-vs-index.html:

    docs/screener/index-nifty50.json   the Nifty 50's daily closes since Yahoo's
                                       series begins (Sept 2007)

The calculator buys the reader's own SIP instalments into the index on the same
dates and compares the two XIRRs. NSE's total-return series (dividends reinvested) is
the fairer side of that comparison, but niftyindices.com refuses scripted requests,
so this is the PRICE index: dividends are left out, and the page says the index side
is understated because of it.

Shape, kept compact (about 4,700 sessions):
    {"generated_utc", "source", "basis", "d0": first date, "off": [days after d0],
     "c": [close, 2 dp], "as_of": last date}

Run by commands/refresh-stocks.command after market_data.py. NON-FATAL: on any
error nothing is written and the previous file stands.

    python3 screener/index_nifty50.py          # build and write
    python3 screener/index_nifty50.py --dry    # build, print a summary, write nothing
"""
import json, os, sys
from datetime import date, datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT  = os.path.join(ROOT, 'docs', 'screener', 'index-nifty50.json')
DRY  = '--dry' in sys.argv
TICK = '^NSEI'


def main():
    import pandas as pd
    import yfinance as yf

    h = yf.download(TICK, start='2007-01-01', interval='1d', auto_adjust=False, progress=False, threads=False)
    if h is None or h.empty:
        raise SystemExit('no data from Yahoo — keeping the previous file')
    c = h['Close']
    if isinstance(c, pd.DataFrame):
        c = c.iloc[:, 0]
    c = c.dropna()
    c.index = pd.to_datetime(c.index).tz_localize(None)
    c = c[c > 0]
    if len(c) < 4000:
        raise SystemExit(f'only {len(c)} sessions — refusing to publish a short series')
    d0 = c.index[0].date()
    off = [(d.date() - d0).days for d in c.index]
    if any(b <= a for a, b in zip(off, off[1:])):
        raise SystemExit('dates are not strictly increasing — refusing to publish')
    # a one-day move beyond 20% in the Nifty 50 is a data error, not a session
    r = c.pct_change().abs().dropna()
    if (r > 0.20).any():
        raise SystemExit(f'implausible daily move on {r[r > 0.20].index[0].date()} — refusing to publish')
    doc = {
        'generated_utc': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'source': 'Yahoo Finance, ^NSEI daily closes',
        'basis': 'Nifty 50 price index: dividends are not included',
        'd0': d0.isoformat(),
        'off': off,
        'c': [round(float(x), 2) for x in c.tolist()],
        'as_of': c.index[-1].date().isoformat(),
    }
    print(f'{len(off)} sessions, {doc["d0"]} -> {doc["as_of"]}, last close {doc["c"][-1]}')
    if DRY:
        print('--dry: nothing written')
        return
    tmp = OUT + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(doc, f, ensure_ascii=False, separators=(',', ':'))
        f.write('\n')
    os.replace(tmp, OUT)
    print(f'wrote {os.path.relpath(OUT, ROOT)} ({os.path.getsize(OUT):,} bytes)')


if __name__ == '__main__':
    main()
