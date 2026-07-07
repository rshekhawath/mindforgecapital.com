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

---

# Round 2 — second deep QA pass (desktop / iPad / mobile)

## BUG-4 — Top-nav labels wrapped to two lines at 1025–1400px (regression from the 8th nav item)
- **Pages:** every page with the primary nav · **Viewport:** ~1025–1400px (desktop/laptop)
- **Description:** Adding the 9th nav item ("Factor Report") pushed the row past the width
  where all labels fit on one line, so 5 two-word labels (Integrity Score, Factor Report,
  Fee Calculator, Recover Access, Sign In) each wrapped onto two lines — uneven, unpolished.
  Measured: with the Factor Report link hidden, nothing wrapped; with it shown, 5 items
  wrapped at 1280. Some pages (fii-dii, factor-report) already had inline `nowrap` while
  others didn't — an inconsistency too.
- ✅ **Fixed:** added a `V19.6 nav-fit` rule to the shared `assets/mfc-finish.css` —
  `@media(min-width:1025px){.nav-links{gap:16px}}` + `.nav-links a:not(.nav-cta){white-space:nowrap}`
  (gap change scoped to desktop so the ≤1024 mobile dropdown is untouched). Bumped the
  cache-busting version `?v=1750 → ?v=1760` on all 22 pages. Verified across index /
  strategies / dashboard / company / factor-report at 1025–1440: single-row nav, no wrap,
  no overflow; hamburger still ≤1024. (The nav also normalizes the inline-nowrap inconsistency.)

## BUG-5 — Strategies module tabs were a 36px touch target on phones
- **Page:** strategies.html `.ps-tab` · **Viewport:** ≤600px (mobile)
- **Description:** The per-strategy tab pills were 36px tall — under the ~44px touch-target
  guideline for primary mobile controls.
- ✅ **Fixed:** `@media(max-width:600px){.ps-tab{min-height:44px}}`. Verified: tabs now 44px
  on mobile; CTA buttons already 43–44px.

## Round-2 checks that passed (no change needed)
- Strategies module — all 5 panels re-screenshotted at desktop/iPad/mobile; perf strip,
  gated picks, funds tables (incl. the 4-column S&P 500 table) all fit and read correctly;
  no overflow; MultiAsset free/ungated variant correct.
- Factor report — scoreboard bars, commentary, "how we use it" 2×2 grid, archive (current
  edition + first-edition note), methodology/sources, footer all render clean at
  desktop/mobile; bars hidden ≤640 and the rows still read well.
- Nav fix regression — dashboard (7-item nav) and company pages (7-item + Portfolio button)
  fit with no overflow under the new gap; Zerodha Verified P&L link still intact on the homepage.
- Note (pre-existing, not changed): the per-stock company pages use a deliberately trimmed
  nav (Portfolio button; no FII/DII / Factor Report / Sign In) — left as-is, out of scope.
- Minor/left as-is: perf-strip "5-yr CAGR X.X% vs Y.YY%" mixes 1- and 2-decimal figures —
  this mirrors the source stats + the compare table on the same page, so kept consistent.

**Round-2 items verified — clear to deploy.**
