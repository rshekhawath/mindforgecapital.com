#!/bin/bash
# ── Upload MultiAsset ETF test data to the Google Sheet ──────────────────────
# Double-click this file once to load stock picks into your dashboard.
# Requires Python 3 and internet access.

cd "$(dirname "$0")"

# Install requests if needed
pip3 install requests yfinance --break-system-packages -q 2>/dev/null || true

python3 - << 'PYEOF'
import json, datetime, requests

APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxOAkgF6naSDlx8q4mt1n3vJvd1gywpYT_iiYvt94ddYeqaniNI4ggM7idJTJHhA6RH8w/exec'

run_id   = 'multiasset_' + datetime.datetime.now().strftime('%Y%m%d_%H%M')
run_time = datetime.datetime.now().isoformat()

# MultiAsset ETF universe — 6 core Indian market ETFs
STOCKS = [
    {"ticker": "NIFTYBEES",   "yahoo_ticker": "NIFTYBEES.NS",   "company_name": "Nippon India Nifty 50 BeES",         "industry": "Large Cap Equity ETF",   "weight_pct": 30},
    {"ticker": "JUNIORBEES",  "yahoo_ticker": "JUNIORBEES.NS",  "company_name": "Nippon India Nifty Next 50 BeES",    "industry": "Large Cap Equity ETF",   "weight_pct": 20},
    {"ticker": "MID150BEES",  "yahoo_ticker": "MID150BEES.NS",  "company_name": "Nippon India Nifty Midcap 150 BeES","industry": "Midcap Equity ETF",      "weight_pct": 20},
    {"ticker": "GOLDCASE",    "yahoo_ticker": "GOLDCASE.NS",    "company_name": "Kotak Gold ETF",                    "industry": "Commodity ETF",          "weight_pct": 10},
    {"ticker": "EBBETF0431",  "yahoo_ticker": "EBBETF0431.NS",  "company_name": "Edelweiss Bharat Bond ETF 2031",    "industry": "Debt ETF",               "weight_pct": 10},
    {"ticker": "MON100",      "yahoo_ticker": "MON100.NS",      "company_name": "Mirae Asset NYSE FANG+ ETF",        "industry": "International Equity ETF","weight_pct": 10},
]

# Try to fetch live prices; fall back to 0 if unavailable
try:
    import yfinance as yf
    tickers = [s["yahoo_ticker"] for s in STOCKS]
    data    = yf.download(tickers, period="1d", progress=False)["Close"]
    prices  = {t: round(float(data[t].iloc[-1]), 2) if t in data.columns else 0 for t in tickers}
    print("✓ Live prices fetched from Yahoo Finance")
except Exception as e:
    prices  = {s["yahoo_ticker"]: 0 for s in STOCKS}
    print(f"  (Price fetch skipped: {e})")

for s in STOCKS:
    s["recommended_price"] = prices.get(s["yahoo_ticker"], 0)

payload = {
    "action":   "save_run",
    "run_id":   run_id,
    "run_time": run_time,
    "strategy": "MultiFactor MultiAsset",
    "stocks":   STOCKS
}

print(f"\nUploading {len(STOCKS)} stocks for run {run_id}...")
try:
    r = requests.post(APPS_SCRIPT_URL,
                      headers={"Content-Type": "text/plain"},
                      data=json.dumps(payload),
                      timeout=30)
    resp = r.json()
    if resp.get("status") == "ok":
        print(f"✅ Done! {resp.get('count',0)} stocks uploaded.")
        print(f"   Run ID: {run_id}")
        print("\nRefresh your dashboard — stocks should now appear.")
    else:
        print(f"❌ Error from server: {resp}")
except Exception as e:
    print(f"❌ Network error: {e}")

PYEOF

echo ""
echo "Press any key to close…"
read -n 1
