#!/bin/bash
# ════════════════════════════════════════════════════════════════
#  MindForge Capital — Run LargeMidcap 250 Strategy
# ════════════════════════════════════════════════════════════════
#  WHEN TO RUN:
#    • A subscriber just paid for "MultiFactor LargeMidcap 250"
#    • You want to refresh portfolio picks before activating them
#    • Monthly rebalance day (run this, then activate all subscribers)
#
#  WHAT IT DOES:
#    1. Scores all 250 stocks in the universe using 5-factor model
#    2. Selects top 25 (max 3 per sector)
#    3. Saves live prices + picks to Google Sheet
#    4. Subscribers' dashboards update automatically
#
#  AFTER RUNNING:
#    → Open https://mindforgecapital.com/admin.html
#    → Find the pending subscriber and click Activate
#    → Dashboard link is sent to them via WhatsApp + Gmail
# ════════════════════════════════════════════════════════════════

cd "$(dirname "$0")"

# Resolve paths relative to this script (web/ → SmallCases/)
SCRIPT_DIR="$(pwd)"
ROOT_DIR="$(cd .. && pwd)"
RUNNER_DIR="$ROOT_DIR/runner"
UNIVERSE_PATH="$ROOT_DIR/strategies/largemidcap/universe.xlsx"

# ── Colour helpers ───────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BOLD='\033[1m'; NC='\033[0m'

echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║   MindForge Capital — LargeMidcap 250 Strategy Runner    ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""

# ── Check universe file ──────────────────────────────────────────
if [ ! -f "$UNIVERSE_PATH" ]; then
    echo -e "${RED}✗ Universe file not found:${NC}"
    echo "  $UNIVERSE_PATH"
    echo ""
    echo "  Expected at: strategies/largemidcap/universe.xlsx"
    echo ""
    read -n 1 -s -p "Press any key to close…"
    exit 1
fi

echo -e "${GREEN}✓ Universe file found${NC}"
echo ""

# ── Install / check dependencies ────────────────────────────────
echo "Checking Python dependencies…"
pip3 install pandas openpyxl yfinance requests numpy scipy python-dotenv --break-system-packages -q 2>/dev/null || true
echo -e "${GREEN}✓ Dependencies ready${NC}"
echo ""

# ── Run the strategy ────────────────────────────────────────────
echo -e "${BOLD}Running LargeMidcap 250 factor model…${NC}"
echo "  (This takes 3–5 minutes to download 250 tickers from Yahoo Finance)"
echo ""

RUNNER_DIR="$RUNNER_DIR" python3 - << 'PYEOF'
import sys, os, datetime

runner_dir = os.environ['RUNNER_DIR']
sys.path.insert(0, runner_dir)

print(f"  Started at: {datetime.datetime.now().strftime('%H:%M:%S')}")
print("")

try:
    from mindforge_runner import run_largemidcap
    stocks = run_largemidcap()

    print("")
    print(f"  Finished at: {datetime.datetime.now().strftime('%H:%M:%S')}")
    print("")
    if stocks:
        print("━" * 60)
        print(f"  ✅  {len(stocks)} stocks saved to Google Sheet")
        print(f"  Strategy: LargeMidcap 250")
        print("━" * 60)
        print("")
        print("  NEXT STEP:")
        print("  1. Open https://mindforgecapital.com/admin.html")
        print("  2. Find the subscriber in the Pending Leads table")
        print("  3. Click Activate → WhatsApp + Gmail sent automatically")
        print("")
    else:
        print("  ⚠️  No stocks returned — check universe file and internet connection")

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
