#!/bin/bash
# ════════════════════════════════════════════════════════════════
#  MindForge Capital — Run MultiFactor MultiAsset Strategy
# ════════════════════════════════════════════════════════════════
#  WHEN TO RUN:
#    • A subscriber just paid for "MultiFactor MultiAsset"
#    • Monthly rebalance (ETF weights shift based on momentum)
#
#  WHAT IT DOES:
#    1. Scores 6 ETFs (Nifty 50, Next 50, Midcap 150, Gold, Bond, NASDAQ)
#    2. Ranks by risk-adjusted momentum, sets equal weights
#    3. Saves live prices to Google Sheet
#    4. Subscribers' dashboards update automatically
#
#  AFTER RUNNING:
#    → Open https://mindforgecapital.com/admin.html
#    → Find the pending subscriber and click Activate
#    → Dashboard link is sent to them via WhatsApp + Gmail
# ════════════════════════════════════════════════════════════════

cd "$(dirname "$0")"

# Resolve paths relative to this script (web/ → SmallCases/)
ROOT_DIR="$(cd .. && pwd)"
RUNNER_DIR="$ROOT_DIR/runner"

GREEN='\033[0;32m'; RED='\033[0;31m'; BOLD='\033[1m'; NC='\033[0m'

echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║   MindForge Capital — MultiFactor MultiAsset Runner      ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""

# ── Install / check dependencies ────────────────────────────────
echo "Checking Python dependencies…"
pip3 install yfinance requests numpy scipy python-dotenv --break-system-packages -q 2>/dev/null || true
echo -e "${GREEN}✓ Dependencies ready${NC}"
echo ""

# ── Run the strategy ────────────────────────────────────────────
echo -e "${BOLD}Running MultiAsset momentum model…${NC}"
echo "  (Fetching 6 ETFs from Yahoo Finance — takes about 30 seconds)"
echo ""

RUNNER_DIR="$RUNNER_DIR" python3 - << 'PYEOF'
import sys, os, datetime

runner_dir = os.environ['RUNNER_DIR']
sys.path.insert(0, runner_dir)

print(f"  Started at: {datetime.datetime.now().strftime('%H:%M:%S')}")
print("")

try:
    from mindforge_runner import run_multiasset
    stocks = run_multiasset()

    print("")
    print(f"  Finished at: {datetime.datetime.now().strftime('%H:%M:%S')}")
    print("")
    if stocks:
        print("━" * 60)
        print(f"  ✅  {len(stocks)} ETFs saved to Google Sheet")
        print(f"  Strategy: MultiFactor MultiAsset")
        print("━" * 60)
        print("")
        print("  NEXT STEP:")
        print("  1. Open https://mindforgecapital.com/admin.html")
        print("  2. Find the subscriber in the Pending Leads table")
        print("  3. Click Activate → WhatsApp + Gmail sent automatically")
        print("")
    else:
        print("  ⚠️  No assets returned — check internet connection")

except ImportError as e:
    print(f"  ✗ Import error: {e}")
    print("  Make sure runner/mindforge_runner.py exists in the project root.")
except Exception as e:
    print(f"  ✗ Error: {e}")
    import traceback
    traceback.print_exc()
    sys.exit(1)

PYEOF

EXIT_CODE=$?

echo ""
if [ $EXIT_CODE -eq 0 ]; then
    echo -e "${GREEN}${BOLD}Done! Open admin.html to activate the subscriber.${NC}"
else
    echo -e "${RED}Something went wrong — see error above.${NC}"
fi

echo ""
read -n 1 -s -p "Press any key to close…"
echo ""
