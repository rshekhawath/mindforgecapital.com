#!/usr/bin/env python3
"""
fii_dii.py
==========
Fetch India FII / DII activity and publish docs/fii-dii/fii-dii.json for the
static "FII/DII" website tab (modelled on Sensibull's FII/DII dashboard).

Data sources (all public, free):
  1. CASH market provisional FII/DII buy/sell/net  ........  NSE  /api/fiidiiTradeReact
  2. F&O participant-wise OPEN INTEREST (FII/DII/Pro/Client)  NSE  fao_participant_oi_<DDMMYYYY>.csv
  3. F&O participant-wise TRADING VOLUME ..................  NSE  fao_participant_vol_<DDMMYYYY>.csv
  4. Index spot context (Nifty 50 / Bank Nifty / Sensex) ..  Yahoo Finance (yfinance, best-effort)

NOTE on "Yahoo Finance": Yahoo does NOT publish institutional FII/DII *flows* —
those are an NSE/BSE disclosure (Sensibull aggregates the same NSE feed). So the
flow numbers come from NSE; Yahoo is used for the live index-level context strip.

The published JSON keeps a rolling per-day HISTORY so the website trend table /
chart fill in a little more each day the daily refresh runs. A flaky network run
never destroys prior history — it merges into whatever is already on disk.

Usage
-----
    python3 fii_dii.py            # fetch latest + merge history + write JSON

Exit code is always 0 unless it could not write *any* snapshot at all, so it is
safe to chain inside refresh-stock-data.command without aborting the stock run.
"""
import os, sys, json, csv, io, time, datetime as dt

import requests

# ── paths ────────────────────────────────────────────────────────────────────
HERE     = os.path.dirname(os.path.abspath(__file__))
REPO     = os.path.dirname(HERE)
OUT_DIR  = os.path.join(REPO, "docs", "fii-dii")
OUT_FILE = os.path.join(OUT_DIR, "fii-dii.json")
HISTORY_DAYS = 90

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
          "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


# ── helpers ──────────────────────────────────────────────────────────────────
def _num(x):
    """Parse '31,442.87' / '-1159.64' / '' -> float or None."""
    if x is None:
        return None
    s = str(x).strip().replace(",", "").replace("₹", "")
    if s in ("", "-", "NA", "N/A", "nan"):
        return None
    try:
        return float(s)
    except ValueError:
        return None


def _parse_date(s):
    """'19-Jun-2026' -> date, else None."""
    try:
        d, mon, y = s.strip().split("-")
        return dt.date(int(y), MONTHS.index(mon[:3].title()) + 1, int(d))
    except Exception:
        return None


def _fmt_date(d):
    return f"{d.day:02d}-{MONTHS[d.month - 1]}-{d.year}"


def _nse_session():
    s = requests.Session()
    s.headers.update({
        "User-Agent": UA,
        "Accept-Language": "en-US,en;q=0.9",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    })
    # Prime cookies (some NSE endpoints gate on them). A 403 here is fine — the
    # JSON API frequently answers anyway — so we never treat this as fatal.
    for url in ("https://www.nseindia.com/",
                "https://www.nseindia.com/market-data/live-equity-market"):
        try:
            s.get(url, timeout=20)
        except Exception:
            pass
    return s


# ── 1. CASH provisional FII/DII ──────────────────────────────────────────────
def fetch_cash(sess):
    url = "https://www.nseindia.com/api/fiidiiTradeReact"
    headers = {"Accept": "application/json,text/plain,*/*",
               "Referer": "https://www.nseindia.com/reports-indices-historical-index-data",
               "X-Requested-With": "XMLHttpRequest"}
    last = None
    for attempt in range(4):
        try:
            r = sess.get(url, headers=headers, timeout=25)
            if r.status_code == 200 and r.text.strip().startswith("["):
                rows = r.json()
                out = {"fii": None, "dii": None, "date": None}
                for row in rows:
                    cat = str(row.get("category", "")).upper()
                    rec = {"buy": _num(row.get("buyValue")),
                           "sell": _num(row.get("sellValue")),
                           "net": _num(row.get("netValue"))}
                    out["date"] = row.get("date") or out["date"]
                    if "FII" in cat or "FPI" in cat:
                        out["fii"] = rec
                    elif "DII" in cat:
                        out["dii"] = rec
                if out["fii"] or out["dii"]:
                    return out
        except Exception as e:
            last = e
        time.sleep(1.5 * (attempt + 1))
    print(f"  [cash] could not fetch NSE cash FII/DII ({last})", flush=True)
    return None


# ── 2/3. F&O participant-wise OI / VOL ───────────────────────────────────────
# Fixed column order in both CSVs (positional — the header text carries stray
# spaces, so we never key by name):
PART_FIELDS = [
    "fut_idx_long", "fut_idx_short", "fut_stk_long", "fut_stk_short",
    "opt_idx_call_long", "opt_idx_put_long", "opt_idx_call_short", "opt_idx_put_short",
    "opt_stk_call_long", "opt_stk_put_long", "opt_stk_call_short", "opt_stk_put_short",
    "total_long", "total_short",
]


def _parse_participant_csv(text):
    """Return {'FII': {...14 ints...}, 'DII':..., 'Client':..., 'Pro':...}."""
    out = {}
    reader = csv.reader(io.StringIO(text))
    for row in reader:
        if not row:
            continue
        key = row[0].strip()
        if key in ("Client", "DII", "FII", "Pro", "TOTAL") and len(row) >= 15:
            vals = {}
            for i, f in enumerate(PART_FIELDS, start=1):
                vals[f] = int(_num(row[i]) or 0)
            out[key] = vals
    return out


def _fetch_csv(sess, kind, d):
    url = (f"https://archives.nseindia.com/content/nsccl/"
           f"fao_participant_{kind}_{d.strftime('%d%m%Y')}.csv")
    try:
        r = sess.get(url, headers={"Referer": "https://www.nseindia.com/"}, timeout=25)
        if r.status_code == 200 and "Client Type" in r.text:
            return _parse_participant_csv(r.text)
    except Exception:
        pass
    return None


def fetch_derivatives(sess, anchor):
    """Walk back from `anchor` (a date) until a participant OI report exists."""
    start = anchor or dt.date.today()
    for back in range(0, 7):
        d = start - dt.timedelta(days=back)
        if d.weekday() >= 5:          # skip Sat/Sun
            continue
        oi = _fetch_csv(sess, "oi", d)
        if oi:
            vol = _fetch_csv(sess, "vol", d)
            return {"date": _fmt_date(d), "oi": oi, "vol": vol}
    print("  [deriv] no participant OI report found in the last 7 days", flush=True)
    return None


# ── 4. Index spot context (Yahoo Finance, best-effort) ───────────────────────
def fetch_indices():
    out = {}
    targets = [("NIFTY 50", "^NSEI"), ("BANK NIFTY", "^NSEBANK"), ("SENSEX", "^BSESN")]
    try:
        import yfinance as yf
    except Exception:
        return out
    for label, tkr in targets:
        try:
            fi = yf.Ticker(tkr).fast_info
            price = fi.get("last_price") or fi.get("lastPrice")
            prev = fi.get("previous_close") or fi.get("previousClose")
            if price and prev:
                chg = price - prev
                out[label] = {"price": round(float(price), 2),
                              "change": round(float(chg), 2),
                              "pct": round(float(chg) / float(prev) * 100, 2)}
        except Exception:
            continue
        time.sleep(0.2)
    return out


# ── history merge ────────────────────────────────────────────────────────────
def _load_existing():
    try:
        with open(OUT_FILE, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def _merge_history(prev_list, new_record):
    """Upsert new_record (keyed by 'date') into prev_list, newest first, capped."""
    by_date = {}
    for rec in (prev_list or []):
        if rec.get("date"):
            by_date[rec["date"]] = rec
    if new_record and new_record.get("date"):
        by_date[new_record["date"]] = new_record
    rows = list(by_date.values())
    rows.sort(key=lambda r: _parse_date(r.get("date", "")) or dt.date.min, reverse=True)
    return rows[:HISTORY_DAYS]


def _deriv_summary(date_str, oi):
    """Compact FII derivative net positions for the history/trend series."""
    fii = (oi or {}).get("FII", {})
    if not fii:
        return None
    fl, fs = fii.get("fut_idx_long", 0), fii.get("fut_idx_short", 0)
    return {
        "date": date_str,
        "fii_fut_idx_net": fl - fs,
        "fii_fut_stk_net": fii.get("fut_stk_long", 0) - fii.get("fut_stk_short", 0),
        "fii_idxfut_long": fl,
        "fii_idxfut_short": fs,
        "fii_idxfut_ls_ratio": round(fl / fs, 3) if fs else None,
    }


# ── main ─────────────────────────────────────────────────────────────────────
def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    prev = _load_existing()

    print("» FII/DII: priming NSE session…", flush=True)
    sess = _nse_session()

    print("» FII/DII: fetching cash provisional (NSE)…", flush=True)
    cash = fetch_cash(sess)

    anchor = _parse_date(cash["date"]) if (cash and cash.get("date")) else None
    print("» FII/DII: fetching F&O participant OI/VOL (NSE)…", flush=True)
    deriv = fetch_derivatives(sess, anchor)

    print("» FII/DII: fetching index context (Yahoo Finance)…", flush=True)
    indices = fetch_indices()

    if not cash and not deriv:
        print("✗ FII/DII: no fresh data fetched — keeping the previous snapshot.", flush=True)
        if prev:
            return 0
        # Nothing to publish and nothing on disk: write an empty-but-valid shell.
        cash = None

    # ── cash history row ─────────────────────────────────────────────────────
    cash_row = None
    if cash and (cash.get("fii") or cash.get("dii")):
        fii, dii = cash.get("fii") or {}, cash.get("dii") or {}
        cash_row = {
            "date": cash.get("date"),
            "fii_buy": fii.get("buy"), "fii_sell": fii.get("sell"), "fii_net": fii.get("net"),
            "dii_buy": dii.get("buy"), "dii_sell": dii.get("sell"), "dii_net": dii.get("net"),
        }

    deriv_row = _deriv_summary(deriv["date"], deriv["oi"]) if deriv else None

    out = {
        "generated_at": dt.datetime.now().replace(microsecond=0).isoformat(),
        "data_date": (cash or {}).get("date") or (deriv or {}).get("date"),
        "cash": cash or prev.get("cash"),
        "cash_history": _merge_history(prev.get("cash_history"), cash_row),
        "derivatives": deriv or prev.get("derivatives"),
        "deriv_history": _merge_history(prev.get("deriv_history"), deriv_row),
        "indices": indices or prev.get("indices") or {},
    }

    tmp = OUT_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(out, f, separators=(",", ":"), ensure_ascii=False)
    os.replace(tmp, OUT_FILE)

    c = out.get("cash") or {}
    fii_net = (c.get("fii") or {}).get("net")
    dii_net = (c.get("dii") or {}).get("net")
    print(f"✓ FII/DII written: {OUT_FILE}", flush=True)
    print(f"  data through {out['data_date']} · "
          f"FII net ₹{fii_net} cr · DII net ₹{dii_net} cr · "
          f"cash history {len(out['cash_history'])}d · "
          f"deriv {'yes' if out.get('derivatives') else 'no'} · "
          f"indices {len(out['indices'])}", flush=True)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except SystemExit:
        raise
    except Exception as e:
        # Never abort the surrounding refresh command on an unexpected error.
        print(f"✗ FII/DII fetch crashed (non-fatal): {e}", flush=True)
        raise SystemExit(0)
