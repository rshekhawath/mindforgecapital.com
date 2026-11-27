#!/usr/bin/env python3
"""
screener/index_nifty50.py  (V43.3 — C2, "Your SIP against the index")
====================================================================
One small PUBLIC data file for /calculators/sip-vs-index.html:

    docs/screener/index-nifty50.json   the Nifty 50 TOTAL RETURN INDEX's daily closes
                                       from 17 Sept 2007 (where the old Yahoo series began)

The calculator buys the reader's own SIP instalments into the index on the same
dates and compares the two XIRRs. v1.0.7 (27 Nov 2026): the series is NSE Indices'
official Nifty 50 TRI (dividends reinvested), the fairer side of that comparison,
read from niftyindices.com's historical-data service a year at a time (the most it
serves per request). Until then it was Yahoo's PRICE index, which left dividends out.

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
TRI_PAGE = 'https://www.niftyindices.com/reports/historical-data'
TRI_URL  = 'https://www.niftyindices.com/BackPage/getTotalReturnIndexString'
TRI_NAME = 'NIFTY 50'
START    = date(2007, 9, 17)
UA = ('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Chrome/120 Safari/537.36')


def fetch_tri(start, end):
    """{date: TRI close} from niftyindices.com, at most 364 days a request."""
    import time
    from datetime import timedelta
    import requests                                    # urllib has no CA bundle on this Mac
    s = requests.Session()
    s.get(TRI_PAGE, headers={'User-Agent': UA}, timeout=30)
    hdr = {'User-Agent': UA, 'Content-Type': 'application/json; charset=utf-8',
           'Accept': 'application/json, text/javascript, */*; q=0.01',
           'X-Requested-With': 'XMLHttpRequest', 'Origin': 'https://www.niftyindices.com',
           'Referer': TRI_PAGE}
    out, a = {}, start
    while a <= end:
        b = min(a + timedelta(days=364), end)
        cinfo = ("{'name':'%s','startDate':'%s','endDate':'%s','indexName':'%s'}"
                 % (TRI_NAME, a.strftime('%d-%b-%Y'), b.strftime('%d-%b-%Y'), TRI_NAME))
        rows = None
        for attempt in range(4):
            try:
                r = s.post(TRI_URL, headers=hdr, data=json.dumps({'cinfo': cinfo}), timeout=60)
                r.raise_for_status()
                rows = json.loads(r.text)
                if isinstance(rows, dict) and 'd' in rows:
                    rows = json.loads(rows['d'])
                if not isinstance(rows, list):
                    raise ValueError('unexpected reply')
                break
            except Exception:                          # noqa: BLE001 — retried, then fatal below
                rows = None
                time.sleep(2.0 * (attempt + 1))
        if rows is None:
            raise SystemExit(f'niftyindices.com gave no TRI for {a}..{b} — keeping the previous file')
        for row in rows:
            if str(row.get('Index Name', '')).strip().upper() != TRI_NAME:
                raise SystemExit(f'unexpected index in reply: {row.get("Index Name")!r}')
            d = datetime.strptime(str(row['Date']).strip(), '%d %b %Y').date()
            out[d] = float(str(row['TotalReturnsIndex']).replace(',', ''))
        a = b + timedelta(days=1)
        time.sleep(0.6)
    return out


def main():
    import pandas as pd
    tri = fetch_tri(START, date.today())
    if not tri:
        raise SystemExit('no TRI data — keeping the previous file')
    c = pd.Series(tri, dtype='float64').sort_index()
    c.index = pd.to_datetime(c.index)
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
        'source': 'NSE Indices (niftyindices.com), Nifty 50 Total Return Index daily closes',
        'basis': 'Nifty 50 Total Return Index: dividends reinvested',
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
