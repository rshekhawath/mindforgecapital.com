#!/usr/bin/env python3
"""
screener/market_data.py  (V42.3)
================================
Small PUBLIC data files that the member dashboard's "How it's going" view and the
Learn hub read. Every one is market data, or an aggregate the site already
publishes elsewhere. None carries a pick, a book's weights, or anything from IP/.

    docs/screener/market.json          market weather: index trends, India VIX,
                                       breadth, FII/DII flows, size and style
                                       leadership, industry moves, a regime label
    docs/screener/bench-attr.json      each benchmark leg's industry weights and
                                       returns since the last rebalance
    docs/screener/signals.json         per-symbol trend, valuation and liquidity
                                       fields, compacted from the public snapshot
    docs/screener/closes-lm.json       ~3 months of official NSE closes for the
    docs/screener/closes-sm.json       LargeMidcap / SmallMicro universes and for
    docs/screener/closes-etf.json      common NSE ETFs (volatility, beta, trend)
    docs/screener/backtest-months.json the month-by-month backtest the strategy
                                       pages already print, as data

WHY THE BHAVCOPY AND NOT hist/: the snapshot's hist/<SYM>.json rows are stamped
with the date the refresh RAN and hold whatever price Yahoo had then — a morning
run writes yesterday's close under today's date, a mid-session run an intraday
price. That is fine for a sparkline and wrong for a return over an exact window
(rebuilding the benchmark from it missed by 1–2 points). NSE's daily bhavcopy
carries the official close of every listed equity and ETF under its own trading
date, so every return here is close-to-close on real sessions. Yahoo supplies
only what the bhavcopy does not: index levels and India VIX.

Run by commands/refresh-stocks.command after live_perf.py. NON-FATAL by
construction: each file is built on its own and written atomically, and a
failure keeps the previous file rather than writing a partial one.

    python3 screener/market_data.py          # build and write
    python3 screener/market_data.py --dry    # build, print a summary, write nothing
"""
import csv, io, json, math, os, re, sys, time, zipfile, html as _html
from datetime import date, datetime, timedelta, timezone

ROOT  = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DOCS  = os.path.join(ROOT, 'docs')
SCR   = os.path.join(DOCS, 'screener')
CACHE = os.path.join(ROOT, 'screener', 'data')
DRY   = '--dry' in sys.argv

UA = {'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 '
                    '(KHTML, like Gecko) Chrome/141.0 Safari/537.36'}

# Index legs, keyed the way the dashboard and live-perf.json name them.
INDICES = {
    'nifty50':     ('^NSEI',              'Nifty 50'),
    'nifty100':    ('^CNX100',            'Nifty 100'),
    'midcap150':   ('NIFTYMIDCAP150.NS',  'Nifty Midcap 150'),
    'smallcap250': ('NIFTYSMLCAP250.NS',  'Nifty Smallcap 250'),
    'nifty500':    ('^CRSLDX',            'Nifty 500'),
}
VIX = '^INDIAVIX'
# Style leadership, read through ETFs that track NSE's factor indices (the
# bhavcopy carries the ETFs with official closes; nothing carries the indices).
STYLES = [
    ('momentum', 'Momentum',       'Nifty200 Momentum 30',        'MOM30IETF'),
    ('quality',  'Quality',        'Nifty200 Quality 30',         'QUAL30IETF'),
    ('value',    'Value',          'Nifty200 Value 30',           'VAL30IETF'),
    ('lowvol',   'Low volatility', 'Nifty 100 Low Volatility 30', 'LOWVOLIETF'),
]
# Common NSE ETFs. A generic list, not any book's holdings: a member's dashboard
# looks its own tickers up and simply skips what it does not find.
ETFS = ['NIFTYBEES', 'JUNIORBEES', 'MID150BEES', 'HDFCSML250', 'BANKBEES', 'ITBEES', 'MON100',
        'MAFANG', 'GOLDBEES', 'SILVERBEES', 'LIQUIDBEES', 'EBBETF0431', 'CPSEETF',
        'MOM30IETF', 'QUAL30IETF', 'VAL30IETF', 'LOWVOLIETF']
CONSTITUENTS = {
    'nifty100':    'ind_nifty100list.csv',
    'midcap150':   'ind_niftymidcap150list.csv',
    'smallcap250': 'ind_niftysmallcap250list.csv',
    'microcap250': 'ind_niftymicrocap250_list.csv',
    'nifty500':    'ind_nifty500list.csv',
}
# benchmark legs as live-perf.json names them -> constituent list
LEGS = {'^CNX100': 'nifty100', 'NIFTYMIDCAP150.NS': 'midcap150', 'NIFTYSMLCAP250.NS': 'smallcap250'}
UNIVERSES = {'lm': ('nifty100', 'midcap150'), 'sm': ('smallcap250', 'microcap250')}
SESSIONS  = 66        # official closes kept (about three months)
ADV_DAYS  = 20        # sessions averaged for traded value
SERIES_DAYS = 120     # index closes kept per index (beta, sparkline)


def log(*a):
    print('  ', *a, flush=True)


def write_json(path, obj):
    raw = json.dumps(obj, separators=(',', ':'), ensure_ascii=False)
    if DRY:
        log(f'[dry] would write {os.path.relpath(path, ROOT)} ({len(raw.encode("utf-8")):,} bytes)')
        return
    tmp = path + '.tmp'
    with open(tmp, 'w', encoding='utf-8') as f:
        f.write(raw + '\n')
    os.replace(tmp, path)
    log(f'wrote {os.path.relpath(path, ROOT)} ({os.path.getsize(path):,} bytes)')


def read_json(path, default=None):
    try:
        with open(path, encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return default


def r2(x, nd=2):
    return None if x is None or not isinstance(x, (int, float)) or not math.isfinite(x) else round(float(x), nd)


def pct(a, b):
    try:
        a, b = float(a), float(b)
        return (a / b - 1.0) * 100.0 if a > 0 and b > 0 else None
    except Exception:
        return None


def now_utc():
    return datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')


# ── NSE: constituent lists and the daily bhavcopy ─────────────────────────────
def fetch_constituents(key):
    fn = CONSTITUENTS[key]
    os.makedirs(os.path.join(CACHE, 'nse'), exist_ok=True)
    cpath = os.path.join(CACHE, 'nse', fn)
    text = None
    if not (os.path.exists(cpath) and (time.time() - os.path.getmtime(cpath)) < 6 * 86400):
        try:
            import requests
            r = requests.get('https://nsearchives.nseindia.com/content/indices/' + fn, headers=UA, timeout=25)
            if r.status_code == 200 and 'Symbol' in r.text[:300]:
                text = r.text
                with open(cpath, 'w', encoding='utf-8') as f:
                    f.write(text)
        except Exception as e:
            log(f'constituents {fn}: fetch failed ({e}); using the cached list if any')
    if text is None and os.path.exists(cpath):
        with open(cpath, encoding='utf-8') as f:
            text = f.read()
    out = []
    for row in csv.DictReader(io.StringIO(text or '')):
        sym = (row.get('Symbol') or '').strip()
        if sym:
            out.append({'sym': sym, 'ind': (row.get('Industry') or '').strip() or 'Other'})
    return out


def fetch_bhav(day):
    """{symbol: (close, traded value ₹)} for one session, cached; None if NSE has no
    file for that day (a holiday, or a session whose file is not out yet)."""
    os.makedirs(os.path.join(CACHE, 'bhav'), exist_ok=True)
    p = os.path.join(CACHE, 'bhav', f'cm_{day:%Y%m%d}.csv')
    if not os.path.exists(p):
        try:
            import requests
            u = f'https://nsearchives.nseindia.com/content/cm/BhavCopy_NSE_CM_0_0_0_{day:%Y%m%d}_F_0000.csv.zip'
            r = requests.get(u, headers=UA, timeout=30)
            if r.status_code != 200 or r.content[:2] != b'PK':
                return None
            z = zipfile.ZipFile(io.BytesIO(r.content))
            raw = z.read(z.namelist()[0]).decode('utf-8', 'replace')
            keep = ['TckrSymb,SctySrs,ClsPric,TtlTrfVal']
            for row in csv.DictReader(io.StringIO(raw)):
                if row.get('SctySrs') in ('EQ', 'BE', 'BZ', 'SM', 'ST'):
                    keep.append(f"{row['TckrSymb']},{row['SctySrs']},{row['ClsPric']},{row['TtlTrfVal']}")
            with open(p, 'w', encoding='utf-8') as f:
                f.write('\n'.join(keep) + '\n')
        except Exception:
            return None
    out = {}
    with open(p, encoding='utf-8') as f:
        for row in csv.DictReader(f):
            try:
                c, v = float(row['ClsPric'] or 0), float(row['TtlTrfVal'] or 0)
            except Exception:
                continue
            s = row['TckrSymb']
            # one series per symbol; EQ wins if a name also trades in another series
            if s not in out or row.get('SctySrs') == 'EQ':
                out[s] = (c, v)
    return out


def load_sessions(n):
    """The last `n` NSE sessions with a bhavcopy, oldest first: [(iso, {sym: (close, value)})]."""
    got, day, checked = [], date.today(), 0
    while len(got) < n and checked < int(n * 1.7) + 12:
        if day.weekday() < 5:
            b = fetch_bhav(day)
            if b:
                got.append((day.isoformat(), b))
        checked += 1
        day -= timedelta(days=1)
    got.reverse()
    return got


def close_on(sessions, sym, iso):
    """Official close of `sym` on the last session on or before `iso`."""
    best = None
    for d, b in sessions:
        if d > iso:
            break
        if sym in b and b[sym][0] > 0:
            best = b[sym][0]
    return best


def yahoo_closes(tickers):
    """{ticker: [(iso, close)]} ascending, from Yahoo daily bars."""
    import warnings
    warnings.filterwarnings('ignore')
    import yfinance as yf
    out = {}
    for _ in range(2):
        want = [t for t in tickers if t not in out]
        if not want:
            break
        try:
            d = yf.download(want, period='14mo', interval='1d', auto_adjust=False, progress=False,
                            group_by='ticker', threads=True)
        except Exception as e:
            log(f'yahoo download failed ({e})')
            time.sleep(15)
            continue
        for t in want:
            try:
                s = d[t]['Close'].dropna() if len(want) > 1 else d['Close'].dropna()
                rows = [(ix.strftime('%Y-%m-%d'), float(v)) for ix, v in s.items() if float(v) > 0]
                if len(rows) >= 30:
                    out[t] = rows
            except Exception:
                pass
        if len(out) < len(tickers):
            time.sleep(10)
    return out


def upto(series, iso):
    return [x for x in series if x[0] <= iso] if series else []


def at_or_before(series, iso):
    best = None
    for d, c in series or []:
        if d <= iso:
            best = c
        else:
            break
    return best


# ── builders ──────────────────────────────────────────────────────────────────
def ff_weight(snap_row):
    """Free-float market cap from the public snapshot (market cap × free-float %)."""
    if not snap_row:
        return 0.0
    mc = snap_row.get('market_cap') or 0
    ff = snap_row.get('float_pct')
    try:
        return float(mc) * (float(ff) / 100.0 if isinstance(ff, (int, float)) and 0 < ff <= 100 else 1.0)
    except Exception:
        return 0.0


def build_market(ycl, sessions, snap, rebal, as_of, prev, cons500):
    idx = {}
    for key, (t, name) in INDICES.items():
        s = upto(ycl.get(t), as_of)
        if len(s) < 60:
            continue
        last = s[-1][1]
        back = lambda n: s[-1 - n][1] if len(s) > n else None
        d200 = [c for _, c in s[-200:]]
        dma200 = sum(d200) / len(d200) if len(d200) >= 150 else None
        w63 = [c for _, c in s[-63:]]
        idx[key] = {
            't': t, 'name': name, 'as_of': s[-1][0], 'last': r2(last),
            'd1': r2(pct(last, back(1))), 'm1': r2(pct(last, back(21))), 'm3': r2(pct(last, back(63))),
            'cyc': r2(pct(last, at_or_before(s, rebal))) if rebal else None,
            'dma200': r2(dma200), 'vs200': r2(pct(last, dma200)) if dma200 else None,
            'off3m_low': r2(pct(last, min(w63))), 'fall3m': r2(pct(min(w63), max(w63))),
            'series': [[d, r2(c)] for d, c in s[-SERIES_DAYS:]],
        }

    vix = None
    vs = upto(ycl.get(VIX), as_of)
    if len(vs) > 30:
        yr = [c for _, c in vs[-252:]]
        last = vs[-1][1]
        vix = {'last': r2(last), 'pctile_1y': r2(100.0 * sum(1 for c in yr if c <= last) / len(yr), 0),
               'lo_1y': r2(min(yr)), 'hi_1y': r2(max(yr)), 'm1': r2(pct(last, vs[-22][1] if len(vs) > 22 else None))}

    # breadth over the public snapshot, with a rolling daily history kept across runs
    rows = list(snap.values())
    a200 = [r for r in rows if r.get('above_sma200') in (True, False)]
    a50 = [r for r in rows if r.get('above_sma50') in (True, False)]
    breadth = None
    if len(a200) > 500:
        b200 = 100.0 * sum(1 for r in a200 if r['above_sma200']) / len(a200)
        b50 = 100.0 * sum(1 for r in a50 if r['above_sma50']) / max(1, len(a50))
        hist = [h for h in (((prev or {}).get('breadth') or {}).get('hist') or [])
                if isinstance(h, list) and len(h) == 3 and h[0] != as_of]
        hist.append([as_of, r2(b200, 1), r2(b50, 1)])
        hist = sorted(hist)[-90:]
        cut = lambda days: (datetime.strptime(as_of, '%Y-%m-%d') - timedelta(days=days)).strftime('%Y-%m-%d')
        wk = next((h for h in reversed(hist[:-1]) if h[0] <= cut(6)), None)
        mo = next((h for h in reversed(hist[:-1]) if h[0] <= cut(27)), None)
        breadth = {'above200': r2(b200, 1), 'above50': r2(b50, 1), 'n': len(a200),
                   'above200_wk': wk[1] if wk else None, 'above200_mo': mo[1] if mo else None, 'hist': hist}

    flows = None
    fd = read_json(os.path.join(DOCS, 'fii-dii', 'fii-dii.json'), {}) or {}
    ch = fd.get('cash_history') if isinstance(fd.get('cash_history'), list) else []
    recent = [x for x in ch[:20] if isinstance(x, dict)]          # newest FIRST in this file
    fii = [x.get('fii_net') for x in recent]
    dii = [x.get('dii_net') for x in recent]
    if len(recent) >= 10 and all(isinstance(v, (int, float)) for v in fii + dii):
        flows = {'days': len(recent), 'fii_net_cr': r2(sum(fii), 0), 'dii_net_cr': r2(sum(dii), 0),
                 'fii_sell_days': sum(1 for v in fii if v < 0), 'dii_buy_days': sum(1 for v in dii if v > 0),
                 'from': recent[-1].get('date'), 'as_of': recent[0].get('date')}

    styles = []
    for key, short, name, sym in STYLES:
        last = close_on(sessions, sym, as_of)
        m1d = sessions[-22][0] if len(sessions) > 22 else None
        styles.append({'key': key, 'short': short, 'name': name, 'via': sym,
                       'm1': r2(pct(last, close_on(sessions, sym, m1d))) if m1d else None,
                       'cyc': r2(pct(last, close_on(sessions, sym, rebal))) if rebal else None})
    styles = [s for s in styles if s['m1'] is not None or s['cyc'] is not None]

    size = None
    if 'smallcap250' in idx and 'nifty50' in idx:
        sm, lg = idx['smallcap250'], idx['nifty50']
        dif = lambda a, b: r2(a - b) if a is not None and b is not None else None
        size = {'m1': dif(sm['m1'], lg['m1']), 'cyc': dif(sm['cyc'], lg['cyc'])}

    regime = None
    n50 = idx.get('nifty50')
    if n50 and n50.get('vs200') is not None:
        vol_high = bool(vix and vix['pctile_1y'] is not None and vix['pctile_1y'] >= 70)
        up = n50['vs200'] > 0
        rebound = (n50.get('fall3m') is not None and n50['fall3m'] <= -8 and
                   n50.get('off3m_low') is not None and n50['off3m_low'] >= 5 and (not up or vol_high))
        if rebound:
            k, lbl = 'rebound', 'Rebounding after a fall'
        elif up and not vol_high:
            k, lbl = 'rising-calm', 'Rising, calm'
        elif up:
            k, lbl = 'rising-nervous', 'Rising, nervous'
        elif (n50.get('m1') or 0) < 0:
            k, lbl = 'falling', 'Falling'
        else:
            k, lbl = 'steadying', 'Below its trend, steadying'
        regime = {'key': k, 'label': lbl, 'vol_high': vol_high, 'trend_up': up}

    # industry moves: free-float weighted, Nifty 500 constituents, official closes
    industries = {}
    m1d = sessions[-22][0] if len(sessions) > 22 else None
    acc = {}
    for c in cons500:
        w = ff_weight(snap.get(c['sym']))
        if not (w > 0):
            continue
        last = close_on(sessions, c['sym'], as_of)
        a = acc.setdefault(c['ind'], [0.0, 0.0, 0.0, 0.0, 0])
        a[4] += 1
        rc = pct(last, close_on(sessions, c['sym'], rebal)) if rebal else None
        if rc is not None and abs(rc) < 60:
            a[0] += w * rc; a[1] += w
        rm = pct(last, close_on(sessions, c['sym'], m1d)) if m1d else None
        if rm is not None and abs(rm) < 60:
            a[2] += w * rm; a[3] += w
    for ind, a in acc.items():
        industries[ind] = {'n': a[4], 'cyc': r2(a[0] / a[1]) if a[1] else None, 'm1': r2(a[2] / a[3]) if a[3] else None}

    return {
        'generated_utc': now_utc(), 'as_of': as_of, 'rebalance_date': rebal,
        'indices': idx, 'vix': vix, 'breadth': breadth, 'flows': flows,
        'styles': styles, 'size': size, 'regime': regime, 'industries': industries,
        'rules': {
            'trend': 'Nifty 50 against its average close of the last 200 sessions.',
            'volatility': 'India VIX against its own past year; at or above its 70th percentile counts as nervous.',
            'rebound': 'Nifty 50 at least 5% above its 3-month low after a fall of 8% or more inside those 3 months.',
            'breadth': 'Share of the snapshot’s NSE stocks trading above their 200- and 50-session averages.',
            'styles': 'Each style is read through an ETF that tracks the named NSE factor index.',
            'industries': 'Free-float weighted move of the Nifty 500’s constituents in each NSE industry.',
        },
        'sources': 'NSE bhavcopy (official closes), Yahoo Finance (index levels, India VIX), '
                   'NSE FII/DII provisional data, the MindForge stock snapshot.',
    }


def build_bench_attr(sessions, snap, rebal, as_of, ycl):
    legs = {}
    for t, key in LEGS.items():
        cons = fetch_constituents(key)
        if not cons:
            continue
        tot_w, cov_w, ind = 0.0, 0.0, {}
        for c in cons:
            w = ff_weight(snap.get(c['sym']))
            if not (w > 0):
                continue
            tot_w += w
            ret = pct(close_on(sessions, c['sym'], as_of), close_on(sessions, c['sym'], rebal))
            g = ind.setdefault(c['ind'], [0.0, 0.0, 0.0, 0])
            g[0] += w; g[3] += 1
            if ret is not None and abs(ret) < 60:
                g[1] += w * ret; g[2] += w; cov_w += w
        if not tot_w:
            continue
        inds, r_est = {}, 0.0
        for name, g in sorted(ind.items()):
            rj = g[1] / g[2] if g[2] else None
            wj = g[0] / tot_w
            inds[name] = {'w': r2(wj * 100, 3), 'r': r2(rj, 3), 'n': g[3]}
            if rj is not None:
                r_est += wj * rj
        # what the index owns, on the snapshot's own fields: earnings and book
        # yields averaged by weight (so a loss-maker does not invert the mean),
        # then turned back into P/E and P/B; ROE weighted as it stands.
        ey = ew = by = bw = rq = rw = 0.0
        for c in cons:
            sr = snap.get(c['sym']); w = ff_weight(sr)
            if not (w > 0):
                continue
            pe_, pb_, roe_ = sr.get('pe_ratio'), sr.get('pb_ratio'), sr.get('roe')
            if isinstance(pe_, (int, float)) and pe_ > 0:
                ey += w / pe_; ew += w
            if isinstance(pb_, (int, float)) and pb_ > 0:
                by += w / pb_; bw += w
            if isinstance(roe_, (int, float)) and -100 < roe_ < 200:
                rq += w * roe_; rw += w
        stats = {'pe': r2(ew / ey, 1) if ey else None, 'pb': r2(bw / by, 2) if by else None,
                 'roe': r2(rq / rw, 1) if rw else None}
        s = ycl.get(t)
        legs[t] = {'key': key, 'name': INDICES[key][1], 'n': len(cons), 'stats': stats,
                   'coverage_pct': r2(100.0 * cov_w / tot_w, 1), 'r_est': r2(r_est, 3),
                   'r_index': r2(pct(at_or_before(s, as_of), at_or_before(s, rebal)), 3) if s else None,
                   'industries': inds}
    return {
        'generated_utc': now_utc(), 'as_of': as_of, 'rebalance_date': rebal, 'legs': legs,
        'basis': 'Estimated from each index’s constituents: free-float market cap from the MindForge snapshot, '
                 'moved by its official NSE close since the rebalance. NSE publishes official weights monthly, so '
                 'the split and the rebuilt index return can differ a little from the index itself.',
    }


def build_closes(sessions, syms, as_of):
    """{'dates': [...], 'rows': {sym: [close|null, ...]}} over the last SESSIONS sessions."""
    use = [(d, b) for d, b in sessions if d <= as_of][-SESSIONS:]
    rows = {}
    for s in sorted(set(syms)):
        v = [r2(b[s][0], 2) if s in b and b[s][0] > 0 else None for _, b in use]
        if sum(1 for x in v if x is not None) >= max(10, len(use) // 2):
            rows[s] = v
    return {'as_of': as_of, 'dates': [d for d, _ in use], 'rows': rows,
            'source': 'NSE bhavcopy: official closing prices (not adjusted for corporate actions).'}


def build_signals(snap, sessions, as_of):
    recent = [b for d, b in sessions if d <= as_of][-ADV_DAYS:]
    adv = {}
    for b in recent:
        for s, (c, v) in b.items():
            adv[s] = adv.get(s, 0.0) + v
    n = len(recent)
    cols = ['mc', 'a50', 'a200', 'fh', 'pe', 'pb', 'roe', 'adv']
    rows = {}
    bit = lambda v: 1 if v is True else (0 if v is False else None)
    for sym, r in snap.items():
        rows[sym] = [r2(r.get('market_cap_cr'), 0), bit(r.get('above_sma50')), bit(r.get('above_sma200')),
                     r2(r.get('52w_from_high_pct'), 1), r2(r.get('pe_ratio'), 1), r2(r.get('pb_ratio'), 2),
                     r2(r.get('roe'), 1), r2(adv[sym] / n / 1e7, 2) if (n and sym in adv) else None]
    for sym in ETFS:
        if sym not in rows and n and sym in adv:
            rows[sym] = [None, None, None, None, None, None, None, r2(adv[sym] / n / 1e7, 2)]
    return {'as_of': as_of, 'cols': cols, 'adv_sessions': n,
            'notes': 'mc = market cap (₹ cr) · a50 / a200 = above its 50 / 200-session average · '
                     'fh = % from its 52-week high · pe, pb, roe from the snapshot · '
                     'adv = average daily traded value (₹ cr, NSE bhavcopy).',
            'rows': rows}


def build_backtest_months():
    """The month-by-month backtest each strategy page prints (its MFCAL block), as
    data. Read from the published pages, so it cannot disagree with them."""
    out = {}
    for code, page in (('lm', 'largemidcap.html'), ('sm', 'smallmicro.html')):
        try:
            with open(os.path.join(DOCS, page), encoding='utf-8') as f:
                s = f.read()
        except Exception:
            continue
        m = re.search(r'<!--MFCAL:' + code + r'-->(.*?)<!--/MFCAL-->', s, re.S)
        if not m:
            continue
        months = []
        for row in re.findall(r'<tr>(.*?)</tr>', m.group(1), re.S):
            cells = [_html.unescape(re.sub(r'<[^>]+>', '', c)).strip()
                     for c in re.findall(r'<t[hd][^>]*>(.*?)</t[hd]>', row, re.S)]
            if not cells or not re.fullmatch(r'\d{4}', cells[0]):
                continue
            for i, v in enumerate(cells[1:13]):
                v = v.replace('−', '-').replace('+', '').strip()
                if re.fullmatch(r'-?\d+(\.\d+)?', v):
                    months.append([f'{cells[0]}-{i + 1:02d}', float(v)])
        if months:
            rng = re.search(r'class="mcal-range">([^<]+)<', m.group(1))
            out[code] = {'months': months, 'n': len(months),
                         'range': _html.unescape(rng.group(1)).strip() if rng else None}
    return {'generated_utc': now_utc(),
            'basis': 'Backtest, before tax: the monthly returns printed in each strategy page’s calendar.',
            'books': out}


def main():
    t0 = time.time()
    print('» market_data: building the dashboard’s market files', flush=True)
    perf = read_json(os.path.join(DOCS, 'live-perf.json'), {}) or {}
    rebal = perf.get('rebalance_date')
    sd = read_json(os.path.join(SCR, 'stocks-lite.json'), {}) or {}
    snap = {str(r.get('symbol')): r for r in (sd.get('stocks') or []) if r.get('symbol')}
    log(f'snapshot: {len(snap)} symbols · rebalance {rebal}')

    sessions = load_sessions(SESSIONS)
    if not sessions:
        log('no NSE bhavcopy reachable — keeping every previous file')
        return
    as_of = sessions[-1][0]
    log(f'bhavcopy: {len(sessions)} sessions, {sessions[0][0]} → {as_of}')

    ycl = {}
    try:
        ycl = yahoo_closes([t for t, _ in INDICES.values()] + [VIX])
        log(f'yahoo: {len(ycl)}/{len(INDICES) + 1} index series')
    except Exception as e:
        log(f'yahoo failed: {e}')

    cons = {k: fetch_constituents(k) for k in CONSTITUENTS}
    log('constituents: ' + ', '.join(f'{k} {len(v)}' for k, v in cons.items()))

    try:
        if ycl.get('^NSEI'):
            mk = build_market(ycl, sessions, snap, rebal, as_of, read_json(os.path.join(SCR, 'market.json'), {}),
                              cons.get('nifty500') or [])
            write_json(os.path.join(SCR, 'market.json'), mk)
            log(f"regime: {(mk.get('regime') or {}).get('label')} · breadth {(mk.get('breadth') or {}).get('above200')}% "
                f"above 200d · {len(mk['industries'])} industries · styles {[s['key'] for s in mk['styles']]}")
        else:
            log('market.json: no Nifty 50 series — keeping the previous file')
    except Exception as e:
        log(f'market.json failed: {e} — keeping the previous file')

    try:
        if rebal:
            ba = build_bench_attr(sessions, snap, rebal, as_of, ycl)
            if ba['legs']:
                write_json(os.path.join(SCR, 'bench-attr.json'), ba)
                for t, l in ba['legs'].items():
                    log(f"bench {l['name']}: {len(l['industries'])} industries · coverage {l['coverage_pct']}% · "
                        f"rebuilt {l['r_est']}% vs index {l['r_index']}%")
    except Exception as e:
        log(f'bench-attr.json failed: {e} — keeping the previous file')

    for code, keys in UNIVERSES.items():
        try:
            syms = [c['sym'] for k in keys for c in (cons.get(k) or [])]
            if syms:
                cl = build_closes(sessions, syms, as_of)
                write_json(os.path.join(SCR, f'closes-{code}.json'), cl)
                log(f'closes-{code}: {len(cl["rows"])} of {len(set(syms))} symbols × {len(cl["dates"])} sessions')
        except Exception as e:
            log(f'closes-{code}.json failed: {e} — keeping the previous file')
    try:
        cl = build_closes(sessions, ETFS, as_of)
        if cl['rows']:
            write_json(os.path.join(SCR, 'closes-etf.json'), cl)
    except Exception as e:
        log(f'closes-etf.json failed: {e} — keeping the previous file')

    try:
        if snap:
            write_json(os.path.join(SCR, 'signals.json'), build_signals(snap, sessions, as_of))
    except Exception as e:
        log(f'signals.json failed: {e} — keeping the previous file')

    try:
        bm = build_backtest_months()
        if bm['books']:
            write_json(os.path.join(SCR, 'backtest-months.json'), bm)
    except Exception as e:
        log(f'backtest-months.json failed: {e} — keeping the previous file')

    print(f'✓ market_data done in {time.time() - t0:.0f}s', flush=True)


if __name__ == '__main__':
    main()
