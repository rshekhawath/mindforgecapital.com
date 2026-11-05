#!/usr/bin/env python3
"""
screener/lump_sum_study.py  (V44.4, "A lump sum: all at once, or in parts?")
===========================================================================
One small PUBLIC data file for /learn/lump-sum/ and /learn/reels/:

    docs/learn/lump-sum.json   all at once against monthly parts, on real indices

Prices: the daily closes cached in runner/cache/index/ (Nifty 50 and Nifty Smallcap 250).
Nothing here reads IP/. They are PRICE indices: no dividends, no costs, no tax. That slightly
understates all at once, which has more of its money invested earlier, and the pages say so.

Method: month-end closes, complete months only. For every start month, two people with the
same money, valued five years after the start: one invests it all that day, the other in 6 or
12 equal monthly parts while the money waiting earns a stated rate (0%, or 6% a year). Also the
first twelve months after any start, every five-year stretch, and the deepest daily fall.

The fund ranges come from runner/peer_window.json (AMFI NAVs, Direct Plan, after tax), the same
measurement strategies.html prints, read here so /learn/reels/ cannot drift from it.

No MindForge figure of any kind appears in the output.

    python3 screener/lump_sum_study.py            # build, write the JSON, rewrite the pages' figures
    python3 screener/lump_sum_study.py --dry      # build, print a summary, write nothing
    python3 screener/lump_sum_study.py --inject   # only rewrite the pages' figures from the JSON

Run by hand (another month of prices barely moves it); it is not in the daily refresh.
"""
import calendar, csv, json, os, re, statistics, sys
from datetime import date, datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCS = os.path.join(ROOT, 'docs')
OUT = os.path.join(DOCS, 'learn', 'lump-sum.json')
CACHE = os.path.join(ROOT, 'runner', 'cache', 'index')
PEERS = os.path.join(ROOT, 'runner', 'peer_window.json')
PAGES = [os.path.join(DOCS, 'learn', 'lump-sum', 'index.html'),
         os.path.join(DOCS, 'learn', 'reels', 'index.html')]
DRY = '--dry' in sys.argv

SERIES = (('n50', 'NSEI.csv', 'Nifty 50'), ('sc', 'NIFTYSMLCAP250_NS.csv', 'Nifty Smallcap 250'))
HORIZON = 60           # months: five years
RATES = (0.0, 0.06)    # what the money waiting to go in earns, a year, before tax
PARTS = (6, 12)
MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']


def log(*a):
    print(*a, flush=True)


def read_closes(name):
    rows = []
    with open(os.path.join(CACHE, name), newline='', encoding='utf-8') as f:
        for r in csv.DictReader(f):
            try:
                d, c = date.fromisoformat(r['date'][:10]), float(r['close'])
            except (KeyError, TypeError, ValueError):
                continue
            if c > 0:
                rows.append((d, c))
    rows.sort()
    return rows


def month_ends(rows):
    """The last close of each calendar month, dropping a final month the file has not finished."""
    last = {}
    for d, c in rows:
        last[(d.year, d.month)] = (d, c)
    keys = sorted(last)
    end = rows[-1][0]
    if calendar.monthrange(end.year, end.month)[1] - end.day > 3:
        keys = keys[:-1]
    return [last[k] for k in keys]


def study(rows):
    me = month_ends(rows)
    p = [c for _, c in me]
    n_starts = len(p) - HORIZON
    out = {'first': rows[0][0].isoformat(), 'last_month_end': me[-1][0].isoformat(), 'starts': n_starts, 'parts': {}}
    for tr in PARTS:
        for rate in RATES:
            lump, parts, fell = [], [], []
            for i in range(n_starts):
                lump.append(p[i + HORIZON] / p[i])
                parts.append(sum((1 / tr) * (1 + rate) ** (k / 12) * p[i + HORIZON] / p[i + k] for k in range(tr)))
                fell.append(p[i + tr] < p[i])
            won_when_fell = [parts[i] > lump[i] for i in range(n_starts) if fell[i]]
            out['parts'][f'{tr}_{round(rate * 100)}'] = {
                'lump_ahead_pct': 100 * sum(a > b for a, b in zip(lump, parts)) / n_starts,
                'median_gap_pts': 100 * statistics.median(a - b for a, b in zip(lump, parts)),
                'fell_n': sum(fell),
                'parts_ahead_when_fell_pct': 100 * sum(won_when_fell) / max(1, len(won_when_fell)),
                'below_cost_lump_pct': 100 * sum(a < 1 for a in lump) / n_starts,
                'below_cost_parts_pct': 100 * sum(b < 1 for b in parts) / n_starts,
                'worst_lump_pct': 100 * (min(lump) - 1),
                'worst_parts_pct': 100 * (min(parts) - 1),
            }
    y1 = [100 * (p[i + 12] / p[i] - 1) for i in range(len(p) - 12)]
    out['first_year'] = {'worst_pct': min(y1), 'neg_pct': 100 * sum(x < 0 for x in y1) / len(y1), 'median_pct': statistics.median(y1)}
    r5 = [100 * ((p[i + HORIZON] / p[i]) ** (1 / 5) - 1) for i in range(n_starts)]
    out['five_years'] = {'min_pct': min(r5), 'median_pct': statistics.median(r5), 'max_pct': max(r5)}
    peak, dd = 0, 0
    for _, c in rows:
        peak = max(peak, c)
        dd = min(dd, c / peak - 1)
    out['max_dd_pct'] = 100 * dd
    return out


def fund_ranges():
    if not os.path.exists(PEERS):
        return None
    w = json.load(open(PEERS, encoding='utf-8'))
    out = {'asof': w['strategies']['lm'].get('asof', '')}
    for key in ('lm', 'sm', 'ma'):
        s = w['strategies'][key]
        posts = sorted(100 * f['post_raw'] for f in s['funds'] if f.get('post_raw') is not None)
        out[key] = {'span': s['span'], 'n': len(posts), 'lo': posts[0], 'hi': posts[-1]}
    return out


def main():
    if '--inject' in sys.argv:
        inject(json.load(open(OUT, encoding='utf-8')))
        return
    doc = {
        'generated_utc': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'source': 'Yahoo Finance daily closes of the indices, price only; fund ranges from AMFI NAVs',
        'method': f'month-end closes, complete months; all at once against {PARTS} equal monthly parts, valued {HORIZON} months after the start; waiting money earns {RATES} a year',
        'series': {},
    }
    for key, fn, label in SERIES:
        doc['series'][key] = {'label': label, **study(read_closes(fn))}
    doc['funds'] = fund_ranges()
    if DRY:
        log(json.dumps(doc, indent=1)[:3000])
        return
    tmp = OUT + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        json.dump(doc, f, separators=(',', ':'), ensure_ascii=False)
    os.replace(tmp, OUT)
    log(f'{os.path.relpath(OUT, ROOT)}: written')
    inject(doc)


# The pages print these numbers as text (for readers without script, and for search)
# inside <!--MFLS:key-->…<!--/MFLS--> markers, rewritten here from the JSON.
def _pct(x, dp=1):
    return ('−' if round(x, dp) < 0 else '') + f'{abs(x):.{dp}f}%'


def _sgn(x, dp=1):
    return ('−' if round(x, dp) < 0 else '+') + f'{abs(x):.{dp}f}'


def _my(iso):
    return f'{MONTHS[int(iso[5:7]) - 1]}&nbsp;{iso[:4]}'


def _inr(n):
    s = str(int(round(n)))
    if len(s) <= 3:
        return '₹' + s
    head, tail = s[:-3], s[-3:]
    parts = []
    while len(head) > 2:
        parts.insert(0, head[-2:])
        head = head[:-2]
    if head:
        parts.insert(0, head)
    return '₹' + ','.join(parts) + ',' + tail


def markers(doc):
    out = {}
    for key, s in doc['series'].items():
        p = s['parts']
        out.update({
            f'{key}_from': _my(s['first']), f'{key}_starts': str(s['starts']),
            f'{key}_l6_0': _pct(p['6_0']['lump_ahead_pct']), f'{key}_l6_6': _pct(p['6_6']['lump_ahead_pct']),
            f'{key}_l12_0': _pct(p['12_0']['lump_ahead_pct']), f'{key}_l12_6': _pct(p['12_6']['lump_ahead_pct']),
            f'{key}_gap6_6': _sgn(p['6_6']['median_gap_pts']), f'{key}_gap12_6': _sgn(p['12_6']['median_gap_pts']),
            f'{key}_gap6_6_inr': _inr(round(1000000 * p['6_6']['median_gap_pts'] / 100, -3)),
            f'{key}_gap12_6_inr': _inr(round(1000000 * p['12_6']['median_gap_pts'] / 100, -3)),
            f'{key}_fell': _pct(p['6_6']['parts_ahead_when_fell_pct'], 0), f'{key}_fell_n': str(p['6_6']['fell_n']),
            f'{key}_below_l': _pct(p['6_6']['below_cost_lump_pct']), f'{key}_below_p': _pct(p['6_6']['below_cost_parts_pct']),
            f'{key}_worst_l': _pct(p['6_6']['worst_lump_pct']), f'{key}_worst_p': _pct(p['6_6']['worst_parts_pct']),
            f'{key}_y1_worst': _pct(s['first_year']['worst_pct']), f'{key}_y1_neg': _pct(s['first_year']['neg_pct']),
            f'{key}_y1_med': _pct(s['first_year']['median_pct']),
            f'{key}_r5_min': _pct(s['five_years']['min_pct']), f'{key}_r5_med': _pct(s['five_years']['median_pct']),
            f'{key}_r5_max': _pct(s['five_years']['max_pct']), f'{key}_dd': _pct(s['max_dd_pct']),
        })
    out['data_to'] = _my(doc['series']['n50']['last_month_end'])
    f = doc.get('funds')
    if f:
        out['funds_asof'] = f['asof'].replace(' ', '&nbsp;')
        for key in ('lm', 'sm', 'ma'):
            out.update({f'f_{key}_span': f[key]['span'].replace(' ', '&nbsp;'), f'f_{key}_n': str(f[key]['n']),
                        f'f_{key}_lo': _pct(f[key]['lo']), f'f_{key}_hi': _pct(f[key]['hi'])})
    return out


def inject(doc):
    vals = markers(doc)
    pat = re.compile(r'<!--MFLS:([a-z0-9_]+)-->(.*?)<!--/MFLS-->', re.S)
    for p in PAGES:
        if not os.path.exists(p):
            continue
        s = open(p, encoding='utf-8').read()
        unknown = sorted({m.group(1) for m in pat.finditer(s)} - set(vals))
        if unknown:
            raise SystemExit(f'{os.path.relpath(p, ROOT)}: unknown MFLS markers {unknown}')
        n = 0

        def sub(m):
            nonlocal n
            n += 1
            return f'<!--MFLS:{m.group(1)}-->{vals[m.group(1)]}<!--/MFLS-->'
        t = pat.sub(sub, s)
        if t != s:
            with open(p + '.tmp', 'w', encoding='utf-8') as f:
                f.write(t)
            os.replace(p + '.tmp', p)
        log(f'{os.path.relpath(p, ROOT)}: {n} MFLS markers {"rewritten" if t != s else "already current"}')


if __name__ == '__main__':
    main()
