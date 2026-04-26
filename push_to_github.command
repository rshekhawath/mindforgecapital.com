#!/bin/bash
cd ~/Desktop/SmallCases/MindForge\ Capital

# Clear any stale git locks
rm -f .git/HEAD.lock .git/index.lock .git/index2.lock .git/refs/heads/main.lock 2>/dev/null

# Stage all tracked files (HTML + backend)
git add index.html strategies.html \
        largemidcap.html smallmicro.html multiasset.html \
        newsletter.html privacy.html terms.html \
        dashboard.html recover.html admin.html \
        apps_script.gs mindforge_runner.py 2>/dev/null

echo ""
echo "What changed? (e.g. 'V7: fix Activate, admin notifications, fix emails')"
echo -n "> "
read MSG
if [ -z "$MSG" ]; then MSG="Update website content"; fi

git commit -m "$MSG"
git push

echo ""
echo "✅ Done! mindforgecapital.com will update within 1-2 minutes."
read -n 1
