#!/bin/bash
# ════════════════════════════════════════════════════════════════
#  MindForge Capital — END-TO-END PIPELINE (one click)
# ════════════════════════════════════════════════════════════════
#  Runs the full refresh-and-deploy cycle:
#
#    1. Cleanup       → clear stale outputs, caches, .DS_Store
#    2. Run backtests → all 3 strategies + embed PNG charts in HTML
#    3. Push          → stage web/ AS repo root, commit & push to
#                       origin/main (GitHub Pages → mindforgecapital.com)
#
#  Use this when you want a complete refresh.
#  For granular control, run the individual scripts in the same
#  folder instead (cleanup.command / run_backtests.command /
#  push_to_github.command).
# ════════════════════════════════════════════════════════════════

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BOLD='\033[1m'; NC='\033[0m'

# This script lives in MFC/runner/ — project root is one level up.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR"

echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║   MindForge Capital — End-to-End Refresh & Deploy        ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""
echo "  Root: $ROOT_DIR"
echo ""

START_TS=$(date +%s)
STAGE_FAIL=""

run_stage() {
    local label="$1"; local script="$2"
    echo ""
    echo -e "${BOLD}━━━ $label ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    # Drive child .command scripts non-interactively (skip 'press any key')
    bash "$script" </dev/null
    if [ $? -ne 0 ]; then
        STAGE_FAIL="$label"
        return 1
    fi
    return 0
}

# ── Stage 1: Cleanup ─────────────────────────────────────────────
run_stage "STAGE 1 / 3 — Cleanup" "$SCRIPT_DIR/cleanup.command"

# ── Stage 2: Backtests + chart embed ─────────────────────────────
if [ -z "$STAGE_FAIL" ]; then
    run_stage "STAGE 2 / 3 — Backtests + chart embed" "$SCRIPT_DIR/run_backtests.command"
fi

# ── Stage 3: Push ────────────────────────────────────────────────
if [ -z "$STAGE_FAIL" ]; then
    run_stage "STAGE 3 / 3 — Push to GitHub Pages" "$SCRIPT_DIR/push_to_github.command"
fi

END_TS=$(date +%s)
ELAPSED=$((END_TS - START_TS))
MIN=$((ELAPSED / 60)); SEC=$((ELAPSED % 60))

echo ""
echo "═══════════════════════════════════════════════════════════"
if [ -z "$STAGE_FAIL" ]; then
    echo -e "${GREEN}${BOLD}✅  Pipeline complete in ${MIN}m ${SEC}s${NC}"
    echo ""
    echo "    mindforgecapital.com will update within 1–2 minutes."
else
    echo -e "${RED}${BOLD}✗  Pipeline halted at: $STAGE_FAIL${NC}"
    echo "    Fix the errors above and re-run."
fi
echo "═══════════════════════════════════════════════════════════"
echo ""
read -n 1 -s -p "Press any key to close…"
echo ""
