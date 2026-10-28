#!/usr/bin/env python3
"""
screener/holdings_curve.py  (V43.3 — A2, "How many holdings is enough?")
=======================================================================
One small PUBLIC data file for /learn/how-many-holdings/ and /map/:

    docs/learn/holdings-curve.json   how the typical yearly swing of an equal-weight
                                     portfolio falls as stocks are added, 1 to 60

Universe: the symbols in docs/screener/closes-lm.json (today's Nifty LargeMidcap 250
universe as the site already publishes it), keeping only those with a full price
history over the window. That is survivorship by construction — every company in it
is still listed today — and the page says so.

Prices: Yahoo daily closes ADJUSTED for splits and bonuses (auto_adjust). NSE's
bhavcopy is not adjusted, and a split would read as a -50% day.

Index: Nifty 100 and Nifty Midcap 150 at 50:50, rebalanced daily, the way the site
rebuilds LargeMidcap 250's index; the tickers are market_data.py's public INDICES map.
Nothing here reads IP/.

Method: for each size N, DRAWS seeded random portfolios of N stocks, equal weight at
the start of every month and left to drift inside it. For each: the annualised
volatility (std of daily returns x sqrt(252)) and the deepest fall of its path; the
file keeps the 10th, 50th and 90th percentile of both. "all" is every stock in the
universe at equal weight. n80 is the smallest N whose median volatility has done 80%
of the fall from one stock to all of them.

No ticker, company or weight appears in the output.

    python3 screener/holdings_curve.py            # build, write the JSON, rewrite the pages' figures
    python3 screener/holdings_curve.py --dry      # build, print a summary, write nothing
    python3 screener/holdings_curve.py --inject   # only rewrite the pages' figures from the JSON

Run by hand (a year of prices barely moves the curve); it is not in the daily refresh.
"""
import json, math, os, sys
from datetime import date, datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCS = os.path.join(ROOT, 'docs')
OUT  = os.path.join(DOCS, 'learn', 'holdings-curve.json')
DRY  = '--dry' in sys.argv

START = '2019-01-14'          # the first session of the Nifty Midcap 150 series
SIZES = [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 35, 40, 45, 50, 60]
DRAWS = 5000
SEED  = 43
JUMP  = 0.40                  # a daily move this large in a large/mid cap is a data error
IDX   = (('^CNX100', 'Nifty 100'), ('NIFTYMIDCAP150.NS', 'Nifty Midcap 150'))


def log(*a):
    print(*a, flush=True)


def last_month_end(d):
    first = d.replace(day=1)
    return date.fromordinal(first.toordinal() - 1)


def main():
    if '--inject' in sys.argv:            # rewrite the pages' printed figures from the JSON as it stands
        inject(json.load(open(OUT, encoding='utf-8')))
        return
    import numpy as np
    import pandas as pd
    import yfinance as yf

    lm = json.load(open(os.path.join(DOCS, 'screener', 'closes-lm.json'), encoding='utf-8'))
    syms = sorted(lm['rows'].keys())
    end = last_month_end(date.today())
    log(f'universe: {len(syms)} symbols; window {START} -> {end}')

    tick = [s + '.NS' for s in syms]
    want = tick + [t for t, _ in IDX]
    px = yf.download(want, start=START, end=date.fromordinal(end.toordinal() + 1).isoformat(),
                     interval='1d', auto_adjust=True, progress=False, threads=True, group_by='column')
    close = px['Close'] if isinstance(px.columns, pd.MultiIndex) else px
    close = close.sort_index()
    close.index = pd.to_datetime(close.index).tz_localize(None)

    # the index: two legs, 50:50, rebalanced daily
    legs = []
    for t, _ in IDX:
        s = close[t].dropna()
        legs.append(s)
    li = pd.concat(legs, axis=1).dropna()
    lr = li.pct_change().dropna()
    idx_r = lr.mean(axis=1)
    sessions = idx_r.index

    st = close[tick].reindex(li.index)
    full = [c for c in tick if st[c].notna().all() and (st[c] > 0).all()]
    st = st[full]
    r = st.pct_change().iloc[1:]
    jumpy = [c for c in full if (r[c].abs() > JUMP).any()]
    keep = [c for c in full if c not in jumpy]
    st = st[keep]
    log(f'full history: {len(full)}; dropped for a >{int(JUMP*100)}% day (data errors): {len(jumpy)}; kept {len(keep)}')
    if len(keep) < 120:
        raise SystemExit(f'only {len(keep)} names with full history — refusing to publish a thin curve')

    P = st.to_numpy(dtype=float)                       # T x S prices, row 0 = the first session
    T, S = P.shape
    months = pd.Index(st.index).to_period('M')
    # growth since the previous month's last close, per stock, for every session after row 0
    G = np.empty((T - 1, S))
    base = P[0].copy()
    prev_m = months[0]
    for t in range(1, T):
        if months[t] != prev_m:
            base = P[t - 1].copy()
            prev_m = months[t]
        G[t - 1] = P[t] / base
    starts = np.zeros(T - 1, dtype=bool)
    for t in range(1, T):
        starts[t - 1] = (t == 1) or (months[t] != months[t - 1])

    def stats_of(V):
        """V: (T-1) x D growth inside each month -> (vol, mdd) per column."""
        prev = np.vstack([np.ones((1, V.shape[1])), V[:-1]])
        prev[starts] = 1.0
        ret = V / prev - 1.0
        vol = ret.std(axis=0, ddof=1) * math.sqrt(252) * 100
        path = np.cumprod(1.0 + ret, axis=0)
        peak = np.maximum.accumulate(path, axis=0)
        mdd = ((path / peak) - 1.0).min(axis=0) * 100
        return vol, mdd

    rng = np.random.default_rng(SEED)
    out = {'p10': [], 'p50': [], 'p90': []}
    dd = {'p10': [], 'p50': [], 'p90': []}
    for n in SIZES:
        W = np.zeros((S, DRAWS))
        for d in range(DRAWS):
            W[rng.choice(S, size=n, replace=False), d] = 1.0 / n
        vol, mdd = stats_of(G @ W)
        for q, k in ((10, 'p10'), (50, 'p50'), (90, 'p90')):
            out[k].append(round(float(np.percentile(vol, q)), 1))
            dd[k].append(round(float(np.percentile(mdd, q)), 1))
        log(f'  N={n:>2}: vol p50 {out["p50"][-1]:5.1f}%  (p10 {out["p10"][-1]:5.1f}, p90 {out["p90"][-1]:5.1f})'
            f'  deepest fall p50 {dd["p50"][-1]:6.1f}%')

    all_vol, all_mdd = stats_of(G @ np.full((S, 1), 1.0 / S))
    iv = float(idx_r.loc[st.index[1:]].std(ddof=1) * math.sqrt(252) * 100)
    ip = (1 + idx_r.loc[st.index[1:]]).cumprod()
    idd = (ip / ip.cummax()) - 1
    imdd = float(idd.min() * 100)
    trough = idd.idxmin()
    peak = ip.loc[:trough].idxmax()

    v1, vall = out['p50'][0], float(all_vol[0])
    red = [round((v1 - v) / (v1 - vall) * 100, 0) if v1 > vall else 0 for v in out['p50']]
    n80 = next((n for n, x in zip(SIZES, red) if x >= 80), SIZES[-1])

    # sanity: the median must never rise as names are added
    rises = [(SIZES[i], SIZES[i + 1]) for i in range(len(SIZES) - 1) if out['p50'][i + 1] > out['p50'][i] + 0.05]
    if rises:
        raise SystemExit(f'median volatility rose between sizes {rises} — refusing to publish')
    if not (15 <= v1 <= 80):
        raise SystemExit(f'one-stock median volatility {v1}% is implausible — refusing to publish')

    first, last = st.index[0].date(), st.index[-1].date()
    years = round((last - first).days / 365.25, 1)
    doc = {
        'generated_utc': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'source': 'Yahoo Finance daily closes, adjusted for splits and bonuses',
        'window': {'start': first.isoformat(), 'end': last.isoformat(), 'sessions': int(T), 'years': years},
        'universe': {'name': 'Nifty LargeMidcap 250', 'listed_today': len(syms), 'n_names': len(keep)},
        'method': 'Equal weight at the start of each month, left to drift inside it; '
                  'volatility = standard deviation of daily returns x sqrt(252)',
        'draws': DRAWS, 'seed': SEED,
        'sizes': SIZES,
        'vol': out, 'mdd': dd,
        'all': {'vol': round(float(all_vol[0]), 1), 'mdd': round(float(all_mdd[0]), 1)},
        'index': {'name': 'Nifty 100 and Nifty Midcap 150, 50:50', 'vol': round(iv, 1), 'mdd': round(imdd, 1),
                  'mdd_peak': peak.date().isoformat(), 'mdd_trough': trough.date().isoformat()},
        'reduction_pct': red,
        'n80': n80,
        'note': 'Survivorship: only companies listed today, with a full price history over the window. '
                'Volatility is one kind of risk, not the chance of a loss. Not a forecast.',
    }
    log(f'all {S} names: vol {doc["all"]["vol"]}%, deepest fall {doc["all"]["mdd"]}%; '
        f'index vol {doc["index"]["vol"]}%, deepest fall {doc["index"]["mdd"]}%; n80 = {n80}')
    if DRY:
        log('--dry: nothing written')
        return
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    tmp = OUT + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(doc, f, ensure_ascii=False, separators=(',', ':'))
        f.write('\n')
    os.replace(tmp, OUT)
    log(f'wrote {os.path.relpath(OUT, ROOT)} ({os.path.getsize(OUT):,} bytes)')
    inject(doc)


# ── the page's printed figures ──────────────────────────────────────────────
# The pages print these numbers as text (for readers without script, and for
# search) inside <!--MFHC:key-->…<!--/MFHC--> markers. They are rewritten here,
# from the same doc the JSON holds, so the prose can never drift from the chart.
PAGES = [os.path.join(DOCS, 'learn', 'how-many-holdings', 'index.html'),
         os.path.join(DOCS, 'map', 'index.html')]
MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']


def _pct(x):
    return ('−' if x < 0 else '') + f'{abs(x):.1f}%'


def _my(iso):
    y, m = iso[:4], int(iso[5:7])
    return f'{MONTHS[m - 1]}&nbsp;{y}'      # the pages write &nbsp; as an entity


def markers(doc):
    at = dict(zip(doc['sizes'], range(len(doc['sizes']))))
    v, d = doc['vol']['p50'], doc['mdd']['p50']
    return {
        'years': f'{doc["window"]["years"]:.1f}'.rstrip('0').rstrip('.'),
        'start': _my(doc['window']['start']), 'end': _my(doc['window']['end']),
        'n_names': str(doc['universe']['n_names']), 'draws': f'{doc["draws"]:,}',
        'v1': _pct(v[at[1]]), 'v15': _pct(v[at[15]]), 'v30': _pct(v[at[30]]), 'v50': _pct(v[at[50]]),
        'vall': _pct(doc['all']['vol']), 'vidx': _pct(doc['index']['vol']),
        'mdd1': _pct(d[at[1]]), 'mdd15': _pct(d[at[15]]), 'mdd30': _pct(d[at[30]]), 'mdd50': _pct(d[at[50]]),
        'mddall': _pct(doc['all']['mdd']),
        'mddidx': _pct(doc['index']['mdd']), 'trough': _my(doc['index']['mdd_trough']),
        'n80': str(doc['n80']),
    }


def inject(doc):
    import re
    vals = markers(doc)
    pat = re.compile(r'<!--MFHC:([a-z0-9_]+)-->(.*?)<!--/MFHC-->', re.S)
    for p in PAGES:
        if not os.path.exists(p):
            continue
        s = open(p, encoding='utf-8').read()
        unknown = sorted({m.group(1) for m in pat.finditer(s)} - set(vals))
        if unknown:
            raise SystemExit(f'{os.path.relpath(p, ROOT)}: unknown MFHC markers {unknown}')
        n = 0

        def sub(m):
            nonlocal n
            n += 1
            return f'<!--MFHC:{m.group(1)}-->{vals[m.group(1)]}<!--/MFHC-->'
        t = pat.sub(sub, s)
        if t != s:
            with open(p + '.tmp', 'w', encoding='utf-8') as f:
                f.write(t)
            os.replace(p + '.tmp', p)
        log(f'{os.path.relpath(p, ROOT)}: {n} MFHC markers {"rewritten" if t != s else "already current"}')


if __name__ == '__main__':
    main()
