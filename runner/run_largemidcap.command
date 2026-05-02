#!/bin/bash
GREEN='\033[0;32m'; RED='\033[0;31m'; BOLD='\033[1m'; NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║  MindForge Capital — LargeMidcap Backtest + Deploy       ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""
echo "  Installing dependencies..."
pip3 install pandas openpyxl yfinance numpy scipy matplotlib python-dateutil --break-system-packages -q 2>/dev/null || true

echo "  Running LargeMidcap backtest (5–8 min)..."
python3 "$ROOT_DIR/strategies/largemidcap/backtest.py"
if [ $? -ne 0 ]; then
    echo -e "  ${RED}✗ Backtest FAILED${NC}"
    read -n 1 -s -p "Press any key to close…"; echo ""; exit 1
fi
echo -e "  ${GREEN}✓ Backtest complete${NC}"

echo ""
echo "  Updating website HTML..."
python3 "$ROOT_DIR/runner/update_charts.py"
if [ $? -ne 0 ]; then
    echo -e "  ${RED}✗ Chart update FAILED${NC}"
    read -n 1 -s -p "Press any key to close…"; echo ""; exit 1
fi
echo -e "  ${GREEN}✓ Charts updated${NC}"

echo ""
echo -e "${BOLD}━━━ Committing and pushing to GitHub ━━━━━━━━━━━━━━━━━━━━━━${NC}"

git config user.email "rshekhawath@gmail.com"
git config user.name "Sagar Shekhawath"
[ -f ".git/index.lock" ] && rm -f ".git/index.lock"
[ -f ".git/HEAD.lock" ] && rm -f ".git/HEAD.lock"

git add -A
TODAY=$(date +"%Y-%m-%d")
git commit -m "Cleanup: remove factor labels, trim charts, clean folder ($TODAY)"

GIT_DIR="$ROOT_DIR/.git"
WEB_DIR="$ROOT_DIR/web"
REMOTE_URL="https://github.com/rshekhawath/mindforgecapital.com.git"

git --git-dir="$GIT_DIR" remote set-url origin "$REMOTE_URL" 2>/dev/null || git --git-dir="$GIT_DIR" remote add origin "$REMOTE_URL"
git --git-dir="$GIT_DIR" --work-tree="$WEB_DIR" add -A
git --git-dir="$GIT_DIR" --work-tree="$WEB_DIR" commit -m "Deploy: remove factor labels, trim charts ($TODAY)"
git --git-dir="$GIT_DIR" push --force origin HEAD:main

if [ $? -eq 0 ]; then
    echo ""
    echo -e "${GREEN}${BOLD}✅  Done! mindforgecapital.com will update in 1–2 minutes.${NC}"
else
    echo -e "${RED}✗  Push failed — check credentials above.${NC}"
fi

echo ""
read -n 1 -s -p "Press any key to close…"
echo ""
