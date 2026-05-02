#!/bin/bash
# ════════════════════════════════════════════════════════════════
#  MindForge Capital — Commit restructuring + run LargeMidcap backtest
# ════════════════════════════════════════════════════════════════

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BOLD='\033[1m'; NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║  MindForge Capital — Commit + LargeMidcap Backtest       ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""

# ── Git config ───────────────────────────────────────────────────
git config user.email "rshekhawath@gmail.com"
git config user.name "Sagar Shekhawath"

# ── Remove stale lock if present ────────────────────────────────
if [ -f ".git/index.lock" ]; then
    echo "  Removing stale .git/index.lock..."
    rm -f ".git/index.lock"
fi

# ── Stage all changes ───────────────────────────────────────────
echo "  Staging all changes..."
git add -A
if [ $? -ne 0 ]; then
    echo -e "  ${RED}✗ git add failed${NC}"
    read -n 1 -s -p "Press any key to close…"; echo ""; exit 1
fi
echo -e "  ${GREEN}✓ Files staged${NC}"

# Show summary
STAGED=$(git status --short | wc -l | tr -d ' ')
echo "  $STAGED file(s) changed"
echo ""

# ── Commit ───────────────────────────────────────────────────────
COMMIT_MSG="Restructure project: move web/ runner/ shared/ strategies/ + fix LargeMidcap Best/Worst Month formatting bug

- Reorganised repo: HTML/assets -> web/, Python code -> strategies/ shared/ runner/
- Added .gitignore, .env.example, docs/, team/ folders
- Fixed Best Month / Worst Month double-percent bug in strategies/largemidcap/backtest.py
  (was using :.1% on values already in % form, causing 14.3% to display as 1430%)"

echo "  Committing..."
git commit -m "$COMMIT_MSG"
if [ $? -ne 0 ]; then
    echo -e "  ${YELLOW}⚠ Nothing to commit or commit failed${NC}"
else
    echo -e "  ${GREEN}✓ Committed successfully${NC}"
fi

echo ""
echo -e "${BOLD}━━━ Running LargeMidcap Backtest ━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo "  Downloading 250 tickers + running 5-factor model…"
echo "  (This takes 5–8 minutes — please wait)"
echo ""

# ── Install deps quietly ─────────────────────────────────────────
pip3 install pandas openpyxl yfinance numpy scipy matplotlib python-dateutil --break-system-packages -q 2>/dev/null || true

python3 "$ROOT_DIR/strategies/largemidcap/backtest.py"
if [ $? -eq 0 ]; then
    echo ""
    echo -e "  ${GREEN}✓ LargeMidcap backtest complete${NC}"
else
    echo -e "  ${RED}✗ LargeMidcap backtest FAILED${NC}"
    read -n 1 -s -p "Press any key to close…"; echo ""; exit 1
fi

echo ""
echo -e "${BOLD}━━━ Embedding charts into website HTML ━━━━━━━━━━━━━━━━━━━━${NC}"
python3 "$ROOT_DIR/runner/update_charts.py"
if [ $? -eq 0 ]; then
    echo -e "  ${GREEN}✓ Website HTML updated${NC}"
else
    echo -e "  ${RED}✗ HTML update FAILED${NC}"
    read -n 1 -s -p "Press any key to close…"; echo ""; exit 1
fi

echo ""
echo -e "${BOLD}━━━ Pushing to GitHub (live website) ━━━━━━━━━━━━━━━━━━━━━━${NC}"

GIT_DIR="$ROOT_DIR/.git"
WEB_DIR="$ROOT_DIR/web"
REMOTE_URL="https://github.com/rshekhawath/mindforgecapital.com.git"

git --git-dir="$GIT_DIR" remote add origin "$REMOTE_URL" 2>/dev/null || \
git --git-dir="$GIT_DIR" remote set-url origin "$REMOTE_URL"

git --git-dir="$GIT_DIR" --work-tree="$WEB_DIR" reset 2>/dev/null || true
git --git-dir="$GIT_DIR" --work-tree="$WEB_DIR" add -A

TODAY=$(date +"%Y-%m-%d")
git --git-dir="$GIT_DIR" --work-tree="$WEB_DIR" commit -m "Backtest update $TODAY: fix Best/Worst Month display + refresh LargeMidcap charts"

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
