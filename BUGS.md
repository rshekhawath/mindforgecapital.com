# BUGS.md — QA log for the July 2026 update

Scope tested: strategies.html (new per-strategy module), factor-report/ (new page),
scanner redirect fix, plus regression pass on home, screener, scores, fii-dii,
calculator, signup (pricing). Viewports: 1920×1080, 1440×900, 1024×768, 820×1180,
390×844, 360×800. Checks: layout/overflow, links, console errors, tables, touch
targets, nav/hamburger, fonts/spacing, and the Zerodha Verified P&L link.

Status legend: 🔴 open · ✅ fixed (with note)

---

## BUG-1 — Maintenance HTML comment leaked as visible text
- **Page:** strategies.html (new performance module) · **Viewport:** all
- **Description:** The `V19.5` maintenance comment quoted the literal
  `<!--MFTOP…-->` / `<!--MFSTAT…-->` marker syntax. The nested `-->` closed the
  outer comment early, so "markers (xx = ma|lm|sm|mc|sp) … Nothing else needs to
  change. -->" rendered as visible body text above the section.
- **Also affected:** factor-report/index.html (same pattern with `<!--FR:*-->`).
- ✅ **Fixed:** rewrote both maintenance comments to describe the markers as
  "MFTOP:xx:N:field comment markers" / "FR: comment markers" without nested
  `<!-- -->` delimiters. Verified the stray text no longer renders.

## BUG-2 — FII/DII page missing the new "Factor Report" nav link
- **Page:** fii-dii/index.html · **Viewport:** all
- **Description:** The site-wide nav-insertion pass keyed off each page's
  `href="…fii-dii/"` link. On the FII/DII page itself that link is the *active*
  `href="index.html"` form, so the pass skipped it — leaving the FII/DII page as
  the only nav missing "Factor Report" (nav inconsistency).
- ✅ **Fixed:** manually inserted `<a href="../factor-report/">Factor Report</a>`
  after the active FII/DII link. Now every primary page's nav is consistent.

## BUG-3 — New surfaces stayed white in dark mode
- **Pages:** strategies.html (`.ps-card`, `.ps-funds`, `.ps-tab`) and
  factor-report/index.html (`.fr-use`, `.fr-arch-item`) · **Viewport:** all (dark theme)
- **Description:** The site's dark mode flips card surfaces to `#121d33` via
  `[data-theme="dark"]`. The new module/page hardcoded `background:#fff`, so with
  dark mode on, those cards rendered glaring white on the dark background while
  the rest of the page went dark.
- ✅ **Fixed:** added `[data-theme="dark"]` overrides flipping the new surfaces to
  `var(--ink2)` with `--border2` borders, plus brighter green/red accents
  (`#34d399` / `#f87171`) for the perf/factor values. Verified: `.ps-card`,
  `.ps-funds`, `.fr-use` now compute to `rgb(18,29,51)` in dark; body dark; text
  light. (`.sp-gate` was already handled by mfc-finish.css.)

---

## Validation pass (Step 4) — all items re-tested at the failing viewport + full regression

| # | Re-test | Result |
|---|---------|--------|
| BUG-1 | strategies.html body text, all viewports | fixed — no leaked comment text |
| BUG-2 | fii-dii nav | fixed — Factor Report present, `../factor-report/`, correct order |
| BUG-3 | strategies + factor-report, dark theme | fixed — cards flip to `#121d33`, values readable |

### Full page × viewport matrix (no layout breaks / no horizontal overflow / no console errors)
Pages: home · strategies · screener(Scanner) · scores · fii-dii · calculator · signup(pricing) · factor-report
Viewports: 1920×1080 · 1440×900 · 1025/1024×768 · 820×1180 · 390×844 · 360×800

- **strategies.html** — per-strategy module: 5 tabs switch correctly, gate blur works
  on the 4 paid books, MultiAsset shows all 8 ETFs ungated (free), MFTOP/MFSTAT markers
  all resolve (no raw text), grid is 2-col ≥1025 and stacks ≤920, tabs horizontally
  scroll on phones. No overflow at any width. Dark mode verified.
- **factor-report/** — hero, scoreboard (diverging bars ≥640, hidden ≤640), commentary,
  "how we use it", archive (1 current edition), methodology/sources render; nav active
  = Factor Report; CTA → strategies.html. No overflow. Dark mode verified.
- **Scanner 404 fix** — `/scanner`, `/scanner/`, `/scanner.html` all resolve (no 404) and
  the browser lands on `/screener/` (redirect executes).
- **Nav consistency** — "Factor Report" now on all 18 primary pages + the FII/DII page +
  its own active state. Full nav fits on one row at 1025px (no wrap to a 2nd row);
  hamburger ≤1024 opens and lists Factor Report. Sitemap includes `/factor-report/`.
- **Zerodha Verified P&L link** — unchanged on index.html
  (`https://console.zerodha.com/verified/9eafe0ef`, `target=_blank`), still present and
  working after the Strategies changes.
- **Regression** — home, calculator, screener, scores, fii-dii, signup, multiasset detail:
  no console errors, no horizontal overflow, nav consistent, hamburger works.

**All items verified — clear to deploy.**
