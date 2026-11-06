#!/usr/bin/env python3
"""
screener/beta_monthly.py  (V44.6)
=================================
Our own beta for every listing: how much the stock has tended to move for each 1%
move in the Nifty 50.

Yahoo's `beta` stopped being usable in two ways. It is not measured against the
Indian market (median 0.40 where the same stocks measure 1.17 against the Nifty 50),
which put "Lower volatility than the market" on 87% of company pages. And Yahoo has
been removing it listing by listing since late October 2026. So every row now has one
basis, and Yahoo's field is not read at all.

The basis:
    index    Nifty 50 price index (^NSEI)
    returns  simple monthly returns of month-end adjusted closes
    window   the 60 complete calendar months ending last month, never the part-month
    minimum  36 months, else no figure: under that the margin of error is wider than
             the difference the figure is meant to show
    one-offs a month beyond +100% or -50% is left out. A jump of 1,700% or a demerger read
             as a 70% fall says nothing about how a stock responds to the market, and
             in a slope one such month can move the figure from 1 to 4
    method   ordinary least-squares slope. Beyond +/-5 is a data error, so no figure

Writes docs/screener/beta.json, which export_static.py reads:
    {"generated_utc", "computed_on", "window_start", "window_end", "basis",
     "rows": {"SYM": [beta or null, months]  or  [beta, months, "day it was computed"]}}
The third item marks a carried figure: when a stock's own fetch fails, it keeps its
last figure for up to CARRY_DAYS, and then shows none.

Runs at the start of commands/refresh-stocks.command. It does the whole universe only
in the first refresh of a month (about 2,100 requests and 15 minutes), and otherwise
only a symbol it has never seen (a new listing or a rename), so a normal day costs
nothing. NON-FATAL: on any failure the previous file stands. If too many fetches fail
it writes nothing, because that is Yahoo refusing us, not a fact about the stocks.

    python3 screener/beta_monthly.py          # as above
    python3 screener/beta_monthly.py --force  # the whole universe, now
    python3 screener/beta_monthly.py --dry    # work it out, print a summary, write nothing
"""
import json, logging, os, sys, time, warnings
from datetime import date, datetime, timezone

warnings.filterwarnings('ignore')
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, 'docs', 'screener', 'beta.json')
sys.path.insert(0, HERE)

WINDOW = 60              # complete months
MIN_MONTHS = 36
SANE = 5.0               # beyond this it is a data error, not a beta
CARRY_DAYS = 60
PAUSE = 0.3              # the same pacing as the daily fetch
MAX_FAIL_SHARE = 0.25    # more than this failing is a refusal from Yahoo
ODD_UP, ODD_DOWN = 1.0, -0.5   # a month beyond these is a one-off, not a response to the market


def month_add(y, m, n):
    t = y * 12 + (m - 1) + n
    return t // 12, t % 12 + 1


def window(today=None):
    """(first return month, last return month, first bar needed), each 'YYYY-MM'."""
    today = today or date.today()
    ly, lm = month_add(today.year, today.month, -1)
    fy, fm = month_add(ly, lm, -(WINDOW - 1))
    by, bm = month_add(fy, fm, -1)
    return f'{fy}-{fm:02d}', f'{ly}-{lm:02d}', f'{by}-{bm:02d}-01'


def monthly_closes(ticker, start, last_month):
    """{'YYYY-MM': month-end adjusted close}. The part-month is left out."""
    import yfinance as yf
    h = yf.Ticker(ticker).history(start=start, interval='1mo', auto_adjust=True)
    out = {}
    if h is None or h.empty:
        return out
    for ts, v in h['Close'].dropna().items():
        k = ts.strftime('%Y-%m')
        if k <= last_month and float(v) > 0:
            out[k] = float(v)
    return out


def returns(closes):
    """{'YYYY-MM': return}, only where the month before it has a close too."""
    out = {}
    for k in sorted(closes):
        y, m = int(k[:4]), int(k[5:])
        py, pm = month_add(y, m, -1)
        p = closes.get(f'{py}-{pm:02d}')
        if p:
            out[k] = closes[k] / p - 1.0
    return out


def slope(pairs):
    """Ordinary least-squares slope of y on x."""
    n = len(pairs)
    mx = sum(x for x, _ in pairs) / n
    my = sum(y for _, y in pairs) / n
    sxx = sum((x - mx) ** 2 for x, _ in pairs)
    sxy = sum((x - mx) * (y - my) for x, y in pairs)
    return sxy / sxx if sxx > 0 else None


def beta_of(stock_ret, index_ret, first, last):
    """(beta or None, months of history in the window). One-off months count as history
    but not in the slope, and the slope needs MIN_MONTHS without them."""
    pairs = [(index_ret[k], r) for k, r in stock_ret.items() if first <= k <= last and k in index_ret]
    n = len(pairs)
    used = [(x, y) for x, y in pairs if ODD_DOWN <= y <= ODD_UP]
    if len(used) < MIN_MONTHS:
        return None, n
    b = slope(used)
    if b is None or abs(b) > SANE:
        return None, n
    return round(b, 2), n


def carried(prev_row, prev_on, today):
    """The row to keep when a stock's own fetch failed, or None."""
    if not prev_row or prev_row[0] is None:
        return None
    on = prev_row[2] if len(prev_row) > 2 else prev_on
    try:
        age = (today - date.fromisoformat(on)).days
    except (TypeError, ValueError):
        return None
    return [prev_row[0], prev_row[1], on] if age <= CARRY_DAYS else None


def main():
    logging.getLogger('yfinance').setLevel(logging.CRITICAL)
    from server import NIFTY_UNIVERSE, get_yf_symbol

    force, dry = '--force' in sys.argv, '--dry' in sys.argv
    today = date.today()
    first, last, start = window(today)
    prev = {}
    try:
        with open(OUT, encoding='utf-8') as f:
            prev = json.load(f)
    except (OSError, ValueError):
        pass
    prev_rows = prev.get('rows') or {}
    prev_on = prev.get('computed_on')
    fresh_month = force or prev.get('window_end') != last
    universe = list(dict.fromkeys(NIFTY_UNIVERSE))
    todo = universe if fresh_month else [s for s in universe if s not in prev_rows]
    if not todo:
        print(f'beta: current to {last}, nothing to do')
        return 0

    idx = returns(monthly_closes('^NSEI', start, last))
    have = [k for k in idx if first <= k <= last]
    if len(have) < WINDOW - 1 or last not in idx:
        raise SystemExit(f'only {len(have)} index months to {last}: keeping the previous file')

    rows = {} if fresh_month else {s: prev_rows[s] for s in universe if s in prev_rows}
    t0, failed, odd, streak = time.time(), [], 0, 0
    print(f'beta: {len(todo)} symbols, {first} to {last}', flush=True)
    for n, sym in enumerate(todo, 1):
        try:
            closes = monthly_closes(get_yf_symbol(sym), start, last)
        except Exception:
            closes = {}
        if not closes:
            streak += 1
            failed.append(sym)
            row = carried(prev_rows.get(sym), prev_on, today)
            rows[sym] = row if row else [None, 0]
        else:
            streak = 0
            ret = returns(closes)
            b, months = beta_of(ret, idx, first, last)
            rows[sym] = [b, months]
            odd += any(first <= k <= last and (r > ODD_UP or r < ODD_DOWN) for k, r in ret.items())
        if streak >= 40:
            raise SystemExit(f'40 failures in a row at {sym}: Yahoo is refusing us, keeping the previous file')
        if n % 200 == 0 or n == len(todo):
            print(f'[{n}/{len(todo)}] failed={len(failed)} elapsed={(time.time()-t0)/60:.1f}m', flush=True)
        time.sleep(PAUSE)

    if len(todo) > 50 and len(failed) / len(todo) > MAX_FAIL_SHARE:
        raise SystemExit(f'{len(failed)} of {len(todo)} fetches failed: keeping the previous file')

    vals = sorted(r[0] for r in rows.values() if r[0] is not None)
    n_car = sum(1 for r in rows.values() if len(r) > 2)
    print(f'beta: {len(vals)} of {len(rows)} have a figure, {n_car} carried, median '
          f'{vals[len(vals)//2] if vals else "-"}, {odd} with a one-off month left out, {len(failed)} fetches failed')
    doc = {
        'generated_utc': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'computed_on': today.isoformat() if fresh_month else (prev_on or today.isoformat()),
        'window_start': first,
        'window_end': last,
        'basis': f'Slope of simple monthly returns of month-end adjusted closes on the Nifty 50 price index, '
                 f'over the {WINDOW} complete months to {last}, with at least {MIN_MONTHS}. Months beyond +100% or '
                 f'-50% are left out as one-offs. Our own calculation.',
        'rows': rows,
    }
    if dry:
        print('--dry: nothing written')
        return 0
    tmp = OUT + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(doc, f, separators=(',', ':'), ensure_ascii=False, allow_nan=False)
        f.write('\n')
    os.replace(tmp, OUT)
    print(f'wrote {os.path.relpath(OUT, ROOT)} ({os.path.getsize(OUT):,} bytes)')
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
