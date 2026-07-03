# MindForge Capital — Member App

An installable **member app for iOS & Android** that lets paying subscribers sign
in, view **this cycle's strategy picks** (the dashboard), size positions, and place
orders with their **linked broker** in one tap.

Built **PWA-first** (per [`PLAN.md`](PLAN.md)) so it ships on the existing GitHub
Pages hosting + Google Apps Script backend with zero new server, and is wrapped for
the **App Store / Play Store with Capacitor** — same code, native shell.

---

## What it does

| Screen | What the member sees |
|---|---|
| **Login** | Passwordless email OTP — reuses the site's `request_otp` / `verify_otp`. |
| **Home** | "My Subscriptions" — every strategy they pay for, with live status. |
| **Holdings** | This cycle's picks: weights, rec. price, allocation calculator (capital → ₹/qty per stock), sector-coloured pills, and a **Buy on \<broker\>** deeplink per pick. This is the dashboard, reframed as an app screen. |
| **Scanner** | Opens the live Scanner + Integrity Score tools. |
| **Account** | Profile, **broker linking**, subscriptions, support, **Appearance** (Auto / Light / Dark), sign out. |

### Broker linking (the headline ask) — two tiers, both shipped
1. **Deeplink (works today, no credentials).** The member links Zerodha **Kite**,
   **Groww**, or **Upstox** once; every pick becomes a one-tap, pre-filled order
   link into that broker — identical to the website dashboard's proven deeplinks.
2. **API — live account linking (Zerodha Kite Connect).** Full OAuth → live
   holdings/funds and in-app order placement. The login redirect is built in
   (`js/brokers.js`); it activates the moment a Kite Connect **api_key** is set in
   `js/config.js`. The `request_token → access_token` exchange must run **server-side**
   (the `api_secret` must never ship in a client) — point `KITE.token_exchange_url`
   at an Apps Script / Cloud Function that does the swap. See **Enabling Kite Connect** below.

---

## Run it as a PWA (no build step)

```bash
cd app
npm run serve          # python3 -m http.server 8080 --directory www
# open http://localhost:8080  → "Add to Home Screen" on iOS/Android to install
```

It's a static, dependency-free app — any static host works. To deploy publicly,
serve `www/` at e.g. `app.mindforgecapital.com` (CNAME) or under the main site.

## Build native iOS / Android (Capacitor)

Requires Node, Xcode (iOS) and/or Android Studio (Android).

```bash
cd app
npm install
npx cap add ios          # or: npm run ios:add
npx cap add android      # or: npm run android:add
npx cap sync
npx cap open ios         # opens Xcode  → run on device/simulator, then Archive → App Store
npx cap open android     # opens Android Studio → run, then Build → Signed Bundle → Play Store
```

`webDir` is `www/`, so any edit to the web app + `npx cap sync` pushes it into both
native shells. No rewrite to go native.

---

## Architecture

```
app/
├─ www/                         ← the web app (Capacitor webDir; also the PWA root)
│  ├─ index.html                app shell (CSP, PWA meta, safe-area viewport)
│  ├─ manifest.webmanifest      installable PWA manifest
│  ├─ sw.js                     service worker (cache-first shell, network API)
│  ├─ css/app.css               brand-matched, mobile-first design system (+ system-aware dark theme)
│  ├─ js/theme.js               appearance manager (Auto/Light/Dark) — runs pre-paint, zero flash
│  ├─ js/config.js              backend URL + broker config (the one place to edit)
│  ├─ js/api.js                 Apps Script client (request_otp/verify_otp/stocks/prices)
│  ├─ js/store.js               on-device session + broker prefs (tokens never in URL)
│  ├─ js/brokers.js             broker deeplinks + Kite Connect scaffold
│  ├─ js/app.js                 hash router + the 5 screens
│  └─ assets/                   brand icons (reused from the site)
├─ capacitor.config.json        native app id/name/splash
├─ package.json                 Capacitor deps + scripts
└─ PLAN.md / README.md
```

**Backend:** unchanged. The app calls the same Apps Script `doGet` actions the
website already exposes (`request_otp`, `verify_otp`, `stocks`, `prices`, `recover`)
— all simple cross-origin GETs.

**Security:** session/broker tokens live in on-device storage **only** — never in
the URL (same hardening as the V11.4 website dashboard). The shell ships a strict
CSP (`connect-src` = self + the Apps Script backend). No broker `api_secret` is ever
present in the client.

---

## Configuration & credential-gated TODOs

Edit **`www/js/config.js`**:

- `APPS_SCRIPT_URL` — already set to the live backend. ✅
- `WHATSAPP_URL` — set to the live MindForge support line (`wa.me/917601032082`, matches the website). ✅
- **Enabling Kite Connect (live linking):**
  1. Create a Kite Connect app at <https://kite.trade> → get `api_key` + `api_secret`.
  2. Stand up a server-side token exchange (Apps Script action, e.g. `kite_exchange`)
     that takes `request_token`, signs with `api_secret`, and returns the `access_token`.
  3. In `config.js` set `KITE.enabled = true`, `KITE.api_key`, `KITE.token_exchange_url`.
  The Account screen then shows **Connect Zerodha (live)** instead of the deeplink-only note.
- **Mobile (SMS) OTP login** — the app uses email OTP today (fully working). Adding
  phone-number login needs an SMS provider + DLT templates (MSG91 recommended) and the
  matching backend action; see `PLAN.md §5–6`.

---

## Status

- ✅ Installable PWA: login, subscriptions, holdings/dashboard, allocation calculator,
  scanner links, account, **deeplink broker linking** — all working against the live backend.
- ✅ **System-aware dark mode** (V15.6): adapts to the device appearance and a member
  **Appearance** control (Auto / Light / Dark) in Account; applied pre-paint (no flash),
  persisted on-device, and follows the OS live while on Auto.
- ✅ **V18.2 visual uplift**: appbar brand hairline, sector-tinted holding rails,
  gradient-ink numerals, renewal countdown ring, OTP progress track + one-time-code
  autofill hardening, iconed toasts, styled strategy switcher, deployment-meter
  ticks, dark-mode remnant sweep.
- ✅ Capacitor-ready for App Store / Play Store (run `cap add ios|android`).
- 🔌 Gated on credentials: Kite Connect live linking (api_key), SMS OTP (provider).
  All wired — drop in the values to activate.
