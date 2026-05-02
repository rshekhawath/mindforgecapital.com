#!/bin/bash
# ════════════════════════════════════════════════════════════════
#  MindForge Capital — Run ALL 3 backtests + deploy to GitHub
# ════════════════════════════════════════════════════════════════

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BOLD='\033[1m'; NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║  MindForge Capital — Run All Backtests + Deploy          ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""

# ── Install deps ─────────────────────────────────────────────────────────────
echo "  Installing dependencies..."
pip3 install pandas openpyxl yfinance numpy scipy matplotlib python-dateutil --break-system-packages -q 2>/dev/null || true

# ── LargeMidcap ─────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}━━━ [1/3] LargeMidcap 250 Backtest ━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo "  Downloading 250 tickers + running model (5–8 min)..."
python3 "$ROOT_DIR/strategies/largemidcap/backtest.py"
if [ $? -ne 0 ]; then
    echo -e "  ${RED}✗ LargeMidcap backtest FAILED${NC}"
    read -n 1 -s -p "Press any key to close…"; echo ""; exit 1
fi
echo -e "  ${GREEN}✓ LargeMidcap complete${NC}"

# ── SmallMicro ───────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}━━━ [2/3] SmallMicro 500 Backtest ━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo "  Downloading 500 tickers + running model (8–12 min)..."
python3 "$ROOT_DIR/strategies/smallmicro/backtest.py"
if [ $? -ne 0 ]; then
    echo -e "  ${RED}✗ SmallMicro backtest FAILED${NC}"
    read -n 1 -s -p "Press any key to close…"; echo ""; exit 1
fi
echo -e "  ${GREEN}✓ SmallMicro complete${NC}"

# ── MultiAsset ───────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}━━━ [3/3] MultiAsset Backtest ━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
python3 "$ROOT_DIR/strategies/multiasset/backtest.py"
if [ $? -ne 0 ]; then
    echo -e "  ${RED}✗ MultiAsset backtest FAILED${NC}"
    read -n 1 -s -p "Press any key to close…"; echo ""; exit 1
fi
echo -e "  ${GREEN}✓ MultiAsset complete${NC}"

# ── Update website HTML ──────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}━━━ Updating website HTML ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
python3 "$ROOT_DIR/runner/update_charts.py"
if [ $? -ne 0 ]; then
    echo -e "  ${RED}✗ Chart update FAILED${NC}"
    read -n 1 -s -p "Press any key to close…"; echo ""; exit 1
fi
echo -e "  ${GREEN}✓ Charts updated${NC}"

# ── Git commit + push ────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}━━━ Committing and pushing to GitHub ━━━━━━━━━━━━━━━━━━━━━━${NC}"

git config user.email "rshekhawath@gmail.com"
git config user.name "Sagar Shekhawath"
[ -f ".git/index.lock" ] && rm -f ".git/index.lock"
[ -f ".git/HEAD.lock"  ] && rm -f ".git/HEAD.lock"

git add -A
TODAY=$(date +"%Y-%m-%d")
git commit -m "Standardise 5 charts across all 3 strategies ($TODAY)" 2>/dev/null || echo "  (nothing new to commit)"

GIT_DIR="$ROOT_DIR/.git"
WEB_DIR="$ROOT_DIR/web"
REMOTE_URL="https://github.com/rshekhawath/mindforgecapital.com.git"

git --git-dir="$GIT_DIR" remote set-url origin "$REMOTE_URL" 2>/dev/null || \
git --git-dir="$GIT_DIR" remote add origin "$REMOTE_URL"

git --git-dir="$GIT_DIR" --work-tree="$WEB_DIR" add -A
git --git-dir="$GIT_DIR" --work-tree="$WEB_DIR" commit -m "Deploy: 5 consistent charts (growth, rolling, drawdown, fund vs bench) ($TODAY)"

echo ""
echo "  Pushing to GitHub..."
echo "  (Enter your Personal Access Token if prompted)"
echo ""
git --git-dir="$GIT_DIR" push --force origin HEAD:main

if [ $? -eq 0 ]; then
    echo ""
    echo -e "${GREEN}${BOLD}✅  Done! mindforgecapital.com will update in 1–2 minutes.${NC}"
else
    echo ""
    echo -e "${RED}✗  Push failed — check credentials above.${NC}"
fi

echo ""
read -n 1 -s -p "Press any key to close…"
echo ""
