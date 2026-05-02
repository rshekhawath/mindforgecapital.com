#!/bin/bash
# ════════════════════════════════════════════════════════════════
#  MindForge Capital — Push web/ to GitHub Pages
# ════════════════════════════════════════════════════════════════
#  Stages the contents of web/ AS the repo root, commits, and
#  force-pushes to origin/main so GitHub Pages serves the latest
#  HTML at mindforgecapital.com.
#
#  Auth: uses your macOS keychain credential helper (no prompt
#  if you've pushed before). Otherwise enter username:
#      rshekhawath
#  and a Personal Access Token (https://github.com/settings/tokens
#  with 'repo' scope) when prompted.
# ════════════════════════════════════════════════════════════════

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BOLD='\033[1m'; NC='\033[0m'

# This script lives in MFC/runner/ — project root is one level up.
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
WEB_DIR="$ROOT_DIR/web"
GIT_DIR="$ROOT_DIR/.git"

echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║     MindForge Capital — Push web/ to GitHub              ║${NC}"
echo -e "${BOLD}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""
echo "  Root: $ROOT_DIR"
echo "  Web:  $WEB_DIR"

# ── Ensure git is initialised ────────────────────────────────────
if [ ! -d "$GIT_DIR" ]; then
    echo "  Initialising git repo..."
    git init -b main "$ROOT_DIR"
fi

# ── Set remote ───────────────────────────────────────────────────
REMOTE_URL="https://github.com/rshekhawath/mindforgecapital.com.git"
git --git-dir="$GIT_DIR" remote add origin "$REMOTE_URL" 2>/dev/null || \
git --git-dir="$GIT_DIR" remote set-url origin "$REMOTE_URL"
echo -e "  ${GREEN}✓ Remote: $REMOTE_URL${NC}"

# ── Git user config ──────────────────────────────────────────────
git --git-dir="$GIT_DIR" config user.email "rshekhawath@gmail.com"
git --git-dir="$GIT_DIR" config user.name "Sagar Shekhawath"

# ── Stage web/ contents AS repo root ─────────────────────────────
echo ""
echo "  Staging web/ files at repo root..."
git --git-dir="$GIT_DIR" --work-tree="$WEB_DIR" reset 2>/dev/null || true
git --git-dir="$GIT_DIR" --work-tree="$WEB_DIR" add -A

STAGED=$(git --git-dir="$GIT_DIR" --work-tree="$WEB_DIR" status --short | wc -l | tr -d ' ')
echo -e "  ${GREEN}✓ $STAGED file(s) staged from web/${NC}"

# ── Commit ───────────────────────────────────────────────────────
TODAY=$(date +"%Y-%m-%d")
MSG="Site update $TODAY: refresh charts / content"

echo ""
echo "  Committing: $MSG"
git --git-dir="$GIT_DIR" --work-tree="$WEB_DIR" commit -m "$MSG" 2>&1

# ── Force push ───────────────────────────────────────────────────
echo ""
echo "  Pushing to GitHub..."
echo "  (If prompted, enter username: rshekhawath  and your Personal Access Token as password)"
echo ""
git --git-dir="$GIT_DIR" push --force origin HEAD:main

if [ $? -eq 0 ]; then
    echo ""
    echo -e "${GREEN}${BOLD}✅  Done! mindforgecapital.com will update within 1–2 minutes.${NC}"
else
    echo ""
    echo -e "${RED}✗  Push failed — check credentials above.${NC}"
    echo "  Create a token at: https://github.com/settings/tokens (needs 'repo' scope)"
fi

echo ""
read -n 1 -s -p "Press any key to close…"
echo ""
