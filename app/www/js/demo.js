/* ============================================================================
   MindForge Capital — Member App · DEMO MODE  (open with ?demo=1)
   ----------------------------------------------------------------------------
   Lets anyone click through every screen — subscriptions, the holdings
   dashboard, the allocation calculator, broker linking — with realistic SAMPLE
   data and NO login or backend. Self-gating and self-cleaning:
     • does nothing unless ?demo=1 is in the URL;
     • when you open the app normally, it wipes any leftover demo session so the
       real login flow is never polluted.
   Loaded BEFORE app.js so the seeded session + patched API are in place when the
   app boots. Harmless in production — it's inert without the flag.
   ========================================================================== */
(function () {
  "use strict";
  var DEMO_EMAIL = 'demo@mindforgecapital.com';
  var isDemo = /[?&]demo=1(?:&|$)/.test(location.search);

  function clearLeftoverDemo() {
    var s = MFCStore.getSession();
    if (s && s.email === DEMO_EMAIL) MFCStore.signOut();
  }
  if (!isDemo) { clearLeftoverDemo(); return; }

  // ── sample subscriptions (2 active + 1 expired) ────────────────────────────
  var SUBS = [
    { token: 'demo_lmc', strategy: 'MindForge LargeMidcap 250', status: 'active',  expires_at: '2026-08-01', name: 'Riya Sharma' },
    { token: 'demo_smc', strategy: 'MindForge SmallMicro 500',  status: 'active',  expires_at: '2026-07-15', name: 'Riya Sharma' },
    { token: 'demo_mc',  strategy: 'MindForge MultiCap',        status: 'expired', expires_at: '2026-02-01', name: 'Riya Sharma' }
  ];

  // ── sample holdings per subscription (so switching strategies shows variety) ─
  function S(t, c, ind, p, w) { return { ticker: t, company_name: c, industry: ind, recommended_price: p, weight_pct: w, yahoo_ticker: t + '.NS' }; }
  var STOCKS = {
    demo_lmc: [
      S('INFY','Infosys','IT Services',1543.20,10), S('TCS','Tata Consultancy Services','IT Services',3812.55,10),
      S('HDFCBANK','HDFC Bank','Banks',1672.90,10),  S('ICICIBANK','ICICI Bank','Banks',1198.40,10),
      S('RELIANCE','Reliance Industries','Oil & Gas',2945.85,10), S('LT','Larsen & Toubro','Capital Goods',3640.00,10),
      S('MARUTI','Maruti Suzuki India','Automobile',11890.00,10), S('SUNPHARMA','Sun Pharmaceutical','Pharma',1812.30,10),
      S('BHARTIARTL','Bharti Airtel','Telecom',1582.30,10), S('ITC','ITC','FMCG',471.80,10)
    ],
    demo_smc: [
      S('DIXON','Dixon Technologies','Consumer Durables',14250.00,12.5), S('POLYCAB','Polycab India','Capital Goods',6890.40,12.5),
      S('KEI','KEI Industries','Capital Goods',4120.00,12.5), S('CDSL','Central Depository Services','Financial Services',1560.00,12.5),
      S('BSE','BSE Ltd','Financial Services',2890.00,12.5), S('RADICO','Radico Khaitan','FMCG',2340.00,12.5),
      S('APARINDS','Apar Industries','Capital Goods',9850.00,12.5), S('JYOTHYLAB','Jyothy Labs','FMCG',485.00,12.5)
    ]
  };

  // ── patch the API with demo data (no network) ──────────────────────────────
  MFCApi.requestOtp = function () { return Promise.resolve({ status: 'ok' }); };
  MFCApi.verifyOtp  = function () { return Promise.resolve({ status: 'ok', subscriptions: SUBS }); };
  MFCApi.stocks     = function (token) {
    var list = STOCKS[token] || STOCKS.demo_lmc;
    var sub  = SUBS.filter(function (s) { return s.token === token; })[0] || SUBS[0];
    // brief delay so the skeleton loader is visible, like the real fetch
    return new Promise(function (res) { setTimeout(function () { res({ status: 'ok', subscription: sub, stocks: list }); }, 320); });
  };
  MFCApi.prices = function () { return Promise.resolve({ status: 'ok', prices: {} }); };

  // ── seed a demo session so the app opens straight to the dashboard ─────────
  MFCStore.setSession(DEMO_EMAIL, SUBS);

  // ── a small "DEMO" badge so it's obvious the data is sample ────────────────
  document.addEventListener('DOMContentLoaded', function () {
    var b = document.createElement('div');
    b.textContent = 'DEMO';
    b.setAttribute('aria-hidden', 'true');
    b.style.cssText = 'position:fixed;z-index:200;left:10px;' +
      'bottom:calc(var(--tabbar-h,62px) + env(safe-area-inset-bottom,0px) + 12px);' +
      'background:#d97706;color:#fff;font:800 10px/1 -apple-system,BlinkMacSystemFont,sans-serif;' +
      'letter-spacing:.12em;padding:5px 9px;border-radius:7px;box-shadow:0 6px 16px -6px rgba(0,0,0,.45);pointer-events:none;';
    document.body.appendChild(b);
  });
})();
