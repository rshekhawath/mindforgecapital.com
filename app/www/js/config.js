/* ============================================================================
   MindForge Capital — Member App · configuration
   ----------------------------------------------------------------------------
   Single source of truth for backend + broker wiring. Everything else reads
   from window.MFC_CONFIG so there is exactly one place to change endpoints.
   ========================================================================== */
window.MFC_CONFIG = {
  // The existing Google Apps Script backend (same one the website uses).
  // doGet actions used by this app: request_otp, verify_otp, stocks, prices, recover.
  APPS_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbxOAkgF6naSDlx8q4mt1n3vJvd1gywpYT_iiYvt94ddYeqaniNI4ggM7idJTJHhA6RH8w/exec',

  // The public website (used for the Scanner tab, signup/upsell, support links).
  SITE_URL: 'https://mindforgecapital.com',
  SCREENER_URL: 'https://mindforgecapital.com/screener/',
  SIGNUP_URL: 'https://mindforgecapital.com/signup.html',
  WHATSAPP_URL: 'https://wa.me/919999999999', // TODO: confirm the real support number

  // Session
  SESSION_KEY: 'mfc_app_session_v1',
  BROKER_KEY: 'mfc_app_broker_v1',
  OTP_RESEND_COOLDOWN_S: 45,

  // ── Broker linking ────────────────────────────────────────────────────────
  // Two tiers, both shipped:
  //   1) DEEPLINK (works today, no credentials) — opens the user's chosen broker
  //      with the order pre-filled. This is "broker linked" in the practical
  //      sense subscribers care about: one tap from a pick to a pre-filled order.
  //   2) API (Kite Connect) — true account linking (OAuth → live holdings/funds,
  //      in-app order placement). Wired up in brokers.js but GATED on the user
  //      supplying their own Kite Connect api_key/secret (see KITE below).
  KITE: {
    enabled: false,                 // flip to true once api_key + a token backend exist
    api_key: '',                    // ← your Kite Connect app api_key (kite.trade)
    // The Kite Connect login → request-token flow must be exchanged for an
    // access_token server-side (the api_secret must never ship in the client).
    // Point this at an Apps-Script/Cloud-Function endpoint that does the exchange.
    token_exchange_url: ''          // e.g. https://script.google.com/.../exec?action=kite_exchange
  }
};
