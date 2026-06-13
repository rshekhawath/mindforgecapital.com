# MindForge Capital — Subscriber App: Detailed Plan

_Last updated: 2026-06-08 · Status: PROPOSAL (no code yet)_

A focused build plan for a subscriber-facing app where paying members log in with
**email OR mobile OTP** and view **the stocks for the strategy/strategies they
subscribe to**, plus **screener** access — built on top of what MindForge Capital
already has, not from scratch.

---

## 1. Goal & scope

**One-line goal:** Give active subscribers an installable, mobile-first app that,
after a passwordless OTP login, shows *their* strategy holdings (allocation, live
prices, broker deeplinks) and the stock screener — gated by their subscription.

**In scope (v1)**
- Passwordless login: email OTP (exists) **+ mobile/SMS OTP (new)**.
- "My Subscriptions" home: the strategies the signed-in user actively pays for.
- "My Stocks" per strategy: holdings + weights, live prices, allocation calculator,
  broker deeplinks, last-rebalance date — i.e. the current `dashboard.html`, reframed
  as an app screen.
- Screener: the existing screener, embedded as an app tab (member experience).
- Account: subscription status, plan, renew/upgrade links, sign out.

**Out of scope (later)**
- In-app payments / checkout (keep using the website signup + Razorpay/UPI flow).
- Portfolio P&L tracking, watchlists (deliberately retired from the public screener).
- Native-only features (biometrics, widgets) — revisit once the PWA proves out.

---

## 2. What already exists (reuse — do NOT rebuild)

The backend is a **Google Apps Script** web app (`docs/apps_script.gs`) over a Google
Sheet with three tabs: `subscriptions`, `leads`, `strategy_runs`. Relevant endpoints:

| Action (GET/POST) | What it does | App use |
|---|---|---|
| `request_otp(email)` | Generates 6-digit OTP, stores in `PropertiesService` (expiry + attempt counter), emails via `MailApp` | **Email login** (reuse as-is) |
| `verify_otp(email, otp)` | Validates OTP, returns the subscriber's dashboard token(s) | **Email login** (reuse) |
| `stocks(token)` → `handleGetStocks` | Looks up subscription by **token**, returns that strategy's holdings | **My Stocks** screen |
| `prices(tickers)` → `handleGetPrices` | Live quotes for a ticker list | Live price refresh |
| `recover(email, phone)` | Emails all active dashboards for a person | Fallback / "email me my links" |
| `activate` / `decline` / `save_lead` / `subscribe` | Admin + signup lifecycle | Unchanged |

Other reusable assets:
- **Auth UI already built:** `docs/login.html` is a 2-step **email-OTP** flow (enter
  email → 6-digit code → redirect to `dashboard.html?token=…`). The app's email path
  is essentially this, restyled.
- **Per-subscription token model:** `subscriptions` sheet column A is a `token`; it is
  the bearer key the dashboard already uses. We keep this under the hood.
- **The subscriber dashboard** (`docs/dashboard.html`) is the holdings UI to port.
- **The screener** (`docs/screener/`) is static, client-side, already mobile-first with
  the new main-site nav + hamburger (V8.5).
- **PWA scaffolding:** `docs/manifest.json` + `docs/sw.js` (network-first HTML,
  cache-first assets) already exist — the app can be a PWA with minimal new plumbing.
- **Phone numbers on file:** the `leads`/`subscriptions` data already stores mobile
  numbers (e.g. +91…), so mobile-OTP has data to match against.

**Implication:** ~80–90% of the backend exists. The real new work is (a) **mobile/SMS
OTP**, (b) an **app shell** that ties login → subscriptions → stocks → screener, and
(c) turning a per-*subscription* token into a per-*user* session.

---

## 3. Gaps to build

1. **Mobile/SMS OTP** — new `request_otp`/`verify_otp` paths keyed by phone, delivered
   via an SMS provider (see §6). Mirror the existing email-OTP storage/expiry/attempt
   logic so both channels share one code path.
2. **"List my subscriptions" endpoint** — given a verified email *or* phone, return the
   set of active strategies + their tokens (today `verify_otp` is email-centric and the
   dashboard is one-token-per-link). New action e.g. `my_subscriptions(session)`.
3. **Session tokens** — after OTP success, issue a short-lived **session token** (opaque
   random or signed) representing the *person*, separate from the long-lived
   per-subscription dashboard tokens. Map session → email/phone → active subscriptions.
4. **App shell** — installable PWA with bottom-tab navigation (Home · Stocks · Screener ·
   Account), offline-aware, matching mindforgecapital.com's design system.
5. **Subscription gating in the UI** — show only the strategies the user pays for; show
   a clean upsell for the rest.

---

## 4. Architecture (recommended)

```
   ┌─────────────────────────────────────────────┐
   │  PWA  (docs/app/  →  app.mindforgecapital.com)│
   │  · Login (email | mobile OTP)                 │
   │  · Home: my subscriptions                     │
   │  · Stocks: holdings + live prices + calc      │
   │  · Screener (existing, embedded)              │
   │  · Account                                    │
   └───────────────┬───────────────────────────────┘
                   │  fetch (HTTPS)
        ┌──────────┴───────────┐
        │                      │
   ┌────▼──────────┐     ┌─────▼───────────────┐
   │ Apps Script   │     │ SMS provider        │
   │ (existing)    │     │ (MSG91 / Twilio)    │
   │ OTP, stocks,  │◄────┤ send mobile OTP     │
   │ prices, subs  │     └─────────────────────┘
   │  + Google Sheet DB                          │
   └─────────────────────────────────────────────┘
   stocks.json (screener snapshot, static on Pages/CDN)
```

**Why PWA-first (vs native):**
- Reuses the existing GitHub Pages hosting, Apps Script backend, design system, and
  service worker. Ship in weeks, not months.
- One codebase, installable on iOS/Android ("Add to Home Screen") and desktop.
- Can be wrapped later with **Capacitor** for real App Store / Play Store presence
  without a rewrite (same web code in a native shell; unlocks push, biometrics).

**Hosting:** serve the app under `docs/app/` (e.g. `mindforgecapital.com/app`) or a
subdomain `app.mindforgecapital.com` (CNAME). Keeps the single-repo, push-to-deploy
workflow.

**Stack (kept deliberately light):**
- Vanilla JS + a tiny router, or a small framework (Preact/Svelte) if we want components.
  Given the current site is hand-authored HTML/CSS/JS, **vanilla + a few modules** keeps
  it consistent and dependency-free.
- No new database — the Google Sheet + `PropertiesService` remain the store. If/when
  scale or query needs grow, migrate the DB to Firebase/Supabase behind the same API.

---

## 5. Authentication design (email OR mobile OTP)

**Unified OTP flow** (one screen, choose channel):

```
1. User enters email OR mobile number.
2. App → request_otp(channel, identifier)
       · email  → existing MailApp send
       · mobile → SMS provider send (NEW)
   Store {otp, expiry=10min, attempts=0} keyed by identifier (shared logic).
3. User enters 6-digit code.
4. App → verify_otp(channel, identifier, otp)
       · validate, decrement attempts, expire on use
       · on success → create SESSION token, look up active subscriptions
5. Return { session, subscriptions:[{strategy, token, status, renews_on}] }
6. App stores session (localStorage / secure cookie); routes to Home.
```

**Session & security**
- Session token: opaque 128-bit random (or signed JWT) with a sane TTL (e.g. 30 days,
  sliding). Stored server-side in `PropertiesService`/sheet → session→identifier map.
- Keep the per-subscription `token` server-side; the app calls `stocks` using the
  subscription token it received, but the **session** is what's persisted on device.
- **Rate limiting** on `request_otp` (per identifier + per IP): e.g. 5 sends/hour,
  60-second resend cooldown — critical for SMS (cost + abuse).
- **Attempt lockout**: max 5 verify attempts per code (the email flow already counts
  attempts — extend it).
- Phone normalization to E.164 (+91…) before matching the subscriptions/leads data.
- Don't leak existence: identical "code sent" response whether or not the identifier is
  a known subscriber; only reveal subscription status *after* successful verification.

**Matching to subscriptions**
- Email → match `subscriptions.email`.
- Mobile → match the phone column in `leads`/`subscriptions`. (Decision: confirm phone is
  stored consistently; backfill/normalize if not — see §10.)

---

## 6. SMS provider (the one genuinely new dependency)

| Option | Notes | Fit |
|---|---|---|
| **MSG91** | India-first, cheap INR pricing, OTP-specific API + DLT-template support (mandatory for India SMS) | **Recommended** for +91 base |
| **Twilio Verify** | Global, robust, turnkey OTP, slightly pricier; handles compliance | Good if international users appear |
| **AWS SNS** | Cheap but you build ret/expiry yourself; DLT setup manual | Only if already on AWS |

India specifics: SMS to Indian numbers requires **DLT registration** (sender ID +
templates) — factor ~1–2 weeks lead time with the provider. MSG91 streamlines this.

Apps Script can call the provider's REST API via `UrlFetchApp` — no new server needed.

---

## 7. Screens / feature detail

1. **Login** — channel toggle (Email · Mobile), identifier input, OTP step, resend
   cooldown, error states. Restyle of `login.html`.
2. **Home — My Subscriptions** — cards for each active strategy (name, status, next
   rebalance, "View stocks"); upsell cards for strategies not subscribed.
3. **Stocks (per strategy)** — port of `dashboard.html`: holdings table with weights,
   live prices (`prices`), allocation calculator (capital → per-stock ₹/qty), broker
   deeplinks, last updated. Honors the V8.5 MultiAsset reprice (₹499, min ₹5,00,000).
4. **Screener** — the existing screener as a tab (full filters for members). Decision:
   members-only vs same as public (§10).
5. **Account** — identifier, plan(s), renew/upgrade (links to website signup), "email me
   my dashboard links" (reuse `recover`), sign out, support/WhatsApp.

**Cross-cutting:** bottom tab bar, pull-to-refresh on prices, offline banner (SW),
skeleton loaders (reuse the screener's), the V8.5 nav/branding for visual consistency.

---

## 8. Data model (reuse + additions)

- **`subscriptions`** (exists): token, email, strategy, status, dates → add/confirm a
  normalized **phone** column for mobile-OTP matching.
- **`PropertiesService` OTP store** (exists for email): extend to key by `email:` and
  `phone:` namespaces with the same `{otp, expiry, attempts}` shape.
- **New: `sessions`** (sheet tab or Properties): `session_token → {identifier, channel,
  created, last_seen, expiry}`.
- **No change** to `strategy_runs` (holdings source) or the screener `stocks.json`.

---

## 9. Phased roadmap

**Phase 0 — Foundations (decisions + setup)**
- Pick SMS provider, start DLT registration (long pole). Confirm phone-data quality.
- Decide hosting (`/app` vs subdomain) and screener gating.

**Phase 1 — MVP (the core ask)**
- App shell (PWA, tabs, design system).
- Unified OTP login (email reused + mobile added) + sessions + rate limiting.
- Home (my subscriptions) + Stocks (port dashboard) + Screener tab + Account.
- Ship as installable PWA at `app.mindforgecapital.com`.

**Phase 2 — Polish & retention**
- Web push: rebalance/alert notifications (Apps Script already sends rebalance emails —
  add push). Offline caching of last-known holdings. Account self-serve.

**Phase 3 — Native presence (optional)**
- Wrap with Capacitor → App Store / Play Store; native push, biometrics, app icon.
- Consider in-app renewal.

---

## 10. Open decisions (need your input)

1. **SMS provider** — MSG91 (India-optimized, recommended) vs Twilio (global)? This gates
   the DLT timeline.
2. **Screener access** — members-only inside the app, or same as the public screener?
3. **Distribution** — PWA only (fast), or commit to App Store/Play Store (Capacitor) for
   v1? (Recommend PWA first, native later.)
4. **Account model** — keep per-subscription tokens behind a per-user session
   (recommended), or one login = one strategy?
5. **Phone data** — is every subscriber's mobile stored in E.164 and reliable enough to
   be a login identifier? If not, we add a one-time "link your number" step.
6. **Hosting** — `mindforgecapital.com/app` vs `app.mindforgecapital.com`?

---

## 11. Rough effort (PWA-first, MVP)

| Workstream | Est. |
|---|---|
| SMS provider + DLT + mobile-OTP endpoint | ~1–2 wks (DLT lead time dominates) |
| Sessions + unified OTP + rate limiting (Apps Script) | ~3–5 days |
| App shell + login UI + tabs | ~3–5 days |
| Home + Stocks (port dashboard) + Account | ~1 wk |
| Screener tab integration | ~1–2 days |
| QA (desktop + iOS/Android install), polish | ~3–5 days |

**MVP ≈ 3–4 weeks of focused work**, with DLT registration running in parallel from day 1.

---

## 12. Guiding principles

- **Reuse first** — Apps Script, Sheets, OTP, dashboard, screener, PWA scaffolding all
  exist; the app assembles them.
- **One backend** — no premature DB migration; revisit only if scale demands.
- **Security on the OTP path** — rate limits, lockouts, no enumeration, E.164 hygiene.
- **Design parity** — match the V8.5 site (nav, branding, mobile-first) so the app feels
  native to MindForge Capital.
