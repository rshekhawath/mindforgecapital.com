#!/usr/bin/env python3
"""
git_push_updates.py
====================
Commits and pushes the latest backtest chart updates to GitHub.
Run this once after update_html_charts.py has been executed.
"""

import subprocess
import sys
import os
from pathlib import Path
from datetime import datetime

# ── Locate the git repo ───────────────────────────────────────────────────────
# Try the web/ folder first, then the MFC root
icloud = Path.home() / "Library" / "Mobile Documents" / "com~apple~CloudDocs"
CANDIDATES = [
    Path(__file__).parent,           # web/ folder
    Path(__file__).parent.parent,    # MFC/ root
    Path.home() / "Desktop" / "SmallCases" / "MindForge Capital",
    Path.home() / "Desktop" / "MFC",
    Path.home() / "Desktop" / "MFC" / "web",
    icloud / "Desktop" / "SmallCases" / "MindForge Capital",
    icloud / "Desktop" / "MFC",
    icloud / "Desktop" / "MFC" / "web",
    icloud / "SmallCases" / "MindForge Capital",
]

def find_git_root():
    # Check explicit candidates first
    for path in CANDIDATES:
        if path.exists() and (path / ".git").exists():
            return path
    # git rev-parse fallback on each candidate
    for path in CANDIDATES:
        if path.exists():
            result = subprocess.run(
                ["git", "-C", str(path), "rev-parse", "--show-toplevel"],
                capture_output=True, text=True
            )
            if result.returncode == 0:
                return Path(result.stdout.strip())
    # Broad search: find any .git folder under ~/Desktop
    desktop = Path.home() / "Desktop"
    try:
        for item in desktop.rglob(".git"):
            if item.is_dir():
                candidate = item.parent
                # Check if this repo contains the HTML files we care about
                html_check = any(
                    (candidate / f).exists() or (candidate / "web" / f).exists()
                    for f in ["strategies.html", "index.html"]
                )
                if html_check:
                    return candidate
    except PermissionError:
        pass
    return None

print("Searching for git repository...")
for p in CANDIDATES:
    status = "✓ exists" if p.exists() else "✗ missing"
    git_status = "  [.git ✓]" if (p / ".git").exists() else ""
    print(f"  {status}  {p}{git_status}")

git_root = find_git_root()

if git_root is None:
    print("\n✗  Could not find a git repository in any location.")
    print("   Please run push_to_github.command manually (double-click it in Finder).")
    sys.exit(1)

print(f"✓  Git root found: {git_root}")

def run(cmd, **kwargs):
    result = subprocess.run(cmd, cwd=str(git_root), capture_output=True, text=True, **kwargs)
    if result.stdout:
        print(result.stdout.rstrip())
    if result.stderr:
        print(result.stderr.rstrip())
    return result

# ── Stage HTML files ──────────────────────────────────────────────────────────
WEB = git_root / "web" if (git_root / "web").exists() else git_root

html_files = [
    "strategies.html",
    "largemidcap.html",
    "smallmicro.html",
    "multiasset.html",
    "index.html",
]

print("\nStaging updated HTML files...")
for f in html_files:
    target = WEB / f
    if target.exists():
        rel = target.relative_to(git_root)
        result = run(["git", "add", str(rel)])
        if result.returncode == 0:
            print(f"  ✓  staged {rel}")
        else:
            print(f"  ⚠  could not stage {rel}")
    else:
        # Try without the web prefix (if git root IS the web folder)
        result = run(["git", "add", f])
        if result.returncode == 0:
            print(f"  ✓  staged {f}")

# ── Check what's staged ───────────────────────────────────────────────────────
status = run(["git", "status", "--short"])
if not status.stdout and not status.stderr:
    print("\nNothing to commit — HTML files are already up to date.")
    sys.exit(0)

# ── Commit ────────────────────────────────────────────────────────────────────
today = datetime.now().strftime("%Y-%m-%d")
msg   = f"Backtest update {today}: refresh charts for LargeMidcap, SmallMicro, MultiAsset"

print(f"\nCommitting: {msg}")
commit = run(["git", "commit", "-m", msg])

if commit.returncode != 0:
    print("✗  Commit failed — see output above.")
    sys.exit(1)

# ── Push ──────────────────────────────────────────────────────────────────────
print("\nPushing to GitHub...")
push = run(["git", "push"])

if push.returncode == 0:
    print("\n✅  Done! mindforgecapital.com will update within 1–2 minutes.")
else:
    print("\n✗  Push failed — check your git credentials.")
    sys.exit(1)
