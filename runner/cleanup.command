#!/bin/bash
# ════════════════════════════════════════════════════════════════
#  MindForge Capital — Cleanup
# ════════════════════════════════════════════════════════════════
#  Removes strategy output PNGs/CSVs, Python cache, and macOS junk
#  so the project is in a clean state before re-running backtests.
#
#  Safe to run anytime — does NOT touch source code, HTML, web/,
#  team photos, or git state.
# ════════════════════════════════════════════════════════════════

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BOLD='\033[1m'; NC='\033[0m'

# This script lives in MFC/runner/ — project root is one level up.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║     MindForge Capital — Project Cleanup                  ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""
echo "  Root: $ROOT_DIR"
echo ""

REMOVED=0

# ── 1. Strategy output files ─────────────────────────────────────
echo "[ 1 ] Clearing strategy outputs..."

for strategy in largemidcap smallmicro multiasset; do
    OUT="$ROOT_DIR/strategies/$strategy/outputs"
    if [ -d "$OUT" ]; then
        COUNT=$(find "$OUT" -type f | wc -l | tr -d ' ')
        if [ "$COUNT" -gt 0 ]; then
            find "$OUT" -type f -delete
            echo -e "    ${RED}✗${NC}  strategies/$strategy/outputs/ ($COUNT files removed)"
            REMOVED=$((REMOVED + COUNT))
        else
            echo -e "    ${GREEN}✓${NC}  strategies/$strategy/outputs/ (already empty)"
        fi
    fi
done

# ── 2. Python cache ──────────────────────────────────────────────
echo ""
echo "[ 2 ] Removing Python __pycache__ and .pyc files..."

CACHE_COUNT=$(find "$ROOT_DIR" -type d -name "__pycache__" 2>/dev/null | wc -l | tr -d ' ')
find "$ROOT_DIR" -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
find "$ROOT_DIR" -name "*.pyc" -delete 2>/dev/null || true

if [ "$CACHE_COUNT" -gt 0 ]; then
    echo -e "    ${RED}✗${NC}  $CACHE_COUNT __pycache__ director(ies) removed"
    REMOVED=$((REMOVED + CACHE_COUNT))
else
    echo -e "    ${GREEN}✓${NC}  No cache directories found"
fi

# ── 3. macOS junk ────────────────────────────────────────────────
echo ""
echo "[ 3 ] Removing macOS .DS_Store files..."

DS_COUNT=$(find "$ROOT_DIR" -name ".DS_Store" 2>/dev/null | wc -l | tr -d ' ')
find "$ROOT_DIR" -name ".DS_Store" -delete 2>/dev/null || true

if [ "$DS_COUNT" -gt 0 ]; then
    echo -e "    ${RED}✗${NC}  $DS_COUNT .DS_Store file(s) removed"
    REMOVED=$((REMOVED + DS_COUNT))
else
    echo -e "    ${GREEN}✓${NC}  No .DS_Store files found"
fi

# ── Done ─────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}════════════════════════════════════════════════════════════${NC}"
if [ "$REMOVED" -gt 0 ]; then
    echo -e "  ${GREEN}${BOLD}✅  Done.${NC} $REMOVED item(s) removed. Ready for fresh backtest run."
else
    echo -e "  ${GREEN}${BOLD}✅  Already clean.${NC} Nothing to remove."
fi
echo -e "${BOLD}════════════════════════════════════════════════════════════${NC}"
echo ""
echo "  Next step: double-click runner/run_backtests.command"
echo ""
read -n 1 -s -p "Press any key to close…"
echo ""
