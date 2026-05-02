# MindForge Capital — runner/

Single source for every operational script. Double-click any `.command`
file in Finder; it opens in Terminal and runs.

## End-to-end (one click)

| Script | What it does |
|---|---|
| `run_all.command` | Cleanup → backtests + chart embed → push to GitHub Pages. Use this when you want a complete refresh. |

## Individual stages

| Script | What it does |
|---|---|
| `cleanup.command` | Clears `strategies/*/outputs/`, Python `__pycache__`, `*.pyc`, and `.DS_Store`. Source code, HTML, web/, team photos, and git state are untouched. |
| `run_backtests.command` | Installs Python deps, runs `backtest.py` for LargeMidcap, SmallMicro, MultiAsset, then runs `update_charts.py` to embed the new PNGs into `web/*.html`. |
| `update_charts.py` | (Python, called by `run_backtests.command`.) Replaces `<img src="data:image/...">` tags in `web/strategies.html`, `web/largemidcap.html`, `web/smallmicro.html`, `web/multiasset.html` with base64-encoded PNGs from `strategies/*/outputs/`. |
| `push_to_github.command` | Stages `web/` AS the repo root, commits, force-pushes to `origin/main`. GitHub Pages then serves the new site at mindforgecapital.com within ~1–2 minutes. |
| `mindforge_runner.py` | Subscriber-dashboard refresh: rebuilds NSE universes, runs multi-factor scoring, validates against each strategy's `portfolio_builder.py`, posts validated picks to Google Sheets via the Apps Script webhook. Run **manually** before activating subscribers — not part of the website pipeline. Requires `MINDFORGE_APPS_SCRIPT_URL` in `.env`. |

## Typical workflows

**Backtest images / strategy display refresh →**
`run_backtests.command` (charts embed automatically), then `push_to_github.command`.
Or just `run_all.command` for the whole thing.

**Wording / HTML edits only →**
Edit files in `web/`, then `push_to_github.command`.

**Subscriber dashboard refresh →**
`python3 runner/mindforge_runner.py` (separate from the website pipeline).

## Layout assumptions

All scripts compute project root as one level above their own directory:

```
MFC/
├── runner/                ← scripts live here
│   ├── run_all.command
│   ├── cleanup.command
│   ├── run_backtests.command
│   ├── push_to_github.command
│   ├── update_charts.py
│   └── mindforge_runner.py
├── shared/                ← strategy config & engine
├── strategies/
│   ├── largemidcap/{backtest.py, portfolio_builder.py, universe.xlsx, outputs/}
│   ├── smallmicro/{...}
│   └── multiasset/{...}
├── web/                   ← what GitHub Pages serves (HTML, assets, CNAME)
└── .git/, .env, .env.example, .gitignore, docs/, team/
```
