#!/bin/bash
# ════════════════════════════════════════════════════════════════
#  MindForge Capital — Run All Backtests + Embed Charts
# ════════════════════════════════════════════════════════════════
#  Runs backtest.py for all three strategies (LargeMidcap,
#  SmallMicro, MultiAsset), then embeds the resulting PNG charts
#  into the website HTML files via runner/update_charts.py.
# ════════════════════════════════════════════════════════════════

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BOLD='\033[1m'; NC='\033[0m'

# This script lives in MFC/runner/ — project root is one level up.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║     MindForge Capital — Full Backtest Suite              ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""
echo "  Root: $ROOT_DIR"
echo ""

# ── Install / check dependencies ────────────────────────────────
echo "Checking Python dependencies…"
pip3 install pandas openpyxl yfinance numpy scipy matplotlib python-dateutil requests --break-system-packages -q 2>/dev/null || true
echo -e "${GREEN}✓ Dependencies ready${NC}"
echo ""

ERRORS=0

# ── 1. LargeMidcap 250 ──────────────────────────────────────────
echo -e "${BOLD}━━━ [1/3] MultiFactor LargeMidcap 250 ━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo "  Downloading 250 tickers + running 5-factor model…"
echo "  (This takes 5–8 minutes)"
echo ""
python3 "$ROOT_DIR/strategies/largemidcap/backtest.py"
if [ $? -eq 0 ]; then
    echo ""
    echo -e "  ${GREEN}✓ LargeMidcap backtest complete${NC}"
else
    echo -e "  ${RED}✗ LargeMidcap backtest FAILED${NC}"
    ERRORS=$((ERRORS+1))
fi
echo ""

# ── 2. SmallMicro 500 ───────────────────────────────────────────
echo -e "${BOLD}━━━ [2/3] MultiFactor SmallMicro 500 ━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo "  Downloading 500 tickers + running 5-factor model…"
echo "  (This takes 10–15 minutes)"
echo ""
python3 "$ROOT_DIR/strategies/smallmicro/backtest.py"
if [ $? -eq 0 ]; then
    echo ""
    echo -e "  ${GREEN}✓ SmallMicro backtest complete${NC}"
else
    echo -e "  ${RED}✗ SmallMicro backtest FAILED${NC}"
    ERRORS=$((ERRORS+1))
fi
echo ""

# ── 3. MultiAsset ───────────────────────────────────────────────
echo -e "${BOLD}━━━ [3/3] MultiFactor MultiAsset ━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo "  Fetching 6 ETFs + running momentum model…"
echo "  (This takes about 1–2 minutes)"
echo ""
python3 "$ROOT_DIR/strategies/multiasset/backtest.py"
if [ $? -eq 0 ]; then
    echo ""
    echo -e "  ${GREEN}✓ MultiAsset backtest complete${NC}"
else
    echo -e "  ${RED}✗ MultiAsset backtest FAILED${NC}"
    ERRORS=$((ERRORS+1))
fi
echo ""

# ── 4. Embed charts into HTML ───────────────────────────────────
if [ $ERRORS -eq 0 ]; then
    echo -e "${BOLD}━━━ [4/4] Embedding charts into website HTML ━━━━━━━━━━━━━━${NC}"
    python3 "$ROOT_DIR/runner/update_charts.py"
    if [ $? -eq 0 ]; then
        echo -e "  ${GREEN}✓ Website HTML updated — ready to push to GitHub${NC}"
    else
        echo -e "  ${RED}✗ HTML update FAILED${NC}"
        ERRORS=$((ERRORS+1))
    fi
else
    echo -e "${YELLOW}⚠  Skipping HTML update — fix backtest errors above first${NC}"
fi

echo ""
echo "═══════════════════════════════════════════════════════════"
if [ $ERRORS -eq 0 ]; then
    echo -e "${GREEN}${BOLD}✅  All backtests complete. Charts embedded into HTML.${NC}"
    echo ""
    echo "  Next: double-click runner/push_to_github.command to deploy"
else
    echo -e "${RED}${BOLD}✗  $ERRORS backtest(s) failed — check output above.${NC}"
fi
echo "═══════════════════════════════════════════════════════════"
echo ""
read -n 1 -s -p "Press any key to close…"
echo ""
