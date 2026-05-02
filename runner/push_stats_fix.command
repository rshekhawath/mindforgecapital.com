#!/bin/bash
# ════════════════════════════════════════════════════════════════
#  MindForge Capital — Push stats-fix commit to GitHub Pages
# ════════════════════════════════════════════════════════════════

GREEN='\033[0;32m'; RED='\033[0;31m'; BOLD='\033[1m'; NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║  MindForge Capital — Deploy Stats Fix to GitHub Pages    ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""

git config user.email "rshekhawath@gmail.com"
git config user.name "Sagar Shekhawath"
[ -f ".git/index.lock" ] && rm -f ".git/index.lock"
[ -f ".git/HEAD.lock"  ] && rm -f ".git/HEAD.lock"

GIT_DIR="$ROOT_DIR/.git"
WEB_DIR="$ROOT_DIR/web"
REMOTE_URL="https://github.com/rshekhawath/mindforgecapital.com.git"

git --git-dir="$GIT_DIR" remote set-url origin "$REMOTE_URL" 2>/dev/null || \
git --git-dir="$GIT_DIR" remote add origin "$REMOTE_URL"

git --git-dir="$GIT_DIR" --work-tree="$WEB_DIR" add -A

TODAY=$(date +"%Y-%m-%d")
git --git-dir="$GIT_DIR" --work-tree="$WEB_DIR" commit -m "Deploy: fix all hardcoded stats to match latest backtest ($TODAY)" 2>/dev/null || \
  echo "  (nothing new to stage — commit already captured)"

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
