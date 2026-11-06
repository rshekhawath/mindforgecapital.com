/* mfc-dash.js — the member dashboard's main script.
   V44.3 — this was a 600 KB inline <script> in dashboard.html, so every visit and every release
   re-downloaded all of it. It now sits in this file, loaded from the very place in the page it
   used to occupy, non-deferred, so it runs at the same moment against the same DOM. The service
   worker serves it cache-first by exact URL: AFTER ANY EDIT THE ?v= IN dashboard.html MUST MOVE,
   or members keep the old code. The token is the first 8 characters of this file's sha1, and
   runner/verify_published_numbers.py refuses a release where it does not match. */
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxOAkgF6naSDlx8q4mt1n3vJvd1gywpYT_iiYvt94ddYeqaniNI4ggM7idJTJHhA6RH8w/exec';
// V11.4 security: the dashboard token is a bearer credential. Keep it OUT of the
// visible URL and browser history (OWASP best practice) — read it once, stash it,
// then strip ?token from the address bar.
// V21.0 → V21.2: PERSIST the session across navigation (was sessionStorage → died on
// tab-close/new-tab, forcing re-login on every page). V21.2 makes persistence
// BULLETPROOF: a first-party COOKIE is the primary store (survives navigation, new
// tabs and restarts, and — crucially — keeps working when localStorage throws / is
// blocked, e.g. Safari private mode or strict privacy settings, which was still
// re-logging some members out). localStorage + sessionStorage are written/read too
// (belt & suspenders + migration). Read order: cookie → localStorage → sessionStorage.
// The token still rides over HTTPS to the backend exactly as before.
const DASH_TOKEN_KEY = 'mfc_dash_token';
// V29.8 — how a strategy switch hands the new token to the page it reloads into.
// V29.7 put it in the URL (dashboard.html?token=…). That worked, and it also wrote
// the member's access tokens somewhere they must never be: sw.js caches every
// navigation response keyed by the FULL request url, so each switch left an entry
// literally named `/dashboard.html?token=MFC…` in CacheStorage on disk — three of
// them were found in one live session — and every switch also pushed a token into
// browser history. sessionStorage is the right channel: same tab, survives the
// navigation, invisible to the cache key, the history entry and any Referer.
// Consumed exactly once on the way in.
const DASH_SWITCH_KEY = 'mfc_dash_switch';
// V30.4 — the query marker a strategy switch navigates with. Carries a timestamp
// and nothing else: its only job is to make the destination URL differ from the
// current one so the navigation cannot be coalesced into a no-op (see the note in
// chooseStrategy). Stripped from the address bar on arrival, so it never
// accumulates and the NEXT switch is again a different URL from a bare
// /dashboard.html. Safe in a URL by construction — it is not a secret, and sw.js
// excludes this page from CacheStorage on pathname regardless of query.
const DASH_SWITCH_PARAM = 'sw';
// V29.7 — take the LAST match, not the first. document.cookie serves every
// cookie of a given name that matches the request (different path, different
// domain scope), most-specific first, with NO way to tell them apart. A single
// `.match()` therefore returns whichever duplicate the browser happens to list
// first — which may be a stale token from an earlier release, written at a
// different path or on a host variant. writeDashToken() below now sweeps those
// away before writing, but reading the last match makes a survivor harmless too:
// the freshly written path=/ cookie is the one that ends up last.
function _cookieGet(k){
  try {
    var re = new RegExp('(?:^|;\\s*)' + k + '=([^;]*)', 'g');
    var m, last = null;
    while ((m = re.exec(document.cookie)) !== null) last = m[1];
    return last === null ? '' : decodeURIComponent(last);
  } catch(e){ return ''; }
}
function readDashToken(){
  var c = _cookieGet(DASH_TOKEN_KEY); if (c) return c;
  try { var l = localStorage.getItem(DASH_TOKEN_KEY); if (l) return l; } catch(e){}
  try { var s = sessionStorage.getItem(DASH_TOKEN_KEY); if (s) return s; } catch(e){}
  return null;
}
// V29.7 — delete a cookie of this name on EVERY path/domain combination a past
// release could have written it to, so exactly one survives the next write.
// A cookie is identified by (name, domain, path); to remove one you must expire
// it with the SAME domain and path it was set with, and there is no API to ask
// which those were. So we expire the plausible set: the current host with no
// explicit domain (what this file has always written), the dot-prefixed
// registrable domain (what a server-set cookie would use), and the current path
// as well as root.
function _cookieNuke(k){
  try {
    var host = location.hostname;
    var parts = host.split('.');
    var domains = ['', host, '.' + host];
    if (parts.length > 2){
      var reg = parts.slice(-2).join('.');
      domains.push(reg, '.' + reg);
    }
    var paths = ['/', location.pathname, location.pathname.replace(/[^/]*$/, '')];
    var sec = (location.protocol === 'https:') ? '; Secure' : '';
    domains.forEach(function(d){
      paths.forEach(function(p){
        if (!p) return;
        var base = k + '=; max-age=0; SameSite=Lax' + sec + '; path=' + p;
        try { document.cookie = base + (d ? '; domain=' + d : ''); } catch(e){}
      });
    });
  } catch(e){}
}
function writeDashToken(t){
  _cookieNuke(DASH_TOKEN_KEY);      // V29.7: exactly one cookie of this name survives
  try {
    var sec = (location.protocol === 'https:') ? '; Secure' : '';
    // 1-year first-party cookie; Lax so it survives top-level navigations but not CSRF.
    document.cookie = DASH_TOKEN_KEY + '=' + encodeURIComponent(t) + '; path=/; max-age=31536000; SameSite=Lax' + sec;
  } catch(e){}
  try { localStorage.setItem(DASH_TOKEN_KEY, t); } catch(e){}
  try { sessionStorage.setItem(DASH_TOKEN_KEY, t); } catch(e){}
}
// V21.6: `opts.keepRegistry` preserves the strategy⇄token map. Sign-out wipes
// everything (a clean slate is intended), but a DEFINITIVE auth error on ONE token
// must NOT nuke the whole switcher — that would strand a member's other four working
// strategies over a single expired/revoked sub. The caller removes just the dead
// entry (removeStratByToken) and keeps the rest.
function clearDashSession(opts){
  opts = opts || {};
  _cookieNuke(DASH_TOKEN_KEY);      // V29.7: a sign-out that leaves a shadow cookie is the same bug
  try { document.cookie = DASH_TOKEN_KEY + '=; path=/; max-age=0; SameSite=Lax'; } catch(e){}
  try { localStorage.removeItem(DASH_TOKEN_KEY); } catch(e){}
  try { sessionStorage.removeItem(DASH_TOKEN_KEY); } catch(e){}
  if (!opts.keepRegistry) clearStratRegistry();          // V21.3: drop the saved strategy⇄token map on sign-out
  if (!opts.keepRegistry) _mfLastForget();               // V44.3: and the saved picks with it
}

// ── V21.3: STRATEGY SWITCHER — a cookie-persisted registry of the strategies this
// member can open. Each dashboard token unlocks exactly ONE strategy (an All-Access
// buyer is issued a separate token/link per strategy), so we remember every
// {strategy → token} pair the member has successfully loaded on this device. Once
// two or more are known, the "Strategy:" hero pill becomes a switcher: picking
// another strategy swaps the active mfc_dash_token cookie and reloads — no need to
// dig the other access links out of email again. Stored primarily in a first-party
// cookie (survives new tabs / restarts, and keeps working when localStorage is
// blocked — same resilience contract as the session token), mirrored to localStorage.
const STRAT_REG_KEY = 'mfc_dash_strats';
// V26.5: MindForge Multicap and S&P 500 (and the All-Access bundle) were retired
// in V24.4, but legacy 'active' subscription rows for them can still live in the
// backend and get seeded into this device's switcher registry (login.html) — so a
// member kept seeing deleted strategies in the "Strategy:" switcher. Filter them
// out everywhere the registry is read/written, and self-heal any stale stored map.
// The matcher is entity-aware (case-insensitive, &/&amp; tolerant) and CANNOT match
// the three live books — MultiAsset / LargeMidcap 250 / SmallMicro 500 (none of them
// contains 'multicap', a literal 's&p', 'sp 500', or 'all-access').
function isRetiredStrategy(name){
  var s = String(name == null ? '' : name).toLowerCase().replace(/&amp;/g, '&');
  return /\bmulticap\b/.test(s)
      || /s\s*&\s*p/.test(s)
      || /\bsp\s*500\b/.test(s)
      || /all[\s-]?access/.test(s);
}
function _cookieSet(k, v){
  try {
    var sec = (location.protocol === 'https:') ? '; Secure' : '';
    document.cookie = k + '=' + encodeURIComponent(v) + '; path=/; max-age=31536000; SameSite=Lax' + sec;
  } catch(e){}
}
function readStratRegistry(){
  var raw = _cookieGet(STRAT_REG_KEY);
  if (!raw) { try { raw = localStorage.getItem(STRAT_REG_KEY) || ''; } catch(e){} }
  if (!raw) return {};
  var o; try { o = JSON.parse(raw); } catch(e){ return {}; }
  if (!o || typeof o !== 'object') return {};
  // V26.5: strip any retired-strategy keys; if any were present, re-persist the
  // cleaned map so a member's stale cookie self-heals and never re-shows them.
  var clean = {}, dropped = false;
  Object.keys(o).forEach(function(k){ if (isRetiredStrategy(k)) dropped = true; else clean[k] = o[k]; });
  if (dropped){
    var json = JSON.stringify(clean);
    _cookieSet(STRAT_REG_KEY, json);
    try { localStorage.setItem(STRAT_REG_KEY, json); } catch(e){}
  }
  return clean;
}
function recordStrat(strategy, tok){
  strategy = String(strategy || '').trim();
  if (!strategy || !tok) return readStratRegistry();
  if (isRetiredStrategy(strategy)) return readStratRegistry();  // V26.5: never register a retired strategy

  var reg = readStratRegistry();
  if (reg[strategy] === tok) return reg;                 // already current — no write
  reg[strategy] = tok;
  var json = JSON.stringify(reg);
  _cookieSet(STRAT_REG_KEY, json);
  try { localStorage.setItem(STRAT_REG_KEY, json); } catch(e){}
  return reg;
}
function clearStratRegistry(){
  try { document.cookie = STRAT_REG_KEY + '=; path=/; max-age=0; SameSite=Lax'; } catch(e){}
  try { localStorage.removeItem(STRAT_REG_KEY); } catch(e){}
}
// V21.6: drop ONLY the strategy whose token has died (expired/revoked), leaving every
// other strategy in the switcher intact. Used on a definitive auth error so one bad
// sub can't wipe the member's whole switcher.
function removeStratByToken(tok){
  if (!tok) return;
  _mfLastForget(tok);                                    // V44.3: this token's saved picks too
  var reg = readStratRegistry(), changed = false;
  Object.keys(reg).forEach(function(k){ if (reg[k] === tok){ delete reg[k]; changed = true; } });
  if (!changed) return;
  var json = JSON.stringify(reg);
  _cookieSet(STRAT_REG_KEY, json);
  try { localStorage.setItem(STRAT_REG_KEY, json); } catch(e){}
}
// V29.6 — SERVER-SIDE STRATEGY DISCOVERY.
// mfc_dash_strats is a per-DEVICE memory, so it only ever knew the strategies whose
// access links had been opened in THIS browser (or that an OTP sign-in seeded). A
// member holding three subscriptions who opened one emailed link saw a registry of
// one — and therefore no switcher at all. The backend already knows the full set:
// the token identifies the row, the row carries the email, and the email fans out to
// every active subscription (same newest-per-strategy collapse handleRecover uses).
//
// Fail-soft by design. An Apps Script deployment that predates the `my_strategies`
// action answers {status:'error', error:'Invalid action'}; that is NOT an auth
// failure, so it is swallowed and the switcher falls back to the "Find my other
// strategies" row. Nothing here may throw into the dashboard's render path.
function syncStrategiesFromServer(activeStrategy){
  if (isDemo || !token) return Promise.resolve(false);
  return fetch(APPS_SCRIPT_URL + '?action=my_strategies&token=' + encodeURIComponent(token) + '&_=' + Date.now())
    .then(function(r){ return r.json(); })
    .then(function(data){
      if (!data || isErrorPayload(data) || !Array.isArray(data.strategies)) return false;
      var added = 0;
      data.strategies.forEach(function(s){
        var name = String((s && s.strategy) || '').trim();
        var tok  = String((s && s.token) || '');
        if (!name || !tok || isRetiredStrategy(name)) return;
        var before = readStratRegistry();
        recordStrat(name, tok);
        if (before[name] !== tok) added++;
      });
      // V42.1 — A4: keep each held book's access end for the switcher's rows
      var exp = _stratExpRead(), expChanged = false;
      data.strategies.forEach(function(s){
        var nm = _stratNameKey(s && s.strategy);
        if (!nm || isRetiredStrategy(nm) || !(s && s.expires_at)) return;
        if (exp[nm] !== s.expires_at){ exp[nm] = s.expires_at; expChanged = true; }
      });
      if (expChanged) _stratExpWrite(exp);
      if (added || expChanged) setupStrategySwitcher(activeStrategy);   // menu fills itself in place
      try { if (window.mfcV412Refresh) window.mfcV412Refresh(); } catch (e) {}   // V41.2 — B1
      return added > 0;
    })
    .catch(function(){ return false; });
}

// V29.0 — one place that decides "did this request fail, and is it definitive?".
// The backend's errorResponse() emits BOTH {status:'error'} and {error}, but that
// belt-and-suspenders shape only took effect on a redeploy, and other endpoints
// have historically answered {status:'error', message}. init() tested `data.error`
// alone, so a {status:'error', message} reply fell straight through to
// renderDashboard(undefined, []) — which throws on `sub.expires_at`, gets caught by
// the outer catch, and is reported to the member as "Connection Error … try again
// in a moment" for what is actually a dead token. Measured: the error panel and
// the dashboard panel were both display:block at once.
function errMessage(data){
  if (!data) return '';
  return String(data.error || data.message || '');
}
function isErrorPayload(data){
  return !!data && (data.error != null || data.status === 'error');
}
// Definitive = this token will never work again, as opposed to a transient blip.
// The V21.2 contract: only a definitive failure may discard the saved session.
function isAuthFailure(data){
  if (!isErrorPayload(data)) return false;
  return /subscription|expired|not active|inactive|no token|invalid token|unauthor|access denied/i
    .test(errMessage(data));
}

/* V44.3 — the two reads the <head> started (see mf-v443-early). Each can be taken once. */
function _earlyTake(name){
  var E = window.__mfEarly;
  if (!E || E.token !== token || E.base !== APPS_SCRIPT_URL || !E[name]) return null;
  var p = E[name];
  E[name] = null;
  return p;
}
function _mfStocksText(){
  var plain = function(){
    return fetch(APPS_SCRIPT_URL + '?action=stocks&token=' + encodeURIComponent(token) + '&_=' + Date.now())
      .then(function(r){ return r.text(); });
  };
  var early = _earlyTake('stocks');
  return early ? early.catch(plain) : plain();
}
/* V44.3 — ONE PROGRESS READ PER LOAD. capitalSyncLoad, progressSyncLoad and csSyncLoad each
   fetched this on every render, three identical two-second backend runs for one answer, and
   bookHistSyncLoad made a fourth on a device with no history. They now share one for
   GP_SHARE_MS, which is long enough to cover a page load (and a re-render straight after
   it) and short enough that a later Refresh still asks the server afresh. The TEXT is what
   is shared, so each caller parses its own copy and none can see another's edits. A failed
   read is not kept: the next caller tries again. Each of the four merges by timestamp, so a
   reply a few seconds older than this device's own last write still merges correctly. */
var GP_SHARE_MS = 15000, _gpText = null, _gpAt = 0;
function _getProgress(){
  if (!_gpText || (Date.now() - _gpAt) > GP_SHARE_MS) {
    _gpAt = Date.now();
    var p = _earlyTake('progress') || fetch(APPS_SCRIPT_URL + '?action=get_progress&token=' + encodeURIComponent(token) + '&_=' + Date.now())
      .then(function(r){ return r.text(); });
    _gpText = p;
    p.catch(function(){ if (_gpText === p) _gpText = null; });
  }
  return _gpText.then(function(t){ return JSON.parse(t); });
}

/* V44.3 — THE LAST ANSWER, KEPT ON THIS DEVICE. Every Apps Script call takes about 2 s and
   most of that is Google's, so a returning member stared at a spinner for picks that had not
   changed since they last looked. The page now paints the last answer at once and asks the
   server in the same moment. Three rules keep that honest:
     - It corrects itself. An expired or revoked subscription lands on the same error screen
       as before and forgets the copy; a different book re-renders.
     - No order leaves from an unconfirmed copy. Until the server has answered, the routes
       that send or export orders say so and stop (_mfOrdersPaused). If it cannot be reached,
       the picks stay on screen under a notice, and orders stay paused: before this release
       that same moment was a "Connection Error" screen, so nothing is lost.
     - It is not used when it is likely to be last month's book. Only a copy saved in the
       current month (India time) counts, and none during the 1st-3rd, when a new book is
       published. Showing last month's picks for two seconds on rebalance day would be worse
       than the wait it saves. Nor when this device's book history is on a different cycle,
       because rendering would make bookDiff() roll that history backwards.
   Kept per token, keyed by a hash so this is not a second copy of the token, and without the
   phone, payment id or token the reply carries. Never on a sample dashboard. Cleared on
   sign-out, on any definitive auth failure, and on a load with no session. */
var MF_LAST_KEY = 'mfc_dash_last_v1';
function _mfTokHash(t){
  t = String(t || '');
  var h = 5381;
  for (var i = 0; i < t.length; i++) h = (Math.imul(h, 33) ^ t.charCodeAt(i)) >>> 0;
  return h.toString(36) + '.' + t.length;
}
function _mfLastAll(){
  try {
    var o = JSON.parse(localStorage.getItem(MF_LAST_KEY) || '{}');
    return (o && typeof o === 'object') ? o : {};
  } catch (e) { return {}; }
}
function _mfLastForget(tok){
  try {
    if (!tok) { localStorage.removeItem(MF_LAST_KEY); return; }
    var all = _mfLastAll();
    delete all[_mfTokHash(tok)];
    if (Object.keys(all).length) localStorage.setItem(MF_LAST_KEY, JSON.stringify(all));
    else localStorage.removeItem(MF_LAST_KEY);
  } catch (e) {}
}
function _mfLastSave(tok, data){
  if (isDemo || !tok || !data || !data.subscription) return;
  try {
    var src = data.subscription, sub = {};
    ['email', 'name', 'strategy', 'run_id', 'subscribed_at', 'expires_at', 'status', 'duration_months', 'notify', 'digest']
      .forEach(function(k){ if (src[k] !== undefined) sub[k] = src[k]; });
    var all = _mfLastAll();
    all[_mfTokHash(tok)] = { at: Date.now(), subscription: sub, stocks: data.stocks || [], note: data.note || null, splits: data.splits || null };
    var keys = Object.keys(all);
    if (keys.length > 5) {
      keys.sort(function(a, b){ return (all[a].at || 0) - (all[b].at || 0); })
          .slice(0, keys.length - 5).forEach(function(k){ delete all[k]; });
    }
    localStorage.setItem(MF_LAST_KEY, JSON.stringify(all));
  } catch (e) {}
}
/* What decides "has anything changed". Taken before a render, which adds working fields to
   the row objects it is given. */
function _mfSig(sub, stocks, note){
  sub = sub || {};
  return JSON.stringify([
    ['email', 'name', 'strategy', 'run_id', 'expires_at', 'status', 'duration_months', 'notify', 'digest'].map(function(k){ return sub[k] == null ? '' : String(sub[k]); }),
    (stocks || []).map(function(s){ return [s.ticker, s.yahoo_ticker, s.company_name, s.industry, s.recommended_price, s.weight_pct]; }),
    note || null
  ]);
}
function _mfLastUsable(at){
  var IST = 19800000, now = new Date(Date.now() + IST), was = new Date(Number(at) + IST);
  if (isNaN(was.getTime())) return false;
  if (now.getUTCFullYear() !== was.getUTCFullYear() || now.getUTCMonth() !== was.getUTCMonth()) return false;
  return now.getUTCDate() > 3;
}
function _mfLastRead(tok){
  if (isDemo || !tok) return null;
  try {
    var e = _mfLastAll()[_mfTokHash(tok)];
    if (!e || !e.subscription || !Array.isArray(e.stocks) || !e.stocks.length) return null;
    if (!_mfLastUsable(e.at)) return null;
    var sub = e.subscription, exp = new Date(sub.expires_at);
    if (!sub.expires_at || isNaN(exp.getTime()) || exp < new Date()) return null;
    if (sub.status !== 'active' || isRetiredStrategy(sub.strategy)) return null;
    var slot = _loadBookHist()[_bookHistStrat(sub.strategy)];
    if (!slot || !slot.cur || slot.cur.key !== _cycleKey(sub)) return null;
    e.sig = _mfSig(sub, e.stocks, e.note);
    return e;
  } catch (err) { return null; }
}
window._mfUnverified = false;
function _mfOrdersPaused(){
  if (!window._mfUnverified) return false;
  showToast(window._mfSavedOnly
    ? 'Orders are paused until the server confirms this month\u2019s picks'
    : 'One moment: checking this month\u2019s picks with the server');
  return true;
}
function _mfRefreshSpin(on){
  var b = document.getElementById('btn-refresh');
  if (b) b.classList.toggle('refreshing', !!on);
}
function _mfVerified(){
  window._mfUnverified = false;
  window._mfSavedOnly = false;
  _mfRefreshSpin(false);
  var n = document.getElementById('mf-saved-note');
  if (n) n.hidden = true;
}
function _mfSavedNotice(at){
  window._mfSavedOnly = true;
  _mfRefreshSpin(false);
  var n = document.getElementById('mf-saved-note'), t = document.getElementById('mf-saved-note-t');
  if (t) t.textContent = 'These are the picks saved on this device on ' +
    new Date(Number(at)).toLocaleDateString('en-GB', { day:'numeric', month:'short', timeZone:'Asia/Kolkata' }) +
    '. The server could not be reached just now, so orders are paused until it can confirm them.';
  if (n) n.hidden = false;
}
function _mfPxStop(){
  window._mfPxOff = true;
  if (window._mfPxTimer) { clearInterval(window._mfPxTimer); window._mfPxTimer = null; }
}

const token = (function () {
  const params = new URLSearchParams(window.location.search);
  let t = params.get('token');
  try {
    if (t) {
      writeDashToken(t);
      params.delete('token');                 // strip ONLY token; keep ?demo etc.
      const qs = params.toString();
      window.history.replaceState(null, '', window.location.pathname + (qs ? '?' + qs : '') + window.location.hash);
    } else {
      // V29.8: a strategy switch leaves the chosen token here rather than in the
      // URL. Consume it once, promote it to the durable stores, and fall through
      // to the cookie for every other kind of load. If sessionStorage is blocked
      // this is simply empty and readDashToken() — which V29.7 made duplicate-proof
      // — answers on its own.
      let handoff = null;
      try { handoff = sessionStorage.getItem(DASH_SWITCH_KEY); } catch (e) {}
      if (handoff) {
        try { sessionStorage.removeItem(DASH_SWITCH_KEY); } catch (e) {}
        writeDashToken(handoff);
        t = handoff;
      } else {
        t = readDashToken() || t;
      }
      // V30.4: drop the switch nonce once we are here. It exists only to make the
      // switch navigation a different URL (see DASH_SWITCH_PARAM); leaving it in
      // the bar would show a meaningless number, and — because the next switch
      // compares against the CURRENT url — would make two rapid switches able to
      // collide on the same millisecond value.
      if (params.has(DASH_SWITCH_PARAM)) {
        params.delete(DASH_SWITCH_PARAM);
        const qs2 = params.toString();
        window.history.replaceState(null, '', window.location.pathname + (qs2 ? '?' + qs2 : '') + window.location.hash);
      }
    }
  } catch (e) { /* storage/history blocked → fall back to the URL token as-is */ }
  return t;
})();

const demoMode = new URLSearchParams(window.location.search).get('demo');
// V29.0: was `demoMode === '1'`, so the moment demo gained a second strategy the
// switch to ?demo=2 fell through to the TOKEN path, found no token and rendered
// nothing. Accept every mode _demoData() knows about, and nothing else — an
// unrecognised ?demo= value must still take the real path, not a blank dashboard.
const DEMO_MODES = ['1', '2', 'pinned', 'restricted', 'first'];   // V39.1 — 'pinned' is the test-only state ?demo=1 used to be; V39.5 — 'restricted' is the career-safe test state; V44.4 — 'first' is the sample's month one, linked from /start/ and the banner
const isDemo = DEMO_MODES.indexOf(demoMode) > -1;
// V41.0 — C1: the authoritative nav state. The <head> guess (mf-v410-navstate)
// mirrors this from the URL and storage; this line is the one that decides.
try { document.documentElement.setAttribute('data-nav', isDemo ? 'demo' : (token ? 'member' : 'out')); } catch (e) {}

/* V30.4 — THE BACK/FORWARD CACHE. This is the Safari fix; the nonce above is not.
   MEASURED, in Safari 26.5.2 via safaridriver against the live origin:
     • load the dashboard, plant `window.__bf` on it
     • navigate to login.html, then history.back()
     • the marker is STILL THERE, and `pageshow` fires with persisted === true
   WebKit restored the whole document from its page cache. Not one line of this
   page re-ran. That is the behaviour Blink does not reproduce here, and it is
   enough on its own to produce every symptom reported: the `token` const still
   holds the PREVIOUS strategy's token, a switch handoff can still be sitting
   unconsumed in sessionStorage, and the member is looking at the old book while
   the cookie says otherwise — with no error, because no code ran to raise one.
   "I switched and it went back to the same strategy" is exactly what a restored
   pre-switch document looks like.
   `pageshow`+`persisted` is the one event that fires on precisely that restore.
   Reload only when the session has actually moved underneath us — an unconsumed
   handoff, or a stored token that is no longer the one this document rendered
   with — so an ordinary Back to an unchanged dashboard is left alone and a member
   placing orders never has the page pulled out from under them for nothing. */
window.addEventListener('pageshow', function (ev) {
  if (!ev.persisted) return;                     // a real load already re-ran everything
  if (isDemo) return;                            // demo has no token session to drift
  try {
    var pending = null;
    try { pending = sessionStorage.getItem(DASH_SWITCH_KEY); } catch (e) {}
    var stored = readDashToken();
    if (pending || (stored && token && stored !== token)) {
      window.location.reload();
    }
  } catch (e) { /* a restore guard must never break a working page */ }
});

// V21.0: Sign out — clear the persisted session, then go to the sign-in page.
(function(){
  var so = document.getElementById('nav-signout');
  if (!so) return;
  so.addEventListener('click', function(e){ e.preventDefault(); clearDashSession(); window.location.href = 'login.html'; });
})();

let stocksData = [];
let currentStrategy = '';
let currentCapital = 0;
let _searchQ = '';

/* ══ V39.5 · B1–B3 · YOUR EMPLOYER'S TRADING RULES ═══════════════════════════
   The reader the homepage now names — "people whose career comes first" — very
   often works under an employee trading code. A designated person at a listed
   company cannot buy the employer's shares and sell them a month later (SEBI's
   insider-trading code bars an opposite trade within six months and the profit is
   disgorged); a bank, fund-house or audit-firm employee may have to pre-clear every
   trade and hold each purchase for 30 days. A monthly book does exactly those
   things, and nothing on this page let a member say so.
   Three member-side tools, all ARITHMETIC on the published book, like Add money:
     · a standing RESTRICTED LIST — names this page never sizes, buys or sells for
       the member. Deliberately NOT a per-cycle "skip": a monthly deselect would be
       the discretionary override the model exists to remove, so the list lives in
       one settings card and applies to every cycle until the member changes it;
     · a MINIMUM HOLDING PERIOD — a sale waits until N days after the member ticked
       the buy as placed (the tick's own `t`, V36.6);
     · a PRE-CLEARANCE LIST — this cycle's orders as plain text.
   Equity books only: MultiAsset is an allocation across asset classes, and taking
   one out changes what the book is. No substitute is ever named and no next-ranked
   pick is shown — that would be model output. Everything that SIZES reads the list
   through allocBudget(), everything that ORDERS through cycleOrders(); everything
   that DESCRIBES THE MODEL (the names, Why these N, the sector card, the track
   record, the benchmark) is left alone, so the published book stays readable
   beside the member's own. CAREER_SAFE_ENABLED is the one switch if the owner's
   adviser objects. ══════════════════════════════════════════════════════════ */
var CAREER_SAFE_ENABLED = true;
var CS_MAX_NAMES = 25;
var CS_KEY = isDemo ? 'mfc_rules_demo' : 'mfc_rules_v1';
var CS_SERVER_KEY = 'prefs::member';
window._mfRules = { r: [], h: 0, t: '' };
/* The same normaliser the holdings matcher uses: NSE:INFY, INFY-EQ, INFY.NS and
   "infy" are one name; only exchange SERIES suffixes are stripped, so BAJAJ-AUTO
   and M&M survive. */
function _csNormSym(t){
  return String(t == null ? '' : t).trim().replace(/^["']|["']$/g,'').toUpperCase()
    .replace(/^(NSE|BSE|NSE_EQ|BSE_EQ)\s*[:|]\s*/,'')
    .replace(/\.(NS|BO|NSE|BSE)$/,'')
    .replace(/-(EQ|BE|BZ|SM|ST|BL|IL|GB|GS|N[0-9]|T[0-9])$/,'');
}
function _csValidSym(t){ return /^[A-Z0-9&\-]{1,20}$/.test(String(t || '')); }
function _csHoldDays(v){ var n = Math.floor(Number(v)); return (isFinite(n) && n >= 0 && n <= 365) ? n : 0; }
function _csClean(o){
  var r = [], seen = {};
  ((o && Array.isArray(o.r)) ? o.r : []).forEach(function(t){
    t = _csNormSym(t);
    if (_csValidSym(t) && !seen[t] && r.length < CS_MAX_NAMES){ seen[t] = 1; r.push(t); }
  });
  return { r: r, h: _csHoldDays(o && o.h), t: String((o && o.t) || '').slice(0, 40) };
}
(function _csLoadLocal(){
  try { var raw = localStorage.getItem(CS_KEY); if (raw) window._mfRules = _csClean(JSON.parse(raw)); } catch (e) {}
  // ?demo=restricted — the test-only state: one carried-over name and one new buy
  // on the list, a 30-day hold, and (see _csPrevBuyTick) one purchase 20 days old.
  if (demoMode === 'restricted') window._mfRules = { r: ['TCS', 'RELIANCE'], h: 30, t: '' };
})();
function _csEquityBook(){
  var s = String((window._currentSub && window._currentSub.strategy) || currentStrategy || '');
  return !!s && !/multi\s*asset/i.test(s);
}
function _csOn(){ return CAREER_SAFE_ENABLED && _csEquityBook(); }
function _restrictActive(){ return _csOn() && window._mfRules.r.length > 0; }
function _isRestricted(t){
  return _restrictActive() && window._mfRules.r.indexOf(String(t == null ? '' : t).toUpperCase()) !== -1;
}
/* The member's book: the published picks minus their restricted names — for the
   surfaces that COUNT what the member holds (coverage, the sizing card, the
   capital ladder). Sizing needs no call: allocBudget() applies the same rule. */
function memberBook(list){
  list = list || [];
  return _restrictActive() ? list.filter(function(x){ return !_isRestricted(x && x.ticker); }) : list;
}
/* B2 — the date a sale may go ahead. The buy's own tick carries the time it was
   ticked (V36.6); last cycle's map stays on this device (pruneBoughtKeys keeps two
   cycles). No tick is no date, and the row says so rather than guessing. */
function _csPrevBuyTick(ticker){
  if (demoMode === 'restricted' && String(ticker) === 'TITAN') return new Date(Date.now() - 20 * 864e5);
  try {
    var d = window._bookDiff; if (!d || !d.prevKey) return null;
    var base = 'mfc_bought_' + String(currentStrategy || 'default').replace(/[^a-z0-9]+/gi,'_') + '__';
    var raw = localStorage.getItem(base + String(d.prevKey).replace(/[^a-z0-9]+/gi,'_'));
    var m = raw ? JSON.parse(raw) : null, v = m && m[String(ticker)];
    var at = (v && typeof v === 'object' && v.t) ? new Date(v.t) : null;
    return (at && !isNaN(at.getTime())) ? at : null;
  } catch (e) { return null; }
}
/* The first day the sale is allowed, or null when it already is (or no rule). */
function _csHoldUntil(ticker){
  var h = window._mfRules.h;
  if (!_csOn() || !(h > 0)) return null;
  var at = _csPrevBuyTick(ticker); if (!at) return null;
  var until = new Date(at.getFullYear(), at.getMonth(), at.getDate() + h);
  var now = new Date(), today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return until > today ? until : null;
}
function _csUnknownBuy(ticker){ return _csOn() && window._mfRules.h > 0 && !_csPrevBuyTick(ticker); }

// V12.5: positions are sized by each pick's MODEL WEIGHT (weight_pct), not split
// equally. For the equal-weight equity strategies every weight is identical, so this
// reduces exactly to capital/N (those strategies are unchanged). For the composite-
// score-weighted MindForge MultiAsset it honours the published tilt (e.g. NASDAQ
// 32.5% vs Nifty50 0.8%) — which is the whole point of that strategy. Falls back to
// an equal split only if NO pick carries a usable weight.
function sumWeights(list) {
  let t = 0;
  for (let i = 0; i < (list || []).length; i++) { const w = Number(list[i].weight_pct) || 0; if (w > 0) t += w; }
  return t;
}
/* V36.6 — THE SHARE COUNT, IN ONE PLACE.
   `Math.floor(allocBudget(s, list, capital) / entry)` is written out inline in
   six renderers. toggleBought() needs the same number to record what the member
   bought, and a seventh copy of an arithmetic expression is how two surfaces end
   up disagreeing about one fact. This is the canonical form from renderTable. */
function sharesFor(stock) {
  const entry = Number(stock && stock.recommended_price) || 0;
  if (entry <= 0) return 0;
  return Math.floor(allocBudget(stock, stocksData || [], currentCapital) / entry);
}

function allocBudget(stock, list, capital) {
  // V39.5 — B1: a name on the member's restricted list gets no money, and the rest
  // re-spread over what is left by their model weights — which is exactly what the
  // lines below do when handed the shorter list. All 32 sizing paths inherit it.
  if (_restrictActive()) {
    if (stock && _isRestricted(stock.ticker)) return 0;
    list = (list || []).filter(function (x) { return !_isRestricted(x && x.ticker); });
  }
  const n = (list && list.length) || 1;
  const totalW = sumWeights(list);
  if (totalW <= 0) return capital / n;            // no weights anywhere → equal split
  const w = Number(stock.weight_pct) || 0;
  return capital * (w / totalW);                  // weight-proportional
}
// "Meaningfully weighted" = the picks carry a real spread of weights (MultiAsset),
// vs. equal-weight books where tiny 3.33/3.34 rounding shouldn't flip the label.
function isWeightedBook(list) {
  let mn = Infinity, mx = 0, cnt = 0;
  for (let i = 0; i < (list || []).length; i++) {
    const w = Number(list[i].weight_pct) || 0;
    if (w > 0) { cnt++; if (w < mn) mn = w; if (w > mx) mx = w; }
  }
  return cnt > 1 && mn > 0 && (mx / mn) > 1.15;
}

/* V37.5 — THE PRESETS NEVER MATCHED A REAL SUBSCRIPTION.
   These keys carry a non-breaking space ("SmallMicro\u00A0500"), which is how
   the page prints the names so they never break across a line. The backend
   does not: apps_script.gs, signup.html, admin.html and publish.py all write
   "MindForge SmallMicro 500" with an ordinary space, and that is the string
   handleGetStocks returns. So `CAPITAL_PRESETS[strategy]` missed for every
   SmallMicro 500 and LargeMidcap 250 member and fell through to _default: a
   SmallMicro member was started at ₹5,00,000 (not the ₹15,00,000 the book is
   sized for) with preset chips of ₹1L / ₹5L / ₹15L / ₹25L. Demo mode could
   never show it — the fixture's names use the same non-breaking space as these
   keys. Looked up by a whitespace-normalised name now, on both sides. */
function _stratNorm(n){ return String(n == null ? '' : n).replace(/\s+/g, ' ').trim().toLowerCase(); }
function capitalPresetsFor(strategy){
  var want = _stratNorm(strategy);
  var keys = Object.keys(CAPITAL_PRESETS);
  for (var i = 0; i < keys.length; i++){
    if (keys[i] !== '_default' && _stratNorm(keys[i]) === want) return CAPITAL_PRESETS[keys[i]];
  }
  return CAPITAL_PRESETS._default;
}
// Per-strategy recommended capital presets (paise-free integers)
//
// V38.9 \u2014 THE RUNGS REACHED UP, NEVER DOWN. LargeMidcap's lowest preset was
// \u20B95,00,000 and SmallMicro's was \u20B910,00,000, so the cheapest thing a member
// could click was already several times the capital most of them arrive with \u2014
// and several times the floor the site itself publishes ("Works from" is
// \u20B91,90,000 and \u20B965,000 respectively). A member with \u20B93,00,000 had to type it,
// past four chips telling them the page expected more. Each ladder now STARTS
// at or near that published floor and still passes through the recommended
// size, which is where whole-share rounding stops mattering.
// `recommended` is untouched: it is the field's starting value, not a rung, and
// moving it would change what every existing member opens on.
const CAPITAL_PRESETS = {
  'MindForge MultiAsset':      { recommended: 100000,  options: [25000, 100000, 250000, 500000] },
  'MindForge LargeMidcap\u00A0250': { recommended: 1000000, options: [200000, 500000, 1000000, 2500000] },
  'MindForge SmallMicro\u00A0500':  { recommended: 1500000, options: [100000, 500000, 1500000, 2500000] },
  _default:                      { recommended: 500000,  options: [100000, 500000, 1000000, 2500000] }
};

// ── DEMO DATA for local visual testing (?demo=1) ────────────────────────────
function _demoData(mode) {
  const now = new Date();
  const exp = new Date(); exp.setDate(exp.getDate() + 18);
  // V28.2: subscribed_at drives the real billing-term length (see
  // subscriptionTermDays). Dating it "today" made the fixture a 18-day term, which
  // no plan sells — back-date it 12 days so the demo shows a representative
  // 30-day monthly cycle, 12 days consumed.
  const sub0 = new Date(); sub0.setDate(sub0.getDate() - 12);
  /* V39.1 — ?demo=1 is the homepage's "See the member dashboard (sample)" link, so
     it must show the state a new member is actually in: a 12-month term, the
     current book, no renewal chrome. V35.3 had made it a PINNED monthly member one
     cycle behind, to reach renderNewerSetNotice's positive branch in testing —
     which is how every prospect's first look at the product was a "Renew to switch"
     notice and a WhatsApp button. That state lives on as the test-only
     ?demo=pinned. The steady run_id is the last month-end, so it never goes stale. */
  const steady = mode !== 'pinned';
  if (steady) { exp.setDate(exp.getDate() + 182); sub0.setDate(sub0.getDate() - 153); }
  const _me = new Date(now.getFullYear(), now.getMonth(), 0);
  const steadyRun = _me.getFullYear() + String(_me.getMonth() + 1).padStart(2, '0') +
                    String(_me.getDate()).padStart(2, '0') + '_090000_';
  // V33.9: was 25 names at 4.00% with three per industry — the shape the books
  // had before V33.1 concentrated them. A stale fixture is not cosmetic here:
  // the allocation card only takes its `scaleIsCap` branch when the largest
  // sector weight equals equalWeight x MAX_PER_SECTOR, so a 3-per-industry
  // fixture meant demo mode never exercised the ruled-bar rendering or the
  // "full bar = the 2-per-industry cap" caption that every real book now hits.
  // Fifteen names at 6.67%, no more than two per industry — the live LargeMidcap
  // shape since V40.0 (it was ten names at 10.00% until then). Deliberately
  // well-known large caps rather than the real model picks: ?demo=1 needs no
  // token, and the paid book must not leak through it.
  const stocks = [
    {ticker:'INFY',       company_name:'Infosys',                       industry:'IT Services',    recommended_price:1543.20,  weight_pct:6.67},
    {ticker:'TCS',        company_name:'Tata Consultancy Services',     industry:'IT Services',    recommended_price:3812.55,  weight_pct:6.67},
    {ticker:'HDFCBANK',   company_name:'HDFC Bank',                     industry:'Banks',          recommended_price:1672.90,  weight_pct:6.67},
    {ticker:'ICICIBANK',  company_name:'ICICI Bank',                    industry:'Banks',          recommended_price:1198.40,  weight_pct:6.67},
    {ticker:'MARUTI',     company_name:'Maruti Suzuki India',           industry:'Automobile',     recommended_price:11890.00, weight_pct:6.67},
    {ticker:'M&M',        company_name:'Mahindra & Mahindra',           industry:'Automobile',     recommended_price:2902.15,  weight_pct:6.67},
    {ticker:'RELIANCE',   company_name:'Reliance Industries',           industry:'Oil & Gas',      recommended_price:2945.85,  weight_pct:6.67},
    {ticker:'BHARTIARTL', company_name:'Bharti Airtel',                 industry:'Telecom',        recommended_price:1582.30,  weight_pct:6.67},
    {ticker:'SUNPHARMA',  company_name:'Sun Pharmaceutical Industries', industry:'Pharma',         recommended_price:1812.30,  weight_pct:6.67},
    {ticker:'LT',         company_name:'Larsen & Toubro',               industry:'Capital Goods',  recommended_price:3782.40,  weight_pct:6.67},
    {ticker:'BAJFINANCE', company_name:'Bajaj Finance',                 industry:'Financial Services', recommended_price:945.60, weight_pct:6.67},
    {ticker:'ULTRACEMCO', company_name:'UltraTech Cement',              industry:'Cement',             recommended_price:11720.00, weight_pct:6.67},
    {ticker:'NTPC',       company_name:'NTPC',                          industry:'Power',              recommended_price:342.75, weight_pct:6.67},
    {ticker:'POWERGRID',  company_name:'Power Grid Corporation',        industry:'Power',              recommended_price:298.40, weight_pct:6.67},
    {ticker:'HINDALCO',   company_name:'Hindalco Industries',           industry:'Metals & Mining',    recommended_price:712.40, weight_pct:6.67},
  ];
  // Real API rows always carry a yahoo_ticker; the demo fixture omits it, so
  // backfill ".NS" suffixes here to keep the table/calculator on ₹ for the
  // Indian book (without it, the table's per-row currency falls through to $).
  stocks.forEach(s => { if (!s.yahoo_ticker) s.yahoo_ticker = s.ticker + '.NS'; });

  // V29.0 — ?demo=2 is the MultiAsset book: 8 ETFs, composite-score weighted (NOT
  // equal-weighted), which is also the fixture that exercises isWeightedBook() and
  // the "Why these 25" multiplicative-chain branch. Weights are a real run's.
  if (mode === '2') {
    const etfs = [
      {ticker:'MON100',     company_name:'NASDAQ ETF',              weight_pct:29.92, recommended_price:305.18},
      {ticker:'HDFCSML250', company_name:'Nifty SmallCap 250 ETF',  weight_pct:16.13, recommended_price:180.67},
      {ticker:'JUNIORBEES', company_name:'Nifty Next\u00A050 ETF',       weight_pct:10.45, recommended_price:795.65},
      {ticker:'MID150BEES', company_name:'Nifty Midcap\u00A0150 ETF',    weight_pct:12.47, recommended_price:239.48},
      {ticker:'EBBETF0431', company_name:'Bharat Bond ETF',         weight_pct:8.28, recommended_price:1441.34},
      {ticker:'GOLDBEES',   company_name:'Gold ETF',                weight_pct:17.36,  recommended_price:117.11},
      {ticker:'SILVERBEES', company_name:'Silver ETF',              weight_pct:4.27,  recommended_price:206.51},
      {ticker:'NIFTYBEES',  company_name:'Nifty\u00A050 ETF',            weight_pct:1.12,  recommended_price:277.42},
    ];
    etfs.forEach(s => { s.industry = 'ETF'; s.yahoo_ticker = s.ticker + '.NS'; });
    return {
      subscription: {
        name: 'Riya', email: 'riya@example.com', strategy: 'MindForge MultiAsset',
        // V35.3 — a run_id matching live-perf.json's own rebalance_date, so ?demo=2
        // exercises the NEGATIVE branch of renderNewerSetNotice (a member on the
        // current book is told nothing) while ?demo=1 exercises the positive one.
        run_id: steady ? steadyRun + 'MA' : '20260831_090000_MA',
        duration_months: steady ? 12 : 1,
        notify: steady ? 'on' : 'off',   // V41.1 — as apps_script.gs sets it: on for every plan longer than a month
        expires_at: exp.toISOString(), subscribed_at: sub0.toISOString(), status: 'active'
      },
      stocks: etfs
    };
  }

  return {
    subscription: {
      name: 'Riya', email: 'riya@example.com', strategy: 'MindForge LargeMidcap\u00A0250',
      // V35.3 \u2014 a run_id one cycle BEHIND live-perf.json's rebalance_date, which is
      // the shape of a monthly subscriber who joined mid-month: pinned to the run
      // captured at signup while a newer set has since published. It is the only
      // way renderNewerSetNotice's positive branch is reachable in local testing,
      // and it is also the state that branch exists for.
      run_id: steady ? steadyRun + 'LM' : '20260731_090000_LM',
      duration_months: steady ? 12 : 1,
      notify: steady ? 'on' : 'off',   // V41.1 — see the MultiAsset fixture above
      expires_at: exp.toISOString(), subscribed_at: sub0.toISOString(), status: 'active'
    },
    stocks: stocks
  };
}

/* V41.2 — C2. Every sample link on the site opens ?demo=1, LargeMidcap 250's screen, and
   its banner and ending promised the free book as "this screen". The free book is
   MultiAsset's ETF screen (?demo=2, whose words stay as they were). */
function _v412SampleCopy(){
  var go = 'Start free with MultiAsset \u2014 the same dashboard, its own ETFs <span aria-hidden="true">\u2192</span>';
  var lm = 'LargeMidcap\u00A0250, the book shown here <span aria-hidden="true">\u2192</span>';
  ['demo-banner', 'demo-end'].forEach(function(id){
    var box = document.getElementById(id); if (!box) return;
    var a = box.querySelectorAll('.demo-banner-cta');
    if (a[0]) a[0].innerHTML = go;
    if (a[1]) { a[1].innerHTML = lm; a[1].setAttribute('href', '/largemidcap.html'); }
  });
  // V44.4: the sample's two months, so a first-time reader can see what their own first month looks like
  try {
    var mv = document.getElementById('demo-months');
    if (mv) {
      mv.hidden = false;
      mv.querySelectorAll('a').forEach(function (x) {
        var on = x.getAttribute('data-demo') === demoMode;
        x.classList.toggle('is-on', on);
        if (on) x.setAttribute('aria-current', 'page');
      });
    }
  } catch (e) {}
  var t = document.querySelector('#demo-end .demo-banner-txt');
  if (t) t.innerHTML = '<b>That\u2019s the whole month.</b> The free book, MultiAsset, runs on this same dashboard with its own ETFs; LargeMidcap\u00A0250, shown here, is a paid book.';
}

async function init() {
  try { loadNseSeries(); } catch (e) {}   // V43.9 — Kite's names for BE-series stocks
  try { loadNseHolidays(); } catch (e) {} // V44.1 — NSE's trading holidays (status bar, Kite AMO, price polling)
  if (isDemo) {
    try { var db = document.getElementById('demo-banner'); if (db) db.hidden = false; } catch (e) {}
    try { var de = document.getElementById('demo-end'); if (de) de.hidden = false; } catch (e) {}   // V40.7 — B3
    if (demoMode !== '2') { try { _v412SampleCopy(); } catch (e) {} }                                 // V41.2 — C2
    const d = _demoData(demoMode);
    stocksData = d.stocks;
    renderDashboard(d.subscription, d.stocks);
    return;
  }
  if (!token) {
    _mfLastForget();   // V44.3 — no session on this device, so no saved picks either
    // V40.3 — C8: "No Access Token" was developer vocabulary, met by a member
    // opening a bookmark on a new device. Same state, the reader's words.
    showError('Sign in to your dashboard', 'We’ll email you a one-time code — no password needed.',
              { action: { href: 'login.html', label: 'Email me a code →' } });
    // V42.1 — A3: and, for someone who is not a member yet, the way in
    try { var _pros = document.getElementById('error-prospect'); if (_pros) _pros.hidden = false; } catch (e) {}
    return;
  }
  // V44.3 — paint the last answer now, if there is a usable one (see MF_LAST_KEY's note).
  const _saved = _mfLastRead(token);
  let _painted = false;
  if (_saved) {
    try {
      window._mfUnverified = true;
      stocksData = _saved.stocks;
      window._mfNote = _saved.note || null;
      window._splits = _saved.splits || null;
      renderDashboard(_saved.subscription, stocksData);
      _painted = true;
      _mfRefreshSpin(true);
      loadLiveProfit();
      startPricePolling();
    } catch (e) {
      // A copy that will not render is no copy: fall through to the normal wait.
      _mfVerified();
      _mfLastForget(token);
      stocksData = [];
      window._mfNote = null;
      try {
        document.getElementById('state-dashboard').style.display = 'none';
        document.getElementById('state-loading').style.display = '';
      } catch (e2) {}
    }
  }
  try {
    const data = JSON.parse(await _mfStocksText());
    // V21.2 fix: only DISCARD the saved session on a DEFINITIVE auth failure —
    // "Subscription not found / expired / not active" (backend handleGetStocks).
    // A TRANSIENT backend hiccup returns {error:'Server error'} (doGet catch) and a
    // network blip throws → "Connection Error"; clearing the token on those was
    // logging valid members out on a momentary glitch, forcing a needless re-login
    // (the very bug being chased). On a transient error we KEEP the token so the next
    // load / retry re-authenticates. (V21.0 cleared on ANY data.error — too eager.)
    // V29.0: shape-agnostic — {error}, {status:'error', error} and
    // {status:'error', message} are all failures. Testing `data.error` alone let
    // the third shape through to renderDashboard(undefined, …).
    if (isErrorPayload(data)) {
      var _expNm = _expiredStrategy();          // V40.3 — B2.3: read before the registry drops it
      if (isAuthFailure(data)) {
        // V21.6: clear the dead SESSION token, but KEEP the strategy switcher registry —
        // only drop this one dead strategy from it. Previously clearDashSession() wiped
        // the whole map, stranding the member's other (working) strategies on a single
        // expired sub.
        clearDashSession({ keepRegistry: true });
        removeStratByToken(token);
        _mfPxStop();                              // V44.3 — a saved-picks paint may have started it
        _mfVerified();
      } else if (_painted) {
        // V44.3 — a transient backend error is not a reason to take the picks off the screen.
        _mfSavedNotice(_saved.at);
        return;
      }
      if (/expired/i.test(errMessage(data))) { showExpired(_expNm); return; }
      showError('Access Denied', errMessage(data) || 'This link is invalid or your subscription has expired.');
      return;
    }
    // V29.0: a success payload with no subscription used to reach renderDashboard
    // and throw on sub.expires_at, surfacing as "Connection Error" AFTER
    // state-dashboard had already been switched on — two panels, wrong message.
    if (!data.subscription) {
      _mfPxStop();
      _mfVerified();
      showError('Access Denied', 'That subscription could not be loaded. Please sign in again.');
      return;
    }
    // V44.3 — when nothing has changed the screen already holds this answer, and the row
    // objects it was drawn from carry render-time fields, so they stay in place.
    const _same = _painted && _saved.sig === _mfSig(data.subscription, data.stocks, data.note);
    _mfLastSave(token, data);
    window._splits = data.splits || null;   // V44.5 — see _splitTicks
    if (!_same) {
      stocksData = data.stocks || [];
      window._mfNote = (data && data.note) || null;   // V42.3 — M10: the analyst's latest note for this book, if any
    }
    // V38.7 — awaited, and ONLY on a device with no history of its own: see
    // bookHistSyncLoad(). On every other load it resolves synchronously-fast
    // without a request, so this costs a first paint nothing in the normal case
    // — and in the case it does cost something, the alternative is painting a
    // fifteen-order month at a member who has four orders to place.
    // V44.3 — and it no longer waits its turn: _getProgress() picks up the read the <head>
    // started beside this one, so a first-month member waits for one call's time, not two.
    let _histNew = false;
    try { _histNew = !!(await bookHistSyncLoad(data.subscription.strategy)); } catch (e) {}
    if (_same && !_histNew) {
      window._currentSub = data.subscription;   // the whole reply, not the trimmed saved copy
    } else {
      renderDashboard(data.subscription, stocksData);
      if (_painted) {
        loadLiveProfit(true);
        showToast('Updated from the server');
      } else {
        loadLiveProfit();   // V14.3: live profit since rebalance (non-blocking)
        startPricePolling();  // V35.3 — keep "live" live; see the note on PX_POLL_MS
      }
    }
    _mfVerified();
    syncStrategiesFromServer(data.subscription.strategy || '');  // V29.6: fill the switcher (non-blocking, fail-soft)
  } catch(e) {
    if (_painted) { _mfSavedNotice(_saved.at); return; }   // V44.3 — keep the picks, pause the orders
    showError('Connection Error', 'Could not connect to the server. Your subscription is unaffected — this is a network or server hiccup.', {retry:true});
  }
}

function firstName(name){
  if(!name) return 'Investor';
  const s = String(name).trim();
  if(!s) return 'Investor';
  return s.split(/\s+/)[0];
}

function daysBetween(a, b){
  return Math.ceil((b.getTime() - a.getTime()) / (1000*60*60*24));
}

function nextRebalanceDate(now){
  // Next month rebalance: 1st of next month, IST
  const y = now.getFullYear(), m = now.getMonth();
  return new Date(y, m + 1, 1);
}

// V28.2 — fill the cycle rail. Pure presentation: every figure it prints is one
// the KPI row above already computed, so the two surfaces cannot disagree.
/* V38.7 — how early the dashboard is allowed to talk about renewing.
   Two numbers, named once, so the two behaviours below cannot drift apart. */
var RAIL_FULL_FROM  = 60;   // days of access below which the full rail is shown
var RENEW_CTA_FROM  = 45;   // days of access below which a renew button appears

/* V39.1 — TWO SUBSCRIPTION SHAPES THE RAIL DESCRIBED WRONGLY.
   runner/apps_script.gs pins every duration_months <= 1 subscription to the run
   current at activation — no next book, no rebalance email — and MindForge
   MultiAsset is free. The rail told a pinned member the next rebalance "is
   included", and told a free member to renew on WhatsApp. Both are read from the
   subscription itself, never typed per page. */
function _subIsFree(sub){
  sub = sub || window._currentSub || {};
  return /multiasset/i.test(String(sub.strategy || currentStrategy || '').replace(/\u00A0/g, ' '));
}
function _subIsPinned(sub){
  sub = sub || window._currentSub || {};
  return (Number(sub.duration_months) || 1) <= 1;
}
function _freeRenewCta(){
  return '<a class="renew-cta renew-free" href="signup.html?strategy=multiasset">Keep it free — re-register (₹0)</a>';
}
function _mfData(k){
  var n = document.querySelector('#mfrisk [data-k="' + k + '"]');
  return n ? n.textContent.trim() : '';
}

/* V41.6 — A3. THE FIRST EVENING, ANY DAY OF THE MONTH. V39.1's late-joiner line
   showed only in the last 7 days before a rebalance, so a member who joined on the
   17th read "Place them in your broker and you're done for the month" fifteen days
   before about a dozen more orders. ONE state, computed here and read by both the
   cycle card (#cyc-join) and the first line (renderHeroJob), so the two cannot
   disagree. Shown when ALL hold:
     · a real member (never the sample);
     · a stock book — MFTURN carries a median for it (MultiAsset re-weights, it
       does not swap names, so it has none);
     · joined within this cycle, and this device has no previous book (a first cycle);
     · from the 5th of the month, with at least a day to the next 1st — around the
       1st the book is new and placing it now IS starting on the rebalance;
     · not a pinned 1-month plan (it cannot start on the next set without renewing);
     · no order of this cycle ticked yet (once one is, the member has chosen).
   The words are V39.1's, except the first sentence: "You joined N days before a
   rebalance" was measured from NOW, which over a wider window misstates the join. */
function _lateJoinState(now){
  var st = { show: false };
  try {
    now = now || new Date();
    var su = window._currentSub || {};
    var key = _strategyPerfKey(String(su.strategy || currentStrategy || ''));
    var med = key ? _mfData(key + ':median') : '';
    var joined = su.subscribed_at ? new Date(su.subscribed_at) : null;
    var nextReb = nextRebalanceDate(now);
    var daysToReb = Math.max(0, daysBetween(now, nextReb));
    var cycStart = new Date(nextReb.getTime()); cycStart.setMonth(cycStart.getMonth() - 1);
    var firstCycle = !(window._bookDiff && window._bookDiff.known);
    var ticked = false;
    try {
      var bm = loadBought(currentStrategy) || {};
      ticked = cycleOrders().all.map(orderKey).some(function(k){ return !!bm[k]; });
    } catch (e) {}
    st = { nextReb: nextReb, daysToReb: daysToReb, med: med,
           show: !!(!isDemo && med && joined && !isNaN(joined.getTime()) && joined >= cycStart && firstCycle &&
                    now.getDate() >= 5 && daysToReb >= 1 && !_subIsPinned(su) && !ticked) };
  } catch (e) {}
  return st;
}
/* V44.4: a member in their first month: no earlier book on record, joined within 45 days. A long-standing
   member on a new device has an older subscribed_at, so this stays false for them. Drives the extra set-up
   rows and the calmer first-month screen, and nothing about any order. */
function _fmNow(){ try { return !!window._isFirstMonth(); } catch (e) { return false; } }   // V44.5
window._isFirstMonth = function () {
  try {
    if (demoMode === 'first') return true;
    if (isDemo) return false;
    var su = window._currentSub || {}, j = su.subscribed_at ? new Date(su.subscribed_at) : null;
    if (!j || isNaN(j.getTime())) return false;
    var known = !!(window._bookDiff && window._bookDiff.known);
    return !known && (Date.now() - j.getTime()) / 864e5 <= 45;
  } catch (e) { return false; }
};
function _renderLateJoin(){
  var jn = document.getElementById('cyc-join');
  if (!jn) return;
  var s = _lateJoinState();
  if (!s.show){ jn.hidden = true; jn.innerHTML = ''; return; }
  var d = mfDate(s.nextReb, { day: 'numeric', month: 'short' });
  var days = s.daysToReb + '\u00a0day' + (s.daysToReb === 1 ? '' : 's');
  jn.innerHTML = 'The next book lands on <b>' + d + '</b>, in <b>' + days + '</b>. Buying now means the orders below today, ' +
    'then about <b>' + s.med + '</b> more on <b>' + d + '</b>, when roughly half the book changes. ' +
    'Starting on ' + d + ' means one set of orders. The backtest enters on rebalance days — which to do is your call.';
  jn.hidden = false;
}

function renderCycleRail(now, expiry, nextReb, daysLeft, daysToReb){
  var card = document.getElementById('cyc-card');
  if (!card) return;
  if (!isFinite(daysLeft) || !isFinite(daysToReb)) { card.style.display = 'none'; return; }

  var fmt = function(d){ return mfDate(d, {day:'numeric', month:'short'}); };
  /* V41.7 — the access date carries its year when it is not this year's. A 12-month
     member read "Access runs to 5 May." beside "active until 5 May 2027", and on the
     day they joined, "Access runs to 17 Oct." read as today. */
  var fmtX = function(d){ return mfDate(d, (d && d.getFullYear && d.getFullYear() !== now.getFullYear())
    ? {day:'numeric', month:'short', year:'numeric'} : {day:'numeric', month:'short'}); };
  var dayWord = function(n){ return n + ' day' + (n === 1 ? '' : 's'); };
  // Shared axis. Both bars are drawn against the SAME denominator, so a longer bar
  // always means a later date. Guard the degenerate both-zero case (bars would be
  // 0/0) by giving the axis a floor of 1 day.
  var axis = Math.max(1, daysLeft, daysToReb);

  /* V38.7 — the rail is a countdown, and a countdown with 294 days on it is not
     news. Past RAIL_FULL_FROM days of access the card keeps its one useful line
     (when the next picks land) and drops the two meters and the renewal row;
     inside it, the card is exactly what it was. */
  card.classList.toggle('is-calm', daysLeft > RAIL_FULL_FROM);

  var vExp = document.getElementById('cyc-val-exp');
  var vReb = document.getElementById('cyc-val-reb');
  if (vExp) vExp.innerHTML = fmtX(expiry) + ' · <b>' + dayWord(daysLeft) + '</b>';
  if (vReb) vReb.innerHTML = fmt(nextReb) + ' · <b>' + dayWord(daysToReb) + '</b>';

  var covered = daysLeft >= daysToReb;          // access reaches the next rebalance
  var gap = Math.abs(daysLeft - daysToReb);
  var badge = document.getElementById('cyc-badge');
  if (badge) {
    // V39.1 — a pinned (1-month) plan never receives the next book, so it is
    // never "covered", however many days of access are left.
    var pinned = _subIsPinned();
    badge.className = 'cyc-badge ' + (covered && !pinned ? 'ok' : 'warn');
    badge.textContent = pinned ? 'Next set needs a renewal' : (covered ? 'Next rebalance covered' : 'Renewal due first');
  }
  var foot = document.getElementById('cyc-foot');
  if (foot && card.classList.contains('is-calm')) {
    // Calm: one line, about the next set of picks rather than about billing.
    foot.innerHTML = 'Your next set of picks lands on <b>' + fmt(nextReb) + '</b> — ' +
      dayWord(daysToReb) + '. Access runs to ' + fmtX(expiry) + '.';
  } else if (foot) {
    // V35.2 — the retired "Subscription" tile carried the words "Renew anytime on
    // WhatsApp" at every day count, while the status pill only grows a renew BUTTON
    // inside the last 14 days. Retiring the tile would have left a member with 20
    // days left no renewal affordance at all, so the rail — now the page's only
    // countdown — carries a persistent link. Same wa.me target and prefilled
    // message the pill's CTA and the stat tile used.
    foot.innerHTML = (covered && _subIsPinned())
      ? (_subIsFree()
          ? 'This free registration was set up as a single month, so its picks stay fixed. Re-register (₹0) and the new one updates itself: the <b>' + fmt(nextReb) + '</b> set will reach you.'
          : 'Your access runs to <b>' + fmtX(expiry) + '</b>, but a 1-month plan is one book: the <b>' + fmt(nextReb) + '</b> set needs a renewal.')
      : covered
      ? 'Your access runs to <b>' + fmtX(expiry) + '</b>, so the <b>' + fmt(nextReb) +
        '</b> rebalance is included' + (gap ? ' with <b>' + dayWord(gap) + '</b> to spare' : '') + '.'
      : daysLeft === 0
        ? 'Your access has ended — renew to receive the <b>' + fmt(nextReb) + '</b> picks.'
        : 'Your access ends <b>' + dayWord(gap) + '</b> before the <b>' + fmt(nextReb) +
          '</b> rebalance — renew to receive that set of picks.';
  }
  // V35.2 — see the #cyc-actions note in the markup. The status pill already grows
  // a .renew-cta at <=14 days; this fills the gap above that so a member is never
  // without a renewal route, and the two never both appear.
  var acts = document.getElementById('cyc-actions');
  if (acts){
    /* V38.7 — A RENEWAL BUTTON 294 DAYS BEFORE RENEWAL.
       An annual member signing in to place this month's orders met, before a
       single holding: "Subscription active until 10 Jul 2027", an access-ends
       meter, and a green Renew on WhatsApp button — roughly a screen and a half
       of billing ahead of the thing they came for. V35.2 added the persistent
       link so a member at 20 days was never without a renewal route; that was
       right, and it was applied at every day count instead of near the end.
       Below 45 days the button is restored exactly as V35.2 wrote it, and the
       pill's own CTA still takes over inside 14. */
    if (daysLeft > 14 && daysLeft <= RENEW_CTA_FROM && _subIsFree()){
      acts.innerHTML = _freeRenewCta();            // V39.1 — ₹0 needs no chat
      acts.style.display = '';
    } else if (daysLeft > 14 && daysLeft <= RENEW_CTA_FROM){
      var sub = window._currentSub || {};
      acts.innerHTML = '<a class="renew-cta" target="_blank" rel="noopener" href="https://wa.me/917601032082?text=' +
        encodeURIComponent('Hi MindForge Capital — I would like to renew my subscription. Strategy: ' +
          (sub.strategy || '') + '. Email: ' + (sub.email || '') + '.') +
        '"><svg viewBox="0 0 24 24" fill="currentColor" fill-rule="evenodd" clip-rule="evenodd" aria-hidden="true"><path d="M20.52 3.48A11.93 11.93 0 0 0 12.04 0C5.46 0 .12 5.34.12 11.92c0 2.1.55 4.15 1.6 5.95L0 24l6.27-1.64a11.9 11.9 0 0 0 5.77 1.47h.01c6.58 0 11.92-5.34 11.92-11.92 0-3.18-1.24-6.18-3.45-8.43z"/></svg>Renew on WhatsApp</a>';
      acts.style.display = '';
    } else {
      acts.innerHTML = ''; acts.style.display = 'none';
    }
  }

  /* V39.1 — B5. JOINED DAYS BEFORE A REBALANCE. A member who joins on the 25th is
     shown the whole book to deploy, with nothing saying that about half of it is
     re-scored in six days — the avoidable work and short-term tax they came here
     to escape. Neutral arithmetic, both options, no recommendation. The median is
     MFTURN (machine-written); MultiAsset has none (it re-weights, it does not
     swap names) and a pinned 1-month plan cannot "start on" the next set without
     renewing, so neither sees it.
     V41.6 — A3: the whole first cycle from the 5th, not only its last 7 days; the
     state and the words now live in _lateJoinState() / _renderLateJoin(). */
  try { _renderLateJoin(); } catch (e) {}

  // V37.5 — calendar reminders for the next rebalance and the access end date.
  try {
    window._cycDates = { reb: nextReb, exp: expiry };
    var cal = document.getElementById('cyc-cal'), g = document.getElementById('cyc-cal-g');
    if (cal && g && nextReb && !isNaN(nextReb.getTime())){
      var ev = _cycCalEvents();
      var reb = ev[0];
      g.href = 'https://calendar.google.com/calendar/render?action=TEMPLATE' +
        '&text=' + encodeURIComponent(reb.title) +
        '&dates=' + reb.d0 + '/' + reb.d1 +
        '&details=' + encodeURIComponent(reb.desc) +
        (reb.rrule ? '&recur=' + encodeURIComponent('RRULE:' + reb.rrule) : '');   // V43.1 — A2
      g.setAttribute('aria-label', reb.rrule
        ? 'Add every 1st to ' + fmtX(expiry) + ' to Google Calendar (opens in a new tab)'
        : 'Add the ' + fmt(nextReb) + ' rebalance to Google Calendar (opens in a new tab)');
      /* V43.1 — A2: say what the buttons add, once it is more than one date */
      var rec = document.getElementById('cyc-cal-rec');
      if (rec) { rec.textContent = reb.rrule ? 'every 1st, to ' + fmtX(expiry) : ''; rec.hidden = !reb.rrule; }
      cal.hidden = false;
    }
  } catch (e) {}

  card.style.display = '';
  // Grow on reveal — the site's bar idiom. Painting the final width immediately
  // leaves a dead transition, so apply the widths a frame later.
  var fExp = document.getElementById('cyc-fill-exp');
  var fReb = document.getElementById('cyc-fill-reb');
  setTimeout(function(){
    if (fExp) fExp.style.width = (daysLeft / axis * 100).toFixed(1) + '%';
    if (fReb) fReb.style.width = (daysToReb / axis * 100).toFixed(1) + '%';
  }, 60);
}

/* V37.5 — the events behind "Remind me". All-day, in the member's local date
   (the dates on this card are already local), and carrying NO token or other
   session value: the link back is the bare dashboard URL, which resolves from
   the cookie session (V29.8 — no credential-shaped value in a URL, and a
   calendar entry is a URL that gets synced to other devices and shared). */
function _cycYmd(d){
  return d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
}
function _cycCalEvents(){
  var dd = window._cycDates || {}, sub = window._currentSub || {};
  var strat = String(sub.strategy || 'MindForge').replace(/\s+/g, ' ');
  var url = 'https://mindforgecapital.com/dashboard.html';
  var out = [];
  var mk = function(date, title, desc, uidTag){
    if (!date || isNaN(date.getTime())) return;
    var next = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
    out.push({ title:title, desc:desc, d0:_cycYmd(date), d1:_cycYmd(next),
               uid:'mfc-' + uidTag + '-' + _cycYmd(date) + '-' + strat.replace(/[^a-z0-9]+/gi, '').toLowerCase() + '@mindforgecapital.com' });
  };
  /* V43.1 — A2. A plan that updates itself (the free book, 3/6/12 months) gets the
     1st EVERY month to its access end, in the evening: ten minutes after work,
     and orders confirmed then go in at the next morning's open. A 1-month plan
     is pinned to one book, so it keeps the single date. No token goes in a
     calendar: the URL is the bare dashboard. */
  var recur = dd.reb && dd.exp && !isNaN(dd.exp.getTime()) && dd.exp > dd.reb && !_subIsPinned(sub);
  mk(dd.reb, recur ? strat + ': this month\u2019s orders (about 10 min)' : strat + ': new picks published',
     recur ? 'The month\u2019s list is on your dashboard today. Open it, send the orders and tick them off: ' + url
           : 'Your next set of picks is published today. Open your dashboard to see what changed and place the orders: ' + url, 'rebalance');
  if (recur && out.length) { out[0].rrule = 'FREQ=MONTHLY;BYMONTHDAY=1;UNTIL=' + _cycYmd(dd.exp); out[0].alarm = 'PT19H'; }
  mk(dd.exp, strat + ': subscription access ends',
     'Your MindForge access ends today. Renew to keep receiving new picks: ' + url, 'expiry');
  return out;
}
function addCycleToCalendar(){
  try {
    var ev = _cycCalEvents();
    if (!ev.length) return;
    _downloadIcs(ev, 'reminders', 'reminder');
  } catch (e) {}
}
/* V39.5 — the writer, shared: the cycle reminders (V37.5), the advance-tax dates
   (B5) and a sale held back by the member's holding period (B2). An event may
   carry its own `alarm` (an RFC 5545 duration); the default is 9 am on the day. */
function _downloadIcs(ev, fileTag, noun){
  try {
    if (!ev || !ev.length) return;
    var esc = function(t){ return String(t).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n'); };
    var now = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
    var lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//MindForge Capital//Member dashboard//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
    ev.forEach(function(e){
      lines.push('BEGIN:VEVENT', 'UID:' + e.uid, 'DTSTAMP:' + now,
        'DTSTART;VALUE=DATE:' + e.d0, 'DTEND;VALUE=DATE:' + e.d1);
      if (e.rrule) lines.push('RRULE:' + e.rrule);   // V43.1 — A2
      lines.push(
        'SUMMARY:' + esc(e.title), 'DESCRIPTION:' + esc(e.desc), 'URL:https://mindforgecapital.com/dashboard.html',
        'TRANSP:TRANSPARENT',
        'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:' + esc(e.title), 'TRIGGER:' + (e.alarm || 'PT9H'), 'END:VALARM',
        'END:VEVENT');
    });
    lines.push('END:VCALENDAR');
    // RFC 5545 §3.1: content lines longer than 75 octets are folded (CRLF + one space).
    var fold = function(l){ var o = [], first = true; while (l.length > (first ? 73 : 72)){ var n = first ? 73 : 72; o.push(l.slice(0, n)); l = l.slice(n); first = false; } o.push(l); return o.join('\r\n '); };
    var blob = new Blob([lines.map(fold).join('\r\n') + '\r\n'], { type:'text/calendar;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'mindforge-' + (fileTag || 'reminders') + '-' + ev[0].d0 + '.ics';
    document.body.appendChild(a); a.click();
    setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); }, 1500);
    noun = noun || 'reminder';
    showToast('Calendar file ready — open it to add ' + ev.length + ' ' + noun + (ev.length === 1 ? '' : 's'));
  } catch (e) {}
}

// V28.2 — how long is THIS member's billing term? MindForge sells monthly,
// quarterly, half-yearly and annual plans, so "30" is only right for one of them.
// subscribed_at → expires_at is the real span. Guard rails: the sheet stores free
// text, so reject anything that fails to parse, runs backwards, or exceeds a sane
// ceiling. Returns null when the term cannot be known — the caller then hides the
// meter rather than printing a guess as if it were the plan the member bought.
function subscriptionTermDays(sub, expiry){
  try {
    if (!sub || !sub.subscribed_at) return null;
    var start = new Date(sub.subscribed_at);
    if (isNaN(start.getTime()) || isNaN(expiry.getTime())) return null;
    var span = daysBetween(start, expiry);
    if (!isFinite(span) || span < 1 || span > 3660) return null;
    return span;
  } catch (e) { return null; }
}

// V3.7: number rollup for stat cards (v2: hidden-tab safe)
function _animateCount(el, target, opts) {
  opts = opts || {};
  const unitHtml = opts.unitHtml || '';
  const target_n = Number(target) || 0;
  // V37.6 — a count can be re-written before its 950ms tween ends (the Orders
  // tile moves with every tick), and the belt-and-braces timeout below would then
  // put the OLD target back. Each call owns the element until the next one.
  const tok = {}; el._acTok = tok;
  // Short-circuit when animation can't or shouldn't run:
  //  - prefers-reduced-motion
  //  - target is 0 (nothing satisfying about 0→0)
  //  - tab is hidden (requestAnimationFrame is throttled / paused in background tabs,
  //    so the value would stick at "—" until the user returns)
  if (
    window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
    target_n === 0 ||
    document.hidden
  ) {
    el.innerHTML = target_n + unitHtml;
    return;
  }
  const dur = 950;
  const start = performance.now();
  function step(now) {
    if (el._acTok !== tok) return;
    const t = Math.min(1, (now - start) / dur);
    const eased = 1 - Math.pow(1 - t, 3);
    const v = Math.round(target_n * eased);
    el.innerHTML = v + unitHtml;
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
  // Belt-and-braces: if rAF never fires (background tab promoted mid-animation
  // and then re-hidden, etc.) guarantee the final value lands.
  setTimeout(function() { if (el._acTok === tok) el.innerHTML = target_n + unitHtml; }, dur + 250);
}

// ── V21.3: STRATEGY SWITCHER ────────────────────────────────────────────────
// Turns the "Strategy:" hero pill into a dropdown when the member can open two or
// more strategies on this device. Demo mode seeds the demo fixture so the control
// is still reachable; real sessions accumulate {strategy → token} pairs in the
// cookie-backed registry (recordStrat) as each access link is opened.
// V29.0: demo used to carry ONE strategy, so entries.length < 2 and the switcher
// never even wired up under ?demo=1 — which is exactly why the switch path was
// never exercised in QA and shipped broken. Two real books now, so the pill, its
// menu and the switch itself are all reachable locally. Values are the ?demo=
// modes _demoData() branches on.
const _DEMO_STRATS = {
  'MindForge LargeMidcap\u00A0250': '1',
  'MindForge MultiAsset':      '2'
};
let _stratMenuWired = false;
/* V42.1 — A4. EACH BOOK'S ACCESS END, BESIDE ITS NAME IN THE SWITCHER. A member with
   two or three books saw three names and nothing else: not which book's access ends
   when. my_strategies already returns `expires_at` for every held book on each load
   (syncStrategiesFromServer), so it is kept per device beside the switcher's list of
   books — never in a URL — and the current book's date comes from its own subscription. */
var _STRAT_EXP_KEY = 'mfc_dash_strat_exp';
function _stratNameKey(n){ return String(n == null ? '' : n).replace(/\u00A0/g, ' ').trim(); }
function _stratExpRead(){ try { return JSON.parse(localStorage.getItem(_devKey(_STRAT_EXP_KEY)) || '{}') || {}; } catch (e) { return {}; } }
function _stratExpWrite(m){ try { localStorage.setItem(_devKey(_STRAT_EXP_KEY), JSON.stringify(m)); } catch (e) {} }
function _stratExpLabel(iso){
  if (!iso) return '';
  var d = new Date(iso); if (isNaN(d)) return '';
  return (d < new Date() ? 'Access ended ' : 'Access to ') + mfDate(d, { day:'numeric', month:'short', year:'numeric' });
}

function setupStrategySwitcher(activeStrategy){
  const pill = document.getElementById('pill-strategy');
  if (!pill) return;

  // Build the switchable set + how to open each entry.
  let entries;
  if (isDemo){
    entries = Object.keys(_DEMO_STRATS).map(n => ({ name:n, kind:'demo', value:_DEMO_STRATS[n] }));
  } else {
    const reg = recordStrat(activeStrategy, token);      // remember this strategy, then read the whole map
    entries = Object.keys(reg).map(n => ({ name:n, kind:'token', value:reg[n] }));
  }

  entries.sort((a,b) => a.name.localeCompare(b.name));

  // V29.6 — THE "I STILL CAN'T SWITCH" BUG.
  // The registry is a per-DEVICE memory: it only ever learned a strategy when the
  // member opened that strategy's own access link on THIS browser, or completed an
  // OTP sign-in (login.html seeds every active sub at once, V21.5). A member who
  // lands on the dashboard from a single emailed link — the normal path — knows
  // exactly ONE strategy, so `entries.length < 2` was true and the pill silently
  // stayed a plain label. Nothing was broken; the switcher simply never appeared,
  // and there was no way to discover that signing in would summon it. From the
  // member's side that is indistinguishable from "switching doesn't work".
  //
  // Two fixes, layered so the first works with no backend redeploy:
  //   1. The pill is now ALWAYS a switcher on a real session. When fewer than two
  //      strategies are known it still opens, showing what is known plus a
  //      "Find my other strategies" row that runs the OTP sign-in — which seeds
  //      the registry with every active sub and lands back here.
  //   2. syncStrategiesFromServer() (below) asks the backend for the member's full
  //      active set on load, so the menu usually fills itself before they ever
  //      need row 1. Fail-soft: on an older deployment it is a no-op.
  const needsDiscovery = !isDemo && entries.length < 2;
  if (isDemo && entries.length < 2){ pill.classList.remove('has-switcher'); return; }

  // Upgrade the pill to an interactive combobox (idempotent — safe on re-render).
  pill.classList.add('has-switcher');
  pill.setAttribute('role', 'button');
  pill.setAttribute('tabindex', '0');
  pill.setAttribute('aria-haspopup', 'listbox');
  pill.setAttribute('aria-expanded', 'false');
  pill.setAttribute('title', 'Switch strategy');

  // V21.6: one-time attention nudge so a first-time member actually notices the
  // pill is a switcher. Fires at most once per device (localStorage flag), then
  // never again — returning members aren't nagged.
  try {
    if (!localStorage.getItem(_devKey('mfc_strat_switch_hinted'))){
      localStorage.setItem(_devKey('mfc_strat_switch_hinted'), '1');
      pill.classList.add('nudge');
      setTimeout(function(){ pill.classList.remove('nudge'); }, 3800);
    }
  } catch(e){}

  if (!pill.querySelector('.strat-caret')){
    const caret = document.createElement('span');
    caret.className = 'strat-caret';
    caret.setAttribute('aria-hidden', 'true');
    caret.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>';
    pill.appendChild(caret);
  }

  // The menu is a body-level fixed portal (id strat-portal-menu), NOT a child of the
  // pill. That deliberately escapes every ancestor stacking-context and overflow clip
  // on the hero — the hero and the stats grid live in separate .container wrappers, so
  // an in-place absolute menu was painted over / clipped by the stats cards below.
  let menu = document.getElementById('strat-portal-menu');
  if (!menu){
    menu = document.createElement('div');
    menu.id = 'strat-portal-menu';
    menu.className = 'strat-menu';
    menu.setAttribute('role', 'listbox');
    menu.setAttribute('aria-label', 'Choose strategy');
    document.body.appendChild(menu);
  }
  // Strategy names are backend-supplied strings that land in innerHTML — escape them.
  function _esc(s){
    return String(s == null ? '' : s).replace(/[<>&"']/g, function(ch){
      return {'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;'}[ch];
    });
  }
  const _exp = isDemo ? {} : _stratExpRead();             // V42.1 — A4
  menu.innerHTML =
    '<div class="strat-menu-head">Your strategies</div>' +
    entries.map(function(e){
      const active = (e.name === activeStrategy);
      const expLbl = e.kind === 'token'
        ? _stratExpLabel(_exp[_stratNameKey(e.name)] || (active && window._currentSub && window._currentSub.expires_at))
        : '';
      return '<button type="button" class="strat-opt' + (active ? ' is-active' : '') + '" role="option"' +
             ' aria-selected="' + (active ? 'true' : 'false') + '"' +
             ' data-kind="' + e.kind + '" data-value="' + encodeURIComponent(e.value) + '">' +
             '<span class="strat-opt-dot" aria-hidden="true"></span>' +
             '<span class="strat-opt-name">' + _esc(e.name) +
               (expLbl ? '<span class="strat-opt-sub">' + _esc(expLbl) + '</span>' : '') + '</span>' +
             '<span class="strat-opt-check" aria-hidden="true">' +
               (active ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>' : '') +
             '</span></button>';
    }).join('') +
    // V29.6: the escape hatch for a device that only knows one strategy. `kind:'find'`
    // is handled in chooseStrategy() and sends the member through OTP sign-in, which
    // seeds the registry with EVERY active sub (login.html renderSubscriptions).
    (needsDiscovery
      ? '<button type="button" class="strat-opt strat-opt-find" role="option" aria-selected="false" data-kind="find" data-value="">' +
          '<span class="strat-opt-dot is-find" aria-hidden="true"></span>' +
          '<span class="strat-opt-name">Find my other strategies</span>' +
          '<span class="strat-opt-check" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg></span>' +
        '</button>' +
        '<div class="strat-menu-foot">Subscribed to more than one? Sign in to load them all here.</div>'
      : '');

  // Anchor the fixed menu under the pill, clamped to the viewport on BOTH axes.
  //
  // V29.8 — the vertical clamp was missing, and on a small phone that hid a
  // strategy behind an edge no gesture could reach. Measured at 320x568: the
  // "Strategy:" pill wraps to two lines (69px tall) and sits at y=364, so the
  // menu opened at y=441 with a height of 176 — bottom 617 against a 568-tall
  // viewport. The third strategy was half off-screen, and because the menu is
  // position:fixed with a scroll handler that DISMISSES it, scrolling to reach
  // that row closed it instead. On the smallest common phone the third book was
  // simply unreachable, which reads as "I can't switch to it".
  //
  // Now: measure the space below the pill and above it, open downwards when
  // there is room, flip upwards when there is more room there, and in either
  // case cap the height to what actually fits so the list scrolls INSIDE the
  // menu. Menu-internal scrolling does not trigger the dismiss handler, which
  // listens on window.
  function positionMenu(){
    const GAP = 8, EDGE = 12;
    const r  = pill.getBoundingClientRect();
    const vh = window.innerHeight, vw = window.innerWidth;

    menu.style.minWidth = Math.max(240, Math.round(r.width)) + 'px';
    menu.style.maxHeight = 'none';            // measure the natural height first
    const w = menu.offsetWidth;               // layout width (transform-agnostic)
    const h = menu.offsetHeight;

    let left = r.left;
    if (left + w > vw - EDGE) left = vw - w - EDGE;
    if (left < EDGE) left = EDGE;
    menu.style.left = Math.round(left) + 'px';

    const below = vh - r.bottom - GAP - EDGE;   // room under the pill
    const above = r.top - GAP - EDGE;           // room over it
    let top, cap;
    if (h <= below || below >= above) {         // downwards: fits, or is the roomier side
      top = r.bottom + GAP;
      cap = below;
    } else {                                    // upwards
      cap = above;
      top = Math.max(EDGE, r.top - GAP - Math.min(h, cap));
    }
    menu.style.maxHeight = Math.max(120, Math.round(cap)) + 'px';
    menu.style.top = Math.round(Math.max(EDGE, top)) + 'px';
  }
  // V29.9 — KEEP THE MENU ANCHORED WHILE IT IS OPEN.
  // positionMenu() takes one measurement of the pill at open time, but the pill
  // MOVES afterwards: the hero's reveal animations settle, late data fills the
  // market-sentiment and live-profit cards above it, and the whole row shifts.
  // Measured at 844x390 (phone landscape): the pill sat at y=279 when the menu
  // was placed above it, then rose to y=269 a few hundred ms later while the
  // fixed menu stayed put — so the menu's bottom edge ended up 2px INSIDE the
  // pill and stayed there. The resize listener never fires for this; nothing
  // resized.
  // Re-measure on each frame while open, and only write styles when the pill has
  // actually moved, so a settled layout costs one rect read per frame and no
  // style thrash. Stops the moment the menu closes.
  var _anchorRaf = null;
  function cancelAnchor(){
    if (_anchorRaf == null) return;
    try { cancelAnimationFrame(_anchorRaf); } catch(e){}
    _anchorRaf = null;
  }
  function keepAnchored(){
    cancelAnchor();
    if (!window.requestAnimationFrame) return;   // no rAF: the open-time placement stands
    var last = null;
    (function tick(){
      if (!pill.classList.contains('open')){ _anchorRaf = null; return; }
      var r = pill.getBoundingClientRect();
      var key = Math.round(r.top) + ':' + Math.round(r.left) + ':' + Math.round(r.width);
      if (key !== last){ last = key; positionMenu(); }
      _anchorRaf = requestAnimationFrame(tick);
    })();
  }

  function openMenu(){
    // V29.9 — stop the one-time attention nudge the moment the menu opens. The
    // nudge (V21.6) exists to make a first-time member NOTICE the pill is a
    // switcher; once they have opened it, it has done its job and is only in the
    // way. It animates the pill ~6px down, and positionMenu() anchors the menu at
    // the pill's CURRENT bottom + 8 — so while it keeps bobbing afterwards the
    // pill dips into that 8px gap and grazes the top of the open menu.
    pill.classList.remove('nudge');
    positionMenu(); menu.classList.add('open'); pill.classList.add('open'); pill.setAttribute('aria-expanded','true');
    keepAnchored();
  }
  function closeMenu(){ cancelAnchor(); menu.classList.remove('open'); pill.classList.remove('open'); pill.setAttribute('aria-expanded','false'); }
  function toggleMenu(){ pill.classList.contains('open') ? closeMenu() : openMenu(); }

  // V29.0 — SWITCH ONLY ONCE THE TARGET IS KNOWN GOOD.
  // This used to overwrite mfc_dash_token with the chosen strategy's token and
  // reload immediately. If that token was dead — expired, revoked, superseded by
  // a renewal, or seeded into the registry by a login that has since changed —
  // the member did not just fail to switch: the ACTIVE session cookie was now the
  // dead token, the reload failed, and the error screen carries no switcher (it
  // is rendered instead of the dashboard, so setupStrategySwitcher never runs).
  // Their working strategy was still sitting in the registry and completely
  // unreachable. The only way back was to dig the original access link out of
  // email. That is the "cannot switch between strategies" report.
  // Now the target is probed FIRST and the session token is only replaced once
  // the backend has honoured it. A failure leaves the member exactly where they
  // were, on a working dashboard, and drops the dead entry so the menu self-heals.
  var _switching = false;
  function chooseStrategy(kind, value){
    if (kind === 'demo'){
      window.location.href = 'dashboard.html?demo=' + encodeURIComponent(value);
      return;
    }
    if (kind === 'find'){
      // OTP sign-in seeds mfc_dash_strats with every active {strategy → token},
      // so the member comes back with a fully populated switcher.
      window.location.href = 'login.html?from=switcher';
      return;
    }
    if (_switching) return;
    _switching = true;
    closeMenu();
    pill.classList.add('switching');
    if (window.showToast) showToast('Opening…');

    fetch(APPS_SCRIPT_URL + '?action=stocks&token=' + encodeURIComponent(value) + '&_=' + Date.now())
      .then(function(r){ return r.json(); })
      .then(function(data){
        if (isAuthFailure(data)){
          // definitive: this strategy's token is gone. Drop it and stay put.
          removeStratByToken(value);
          setupStrategySwitcher(currentStrategy);      // rebuild the menu without it
          if (window.showToast) showToast('That strategy is no longer active — removed from your list.');
          return;
        }
        if (!data || !data.subscription){
          if (window.showToast) showToast('Could not open that strategy. Please try again.');
          return;
        }
        // V29.8: hand the token over in sessionStorage, NOT in the URL. V29.7's
        // `?token=` navigation worked, but sw.js caches every navigation keyed by
        // the full url, so it wrote the member's access tokens into CacheStorage
        // on disk (and into history) once per switch. sessionStorage is same-tab,
        // survives the navigation, and is read+deleted by the loader below.
        // The cookie is still written first and is still authoritative — the
        // handoff exists so the reload cannot depend on a cookie race at all.
        writeDashToken(value);                 // …only now is it the active session
        try { sessionStorage.setItem(DASH_SWITCH_KEY, value); } catch(e){}
        /* V30.4 — a DIFFERENT destination url, as belt-and-braces.
           Be careful with the reasoning here, because the obvious story is wrong
           and was measured to be wrong. V29.7 changed this navigation to a
           different url specifically so it "can't degenerate into a same-url
           no-op", and V29.8 — rightly moving the token out of the url, because
           sw.js was writing `/dashboard.html?token=MFC…` to disk — went back to
           the bare path and restored the same-url property. That looked like the
           Safari bug. It is NOT: driven through safaridriver on the live origin,
           Safari 26.5.2 RELOADS on `location.replace(sameUrl)` exactly like Blink
           (a planted window marker does not survive it). The V29.8 probe said the
           same thing and was correct.
           So this nonce is not the fix — the pageshow guard below is. It is kept
           because a navigation whose destination differs from its origin cannot
           be coalesced by ANY engine or future version, it costs nothing, and it
           puts nothing secret in the url: sw.js excludes dashboard.html from
           CacheStorage by PATHNAME under any query string, and the loader strips
           the marker on arrival so it never reaches history or the address bar. */
        var dest = 'dashboard.html?' + DASH_SWITCH_PARAM + '=' + Date.now();
        window.location.replace(dest);
        /* And if the navigation still does not happen, say so instead of sitting
           there. A switch that silently does nothing has now cost two "still
           broken" reports; a switch that tells the member to reload costs none. */
        window._switchWatchdog = setTimeout(function(){
          try {
            if (window.showToast) showToast('Could not open that strategy — please reload the page.');
            pill.classList.remove('switching');
            _switching = false;
          } catch(e){}
        }, 4000);
      })
      .catch(function(){
        if (window.showToast) showToast('Could not reach the server. Please try again.');
      })
      .then(function(){
        _switching = false;
        pill.classList.remove('switching');
      });
  }

  // Wire interaction handlers once. pill + menu are stable elements (menu markup is
  // rebuilt in place on re-render), so first-call closures stay valid.
  if (!_stratMenuWired){
    _stratMenuWired = true;

    pill.addEventListener('click', function(ev){ ev.stopPropagation(); toggleMenu(); });

    menu.addEventListener('click', function(ev){
      const opt = ev.target.closest && ev.target.closest('.strat-opt');
      if (!opt) return;
      ev.stopPropagation();
      if (opt.classList.contains('is-active')){ closeMenu(); return; }
      chooseStrategy(opt.getAttribute('data-kind'), decodeURIComponent(opt.getAttribute('data-value')));
    });

    /* V28.1 — the menu is a role="listbox" of role="option" buttons, but the only
       keys it understood were Enter/Space/Escape ON THE PILL. ArrowDown did
       nothing (focus never entered the listbox), and Tab moved focus to the next
       control on the page while leaving the menu OPEN and floating over it — the
       menu is a body-level fixed portal, so it stayed put with focus elsewhere.
       Arrow keys, Home/End and Tab/focus-out now behave the way a listbox is
       expected to. Mouse behaviour is untouched. */
    function opts(){ return Array.prototype.slice.call(menu.querySelectorAll('.strat-opt')); }
    function focusOpt(i){
      const list = opts(); if (!list.length) return;
      const n = ((i % list.length) + list.length) % list.length;
      // .strat-menu is visibility:hidden until .open, and focus() on a
      // visibility:hidden element silently does nothing — so when the menu has
      // only just been opened, wait a frame for the style to land.
      list[n].focus();
    }
    pill.addEventListener('keydown', function(ev){
      if (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Spacebar'){
        if (ev.target === pill){ ev.preventDefault(); toggleMenu(); }
      } else if (ev.key === 'Escape'){
        closeMenu(); pill.focus();
      } else if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp'){
        ev.preventDefault();
        if (!pill.classList.contains('open')) openMenu();
        focusOpt(ev.key === 'ArrowDown' ? 0 : -1);
      }
    });
    menu.addEventListener('keydown', function(ev){
      const list = opts(); if (!list.length) return;
      const i = list.indexOf(document.activeElement);
      if (ev.key === 'ArrowDown'){ ev.preventDefault(); focusOpt(i + 1); }
      else if (ev.key === 'ArrowUp'){ ev.preventDefault(); focusOpt(i - 1); }
      else if (ev.key === 'Home'){ ev.preventDefault(); focusOpt(0); }
      else if (ev.key === 'End'){ ev.preventDefault(); focusOpt(-1); }
      else if (ev.key === 'Escape'){ ev.preventDefault(); closeMenu(); pill.focus(); }
      else if (ev.key === 'Tab'){ closeMenu(); }
    });
    // Focus leaving the pill+menu pair closes it — covers Tab out of the last
    // option and any programmatic focus move. focusout carries relatedTarget (the
    // element about to receive focus), so this fires on the way OUT rather than
    // relying on whatever gains focus next to bubble a focusin.
    /* ══════════════════════════════════════════════════════════════════════
       V30.5 — THIS IS THE BUG THAT MADE SAFARI UNABLE TO SWITCH STRATEGIES.
       Reported four times. Four investigations failed to reproduce it, and the
       reason they failed is the same reason it happens.

       WebKit does not focus a <button> on mousedown. (macOS convention: buttons
       take focus from Tab, not from a press.) So in Safari, pressing an option
       fires `focusout` on the pill/menu with **relatedTarget === null** — focus
       is leaving, and the browser cannot yet say where to. Blink focuses the
       button on mousedown, so relatedTarget is the option itself, which is
       inside `menu`, and this guard returns early.

       The old line read `if (next && (…contains(next))) return;` — so a NULL
       relatedTarget fell straight through to closeMenu(). Measured in Safari
       26.5.2 over safaridriver, with a real trusted click:

           POINTERDOWN <span class="strat-opt-name">  menuOpen=true
           DOC CLICK   <body>  inMenu=false           menuOpen=false

       The menu is torn down between pointerdown and click, so the click is hit-
       tested against <body>, the menu's own click handler never runs, and
       chooseStrategy() is never called. No fetch, no toast, no error, no
       navigation — the exact silence every report described.

       Why every previous test passed: they all drove the option with JS
       `.click()`, which dispatches a click and nothing else — no pointerdown, no
       focus move, so this path never engaged. A CDP sweep of 380 loads cannot
       see it. Only a real trusted click can.

       The fix: a null relatedTarget carries NO information about where focus
       went, so it is not evidence that focus left this menu — do not act on it.
       Nothing is lost. Clicking the page background still closes the menu via
       the document click handler below; moving focus somewhere real still closes
       it via `focusin`; Tab still closes it (Tab always names its next element,
       so relatedTarget is non-null); Escape and scroll are untouched.
       The pointer guard is belt-and-braces for the same instant: while a press
       that STARTED inside the menu is still in flight, a focus event must not
       dismantle the thing being pressed.
       ══════════════════════════════════════════════════════════════════════ */
    var _ptrInMenu = false;
    menu.addEventListener('pointerdown', function(){ _ptrInMenu = true; });
    menu.addEventListener('mousedown',   function(){ _ptrInMenu = true; });
    menu.addEventListener('touchstart',  function(){ _ptrInMenu = true; }, {passive:true});
    document.addEventListener('pointerup', function(){ setTimeout(function(){ _ptrInMenu = false; }, 0); });
    document.addEventListener('mouseup',   function(){ setTimeout(function(){ _ptrInMenu = false; }, 0); });
    document.addEventListener('touchend',  function(){ setTimeout(function(){ _ptrInMenu = false; }, 0); }, {passive:true});

    function closeIfFocusLeft(next){
      if (!pill.classList.contains('open')) return;
      if (_ptrInMenu) return;                                     // a press inside the menu is mid-flight
      if (!next) return;                                          // "focus left, destination unknown" — see above
      if (pill.contains(next) || menu.contains(next)) return;
      closeMenu();
    }
    menu.addEventListener('focusout', function(ev){ closeIfFocusLeft(ev.relatedTarget); });
    pill.addEventListener('focusout', function(ev){ closeIfFocusLeft(ev.relatedTarget); });
    document.addEventListener('focusin', function(ev){
      if (!pill.classList.contains('open')) return;
      if (_ptrInMenu) return;                  // V30.5: same in-flight press guard as above —
                                               // WebKit parks focus on <body> when a button is
                                               // pressed, and that must not dismiss the menu.
      if (pill.contains(ev.target) || menu.contains(ev.target)) return;
      closeMenu();
    });

    // Click outside (neither pill nor menu) closes; Escape closes; scroll dismisses;
    // resize keeps it anchored while open.
    document.addEventListener('click', function(ev){
      if (!pill.contains(ev.target) && !menu.contains(ev.target)) closeMenu();
    });
    document.addEventListener('keyup', function(ev){ if (ev.key === 'Escape') closeMenu(); });
    window.addEventListener('scroll', function(){ if (pill.classList.contains('open')) closeMenu(); }, { passive:true });
    window.addEventListener('resize', function(){ if (pill.classList.contains('open')) positionMenu(); }, { passive:true });
  }
}

function renderDashboard(sub, stocks) {
  window._currentSub = sub;
  // V35.3 — set here rather than only in loadLiveProfit. The newer-set notice
  // needs it and must not depend on a price fetch that never runs in demo mode,
  // never runs for an unpriced book, and races this render when it does.
  window._rebalDate = parseRebalanceDate(sub);
  // V35.2 — computed BEFORE renderTable() paints, because the rows carry a "new"
  // badge read off it. renderBookChange() is called near the end of this function
  // with the same object; bookDiff() itself must run exactly once per render.
  window._bookDiff = bookDiff(sub, stocks);
  document.getElementById('state-loading').style.display = 'none';
  document.getElementById('state-dashboard').style.display = 'block';

  const expiry = new Date(sub.expires_at);
  const now    = new Date();

  document.getElementById('hero-name').textContent = firstName(sub.name);
  // V39.3 — B4. "Welcome back" greeted members on their very first visit. First
  // visit = this device has never opened a dashboard AND holds no amount for this
  // book. A returning member on a NEW device is put right the moment the server
  // copy of their progress arrives (capitalSyncLoad). Never in demo.
  try {
    var _greet = document.getElementById('hero-greet');
    var _seen = false;
    try { _seen = !!localStorage.getItem('mfc_dash_seen'); } catch (e) {}
    if (_greet && !isDemo && !_seen && !(loadSavedCapital(sub.strategy || '') > 0)) _greet.textContent = 'Welcome';
    if (_greet && demoMode === 'first') _greet.textContent = 'Welcome';   // V44.4: the sample's month one
    if (!isDemo) { try { localStorage.setItem('mfc_dash_seen', '1'); } catch (e) {} }
  } catch (e) {}
  // expiry-date span lives inside the pill that we re-render below — defensive
  const _exp = document.getElementById('expiry-date');
  if (_exp) _exp.textContent = mfDate(expiry, {day:'numeric',month:'short',year:'numeric'});

  currentStrategy = sub.strategy || '';
  // V35.3 — the order checklist is cycle-scoped from this release. Adopt any
  // pre-V35.3 map into the cycle it was written for, then drop keys older than
  // the last two. Both need currentStrategy and window._bookDiff, and both must
  // run before anything reads loadBought().
  migrateBoughtKeys(currentStrategy);
  pruneBoughtKeys(currentStrategy);
  // V36.6 — then reconcile against the server copy. Deliberately NOT awaited:
  // the page renders from localStorage exactly as it always has, and re-renders
  // only if the server actually knew something this device did not. A member
  // offline, or on a deployment that has not been redeployed with the new
  // endpoints yet, sees no change in behaviour at all.
  progressSyncLoad(currentStrategy).then(function (changed) {
    if (changed) applyBoughtToDom();
  });
  // V38.2 — "since you last checked" digest. Reads a local snapshot of the last
  // visit and reports only real deltas; see renderWelcomeDigest() for the
  // honesty condition. Runs from localStorage alone so it works in ?demo=1 too.
  try { renderWelcomeDigest(); } catch (e) {}
  document.getElementById('strategy-name').textContent = currentStrategy || '—';
  setupStrategySwitcher(currentStrategy);   // V21.3: turn the pill into a switcher when ≥2 strategies are known

  // 1:1 Zoom call benefit — personalise the WhatsApp booking message
  var _ooc = document.getElementById('oneonone-cta');
  if (_ooc) _ooc.href = 'https://wa.me/917601032082?text=' + encodeURIComponent(
    "Hi MindForge Capital — I'd like to book my complimentary 1:1 Zoom call with Sagar Shekhawath (SEBI RA). Strategy: " +
    (sub.strategy || '') + ". Email: " + (sub.email || '') + ".");

  // Subscription urgency + progress bar
  const daysLeft = Math.max(0, daysBetween(now, expiry));
  // V28.2 — the billing term is NOT always 30 days. The site sells quarterly,
  // half-yearly and annual plans (5% / 10% / 20% off; see the homepage FAQ), so a
  // hard-coded 30 made this meter state something false for every member who is
  // not on the monthly plan: an annual subscriber with 300 days left produced
  // consumed = max(0, 30 - 300) = 0, i.e. a permanently EMPTY bar, and a tooltip
  // reading "300 of 30 days remaining" — a figure that cannot be true. The term
  // is derivable: subscribed_at is already returned by the backend (apps_script
  // sheet column G) and parseRebalanceDate() below already reads it.
  // When it is NOT derivable (a legacy row with a blank start date) the honest
  // answer is not a guessed term — it is no meter at all, the same choice the
  // deployment meter in the sizing card already makes.
  const cycleDays = subscriptionTermDays(sub, expiry);
  const knowTerm = cycleDays !== null;
  const consumed = knowTerm ? Math.min(cycleDays, Math.max(0, cycleDays - daysLeft)) : 0;
  const progPct = knowTerm ? (consumed / cycleDays) * 100 : 0;
  const expiryStr = mfDate(expiry, {day:'numeric',month:'short',year:'numeric'});
  const renewBtn = _subIsFree(sub) ? _freeRenewCta() :      // V39.1 — ₹0 needs no chat
    '<a class="renew-cta" target="_blank" rel="noopener" href="https://wa.me/917601032082?text=' +
    encodeURIComponent('Hi MindForge Capital — I would like to renew my subscription. Strategy: ' + (sub.strategy||'') + '. Email: ' + (sub.email||'') + '.') +
    '"><svg viewBox="0 0 24 24" fill="currentColor" fill-rule="evenodd" clip-rule="evenodd" aria-hidden="true"><path d="M20.52 3.48A11.93 11.93 0 0 0 12.04 0C5.46 0 .12 5.34.12 11.92c0 2.1.55 4.15 1.6 5.95L0 24l6.27-1.64a11.9 11.9 0 0 0 5.77 1.47h.01c6.58 0 11.92-5.34 11.92-11.92 0-3.18-1.24-6.18-3.45-8.43z"/></svg>Renew on WhatsApp</a>';

  // V35.2 — the "Subscription · N days left" tile was retired (see the stats-row
  // note), but the URGENCY it computed was never only its own: progClass and
  // dotClass drive the status pill's dot and its progress fill, and the same
  // reading now also tones the cycle rail, which is where the countdown lives.
  let progClass = '', dotClass = 'dot-green', urgency = '';
  if (daysLeft <= 7) {
    progClass = 'danger'; dotClass = 'dot-red';  urgency = 'is-urgent';
  } else if (daysLeft <= 14) {
    progClass = 'warn';   dotClass = 'dot-gold'; urgency = 'is-soon';
  }
  const cycCard = document.getElementById('cyc-card');
  if (cycCard){ cycCard.classList.remove('is-urgent','is-soon'); if (urgency) cycCard.classList.add(urgency); }

  // Status pill — base text + inline progress bar + (optional) renew CTA
  document.getElementById('pill-status').innerHTML =
    '<span class="' + dotClass + '"></span> Subscription active until <strong>' + expiryStr + '</strong>' +
    (knowTerm
      ? '<span class="sub-prog" title="' + daysLeft + ' of ' + cycleDays + ' days remaining">' +
          '<span class="sub-prog-bar"><span class="sub-prog-fill ' + progClass + '" data-bar="' + progPct.toFixed(0) + '%"></span></span>' +
        '</span>'
      : '') +
    (daysLeft <= 14 ? renewBtn : '');

  // V35.2 — #sub-meter and #reb-meter were the two retired tiles' micro-meters and
  // went with them. Both quantities they showed survive: position in the billing
  // term is still drawn by the status pill's .sub-prog fill from this same
  // progPct, and position in the monthly cycle is what the rail below draws.
  const nextReb = nextRebalanceDate(now);
  const daysToReb = Math.max(0, daysBetween(now, nextReb));

  // V28.2 — the cycle rail. Both countdowns on ONE axis (0 = today, full track =
  // whichever event lands later), so "does my access reach the next set of picks?"
  // is read off the bar lengths instead of subtracted in the reader's head.
  renderCycleRail(now, expiry, nextReb, daysLeft, daysToReb);
  // V35.3 — deliberately NOT hung off the live-price path the benchmark row uses:
  // that path never runs without prices (and never in demo), and whether a newer
  // book exists has nothing to do with whether a quote came back.
  loadBenchPerf().then(function(){ try { renderNewerSetNotice(); } catch(e){} });
  loadTrackRecord().then(function(){ try { renderTrackRecord(); } catch(e){} });

  // Total stocks
  _animateCount(document.getElementById('stat-stocks'), stocks.length);
  // Weighting copy depends on strategy: MultiAsset is composite-score weighted,
  // the other three are equal-weighted within their cap structure.
  let weightingCopy;
  if (!stocks.length)                              weightingCopy = 'awaiting new run';
  else if (/multiasset/i.test(currentStrategy))    weightingCopy = 'composite-score weighted';
  else                                             weightingCopy = 'equal-weighted by model';
  document.getElementById('stat-stocks-sub').textContent = weightingCopy;

  /* Industries — V30.3: count what the card actually DRAWS.
     This counted distinct `industry` values, which on the MultiAsset book is the
     single literal string "ETF". The card therefore printed the number 1 directly
     above its own V30.1 ribbon, which renderStatRibbon splits into FOUR segments
     via deriveAssetClasses(), and beside an allocation card listing those same
     four rows. A KPI that its own graphic contradicts is worse than no KPI.
     Same helper the ribbon uses, so the number and the bar beneath it cannot
     diverge again — and the LABEL moves with it, because four asset classes are
     not four industries and calling them that is the other half of the error. */
  const byAsset  = !!deriveAssetClasses(stocks);
  const groupSet = new Set(stocks.map(s =>
    (byAsset ? (assetClassOf(s) || 'Unknown') : ((s.industry || 'Unknown').trim() || 'Unknown'))
  ).filter(Boolean));
  const indLabelEl = document.getElementById('stat-industries-label');
  if (indLabelEl) indLabelEl.textContent = byAsset ? 'Asset Classes' : 'Industries';
  /* V37.3 — the picks table's own column header and the phone sort menu make the
     SAME decision and were making it with a hardcoded word. One writer, here,
     beside the KPI label, so the three can never disagree. */
  const _axis = byAsset ? 'Asset class' : 'Industry';
  const thGroup = document.getElementById('th-group');   // text-only cell
  if (thGroup) thGroup.textContent = _axis;
  const msGroup = document.getElementById('msort-group');
  if (msGroup) msGroup.textContent = _axis;
  _animateCount(document.getElementById('stat-industries'), groupSet.size);
  let industryCopy;
  if (!groupSet.size)                              industryCopy = '—';
  else if (byAsset)                                industryCopy = 'multi-asset diversified';
  /* V30.6 — this line has said "capped at 3 per" since it shipped: a sentence that
     stops before its noun and reads as truncated text, on the one KPI whose whole
     job is to state the diversification rule. The page's own block comment above
     the Why-these-25 card quotes the promise as "capped at 3 per industry", so the
     word was dropped, not omitted by design. The wording below was chosen by
     MEASUREMENT, not by taste: at 320/390/430/768/834/1024/1180/1280/1600 it wraps
     to exactly the same number of lines as the broken string it replaces and
     overflows at none of them, so no card grows and the KPI row keeps its heights.
     "max 3 per industry" rather than "3 per industry" because the cap is a ceiling —
     most industries in the book hold one or two. */
  else                                             industryCopy = 'sector-diversified\u00A0· max 2 per industry';
  document.getElementById('stat-industries-sub').textContent = industryCopy;

  // V30.1 — the bottom slot on these two KPIs (see .stat-pips / .stat-ribbon).
  renderStatPips(stocks);
  renderStatRibbon(stocks);

  renderWhy25();                // V28.9: what this book was selected on
  renderAllocation(stocks);
  renderPortfolioMap(stocks);   // V17.3: holdings mosaic, coloured by sector
  setupCapitalCalculator(stocks, currentStrategy);
  renderVerified(currentStrategy);   // V31.0 — broker-verified account, per book
  renderTable(stocks);
  try { csRender(); } catch (e) {}   // V39.5 — B1–B3: the rules card
  // V39.5 — the rules, from the member's row when the backend keeps them. Not awaited:
  // the page renders from this device's copy and re-renders only if the server knew more.
  csSyncLoad().then(function (changed) { if (changed) csApplyEverywhere(); else { try { csRender(); } catch (e) {} } });
  renderSectorChips();  // V5.2 #20: filter chips above the table
  restoreSort();        // V5.2 #1: re-apply user's last sort preference
  // V10.6 fix: a refresh / strategy switch rebuilt the rows fully visible while
  // the sector chip (and any search text) still looked applied — re-apply both
  // filters so state and table stay in sync. A filter pointing at a sector the
  // fresh data no longer has (strategy switch) is cleared instead: chips were
  // just rebuilt, so "no active chip" means the sector is gone.
  if (_sectorFilter && !document.querySelector('#sector-chips .chip.active')) _sectorFilter = '';
  if (_searchQ) filterStocks(_searchQ);
  applySectorFilter();
  var bp = document.getElementById('broker-picker'); // V5.2 #2: sync broker picker
  if (bp) bp.value = getBroker();
  // V24.5: every book is NSE, so the India-only brokers always apply — the V9.3
  // branch that hid Kite and reworded the how-to for USD books is gone.
  var htb = document.getElementById('howto-broker-text');
  if (htb) htb.textContent = 'Any broker works. On Zerodha, step 3 fills Kite baskets for you. Elsewhere it is one order ticket per name: Copy tickers or Export CSV gives you the list, and the Shares column is each quantity.';
  updateMarketStatus();
  // Set the market-status poll exactly once — refreshDashboard re-enters renderDashboard.
  if (!window._mfMarketTimer) {
    window._mfMarketTimer = setInterval(updateMarketStatus, 60000);
  }

  // V15.5: restore the saved rebalance-notification preference (server flag wins,
  // localStorage fallback) so the toggle no longer resets to OFF on refresh.
  restoreNotifState();

  // V35.2 — what changed since the last cycle. Computed once per render (bookDiff
  // rolls the stored history forward as a side effect, so a second call in the
  // same paint would report an empty diff) and published on window so the row
  // renderer can badge the new names without recomputing it.
  renderBookChange(window._bookDiff, stocks);
  try { renderSplitNotice(stocks); } catch (e) {}   // V44.5
  try { if (window.mfcV412Refresh) window.mfcV412Refresh(); } catch (e) {}   // V41.2 — B1, B3
  try { if (window.mfcV431Refresh) window.mfcV431Refresh(); } catch (e) {}   // V43.1 — B1, B2
  try { if (window.mfcInsight) window.mfcInsight.refresh('book'); } catch (e) {}   // V42.3 — the two modes and the insight cards

  // Reveal fade-up entrance
  requestAnimationFrame(() => {
    document.querySelectorAll('.fade-up').forEach((el, i) => {
      setTimeout(() => el.classList.add('visible'), i * 80);
    });
    // Animate bars on next tick
    setTimeout(() => {
      document.querySelectorAll('[data-bar]').forEach(b => { b.style.width = b.dataset.bar; });
    }, 150);
  });
}

/* V31.1 — SECTOR PALETTE, STEPPED AGAINST THE SURFACES IT IS ACTUALLY PAINTED ON.
   The previous set was picked for hue alone and never measured. Its lightness ran
   from OKLCH 0.49 (#1a50d8) to 0.80 (#eab308) — a 0.31 spread — so it could not
   clear the 3:1 non-text floor on both the white card and the near-black one:

     light (#ffffff / #f4f8ff): #2dd4bf 1.75:1 · #eab308 1.80:1 · #84cc16 1.85:1
                                #10b981 2.38:1 · #0ea5e9 2.60:1 · #d97706 2.99:1
     dark  (#132449 tile)     : #1a50d8 2.31:1

   Light is the default theme, and slot 0 is assigned to the LARGEST group by
   weight, so the dark miss always landed on the biggest slice of the donut.
   The donut is the one surface where colour is the only link between a segment
   and its row, so a swatch that cannot be seen cannot be matched.

   Every slot now sits at OKLCH L 0.60 with the highest chroma the sRGB gamut
   allows at that lightness, and the twelve hues are spaced evenly at 30° — the
   old ring had teal→green 19.4° apart and violet→indigo 15.6°, the two pairs a
   reader was most likely to confuse. Constant lightness is the point of a
   categorical set: no group should look louder than another.

   L 0.60 is not a taste; it is the ONLY lightness that works, and it was found by
   measuring the nineteen backdrops these swatches actually land on rather than
   assuming white and black. A dot inside a portfolio-map tile sits on a 13% wash
   of ITSELF (#dff3e3, #dff2ee…) and a chip dot sits on the chip's own pale pill
   (#e4ecfe), all of which cost about 0.25 of a ratio against plain white — enough
   that L 0.62 measured 2.85:1 there. Stepping down: L 0.61 → 2.98 light, L 0.62 →
   2.85 light; stepping up: L 0.59 → 2.96 dark, L 0.575 → 2.78 dark. At 0.60 the
   worst is 3.09:1 in light and 3.07:1 in dark. The window is one step wide.

   One palette serves both themes, so no re-ink on a theme flip is needed — which
   also keeps the `color + '22'` tint concatenation below working, where a CSS
   custom property would have broken it.

   Adjacent-pair separation stays in the sub-floor ΔE band (5.6 normal-vision): at
   twelve series that is arithmetic, not a choice — 30° is the widest even spacing
   twelve hues can have, and holding lightness constant (which the contrast window
   forces) leaves hue as the only separating channel. It is legal here because
   identity is never carried by colour alone on this page: every swatch has its
   group NAME printed beside it in the allocation legend, the filter chips and the
   industry badges, and its ticker in the portfolio map. The contrast failure had
   no such relief, which is why it is the one that had to go. */
const SECTOR_COLORS = [
  '#4073fd', '#098bc0', '#0a919d', '#0a957c', '#0a9b2b',
  '#7e8907', '#a17907', '#c16407', '#ee0d2a', '#e30c87',
  '#ca0dd7', '#9050fd'
];

// V11.3: one sector→colour map shared by the donut, the legend AND the holdings
// table, so each sector wears the SAME colour everywhere. Sectors are ranked by
// aggregate weight (descending) and assigned the palette by rank — the same order
// the legend uses, so the colours line up exactly across all three surfaces.
//
// IMPORTANT: always build this from the canonical `stocksData` (whose order is
// fixed for the life of a render), NOT from a re-sorted copy. Many books are
// equal-weighted, so sectors routinely TIE on aggregate weight; ties break by the
// order sectors first appear in the input, so feeding a column-sorted array would
// reshuffle the tie-broken colours and desync the table from the legend.
function buildSectorColorMap(stocks) {
  const agg = {};
  (stocks || []).forEach(s => {
    const k = (s.industry || 'Unknown').trim() || 'Unknown';
    agg[k] = (agg[k] || 0) + (Number(s.weight_pct) || 0);
  });
  const map = {};
  Object.entries(agg).sort((a, b) => b[1] - a[1])
    .forEach(([name], i) => { map[name] = SECTOR_COLORS[i % SECTOR_COLORS.length]; });
  return map;
}

/* V30.1 — "Total picks": one pip per holding, in the same slot the two
   countdown KPIs use for their .stat-meter. Books here are 8 (MultiAsset) or
   25 (equity), so every pip stays >= 2px wide; anything unexpectedly large
   would squeeze below legibility, so the strip simply stands down and the card
   goes back to looking exactly as it did before. */
function renderStatPips(stocks) {
  const host = document.getElementById('stat-pips');
  if (!host) return;
  const n = (stocks || []).length;
  if (!n || n > 40) { host.style.display = 'none'; host.innerHTML = ''; return; }
  let html = '';
  for (let i = 0; i < n; i++) html += '<i style="animation-delay:' + (i * 18) + 'ms"></i>';
  host.innerHTML = html;
  host.style.display = '';
  host.parentElement.title = n + ' holding' + (n === 1 ? '' : 's') + ' — one mark each';
}

/* V30.1 — "Industries": the sector split as one stacked bar. Grouping and colour
   are taken from the SAME two helpers the donut/legend/portfolio map use —
   deriveAssetClasses() (so a single-industry MultiAsset book splits by asset
   class exactly as the donut does, rather than collapsing to one bar) and
   buildSectorColorMap() — so a sector never wears two colours on this page. */
function renderStatRibbon(stocks) {
  const host = document.getElementById('stat-ribbon');
  if (!host) return;
  if (!stocks || !stocks.length) { host.style.display = 'none'; host.innerHTML = ''; return; }
  const aclasses = deriveAssetClasses(stocks);
  const groupOf = s => (aclasses ? assetClassOf(s) : ((s.industry || 'Unknown').trim() || 'Unknown'));
  const map = {};
  stocks.forEach(s => { const k = groupOf(s); map[k] = (map[k] || 0) + (Number(s.weight_pct) || 0); });
  const entries = Object.entries(map).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((t, e) => t + e[1], 0);
  if (!entries.length || total <= 0) { host.style.display = 'none'; host.innerHTML = ''; return; }
  const colorMap = buildSectorColorMap(stocks);
  host.innerHTML = entries.map(([name, w], i) =>
    '<i style="flex:' + (w / total).toFixed(5) + ';background:' +
    ((aclasses && ASSET_CLASS_COLORS[name]) || colorMap[name] || SECTOR_COLORS[0]) +
    ';animation-delay:' + (i * 45) + 'ms"></i>').join('');
  host.style.display = '';
  host.parentElement.title = entries.map(([n, w]) =>
    n + ' ' + (w / total * 100).toFixed(1) + '%').join(' · ');
}

// V17.3: Portfolio map — render the whole book as a sector-coloured mosaic.
// Tile width tracks model weight; sector colours are taken from the SAME shared
// map the donut/legend use (built from the canonical `stocks`, never a re-sorted
// copy — see buildSectorColorMap's note), so a tile's colour matches its sector
// swatch in the allocation card above. Fails silently if anything is missing.
function renderPortfolioMap(stocks) {
  const card = document.getElementById('pmap-card');
  const grid = document.getElementById('pmap-grid');
  const sub  = document.getElementById('pmap-sub');
  if (!card || !grid) return;
  /* V39.5 — C1. Tile width follows model weight, so on an equal-weight book
     (LargeMidcap, SmallMicro) this drew 10 or 15 identical tiles coloured by sector
     — the same fact as the sector card above it and the industry chips on the
     table, on a dashboard a time-poor member scrolls end to end. It stays where
     the sizes differ (MultiAsset's weighted asset classes). Hidden, not deleted:
     the ids are hooks. */
  if (!isWeightedBook(stocks || [])) { card.style.display = 'none'; return; }
  const list = (stocks || []).filter(s => s && (s.ticker || s.company_name));
  if (!list.length) { card.style.display = 'none'; return; }
  const colorMap = buildSectorColorMap(stocks);          // canonical → matches legend
  /* V29.1 — the map groups and colours by the same axis the allocation card drew.
     On a MultiAsset book that axis is asset class (see deriveAssetClasses): every
     holding shares the industry "ETF", so all eight tiles came out one colour,
     sorted by nothing, under the caption "1 sectors". Re-deriving here rather
     than reading the `_aclass` the card stamps keeps the two independent of the
     order the renderers happen to run in. */
  const mapClasses = deriveAssetClasses(list);
  const keyOf = s => (mapClasses ? (s._pmk || '') : ((s.industry || 'Unknown').trim() || 'Unknown'));
  if (mapClasses) list.forEach((s, i) => { s._pmk = mapClasses[i]; });
  // asset-class order follows weight, so the biggest class leads — as the card does
  const order = {};
  if (mapClasses) {
    const byClass = {};
    list.forEach(s => { byClass[keyOf(s)] = (byClass[keyOf(s)] || 0) + (Number(s.weight_pct) || 0); });
    Object.keys(byClass).sort((a, b) => byClass[b] - byClass[a]).forEach((k, i) => { order[k] = i; });
  } else {
    Object.keys(colorMap).forEach((k, i) => { order[k] = i; }); // weight-desc sector order
  }
  const maxW = Math.max.apply(null, list.map(s => Number(s.weight_pct) || 1)) || 1;
  const sorted = list.slice().sort((a, b) => {
    const ka = keyOf(a), kb = keyOf(b);
    if (order[ka] !== order[kb]) return (order[ka] ?? 99) - (order[kb] ?? 99);
    return (Number(b.weight_pct) || 0) - (Number(a.weight_pct) || 0);
  });
  // ── V28.2 — WEIGHT IS NOW DRAWN, NOT SIZED ────────────────────────────────────
  // The caption promised "tile size = model weight" and the tiles never delivered
  // it, in either direction:
  //   • equal-weight books (all three equity strategies) rendered TWO sizes —
  //     128.2px on full rows and 115px on the last one at 1440, 142 vs 115 at 820 —
  //     because .pmap-grid::after (flex-grow:99999) soaks the ragged last row and
  //     collapses its tiles to --pmap-min;
  //   • weighted books (MultiAsset, composite-score weighted) rendered ONE size:
  //     with 8 holdings on a single row that same 99999 spacer out-grows every
  //     tile's weight-proportional grow, so all eight sat at --pmap-min. Measured
  //     118px each for weights spanning 22.4% → 6.2%, a 3.6× range shown as 1.00×.
  // So the encoding was decorative at best and false at worst. Tiles are uniform
  // now (which is also what stops long tickers truncating), and weight is encoded
  // the way every other quantity on this site is — a bar on a shared axis, here the
  // largest holding in the book. Equal-weight books get no bar and say so.
  const wts = sorted.map(s => Number(s.weight_pct) || 0).filter(w => w > 0);
  const equalWeighted = wts.length > 1 &&
        (Math.max.apply(null, wts) - Math.min.apply(null, wts)) < 0.05;

  grid.innerHTML = sorted.map((s, i) => {
    const sector = keyOf(s);
    const color = (mapClasses && ASSET_CLASS_COLORS[sector]) || colorMap[sector] || SECTOR_COLORS[0];
    const w = Number(s.weight_pct) || 0;
    const tk = escapeHtml(s.ticker || s.company_name || '—');
    const nm = escapeHtml(s.company_name || s.ticker || '');
    const share = maxW > 0 ? Math.min(100, (w / maxW) * 100) : 0;   // no floor: a small weight is a small bar
    // V25.5: data-y / data-rec let the Return view match a tile to its live
    // price without re-deriving anything from the visible label.
    return '<div class="pmap-tile" data-sector="' + escapeHtml(sector) + '"'
      + ' data-y="' + escapeHtml(s.yahoo_ticker || '') + '" data-rec="' + (Number(s.recommended_price) || 0) + '"'
      + ' style="--pmi:' + i + ';background:' + color + '22;border-color:' + color + '55;--lens-c:' + color + ';"'
      + ' title="' + nm + ' · ' + escapeHtml(sector) + ' · ' + w.toFixed(1) + '% weight">'
      + '<span class="pmap-ticker">' + tk + '</span>'
      // ── V33.0 — THE SECOND LINE NOW CARRIES THE THING THE MAP IS GROUPED BY ──
      // V28.2 stopped SIZING an equal-weight tile by its weight, and V32.7 removed
      // the twenty-five identical bars from the picks table for the same reason.
      // The map still printed "4.0%" on all twenty-five tiles — the caption above
      // it already says "equal-weighted", so every tile spent its only other line
      // restating one shared fact — while the axis the tiles are sorted, grouped
      // and COLOURED by was written nowhere on them. A reader had to hover for a
      // title tooltip, or match a pastel against the legend in the card above, to
      // learn that this block of eight is Banks and the next is Pharma.
      // So: an equal-weight book labels the sector; a weighted book keeps the
      // percentage and its bar, because there the number varies and is the point.
      // The exact weight stays on the tile's title either way, so nothing is lost.
      + '<span class="pmap-wt"><span class="pmap-swatch" style="background:' + color + '"></span>'
      + (equalWeighted
          ? '<span class="pmap-sec">' + escapeHtml(sector) + '</span>'
          : '<span class="pmap-wtn">' + w.toFixed(1) + '%</span>'
            + '<i class="pmap-wtbar"><b data-bar="' + share.toFixed(1) + '%"></b></i>')
      + '</span>'
      + '</div>';
  }).join('');
  // V27.1 — set the tile floor from the WIDEST ticker in this book.
  // Tiles are flex-basis:0 now (so width tracks weight, not name length), which
  // means a long symbol would otherwise ellipsis away — BHARTIARTL truncated to
  // "BHART…" at 820px. Measure the real rendered text once and publish it as
  // --pmap-min, so min-width is exactly wide enough for the longest holding and
  // no wider. Falls back to the hard-coded floors in CSS if anything throws.
  try {
    const probe = grid.querySelector('.pmap-ticker');
    if (probe) {
      const cs = getComputedStyle(probe);
      const ctx = document.createElement('canvas').getContext('2d');
      ctx.font = cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
      const ls = parseFloat(cs.letterSpacing) || 0;   // measureText ignores tracking
      let widest = 0;
      sorted.forEach(s => {
        const t = String(s.ticker || s.company_name || '—');
        widest = Math.max(widest, ctx.measureText(t).width + t.length * ls);
      });
      // .pmap-tile padding (11 + 12) + the 1px borders, rounded up
      grid.style.setProperty('--pmap-min', Math.max(86, Math.ceil(widest + 25)) + 'px');
    }
  } catch (e) {}
  // V29.1 — name the axis the map actually used, and count it correctly. This
  // read "1 sectors" on every MultiAsset book: wrong noun, and wrong number too.
  const secCount = mapClasses ? new Set(mapClasses).size : Object.keys(colorMap).length;
  const secNoun = mapClasses ? ('asset class' + (secCount === 1 ? '' : 'es'))
                             : ('sector' + (secCount === 1 ? '' : 's'));
  if (sub) sub.textContent = sorted.length + ' holdings\u00A0· ' + secCount + ' ' + secNoun + ' · ' +
    (equalWeighted ? 'equal-weighted\u00A0· tile label = ' + secNoun.replace(/e?s$/, '')
                   : 'bar = model weight');
  card.style.display = '';
  // Grow on reveal — the site's bar idiom. Painting the final width immediately
  // would leave a dead transition (the V23.5 bug), so apply a frame later.
  setTimeout(function(){
    /* V34.9 — a non-zero weight must always paint. This track is
       `flex:1 1 auto; min-width:14px` inside a tile, so it measures 40-52px at
       every width and the MultiAsset book's smallest holding (3.7%) rendered
       1.5-1.9px — a bar that reads as empty beside a tile that says 3.7%. The
       floor is applied here rather than in CSS so a genuine 0.0% still reads as
       empty, and the proportion above the floor is untouched. */
    grid.querySelectorAll('.pmap-wtbar b[data-bar]').forEach(function(b){
      b.style.width = b.dataset.bar;
      if(parseFloat(b.dataset.bar) > 0) b.style.minWidth = '2px';
    });
  }, 80);
}

/* ══ V29.1 · WHEN "SECTOR" IS NOT A FACT ABOUT THE BOOK ══════════════════════
   The card below groups holdings by `industry`. For the two equity books that
   is the right axis and the "capped at 3 per" ruler above depends on it. For a
   MultiAsset member it is not an axis at all: every holding is an ETF, so the
   pipeline stamps industry "ETF" on all eight, and the card rendered a donut
   reading "1 SECTORS", one bar at 100.0%, and the caption "1 sector · 8
   holdings · full bar = largest sector (100.0%)". A donut, a bar and a count,
   all of them saying nothing — on the dashboard of the strategy this site
   gives away free, which is the one most members meet first.

   The fact that book IS about is the split the strategy is named for, and the
   strategies page promises it in words 8 ETFs across equity, gold, silver &
   debt — while showing eight rows that all say "ETF". Model weight per holding
   is already in memory here; only the bucket was missing.

   Derived, and deliberately timid about it:
   • It engages ONLY when the industry axis is degenerate (every holding shares
     one industry). A real sector split is never overridden.
   • Every holding must classify. One unrecognised name and the whole thing is
     abandoned and the card renders exactly as it did before — a book that is
     one-third "Other" is worse than no chart.
   • It must yield at least two classes, or there is nothing to show.
   So a future ETF this map has never seen degrades to the old card rather than
   quietly filing itself under Equity. ═══════════════════════════════════════ */
const ASSET_CLASS_RULES = [
  { cls: 'Gold',   re: /\bgold\b|goldbees/i },
  { cls: 'Silver', re: /\bsilver\b|silverbees/i },
  { cls: 'Debt',   re: /\bbond\b|\bgilt\b|\bg-?sec\b|\bsdl\b|\bdebt\b|\bliquid\b|\btreasury\b|\bbharat\s*bond\b|ebbetf/i },
  // V40.1 — B4. US equity is its own class: the Nasdaq-100 ETF is a different
  // market from the Indian ETFs, and a different tax class (slab, not 20%).
  { cls: 'US equity', re: /\bnasdaq\b|mon100|\bs&p\b|\bus\s*equity\b/i },
  // Equity last: it is the broadest test, so anything the classes above claim wins.
  { cls: 'Indian equity', re: /\bnifty\b|\bsensex\b|\bmidcap\b|\bsmallcap\b|\bmicrocap\b|\blargecap\b|\bequity\b|\bindex\b|\bnext\s*50\b|\bbees\b/i }
];
function assetClassOf(stock){
  const hay = ((stock.company_name || '') + ' ' + (stock.ticker || '')).trim();
  if (!hay) return null;
  for (const r of ASSET_CLASS_RULES) if (r.re.test(hay)) return r.cls;
  return null;
}
function deriveAssetClasses(stocks){
  const industries = new Set(stocks.map(s => ((s.industry || '').trim() || 'Unknown')));
  if (industries.size > 1) return null;          // a real sector split — leave it alone
  const classes = stocks.map(assetClassOf);
  if (classes.some(c => !c)) return null;        // one unknown holding ⇒ abandon
  if (new Set(classes).size < 2) return null;    // nothing to split
  return classes;
}
/* Fixed hues so Gold reads gold and Debt reads calm, whatever order they arrive in.
   V31.1: stepped onto the same OKLCH L 0.60 plane as SECTOR_COLORS above, holding
   each hue, because two of the four missed the 3:1 floor on a surface they are
   painted on — Equity #2563eb 2.95:1 on the dark map tile, Gold #d97706 2.99:1 on
   the light one. Equity, Gold and Debt now reuse the sector palette's blue, amber
   and cyan steps outright so the two modes are one system; Silver stays a neutral
   by design (it is the one class whose identity IS "no hue") and only its
   lightness moves. Worst across all nineteen measured backdrops: 3.24:1. */
const ASSET_CLASS_COLORS = { 'Indian equity':'#4073fd', 'US equity':'#9050fd', Gold:'#c16407', Silver:'#768191', Debt:'#098bc0' };

/* ══════════════════════════════════════════════════════════════════════════
   V30.3 — ONE GROUPING AXIS FOR THE WHOLE PAGE.
   --------------------------------------------------------------------------
   This page groups a book two different ways and, until now, did not agree with
   itself about which. deriveAssetClasses() splits a single-industry book (the
   MultiAsset ETF book: every holding's industry is the literal string "ETF") by
   ASSET CLASS, and the allocation card, the donut, the portfolio map and the
   V30.1 KPI ribbon all draw that split. Three surfaces did not:

     * renderSectorChips() built its chips from `industry`, so a MultiAsset member
       was offered exactly one chip reading "ETF 8" — while applySectorFilter()
       matched on `_aclass` ("Equity"/"Debt"/"Gold"/"Silver"). Clicking the only
       chip on offer compared "equity" against "etf" and hid EVERY row. The whole
       holdings table — the reason the page exists — went blank, the chip stayed
       lit claiming 8 holdings, and nothing on screen said why. Measured: 8 rows
       in, 0 visible out. The allocation card's rows filtered correctly, because
       they pass the asset-class name; the two entry points to one filter
       disagreed about the key.
     * the "Industries" KPI counted distinct `industry` values and printed 1,
       directly above its own ribbon drawn in FOUR segments and beside an
       allocation card listing FOUR rows.
     * refreshSession() grouped by `industry`, so a part-placed MultiAsset book
       reported "100% ETF at its heaviest, across 1 of 1 industries — close to
       the finished model's 100.0% ceiling": arithmetically true, and empty.

   groupKeyOf() is the one key. `_aclass` is stamped by renderAllocation(), which
   runs before every consumer below, and is deleted on a sector book — so equity
   books resolve to `industry` exactly as before and are untouched by this.
   ══════════════════════════════════════════════════════════════════════════ */
function groupKeyOf(s){
  if (!s) return '';
  return String(s._aclass || s.industry || 'Unknown').trim() || 'Unknown';
}
// True when the book is being grouped by asset class rather than by industry —
// i.e. when the word "Industries" would be the wrong label for what is counted.
function isAssetClassBook(list){
  return (list || []).some(s => s && s._aclass);
}
// The colour a group wears, from the same two sources every other surface uses:
// the four fixed asset-class hues first, then the shared sector palette.
function groupColorOf(name, colorMap){
  // V31.1: the last-resort fallback was #cbd5e1, which measures 1.30:1 on the
  // white card — a dot nobody could see if it ever rendered. Fall back to the
  // measured neutral instead (3.33:1 worst across both themes).
  return ASSET_CLASS_COLORS[name] || (colorMap || {})[name] || '#768191';
}

function renderAllocation(stocks) {
  if (!stocks || !stocks.length) return;
  const aclasses = deriveAssetClasses(stocks);
  if (aclasses) stocks.forEach((s, i) => { s._aclass = aclasses[i]; });
  else stocks.forEach(s => { delete s._aclass; });
  const groupOf = s => (aclasses ? s._aclass : ((s.industry || 'Unknown').trim() || 'Unknown'));
  const map = {};
  stocks.forEach(s => {
    const k = groupOf(s);
    const w = Number(s.weight_pct) || 0;
    map[k] = (map[k] || 0) + w;
  });
  const total = Object.values(map).reduce((a,b) => a+b, 0) || 1;
  const counts = {};
  stocks.forEach(s => {
    const k = groupOf(s);
    counts[k] = (counts[k] || 0) + 1;
  });
  const allRows = Object.entries(map)
    .map(([name, w]) => ({ name, w, pct: (w/total)*100, n: counts[name] || 0 }))
    .sort((a,b) => b.pct - a.pct);
  if (!allRows.length) return;

  /* ── V28.0 — THE CARD IS ABOUT CONCENTRATION AND COULD NOT SHOW IT ───────────
     Every bar was drawn as a fraction of 100% of the portfolio, but no single
     sector here can approach 100%: the model caps a sector at 3 holdings. So on
     an equal-weighted 25-stock book the entire card lived in the leftmost eighth
     of its own track — measured at 1440, a 3-stock sector (12.0%) was a 32px
     fill in a 270px track and a 2-stock sector (8.0%) was 22px. Ten pixels stood
     for a 50% difference in exposure, and at 375 the 8% rows rendered as dots.

     Two changes, no new data:
     1. FULL TRACK = THE CAP, not 100% of the book. For a capped equal-weight
        strategy the ceiling is 3 x the per-stock weight, so 12/8/4% now read as
        a clean 3:2:1 — and two hairlines at 1/3 and 2/3 turn every track into
        the same 3-slot ruler, which makes the "capped at 3 per" claim printed
        400px above this card something the reader can actually audit.
        The axis is INFERRED (3 x modal weight), so it is used only when the
        book really is equal-weighted: the modal weight must cover >=80% of
        holdings and the strategy must not be MultiAsset (composite-score
        weighted, no sector cap). Otherwise the scale falls back to the largest
        sector — a real, present quantity — and the ruler is dropped, because a
        3-slot ruler would assert a cap that strategy does not have.
     2. STOP DROPPING SECTORS SILENTLY. It showed the top 8 and said "Showing 8
        of 11" without ever naming the other three, while the donut carried a
        ~20% grey "Other" wedge with no legend row at all. Now up to 12 rows,
        and any genuine remainder gets its own labelled grey row that matches
        the wedge. With today's 11 sectors nothing is hidden.
     The % label on each row is unchanged and still reads share-of-portfolio, so
     no figure on this card moved; only the geometry became legible. */
  const perStockCounts = {};
  stocks.forEach(s => {
    const w = Math.round((Number(s.weight_pct) || 0) * 100) / 100;
    if (w > 0) perStockCounts[w] = (perStockCounts[w] || 0) + 1;
  });
  let modalW = 0, modalN = 0;
  Object.entries(perStockCounts).forEach(([w, n]) => { if (n > modalN) { modalN = n; modalW = Number(w); } });
  const equalWeighted = modalW > 0 && modalN >= stocks.length * 0.8 && !/multiasset/i.test(currentStrategy);
  // The per-industry cap from the factor model (shared/config.py MAX_PER_SECTOR).
  // It sets BOTH the bar's full-scale and the number of divisions drawn on it,
  // so the two can never disagree again.
  const SECTOR_CAP = 2;
  const capW = equalWeighted ? (modalW / total) * 100 * SECTOR_CAP : 0;
  const allocTicks = (function(){
    if (SECTOR_CAP < 2) return 'none';
    var g = [];
    for (var i = 1; i < SECTOR_CAP; i++) {
      var at = (100 * i / SECTOR_CAP).toFixed(4) + '%';
      g.push('linear-gradient(90deg,transparent calc(' + at + ' - 0.5px),' +
             'var(--alloc-rule) calc(' + at + ' - 0.5px),' +
             'var(--alloc-rule) calc(' + at + ' + 0.5px),' +
             'transparent calc(' + at + ' + 0.5px))');
    }
    return g.join(',');
  })();
  const topPct = allRows[0].pct;
  // never let the scale be smaller than the largest bar — a clamped bar would lie
  const scale = (capW > 0 && capW >= topPct - 0.01) ? capW : topPct;
  const scaleIsCap = scale === capW && capW > 0;

  const MAXROWS = 12;
  let rows = allRows.slice(0, MAXROWS);
  const restRows = allRows.slice(MAXROWS);
  const restPct = restRows.reduce((a,r) => a+r.pct, 0);
  const restN = restRows.reduce((a,r) => a+r.n, 0);

  // Assign colors from the shared map so the legend/donut match the table swatches.
  // V29.1 — in asset mode the names are the four fixed classes, so they get their
  // own fixed hues (gold reads gold) instead of a position in the sector palette.
  const secColorMap = buildSectorColorMap(stocks);
  rows.forEach(r => {
    r.color = (aclasses && ASSET_CLASS_COLORS[r.name]) || secColorMap[r.name] || SECTOR_COLORS[0];
  });

  const card = document.getElementById('alloc-card');
  const grid = document.getElementById('alloc-grid');

  // Legend rows — V5.2 #21: each row is clickable + filters the table.
  let rowsHTML = rows.map(r => {
    const fillPct = Math.min(100, (r.pct / scale) * 100);
    const overCap = scaleIsCap && r.pct > scale + 0.01;
    return `
    <div class="alloc-row" role="button" tabindex="0" data-sector="${escapeHtml(r.name)}"
         title="Click to filter the table to ${escapeHtml(r.name)} · ${r.n} holding${r.n===1?'':'s'} · ${r.pct.toFixed(1)}% of ${aclasses ? 'the book' : 'portfolio'}"
         onclick="filterBySector(this.dataset.sector)"
         onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();filterBySector(this.dataset.sector);}">
      <div class="alloc-name" title="${escapeHtml(r.name)}"><!-- V6.8 L2: full sector name on hover; long GICS names like "Information Technology" get truncated by the 140px ellipsis -->
        <span class="alloc-swatch" style="background:${r.color}"></span>
        <span class="alloc-nm-t">${escapeHtml(r.name)}</span>
        <span class="alloc-n">${r.n}</span>
      </div>
      <div class="alloc-bar-wrap${scaleIsCap ? ' alloc-ruled' : ''}${overCap ? ' alloc-over' : ''}" style="--alloc-ticks:${allocTicks}"><div class="alloc-bar" data-bar="${fillPct.toFixed(1)}%" style="background:linear-gradient(90deg,${r.color},${r.color}cc);"></div></div>
      <div class="alloc-pct">${r.pct.toFixed(1)}%</div>
    </div>
  `;}).join('');
  if (restRows.length && restPct > 0.01) {
    // the donut already aggregates these into a grey "Other" wedge — give that
    // wedge the legend row it never had, instead of a caption that won't name it
    rowsHTML += `
    <div class="alloc-row alloc-row-other" title="${restRows.length} smaller sector${restRows.length===1?'':'s'}: ${escapeHtml(restRows.map(r=>r.name).join(', '))}">
      <div class="alloc-name">
        <span class="alloc-swatch" style="background:#cbd5e1"></span>
        <span class="alloc-nm-t">Other · ${restRows.length} sectors</span>
        <span class="alloc-n">${restN}</span>
      </div>
      <div class="alloc-bar-wrap${scaleIsCap ? ' alloc-ruled' : ''}" style="--alloc-ticks:${allocTicks}"><div class="alloc-bar" data-bar="${Math.min(100,(restPct/scale)*100).toFixed(1)}%" style="background:linear-gradient(90deg,#cbd5e1,#cbd5e1cc);"></div></div>
      <div class="alloc-pct">${restPct.toFixed(1)}%</div>
    </div>`;
  }
  grid.innerHTML = rowsHTML;

  // V29.1 — every word this card says about itself follows the axis it actually
  // drew. In asset mode "sector" would be wrong in the heading, the caption, the
  // donut label and the row tooltips alike, so all four are switched together.
  const axisNoun = aclasses ? 'asset class' : 'sector';
  const allocH2 = document.querySelector('#alloc-card .alloc-head h2');
  if (allocH2) allocH2.textContent = aclasses ? 'Asset allocation' : 'Sector allocation';
  const dcLbl = document.querySelector('#alloc-card .dc-lbl');
  if (dcLbl) dcLbl.textContent = aclasses ? 'Asset classes' : 'Sectors';
  document.getElementById('alloc-meta').textContent =
    allRows.length + ' ' + axisNoun + (allRows.length === 1 ? '' : (aclasses ? 'es' : 's')) + ' · ' + stocks.length + ' holdings\u00A0· ' +
    (scaleIsCap ? 'full bar = the 2-per-industry cap (' + scale.toFixed(1) + '%)'
                : 'full bar = largest ' + axisNoun + ' (' + scale.toFixed(1) + '%)');

  // V6.8 L1: aggregate the remaining sectors into an "Other" slice so the
  // donut ring sums to 100% instead of leaving a grey gap that reads as
  // unallocated cash. (V28.0: that wedge now has a matching legend row, so the
  // ring and the list can no longer disagree about what "Other" is.)
  let donutRows = rows;
  if (allRows.length > rows.length) {
    const otherPct = allRows.slice(rows.length).reduce((a, r) => a + r.pct, 0);
    if (otherPct > 0.01) {
      donutRows = rows.concat([{ name: 'Other', w: 0, pct: otherPct, color: '#cbd5e1' }]);
    }
  }
  // Donut SVG — concentric arc slices around r=42 ring
  renderDonut(donutRows);
  // V9.6: roll the centre count up on first render (same easing as the stat
  // tiles); later re-renders (refresh, demo bump) just set the value.
  const dcNum = document.getElementById('donut-center-num');
  if (!dcNum.dataset.counted) {
    dcNum.dataset.counted = '1';
    _animateCount(dcNum, allRows.length);
  } else {
    dcNum.textContent = allRows.length;
  }

  card.style.display = '';
}

function renderDonut(rows) {
  const svg = document.getElementById('alloc-donut-svg');
  const R = 42, CX = 50, CY = 50, STROKE = 12;
  const C = 2 * Math.PI * R;

  let html = `<circle class="ring-bg" cx="${CX}" cy="${CY}" r="${R}" stroke-width="${STROKE}"/>`;
  let cum = 0;
  rows.forEach(r => {
    const frac = r.pct / 100;
    const len = C * frac;
    const offset = -C * cum;
    // V31.2 — the slice carries its group name as an ATTRIBUTE now. The V22.2
    // hover lens read it back out of the <title> by splitting on " · ", which
    // works but ties the wiring to a display string; data-sector is the same key
    // the legend rows and the chips already use, so all three entry points into
    // the filter now agree by construction. "Other" is an aggregate of several
    // sectors, so it deliberately gets no key and stays unpressable — exactly
    // like its .alloc-row-other legend row.
    const pickable = r.name !== 'Other';
    html += `<circle class="ring-slice${pickable ? ' ring-pick' : ''}" cx="${CX}" cy="${CY}" r="${R}" stroke-width="${STROKE}" stroke="${r.color}" stroke-dasharray="${len.toFixed(2)} ${C.toFixed(2)}" stroke-dashoffset="${offset.toFixed(2)}"${pickable ? ` data-sector="${escapeHtml(r.name)}"` : ''}><title>${escapeHtml(r.name)} · ${r.pct.toFixed(1)}%</title></circle>`;
    cum += frac;
  });
  // V20.8: "living data" — a soft point of light orbits the ring (the dashboard's
  // counterpart to the homepage hero-chart comet). Declarative SMIL, re-created on
  // every render, pointer-transparent, and suppressed under reduced-motion (CSS).
  html += `<defs><filter id="donut-comet-glow" x="-300%" y="-300%" width="700%" height="700%"><feGaussianBlur stdDeviation="1.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>`;
  html += `<g class="donut-comet" pointer-events="none"><circle cx="${CX}" cy="${CY - R}" r="3" fill="#2dd4bf" opacity="0.85" filter="url(#donut-comet-glow)"/><circle cx="${CX}" cy="${CY - R}" r="1.4" fill="#f0fffb"/><animateTransform attributeName="transform" attributeType="XML" type="rotate" from="0 ${CX} ${CY}" to="360 ${CX} ${CY}" dur="7s" repeatCount="indefinite" calcMode="linear"/></g>`;
  svg.innerHTML = html;
}

function escapeHtml(s){
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// Indian-format integer with thousands separators (Lakh/Crore grouping)
function fmtINR(v){
  v = Math.round(Number(v) || 0);
  if (!v) return '0';
  const s = String(v);
  if (s.length <= 3) return s;
  const last3 = s.slice(-3);
  const rest = s.slice(0, -3);
  return rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',') + ',' + last3;
}
function parseINR(s){
  return Number(String(s||'').replace(/[^\d]/g,'')) || 0;
}

// ── CURRENCY ───────────────────────────────────────────────────────────────
// V24.5: every book is NSE-listed and priced in rupees, so the old dual-currency
// path (a currency sniffed from ticker suffixes, dollar formatting, NYSE
// market hours, US broker deeplinks) was removed along with the one US strategy
// that consumed it. These are now plain ₹ formatters.
function fmtNum(v) {
  return fmtINR(Math.round(Number(v) || 0));
}
function fmtMoney(v) { return '₹' + fmtNum(v); }
/* V37.3 — A PRICE IS A RUPEE FIGURE AND WAS THE ONLY ONE PRINTED UNGROUPED.
   Four call sites wrote `'₹' + n.toFixed(2)`, so the picks table put
   ₹11890.00 in the Rec. Price column immediately beside ₹95,120 in
   Allocation — two rupee figures on one row, one grouped and one not — and the
   phone card repeated it as "Rec ₹1543.20". Every other price surface on this
   site (the Scanner, the 28 A-Z pages, /scores/ and the company page) already
   groups with toLocaleString('en-IN'); the dashboard was the exception.
   The two decimals STAY. Those surfaces use maximumFractionDigits:2, which
   renders 1543.20 as "1,543.2" — right for a screen you read, wrong for the
   number a member types into a broker, where a truncated paisa reads as a
   different price. So the grouping changes and the precision does not. */
function fmtPrice(v){
  var n = Number(v) || 0;
  try { return '₹' + n.toLocaleString('en-IN', { minimumFractionDigits:2, maximumFractionDigits:2 }); }
  catch(e){ return '₹' + n.toFixed(2); }
}
/* ══ V37.1 — A DATE THIS PAGE WRITES MUST NOT BREAK IN HALF ═══════════════════
   V37.0 fixed this for assets/mfc-live.js, which writes every LIVE date on the
   public site, and recorded that dashboard.html had eleven more call sites of
   the same shape that no public sweep could reach — they are all behind the
   member gate. Swept here through ?demo= and two of them do break at 320px:
   "vs the set you last opened on 10 Aug 2026" splits the date, and the capital
   ladder's "±97 bps" splits the number from its unit.

   The binding is DELIBERATELY NARROW. Replacing every space would make
   "10 Sep, 3:56 pm" one unbreakable token, which turns a wrap into a horizontal
   overflow on a 320px phone — trading this defect for a worse one. Only the
   adjacencies that must never split are bound: digit-to-letter and
   letter-to-digit. That covers day-month, month-year and "3:56 pm", and leaves
   the comma a legal break.

   NOT applied to the two `new Date(new Date().toLocaleString('en-US', …))`
   call sites: those parse the string back into a Date for timezone arithmetic,
   and a non-breaking space there would not parse. */
function mfDate(d, opts) {
  try { return _mfBindDate(d.toLocaleDateString('en-IN', opts)); } catch (e) { return ''; }
}
function mfDateTime(d, opts) {
  try { return _mfBindDate(d.toLocaleString('en-IN', opts)); } catch (e) { return ''; }
}
function _mfBindDate(str) {
  return String(str)
    .replace(/(\d)\s+([A-Za-z])/g, '$1\u00a0$2')
    .replace(/([A-Za-z])\s+(\d)/g, '$1\u00a0$2');
}
function shortMoney(v) { return shortLakhs(v); }

/* V35.5 — shortLakhs rounds to ONE decimal and then strips a trailing .0, which
   is right for a preset button (₹10L is exactly ten lakh) and wrong for a figure
   the member is about to commit: ₹3,96,651 came out as "₹4L", reading as more
   than it is at the one moment precision matters. Two decimals, trailing zeros
   trimmed, so ₹3,96,651 is ₹3.97L and ₹10,00,000 is still ₹10L. */
function preciseMoney(v){
  v = Number(v) || 0;
  var trim = function(n){ return n.toFixed(2).replace(/\.?0+$/, ''); };
  if (v >= 10000000) return '₹' + trim(v / 10000000) + 'Cr';
  if (v >= 100000)   return '₹' + trim(v / 100000)  + 'L';
  return fmtMoney(Math.round(v));
}

// ── POSITION SIZING ──────────────────────────────────────────────────────
/* V30.2 — THE CAPITAL THE PAGE USED WAS NOT THE CAPITAL THE FIELD SHOWED.
   setCapital() normalised its argument with `v|0`. A bitwise operator coerces
   through a SIGNED 32-BIT integer, so every rupee figure on this dashboard was
   silently computed modulo 2^32 once the entered capital passed ₹2,14,74,83,648:
     • ₹5,00,00,00,000 entered  → the field kept reading 5,00,00,00,000 while the
       whole page sized for ₹70,50,32,704 (5e9 − 4294967296). Allocation, Shares,
       Total allocated, Cash residue, % deployed, coverage, drift, the capital
       ladder, the CSV export and the ₹ figure on the live-profit card all
       inherited the wrong number, and every one of them still tied out against
       every other one — so nothing on screen could contradict it.
     • ₹2,50,00,00,000 entered  → wrapped to a negative, clamped to 0, and the
       sizing card went to ₹0 / "below one share" against a field full of digits.
   Both were measured, not reasoned about. The fix is Math.floor (no 32-bit
   round trip) plus an explicit ceiling that is WRITTEN BACK INTO THE FIELD, so
   the displayed number and the arithmetic can never disagree again: past the
   cap the digits stop growing rather than lying. The same `|0` sat in
   saveCapital(), which would have persisted the wrapped value to localStorage
   and reloaded into it. ₹10,000 crore is far above any retail advisory book and
   keeps share counts and fmtINR well inside exact-integer range. */
const MAX_CAPITAL = 100000000000;   // ₹10,000 crore
function normaliseCapital(v) {
  var n = Math.floor(Number(v));
  if (!isFinite(n) || n < 0) n = 0;
  return Math.min(n, MAX_CAPITAL);
}
/* V40.1 — A5. THE SAMPLE MUST NEVER WRITE A REAL MEMBER'S SETTINGS. This key had
   no demo namespace, so clicking a capital preset in ?demo=1 overwrote the
   LargeMidcap amount a real member keeps on that device — and a real visit then
   treated it as their own confirmed amount (_capEntered = saved > 0), with a
   fresh timestamp that also beat the server's copy under V39.3's newer-wins rule.
   The sample's first-visit path is exactly this reader's path to subscribing.
   Every per-device preference the sample can touch now goes through _devKey(). */
function _devKey(k) { return isDemo ? k + '::demo' : k; }
/* V43.1 — A1. A SALE NEEDS THE DEMAT'S OWN APPROVAL, AND NOTHING SAID SO.
   Without a DDPI given to the broker once, every selling day stops at the
   depository's TPIN and an OTP — mid-basket, for a member who was told "about
   ten minutes". Said once, beside the first sales a member meets (the sell group,
   the re-weight trims, the Kite band), until they tick it off here or in
   "Set up once" (B1), which reads the same per-device key. */
function _sellAuthDone() { try { return localStorage.getItem(_devKey('mfc_sellauth_ok')) === '1'; } catch (e) { return false; } }
function _sellAuthNote(withBtn) {
  if (_sellAuthDone()) return '';
  return '<div class="chg-auth" data-sellauth><b>Selling needs your demat&rsquo;s OK</b> &mdash; a DDPI given to your broker once, or your depository&rsquo;s TPIN and an OTP on the day you sell. ' +
    '<a href="/how-it-works/#sec-selling" target="_blank" rel="noopener">How it works&nbsp;&rarr;</a>' +
    (withBtn ? ' <button type="button" class="chg-hint-btn" onclick="_sellAuthOk()">Got it</button>' : '') + '</div>';
}
function _sellAuthInline(hasSells) {
  if (!hasSells || _sellAuthDone()) return '';
  return ' <span data-sellauth><b>Selling needs your demat&rsquo;s OK</b> &mdash; a DDPI given to your broker once, or a TPIN and an OTP on the day. ' +
    '<a href="/how-it-works/#sec-selling" target="_blank" rel="noopener">How it works&nbsp;&rarr;</a></span>';
}
function _sellAuthOk() {
  try { localStorage.setItem(_devKey('mfc_sellauth_ok'), '1'); } catch (e) {}
  document.querySelectorAll('[data-sellauth]').forEach(function (el) { el.remove(); });
  try { if (typeof window.mfcSetupRefresh === 'function') window.mfcSetupRefresh(); } catch (e) {}
}
function capitalStorageKey(strategy) {
  return 'mfc_capital_' + (isDemo ? 'demo_' : '') + (strategy || 'default').replace(/[^a-z0-9]+/gi,'_');
}
function loadSavedCapital(strategy) {
  try {
    const v = Number(localStorage.getItem(capitalStorageKey(strategy)) || 0);
    return v > 0 ? v : 0;
  } catch (e) { return 0; }
}
function saveCapital(strategy, v) {
  try { localStorage.setItem(capitalStorageKey(strategy), String(normaliseCapital(v))); } catch (e) {}
  // V39.3 — B4: a timestamp, so a newer amount on another device can win.
  try { localStorage.setItem(capitalStorageKey(strategy) + '_at', new Date().toISOString()); } catch (e) {}
  var first = !window._capEntered;
  window._capEntered = true;
  _capPush(strategy, v);
  if (first) _capRefreshLabels();
}

/* ── V39.3 — B4 · YOUR AMOUNT, ON EVERY DEVICE — NEVER SOMEONE ELSE'S ────────
   Capital lived in this device's localStorage only, and an unset field fell back
   to the RECOMMENDED size (₹15,00,000 on SmallMicro 500). So a member who typed
   ₹3,00,000 on a laptop opened the phone at night to "On your ₹15,00,000 that is
   +₹22,150" and a fifteen-order, ₹14.9L Kite basket sized to it.
   Now: (1) the amount rides the progress endpoint under its own `capital::` key
   (the backend exempts that key from its two-cycle pruning; an older deployment
   may prune it, and then this device's copy simply stands); (2) until the member
   has typed or confirmed an amount (`_capEntered`), every surface says the size
   is the recommended one, and no Kite basket can be sent — sendKiteBasket()
   routes to the field instead. The recommended default is still used for the
   figures: it is a sensible starting point, just never presented as theirs. */
window._capEntered = false;
function _capServerKey(strategy) {
  return ('capital::' + String(strategy || 'default').replace(/\u00A0/g, ' ').trim()).slice(0, 120);
}
var _capTimer = null;
window._capServer = false;   // set by capitalSyncLoad() from get_progress's `features`
function _capPush(strategy, v) {
  // Only against a backend that advertises the capital feature: an older one
  // prunes progress to two keys and would evict a cycle to store the amount.
  if (isDemo || !token || !(Number(v) > 0) || !window._capServer) return;
  if (_capTimer) clearTimeout(_capTimer);
  _capTimer = setTimeout(function () {
    _capTimer = null;
    try {
      fetch(APPS_SCRIPT_URL, {
        method: 'POST', headers: { 'Content-Type': 'text/plain' }, keepalive: true,
        body: JSON.stringify({ action: 'set_progress', token: token, cycle_key: _capServerKey(strategy),
                               map: { cap: { t: new Date().toISOString(), v: normaliseCapital(v) } }, removed: [] })
      }).catch(function () {});
    } catch (e) {}
  }, 1500);
}
/* Resolves to the server's amount when it is newer than this device's, else
   null. Also corrects the first-visit greeting for a member who has progress on
   the server. Never rejects; offline or on an older backend it resolves null. */
function capitalSyncLoad(strategy) {
  if (isDemo || !token) return Promise.resolve(null);
  return _getProgress()
    .then(function (d) {
      if (!d || d.status !== 'ok' || !d.progress) return null;
      window._capServer = Array.isArray(d.features) && d.features.indexOf('capital') >= 0;
      window._digestServer = Array.isArray(d.features) && d.features.indexOf('digest') >= 0;   // V42.6 · M12
      try { _digestRestore(); } catch (e) {}
      if (Object.keys(d.progress).length) {
        var g = document.getElementById('hero-greet');
        if (g) g.textContent = 'Welcome back';
      }
      var c = (d.progress[_capServerKey(strategy)] || {}).cap;
      var v = c ? normaliseCapital(c.v) : 0;
      var localAt = '';
      try { localAt = String(localStorage.getItem(capitalStorageKey(strategy) + '_at') || ''); } catch (e) {}
      var serverNewer = v > 0 && !(localAt && c.t && String(c.t) <= localAt);
      // This device holds an amount the server has not got (or an older one):
      // send it up, now that the backend is known to keep it.
      if (!serverNewer && window._capServer && window._capEntered && localAt) _capPush(strategy, currentCapital);
      return serverNewer ? v : null;
    })
    .catch(function () { return null; });
}
function _capRefreshLabels() {
  try { if (window._livePx) renderProfitHeadline(); } catch (e) {}
  try { refreshKiteBasket(); } catch (e) {}
}
function confirmCapital() {
  if (currentStrategy) saveCapital(currentStrategy, currentCapital);
  showToast('Your orders are sized for ' + fmtMoney(currentCapital) + ' — change it any time under Your amount');
}
/* The line the basket band and the headline share while no amount is set. */
function _kbCapNote() {
  if (isDemo || window._capEntered) return '';
  var amt = escapeHtml(fmtMoney(currentCapital));
  // The basket's own button(s) already say "enter your amount" and route to the
  // field, so the note offers only the other answer: keep the recommended size.
  // V41.0 — C2: "the recommended amount" → "the starting amount". It is the field's
  // starting value, and the site no longer calls any capital figure "recommended".
  return '<span class="kb-capnote"><b>Sized for ' + amt + ' — the starting amount, not one you entered.</b> ' +
         '<button type="button" class="kb-capbtn" onclick="confirmCapital()">Use ' + amt + '</button></span> ';
}

/* ── V31.0 — BROKER-VERIFIED ACCOUNT, PER BOOK ─────────────────────────────
   Keyed by strategy, and the key is the whole safety mechanism: MultiAsset has
   no dedicated account (it is free and is not traded this way), so it is simply
   ABSENT from the map and the card stays hidden. An unknown or renamed strategy
   falls through to the same hidden state rather than to somebody else's account
   — the failure mode of a wrong link here is showing one book's real P&L as
   another book's, which is exactly the claim this whole feature exists to make
   honestly. Matching is on the same /multiasset/i-style shape the rest of this
   file uses so a display-name tweak upstream cannot silently unmatch it.
   The card carries NO percentage on purpose: every other figure on this page is
   the member's own book, and a second, unrelated number here would invite a
   reconciliation that does not exist. ── */
/* V39.3 — A1. `since`: the date each account became dedicated to its model.
   EMPTY until the owner supplies it, and empty renders nothing. The public pages
   read the same two dates from DEDICATED_SINCE in assets/mfc-live.js — set both
   together (and bump mfc-live.js's ?v on the pages that load it). */
var VERIFIED_ACCOUNTS = [
  { re: /largemidcap/i, name: 'MindForge LargeMidcap\u00A0250',
    url: 'https://console.zerodha.com/verified/ddd3611c', since: '' },
  { re: /smallmicro/i,  name: 'MindForge SmallMicro\u00A0500',
    url: 'https://console.zerodha.com/verified/9eafe0ef', since: '' }
];
function renderVerified(strategy) {
  var card = document.getElementById('vfy-card');
  if (!card) return;
  var hit = null, s = String(strategy || '');
  for (var i = 0; i < VERIFIED_ACCOUNTS.length; i++) {
    if (VERIFIED_ACCOUNTS[i].re.test(s)) { hit = VERIFIED_ACCOUNTS[i]; break; }
  }
  if (!hit) { card.style.display = 'none'; return; }   // MultiAsset & anything unknown
  var link = document.getElementById('vfy-link');
  var name = document.getElementById('vfy-name');
  if (name) name.textContent = hit.name;
  if (link) {
    link.setAttribute('href', hit.url);
    link.setAttribute('aria-label', hit.name + ' — verified live P&L on Zerodha (opens in a new tab)');
  }
  var since = document.getElementById('vfy-since');
  if (since) {
    since.textContent = hit.since ? 'Dedicated to this model since ' + hit.since +
      '. Trades before that date are in Zerodha\u2019s total.' : '';
    since.hidden = !hit.since;
  }
  card.style.display = 'flex';
}

function setupCapitalCalculator(stocks, strategy) {
  if (!stocks || !stocks.length) return;
  const card = document.getElementById('size-card');
  const presets = capitalPresetsFor(strategy);
  // Use saved capital if present; otherwise recommended preset
  const saved = loadSavedCapital(strategy);
  // V30.2: normalise on the way IN as well — a stored value written by an older
  // release (or hand-edited) must not re-enter the page unbounded.
  currentCapital = normaliseCapital(saved > 0 ? saved : presets.recommended);
  window._capEntered = isDemo || saved > 0;   // V39.3 — B4

  const prefixEl = document.getElementById('size-prefix');
  if (prefixEl) prefixEl.textContent = '₹';
  const input = document.getElementById('size-input');
  input.placeholder = '1,00,000';

  // V28.7: the capital ladder draws these same presets, so it reads the list the
  // buttons are built from rather than keeping its own copy of the ranges.
  window._capLadderOptions = presets.options.slice();

  // Render preset buttons
  const presetEl = document.getElementById('size-presets');
  presetEl.innerHTML = presets.options.map(v => {
    const cls = v === currentCapital ? 'size-preset active' : 'size-preset';
    return `<button class="${cls}" data-val="${v}" onclick="setCapital(${v}, this)">${shortMoney(v)}</button>`;
  }).join('');

  input.value = fmtNum(currentCapital);
  input.addEventListener('input', e => {
    const v = parseINR(e.target.value);
    e.target.value = v ? fmtNum(v) : '';
    setCapital(v, null, true);
  });

  refreshSizeSummary();
  card.style.display = '';

  // V39.3 — B4: an amount this member set on another device wins over this
  // device's default — never over an amount typed here more recently.
  capitalSyncLoad(strategy).then(function (v) {
    if (!(v > 0) || strategy !== currentStrategy) return;
    if (v !== currentCapital) {
      setCapital(v, null, false);
      showToast('Using the amount you set on another device: ' + fmtMoney(v));
    } else if (!window._capEntered) {
      window._capEntered = true;
      _capRefreshLabels();
    }
  });
}

function shortLakhs(v) {
  if (v >= 10000000) return '₹' + (v/10000000).toFixed(v % 10000000 ? 1 : 0).replace(/\.0$/,'') + 'Cr';
  if (v >= 100000) return '₹' + (v/100000).toFixed(v % 100000 ? 1 : 0).replace(/\.0$/,'') + 'L';
  if (v >= 1000) return '₹' + Math.round(v/1000) + 'K';
  return '₹' + v;
}

function setCapital(v, btn, fromInput) {
  const asked = Math.floor(Number(v));                 // what the member actually typed
  currentCapital = normaliseCapital(v);                // V30.2: see MAX_CAPITAL above
  // Sync preset active state
  document.querySelectorAll('.size-preset').forEach(b => b.classList.toggle('active', Number(b.dataset.val) === currentCapital));
  // Sync input value if not coming from input — and ALWAYS when the entry had to
  // be clamped, so the field can never show a number the page is not using.
  if (!fromInput || !(asked === currentCapital)) {
    document.getElementById('size-input').value = currentCapital ? fmtNum(currentCapital) : '';
  }
  refreshSizeSummary();
  // Re-render the allocation/shares columns without rebuilding bars
  updateAllocationCells();
  // V14.3: the absolute ₹ profit depends on capital — recompute the headline.
  if (window._livePx) renderProfitHeadline();
  // Persist
  if (currentStrategy) saveCapital(currentStrategy, currentCapital);
  try { if (window.adjRefresh) window.adjRefresh(); } catch (e) {}   // V37.5 — targets move with the capital
}

function refreshSizeSummary() {
  const n = memberBook(stocksData).length || 1;   // V39.5 — restricted names are not in the member's book
  let totalAlloc = 0;
  // V28.1: each Allocation cell prints fmtINR(amt), i.e. Math.round of its own
  // amount, while this summed the raw floats and rounded once at the end — so
  // "Total allocated" disagreed with the column above it by a few rupees
  // (₹14,69,552 in the column vs ₹14,69,549 in the card at the default capital)
  // and "total + residue" did not equal the capital entered. Summing the SAME
  // rounded values the table prints makes the two agree by construction.
  stocksData.forEach(s => {
    const price = Number(s.recommended_price) || 0;
    const shares = price > 0 ? Math.floor(allocBudget(s, stocksData, currentCapital) / price) : 0;
    totalAlloc += Math.round(shares * price);
  });
  const residue = currentCapital - totalAlloc;
  // For a weighted book (MultiAsset) there is no single "per stock" figure — say so;
  // otherwise show the equal-split amount as before.
  // V28.1: below the price of a single share, whole-share sizing places nothing —
  // every row reads 0 shares and ₹0 — yet this still advertised an equal-split
  // per-stock amount beside a ₹0 total and a residue equal to the whole capital
  // ("Per stock: ₹4\u00A0· Total allocated: ₹0\u00A0· Cash residue: ₹100"). Three figures
  // that cannot all be true. Say what is actually the case instead.
  const cannotPlace = currentCapital > 0 && totalAlloc === 0;
  document.getElementById('size-per-stock').textContent   = cannotPlace
    ? 'below one share'
    : (isWeightedBook(stocksData) ? 'by model weight' : fmtMoney(currentCapital / n));
  document.getElementById('size-total-alloc').textContent = fmtMoney(totalAlloc);
  document.getElementById('size-residue').textContent     = fmtMoney(residue);
  // V22.0: capital-deployment micro-meter — % of the entered capital the whole-share
  // sizing puts to work. First paint animates via the shared [data-bar] applier
  // (refreshSizeSummary runs before it during render); capital tweaks afterwards
  // write the width directly and the CSS transition tweens it. Fails silently.
  try {
    const dep = document.getElementById('size-deploy'), depFill = document.getElementById('size-deploy-fill'),
          depLbl = document.getElementById('size-deploy-lbl');
    if (dep && depFill && depLbl) {
      if (currentCapital > 0 && totalAlloc > 0) {
        const depPct = Math.min(100, Math.max(0, totalAlloc / currentCapital * 100));
        const depStr = depPct >= 99.95 ? '100' : depPct.toFixed(1);
        depFill.setAttribute('data-bar', depStr + '%');
        if (depFill.style.width) depFill.style.width = depStr + '%';   // post-applier updates
        depLbl.textContent = depStr + '% invested';
        dep.title = depStr + '% of your capital goes into orders — ' + fmtMoney(Math.max(0, residue)) + ' stays in cash (whole shares only)';
        dep.style.display = '';
      } else { dep.style.display = 'none'; }
    }
  } catch(e){}

  refreshCoverage();
  refreshDrift();
  refreshCapitalLadder();   // V28.7 — the same story across the whole capital range
  // V28.8 — step 1 and step 3 both restate this card's arithmetic, and this is
  // the one path that runs on EVERY capital change (refreshBoughtProgress
  // returns early while nothing is ticked, so it cannot be the only caller).
  refreshHowto();
  refreshKiteBasket();  // V34.2 — capital sets the quantities the basket carries
  refreshSession();   // V28.6 — capital changes the amounts AND which picks are buyable
  // V35.3 — this cycle's recorded quantities follow the capital box, so that when
  // the book next rolls over the sells it hands the member are sized the way they
  // actually bought. Writes qty only; see _recordCurQty.
  _recordCurQty();
  renderCycleCost();  // V35.3 — the cost of the turnover is a function of capital
  refreshChgBuySizes();  // V36.5 — and so are the buy rows in the change card
  refreshRwRows();       // V41.9 — A1: and the re-weight orders, wherever they show
}

// V28.4 — "what your capital actually buys".
// Whole-share sizing silently drops any pick whose price exceeds its slice of the
// capital. refreshSizeSummary above reports the aggregate effect (NN% deployed);
// this reports the thing a member can act on: how many of the picks they end up
// holding, which ones fall out, and the capital at which all of them come back.
// allocBudget() is exactly linear in capital, so a pick's own break-even capital is
// price ÷ (its share of the book) — no search needed. Fails silently: a throw here
// must never take the sizing card down with it.
function refreshCoverage() {
  try {
    const box = document.getElementById('cvg');
    if (!box) return;
    const list = memberBook(stocksData || []);   // V39.5 — a restricted name is out on purpose, not short of capital
    const nRs = (stocksData || []).length - list.length;
    const priced = list.filter(s => (Number(s.recommended_price) || 0) > 0);
    if (!priced.length || !(currentCapital > 0)) { box.style.display = 'none'; return; }

    let buyable = 0, minCap = 0;
    const missing = [];
    priced.forEach(s => {
      const price  = Number(s.recommended_price) || 0;
      const budget = allocBudget(s, list, currentCapital);
      const share  = budget / currentCapital;             // this pick's fraction
      if (share > 0) minCap = Math.max(minCap, price / share);
      if (Math.floor(budget / price) >= 1) buyable++; else missing.push(s);
    });

    const n     = priced.length;
    const short = missing.length > 0;
    const need  = Math.ceil(minCap - 1e-6);

    box.classList.toggle('is-short', short);
    document.getElementById('cvg-fill').style.width = (buyable / n * 100).toFixed(1) + '%';
    document.getElementById('cvg-lead').innerHTML =
      '<b>' + buyable + '</b> of <b>' + n + '</b> pick' + (n === 1 ? '' : 's') +
      ' buyable at <b>' + fmtMoney(currentCapital) + '</b>';
    document.getElementById('cvg-chip').textContent =
      short ? (missing.length + ' need' + (missing.length === 1 ? 's' : '') + ' more') : 'Full book';

    let note;
    if (!short) {
      note = (nRs > 0 ? 'Every pick in your book' : 'Every pick in this cycle') + ' is buyable at this capital. What stays in cash is '
           + 'whole-share rounding only &mdash; no order can be part of a share.';
    } else {
      // When nothing is buyable, naming four of the twenty-five is noise — the only
      // useful figure is the capital that makes the book placeable.
      const shown = buyable === 0 ? '' : missing.slice(0, 4).map(s =>
        '<span class="cvg-name">' + escapeHtml(s.company_name || s.ticker || '') + '</span>').join('');
      const more  = (buyable !== 0 && missing.length > 4)
        ? ' <span class="cvg-name">+' + (missing.length - 4) + ' more</span>' : '';
      note = (buyable === 0
              ? 'One share costs more than this capital gives any pick, so no order can be placed yet. '
              : (missing.length === 1
                 ? 'One share of this pick costs more than its slice of your capital, so it is left out and its weight stays in cash: '
                 : 'One share of each of these picks costs more than its slice of your capital, so they are left out and their weight stays in cash: '))
           + '<span class="cvg-names">' + shown + more + '</span> '
           + 'All <b>' + n + '</b> become buyable from <b>' + fmtMoney(need) + '</b>.';
    }
    if (nRs > 0) note += ' <b>' + nRs + '</b> ' + (nRs === 1 ? 'name is' : 'names are') +
      ' on your restricted list and left out on purpose &mdash; their weight is spread across the rest.';
    // V40.1 — A5: the sample says when the REAL book would not fit this capital
    if (isDemo) {
      const k = _strategyPerfKey(currentStrategy || '');
      const fEl = k && document.getElementById('mfmin-' + k);
      const floor = fEl ? Number(String(fEl.textContent).replace(/[^0-9.]/g, '')) : 0;
      if (floor > 0 && currentCapital < floor)
        note += ' <span class="cvg-real">This month&rsquo;s real ' + escapeHtml(String(currentStrategy || '').replace(/^MindForge\s*/, '')) +
                ' book works from <b>' + fmtMoney(floor) + '</b>, so at ' + fmtMoney(currentCapital) +
                ' it could not be bought in full. The placeholder prices in this sample are lower.</span>';
    }
    document.getElementById('cvg-note').innerHTML = note;
    box.style.display = '';
  } catch (e) { /* sizing card must survive a coverage failure */ }
}

// V28.5 — "how closely your book tracks the model".
// The WEIGHT column prints the MODEL weight on every row, which reads as a promise
// the arithmetic cannot keep: whole shares round, so the book a member actually
// places is never exactly the model. This measures the gap, per pick, in basis
// points, and draws it as a distribution against the model line.
//
// Two decisions that keep this from double-counting refreshCoverage above:
//   * picks this capital cannot buy at all are EXCLUDED — a 0-share pick is a
//     coverage finding, and leaving it in would swamp the strip with one -400bp
//     tick and make every other pick look drifted purely by renormalisation.
//   * the model weights are therefore RENORMALISED over the picks that are bought,
//     so the comparison is like-for-like: what this book holds vs what the model
//     would hold across the same names.
// Fails silently for the same reason refreshCoverage does.
function refreshDrift() {
  try {
    const box = document.getElementById('drift');
    if (!box) return;
    const hide = () => { box.style.display = 'none'; };
    const list = stocksData || [];
    if (!(currentCapital > 0)) return hide();

    let total = 0, modelSum = 0;
    const held = [];
    list.forEach(s => {
      const price = Number(s.recommended_price) || 0;
      const model = Number(s.weight_pct) || 0;
      if (!(price > 0) || !(model > 0)) return;
      const shares = Math.floor(allocBudget(s, list, currentCapital) / price);
      if (shares < 1) return;
      const amt = shares * price;
      total += amt; modelSum += model;
      held.push({ s: s, amt: amt, model: model });
    });
    if (held.length < 2 || !(total > 0) || !(modelSum > 0)) return hide();

    held.forEach(h => {
      h.actual = h.amt / total * 100;
      h.target = h.model / modelSum * 100;
      h.bps    = Math.round((h.actual - h.target) * 100);
    });
    // sorted, so the strip reads as the spread it is rather than as table order
    held.sort((a, b) => a.bps - b.bps);

    let maxAbs = 0, sumAbs = 0;
    held.forEach(h => { maxAbs = Math.max(maxAbs, Math.abs(h.bps)); sumAbs += Math.abs(h.bps); });
    const avg  = Math.round(sumAbs / held.length);
    const lo   = held[0], hi = held[held.length - 1];
    const wide = Math.abs(lo.bps) >= Math.abs(hi.bps) ? lo : hi;
    const nm   = s => escapeHtml(s.company_name || s.ticker || '');
    const sgn  = b => (b > 0 ? '+' : '') + b;    // a signed gap always states its sign

    // 50, not 100: a tick draws out from the centre line and owns only its own half.
    // The 6% floor keeps the twenty-odd near-zero picks visible as ticks rather than
    // as nothing — at ₹50L the spread is 17bps wide with a 2bps average, so a purely
    // proportional strip is one bar and twenty-four invisible ones. Exact values
    // stay on every tick's title and on the two end labels.
    document.getElementById('drift-strip').innerHTML = held.map(h => {
      const cls = h.bps === 0 ? 'is-zero' : (h.bps > 0 ? 'is-over' : 'is-under');
      const peak = (h === wide && maxAbs > 0) ? ' is-peak' : '';
      const pct = maxAbs > 0
        ? Math.max(6, Math.abs(h.bps) / maxAbs * 50).toFixed(1)
        : '6';
      return '<span class="drift-t ' + cls + peak + '" data-h="' + pct + '"' +
             ' title="' + nm(h.s) + ' — ' + h.actual.toFixed(2) + '% held vs ' +
             h.target.toFixed(2) + '% model (' + (h.bps > 0 ? '+' : '') + h.bps + '\u00A0bps)">' +
             '<i></i></span>';
    }).join('');

    document.getElementById('drift-scale').innerHTML = maxAbs > 0
      ? '<span>' + sgn(lo.bps) + '\u00A0bps\u00A0&middot; ' + nm(lo.s) + '</span>' +
        '<span>' + sgn(hi.bps) + '\u00A0bps\u00A0&middot; ' + nm(hi.s) + '</span>'
      : '';

    /* V30.3 — this said "your N BOUGHT picks", and `held` has nothing to do with
       what the member has bought: it is every pick whose slice of the entered
       capital covers at least one whole share. With the bought map completely
       empty the card still read "Your 25 bought picks track model weight to
       within 25 bps", and on a part-placed book it sat directly beside the
       session panel — which reads the actual bought map — saying "Placed so far:
       ₹1,74,382 of ₹14,69,552" for 3 of 25. Two panels, one screen, flatly
       contradicting each other about how much the member owns.
       What this measures is the book the capital PLACES, so that is what it now
       says; the session panel keeps sole ownership of the word "placed". */
    document.getElementById('drift-lead').innerHTML = maxAbs > 0
      ? 'The <b>' + held.length + '</b> pick' + (held.length === 1 ? '' : 's') +
        ' your capital sizes track model weight to within <b>' + maxAbs + '\u00A0bps</b>'
      : 'Every pick your capital sizes lands exactly on its model weight';
    document.getElementById('drift-chip').textContent =
      maxAbs > 0 ? ('±' + maxAbs + '\u00A0bps') : 'Exact';

    document.getElementById('drift-note').innerHTML = maxAbs > 0
      ? 'Whole shares cannot be split, so every order lands a little above or below '
        + 'its model weight &mdash; the table’s <b>Weight</b> percentage is the model’s, not yours, and the gauge beside it is the gap between the two. '
        + 'Widest: <b>' + nm(wide.s) + '</b> at <b>' + wide.actual.toFixed(2) + '%</b> against a '
        + wide.target.toFixed(2) + '% model weight. Average gap across the book: <b>' + avg
        // V28.7: this read "More capital narrows every one of them", which the
        // capital ladder directly below now disproves on the same screen — whole
        // shares round in steps, so on the demo book ₹25L tracks to ±15 bps and
        // ₹50L to ±17. The ladder is the honest version of this sentence.
        + '\u00A0bps</b>. Capital is the lever that moves these &mdash; the ladder below shows '
        + 'what each size would do. 1 bp = 0.01%.'
      : 'At this capital every order divides exactly into its model weight, so the book '
        + 'you place is the model to the rupee.';

    box.style.display = '';
    // grow from the centre line — the same contract every bar on this site uses.
    // Written after paint so the transition has somewhere to travel from; on later
    // capital changes the height is already set and the transition just re-tweens.
    const ticks = box.querySelectorAll('.drift-t');
    const draw = () => ticks.forEach(t => {
      const bar = t.querySelector('i');
      if (bar) bar.style.height = t.getAttribute('data-h') + '%';
    });
    if (window.requestAnimationFrame) requestAnimationFrame(() => requestAnimationFrame(draw));
    else setTimeout(draw, 40);
    setTimeout(draw, 700);   // backstop: a document whose frames never run
  } catch (e) { /* sizing card must survive a drift failure */ }
}

/* ══════════════════════════════════════════════════════════════════════════
   V28.7 — THE CAPITAL LADDER
   --------------------------------------------------------------------------
   _bookAt(capital) is the single arithmetic the coverage card, the drift card
   and this ladder all read from, so a ladder row at today's capital reports the
   same buyable count and the same max-bps figure those cards print. It is a
   deliberate extraction rather than a re-implementation: two functions that
   compute "how many picks does ₹X buy" independently is precisely how the
   V28.1 rupee totals ended up disagreeing.
   ══════════════════════════════════════════════════════════════════════════ */
function _bookAt(capital) {
  const list = memberBook(stocksData || []);   // V39.5
  if (!(capital > 0) || !list.length) return null;
  let buyable = 0, priced = 0, alloc = 0, total = 0, modelSum = 0;
  const held = [];
  list.forEach(s => {
    const price = Number(s.recommended_price) || 0;
    const model = Number(s.weight_pct) || 0;
    if (!(price > 0)) return;
    priced++;
    const shares = Math.floor(allocBudget(s, list, capital) / price);
    if (shares < 1) return;
    buyable++;
    alloc += Math.round(shares * price);           // same rounding the table prints
    if (!(model > 0)) return;
    const amt = shares * price;
    total += amt; modelSum += model;
    held.push({ amt: amt, model: model });
  });
  if (!priced) return null;
  let maxBps = 0, sumAbs = 0;
  if (held.length >= 2 && total > 0 && modelSum > 0) {
    held.forEach(h => {
      const bps = Math.round((h.amt / total * 100 - h.model / modelSum * 100) * 100);
      const a = Math.abs(bps);
      if (a > maxBps) maxBps = a;
      sumAbs += a;
    });
  }
  return {
    capital: capital, buyable: buyable, n: priced,
    deployed: capital > 0 ? Math.min(100, alloc / capital * 100) : 0,
    maxBps: maxBps,
    avgBps: held.length ? Math.round(sumAbs / held.length) : 0,
    full: buyable === priced,
    /* V30.3 — drift is a spread BETWEEN holdings, so it does not exist below two
       of them. maxBps stays 0 in that case, which the ladder was printing as
       "±0 bps" beside the shortest bar on the card under a legend reading
       "Shorter bar = closer to the model" — i.e. a capital that cannot buy a
       single share was drawn as the best-tracking size on offer. Say measurable,
       and let the caller render "not yet" instead of a zero it has not earned. */
    measurable: held.length >= 2 && total > 0 && modelSum > 0
  };
}

// The capital at which every pick becomes buyable — the same figure the coverage
// card names, derived the same way (allocBudget is exactly linear in capital, so
// a pick's break-even is price ÷ its share of the book).
function _fullBookCapital() {
  const list = stocksData || [];
  if (!(currentCapital > 0)) return 0;
  let minCap = 0;
  list.forEach(s => {
    const price = Number(s.recommended_price) || 0;
    if (!(price > 0)) return;
    const share = allocBudget(s, list, currentCapital) / currentCapital;
    if (share > 0) minCap = Math.max(minCap, price / share);
  });
  return Math.ceil(minCap - 1e-6);
}

function refreshCapitalLadder() {
  try {
    const box = document.getElementById('clad');
    if (!box) return;
    const hide = () => { box.style.display = 'none'; };
    const list = stocksData || [];
    if (!list.length || !(currentCapital > 0)) return hide();

    // The strategy's own presets, plus the member's number wherever it falls.
    // Sorted and de-duplicated, so entering a preset value does not draw it twice.
    const opts = (window._capLadderOptions && window._capLadderOptions.length)
      ? window._capLadderOptions.slice()
      : [currentCapital];
    const steps = opts.concat([currentCapital])
      .map(v => Math.round(Number(v) || 0))
      .filter(v => v > 0)
      .filter((v, i, a) => a.indexOf(v) === i)
      .sort((a, b) => a - b);
    if (steps.length < 2) return hide();

    const rows = steps.map(_bookAt).filter(Boolean);
    if (rows.length < 2) return hide();

    // The bars are max-drift, so the axis is the worst row. A book that is already
    // exact at every step has nothing to draw and the ladder stands down rather
    // than rendering five empty tracks.
    const worst = rows.reduce((m, r) => Math.max(m, r.maxBps), 0);
    if (!(worst > 0)) return hide();

    const mine = rows.find(r => r.capital === currentCapital);
    // The CLOSEST-tracking row, which is not reliably the largest one: whole-share
    // rounding is lumpy, so a bigger capital can land a pick one share further from
    // its weight than a smaller one did. On the demo book ₹25L tracks to ±15 bps and
    // ₹50L to ±17. Naming "the largest" as the best would have been a claim this
    // very ladder contradicts two rows above the sentence.
    //
    // Partial rows are excluded from the search, and the reason is the same one
    // refreshDrift gives for excluding unbuyable picks: drift is renormalised over
    // the names a capital actually holds, so a ₹1,00,000 book measured across 23
    // names can post a NARROWER gap than a ₹5,00,000 book measured across 25 and
    // look like the better size while holding two fewer companies. Ranking those
    // two against each other is the comparison this card must not invite.
    const fullRows = rows.filter(r => r.full && r.measurable);
    // V30.3: a row with no measurable drift can never be "the closest fit" — its
    // 0 is an absence, not a reading. Without this guard the fallback branch
    // (no full rows at all) ranks a capital that buys nothing as the best size.
    const rankable = fullRows.length ? fullRows : rows.filter(r => r.measurable);
    const best = rankable.length ? rankable.reduce((b, r) => (r.maxBps < b.maxBps ? r : b), rankable[0]) : null;
    const biggest = rankable.length ? rankable[rankable.length - 1] : null;
    const anyPartial = rows.some(r => !r.full);

    document.getElementById('clad-rows').innerHTML = rows.map(r => {
      const you  = r.capital === currentCapital;
      const cls  = 'clad-row' + (you ? ' is-you' : '') + (r.full ? '' : ' is-partial');
      const pct  = Math.max(2, r.maxBps / worst * 100);
      // Kept short enough to hold ONE line beside the "You" badge in the name
      // column at 375: "YOU 23 of 25 picks" fits where "…buyable" wrapped and
      // made the member's own row a line taller than the rows it is compared to.
      const cov  = r.full
        ? ('all ' + r.n + ' picks')
        : (r.buyable + ' of ' + r.n + ' picks');
      // V30.3: no measurable drift ⇒ no bar and no number. A row that buys fewer
      // than two whole shares has no spread between holdings to report, and
      // printing its 0 next to the shortest bar on the card said the opposite.
      const bpsTxt = r.measurable ? ('±' + r.maxBps + '\u00A0bps') : '—';
      const aria   = r.measurable
        ? (', widest weight gap ' + r.maxBps + ' basis points')
        : ', too few whole shares to measure a weight gap';
      return '<div class="' + cls + '">' +
               // The "You" marker rides the sub-line, not the amount: at 104px on a
               // phone a badge after "₹15,00,000" wrapped to its own line and made
               // the member's row a line taller than every row it is compared with.
               '<span class="clad-cap"><b>' + fmtMoney(r.capital) + '</b>' +
                 '<span' + (r.full ? '' : ' class="is-short"') + '>' +
                 (you ? '<i class="clad-you">You</i>' : '') + cov + '</span></span>' +
               '<span class="clad-track" role="img" aria-label="At ' + fmtMoney(r.capital) +
                 ': ' + cov + aria + '">' +
                 '<i class="clad-fill" data-w="' + (r.measurable ? pct.toFixed(1) : '0') + '"></i></span>' +
               '<span class="clad-bps">' + bpsTxt + '</span>' +
             '</div>';
    }).join('');

    document.getElementById('clad-lead').innerHTML =
      'What a different capital would change &mdash; <b>' + rows.length + '</b> sizes, same book';
    document.getElementById('clad-chip').textContent = 'Bar = widest gap';

    const need = _fullBookCapital();
    const parts = [];
    // Only worth saying when it is not already true at the smallest step drawn.
    if (need > rows[0].capital) {
      parts.push('Every pick becomes buyable from <b>' + fmtMoney(need) + '</b>.');
    }
    if (mine && !mine.measurable) {
      // V30.3: the honest sentence for a capital that places fewer than two whole
      // shares. It used to read "Your ₹1,000 holds the book to ±0 bps of the
      // model" — a claim of perfect tracking for a book holding nothing.
      parts.push('Your <b>' + fmtMoney(mine.capital) + '</b> does not place two whole shares yet, so there is ' +
                 'no weight gap to measure' + (best ? ' &mdash; the sizes below can be compared.' : '.'));
    } else if (mine && best) {
      parts.push('Your <b>' + fmtMoney(mine.capital) + '</b> holds the book to <b>±' + mine.maxBps +
                 '\u00A0bps</b> of the model' +
                 (best.capital === mine.capital
                   ? ' &mdash; the closest fit of any size drawn here.'
                   : '; the closest fit here is <b>' + fmtMoney(best.capital) + '</b> at <b>±' +
                     best.maxBps + '</b>.'));
    }
    // Said plainly, because the rows can show it: tracking is not monotonic in
    // capital. A bigger number usually helps and is not guaranteed to.
    if (best && biggest && biggest.maxBps > best.maxBps) {
      parts.push('More is not automatically closer &mdash; whole shares round in steps, so <b>' +
                 fmtMoney(biggest.capital) + '</b> lands at <b>±' + biggest.maxBps +
                 '\u00A0bps</b>, wider than <b>' + fmtMoney(best.capital) + '</b>.');
    }
    if (anyPartial) {
      parts.push('An amber row cannot place the whole book, and its gap is measured only across ' +
                 'the picks it does hold &mdash; so it is not comparable with a full-book row ' +
                 'and is left out of the comparison above.');
    }
    parts.push('Nothing but whole-share rounding separates these rows &mdash; the model weights are ' +
               'identical at every capital. Shorter bar = closer to the model. 1 bp = 0.01%.');
    document.getElementById('clad-note').innerHTML = parts.join(' ');

    box.style.display = '';
    // Grow from zero, like every other bar on this site; re-tweens on each
    // capital change because the width is re-read from data-w every time.
    const fills = box.querySelectorAll('.clad-fill');
    const draw = () => fills.forEach(f => { f.style.width = f.getAttribute('data-w') + '%'; });
    if (window.requestAnimationFrame) requestAnimationFrame(() => requestAnimationFrame(draw));
    else setTimeout(draw, 40);
    setTimeout(draw, 700);   // backstop: a document whose frames never run
  } catch (e) { /* sizing card must survive a ladder failure */ }
}

/* ── V32.7 — THE WEIGHT BAR NOW CARRIES DATA ─────────────────────────────────
   On an equal-weight book — which LargeMidcap and SmallMicro both are — every
   model weight is 4.00%, so the column's `w / maxW * 100` was 100 on all 25 rows
   and it drew twenty-five identical full bars. A bar that is the same on every row
   is decoration, not data: it spent 80px of a dense table telling the reader
   nothing the 4.0% beside it had not already said.
   What DOES vary per row is what the member actually ends up holding. Whole shares
   cannot be split, so a ₹10,00,000 book lands each pick a little above or below its
   model weight — the "±44 bps" panel above this table already measures that spread.
   The bar now shows both: a pale track for the MODEL weight (which is what the
   number beside it states) and a solid segment for YOUR weight at the capital
   entered. MultiAsset, whose model weights genuinely differ, keeps the shape it had
   and gains the overlay on top.
   ONE IMPLEMENTATION, TWO CALLERS, and that is deliberate. renderTable() draws the
   rows and updateAllocationCells() patches them in place every time the capital
   changes — it does NOT re-render — so a bar computed only at render time would
   have frozen at the first capital and quietly shown the wrong book from the second
   chip onwards. Both call this.
   The arithmetic is lifted from the drift strip verbatim (allocBudget → floor →
   shares × price, normalised over the picks that clear one whole share) so the two
   surfaces cannot disagree about the same gap. Always measured over the CANONICAL
   stocksData, never a filtered or sorted view: hiding a row does not change what
   the member holds. */
let HELD_MAXBPS = 0;
function heldWeights(capital) {
  const list = stocksData || [];
  let total = 0, modelSum = 0, maxW = 0;
  list.forEach(s => {
    const p = Number(s.recommended_price) || 0, m = Number(s.weight_pct) || 0;
    if (m > maxW) maxW = m;
    if (!(p > 0) || !(m > 0)) return;
    const sh = Math.floor(allocBudget(s, list, capital) / p);
    if (sh < 1) return;
    total += sh * p; modelSum += m;
  });
  const ok = total > 0 && modelSum > 0;
  /* The gauge scales to the widest gap in the BOOK, so one pick's tick means the
     same thing on every row. Computed here, where the totals already exist, and
     parked on a module-level so gaugeBar() can read it without threading it
     through every call site. */
  HELD_MAXBPS = 0;
  if (ok) {
    list.forEach(s => {
      const p = Number(s.recommended_price) || 0, m = Number(s.weight_pct) || 0;
      if (!(p > 0) || !(m > 0)) return;
      const sh = Math.floor(allocBudget(s, list, capital) / p);
      if (sh < 1) return;
      const bps = Math.round((sh * p / total * 100 - m / modelSum * 100) * 100);
      HELD_MAXBPS = Math.max(HELD_MAXBPS, Math.abs(bps));
    });
  }
  return {
    maxW: maxW,
    ok: ok,
    /* null when the book cannot be sized at all (no capital, or nothing clears a
       whole share) — the caller then draws no overlay and the pale model track
       stands alone, exactly as this column looked before. */
    read: function (s, amt) {
      const w = Number(s.weight_pct) || 0;
      if (!ok || !(w > 0)) return null;
      if (_isRestricted(s.ticker)) return null;   // V39.5 — out on purpose, so no gap to draw
      const actual = amt / total * 100;
      const target = w / modelSum * 100;
      return { actual: actual, target: target, bps: Math.round((actual - target) * 100),
               pct: maxW > 0 ? Math.min(100, actual / maxW * 100) : 0 };
    }
  };
}

/* The chip, and its accessible name, DERIVED from the same reading. Writing the
   figures out by hand beside a machine-drawn number is the drift trap; the label
   is built from `hr` or it is not built at all. */
function heldClass(hr) {
  return hr.bps > 0 ? 'is-over' : hr.bps < 0 ? 'is-under' : 'is-exact';
}
function heldLabel(s, hr, w) {
  const nm = escapeHtml(s.company_name || s.ticker || '');
  if (!hr) return nm + ' \u2014 ' + (w ? w.toFixed(2) : '\u2014') + '% model weight';
  const sgn = (hr.bps > 0 ? '+' : '') + hr.bps;
  const gap = hr.bps === 0 ? 'exactly on the model weight'
                           : sgn + '\u00A0bps ' + (hr.bps > 0 ? 'over' : 'under') + ' the model';
  return nm + ' \u2014 you hold ' + hr.actual.toFixed(2) + '% against a ' +
         hr.target.toFixed(2) + '% model weight (' + gap + ')';
}
/* V33.2 — the gauge's reading, as text. Same `hr` the gauge is drawn from, so
   the two cannot disagree; returns nothing when there is no capital entered
   yet (hr is null), which is exactly when the gauge is absent too. */
function gapTag(hr) {
  if (!hr) return '';
  if (hr.bps === 0) return '<span class="sc-gap sc-gap-on">on model</span>';
  const sgn = hr.bps > 0 ? '+' : '\u2212';
  return '<span class="sc-gap ' + (hr.bps > 0 ? 'sc-gap-over' : 'sc-gap-under') + '">'
       + sgn + Math.abs(hr.bps) + '\u00A0bps</span>';
}
function gaugeBar(hr) {
  /* 50, not 100: the segment grows out from the centre line and owns only its own
     half. The 6% floor is what keeps the twenty-odd near-zero picks visible as
     ticks rather than as nothing — the same floor, for the same reason, as the
     drift strip. */
  if (!hr) return '';
  const cls = heldClass(hr);
  const pct = HELD_MAXBPS > 0
    ? Math.max(6, Math.abs(hr.bps) / HELD_MAXBPS * 50)
    : (hr.bps === 0 ? 2 : 6);
  return '<span class="weight-bar ' + cls + '" data-bar="' +
         (hr.bps === 0 ? 2 : pct).toFixed(1) + '%"></span>';
}

function updateAllocationCells() {
  const HW = heldWeights(currentCapital);   // V32.7 — one reading per update
  stocksData.forEach((s, i) => {
    const price = Number(s.recommended_price) || 0;
    const shares = price > 0 ? Math.floor(allocBudget(s, stocksData, currentCapital) / price) : 0;
    const amt = shares * price;
    const rs = _isRestricted(s.ticker);   // V39.5 — a dash, never "0 shares", for a name left out on purpose
    const allocCell = document.querySelector('tr[data-row="'+i+'"] .alloc-amt');
    const sharesCell = document.querySelector('tr[data-row="'+i+'"] .shares');
    if (allocCell) allocCell.textContent = rs ? '\u2014' : fmtMoney(amt);
    if (sharesCell) sharesCell.innerHTML = '<span class="qty">' + (rs ? '\u2014' : shares) + '</span>';
    // Mobile
    const mAlloc = document.querySelector('.stock-card[data-row="'+i+'"] .sc-alloc');
    const mShares = document.querySelector('.stock-card[data-row="'+i+'"] .sc-shares');
    if (mAlloc) mAlloc.textContent = rs ? '\u2014' : fmtMoney(amt);
    if (mShares) mShares.textContent = rs ? '\u2014' : shares;
    /* V32.7 — the held-weight overlay is a function of the capital, so it has to
       move with it. This function patches cells in place rather than re-rendering,
       so without this the bar would freeze at whatever capital first drew it and
       show the wrong book from the second chip onwards — a stale bar that still
       looks authoritative. Both the desktop row and the mobile card are updated. */
    const hr = HW.read(s, amt);
    const w  = Number(s.weight_pct) || 0;
    /* V32.7 — the gap is a function of the capital, so the gauge moves with it.
       This function patches cells in place rather than re-rendering, so without
       this the bar would freeze at whatever capital first drew it and keep looking
       authoritative while describing a different book. */
    document.querySelectorAll('tr[data-row="'+i+'"] .weight-bar-wrap, ' +
                              '.stock-card[data-row="'+i+'"] .weight-bar-wrap')
      .forEach(function (wrap) {
        const lbl = heldLabel(s, hr, w);
        wrap.setAttribute('title', lbl);
        wrap.setAttribute('aria-label', lbl);
        const axis = wrap.querySelector('.wt-axis');
        wrap.innerHTML = (axis ? '<i class="wt-axis" aria-hidden="true"></i>' : '') + gaugeBar(hr);
        wrap.querySelectorAll('[data-bar]').forEach(function (b) { b.style.width = b.dataset.bar; });
      });
  });
}

function filterStocks(q) {
  _searchQ = String(q || '').trim().toLowerCase();
  const rows = document.querySelectorAll('#stocks-tbody tr[data-row]');
  const cards = document.querySelectorAll('.stock-card[data-row]');
  rows.forEach(tr => {
    const i = Number(tr.dataset.row);
    const s = stocksData[i] || {};
    const hay = ((s.ticker||'') + ' ' + (s.company_name||'') + ' ' + (s.industry||'')).toLowerCase();
    tr.style.display = !_searchQ || hay.includes(_searchQ) ? '' : 'none';
  });
  cards.forEach(c => {
    const i = Number(c.dataset.row);
    const s = stocksData[i] || {};
    const hay = ((s.ticker||'') + ' ' + (s.company_name||'') + ' ' + (s.industry||'')).toLowerCase();
    c.style.display = !_searchQ || hay.includes(_searchQ) ? '' : 'none';
  });
  // V5.2 #20/#21: layer the active sector filter on top of search results
  if (_sectorFilter) applySectorFilter();
  syncTableEmptyState();   // V30.3 — one owner for "nothing matched" (see below)
  syncBoughtAllHeader();   // V28.1 — the visible set just changed
}

function renderTable(stocks) {
  const tbody = document.getElementById('stocks-tbody');
  const mobileCards = document.getElementById('stock-cards-mobile');

  if (!stocks.length) {
    const emptyIcon = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
    tbody.innerHTML = `<tr><td colspan="9"><div class="tbl-empty"><div class="icon">${emptyIcon}</div><h4>No picks yet for this run</h4><p>There are no published picks for your subscription run yet. New monthly sets are released on the first business day — we'll email you when one is available.</p></div></td></tr>`;
    mobileCards.innerHTML = `<div class="tbl-empty"><div class="icon">${emptyIcon}</div><h4>No picks yet for this run</h4><p>The model hasn't published stocks for your strategy this month.</p></div>`;
    return;
  }

  const maxW = Math.max(...stocks.map(s => Number(s.weight_pct) || 0), 1);
  /* V29.3 — say what the Weight bar is measured against, on the surface members
     actually use. Both bars here are `weight / largest weight`, so in an
     equal-weight book (SmallMicro and LargeMidcap: 25 names at 4.0%) EVERY bar
     renders full, and a 100%-length bar sitting beside the number "4.0%" reads
     as 100%. V29.1 found and captioned exactly this on the public strategy
     pages and stopped there; the member dashboard draws the same bars for the
     same reason and said nothing — on desktop and on the phone cards alike.
     Wording is deliberately the same as strategies.html so the two surfaces
     explain the identical thing identically. */
  // V32.7 — one reading of held-vs-model for the whole render pass
  const HW = heldWeights(currentCapital);
  const wVals = stocks.map(s => Number(s.weight_pct) || 0).filter(w => w > 0);
  const wSpread = wVals.length ? Math.max(...wVals) - Math.min(...wVals) : 0;
  const capEl = document.getElementById('weightCap');
  if (capEl) {
    /* V35.1 — this caption described a bar that no longer exists. V29.3 wrote it
       for a fill of `weight / largest weight`; the column was later rebuilt as
       the DRIFT GAUGE — `gaugeBar(hr)`, a segment growing either side of
       `.wt-axis` whose length is |bps| against HELD_MAXBPS and whose class is
       is-over / is-under. Everything else on the row had already been updated:
       the header reads "Weight / vs model", the aria-label reads "you hold
       10.03% against a 10.00% model weight (+3 bps over the model)", and the
       phone card prints a "+3 bps" chip. Only the one visible sentence that
       tells a member what the picture MEANS still said "Bar = model weight".
       On an equal-weight book that made it actively wrong rather than merely
       stale — it read "Every holding carries the same weight in this book"
       directly under six bars of six different lengths (4.8 / 8.2 / 4.8 / 11.8
       / 40 / 4.8 px on the demo book), so the sentence accused its own graphic
       of being broken. The equal-weight / score-weighted split is still true of
       the NUMBER, so it is kept and attributed to the number; the bar is now
       described as what it measures, in the same words the sizing card above
       uses so the two explain one thing identically. */
    const gauged = !!HW.ok;   // exactly when gaugeBar() draws anything
    capEl.innerHTML = !wVals.length ? ''
      : (wSpread < 0.05
          ? 'The <b>Weight</b> percentage is the model’s: every holding carries the same weight in this book — the model ranks the names, it does not bet more on any one of them. '
          : 'The <b>Weight</b> percentage is the model’s: this strategy is weighted by composite score, so the sizes differ. ')
        + (gauged
            ? 'The gauge beside it is your gap to that weight — whole shares cannot be split, so each order lands a little over or under. Right of the centre line is over, left is under.'
            : 'Enter your capital above and a gauge appears beside it showing how far each whole-share order lands from that weight.');
    capEl.style.display = wVals.length ? '' : 'none';
  }
  // V12.5: per-stock allocation is weight-proportional (see allocBudget()).
  const copyIco = '<svg class="copy-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>';
  const bought = loadBought(currentStrategy);
  const _ocT = cycleOrders();   // V41.9 — A1: the re-weight orders the rows below show
  // V11.3: colour each holding's industry pill with its sector colour — the same
  // map the donut & legend use, so the table reads as one visual system. Built from
  // the canonical `stocksData` (not the possibly-sorted `stocks` arg) so a column
  // sort never reshuffles the colours (see buildSectorColorMap).
  const secColors = buildSectorColorMap(stocksData);
  /* V37.3 — THE FOURTH SURFACE V30.3 MISSED.
     That release made groupKeyOf() the one grouping key for this page and
     converted the chips, the "Industries" KPI, the allocation card, the donut,
     the portfolio map and the part-placed session panel. The picks table and the
     phone cards were not converted, so a MultiAsset member read eight rows of the
     literal string "ETF" under a header that said "Industry" — directly below a
     chip row offering Equity 5 / Debt 1 / Gold 1 / Silver 1 and an allocation
     card drawn in those same four bands. The column was the only one on the row
     that told them nothing, and the split the strategy is NAMED for was the thing
     it was failing to tell them.
     groupKeyOf() returns `industry` verbatim on an equity book, so the sector
     books are byte-identical to before. groupColorOf() is the same resolver the
     donut and the map already use, which also retires the `#cbd5e1` fallback here
     — 1.30:1 on the white card, the exact dot V31.1 called "a dot nobody could
     see if it ever rendered". */
  const groupName = s => (groupKeyOf(s) || '').trim();
  const indDot = s => { const k = groupName(s); return k ? `<span class="ind-dot" style="background:${groupColorOf(k, secColors)}"></span>` : ''; };

  // V24.5: every book is NSE-listed, so price and allocation are always ₹.
  const fmtAmt = n => '₹' + fmtINR(n);

  // V35.2 — mark the names that are new this cycle, on the row itself. The
  // summary card above says how many; this says WHICH, at the point where a
  // member is reading off quantities to place. Silent when there is no previous
  // cycle on this device (window._bookDiff.known === false) — an unbadged row
  // must never be readable as "held", so with an unknown diff nothing is badged
  // at all. The badge is a <span>, not a title: there is no hover on a phone.
  const _bd = window._bookDiff;
  const newSet = {};
  if (_bd && _bd.known) _bd.added.forEach(t => { newSet[t] = 1; });
  const newTag = s => (newSet[s.ticker]
    ? '<span class="new-tag" title="New in this cycle — not in your previous set">New</span>' : '');

  // Desktop table
  tbody.innerHTML = stocks.map((s,i) => {
    const entry = Number(s.recommended_price) || 0;
    const w = Number(s.weight_pct) || 0;
    const barPct = (w / maxW) * 100;
    const shares = entry > 0 ? Math.floor(allocBudget(s, stocks, currentCapital) / entry) : 0;
    const amt = shares * entry;
    const rs = _isRestricted(s.ticker);      // V39.5 — B1: on the member's restricted list
    const held = !rs && isHeldRow(s.ticker);        // V35.4 — carried over from last cycle
    const movePP = held ? heldMovePP(s.ticker) : null;   // …and re-weighted, or not
    const isBought = !rs && !held && !!bought[s.ticker];
    const isNew = !rs && !held && !!(window._bookDiff && window._bookDiff.known) && _omAccent(s.ticker);   // V43.8
    // V41.9 — A1: a re-weighted row carries its order in slots (see _rwSlot)
    const rwT = movePP != null ? escapeHtml(String(s.ticker || '').toUpperCase()) : '';
    const rwDone = !!rwT && (_ocT.rw || []).some(o => o.ticker === String(s.ticker || '').toUpperCase()) && !!bought['RW:' + String(s.ticker || '').toUpperCase()];
    const rowCls = [isBought ? 'row-bought' : '', held ? 'row-held' : '',
                    movePP != null ? 'row-reweighted' : '',
                    isNew ? 'row-new' : '', rs ? 'row-restricted' : '', rwDone ? 'rw-done' : ''].filter(Boolean).join(' ');
    // data-row carries the CANONICAL stocksData index (not the sorted position) so
    // filterStocks/applySectorFilter/updateAllocationCells — which look up
    // stocksData[data-row] — stay correct after a column sort reorders the rows.
    const ci = stocksData.indexOf(s);
    const hr = HW.read(s, amt);
    return `<tr data-row="${ci}" data-ticker="${escapeHtml(s.ticker)}"${rwT ? ` data-rw="${rwT}"` : ''} class="${rowCls}" style="animation-delay:${Math.min(i*30, 600)}ms;">
      <td class="bought-col">${rs ? _csLockMark(s) : held ? (rwT ? `<span class="rw-slot" data-rwslot="tcb" data-rwt="${rwT}">${_rwSlot('tcb', s, _ocT, bought)}</span>` : heldMark(s, movePP))
        : `<input type="checkbox" class="bought-cb" aria-label="Mark ${escapeHtml(s.ticker)} as bought" onchange="toggleBought(this)" ${isBought?'checked':''}>`}</td>
      <td class="row-num"><span class="row-chip">${i+1}</span></td>
      <td class="company" title="${escapeHtml(s.company_name || s.ticker)}">${companyCell(s)}${rs ? _csTag() : newTag(s)}${srsTag(s)}${splitTag(s)}${rwT ? `<span class="rw-slot" data-rwslot="ttag" data-rwt="${rwT}">${_rwSlot('ttag', s, _ocT, bought)}</span>` : ''}</td>
      <td class="ticker"><span class="ticker-chip" role="button" tabindex="0" aria-label="Copy ticker ${escapeHtml(s.ticker)}" data-ticker="${escapeHtml(s.ticker)}" onclick="copyTicker(this)" onkeydown="tickerChipKey(event,this)" title="Copy ticker">${escapeHtml(s.ticker)}${copyIco}</span>${rs ? '' : brokerLink(s)}</td>
      <td><span class="industry-badge" title="${escapeHtml(groupName(s))}">${indDot(s)}${escapeHtml(groupName(s) || '—')}</span></td>
      <td class="price right"><span class="px-rec">${fmtPrice(entry)}</span><span class="px-live" data-px="${escapeHtml(s.yahoo_ticker||'')}" data-rec="${entry}"></span></td>
      <td class="alloc-amt right">${rs ? '\u2014' : fmtAmt(amt)}</td>
      <td class="shares right"><span class="qty">${rs ? '\u2014' : shares}</span></td>
      <td class="right">
        <div class="weight-cell">
          <div class="weight-bar-wrap" role="img" title="${heldLabel(s, hr, w)}" aria-label="${heldLabel(s, hr, w)}"><i class="wt-axis" aria-hidden="true"></i>${gaugeBar(hr)}</div>
          <div class="weight-val">${w ? w.toFixed(1)+'%' : '—'}</div>
        </div>
      </td>
    </tr>`;
  }).join('');

  // Mobile cards
  const HWM = HW;                     // V32.7 — same reading the desktop rows used
  mobileCards.innerHTML = stocks.map((s,i) => {
    const entry = Number(s.recommended_price) || 0;
    const w = Number(s.weight_pct) || 0;
    const barPct = (w / maxW) * 100;
    const shares = entry > 0 ? Math.floor(allocBudget(s, stocks, currentCapital) / entry) : 0;
    const amt = shares * entry;
    const rs = _isRestricted(s.ticker);   // V39.5 — B1
    const held = !rs && isHeldRow(s.ticker);     // V35.4 — carried over from last cycle
    const movePP = held ? heldMovePP(s.ticker) : null;
    const isBought = !rs && !held && !!bought[s.ticker];
    const isNew = !rs && !held && !!(window._bookDiff && window._bookDiff.known) && _omAccent(s.ticker);   // V43.8
    // V41.9 — A1: same slots as the desktop row
    const rwT = movePP != null ? escapeHtml(String(s.ticker || '').toUpperCase()) : '';
    const rwDone = !!rwT && (_ocT.rw || []).some(o => o.ticker === String(s.ticker || '').toUpperCase()) && !!bought['RW:' + String(s.ticker || '').toUpperCase()];
    const cardCls = 'stock-card' + (isBought ? ' row-bought' : '') + (held ? ' row-held' : '') +
                    (movePP != null ? ' row-reweighted' : '') + (isNew ? ' row-new' : '') + (rs ? ' row-restricted' : '') + (rwDone ? ' rw-done' : '');
    const ci = stocksData.indexOf(s);   // canonical index — keep filters/cell-updates correct after sort
    // V25.2: same stagger the desktop <tr> above gets, so the phone's holdings
    // cascade instead of popping. Capped lower (360ms) than the row's 600ms —
    // cards are ~5x taller, so anything past the first few lands off-screen.
    /* V37.5 — THE CARD, REBUILT FOR THE SCREEN IT IS READ ON.
       Reported on a 390px phone with the SmallMicro book: a card was 318px tall,
       so a member saw two and a bit per screen and scrolled fifteen of them to
       place one month of orders. Four of its seven rows were layout, not
       information — the ticker and broker link on a line of their own (44px of
       touch height), an industry pill on another, a "Weight / vs model" row
       that restated a column header, and the tick on a fourth.
       The same facts now sit in four rows, ~200px:
         1  rank · company (linked) over its industry · the copy-ticker chip
         2  THE ACTION ROW — quantity | weight vs model | allocation
         3  recommended and live price, with today's move
         4  the order tick and the broker link, the two controls used most
       Hooks kept exactly (see project memory "phone portfolio card"):
       .sc-shares and .sc-alloc hold ONLY their numbers (updateAllocationCells
       writes them by textContent); .px-live keeps data-px/data-rec for
       paintLivePrices(); .weight-bar-wrap stays inside .stock-card[data-row] so
       the capital-change repaint finds it; .bought-cb drives the counter.
       Touch geometry: the company link (44px pad on coarse pointers) and the
       ticker chip (44px min-height) sit in DIFFERENT GRID COLUMNS of row 1, so
       their pads cannot overlap — V28.7's collision was two pads on consecutive
       LINES. The tick and the broker link share row 4, separated horizontally.
       The industry line under the name is plain text, so the company link's pad
       may cover it without taking a tap from anything. */
    const hwR = HWM.read(s, amt);
    const wLbl = heldLabel(s, hwR, w);
    return `<div class="${cardCls}" data-row="${ci}" data-ticker="${escapeHtml(s.ticker)}"${rwT ? ` data-rw="${rwT}"` : ''} style="animation-delay:${Math.min(i*45, 360)}ms;">
      <div class="sc-header">
        <div class="sc-num">${i+1}</div>
        <div class="sc-name-wrap">
          <div class="sc-company">${companyCell(s)}</div>
          <div class="sc-sub"><span class="sc-ind">${indDot(s)}${escapeHtml(groupName(s) || '—')}</span>${rs ? _csTag() : newTag(s)}${srsTag(s)}${splitTag(s)}</div>
        </div>
        <span class="sc-ticker" role="button" tabindex="0" aria-label="Copy ticker ${escapeHtml(s.ticker)}" data-ticker="${escapeHtml(s.ticker)}" onclick="copyTicker(this)" onkeydown="tickerChipKey(event,this)">${escapeHtml(s.ticker)}${copyIco}</span>
      </div>
      <div class="sc-act">
        <div class="sc-act-qty"><span class="sc-shares">${rs ? '\u2014' : shares}</span><span class="sc-act-unit">${rs ? 'not sized' : held ? (movePP != null ? 'shares · target' : 'shares held') : 'shares to buy'}</span></div>
        <div class="sc-act-wt sc-row-wt">
          <span class="sc-val">${w ? w.toFixed(1)+'%' : '—'}${gapTag(hwR)}</span>
          <div class="sc-bar-wrap weight-bar-wrap" role="img" title="${wLbl}" aria-label="${wLbl}"><i class="wt-axis" aria-hidden="true"></i>${gaugeBar(hwR)}</div>
          <span class="sc-act-lbl">weight vs model</span>
        </div>
        <div class="sc-act-money"><span class="sc-act-amt sc-alloc">${rs ? '\u2014' : fmtAmt(amt)}</span><span class="sc-act-lbl">${_fmNow() ? 'amount' : 'allocation'}</span></div>
      </div>
      <div class="sc-cmp">
        <span class="sc-cmp-rec">Rec <b>${fmtPrice(entry)}</b></span>
        <span class="sc-cmp-sep" aria-hidden="true">·</span>
        <span class="sc-cmp-live">Live <span class="sc-val px-live" data-px="${escapeHtml(s.yahoo_ticker||'')}" data-rec="${entry}">—</span></span>
      </div>
      <div class="sc-foot">
        <div class="sc-bought-row">${rs
          ? `<span class="sc-held cs-rs-foot">${_csLockMark(s)}On your restricted list &mdash; not sized, not traded</span>`
          : held
          ? (rwT ? `<span class="rw-slot" data-rwslot="foot" data-rwt="${rwT}">${_rwSlot('foot', s, _ocT, bought, amt)}</span>`
                 : `<span class="sc-held">${heldMark(s, movePP)}Held &mdash; carried over</span>`)
          : `<label><input type="checkbox" class="bought-cb" aria-label="Order placed: ${escapeHtml(s.ticker)}" onchange="toggleBought(this)" ${isBought?'checked':''}>Order placed</label>`}</div>
        ${rs ? '' : brokerLink(s)}
      </div>
    </div>`;
  }).join('');

  document.getElementById('last-update-time').textContent = new Date().toLocaleTimeString('en-IN');
  refreshBoughtProgress();
  // V14.3: re-apply live prices/returns after any re-render (sort, filter, capital).
  if (window._livePx) paintLivePrices();
  revealHoldingsBackstop();
  try { if (window.adjRefresh) window.adjRefresh(); } catch (e) {}   // V37.5 — the planner reads this book
}

/* V25.2 — fail-visible backstop for the holdings stagger entrance.
   Both the desktop <tr> and (as of V25.2) the mobile .stock-card enter with
   `animation:mf-row-in ... both`, whose `backwards` half holds opacity:0
   through the per-row inline delay. That is the right look, but it means a
   document whose animation timeline never advances renders the ENTIRE
   holdings list — the dashboard's primary content — invisible. Not
   hypothetical: measured exactly that in a hidden document, where
   document.timeline.currentTime stayed at 0 and all 25 cards sat at opacity 0
   with playState "running". The desktop rows have carried the same exposure,
   unguarded, since the stagger shipped.
   So: once the cascade has had time to finish, strip the animation. The
   keyframe's to-state IS the element's natural state (opacity 1, no
   translate), so on the normal path this is a no-op — and on a frozen clock
   it is the difference between a blank list and a readable one. Same
   safety-net device as the factor board's setTimeout(reveal,1600) and
   mfc-live.js's snap timer: never let a decoration own visibility. (No ?v here:
   this page does not load that file — it is a cross-reference, not a request.) */
function revealHoldingsBackstop() {
  var DONE = 'mf-anim-done';                 // → animation:none (CSS)
  var LAST = 360 + 420 + 260;                // max delay + duration + slack
  clearTimeout(window._holdRevealT);
  window._holdRevealT = setTimeout(function () {
    // :not(.skel-row) matches the convention every other rule here uses — the
    // loading skeleton must keep its own shimmer if one is ever on the row.
    document.querySelectorAll('#stocks-tbody tr:not(.skel-row), .stock-card').forEach(function (el) {
      el.classList.add(DONE);
    });
  }, LAST);
}

// ── MARK-AS-BOUGHT (persisted per strategy) ──────────────────────────────
/* V35.3 — THE CHECKLIST IS PER CYCLE, NOT PER STRATEGY.
   The key used to be the strategy alone, so ticks written in one cycle were still
   set in the next and departed tickers accumulated in the map forever. It
   answered "have I ever bought this ticker" when the page needs "have I placed
   this cycle's trades", and it is the sole input to the basket filter, the
   progress card and the how-to's step state.
   On an equity book that partly masked itself — the carried-over names keep last
   month's ticks, so the count lands near the right answer for the wrong reason.
   On MultiAsset it failed outright: that book holds the same eight ETFs every
   month and rotates their weights, so a member who ticked last cycle opened the
   new one to "8 of 8 · All set", the celebratory glow, and no basket at all,
   directly under a card telling them to rebalance between those same eight.
   Keyed on the same _cycleKey() bookDiff uses, so the two can never disagree
   about which cycle is current. The strategy stays in the key because the
   switcher can move between books without a reload. */
function boughtStorageKey(strategy) {
  var base = 'mfc_bought_' + (strategy || 'default').replace(/[^a-z0-9]+/gi,'_');
  var key  = _cycleKey(window._currentSub);
  return key ? (base + '__' + String(key).replace(/[^a-z0-9]+/gi,'_')) : base;
}
/* Two ticks can exist for one ticker across a member's history — bought in March,
   sold in June — and within a cycle a name is either joining or leaving, never
   both. Prefixing the sells keeps the BUY key a bare ticker, which is what the
   table rows' data-ticker already writes, so nothing about the picks table changes. */
function orderKey(o){ return (o && o.rw) ? 'RW:' + o.ticker : (o && o.side === 'SELL' ? 'SELL:' : '') + (o ? o.ticker : ''); }
/* V41.9 — A1. A re-weight is one task per name, whichever way it goes, so it has
   one key: RW:<ticker>. It cannot collide with a buy (the bare ticker) or a sale
   (SELL:<ticker>), and the server merges it like any other key. Every surface
   that shows the same re-weight carries data-okey="RW:<ticker>"; this keeps them
   ticked together: the change card's row, the picks table's row and phone card,
   and the order sheet. */
function _rwSyncTicks(key, on){
  try {
    if (!key || key.indexOf('RW:') !== 0) return;
    var t = key.slice(3), sel = key.replace(/"/g, '\\"');
    document.querySelectorAll('input[data-okey="' + sel + '"]').forEach(function(x){ x.checked = on; });
    document.querySelectorAll('.chg-rot[data-t="' + t.replace(/"/g, '\\"') + '"]').forEach(function(el){ el.classList.toggle('is-done', on); });
    document.querySelectorAll('[data-rw="' + t.replace(/"/g, '\\"') + '"]').forEach(function(el){ el.classList.toggle('rw-done', on); });
  } catch (e) {}
}
/* V41.9 — A1. The way to exact orders when the dashboard cannot size the
   re-weights itself: open Adjust your book on its Match tab, at the paste box. */
function _rwOpenMatch(){
  try {
    var card = document.getElementById('adj-card'), tab = document.getElementById('adj-tab-sync');
    if (!card || card.hidden || !tab) return;
    if (tab.getAttribute('aria-selected') !== 'true') tab.click();
    var prev = document.documentElement.style.scrollBehavior;
    document.documentElement.style.scrollBehavior = 'auto';
    card.scrollIntoView({ block: 'start' });
    document.documentElement.style.scrollBehavior = prev;
    var box = document.getElementById('adj-sync-in');
    if (box) try { box.focus({ preventScroll: true }); } catch (e) { box.focus(); }
  } catch (e) {}
}
/* V41.9 — A1. The picks table's and phone cards' re-weight bits, as SLOTS. A
   re-weight's quantity is a function of the capital, and updateAllocationCells()
   rewrites the Shares cells in place on every capital change, so these live in
   their own spans (data-rwslot) that refreshRwRows() refills without rebuilding
   the table. Kinds: 'tcb' the table's tick column (a tick, or the held mark),
   'ttag' a tag after the company name, 'foot' the phone card's foot. */
function _rwSlot(kind, s, oc, map, amt){
  var movePP = heldMovePP(s.ticker);
  var o = (oc && oc.rwKnown && movePP != null) ? _rwOrderFor(s.ticker, oc) : null;
  var tk = escapeHtml(s.ticker || '');
  var act = !!(o && !o.hold && o.qty > 0), key = act ? orderKey(o) : '', done = act && !!(map && map[key]);
  var verb = act ? (o.side === 'SELL' ? 'sell' : 'buy') : '';
  var cb = function(){
    return '<input type="checkbox" class="rw-cb" data-okey="' + escapeHtml(key) + '"' + (done ? ' checked' : '') +
           ' aria-label="Mark the ' + tk + ' re-weight as placed: ' + verb + ' ' + o.qty + '" onchange="toggleOrder(this)">';
  };
  var holdTxt = (o && o.hold) ? 'Sell\u00a0' + o.hold.qty + ' on or after ' + mfDate(o.hold.until, { day:'numeric', month:'short' }) : '';
  var noneTxt = (o && !o.hold && !(o.qty > 0)) ? 'No order \u2014 still ' + o.to + '\u00a0share' + (o.to === 1 ? '' : 's') : '';
  if (kind === 'tcb') return act ? cb() : heldMark(s, movePP);
  if (kind === 'ttag'){
    return act ? '<span class="rw-tag">' + verb + '\u00a0' + o.qty + '</span>'
         : holdTxt ? '<span class="rw-tag is-hold">' + escapeHtml(holdTxt) + '</span>'
         : noneTxt ? '<span class="rw-tag is-none">no order</span>' : '';
  }
  if (kind === 'foot'){
    if (act) return '<label class="sc-rw">' + cb() + 'Order placed<span class="sc-rw-q">' + verb + '\u00a0' + o.qty + '</span></label>';
    return '<span class="sc-held">' + heldMark(s, movePP) +
      (holdTxt || noneTxt ? escapeHtml(holdTxt || noneTxt) : 'Re-weighted &mdash; adjust to ₹' + fmtINR(amt || 0)) + '</span>';
  }
  return '';
}
/* What the re-weight surfaces currently show, as one string: a capital change
   that moves no quantity changes nothing on screen. */
function _rwSig(oc){
  if (!oc || !oc.rwKnown) return oc && oc.rwUnknown ? 'unknown' : '';
  return (oc.rw || []).map(function(o){ return o.ticker + o.side + o.qty; }).join(',') + '|' +
         (oc.rwFlat || []).map(function(o){ return o.ticker + o.to; }).join(',') + '|' +
         (oc.holdBack || []).filter(function(h){ return h.rw; }).map(function(h){ return h.ticker + h.qty; }).join(',');
}
/* Called on every capital change (refreshSizeSummary). When the re-weight orders
   moved, refill the table's slots in place and redraw the change card (its rows,
   the tiles, the hero line and the cost card all read the same orders). Debounced:
   typing a capital moves the quantities on every keystroke. */
function refreshRwRows(){
  try {
    clearTimeout(window._rwTimer);
    window._rwTimer = setTimeout(function(){
      try {
        var oc = cycleOrders(), sig = _rwSig(oc);
        if (sig === (window._rwSigShown || '')) return;
        window._rwSigShown = sig;
        var map = loadBought(currentStrategy) || {}, byT = {};
        (stocksData || []).forEach(function(s){ byT[String(s.ticker || '').toUpperCase()] = s; });
        document.querySelectorAll('[data-rwslot]').forEach(function(el){
          var s = byT[el.getAttribute('data-rwt')]; if (!s) return;
          el.innerHTML = _rwSlot(el.getAttribute('data-rwslot'), s, oc, map, sharesFor(s) * (Number(s.recommended_price) || 0));
        });
        document.querySelectorAll('[data-rw]').forEach(function(el){
          el.classList.toggle('rw-done', !!map['RW:' + el.getAttribute('data-rw')] &&
            (oc.rw || []).some(function(o){ return o.ticker === el.getAttribute('data-rw'); }));
        });
        if (window._bookDiff && window._bookDiff.known) renderBookChange(window._bookDiff, stocksData);
        refreshBoughtProgress();
      } catch (e) {}
    }, 300);
  } catch (e) {}
}
/* The re-weight order for one ticker this cycle, or null: the trim or add, the
   zero-share move (no order), or a trim waiting for the holding period. */
function _rwOrderFor(ticker, oc){
  oc = oc || cycleOrders();
  var T = String(ticker || '').toUpperCase(), hit = null;
  (oc.rw || []).concat(oc.rwFlat || []).forEach(function(o){ if (o.ticker === T) hit = o; });
  if (!hit) (oc.holdBack || []).forEach(function(h){ if (h.rw && h.ticker === T) hit = { hold:h, ticker:T }; });
  return hit;
}

/* V35.4 — IS THIS ROW SOMETHING THE MEMBER ALREADY OWNS?
   V35.3 taught the ORDER surfaces about the diff and left the ones that reason
   about HOLDINGS still counting ticks. A carried-over name needs no order, so its
   tick box was never going to be ticked — and three surfaces read that empty box
   as "not yet placed". The picks table showed eight held rows as identical to-dos;
   select-all ticked them; and the mid-session concentration card, which exists to
   warn about a half-built book, told a member who held all ten that they were 50%
   Pharma with eight orders outstanding.
   One reading, used by all three. False whenever the diff is unknown, which is
   exactly a first cycle — there every row IS a fresh buy. */
function isHeldRow(ticker){
  var d = window._bookDiff;
  if (!d || !d.known) return false;
  if (d.held.indexOf(String(ticker)) === -1) return false;
  // V43.8 — only while the member says they hold last month's book. Buy all starts
  // from none of it; Pick stocks turns a carried name into an order when its full
  // buy is ticked.
  var om = orderModeState();
  if (om.m === 'fresh') return false;
  if (om.m === 'pick' && om.p[String(ticker).toUpperCase()]) return false;
  return true;
}

/* …and "held" is not one state but two. A carried-over holding whose model weight
   was RE-SCORED still has work: the name stays, the size changes. Marking it
   settled would contradict the rebalance list in the card above, which is exactly
   the kind of two-surfaces-disagreeing defect this release is about. Returns the
   move in percentage points, or null when the holding is genuinely untouched (or
   when no previous weight was recorded, where nothing can be claimed either way). */
function heldMovePP(ticker){
  var d = window._bookDiff;
  if (!d || !d.known || !d.prevPos) return null;
  var p = d.prevPos[String(ticker)];
  if (!p || typeof p.w !== 'number') return null;
  var s = (stocksData || []).filter(function(x){ return x.ticker === ticker; })[0];
  if (!s) return null;
  var dd = (Number(s.weight_pct) || 0) - p.w;
  return Math.abs(dd) >= 0.05 ? dd : null;
}

/* A member is mid-cycle when this ships, with ticks under the old strategy-only
   key. Dropping them would wipe the progress of everyone who had placed half
   their orders, so the legacy map is adopted once and the old key removed.
   WHICH cycle it belongs to is knowable rather than assumed: bookDiff reports
   whether it just rolled the book forward on THIS load. If it did, the ticks
   were written against the set the member last opened, so they land on prevKey
   and the new cycle correctly starts empty. If it did not, the member is still
   in the cycle they ticked, and the ticks land on the current key. */
function migrateBoughtKeys(strategy){
  try {
    var legacy = 'mfc_bought_' + (strategy || 'default').replace(/[^a-z0-9]+/gi,'_');
    var raw = localStorage.getItem(legacy);
    if (!raw) return;
    var diff = window._bookDiff || {};
    var base = legacy + '__';
    var target = (diff.rolled && diff.prevKey)
      ? base + String(diff.prevKey).replace(/[^a-z0-9]+/gi,'_')
      : boughtStorageKey(strategy);
    if (target !== legacy && !localStorage.getItem(target)) localStorage.setItem(target, raw);
    localStorage.removeItem(legacy);
  } catch(e){}
}

/* Cycle keys are cheap but they are not free, and a member with a long history on
   one device would otherwise carry a key per month forever. Keep the current
   cycle and the one before it; drop the rest. Runs once per render. */
function pruneBoughtKeys(strategy){
  try {
    var base = 'mfc_bought_' + (strategy || 'default').replace(/[^a-z0-9]+/gi,'_') + '__';
    var keep = {};
    keep[boughtStorageKey(strategy)] = 1;
    var diff = window._bookDiff;
    if (diff && diff.prevKey){
      keep[base + String(diff.prevKey).replace(/[^a-z0-9]+/gi,'_')] = 1;
    }
    Object.keys(localStorage).forEach(function(k){
      if (k.indexOf(base) === 0 && !keep[k]) localStorage.removeItem(k);
    });
  } catch(e){}
}
function loadBought(strategy) {
  try {
    const raw = localStorage.getItem(boughtStorageKey(strategy));
    return raw ? _splitTicks(JSON.parse(raw)) : {};
  } catch (e) { return {}; }
}

/* ── V38.2 — "SINCE YOU LAST CHECKED": A REAL-EVENTS DIGEST, NOT A LOGIN STREAK ──
   The dashboard already answers "what is my number today" in depth (the profit
   headline, Top/Lagging chips, the attribution breakdown, the cycle track
   record). It never answered "what changed since I was last here" — a member
   had to re-read the whole page to find out, every time.
   This diffs the CURRENT page state against a snapshot of the member's
   PREVIOUS visit (localStorage, per device, per token — the same durability
   trade-off the price cache already makes) and reports only two kinds of real
   delta: a new rebalance has published, or the member has placed more orders
   in this cycle than they had last time. Both are facts already computed
   elsewhere on this page (window._rebalDate, loadBought()) — nothing here is a
   new number, only a comparison of two old ones.
   HONESTY CONDITION — this is the line that keeps it from being a streak/login
   gamification mechanic, which the owner explicitly ruled out: there is no
   counter of visits, days, or logins anywhere in this feature, opening the
   page twice in a row produces nothing ("since last visit" needs ≥10 minutes
   to have passed, so a refresh mid-session is never read as a return trip),
   and a visit where nothing changed shows NOTHING — it does not manufacture a
   "no changes!" banner just to have something to say. Fail-soft throughout: no
   card in the DOM, no previous snapshot, or a strategy switch → the card stays
   hidden and the page is exactly what it was before this existed. */
function _welcomeKey(){ return 'mfc_lastvisit_' + (token || 'demo' + (demoMode || '')); }
function renderWelcomeDigest(){
  var card = document.getElementById('wb-card');
  if (!card) return;
  card.style.display = 'none';
  var strat = currentStrategy || '';
  var rebalIso = null;
  try { var d = window._rebalDate; if (d && !isNaN(d.getTime())) rebalIso = _isoDay(d); } catch(e){}
  var orders = 0;
  try { orders = Object.keys(loadBought(strat) || {}).length; } catch(e){}

  var raw = null;
  try { raw = JSON.parse(localStorage.getItem(_welcomeKey()) || 'null'); } catch(e){}
  var now = Date.now();
  var lines = [];
  var sameCycle = raw && raw.rebal && rebalIso && raw.rebal === rebalIso;
  if (raw && typeof raw === 'object' && raw.strategy === strat &&
      (now - (Number(raw.ts) || 0)) > 10 * 60 * 1000){
    if (rebalIso && raw.rebal && rebalIso !== raw.rebal){
      lines.push('New picks are live for this cycle — your book has moved on since your last visit.');
    } else if (sameCycle && typeof raw.orders === 'number' && orders > raw.orders){
      var n = orders - raw.orders;
      lines.push('You’ve placed ' + n + ' more order' + (n === 1 ? '' : 's') + ' since your last visit.');
    }
  }
  if (lines.length){
    var body = document.getElementById('wb-body');
    if (body) body.innerHTML = lines.map(function(t){
      return '<div class="wb-line">' + t.replace(/</g,'&lt;') + '</div>';
    }).join('');
    card.style.display = 'flex';
  }
  // Overwrite AFTER reading — the next visit compares against what is true now.
  try {
    localStorage.setItem(_welcomeKey(), JSON.stringify({
      strategy: strat, rebal: rebalIso, orders: orders, ts: now
    }));
  } catch(e){}
}

/* ── V36.6 — THE CHECKLIST NOW OUTLIVES THE BROWSER IT WAS TICKED IN ─────────
   Until this release this map lived in localStorage and nowhere else. It is the
   ONLY state the member creates themselves on the whole dashboard, and it was
   the least durable thing on the page: it drove "Step 3 of 4", "0 of 4 placed",
   the rupees-still-to-deploy figure and the part-placed concentration warning,
   and a member who ticked two orders on their phone opened their laptop to none
   of it. Clearing site data lost it. The installed PWA was a third store again.

   The write path is unchanged in shape — localStorage first, synchronously, so
   the UI never waits on a network and an offline member keeps working exactly as
   before. The server is a second, durable copy behind a debounce.

   WHY THE DELTA IS DERIVED HERE AND NOT AT THE CALL SITES. Eight places call
   saveBought (row tick, order tick, select-all, reset, and four more), and every
   one of them expresses a removal the same way: by handing over a map that no
   longer has the key. Diffing against what was stored a moment ago recovers the
   removal without touching any of them — which matters, because a sync that
   knew about ticks but not unticks would let one device go on claiming an order
   was placed after the member had said it was not. */
const PROG_PENDING_KEY = 'mfc_prog_pending';   // removals not yet acknowledged
let _progTimer = null, _progServerAt = '', _progSynced = false;

function _progPendingAll() {
  try { const o = JSON.parse(localStorage.getItem(PROG_PENDING_KEY) || '{}');
        return (o && typeof o === 'object') ? o : {}; } catch (e) { return {}; }
}
function _progPendingAdd(key, tickers) {
  if (!tickers.length) return;
  try {
    const all = _progPendingAll();
    const cur = Array.isArray(all[key]) ? all[key] : [];
    tickers.forEach(function (t) { if (cur.indexOf(t) === -1) cur.push(t); });
    all[key] = cur.slice(-200);
    localStorage.setItem(PROG_PENDING_KEY, JSON.stringify(all));
  } catch (e) {}
}
function _progPendingClear(key, tickers) {
  try {
    const all = _progPendingAll();
    if (!Array.isArray(all[key])) return;
    all[key] = all[key].filter(function (t) { return tickers.indexOf(t) === -1; });
    if (!all[key].length) delete all[key];
    localStorage.setItem(PROG_PENDING_KEY, JSON.stringify(all));
  } catch (e) {}
}

function saveBought(strategy, map) {
  const key = boughtStorageKey(strategy);
  let before = {};
  try { before = JSON.parse(localStorage.getItem(key) || '{}'); } catch (e) {}
  try { localStorage.setItem(key, JSON.stringify(map)); } catch (e) {}
  // Anything that WAS ticked and now is not is a removal the server must see.
  const removed = Object.keys(before).filter(function (k) { return !map[k]; });
  if (removed.length) _progPendingAdd(key, removed);
  _progPush(key, map);
}

/* Debounced so select-all — which writes the map once per row — sends one
   request rather than fifteen. 1.2s is short enough that a member who ticks and
   closes the tab is covered by the pagehide flush below. */
function _progPush(key, map, immediate) {
  if (isDemo || !token || !key) return;              // demo has no member to save for
  if (_progTimer) { clearTimeout(_progTimer); _progTimer = null; }
  const send = function () {
    _progTimer = null;
    const removed = (_progPendingAll()[key] || []).slice();
    const body = JSON.stringify({
      action: 'set_progress', token: token, cycle_key: key,
      map: map || {}, removed: removed
    });
    const done = function () { if (removed.length) _progPendingClear(key, removed); };
    try {
      if (immediate && navigator.sendBeacon) {
        // On the way out there is no time for a response, so the removals are
        // NOT cleared here — they are idempotent, and re-sending them on the
        // next load is cheaper than losing one.
        navigator.sendBeacon(APPS_SCRIPT_URL, new Blob([body], { type: 'text/plain' }));
        return;
      }
      fetch(APPS_SCRIPT_URL, {
        method: 'POST', headers: { 'Content-Type': 'text/plain' },
        body: body, keepalive: true
      }).then(function (r) { return r.json(); })
        .then(function (d) { if (d && d.status === 'ok') done(); })
        .catch(function () { /* offline — localStorage already has it */ });
    } catch (e) {}
  };
  if (immediate) send(); else _progTimer = setTimeout(send, 1200);
}

/* ── RECONCILE ON LOAD ───────────────────────────────────────────────────────
   The server copy is the union of every device's saves, so it leads. The one
   thing it cannot know about is a tick made on THIS device since the last
   successful sync — so a local-only entry is kept when its own timestamp is
   newer than the server's, and dropped otherwise, because "local has it and the
   server does not" otherwise means it was removed on another device.

   A pre-V36.6 map has entries of the literal `true` with no timestamp. Those
   cannot win a comparison, which is correct: on the FIRST sync the server holds
   nothing for the cycle, local is adopted wholesale and pushed up, and from
   then on every entry carries a time. */
function progressSyncLoad(strategy) {
  if (isDemo || !token) return Promise.resolve(false);
  const key = boughtStorageKey(strategy);
  if (!key) return Promise.resolve(false);
  return _getProgress()
    .then(function (d) {
      if (!d || d.status !== 'ok' || !d.progress) return false;
      _progServerAt = String(d.updated_at || '');
      const server = d.progress[key];
      const local = loadBought(strategy);
      let merged;
      if (!server || typeof server !== 'object') {
        merged = local;                        // first device to sync this cycle
      } else {
        merged = {};
        Object.keys(server).forEach(function (k) { merged[k] = server[k]; });
        Object.keys(local).forEach(function (k) {
          if (merged[k]) return;               // server already knows this one
          const v = local[k];
          const t = (v && typeof v === 'object' && v.t) ? String(v.t) : '';
          if (t && _progServerAt && t > _progServerAt) merged[k] = v;
        });
      }
      // Removals this device has not managed to push yet still apply.
      (_progPendingAll()[key] || []).forEach(function (k) { delete merged[k]; });
      _splitTicks(merged);                     // V44.5 — the server's copy may predate a split

      const changed = JSON.stringify(merged) !== JSON.stringify(local);
      if (changed) { try { localStorage.setItem(key, JSON.stringify(merged)); } catch (e) {} }
      _progSynced = true;
      // Push whatever this device knows that the server might not.
      _progPush(key, merged);
      return changed;
    })
    .catch(function () { return false; });     // offline: behave exactly as before
}

/* ── PAINT A MERGED MAP ONTO A PAGE THAT IS ALREADY RENDERED ─────────────────
   Re-running renderTable() would work but would also reset whatever sort and
   scroll position the member was looking at, and it needs arguments this
   callback has no business reconstructing. So this mirrors exactly what
   toggleBought() and toggleOrder() do to the DOM for a single row, applied to
   every row — and then re-derives the four surfaces that read the checklist
   rather than the DOM: the progress card, the how-to steps, the Kite basket and
   the cycle-cost figures. Those four are the ones that would otherwise disagree
   with the ticks now showing, which is the defect class this codebase keeps
   finding (two surfaces, one fact). */
function applyBoughtToDom() {
  try {
    const map = loadBought(currentStrategy);
    document.querySelectorAll('[data-ticker]').forEach(function (el) {
      const t = el.getAttribute('data-ticker');
      if (!t) return;
      const on = !!map[t];
      el.classList.toggle('row-bought', on);
      const cb = el.querySelector('.bought-cb');
      if (cb) cb.checked = on;
    });
    document.querySelectorAll('[data-okey]').forEach(function (cb) {
      const k = cb.getAttribute('data-okey');
      if (!k) return;
      const on = !!map[k];
      cb.checked = on;
      const host = cb.closest('.chg-sell');
      if (host) host.classList.toggle('is-done', on);
      if (k.indexOf('RW:') === 0) _rwSyncTicks(k, on);   // V41.9 — A1
    });
  } catch (e) {}
  try { refreshBoughtProgress(); } catch (e) {}   // re-derives renderMyPosition too
  try { refreshHowto(); } catch (e) {}
  try { refreshKiteBasket(); } catch (e) {}
  try { renderCycleCost(); } catch (e) {}
}

/* A tick made in the last second of a visit must not be lost. */
window.addEventListener('pagehide', function () {
  try {
    if (isDemo || !token || !_progSynced) return;
    const key = boughtStorageKey(currentStrategy);
    if (_progTimer) _progPush(key, loadBought(currentStrategy), true);
  } catch (e) {}
});
/* V36.6 — ONE PLACE THAT DECIDES WHAT A TICK RECORDS.
   toggleBought and toggleBoughtAll are two doors onto the same map, and V35.4
   already had to fix select-all corrupting it. If only one of them recorded a
   basis, a member who used the header checkbox would get a Your Position card
   that silently omitted every holding — the same map, two meanings. */
function boughtValueFor(ticker, prev) {
  var s = (stocksData || []).filter(function (x) { return x.ticker === ticker; })[0] || null;
  return {
    p: (prev && typeof prev === 'object' && Number(prev.p) > 0)
         ? Number(prev.p)
         : (s ? Number(s.recommended_price) || 0 : 0),
    q: s ? Number(sharesFor(s)) || 0 : 0,
    t: new Date().toISOString()
  };
}

function toggleBought(cb) {
  // Find the closest tr or stock-card with data-ticker
  const host = cb.closest('[data-ticker]');
  if (!host) return;
  const ticker = host.dataset.ticker;
  const map = loadBought(currentStrategy);
  /* V36.6 — A TICK NOW RECORDS WHAT WAS BOUGHT, NOT JUST THAT IT WAS.
     The value used to be the literal `true`, which is why this page could show
     the member what to buy, what it costs to trade and how the MODEL did, and
     still could not answer "how am I doing?" about the product they pay for.
     One number was missing: the price they actually paid. It is prefilled from
     the recommended price the row already shows and is editable in the Your
     Position card, so a member who filled at a different price says so once.
     Every existing reader tests this map for TRUTHINESS (`!!map[k]`,
     `if (map[t])`, `!placed[key]`) and none compares it to `true`, and nothing
     iterates it — checked across all fourteen call sites — so an object here is
     invisible to them. A pre-V36.6 `true` keeps working and simply has no
     basis until the member re-ticks. */
  if (cb.checked) map[ticker] = boughtValueFor(ticker, map[ticker]);
  else delete map[ticker];
  saveBought(currentStrategy, map);

  // Sync both desktop row + mobile card visual states
  document.querySelectorAll('[data-ticker="' + ticker.replace(/"/g,'\\"') + '"]').forEach(el => {
    el.classList.toggle('row-bought', cb.checked);
    const sibCb = el.querySelector('.bought-cb');
    if (sibCb && sibCb !== cb) sibCb.checked = cb.checked;
  });
  refreshBoughtProgress();
  syncBoughtAllHeader();
  try { if (window.mfcInsight) window.mfcInsight.refresh('ticks'); } catch (e) {}   // V42.3
}

/* ── V35.5 · THE STICKY ACTION BAR ────────────────────────────────────────────
   Driven from cycleOrders() and the same broker/basket reading refreshKiteBasket
   uses, and called FROM the end of refreshKiteBasket — so the bar and the band it
   mirrors are refreshed by one event, and a capital change, a tick or a broker
   switch can never leave them saying different things.
   Two cases, both real, nothing invented for a third:
     · a basket exists  -> the Kite CTA, with the rupee value inside the button
     · orders exist but cannot be basketed (a broker other than Kite, or a
       weight-rotation month where nothing is bought or sold outright) -> a jump
       to the picks, which is genuinely what that member does next
   Nothing to do -> the bar does not exist. */
function refreshActionBar(){
  try {
    var bar = document.getElementById('mf-abar');
    if (!bar) return;
    var hide = function(){
      bar.hidden = true; bar.classList.remove('is-on');
      document.documentElement.style.setProperty('--mf-abar-h', '0px');
    };
    if (typeof stocksData === 'undefined' || !(stocksData || []).length) return hide();

    var orders  = cycleOrders();
    var placed  = loadBought(currentStrategy) || {};
    var pending = orders.all.filter(function(o){ return !placed[orderKey(o)]; });
    // A weight-rotation month has no buys and no sells and plenty to do.
    // V41.9 — A1: once its re-weights are sized they are ordinary pending orders
    // (and, all placed, nothing is left); this fallback is for a month that cannot be sized.
    var nRw = (orders.rwKnown || orders.mode !== 'rebal') ? 0 : (stocksData || []).filter(function(s){ return heldMovePP(s.ticker) != null; }).length;
    // V43.8 — Step 3 is waiting on the member: last month's book not answered yet, or
    // Pick stocks with nothing ticked. Then the bar's job is to take them there.
    var omSt = orderModeState();
    var omWait = !omSt.m ? 'ask' : (omSt.m === 'pick' && !orders.all.length && pickCandidates().length ? 'none' : '');
    if (!pending.length && !nRw && !omWait) return hide();

    /* V37.5 — the bar reads the same basket PLAN the band draws. `send` is the
       NEXT basket, not "the first ten of whatever is open": after basket 1 has
       been opened on Kite the bar moves on to basket 2 instead of offering the
       same ten names again. */
    var plan    = (typeof kiteBasketPlan === 'function') ? kiteBasketPlan() : { openN:0, live:[], total:0, next:null };
    var isKite  = getBroker() === 'kite';
    var nextB   = plan.next;
    var canSend = isKite && !!nextB;
    var send    = nextB ? nextB.open.length : 0;

    var capEl = document.getElementById('abar-cap-v');
    if (capEl) capEl.textContent = currentCapital > 0 ? shortMoney(currentCapital) : '—';

    var nEl = document.getElementById('abar-n'), sEl = document.getElementById('abar-sub');
    if (omWait){
      if (nEl) nEl.textContent = omWait === 'ask' ? 'This month' : 'Pick stocks';
      if (sEl) sEl.textContent = omWait === 'ask' ? 'rebalance, buy all or pick' : 'nothing ticked yet';
    } else if (pending.length){
      var nB = pending.filter(function(o){ return o.side === 'BUY'; }).length;
      var nS = pending.length - nB;
      if (nEl) nEl.textContent = pending.length + ' order' + (pending.length === 1 ? '' : 's') + ' left';
      var subBits = [nS ? nS + ' to sell' : '', nB ? nB + ' to buy' : ''];
      // Several baskets: say which one the button is about to open. With one
      // basket (or another broker) the split is the more useful fact.
      if (isKite && plan.total > 1) subBits = [nextB ? 'basket ' + nextB.pos + ' of ' + plan.total + ' next'
                                               : plan.buysWait ? 'buys after the sales' : 'all ' + plan.total + ' baskets sent'];
      if (sEl) sEl.textContent = subBits.filter(Boolean).join('\u00a0· ');
    } else {
      if (nEl) nEl.textContent = nRw + ' to re-weight';
      if (sEl) sEl.textContent = 'no names change';
    }

    // The value in the button is the value of what THIS press will send — the
    // next basket when Kite needs several, not the whole cycle.
    var val = nextB ? (nextB.buyVal + nextB.sellVal) : 0;
    var lab = document.getElementById('abar-cta-label');
    var amt = document.getElementById('abar-amt');
    var cta = document.getElementById('abar-cta');
    if (omWait){
      if (lab) lab.textContent = omWait === 'ask' ? 'Choose your orders' : 'Tick stocks';
      if (amt) amt.textContent = omWait === 'ask' ? '3 options' : 'none ticked';
      if (cta){ cta.onclick = abarGoToOrderMode;
                cta.setAttribute('aria-label', omWait === 'ask'
                  ? 'Choose what to place this month: rebalance, buy all, or pick stocks'
                  : 'No stocks ticked yet. Jump to the list to tick what to buy or sell'); }
    } else if (canSend && !isDemo && !window._capEntered){      // V39.3 — B4
      if (lab) lab.textContent = 'Enter your amount';
      if (amt) amt.textContent = 'sized for ' + shortMoney(currentCapital);
      if (cta){ cta.onclick = abarEditCapital;
                cta.setAttribute('aria-label', 'Enter your amount first. The orders are sized for the starting amount, ' +
                  fmtMoney(currentCapital) + ', which you have not entered'); }
    } else if (canSend){
      var many = plan.total > 1;
      // V44.2 — with both sides in the cycle the bar names the side it is about to send
      var kindWord = plan.both ? (nextB.kind === 'sell' ? 'Sell' : 'Buy') + ' · basket ' : 'Basket ';
      if (lab) lab.textContent = many ? kindWord + nextB.pos + ' of ' + plan.total + (plan.both ? '' : ' on Kite') : 'Review ' + send + ' on Kite';
      if (amt) amt.textContent = val > 0 ? (many ? send + ' order' + (send === 1 ? '' : 's') + ' · ' : '') + preciseMoney(val) : '';
      if (cta){ cta.onclick = function(){ if (_fmAskFunds()) return; sendKiteBasket(nextB.pos); };
                cta.setAttribute('aria-label', (many ? (plan.both ? (nextB.kind === 'sell' ? 'Sale ' : 'Buy ') : '') + 'basket ' + nextB.pos + ' of ' + plan.total + ': review ' : 'Review ') +
                  send + ' order' + (send === 1 ? '' : 's') +
                  ' on Kite, worth ' + fmtMoney(val) + (nextB.kind === 'sell' ? '' : ' at the recommended prices')); }
    } else if (isKite && plan.buysWait && !nextB){
      // V44.2 — the sales are on Kite: the next job is to say they filled, in the band
      var amoWait = plan.waitFor === 'amo';
      if (lab) lab.textContent = amoWait ? 'Buys wait' : 'Sales filled?';
      if (amt) amt.textContent = amoWait ? 'for the sales to fill' : 'then the buys';
      if (cta){ cta.onclick = abarGoToBand;
                cta.setAttribute('aria-label', amoWait
                  ? 'The buys wait for your sales to fill. Jump to the Kite baskets'
                  : 'Have your sales filled? Jump to the Kite baskets to open the buys'); }
    } else if ((BROKERS[getBroker()] || {}).sheet === true && pending.length){
      // V39.5 — B7: no basket to send; the next job is the numbered order sheet. V44.5: every broker but Kite.
      if (lab) lab.textContent = 'Open the order sheet';
      if (amt) amt.textContent = pending.length + ' left';
      if (cta){ cta.onclick = abarGoToSheet; cta.setAttribute('aria-label', 'Jump to the order sheet: ' + pending.length + ' order' + (pending.length === 1 ? '' : 's') + ' left to place'); }
    } else if (isKite && plan.openN){
      // Every basket opened, orders not yet ticked: the next job is the tick-list.
      if (lab) lab.textContent = 'Tick what filled';
      if (amt) amt.textContent = '';
      if (cta){ cta.onclick = abarGoToPicks; cta.setAttribute('aria-label', 'All Kite baskets sent. Jump to your picks to tick what filled'); }
    } else {
      if (lab) lab.textContent = 'Go to picks';
      if (amt) amt.textContent = '';
      if (cta){ cta.onclick = abarGoToPicks; cta.setAttribute('aria-label', 'Jump to your picks table'); }
    }
    /* V37.1 — A TRUNCATED LABEL IS WORSE THAN NO LABEL.
       The mid column is flex:1 on a row whose other two children are fixed, so
       at narrow widths it gets whatever is left and ellipsises into nonsense:
       measured at 320px it showed "4 order…" over "2 to …", and with a full
       25-name book ("25 orders left" / "13 to buy · 12 to sell") it still
       overflowed at 360px — the single commonest Android width. A CSS
       breakpoint safe for the worst book would therefore have to hide the
       column on phones where it fits perfectly well for a small one.
       So the test is the real string against the real box, re-run on every
       sync. Nothing is lost when it goes: the column is aria-hidden, and the
       count it carries is already in the CTA beside it ("Review 4 on Kite").
       Un-hide BEFORE measuring or the first hide latches forever — a hidden
       column reports clientWidth 0 and would always look overflowed. */
    bar.hidden = false; bar.classList.add('is-on');
    /* MEASURE AFTER THE BAR IS ON SCREEN, not before. A [hidden] bar gives its
       children clientWidth 0 AND scrollWidth 0, so the overflow test reads
       0 > 1 — false — and the column stayed visible and truncated at exactly the
       widths this was written to catch. Caught by measuring the shipped page at
       320px rather than trusting the branch: n overflowed 16px, s overflowed
       27px, and the class was absent. Same family as every "read the state in
       the same block that changed it" trap on this page. */
    abarFitMid();
    requestAnimationFrame(abarFitMid);
    setTimeout(abarFitMid, 260);   // fail-visible: rAF does not fire on a hidden tab
    /* Publish the real height so the FAB and the toast clear it. Measured
       SYNCHRONOUSLY — the display flip above has already happened, so the box is
       real by now, and rAF cannot be the only writer: it does not fire in every
       environment this page is opened in (the built-in preview harness among
       them), and a bar that never published its height silently buries the
       back-to-top button under itself. rAF stays as a second pass for the case
       where layout has genuinely not settled. */
    var setH = function(){
      var h = bar.getBoundingClientRect().height;
      if (h > 0) document.documentElement.style.setProperty('--mf-abar-h', Math.round(h) + 'px');
    };
    setH();
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(setH);
  } catch(e){ /* the bar must never break the page it sits on */ }
}
/* Tapping the capital chip goes to the ONE input that owns the value. Duplicating
   the field in the bar would mean two controls for one number, which is how they
   end up disagreeing. */
/* V37.1 — see refreshActionBar() for why this is measured rather than a media
   query. ONE-SHOT MEASUREMENT WAS NOT ENOUGH, and that is the part worth
   recording: called once at the end of the sync it reported "fits" at 320px on
   a page that was visibly truncated, because the first sync runs before the
   layout the strings will actually be laid out in has settled. Re-running it
   from the same call, a frame later, and on resize is what makes it true —
   and resize is needed anyway, since the bar's width changes on rotation.
   Order matters: un-hide first, THEN measure. A hidden column reports
   clientWidth 0 and scrollWidth 0, so the test would read 0 > 1 (false) and a
   column hidden once could never come back. */
function abarFitMid(){
  var mid = document.getElementById('abar-mid');
  if (!mid) return;
  var bar = document.getElementById('mf-abar');
  if (!bar || bar.hidden) return;              // nothing to measure yet
  mid.classList.remove('mf-abar-mid-off');
  var n = document.getElementById('abar-n'), s = document.getElementById('abar-sub');
  var tight = [n, s].some(function(el){ return el && el.scrollWidth > el.clientWidth + 1; });
  if (tight) mid.classList.add('mf-abar-mid-off');
}
if (!window.__abarFitBound){
  window.__abarFitBound = 1;
  var _aft;
  addEventListener('resize', function(){
    clearTimeout(_aft); _aft = setTimeout(abarFitMid, 120);
  }, {passive:true});
  addEventListener('orientationchange', function(){ setTimeout(abarFitMid, 180); }, {passive:true});
  try { if (document.fonts && document.fonts.ready) document.fonts.ready.then(abarFitMid); } catch(e){}
}
function abarEditCapital(){
  var el = document.getElementById('size-input');
  if (!el) return;
  var prev = document.documentElement.style.scrollBehavior;
  document.documentElement.style.scrollBehavior = 'auto';
  el.scrollIntoView({ block:'center' });
  document.documentElement.style.scrollBehavior = prev;
  try { el.focus({ preventScroll:true }); el.select(); } catch(e){ try{ el.focus(); }catch(e2){} }
}
function abarGoToPicks(){
  var el = document.querySelector(document.documentElement.classList.contains('is-fm') ? '.table-section > .table-header' : '.table-section');
  if (!el) return;
  var prev = document.documentElement.style.scrollBehavior;
  document.documentElement.style.scrollBehavior = 'auto';
  el.scrollIntoView({ block:'start' });
  document.documentElement.style.scrollBehavior = prev;
}

/* V36.5 — the buy row's size, in the ONE arithmetic the whole page shares:
   allocBudget() -> floor(budget / recommended price). Returns '' rather than a
   zero whenever the number would be a guess — no stock object, no price, no
   capital entered, or a capital below one share — because "buy 0 shares" is a
   statement the page must not make (the V35.3 rule the sell row already
   follows). Never throws: it renders inside the change card. */
function _buyQtyText(s){
  try{
    if (!s) return '';
    var price = Number(s.recommended_price) || 0;
    var cap   = Number(currentCapital) || 0;
    if (price <= 0 || cap <= 0) return '';
    var qty = Math.floor(allocBudget(s, stocksData, cap) / price);
    if (!(qty > 0)) return '';
    return qty + '\u00a0share' + (qty === 1 ? '' : 's') + '\u00a0\u00b7 ' + fmtMoney(Math.round(qty * price));
  }catch(e){ return ''; }
}
/* The capital box moves every one of those quantities, so the buy rows are
   rewritten by the same call that rewrites the picks table's Allocation column
   (refreshSizeSummary). Without this the card would print the size that was
   right at first paint and quietly disagree with the table under it — the
   hand-label-beside-a-machine-number shape, one surface later. */
function refreshChgBuySizes(){
  try{
    var byT = {};
    (stocksData || []).forEach(function(s){ byT[String(s.ticker || '')] = s; });
    document.querySelectorAll('[data-buyqty]').forEach(function(el){
      el.textContent = _buyQtyText(byT[el.getAttribute('data-buyqty')]);
    });
  }catch(e){}
}
/* V35.3 — the tick for an order that has no row in the picks table. A departing
   holding is not in stocksData, so toggleBought's `closest('[data-ticker]')` walk
   has nothing to find; this reads the order key off the control itself. Both
   handlers write the same map, so a sell counts toward the same progress a buy
   does and the basket drops it the same way. */
function toggleOrder(cb){
  var key = cb.getAttribute('data-okey');
  if (!key) return;
  var map = loadBought(currentStrategy);
  if (cb.checked) map[key] = true; else delete map[key];
  saveBought(currentStrategy, map);
  var host = cb.closest('.chg-sell');
  if (host) host.classList.toggle('is-done', cb.checked);
  _rwSyncTicks(key, cb.checked);   // V41.9 — A1: a re-weight shows in three places
  refreshBoughtProgress();
}

// V5.2 #2: broker deeplinks per stock row. User can pick their preferred
// broker once and every row gets a one-click "Open in <broker>" link.
// Saved in localStorage so the choice persists. Default: Zerodha Kite.
// V27.9 — each chip paints its label in the broker's BRAND colour at 11px on an
// 8% wash of that same colour. Brand identity belongs on the wash and the
// border; as TEXT the brand hex failed in one theme or the other for all three:
//   light card   Kite #387ed1 3.77:1   Groww #00b386 2.45:1   Upstox 12.7 ok
//   dark card    Kite         3.70:1   Groww         5.69 ok  Upstox #371777 1.13:1
// Groww and Upstox were invisible to the audit because Kite is the default.
// A single deeper ink CANNOT fix this — deepening for the light card is exactly
// the wrong direction on the dark one, and a first pass that shipped only `ink`
// pushed Kite to 3.01 and Groww to 2.99 in dark. So each broker carries BOTH:
// `ink` for light, `inkDark` for dark, each the same brand hue moved toward the
// card it sits on, each >=4.6:1. They are emitted as custom properties and the
// theme picks one in CSS, so a runtime theme toggle re-inks without a re-render.
// `color` still drives the wash and the border, so the chips look unchanged.
var BROKERS = {
  kite:   { name: 'Kite',   color: '#387ed1', ink: '#26639f', inkDark: '#6ba0e2',
            link: function(s){
              // Kite supports a query-pre-fill URL on the order page
              var t = kiteSymbol(s.ticker);   // V43.9 — a BE-series stock is charted as STLTECH-BE
              return 'https://kite.zerodha.com/chart/web/NSE/' + encodeURIComponent(t);
            } },
  groww:  { name: 'Groww',  color: '#00b386', ink: '#006b50', inkDark: '#00b386',
            link: function(s){
              var t = (s.ticker || '').toUpperCase();
              // V39.1 — groww.in/stocks/<ticker> is a 404: Groww's stock pages are
              // keyed by company-name slug (reliance-industries-ltd), not by ticker.
              // Measured 26 Sep 2026: /stocks/reliance and /stocks/infy both 404,
              // /search?q=RELIANCE 200. Search is the link that resolves.
              return 'https://groww.in/search?q=' + encodeURIComponent(t);
            }, sheet: true },   // V44.5: Groww and Upstox had no step 3 at all: no list, no funding line
  upstox: { name: 'Upstox', color: '#371777', ink: '#371777', inkDark: '#ac8dea',
            // V44.5: upstox.com/search?q= answered "couldn't find that page" (checked in Chrome, 6 Nov 2026), so every row
            // linked to a dead page. Like a bank's broker, its rows now offer Copy and step 3 is the numbered sheet.
            link: function(){ return ''; }, copy: true, sheet: true },
  /* V39.5 — B7. A member whose demat came with their salary account (a bank broker)
     had to pick one of three brokers that were not theirs, and every row then
     linked into the wrong app. There is no order link to build for "any broker",
     so this entry has none: each row offers COPY (the ticker and its quantity) and
     step 3 becomes a numbered order sheet — one ticket per line, ticked as placed. */
  other:  { name: 'Another broker', color: '#475569', ink: '#334155', inkDark: '#cbd5e1',
            link: function(){ return ''; }, copy: true, sheet: true },
};
function getBroker(){
  try { var saved = localStorage.getItem(_devKey('mfc-broker')); if (saved && BROKERS[saved]) return saved; } catch(e){}
  // V24.5: every book is NSE, so Kite is always the default (the V9.3 US-book
  // Groww fallback existed only because Kite India can't trade US tickers).
  return 'kite';
}
function setBroker(key){
  if (!BROKERS[key]) return;
  try { localStorage.setItem(_devKey('mfc-broker'), key); } catch(e){}
  // Re-render table so all rows pick up the new deeplinks.
  // V28.0: this used to render stocksData in its canonical order, so picking a
  // broker silently undid the user's sort AND their filter while the sort arrow
  // and the chip both stayed put. Swapping a deeplink column is not a reason to
  // reset the view: applySort() re-renders in whatever order is current and
  // re-applies the filters, so only the chips change.
  applySort();
  refreshHowto();           // V28.8 — step 2 names the broker that is selected
  refreshKiteBasket();      // V34.2 — the basket button is Kite-only (V39.5: the sheet is the rest)
  try { if (window._bookDiff) renderBookChange(window._bookDiff, stocksData); } catch(e){}   // V39.5 — its rows carry the broker too
  try { refreshActionBar(); } catch(e){}
  showToast('Broker set to ' + BROKERS[key].name);
}
function brokerLink(s){
  var key = getBroker();
  var b = BROKERS[key] || BROKERS.kite;
  if (b.copy) return _csCopyBtn(s.ticker, sharesFor(s));   // V39.5 — B7
  var url = b.link(s);
  if (!url) return '';
  var safeUrl = url.replace(/"/g,'&quot;');
  return '<a class="broker-link" target="_blank" rel="noopener noreferrer" href="' + safeUrl +
         '" title="Open ' + escapeHtml(s.ticker) + ' on ' + escapeHtml(b.name) + '" ' +
         'style="background:' + b.color + '14;border-color:' + b.color + '33;' +
         '--bk-ink:' + (b.ink || b.color) + ';--bk-ink-d:' + (b.inkDark || b.ink || b.color) + ';">' +
         escapeHtml(b.name) + ' →</a>';
}

// V24.2: deep-link each pick's company name to its Scanner company page.
// Only NSE equities have a page in the snapshot (~2,100 symbols) — ETF picks
// (MultiAsset books; industry === 'ETF') get NO link rather than a dead
// "Company not found" landing. The .NS test also guards a missing/odd
// yahoo_ticker. New tab, so capital input / bought-state stay put.
function companyCell(s){
  var raw = String(s.company_name || s.ticker || '');
  var y = s.yahoo_ticker || '';
  if (!/\.NS$/i.test(y) || (s.industry || '') === 'ETF') return escapeHtml(raw);
  // V28.6: the 10px external-link glyph is an inline child of the link, so it takes
  // a line break like a word does. On the demo book exactly one row per width put it
  // alone on a second line — TCS at 1440, M&M at 1280, Titan Company at 1200 and
  // below — which added ~16px to that row and drew a stray 14px of the link's dotted
  // underline beneath the name. Binding it to the LAST WORD in a nowrap span keeps
  // the name free to wrap (long names legitimately need two lines) while making it
  // impossible for the glyph to be widowed.
  var words = raw.split(/\s+/), last = words.pop();
  var head  = words.length ? escapeHtml(words.join(' ')) + ' ' : '';
  return '<a class="company-link" href="/scores/company.html?symbol=' +
         encodeURIComponent(s.ticker) + '" target="_blank" rel="noopener" ' +
         'title="View ' + escapeHtml(s.ticker) + ' company page">' + head +
         '<span class="cl-tail">' + escapeHtml(last) +
         '<svg class="cl-ico" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17L17 7M9 7h8v8"/></svg></span></a>';
}

/* V35.4 — the marker that replaces a to-do checkbox on a carried-over holding.
   Two states, because "held" is two things: settled (the tick) and re-weighted
   (an arrow, in the direction of the move). One writer for the table cell and the
   phone card so the two can never show a row differently. The accessible name
   carries the whole meaning — a screen reader gets the state and the instruction,
   not a bare "image". */
/* V39.5 — B7: one order line to the clipboard — "RELIANCE 33" — for any broker. */
function _csCopyBtn(t, qty){
  if ((BROKERS[getBroker()] || {}).copy !== true) return '';
  var line = String(t || '').toUpperCase() + (qty > 0 ? ' ' + qty : '');
  return '<button type="button" class="broker-link broker-copy" data-copy="' + escapeHtml(line) +
    '" onclick="copyOrderLine(this)" title="Copy ' + escapeHtml(line) + '" aria-label="Copy ' + escapeHtml(line) + '">Copy</button>';
}
function copyOrderLine(el){
  var line = el && el.getAttribute('data-copy'); if (!line) return;
  copyText(line).then(function(){ showToast('Copied ' + line); el.classList.add('copied'); setTimeout(function(){ el.classList.remove('copied'); }, 1400); });
}
function _csIso(d){ return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function _csClockMark(){
  return '<span class="cs-lock cs-clock" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg></span>';
}
/* V39.5 — B1: the restricted row's mark and tag. A lock, not a disabled checkbox:
   a disabled control reads as a task taken away (the V35.4 rule for held rows). */
function _csLockMark(s){
  return '<span class="cs-lock" role="img" aria-label="' + escapeHtml(String(s && s.ticker || '')) +
    ' is on your restricted list" title="On your restricted list — not sized, not traded">' +
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg></span>';
}
function _csTag(){ return '<span class="rs-tag" title="On your restricted list — this dashboard never sizes, buys or sells it for you">Restricted</span>'; }
function heldMark(s, movePP){
  var tk = escapeHtml(s.ticker || '');
  if (movePP != null){
    var up = movePP > 0;
    var lbl = tk + ' — held, and its model weight was re-scored ' +
      (up ? 'up ' : 'down ') + Math.abs(movePP).toFixed(1) +
      ' percentage points. Adjust this position to the allocation shown.';
    return '<span class="held-mark is-rw ' + (up ? 'is-up' : 'is-dn') + '" role="img" aria-label="' + lbl +
      '" title="Weight re-scored — adjust to the allocation shown">' + (up ? '&uarr;' : '&darr;') + '</span>';
  }
  return '<span class="held-mark" role="img" aria-label="' + tk +
    ' — already held, carried over from your last cycle. No order needed."' +
    ' title="Already held — carried over from your last cycle">' +
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 12.5l5.2 5.2L20 7"/></svg></span>';
}

// V5.2 #20 + #21: sector filter chips + click-on-sector-allocation filtering.
// _sectorFilter is the active sector ('' = all). filterStocks already runs the
// search-term filter; we layer this on top.
var _sectorFilter = '';
function filterBySector(sectorName){
  _sectorFilter = (_sectorFilter === sectorName) ? '' : (sectorName || '');
  document.getElementById('tbl-search').value = '';
  filterStocks('');               // run base filter, then re-apply sector
  applySectorFilter();
  syncBoughtAllHeader();          // V28.1 — after the sector layer, not before
  reflectChipState();
  // Scroll table into view if user clicked from the allocation card
  var sec = document.querySelector('.table-section');
  if (sec && _sectorFilter) sec.scrollIntoView({behavior:'smooth', block:'start'});
}
function applySectorFilter(){
  if (!_sectorFilter) { syncTableEmptyState(); return; }
  var s = _sectorFilter.trim().toLowerCase();
  // V29.1 — the allocation card may be grouping by ASSET CLASS (see
  // deriveAssetClasses). Its rows stay clickable in that mode, so the filter has
  // to match on whichever key the card actually drew. `_aclass` is only ever
  // present when that mode engaged, so sector books are untouched.
  // V30.3 — the chips are built from this same key now (groupKeyOf), so the two
  // entry points into this filter can no longer disagree about what a group is.
  document.querySelectorAll('#stocks-tbody tr[data-row]').forEach(function(tr){
    if (groupKeyOf(stocksData[Number(tr.dataset.row)]).toLowerCase() !== s) tr.style.display = 'none';
  });
  document.querySelectorAll('.stock-card[data-row]').forEach(function(c){
    if (groupKeyOf(stocksData[Number(c.dataset.row)]).toLowerCase() !== s) c.style.display = 'none';
  });
  syncTableEmptyState();
}

/* V30.3 — ONE owner for the "nothing matched" state, on BOTH lists.
   The search path has had this since V28.1; the sector path never did, so a
   filter that matched nothing left a table with a header row and no body and no
   explanation — which is precisely the shape the chip/asset-class mismatch above
   presented as. A filter that hides everything must say so, whichever control
   applied it: a blank list is indistinguishable from a broken page.
   Both filters write display:none on the same rows, so the message is derived
   from what is actually visible rather than from either filter's own idea of its
   result. Cheap and idempotent — safe to call from every filter path. */
function syncTableEmptyState(){
  try {
    var tbody = document.getElementById('stocks-tbody');
    var host  = document.getElementById('stock-cards-mobile');
    if (!tbody) return;
    var rows = tbody.querySelectorAll('tr[data-row]');
    if (!rows.length) return;                       // empty-book state owns the table
    var visRows = 0, visCards = 0;
    rows.forEach(function(tr){ if (tr.style.display !== 'none') visRows++; });
    if (host) host.querySelectorAll('.stock-card[data-row]').forEach(function(c){
      if (c.style.display !== 'none') visCards++;
    });

    var msg = '';
    if (_searchQ) {
      msg = '<strong>No matches for "' + escapeHtml(_searchQ) + '"</strong>' +
            'Try a different ticker, company name, or industry.';
    } else if (_sectorFilter) {
      msg = '<strong>Nothing to show for ' + escapeHtml(_sectorFilter) + '</strong>' +
            'Choose <b>All</b> above to bring the whole book back.';
    }

    var row = tbody.querySelector('.tbl-empty-search-row');
    if (msg && visRows === 0) {
      if (!row) {
        row = document.createElement('tr');
        row.className = 'tbl-empty-search-row';
        var td = document.createElement('td');
        td.colSpan = 9; td.className = 'tbl-empty-search';
        row.appendChild(td);
        tbody.appendChild(row);
      }
      row.firstChild.innerHTML = msg;
    } else if (row) { row.remove(); }

    if (host) {
      var card = host.querySelector('.tbl-empty-search-card');
      if (msg && visCards === 0) {
        if (!card) {
          card = document.createElement('div');
          card.className = 'tbl-empty-search tbl-empty-search-card';
          host.appendChild(card);
        }
        card.innerHTML = msg;
      } else if (card) { card.remove(); }
    }
  } catch (e) { /* an empty-state helper must never break the table */ }
}
function renderSectorChips(){
  var box = document.getElementById('sector-chips');
  if (!box) return;
  if (!stocksData || stocksData.length < 4) { box.innerHTML = ''; return; }
  // V30.3: groupKeyOf(), not `industry` — see the note above it. On a sector book
  // this is `industry` and the chips are byte-identical to before; on the
  // MultiAsset book it is the asset class, which is both what the allocation card
  // above offers and the only key applySectorFilter() can match.
  var sectors = {};
  stocksData.forEach(function(s){
    var k = groupKeyOf(s) || 'Unknown';
    sectors[k] = (sectors[k] || 0) + 1;
  });
  var entries = Object.entries(sectors).sort(function(a,b){ return b[1]-a[1]; });
  var secColors = buildSectorColorMap(stocksData);   // V11.3: same colour the table/legend use
  var html = '<button type="button" class="chip" data-sector="" onclick="filterBySector(\'\')">All <span class="chip-n">' + stocksData.length + '</span></button>';
  entries.forEach(function(e){
    var safe = String(e[0]).replace(/'/g,"\\'");
    var dot = '<span class="chip-dot" style="background:' + groupColorOf(e[0], secColors) + '"></span>';
    html += '<button type="button" class="chip" data-sector="' + escapeHtml(e[0]) + '" onclick="filterBySector(\'' + safe + '\')">' +
      dot + escapeHtml(e[0]) + ' <span class="chip-n">' + e[1] + '</span></button>';
  });
  box.innerHTML = html;
  reflectChipState();
}
function reflectChipState(){
  document.querySelectorAll('#sector-chips .chip').forEach(function(b){
    var s = b.getAttribute('data-sector') || '';
    b.classList.toggle('active', s === _sectorFilter);
  });
}

// V5.2 #1: click-to-sort table columns. CSS hooks (th.sortable / .sort-asc /
// .sort-desc) were shipped in v17 — this is the JS that wires them up.
// State persists per-strategy in localStorage so users return to the same view.
var _sortKey = null, _sortDir = 1;
/* V28.0 — renderTable() rebuilds <tbody> and the mobile card list from scratch,
   which throws away the per-row display:none that filterStocks() and
   applySectorFilter() had written. _searchQ, _sectorFilter, the search box and
   the active sector chip all survive untouched, so after any re-render the
   table showed ALL 25 picks while the chip still read "Banks 3" and still
   carried .active — the UI stating a filter that was no longer applied.
   Reproduced: click "Banks 3" (3 rows), click any column header -> 25 rows,
   chip unchanged. The main render path has re-applied both filters since V10.6
   (see the note above the strategy-switch re-render); the sort and broker paths
   never did. One helper, used by every path that re-renders. */
function reapplyViewState(){
  if (_searchQ) filterStocks(_searchQ);
  applySectorFilter();
  syncBoughtAllHeader();   // V28.1 — a re-render rebuilt every checkbox
}
function applySort(){
  if (!_sortKey || !stocksData || !stocksData.length) {
    // Re-render in original order
    renderTable(stocksData);
    reapplyViewState();
    /* V29.5: this early return skipped the affordance re-sync. It never showed on
       desktop because no <th scope="col"> matches an empty key anyway, but the phone control
       has a direction button and a label to reset: choosing "Model order" left
       the button enabled and still reading "Low first" for a list that is not
       sorted at all. Same one-line sync the sorted path already ends with. */
    setTimeout(reflectSortAffordance, 0);
    return;
  }
  var getters = {
    num:      function(s, i){ return i; },
    company:  function(s){ return (s.company_name || s.ticker || '').toLowerCase(); },
    ticker:   function(s){ return (s.ticker || '').toLowerCase(); },
    /* V37.3 — sorted on the literal "ETF" for every MultiAsset row, so the
       column's own sort control was a no-op on the one book where the axis
       actually varies. Same key the cell now prints. */
    industry: function(s){ return String(groupKeyOf(s) || '').toLowerCase(); },
    price:    function(s){ return Number(s.recommended_price) || 0; },
    alloc:    function(s){
      var p = Number(s.recommended_price) || 0;
      var sh = p > 0 ? Math.floor(allocBudget(s, stocksData, currentCapital) / p) : 0;
      return sh * p;
    },
    shares:   function(s){
      var p = Number(s.recommended_price) || 0;
      return p > 0 ? Math.floor(allocBudget(s, stocksData, currentCapital) / p) : 0;
    },
    weight:   function(s){ return Number(s.weight_pct) || 0; },
  };
  var get = getters[_sortKey];
  /* V29.5: and the same sync here — this branch catches a key that is truthy but
     has no getter, which is what a stale localStorage entry from a renamed column
     would produce. It re-rendered in model order and left both affordances
     claiming the old key. */
  if (!get) { renderTable(stocksData); reapplyViewState(); setTimeout(reflectSortAffordance, 0); return; }
  // Stable copy
  var paired = stocksData.map(function(s,i){ return {s:s, k:get(s,i), i:i}; });
  paired.sort(function(a,b){
    if (a.k < b.k) return -1 * _sortDir;
    if (a.k > b.k) return  1 * _sortDir;
    return a.i - b.i;
  });
  var sorted = paired.map(function(p){ return p.s; });
  renderTable(sorted);
  reapplyViewState();
  // Reapply sort affordance after re-render
  setTimeout(reflectSortAffordance, 0);
}
function reflectSortAffordance(){
  document.querySelectorAll('th.sortable').forEach(function(th){
    th.classList.remove('sort-asc','sort-desc');
    var on = th.getAttribute('data-sort') === _sortKey;
    if (on) th.classList.add(_sortDir > 0 ? 'sort-asc' : 'sort-desc');
    /* V31.9 — the ARIA half of the same affordance. The ↑/↓ glyph is drawn by a
       ::after pseudo-element, which is decoration a screen reader never sees, so
       until now the sorted column was communicated by CSS alone. Set here rather
       than in the click handler so it also tracks a sort restored from storage
       on load, which is how this table usually arrives. */
    th.setAttribute('aria-sort', on ? (_sortDir > 0 ? 'ascending' : 'descending') : 'none');
  });
  reflectMobileSort();
}
/* V29.5 — the phone control's half of the same affordance. Called from
   reflectSortAffordance() rather than from its own hook, so there is exactly ONE
   place that re-syncs sort state after a render and both surfaces move together.
   The direction word is derived from the key, not stored: a text key reads
   A→Z / Z→A and a numeric one High first / Low first, which is what the value
   actually means — "ascending" is jargon for a column of rupees. */
function reflectMobileSort(){
  var sel = document.getElementById('msort-key');
  var btn = document.getElementById('msort-dir');
  var txt = document.getElementById('msort-dir-txt');
  if (!sel || !btn || !txt) return;
  var key = _sortKey || '';
  // a stored key that this control does not offer must not silently show "Model
  // order" while the list is sorted — fall back to leaving the select alone.
  if (Array.prototype.some.call(sel.options, function(o){ return o.value === key; })) sel.value = key;
  var isText = (key === 'company' || key === 'ticker' || key === 'industry');
  /* V31.7 — IN MODEL ORDER THIS BUTTON SAID "Model order", WHICH IS WHAT THE
     SELECT SITTING 6px TO ITS LEFT ALREADY SAID. The phone's sort row therefore
     opened as two adjacent controls carrying the identical label, one of them
     greyed out — which reads as a rendering fault, not as a disabled control.
     V29.5 correctly stopped it claiming "Low first" for an unsorted list; the
     replacement text described the LIST rather than the BUTTON, and a direction
     toggle has nothing to describe when there is no direction. So it leaves
     instead: hidden while there is nothing to reverse, and it appears — already
     reading "High first" / "A-Z" — the moment a sort key is chosen, which makes
     its own arrival the feedback for that choice. `disabled` is kept alongside
     `hidden` so the control is out of the tab order either way. */
  btn.disabled = !key;                       // nothing to reverse in model order
  btn.hidden   = !key;
  txt.textContent = !key ? ''
                  : isText ? (_sortDir > 0 ? 'A–Z' : 'Z–A')
                           : (_sortDir > 0 ? 'Low first' : 'High first');
}
(function(){
  function bindMobileSort(){
    var sel = document.getElementById('msort-key');
    var btn = document.getElementById('msort-dir');
    if (!sel || sel._mfcBound) return;
    sel._mfcBound = true;
    // sortByKey() sets a sensible default direction for a NEW key and toggles
    // when handed the current one — which is exactly the two behaviours needed
    // here, so neither is reimplemented.
    sel.addEventListener('change', function(){ sortByKey(sel.value); });
    btn.addEventListener('click', function(){ if (_sortKey) sortByKey(_sortKey); });
    reflectMobileSort();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindMobileSort);
  else bindMobileSort();
})();
function sortByKey(key){
  if (_sortKey === key) {
    _sortDir = -_sortDir; // toggle
  } else {
    _sortKey = key;
    _sortDir = (key === 'company' || key === 'ticker' || key === 'industry') ? 1 : -1;
  }
  try { localStorage.setItem(_devKey('mfc-sort-' + (currentStrategy||'_')), _sortKey + ',' + _sortDir); } catch(e){}
  applySort();
}
// Restore from storage on dashboard render
function restoreSort(){
  if (!currentStrategy) return;
  try {
    var v = localStorage.getItem(_devKey('mfc-sort-' + currentStrategy));
    if (!v) return;
    var parts = v.split(',');
    _sortKey = parts[0]; _sortDir = Number(parts[1]) || 1;
    applySort();
  } catch(e){}
}
// Wire header clicks once
(function(){
  function bind(){
    document.querySelectorAll('th.sortable').forEach(function(th){
      if (th._sortBound) return;
      th._sortBound = true;
      th.addEventListener('click', function(){
        var key = th.getAttribute('data-sort');
        if (key) sortByKey(key);
      });
      /* V31.9 — role="button" does not bring the implicit key-to-click a real
         <button> has, so the tab stop added to the markup would otherwise be a
         focus ring that does nothing. These headers are static (never
         re-rendered), so focus survives the sort on its own and needs no
         restoring, unlike the two free tools' rebuilt theads. */
      th.addEventListener('keydown', function(e){
        if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
        e.preventDefault();
        th.click();
      });
    });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bind);
  else bind();
  // Re-bind after re-renders (cheap; idempotent guard above)
  setInterval(bind, 1000);
})();

// V5.1: select-all header checkbox toggles every visible row's bought state.
// Replaces the static "✓" glyph that was just decorative.
function toggleBoughtAll(headerCb) {
  if (!stocksData || !stocksData.length) return;
  const map = loadBought(currentStrategy);
  const rows = document.querySelectorAll('#stocks-tbody tr[data-row]');
  rows.forEach(tr => {
    // Skip rows hidden by search filter — only act on what the user sees
    if (tr.style.display === 'none') return;
    const ticker = tr.dataset.ticker;
    if (!ticker) return;
    // V35.4 — a carried-over holding has no order and no checkbox. Writing a tick
    // for it put a name into the map that nothing would ever clear, and the
    // mid-session card reads that map to decide what is held: select-all was the
    // one gesture that could corrupt it in a single click.
    if (isHeldRow(ticker)) return;
    // V36.6 — records the same basis a single tick does. See boughtValueFor().
    if (headerCb.checked) map[ticker] = boughtValueFor(ticker, map[ticker]);
    else delete map[ticker];
    tr.classList.toggle('row-bought', headerCb.checked);
    document.querySelectorAll('[data-ticker="' + ticker.replace(/"/g,'\\"') + '"]').forEach(el => {
      el.classList.toggle('row-bought', headerCb.checked);
      const sibCb = el.querySelector('.bought-cb');
      if (sibCb) sibCb.checked = headerCb.checked;
    });
  });
  saveBought(currentStrategy, map);
  refreshBoughtProgress();
  // V28.1: the header describes the VISIBLE rows, so it has to be recomputed
  // whenever the visible set or the marks change. It was called from exactly one
  // place — toggleBought — so: after a select-all it kept whatever state the
  // click had put it in; after a search change it still described the OLD
  // visible set (tick 3 of 3 filtered rows, clear the search, and it claimed all
  // 25 were selected while the progress card correctly read "3 of 25"); and
  // after a reload it read unchecked even with marks restored.
  syncBoughtAllHeader();
  try { if (window.mfcInsight) window.mfcInsight.refresh('ticks'); } catch (e) {}   // V42.3
  showToast(headerCb.checked ? 'Marked all visible picks bought' : 'Cleared all marks');
}

// Keep the header checkbox in sync with row state (checked when ALL visible
// rows are checked; indeterminate when SOME are; unchecked when NONE).
function syncBoughtAllHeader() {
  const head = document.getElementById('bought-all');
  if (!head) return;
  const rows = Array.from(document.querySelectorAll('#stocks-tbody tr[data-row]'))
    .filter(tr => tr.style.display !== 'none');
  if (!rows.length) {
    head.checked = false; head.indeterminate = false; return;
  }
  const checked = rows.filter(tr => {
    const cb = tr.querySelector('.bought-cb');
    return cb && cb.checked;
  }).length;
  head.checked = (checked === rows.length);
  head.indeterminate = (checked > 0 && checked < rows.length);
}
function resetBought() {
  saveBought(currentStrategy, {});
  document.querySelectorAll('.bought-cb').forEach(cb => { cb.checked = false; });
  document.querySelectorAll('.row-bought').forEach(el => el.classList.remove('row-bought'));
  // V35.3 — the sell tickets live in the change card, outside the picks table, so
  // they carry their own class and their own struck-through state. Reset clears
  // one map; it has to clear both renderings of it.
  document.querySelectorAll('.chg-sell-cb').forEach(cb => { cb.checked = false; });
  document.querySelectorAll('.chg-sell.is-done').forEach(el => el.classList.remove('is-done'));
  // V41.9 — A1: the re-weight ticks and their rows, in the card and the table
  document.querySelectorAll('.rw-cb').forEach(cb => { cb.checked = false; });
  document.querySelectorAll('.chg-rot.is-done').forEach(el => el.classList.remove('is-done'));
  document.querySelectorAll('.rw-done').forEach(el => el.classList.remove('rw-done'));
  refreshBoughtProgress();
  /* V30.2 — `checked = false` does NOT clear `indeterminate`; the two are
     independent properties and the dash wins in the rendering. So after ticking
     some-but-not-all rows (which puts #bought-all into its dash state via
     syncBoughtAllHeader) and then pressing Reset, every row cleared while the
     select-all box kept painting the dash — the header claiming a partial
     selection over 25 empty checkboxes. Measured: {checked:false,
     indeterminate:true, rowsChecked:0}. This is the one mutation path that
     never re-synced the header; syncBoughtAllHeader sets both flags. */
  syncBoughtAllHeader();
  try { if (window.mfcInsight) window.mfcInsight.refresh('ticks'); } catch (e) {}   // V42.3
  showToast('Cleared all marks');
}
/* ── V31.3 — THE ONE TRANSITION THAT NEVER REPAINTED WAS THE RETURN TO ZERO ──
   This function ends by refreshing two things that are NOT this card: the live
   session read, and the "How to invest in 4 steps" panel. Both sat after an
   early `return` taken when the placed count is 0 — so every path that took the
   count back to zero hid the progress card and then left the other two saying
   what was true before. Reproduced with a real click on "Clear all marks":
   localStorage emptied, the toast fired, and step 3 went on reading "25 of 25
   placed · book complete" with the step marked done. Calling refreshHowto() by
   hand in the console corrected it instantly, which is the whole proof — the
   data was right and only the paint was stale.
   It is the same shape as the V28.1 note in toggleBoughtAll a few lines above
   ("the one mutation path that never re-synced the header"), and it is why the
   two page-wide refreshers now run on EVERY path, including the one where this
   card has nothing to show and the one where the card is not in the DOM at all.
   refreshSession() already hides itself when nothing is placed, by design. ── */
/* V35.3 — MEASURED AGAINST THIS CYCLE'S ORDERS, NOT AGAINST THE BOOK.
   It used to count ticked tickers over book size, which is only the same thing in
   a member's first cycle. Past that, the denominator counted eight holdings that
   needed no order and the numerator could never include a sell, so the bar
   reached "10 of 10 placed — All set" with two sell orders still outstanding and
   declared the month's job finished. cycleOrders() is the same list the basket
   and the CSV now read, so the four surfaces cannot report different totals. */
/* V39.1 — B7: one tap for the member who placed everything on Kite. The table's
   own select-all does the work, so held rows are skipped exactly as there. */
function markAllPlaced(){
  // V43.8 — Pick stocks: exactly the orders the member ticked, not every row the
  // table can tick (a joined name left unticked is not an order this month).
  if (orderModeState().m === 'pick'){
    try {
      var pm = loadBought(currentStrategy) || {};
      cycleOrders().all.forEach(function (o) {
        var k = orderKey(o);
        if (!pm[k]) pm[k] = (o.side === 'SELL' || o.rw) ? true : boughtValueFor(k, pm[k]);
      });
      saveBought(currentStrategy, pm);
      _omApply();
    } catch (e) {}
    return;
  }
  try { toggleBoughtAll({ checked: true }); } catch (e) {}
  // Sells are not table rows — they are ticked in "What changed" as SELL:<ticker>
  // (toggleOrder). Without them "placed them all" left every sell outstanding.
  try {
    var map = loadBought(currentStrategy) || {}, changed = false, rwKeys = [];
    (cycleOrders().all || []).forEach(function (o) {
      // V41.9 — A1: a re-weight is not a table row either, in either direction
      if (!o || (o.side !== 'SELL' && !o.rw)) return;
      var k = orderKey(o);
      if (o.rw) rwKeys.push(k);
      if (!map[k]) { map[k] = true; changed = true; }
    });
    if (changed) {
      saveBought(currentStrategy, map);
      document.querySelectorAll('input[data-okey^="SELL:"]').forEach(function (cb) {
        cb.checked = true;
        var h = cb.closest('.chg-sell'); if (h) h.classList.add('is-done');
      });
      rwKeys.forEach(function (k) { _rwSyncTicks(k, true); });
      refreshBoughtProgress();
    }
  } catch (e) {}
}
/* V39.1 — B8: the filing-season card. 1 Feb – 31 Jul in IST; hidden until the next
   season once dismissed. Counts come from MFTURN in #mfrisk; MultiAsset has none. */
function _itrSeasonKey(){
  var l = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  return _devKey('mfc_itr_hidden_' + l.getFullYear());
}
function renderItrCard(force){
  var card = document.getElementById('itr-card');
  if (!card) return;
  try {
    var l = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    var inSeason = l.getMonth() >= 1 && l.getMonth() <= 6;
    var hidden = false;
    try { hidden = localStorage.getItem(_itrSeasonKey()) === '1'; } catch (e) {}
    if (!force && (!inSeason || hidden)) { card.hidden = true; return; }
    var key = _strategyPerfKey(String(currentStrategy || ''));
    var yr = key ? _mfData(key + ':yearly') : '';
    var li = card.querySelector('.itr-count'), b = card.querySelector('[data-itr-yearly]');
    if (li && b) { b.textContent = yr ? '~' + yr : ''; li.hidden = !yr; }
    card.hidden = false;
  } catch (e) { card.hidden = true; }
}
function hideItrCard(){
  try { localStorage.setItem(_itrSeasonKey(), '1'); } catch (e) {}
  var card = document.getElementById('itr-card'); if (card) card.hidden = true;
}

/* ── V39.5 · B5 · ADVANCE TAX ─────────────────────────────────────────────────
   Salary TDS is worked out on salary alone, so a salaried member's gains here are
   not covered by it: once the year's remaining tax is ₹10,000 or more it is due in
   four instalments (Income-tax Act, 2025, tax year 2026-27 onwards: ss.424–425
   carry the interest that ss.234B–234C did). The card shows for the 21 days before
   each due date, IST, hideable per instalment. Rule and date only — nothing here is
   computed from the member's ticks, and it is not tax advice. */
var ADV_TAX_DUE = [[5, 15, '15%'], [8, 15, '45%'], [11, 15, '75%'], [2, 15, '100%']];   // [month index, day, cumulative share]
function _istToday(){
  var l = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  return new Date(l.getFullYear(), l.getMonth(), l.getDate());
}
function _advTaxDates(today){
  var c = [];
  [today.getFullYear(), today.getFullYear() + 1].forEach(function(y){
    ADV_TAX_DUE.forEach(function(d){ c.push({ date: new Date(y, d[0], d[1]), share: d[2] }); });
  });
  c.sort(function(a, b){ return a.date - b.date; });
  return c.filter(function(x){ return x.date >= today; });
}
function _advTaxKey(d){ return _devKey('mfc_atx_hidden_' + _csIso(d)); }
function renderAdvTaxCard(){
  var card = document.getElementById('atx-card');
  if (!card) return;
  try {
    var today = _istToday(), nx = _advTaxDates(today)[0];
    if (!nx){ card.hidden = true; return; }
    var days = Math.round((nx.date - today) / 864e5);
    var hidden = false;
    try { hidden = localStorage.getItem(_advTaxKey(nx.date)) === '1'; } catch (e) {}
    // V40.3 — B3: the helper is reachable at any time — from the ITR card, from
    // the .ics events (dashboard.html#advance-tax) — not only in the 21-day window.
    var forced = !!window._atxForce || (location.hash || '') === '#advance-tax';
    if (!forced && (days > 21 || hidden)){ card.hidden = true; return; }
    _atxWire();
    var lbl = mfDate(nx.date, { day: 'numeric', month: 'long' });
    var d1 = card.querySelector('[data-atx-date]'), d2 = card.querySelector('[data-atx-date2]');
    if (d1) d1.textContent = lbl + (days === 0 ? ' — today' : days === 1 ? ' — tomorrow' : '');
    if (d2) d2.textContent = lbl;
    var sh = card.querySelector('[data-atx-share]'); if (sh) sh.textContent = nx.share;
    card.hidden = false;
    // Arriving from a calendar event: open the helper and take the reader to it, once.
    if ((location.hash || '') === '#advance-tax' && !window._atxHashDone){
      window._atxHashDone = true;
      setTimeout(function(){ try { atxOpen(); } catch (e) {} }, 400);
    }
  } catch (e) { card.hidden = true; }
}
/* V40.3 — B3. The instalment, worked out from what the member types (see the
   markup note). Rounded to the rupee; the 2025 Act numbering is the card's. */
function _atxNum(v){
  var s = String(v == null ? '' : v).replace(/[^0-9.\-]/g, '');
  var n = parseFloat(s);
  return isFinite(n) ? n : 0;
}
function atxCalc(gain, slabPart, slabPct, band, paid){
  // Pure: every input explicit, so the arithmetic can be checked on its own.
  if (band === 'x') return { state: 'ask' };
  if (!(gain > 0)) return { state: 'none' };
  var sur = (Number(band) || 0) / 100;
  var slabNet = Math.min(Math.max(0, slabPart), gain);   // a loss on one side offsets the other
  var eq = gain - slabNet;
  var tax = (eq * STCG_RATE + slabNet * (Number(slabPct) || 0) / 100) * (1 + sur) * 1.04;
  var p = Math.max(0, paid);
  return { state: 'due', tax: Math.round(tax), paid: Math.round(p), due: Math.max(0, Math.round(tax - p)) };
}
function atxCompute(){
  var out = document.getElementById('atx-out'); if (!out) return;
  var gEl = document.getElementById('atx-g');
  if (!gEl || String(gEl.value).trim() === ''){
    out.innerHTML = 'Enter the short-term gains your broker’s Tax P&amp;L shows for this tax year.'; return;
  }
  var nx = null; try { nx = _advTaxDates(_istToday())[0]; } catch (e) {}
  var by = nx ? mfDate(nx.date, { day: 'numeric', month: 'long' }) : 'the next due date';
  var r = atxCalc(_atxNum(gEl.value), _atxNum((document.getElementById('atx-s') || {}).value),
                  (document.getElementById('atx-slab') || {}).value, (document.getElementById('atx-band') || {}).value,
                  _atxNum((document.getElementById('atx-p') || {}).value));
  if (r.state === 'ask'){
    out.innerHTML = 'Above ₹2 crore of income the surcharge on the slab part is higher than this sheet models — ask your CA for this one.'; return;
  }
  if (r.state === 'none'){
    out.innerHTML = '<b>No advance tax is due on these gains</b> — your Tax P&amp;L shows no net short-term gain this year.'; return;
  }
  out.innerHTML = 'Tax on these gains: about <b>' + fmtMoney(r.tax) + '</b>' +
    (r.paid > 0 ? '. Less what you’ve paid: ' + fmtMoney(r.paid) : '') + '. ' +
    (r.due > 0 ? '<b>Pay ' + fmtMoney(r.due) + ' by ' + by + '.</b>' : '<b>Nothing more to pay by ' + by + '</b> on these gains.') +
    '<span class="atx-basis">20% on share and equity-ETF gains, your slab on the rest, plus surcharge and 4% cess.</span>';
}
var _atxWired = false;
function _atxWire(){
  if (_atxWired) return; _atxWired = true;
  var sl = document.getElementById('atx-slab');
  if (sl){
    try { sl.value = String(_taxSlab()); } catch (e) {}
    sl.addEventListener('change', function(){ try { setTaxSlab(sl.value); } catch (e) {} atxCompute(); });
  }
  ['atx-g', 'atx-s', 'atx-p'].forEach(function(id){
    var el = document.getElementById(id); if (!el) return;
    el.addEventListener('input', atxCompute);
    el.addEventListener('blur', function(){
      var v = String(el.value).trim(); if (v === '') return;
      var n = _atxNum(v); el.value = (n < 0 ? '-' : '') + fmtNum(Math.abs(Math.round(n)));
    });
  });
  var bd = document.getElementById('atx-band'); if (bd) bd.addEventListener('change', atxCompute);
}
function atxOpen(ev){
  if (ev) ev.preventDefault();
  window._atxForce = true;
  renderAdvTaxCard();
  var card = document.getElementById('atx-card'), d = document.getElementById('advance-tax');
  if (!card || card.hidden || !d) return;
  d.open = true;
  var prev = document.documentElement.style.scrollBehavior;
  document.documentElement.style.scrollBehavior = 'auto';
  card.scrollIntoView({ block: 'start' });
  document.documentElement.style.scrollBehavior = prev;
  var g = document.getElementById('atx-g'); if (g) try { g.focus({ preventScroll: true }); } catch (e) { g.focus(); }
}
function hideAdvTaxCard(){
  try { var nx = _advTaxDates(_istToday())[0]; if (nx) localStorage.setItem(_advTaxKey(nx.date), '1'); } catch (e) {}
  var c = document.getElementById('atx-card'); if (c) c.hidden = true;
}
function addAdvanceTaxToCalendar(){
  try {
    var out = _advTaxDates(_istToday()).slice(0, 4).map(function(x){
      var next = new Date(x.date.getFullYear(), x.date.getMonth(), x.date.getDate() + 1);
      return { title: 'Advance tax: ' + x.share + ' of the year’s tax due',
               desc: 'If your tax for the year beyond your salary TDS comes to Rs 10,000 or more, ' + x.share +
                     ' of it is due by today. Your broker’s Tax P&L shows the gains realised so far. ' +
                     'Work out the amount on your dashboard: https://mindforgecapital.com/dashboard.html#advance-tax . Not tax advice.',
               d0: _cycYmd(x.date), d1: _cycYmd(next), alarm: '-P6DT15H',   // 9 am, a week ahead
               uid: 'mfc-advtax-' + _cycYmd(x.date) + '@mindforgecapital.com' };
    });
    _downloadIcs(out, 'advance-tax', 'date');
  } catch (e) {}
}

/* ── V39.5 · B1–B3 · THE RULES CARD ────────────────────────────────────────── */
window._csServer = false;   // set by csSyncLoad() from get_progress's `features`
var _csTimer = null, _csWired = false;
function _csPush(){
  // Only against a backend that advertises `prefs`: an older one would count the key
  // as a cycle and prune real progress to make room for it (the V39.3 capital rule).
  if (isDemo || !token || !window._csServer) return;
  if (_csTimer) clearTimeout(_csTimer);
  _csTimer = setTimeout(function(){
    _csTimer = null;
    try {
      var R = window._mfRules;
      fetch(APPS_SCRIPT_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, keepalive: true,
        body: JSON.stringify({ action: 'set_progress', token: token, cycle_key: CS_SERVER_KEY,
          map: { prefs: { t: R.t || new Date().toISOString(), r: R.r, h: R.h } }, removed: [] }) }).catch(function(){});
    } catch (e) {}
  }, 1200);
}
/* Resolves true when the server holds NEWER rules than this device (and adopts
   them); pushes this device's copy when it is the newer one. Never rejects. */
function csSyncLoad(){
  if (isDemo || !token) return Promise.resolve(false);
  return _getProgress()
    .then(function(d){
      if (!d || d.status !== 'ok' || !d.progress) return false;
      window._csServer = Array.isArray(d.features) && d.features.indexOf('prefs') >= 0;
      if (!window._csServer) return false;
      var e = d.progress[CS_SERVER_KEY], v = e && e.prefs, local = window._mfRules;
      if (v && v.t && (!local.t || String(v.t) > String(local.t))){
        var clean = _csClean(v); clean.t = String(v.t).slice(0, 40);
        window._mfRules = clean;
        try { localStorage.setItem(CS_KEY, JSON.stringify(clean)); } catch (e2) {}
        return true;
      }
      if (local.t && (!v || String(local.t) > String(v.t || ''))) _csPush();
      return false;
    })
    .catch(function(){ return false; });
}
function _csSave(o){
  var clean = _csClean(o); clean.t = new Date().toISOString();
  window._mfRules = clean;
  if (!isDemo){ try { localStorage.setItem(CS_KEY, JSON.stringify(clean)); } catch (e) {} }   // a sample saves nothing
  _csPush();
  csApplyEverywhere();
}
/* One re-render of everything the rules move: the table (in its current sort and
   filter), the change card, the sizing card and all it drives, the headline. */
function csApplyEverywhere(){
  try { applySort(); } catch (e) { try { renderTable(stocksData); } catch (e2) {} }
  try { if (window._bookDiff) renderBookChange(window._bookDiff, stocksData); } catch (e) {}
  try { refreshSizeSummary(); } catch (e) {}
  try { if (window._livePx) renderProfitHeadline(); } catch (e) {}
  try { csRender(); } catch (e) {}
  try { refreshActionBar(); } catch (e) {}
}
function _csNameKey(n){
  return String(n == null ? '' : n).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\b(limited|ltd|pvt|private|company|co|corporation|corp|inc|the)\b/g, ' ').replace(/\s+/g, ' ').trim();
}
function _csResolve(text){
  var raw = String(text || '').trim(); if (!raw) return null;
  var list = stocksData || [], sym = _csNormSym(raw);
  var hit = list.filter(function(x){ return String(x.ticker).toUpperCase() === sym; })[0];
  if (!hit){ var want = _csNameKey(raw); if (want) hit = list.filter(function(x){ return _csNameKey(x.company_name) === want; })[0]; }
  if (hit) return { t: String(hit.ticker).toUpperCase(), name: hit.company_name || '', inBook: true };
  return _csValidSym(sym) ? { t: sym, name: '', inBook: false } : null;
}
function csAdd(text){
  var msg = document.getElementById('cs-msg'), R = window._mfRules, hit = _csResolve(text);
  var say = function(t){ if (msg) msg.textContent = t; };
  if (!hit){ say('That doesn’t look like an NSE symbol — use the one your broker shows in your holdings.'); return false; }
  if (R.r.indexOf(hit.t) !== -1){ say(hit.t + ' is already on your list.'); return false; }
  if (R.r.length >= CS_MAX_NAMES){ say('The list holds up to ' + CS_MAX_NAMES + ' names.'); return false; }
  _csSave({ r: R.r.concat([hit.t]), h: R.h });
  say('Added ' + hit.t + (hit.name && hit.name !== hit.t ? ' — ' + hit.name : '') + (hit.inBook
    ? '. It is in this cycle’s book, so your orders were re-sized without it.'
    : '. It is not in this cycle’s book; the rule applies whenever the model picks it.'));
  return true;
}
function csRemove(t){
  var R = window._mfRules;
  _csSave({ r: R.r.filter(function(x){ return x !== t; }), h: R.h });
  var msg = document.getElementById('cs-msg'); if (msg) msg.textContent = 'Removed ' + t + '.';
}
function csSetHold(days){ var R = window._mfRules; _csSave({ r: R.r, h: _csHoldDays(days) }); }
function _csPreclearText(){
  var oc = cycleOrders(), placed = loadBought(currentStrategy) || {};
  var open = oc.all.filter(function(o){ return o.qty >= 1 && !placed[orderKey(o)]; });
  var hb = oc.holdBack || [];
  if (!open.length && !hb.length) return '';
  var byT = {}; (stocksData || []).forEach(function(x){ byT[String(x.ticker).toUpperCase()] = x; });
  var id = function(t, n){ var x = byT[t]; return ((x && x.company_name) || n || t) + ' (NSE: ' + t + ')'; };
  var w = Math.max.apply(null, open.map(function(o){ return id(o.ticker, o.name).length; }).concat([10]));
  var pad = function(t){ return t + new Array(Math.max(1, w - t.length + 3)).join(' '); };
  var lines = open.map(function(o){
    return (o.side === 'SELL' ? 'SELL  ' : 'BUY   ') + pad(id(o.ticker, o.name)) + o.qty + ' shares   ~' + fmtMoney(Math.round(o.qty * (o.price || 0)));
  });
  hb.forEach(function(h){
    lines.push('SELL  ' + pad(id(h.ticker, h.name)) + (h.qty > 0 ? h.qty + ' shares   ' : '') + 'on or after ' + mfDate(h.until, { day: 'numeric', month: 'short', year: 'numeric' }));
  });
  return 'Orders I intend to place in my own account — ' + mfDate(new Date(), { day: 'numeric', month: 'short', year: 'numeric' }) + '\n' + lines.join('\n');
}
function csCopyPreclear(){
  var t = _csPreclearText();
  if (!t){ showToast('No orders left to pre-clear this cycle'); return; }
  copyText(t).then(function(){ showToast('Copied — paste it into your pre-clearance request'); });
}
function csHoldToCalendar(ticker){
  try {
    var h = (cycleOrders().holdBack || []).filter(function(x){ return x.ticker === ticker; })[0];
    if (!h) return;
    var next = new Date(h.until.getFullYear(), h.until.getMonth(), h.until.getDate() + 1);
    _downloadIcs([{ title: 'Holding period ends: you may sell ' + h.ticker, desc: 'Your minimum holding period for ' + h.ticker +
      ' ends today. Open your dashboard to place the sale: https://mindforgecapital.com/dashboard.html',
      d0: _cycYmd(h.until), d1: _cycYmd(next), uid: 'mfc-hold-' + h.ticker.replace(/[^A-Z0-9]/g, '') + '-' + _cycYmd(h.until) + '@mindforgecapital.com' }], 'holding-period', 'reminder');
  } catch (e) {}
}
function csExpand(){
  var card = document.getElementById('cs-card'); if (!card) return;
  card._csOpen = true;
  card.classList.remove('is-collapsed');
  var inp = document.getElementById('cs-in'); if (inp) try { inp.focus({ preventScroll: true }); } catch (e) { inp.focus(); }
}
function csOpenCard(ev){
  if (ev) ev.preventDefault();
  var card = document.getElementById('cs-card'); if (!card || card.hidden) return;
  card._csOpen = true; card.classList.remove('is-collapsed');   // V40.3 — C5
  var prev = document.documentElement.style.scrollBehavior;
  document.documentElement.style.scrollBehavior = 'auto';
  card.scrollIntoView({ block: 'start' });
  document.documentElement.style.scrollBehavior = prev;
  var inp = document.getElementById('cs-in'); if (inp) try { inp.focus({ preventScroll: true }); } catch (e) { inp.focus(); }
}
function csDismissNudge(){
  try { localStorage.setItem('mfc_rules_nudge_off', '1'); } catch (e) {}
  var n = document.getElementById('cs-nudge'); if (n) n.hidden = true;
}
function _csWire(){
  if (_csWired) return; _csWired = true;
  var form = document.getElementById('cs-add'), inp = document.getElementById('cs-in');
  if (form && inp) form.addEventListener('submit', function(e){ e.preventDefault(); if (csAdd(inp.value)) inp.value = ''; });
  var ul = document.getElementById('cs-list');
  if (ul) ul.addEventListener('click', function(e){ var b = e.target.closest && e.target.closest('[data-cs-rm]'); if (b) csRemove(b.getAttribute('data-cs-rm')); });
  var sel = document.getElementById('cs-hold-sel'), num = document.getElementById('cs-hold-n');
  if (sel && num){
    sel.addEventListener('change', function(){
      if (sel.value === 'other'){ num.hidden = false; try { num.focus(); } catch (e) {} return; }
      num.hidden = true; csSetHold(sel.value);
    });
    num.addEventListener('change', function(){ var v = _csHoldDays(num.value); if (v > 0) csSetHold(v); });
  }
}
function csRender(){
  var card = document.getElementById('cs-card'), nudge = document.getElementById('cs-nudge');
  var on = _csOn() && (stocksData || []).length > 0;
  if (card) card.hidden = !on;
  if (!on){ if (nudge) nudge.hidden = true; return; }
  _csWire();
  var R = window._mfRules, list = stocksData || [];
  var st = document.getElementById('cs-status'), bits = [];
  if (R.r.length) bits.push(R.r.length + (R.r.length === 1 ? ' name restricted' : ' names restricted'));
  if (R.h > 0) bits.push(R.h + '-day minimum hold');
  if (st){ st.textContent = bits.length ? bits.join('\u00a0· ') : 'None set'; st.classList.toggle('is-set', bits.length > 0); }
  // V40.3 — C5: closed to one line while no rule is set (see the markup note).
  var csWant = bits.length > 0 || !!card._csOpen || (location.hash || '') === '#cs-card';
  card.classList.toggle('is-collapsed', !csWant);
  var byT = {}; list.forEach(function(x){ byT[String(x.ticker).toUpperCase()] = x; });
  var ul = document.getElementById('cs-list');
  if (ul) ul.innerHTML = R.r.map(function(t){
    var x = byT[t];
    return '<li class="cs-item">' + _csLockMark({ ticker: t }) + '<span class="cs-item-t">' + escapeHtml(t) + '</span>' +
      (x && x.company_name ? '<span class="cs-item-n">' + escapeHtml(x.company_name) + '</span>' : '') +
      (x ? '<span class="cs-item-in">in this cycle’s book</span>' : '') +
      '<button type="button" class="cs-x" data-cs-rm="' + escapeHtml(t) + '" aria-label="Remove ' + escapeHtml(t) + ' from your restricted list">Remove</button></li>';
  }).join('');
  var sel = document.getElementById('cs-hold-sel'), num = document.getElementById('cs-hold-n');
  if (sel && num && document.activeElement !== num){
    var preset = ['0', '30', '60', '90'].indexOf(String(R.h)) !== -1;
    sel.value = preset ? String(R.h) : 'other';
    num.hidden = preset;
    if (!preset) num.value = R.h;
  }
  var warn = document.getElementById('cs-hold-warn');
  if (warn){
    warn.hidden = !(R.h > 60);
    if (R.h > 60) warn.textContent = 'A monthly book sells about half its names each month. With a ' + R.h +
      '-day minimum, most sales will wait — this strategy may not suit your employer’s rules.';
  }
  var cost = document.getElementById('cs-cost'), nb = list.length, nIn = memberBook(list).length, nRs = nb - nIn;
  if (cost){
    var ln = [];
    if (nRs > 0) ln.push('Your book now differs from the model: <b>' + nIn + ' of ' + nb + '</b> names, each sized a little larger. ' +
      'The published record, the live figures and the verified account are the model’s, not your book’s.');
    if (nRs > 0 && nIn * 2 < nb) ln.push('<b>Fewer than half the model’s names are left</b> — your book no longer resembles this strategy, and it may not suit your rules.');
    cost.innerHTML = ln.join(' '); cost.hidden = !ln.length;
  }
  var pre = document.getElementById('cs-pre'), cp = document.getElementById('cs-copy'), txt = _csPreclearText();
  if (pre){ pre.textContent = txt; pre.hidden = !txt; }
  if (cp) cp.disabled = !txt;
  var sv = document.getElementById('cs-saved');
  if (sv) sv.textContent = isDemo ? 'A sample — nothing here is saved.' : (window._csServer ? 'Saved to your account.' : 'Saved on this device.');
  if (nudge){
    var off = false; try { off = localStorage.getItem('mfc_rules_nudge_off') === '1'; } catch (e) {}
    nudge.hidden = isDemo || off || R.r.length > 0 || R.h > 0;
  }
}

function refreshBoughtProgress() {
  try { renderMyPosition(); } catch (e) {}
  const map = loadBought(currentStrategy);
  const orders = cycleOrders();
  const keys = orders.all.map(orderKey);
  const bought = keys.filter(k => !!map[k]).length;
  const total = keys.length;
  const pct = total ? (bought/total)*100 : 0;
  const card = document.getElementById('buy-prog-card');
  if (card) {
    if (bought === 0 || total === 0) {
      card.style.display = 'none';
      // V35.3 — drop the celebratory state on the way out. Reset hid the card but
      // left is-complete set, so the next time it appeared it carried a green glow
      // and a ✓ for one frame before the first repaint corrected it.
      card.classList.remove('is-complete');
    } else {
      card.style.display = '';
      document.getElementById('bp-bought').textContent = bought;
      document.getElementById('bp-total').textContent = total;
      document.getElementById('buy-prog-fill').style.width = pct.toFixed(1) + '%';
      const remaining = total - bought;
      document.getElementById('bp-meta').textContent = remaining === 0
        ? 'All set — this cycle’s orders are placed.'
        : remaining + ' to go. Saved automatically in your browser.';
      // V12.2: celebratory state once every order is placed — a soft green glow +
      // a ✓ on the title. Toggled by class so it's reduced-motion safe via CSS.
      card.classList.toggle('is-complete', remaining === 0 && total > 0);
    }
  }
  refreshSession(map);
  refreshHowto();
  try { renderHeroJob(); } catch (e) {}   // V37.3 — the hero line counts what is left
  try { refreshOrdersTile(false); } catch (e) {}   // V37.6 — and so does the Orders tile
  refreshKiteBasket();      // V34.2 — a tick removes that row from the basket
  try { var ap = document.getElementById('hs-allplaced'); if (ap) ap.hidden = !(total > 0 && bought < total); } catch (e) {}
  try { renderItrCard(); } catch (e) {}
  try { renderAdvTaxCard(); } catch (e) {}   // V39.5 — B5
  try { csRender(); } catch (e) {}           // V39.5 — the pre-clearance list follows the ticks
}

// V29.6 — "Why these 25": how the member's book was BUILT.
// Was the strategy's factor mix, drawn from ten MFFAC weight markers sitting in
// this page's static markup. dashboard.html is public HTML on a public origin —
// the token gates the data payload, not the source — so that card published every
// factor name and its exact weight to anyone who pressed view-source. Removed
// site-wide in V29.6; the public twin on strategies.html became "How MindForge
// backtests", and this one became the same idea in the member's own terms.
//
// What it says now is drawn only from things the site states openly: the universe,
// the sector cap, the holding period, how positions are sized, and the fact that
// nothing is overridden by hand. The count and the sizing rule are read from the
// member's ACTUAL book (stocksData / weight_pct) rather than typed, so the card
// cannot disagree with the table beneath it.
// Never throws into its caller: this sits between the KPI row and the sector card,
// and a selection explainer must not be able to break the order sheet.
function renderWhy25() {
  var card = document.getElementById('why25');
  if (!card) return;
  try {
    var body = document.getElementById('why25-body');
    if (!body) { card.style.display = 'none'; return; }

    var s = String(currentStrategy || '');
    var code = /smallmicro/i.test(s) ? 'sm'
             : /largemidcap/i.test(s) ? 'lm'
             : /multiasset/i.test(s) ? 'ma' : null;
    if (!code) { card.style.display = 'none'; return; }   // unknown strategy: say nothing

    var n = (stocksData || []).length;
    var UNIVERSE = {
      lm: 'the Nifty LargeMidcap\u00A0250',
      sm: 'a 500-name Smallcap + Microcap list',
      ma: 'eight NSE-listed ETFs spanning Indian equity, gold, silver, debt and US tech'
    }[code];

    // Sizing: MultiAsset is score-weighted, the equity books equal-weighted. Rather
    // than assert either, read it off the book — if every weight matches, say equal.
    var ws = (stocksData || []).map(function(x){ return parseFloat(x && (x.weight_pct != null ? x.weight_pct : x.weight)); })
                               .filter(function(w){ return isFinite(w) && w > 0; });
    var equalWeighted = ws.length > 1 &&
      (Math.max.apply(null, ws) - Math.min.apply(null, ws)) < 0.51;
    var sizing = equalWeighted
      ? '<b>Equal-weighted.</b><span>Every position is the same size, so no single name can decide the month. Your rupee amounts come from your capital, not from a view on any one stock.</span>'
      : '<b>Weighted by conviction.</b><span>Position sizes follow each holding’s model score rather than an equal split, so the strongest signals carry the most capital.</span>';

    var terms = [
      '<b>One fixed universe.</b><span>Scored against ' + UNIVERSE + ' — the same list every month, set before the run, never widened after the fact.</span>',
      '<b>Ranked, not picked.</b><span>Every candidate gets a multi-factor score built from price and volume history alone. No fundamentals, no analyst view, no discretionary override — the ranking decides the book.</span>'
    ];
    if (code !== 'ma') {
      terms.push('<b>Capped at 2 per industry.</b><span>A sector that dominates the ranking still cannot dominate your portfolio. Diversification is enforced by the rules, not promised.</span>');
    }
    terms.push(sizing);
    terms.push('<b>Held for the full month.</b><span>The book is re-scored and rebalanced on the same monthly beat as the backtest — no intra-month trading, no reacting to headlines.</span>');

    body.innerHTML =
      '<div class="why25-chain">' +
        terms.map(function(t, i){ return '<div class="why25-term" data-step="' + (i + 1) + '" style="--i:' + i + '">' + t + '</div>'; }).join('') +
      '</div>' +
      '<p class="why25-note">The factors themselves and how they are weighted are MindForge’s intellectual property and are not published. <b>How</b> the simulation behind the published returns is constructed — and where it flatters us — is set out in full under ' +
      '<a href="disclosures.html#backtest-methodology" style="color:var(--accent2);font-weight:700;">Backtest methodology</a>.</p>';

    // V36.6 — say the count only when the count is known. The old fallback was
    // `(n || (code === 'ma' ? 8 : 25))`, which printed 25 for both equity books
    // whose real TOP_N are 10 and 15. A hand-written number beside a
    // machine-rewritten one is this repo's most-repeated defect; the fix is to
    // stop writing the number, not to correct it and wait for the next edit.
    document.getElementById('why25-title').textContent =
      'Why these ' + (n > 0 ? n : 'picks');
    card.style.display = '';

    // Draw the rails a frame after the card is displayable — a transition set on
    // an element that was painted at its final value never runs (V23.5). Timer
    // backstop for the harnesses where rAF never fires.
    function draw(){ card.classList.add('is-drawn'); }
    if (window.requestAnimationFrame) requestAnimationFrame(function(){ setTimeout(draw, 50); });
    setTimeout(draw, 700);
  } catch (e) { try { card.style.display = 'none'; } catch (e2) {} }
}

// V28.8 — the four "How to invest" steps, told back to the member.
// Reads the same sources the panels above already use rather than recomputing
// anything: currentCapital and the rendered per-stock figure, getBroker(), the
// bought map, and nextRebalanceDate(). Nothing here may throw into a caller —
// this card is instructions, and instructions must survive every data shape.
/* ═══ V34.2 — SEND THE BOOK TO KITE AS A PRE-FILLED BASKET ════════════════════
   ─────────────────────────────────────────────────────────────────────────────
   WHY THIS IS A FORM POST AND NOT AN API CALL. Kite Connect's order API cannot
   be reached from this page at all, for two independent reasons, and both are
   permanent rather than things to work around:
     · Zerodha's own docs: "The API endpoints are not cross site request enabled,
       hence cannot be called directly from browsers." No CORS, no fetch.
     · The order API needs an access_token minted by signing api_key +
       request_token + api_secret. This site is static GitHub Pages with no
       server, and the api_secret must never reach a browser.
   Offsite order execution is the route Zerodha built for exactly this case: we
   POST a JSON basket to Kite's own exchange-approved order screen, the member
   logs in as themselves and confirms there. No token, no secret, no backend.

   WHAT THIS DOES AND DOES NOT DO. It hands the member a filled-in order form.
   It does not place an order, cannot place one, and never sees their Zerodha
   credentials or funds — the confirm happens on kite.zerodha.com under their own
   login. That distinction is the whole design: MindForge publishes a book, the
   member executes it. Every row lands editable (readonly:false) so quantity,
   order type and price stay theirs to change before they confirm.

   THE api_key IS PUBLIC BY DESIGN. Publisher's own documentation puts it in page
   markup (`data-kite="your_api_key"`). It identifies the app; it authorises
   nothing on its own. The api_secret is NOT here and must never be — nothing in
   this flow needs it.

   QUANTITIES come from the same expression the Shares column prints, so what is
   sent is what the table shows and a member reconciling the two cannot find a
   discrepancy: floor(allocBudget(stock, stocksData, currentCapital) / price).
   Rows already ticked are skipped, and so are rows that round to zero shares.

   TEN AT A TIME. Kite Publisher caps a basket at 10 instruments; SmallMicro 500
   holds 15. V37.5 replaced "send the first ten and wait for ticks" with a PLAN of
   baskets (kiteBasketPlan) — every basket and its value shown up front, and a
   per-device sent record that moves the button on to the next basket. See the
   V37.5 block above kiteBasketPlan() for why the old flow read as the dashboard
   investing two-thirds of the member's capital. The tick-list stays the record
   of what FILLED: Kite reports no fill state back to this page.

   MARKET, not LIMIT. An unfilled limit order leaves a book silently incomplete,
   which is worse than slippage on names this liquid — and the member can change
   the type on Kite's screen before confirming, which the note says out loud.

   V34.3 — THE PAGE'S OWN CSP BLOCKED THIS AND V34.2 SHIPPED IT BROKEN. The meta
   CSP at the top of this file carries `form-action 'self' https://script.google
   .com`, which governs where a form may POST. Kite is neither, so every browser
   refused the submission — a blank tab opened and nothing ever loaded, in Safari
   and in Chrome alike:
       "Sending form data to 'https://kite.zerodha.com/connect/basket' violates
        the following Content Security Policy directive: form-action 'self'
        https://script.google.com. The request has been blocked."
   `https://kite.zerodha.com` is now in that directive and nothing else was
   widened — not connect-src (this is a form POST, not a fetch) and not frame-src
   (the basket opens as a top-level document, never in a frame).
   Why V34.2's tests missed it: they stubbed `HTMLFormElement.prototype.submit`
   to capture the payload without navigating, which is exactly the call CSP
   intercepts. A stub that stands in for the mechanism under test cannot test it.
   The check that catches this class is a REAL click plus a watch on the browser
   targets, with the destination host DNS-mapped to a dead port so the navigation
   is attempted and no traffic leaves the machine.
   ═══════════════════════════════════════════════════════════════════════════ */
var KITE_API_KEY    = '9uef60sn0rffqb2r';                    // public; see above
var KITE_BASKET_URL = 'https://kite.zerodha.com/connect/basket';
var KITE_BASKET_MAX = 10;                                    // Publisher's cap

/* ── V37.5 · A CYCLE THAT NEEDS MORE THAN ONE BASKET ───────────────────────────
   REPORTED: SmallMicro 500, ₹15,00,000 of capital, and the button read
   "Review 10 on Kite · ₹9.91L" beside "15 orders left · 15 to buy". A member
   reads that as the dashboard investing two-thirds of their money, and they
   were right to: press it, confirm on Kite, and five of the fifteen names —
   ₹4.97L — were never in any basket they were shown.
   Kite Publisher's own documentation caps a basket at ten ("maximum 10"), so the
   limit is real and cannot be raised from here. What was wrong was hiding it.
   The V34.2 design sent the first ten and relied on the member ticking all ten
   before the button would offer the rest — so a member who confirmed on Kite and
   came back WITHOUT ticking was offered the SAME ten again, which is a duplicate
   basket one tap away.

   The cycle is now a PLAN of baskets:
   · a STABLE partition of the cycle's sized orders, in the order cycleOrders()
     returns them (sells first, V35.4) — basket 1 is always the same names, so
     "basket 2 of 2" means something the member can hold on to;
   · each basket's value and order count shown up front, so the whole capital
     is visibly accounted for before anything is sent;
   · a SENT record (per strategy and cycle, this device) that advances the
     primary action to the next basket as soon as one is opened on Kite.
     Sending is not placing — Kite reports no fills to this page, so the tick
     list is still the record of what filled — but it is enough to stop the
     same basket being offered twice and to say which one is next.
   Every basket can still be re-sent on purpose ("Send again"), because a member
   who closed Kite without confirming needs exactly that. */
var KB_SENT_PREFIX = 'mfc_kbsent_';
function _kbSentStoreKey(){
  var base = KB_SENT_PREFIX + String(currentStrategy || 'default').replace(/[^a-z0-9]+/gi,'_');
  var ck = _cycleKey(window._currentSub);
  return ck ? base + '__' + String(ck).replace(/[^a-z0-9]+/gi,'_') : base;
}
function _kbSentLoad(){
  try { var o = JSON.parse(localStorage.getItem(_kbSentStoreKey()) || '{}');
        return (o && typeof o === 'object') ? o : {}; } catch (e) { return {}; }
}
function _kbSentMark(orders){
  try {
    var m = _kbSentLoad(), now = Date.now(), amo = _kbAmoNow() ? 1 : 0;   // V44.2 — `a`: sent as an AMO
    orders.forEach(function (o) { m[orderKey(o)] = { t: now, q: o.qty, a: amo }; });
    localStorage.setItem(_kbSentStoreKey(), JSON.stringify(m));
  } catch (e) {}
}

/* ── V43.8 · WHAT TO PLACE THIS MONTH: REBALANCE, BUY ALL, OR PICK STOCKS ──────
   The owner, on V43.7: "The option to buy all again is not showing ... You're
   assuming that the holdings from last month are as it is, fix that."
   For a member past month one, every order surface took it as given that they still
   held last month's book exactly as this page sized it: the names that stayed got no
   order, and the names that left were sold at last month's quantity. Nothing asked.
   Step 3 now asks, once a month, and the answer decides cycleOrders(), the one list
   the basket band, the order sheet, the table's ticks and the progress all read:
     · Rebalance  "I still hold last month's book": this month's changes, as before.
     · Buy all    "starting again": every name at its Shares quantity.
     · Pick       "only some of it": the member ticks what to buy or sell, from this
                  month's changes and a full buy of any name they carry forward.
   Until a member past month one answers, nothing can be sent: the band and the sheet
   wait, and the sticky bar points here. The answer is kept per device, book and cycle;
   a member who has already ticked or sent one of this month's rebalance orders has
   answered it, and the sample shows Rebalance. In a first cycle there is no last month,
   so there is no Rebalance either: the book is the order list (Buy all), or Pick. */
var OM_PREFIX = 'mfc_omode_';
var OM_MODES = { rebal: 1, fresh: 1, pick: 1 };
function _omStoreKey(){
  return _kbSentStoreKey().replace(KB_SENT_PREFIX, OM_PREFIX + (isDemo ? 'demo_' : ''));
}
function _omLoad(){
  try { var o = JSON.parse(localStorage.getItem(_omStoreKey()) || '{}') || {};
        return { m: OM_MODES[o.m] ? o.m : '', p: (o.p && typeof o.p === 'object') ? o.p : {} }; }
  catch (e) { return { m: '', p: {} }; }
}
function _omSave(st){
  try { localStorage.setItem(_omStoreKey(), JSON.stringify({ m: st.m, p: st.p || {} })); } catch (e) {}
}
/* The member's answer, or the one their own actions have already given. */
function orderModeState(){
  var st = _omLoad(), d = window._bookDiff, known = !!(d && d.known);
  if (st.m === 'rebal' && !known) st.m = 'fresh';     // no last month on record
  if (st.m) return st;
  st.auto = true;
  if (!known) { st.m = 'fresh'; return st; }
  if (isDemo) { st.m = 'rebal'; return st; }
  try {
    var bm = loadBought(currentStrategy) || {}, sent = _kbSentLoad();
    if (rebalanceOrders().all.some(function (o) { var k = orderKey(o); return !!bm[k] || !!sent[k]; })) st.m = 'rebal';
  } catch (e) {}
  return st;
}
function needsOrderChoice(){ return !orderModeState().m; }
/* Buy all: every name in the book at the Shares column's quantity. */
function wholeBookOrders(){
  var list = stocksData || [], cap = Number(currentCapital) || 0;
  return list.filter(function (s) { return !_isRestricted(s && s.ticker); })
             .map(function (s) { return _mkBuyOrder(s, list, cap); });
}
/* Pick: this month's changes (sells first), then a full buy of each name carried
   forward that has no order of its own, for the member who does not hold it. */
function pickCandidates(base){
  base = base || rebalanceOrders();
  var c = (base.sells || []).concat(base.trims || [], base.buys || [], base.adds || []).map(function (o) {
    var x = {}; Object.keys(o).forEach(function (k) { x[k] = o[k]; });
    x.why = o.rw ? 'rw' : (o.side === 'SELL' ? 'left' : (base.known ? 'joined' : 'book'));
    return x;
  });
  if (base.known){
    var have = {};
    c.forEach(function (o) { have[o.ticker] = 1; });
    (base.holdBack || []).forEach(function (h) { have[h.ticker] = 1; });
    wholeBookOrders().forEach(function (o) { if (!have[o.ticker]) { o.why = 'held'; c.push(o); } });
  }
  return c.filter(function (o) { return o.qty >= 1; });
}
/* The table's accent rail marks the rows that need an order (V35.6): none under Buy
   all, where every row does, and only the ticked ones under Pick. */
function _omAccent(ticker){
  var om = orderModeState();
  if (om.m === 'fresh') return false;
  if (om.m === 'pick') return !!om.p[String(ticker).toUpperCase()];
  return true;
}
function setOrderMode(m){
  if (!OM_MODES[m]) return;
  var st = _omLoad(); st.m = m; _omSave(st);
  _omApply();
}
function omPickToggle(cb){
  var k = cb.getAttribute('data-okey'); if (!k) return;
  var st = _omLoad(); st.m = 'pick';
  if (cb.checked) st.p[k] = 1; else delete st.p[k];
  _omSave(st);
  _omApply();
  // the list is re-rendered; keep a keyboard user on the row they just changed
  var boxes = document.querySelectorAll('#om-pick-list input[data-okey]');
  for (var i = 0; i < boxes.length; i++) {
    if (boxes[i].getAttribute('data-okey') === k) { try { boxes[i].focus({ preventScroll: true }); } catch (e) {} break; }
  }
}
function omPickAll(sel){
  var st = _omLoad(); st.m = 'pick'; st.p = {};
  if (sel) pickCandidates().forEach(function (o) { st.p[orderKey(o)] = 1; });
  _omSave(st);
  _omApply();
}
/* One re-render of everything the answer moves: the table (its held rows and ticks,
   in the current sort and filter), the change card, then the progress chain, which
   ends in the basket band, the order sheet, this block and the sticky bar. */
function _omApply(){
  try { applySort(); } catch (e) { try { renderTable(stocksData); reapplyViewState(); } catch (e2) {} }
  try { if (window._bookDiff) renderBookChange(window._bookDiff, stocksData); } catch (e) {}
  try { refreshBoughtProgress(); } catch (e) {}
  try { if (window.mfcInsight) window.mfcInsight.refresh('ticks'); } catch (e) {}   // V44.4: the tab's count read 12 under Buy all's 15 until a reload
}
function renderOrderMode(){
  var box = document.getElementById('omode');
  if (!box) return;
  if (!window._omSwept){            // V43.7's checklist store, retired with it
    window._omSwept = true;
    try { Object.keys(localStorage).forEach(function (k) { if (k.indexOf('mfc_kbpick_') === 0) localStorage.removeItem(k); }); } catch (e) {}
  }
  var list = stocksData || [];
  if (!list.length || !(Number(currentCapital) > 0)) { box.hidden = true; return; }
  var $ = function (id) { return document.getElementById(id); };
  var setT = function (id, t) { var el = $(id); if (el) el.textContent = t; };
  var d = window._bookDiff, known = !!(d && d.known);
  var base = rebalanceOrders(), st = orderModeState();
  var whole = wholeBookOrders().filter(function (o) { return o.qty >= 1; });
  var cands = pickCandidates(base), pk = st.p || {};
  var nTicked = cands.filter(function (o) { return !!pk[orderKey(o)]; }).length;
  var pl = function (n, one, many) { return n + ' ' + (n === 1 ? one : many); };

  /* V43.9 — orders with no quantity on record (last month's amount was never entered):
     sales of the names that left, and re-weights that cannot be sized. They cannot go in
     a basket, so the card counts them apart ("4 orders · 4 need sizes") instead of
     promising 8, and says that Match my holdings sizes them. Seen live on 1 Nov 2026:
     "8 orders" over a band of 4, and MultiAsset's "Nothing changes" over 8 moved weights. */
  var nSz = known ? (base.sellUnsized || 0) : 0;
  var nMv = (known && base.rwUnknown) ? d.held.filter(function (t) { return heldMovePP(t) != null && !_isRestricted(t); }).length : 0;
  var oR = $('om-o-rebal');
  if (oR) oR.hidden = !known;
  if (known){
    var nS = base.sells.length, nB = base.buys.length, nRw = (base.rw || []).length;
    var nCarry = Math.max(0, d.held.filter(function (t) { return !_isRestricted(t); }).length - nRw - nMv);
    var nSend = base.all.filter(function (o) { return o.qty >= 1; }).length;
    var bits = [];
    if (nS) bits.push('sell the ' + nS + ' that left' + (nSz ? ' (Match my holdings sizes ' + (nSz === nS ? 'them' : nSz + ' of them') + ')' : ''));
    if (nB) bits.push('buy the ' + nB + ' that joined');
    if (nRw) bits.push('re-weight ' + nRw);
    if (nMv) bits.push('re-weight ' + nMv + ' (Match my holdings sizes them)');
    setT('om-n-rebal', (nSz + nMv)
      ? (nSend ? pl(nSend, 'order', 'orders') + ' \u00b7 ' : '') + (nSz + nMv) + ' need sizes'
      : (base.all.length ? pl(base.all.length, 'order', 'orders') : 'nothing to place'));
    setT('om-d-rebal', 'I still hold last month’s book. ' +
      (bits.length ? bits.join(', ').replace(', buy the', ', then buy the').replace(/^./, function (c) { return c.toUpperCase(); }) : 'Nothing changes') +
      (nCarry === 1 ? '; the other one carries forward.' : nCarry ? '; the other ' + nCarry + ' carry forward.' : '.'));
  }
  var wVal = whole.reduce(function (t, o) { return t + Math.round(o.qty * (o.price || 0)); }, 0);
  setT('om-n-fresh', pl(whole.length, 'buy', 'buys') + (wVal > 0 ? ' · ' + shortMoney(wVal) : ''));
  setT('om-d-fresh', known
    ? 'Starting again: every name at your capital. Only if you hold none of last month’s book — otherwise you would own it twice.'
    : 'Every name in this month’s book, at the Shares quantity.');
  setT('om-n-pick', st.m === 'pick' ? nTicked + ' of ' + cands.length + ' ticked' : cands.length + ' to choose from');
  setT('om-d-pick', known
    ? 'Only some of it: tick what to buy or sell, from this month’s changes and the names that carry forward.' +
      ((nSz + nMv) ? ' ' + ((nSz + nMv) === 1 ? 'One order needs' : (nSz + nMv) + ' orders need') + ' your quantities first: Match my holdings.' : '')
    : 'Tick the names to buy now.');

  ['rebal', 'fresh', 'pick'].forEach(function (m) {
    var r = box.querySelector('input[name="omode"][value="' + m + '"]');
    if (r) r.checked = st.m === m;
    var o = $('om-o-' + m);
    if (o) o.classList.toggle('is-on', st.m === m);
  });
  var q = $('om-q');
  if (q) q.hidden = !!st.m;

  var pick = $('om-pick');
  if (pick) pick.hidden = st.m !== 'pick';
  if (st.m === 'pick'){
    var placed = loadBought(currentStrategy) || {};
    setT('om-pick-count', nTicked + ' of ' + cands.length + ' ticked');
    var ul = $('om-pick-list');
    if (ul) ul.innerHTML = cands.map(function (o) {
      var k = orderKey(o), on = !!pk[k], done = !!placed[k];
      var why = o.why === 'left' ? 'left the book' : o.why === 'joined' ? 'joined this month'
              : o.why === 'held' ? 'carries forward · the whole position'
              : o.why === 'rw' ? 're-weight, ' + o.from + ' → ' + o.to + ' shares' : 'in this month’s book';
      if (nseSeriesOf(o.ticker)) why += ' \u00b7 NSE ' + nseSeriesOf(o.ticker) + ' series';   // V43.9
      var meta = pl(o.qty, 'share', 'shares') + ' · ' + fmtMoney(Math.round(o.qty * (o.price || 0)));
      return '<li><label class="om-row' + (on ? '' : ' is-off') + '">' +
        '<input type="checkbox" data-okey="' + escapeHtml(k) + '"' + (on ? ' checked' : '') + ' onchange="omPickToggle(this)">' +
        '<span class="om-side ' + (o.side === 'SELL' ? 'is-sell' : 'is-buy') + '">' + (o.side === 'SELL' ? 'Sell' : 'Buy') + '</span>' +
        '<span class="om-t">' + escapeHtml(o.ticker) + '<small>' + escapeHtml(why + (done ? ' · placed' : '')) + '</small></span>' +
        '<span class="om-m">' + escapeHtml(meta) + '</span>' +
      '</label></li>';
    }).join('');
  }

  var note = $('om-note');
  if (note){
    var match = ' <button type="button" class="chg-hint-btn" onclick="_rwOpenMatch()">Match my holdings</button>';
    note.innerHTML =
      st.m === 'rebal' && known
        ? (d.prevQtyKnown === false
            ? 'Last month&rsquo;s quantities were sized at the starting amount, not one you entered, so ' +
              (nMv && !nSz ? 'the re-weights' : nMv ? 'the sales and re-weights' : 'the sales') + ' cannot be sized here;' + match + ' works them out from your broker&rsquo;s holdings file.'
            : 'Sales use last month&rsquo;s quantities at your capital. Holding a different number?' + match + ' works out exact orders from your broker&rsquo;s holdings file.')
      : st.m === 'fresh' && known
        ? 'Nothing is sold: this starts from an account that holds none of the book.'
      : st.m === 'pick'
        ? (nTicked ? 'Quantities are this month&rsquo;s sizes at your capital; your broker shows every order before it is placed, and you can change any quantity there.'
                   : 'Tick at least one stock to buy or sell; your orders follow.')
      : '';
  }
  box.hidden = false;
}
function abarGoToOrderMode(){
  var el = document.getElementById('omode');
  if (!el || el.hidden) return abarGoToPicks();
  var prev = document.documentElement.style.scrollBehavior;
  document.documentElement.style.scrollBehavior = 'auto';
  el.scrollIntoView({ block: 'start' });
  document.documentElement.style.scrollBehavior = prev;
}

/* ── V43.9 · KITE NAMES A TRADE-FOR-TRADE STOCK SYMBOL-BE ─────────────────────
   Found on the owner's live Zerodha account, 1 Nov 2026: four of SmallMicro's fifteen
   (STLTECH, SIGMAADV, HFCL, LOTUSDEV) showed LTP 0.00 on Kite's own basket screen. NSE
   had moved them to its BE (trade-for-trade) series, where Kite's instrument is
   STLTECH-BE; under the bare symbol Kite finds no NSE instrument to trade, so a quarter
   of that month's buys could not have filled. screener/market_data.py now writes, with
   every daily refresh, the symbols NSE traded only outside EQ (BE, BZ, SM, ST) from its
   bhavcopy; each basket row, Kite link and order line reads it. A file more than ten days
   old is not used: a name that moved back to EQ would then fail the other way round. */
window._nseSeries = null;
function loadNseSeries(){
  if (window._nseSeriesP) return window._nseSeriesP;
  window._nseSeriesP = fetch('screener/nse-series.json', { cache: 'no-cache' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) {
      if (!d || !d.series || !d.as_of) return null;
      var age = (Date.now() - new Date(d.as_of + 'T15:30:00+05:30').getTime()) / 864e5;
      if (!(age <= 10)) return null;
      window._nseSeries = d;
      // a list drawn before the file arrived re-draws once, if any name in it is affected
      try {
        if ((stocksData || []).some(function (x) { return nseSeriesOf(x.ticker); }) && document.querySelector('#stocks-tbody tr[data-row]')) applySort();
      } catch (e) {}
      try { refreshKiteBasket(); } catch (e) {}
      return d;
    })
    .catch(function () { return null; });
  return window._nseSeriesP;
}
function nseSeriesOf(t){
  var d = window._nseSeries;
  return (d && d.series && d.series[String(t || '').toUpperCase()]) || '';
}
function kiteSymbol(t){
  var T = String(t || '').toUpperCase(), sr = nseSeriesOf(T);
  return sr ? T + '-' + sr : T;
}
function srsTag(s){
  var sr = nseSeriesOf(s && s.ticker);
  if (!sr) return '';
  var T = String(s.ticker || '').toUpperCase();
  return '<span class="srs-tag" title="NSE ' + sr + ' series' + (sr === 'BE' || sr === 'BZ' ? ' (trade-for-trade)' : '') +
         ': Kite lists it as ' + escapeHtml(T + '-' + sr) + '">' + sr + '</span>';
}
/* One sentence for the band when anything it sends trades outside EQ. */
function _kbSeriesNote(plan){
  var names = [], codes = [];
  (plan.live || []).forEach(function (b) { b.open.forEach(function (o) {
    var sr = nseSeriesOf(o.ticker);
    if (sr && names.indexOf(o.ticker) < 0) { names.push(o.ticker); if (codes.indexOf(sr) < 0) codes.push(sr); }
  }); });
  if (!names.length) return '';
  var one = names.length === 1;
  var list = one ? names[0] : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
  var t2t = codes.some(function (c) { return c === 'BE' || c === 'BZ'; });
  return '<b>' + escapeHtml(list) + ' trade' + (one ? 's' : '') + ' in NSE&rsquo;s ' + escapeHtml(codes.join('/')) + ' series</b>' +
    (t2t ? ' (trade-for-trade: delivery only, each trade settled on its own)' : ' (the SME board)') +
    ', so ' + (one ? 'it goes' : 'they go') + ' to Kite as ' + escapeHtml(kiteSymbol(names[0])) + (one ? '' : ' and so on') +
    '. If Kite will not take a market order for ' + (one ? 'it' : 'one of them') + ', switch it to Limit there. ';
}

/* One order -> one Kite basket row. The only place that shape is written. */
function _kbRow(o){
  return {
    variety:          _kbAmoNow() ? 'amo' : 'regular',   // V44.0 — an AMO while NSE is shut
    exchange:         'NSE',
    tradingsymbol:    kiteSymbol(o.ticker),           // V43.9 — STLTECH-BE, not STLTECH
    transaction_type: o.side,
    order_type:       'MARKET',
    product:          'CNC',                          // delivery, not intraday
    quantity:         o.qty,
    readonly:         false,                          // the member stays in control
    tag:              'MFC'
  };
}

/* The whole cycle as baskets of at most KITE_BASKET_MAX. `open` is what a press
   would send now (sized and not yet ticked); `state` is what the band draws:
     placed — every order in it is ticked
     sent   — every open order in it has been opened on Kite from this device
     stale  — sent, but the capital changed since, so the quantities differ
     ready  — at least one open order has never been sent
     wait   — a buy basket, shut until the sales are done (V44.2)

   V44.2 — SALES FIRST, THEN BUYS, ALWAYS. The owner, 5 Nov 2026: "first sold and then
   bought, always so that we dont need to continuously deploy new cash."
   V35.4 put the sells at the front of the list, but the list was still cut every ten
   orders, so a six-out, six-in month sent six sales and four buys in basket 1, and those
   buys were placed before any sale had filled. Zerodha checks a buy against the cash in
   the account when it is placed ("Insufficient funds", support.zerodha.com), and a sale
   counts only once it has filled: an after-market sale, not before the next open. From
   then 100% of it can buy stocks the same day (same site, since 7 Oct 2024). So:
   · a basket is one side only, sale baskets first, buy baskets after;
   · a buy basket stays shut while any sale of the cycle is unticked, sized or not, and
     `waitFor` says what for: 'send' (a sale basket not opened on Kite yet), 'amo' (opened
     as AMOs, so nothing can have filled before `fillFrom`), or 'fill' (they may have
     filled, and "My sales have filled" ticks them);
   · sendKiteBasket() enforces it, so no button or bar can send a buy early. */
function kiteBasketPlan(){
  var orders = cycleOrders();
  var plan = { baskets: [], live: [], total: 0, openN: 0, buyVal: 0, sellVal: 0, next: null, unsized: 0,
               hasSell: false, hasBuy: false, both: false, sellsOpen: 0, sellUnsized: 0,
               buysWait: false, waitFor: '', fillFrom: null, fundIn: 0, fundOut: 0 };
  if (!orders.all.length || !(Number(currentCapital) > 0)) return plan;
  var placed = loadBought(currentStrategy) || {};
  var sent   = _kbSentLoad();
  var elig   = orders.all.filter(function (o) { return o.qty >= 1; });
  plan.unsized = orders.all.length - elig.length;
  var allSales = orders.all.filter(function (o) { return o.side === 'SELL'; });
  var buys     = elig.filter(function (o) { return o.side !== 'SELL'; });
  plan.hasSell = allSales.length > 0;
  plan.hasBuy  = buys.length > 0;
  plan.both    = plan.hasSell && plan.hasBuy;
  plan.sellUnsized = allSales.filter(function (o) { return !(o.qty >= 1); }).length;
  [elig.filter(function (o) { return o.side === 'SELL'; }), buys].forEach(function (side, si) {
    for (var i = 0; i < side.length; i += KITE_BASKET_MAX){
      var chunk = side.slice(i, i + KITE_BASKET_MAX);
      var b = { n: plan.baskets.length + 1, kind: si ? 'buy' : 'sell', orders: chunk, open: [], buyVal: 0, sellVal: 0,
                sentN: 0, staleN: 0, state: 'ready' };
      chunk.forEach(function (o) {
        var v = _kbValueOf(o);
        if (o.side === 'SELL') plan.fundIn += v; else plan.fundOut += v;
        if (placed[orderKey(o)]) return;
        b.open.push(o);
        if (o.side === 'SELL') b.sellVal += v; else b.buyVal += v;
        var rec = sent[orderKey(o)];
        if (rec) { b.sentN++; if (rec.q != null && Number(rec.q) !== o.qty) b.staleN++; }
      });
      if (!b.open.length) b.state = 'placed';
      else if (b.sentN === b.open.length) b.state = b.staleN ? 'stale' : 'sent';
      plan.openN   += b.open.length;
      plan.buyVal  += b.buyVal;
      plan.sellVal += b.sellVal;
      plan.baskets.push(b);
    }
  });
  // Baskets with nothing left to place drop out of the numbering the member sees:
  // "basket 2 of 2" must describe what is still to do, not history.
  plan.live  = plan.baskets.filter(function (b) { return b.open.length; });
  plan.live.forEach(function (b, k) { b.pos = k + 1; });
  plan.total = plan.live.length;
  var salesOpen = allSales.filter(function (o) { return !placed[orderKey(o)]; });
  plan.sellsOpen = salesOpen.length;
  plan.buysWait  = plan.sellsOpen > 0 && plan.live.some(function (b) { return b.kind === 'buy'; });
  if (plan.buysWait){
    plan.live.forEach(function (b) { if (b.kind === 'buy' && (b.state === 'ready' || b.state === 'stale')) b.state = 'wait'; });
    if (plan.live.some(function (b) { return b.kind === 'sell' && (b.state === 'ready' || b.state === 'stale'); })) plan.waitFor = 'send';
    else {
      var nowIst = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
      salesOpen.forEach(function (o) {
        var rec = sent[orderKey(o)];
        if (!rec || !rec.a) return;
        var open = _nseOpenAfter(Number(rec.t) || 0);
        if (nowIst < open && (!plan.fillFrom || open > plan.fillFrom)) plan.fillFrom = open;
      });
      plan.waitFor = plan.fillFrom ? 'amo' : 'fill';
    }
  }
  plan.next  = plan.live.filter(function (b) { return b.state === 'ready' || b.state === 'stale'; })[0] || null;
  return plan;
}
/* What an order is worth now. A sale's recorded price is last month's entry, so it
   takes the live price once there is one; a buy stays at the Shares column's price. */
function _kbValueOf(o){
  var q = (o.side === 'SELL' && o.y) ? (window._livePx || {})[o.y] : null;
  var p = (q && Number(q.price) > 0) ? Number(q.price) : (Number(o.price) || 0);
  return Math.round(o.qty * p);
}
/* The next 9:15 open after `ms`, as an IST wall-clock Date: when an AMO sent then can fill. */
function _nseOpenAfter(ms){
  var local = new Date(new Date(ms).toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  var day = new Date(local.getFullYear(), local.getMonth(), local.getDate(), 9, 15);
  var trading = function (x) { var g = x.getDay(); return g >= 1 && g <= 5 && !_nseHolidayOn(x); };
  if (!(trading(day) && local < day)) {
    var i = 0;
    do { day.setDate(day.getDate() + 1); } while (!trading(day) && ++i < 15);
  }
  return day;
}
/* The whole cycle's sale money against its buys, one line above the baskets. An unsized
   sale has no figure, so then the line says nothing rather than something short. */
/* V44.4: a buys-only month (month one, Buy all, a Pick of buys) brings in no sale money, and a buy is
   checked against the cash in the account when it is placed. Nothing said so, so a member's first evening
   could end in a rejected basket. Worded as an "about": the live price moves it. */
var _KB_FUNDS_HREF = '/learn/first-demat/#money';
function _kbNeedsCash(val){
  return '<b>About ' + escapeHtml(fmtMoney(val)) + ' has to be in your trading account first.</b> ' +
    'A buy is checked against your cash when it is placed. ' +
    '<a href="' + _KB_FUNDS_HREF + '" target="_blank" rel="noopener">How to add funds</a>';
}
function _kbFundLine(plan){
  if (!plan.both) return (plan.buyVal > 0 && !plan.hasSell) ? _kbNeedsCash(plan.buyVal) : '';
  if (plan.sellUnsized) return '';
  var gap = plan.fundIn - plan.fundOut;
  var sum = 'Before charges, the sales bring in about ' + escapeHtml(fmtMoney(plan.fundIn)) +
            ' and the buys take about ' + escapeHtml(fmtMoney(plan.fundOut));
  if (gap >= 0) return '<b>No new cash needed.</b> ' + sum +
    (gap > plan.fundOut * 0.01 ? '; about ' + escapeHtml(fmtMoney(gap)) + ' stays in your account.' : '.');
  return '<b>About ' + escapeHtml(fmtMoney(-gap)) + ' short.</b> ' + sum + '. Add the difference, or lower a quantity on Kite’s screen.';
}
/* Why the buys are shut, and what opens them. Empty when the cycle has one side only. */
function _kbOrderNote(plan){
  if (!plan.both) return '';
  if (!plan.buysWait)
    return plan.live.some(function (b) { return b.kind === 'buy'; }) ? '<b>Your sales are marked as filled,</b> so their money pays for these buys. ' : '';
  if (plan.waitFor === 'amo'){
    var local = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    var when = plan.fillFrom.toDateString() === local.toDateString() ? 'this morning' : _nseAmoWhen(local);
    return '<b>Your sales reach the exchange at 9:00 ' + escapeHtml(when) + '.</b> Come back once they have filled, after the 9:15 open, ' +
      'and the buys open here. A buy sent before then would need new cash in your account. ';
  }
  if (plan.waitFor === 'fill')
    return plan.sellUnsized
      ? '<b>Sell the ' + plan.sellUnsized + ' that left first.</b> <button type="button" class="chg-hint-btn" onclick="_rwOpenMatch()">Match my holdings</button> ' +
        'sizes them. Once they have filled, press My sales have filled and the buys open here; all of their money can pay for buys the same day. '
      : '<b>Have your sales filled?</b> Check Kite’s Orders screen, then press My sales have filled and the buys open here. All of their money can pay for buys the same day. ';
  return '<b>Sales first, then buys.</b> A buy needs the money in your account when it is placed, and a sale counts only once it has filled. ' +
    'From then, all of it can pay for buys the same day, so the sales go in their own basket and the buys open here once they have filled. ';
}
/* "My sales have filled": the same ticks the What changed card writes, all at once. */
function markSalesFilled(){
  var map = loadBought(currentStrategy) || {}, rwKeys = [];
  (cycleOrders().all || []).forEach(function (o) {
    if (!o || o.side !== 'SELL') return;
    var k = orderKey(o);
    if (o.rw) rwKeys.push(k);
    map[k] = true;
  });
  saveBought(currentStrategy, map);
  document.querySelectorAll('input[data-okey^="SELL:"]').forEach(function (cb) {
    cb.checked = true;
    var h = cb.closest('.chg-sell'); if (h) h.classList.add('is-done');
  });
  rwKeys.forEach(function (k) { _rwSyncTicks(k, true); });
  refreshBoughtProgress();
  showToast('Sales marked as filled. The buys are open');
  // the pressed button is gone: keep a keyboard user on the band's next action
  try {
    var nx = document.querySelector('#kbsk-list .kbsk-b-btn.is-primary') || document.getElementById('kbsk-btn');
    if (nx && !nx.hidden) nx.focus({ preventScroll: true });
  } catch (e) {}
}
/* V44.5: the bar is the biggest button on a phone, and it can send a first basket from a screen that does not
   show the funding line. Once per visit, for a first month with no ticks and the money not yet confirmed. */
function _fmAskFunds(){
  try {
    if (window._fmFundsAsked || !_fmNow()) return false;
    if (localStorage.getItem(_devKey('mfc_setup_funds')) === '1') return false;
    if (Object.keys(loadBought(currentStrategy) || {}).length) return false;
    window._fmFundsAsked = true;
    abarGoToBand();
    showToast('Is the money in your broker? A buy is checked against your cash.');
    return true;
  } catch (e) { return false; }
}
function abarGoToBand(){
  var el = document.getElementById('kbsk');
  if (!el || el.hidden) return abarGoToPicks();
  var prev = document.documentElement.style.scrollBehavior;
  document.documentElement.style.scrollBehavior = 'auto';
  el.scrollIntoView({ block: 'start' });
  document.documentElement.style.scrollBehavior = prev;
}

/* Every un-placed row that rounds to at least one share, in plan order. Kept for
   the callers that only need "is there anything to send" and the count. */
function kiteBasketRows() {
  var plan = kiteBasketPlan();
  var out = [];
  plan.live.forEach(function (b) { b.open.forEach(function (o) { out.push(_kbRow(o)); }); });
  return out;
}

/* ONE persistent hidden form, built on first use and reused. V34.2 created a
   throwaway form per click and removed it in `setTimeout(..., 0)`; the
   submission for a `_blank` target is queued rather than immediate, so detaching
   the form on the very next task is a race against the navigation it just
   started. Nothing depends on the element being fresh — only the two values do —
   so keeping one in the document removes the race entirely and is less work per
   click besides.

   Values are set through .value, never through innerHTML: one tradingsymbol on
   the LargeMidcap book is `M&M`, and the payload is JSON full of quotes. */
function kiteBasketForm() {
  var f = document.getElementById('kbsk-form');
  if (f) return f;
  f = document.createElement('form');
  f.id     = 'kbsk-form';
  f.method = 'post';
  f.action = KITE_BASKET_URL;
  f.target = '_blank';                     // keep the dashboard where it is
  f.rel    = 'noopener';
  f.style.display = 'none';
  var k = document.createElement('input');
  k.type = 'hidden'; k.name = 'api_key'; k.id = 'kbsk-key';
  var d = document.createElement('input');
  d.type = 'hidden'; d.name = 'data';    d.id = 'kbsk-data';
  f.appendChild(k); f.appendChild(d);
  document.body.appendChild(f);
  return f;
}
/* ── V40.3 · B1 · A SAMPLE NEVER OPENS A REAL ORDER SCREEN ───────────────────
   Both basket paths — sendKiteBasket() below and the Adjust planner's sendAdj()
   — submit through here. In ?demo the stocks are real NSE symbols at placeholder
   sizes (₹5.22L of them in ?demo=1), and the post went straight to Kite's basket
   screen: a prospect "trying the flow" met a Zerodha sign-in from a page
   labelled sample, and one already signed in to Kite met eight live orders.
   The sample now says what the real dashboard does and offers the free book.
   Returns true only when a basket was actually submitted, so the callers skip
   their "opened on Kite" bookkeeping and toast in the sample. */
function _kbSubmit(rows) {
  if (isDemo) { _demoKiteSheet(); return false; }
  var f = kiteBasketForm();
  document.getElementById('kbsk-key').value  = KITE_API_KEY;
  document.getElementById('kbsk-data').value = JSON.stringify(rows);
  f.submit();
  return true;
}
function _demoKiteSheet() {
  var sh = document.getElementById('demo-kite-sheet');
  if (!sh) {
    sh = document.createElement('div');
    sh.id = 'demo-kite-sheet';
    sh.className = 'dks';
    sh.hidden = true;
    sh.setAttribute('role', 'dialog');
    sh.setAttribute('aria-modal', 'true');
    sh.setAttribute('aria-labelledby', 'dks-h');
    sh.setAttribute('aria-describedby', 'dks-p');
    sh.innerHTML =
      '<div class="dks-panel">' +
        '<span class="dks-tag">Sample</span>' +
        '<h2 id="dks-h">In the sample, this is where Zerodha would open</h2>' +
        '<p id="dks-p">On your own dashboard, this button opens Zerodha’s basket with these orders and quantities filled in. ' +
          'You sign in to Zerodha there and confirm; nothing is placed until you do. ' +
          'These are placeholder stocks, so the sample stops here.</p>' +
        '<div class="dks-acts">' +
          '<a class="dks-go" href="/signup.html?strategy=multiasset">Start the free book (₹0) <span aria-hidden="true">→</span></a>' +
          '<button type="button" class="dks-x">Close</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(sh);
    sh.addEventListener('click', function(e){ if (e.target === sh) _demoKiteSheetClose(); });
    sh.querySelector('.dks-x').addEventListener('click', _demoKiteSheetClose);
    document.addEventListener('keydown', function(e){
      var s = document.getElementById('demo-kite-sheet');
      if (!s || s.hidden) return;
      if (e.key === 'Escape') { e.preventDefault(); _demoKiteSheetClose(); return; }
      if (e.key !== 'Tab') return;
      // Two controls; keep Tab inside the dialog while it is open.
      var f = [s.querySelector('.dks-go'), s.querySelector('.dks-x')];
      var i = f.indexOf(document.activeElement);
      if (e.shiftKey && i <= 0) { e.preventDefault(); f[1].focus(); }
      else if (!e.shiftKey && i === 1) { e.preventDefault(); f[0].focus(); }
      else if (i < 0) { e.preventDefault(); f[0].focus(); }
    });
  }
  sh._opener = document.activeElement;
  sh.hidden = false;
  document.documentElement.classList.add('dks-open');
  setTimeout(function(){ var g = sh.querySelector('.dks-go'); if (g) g.focus(); }, 30);
}
function _demoKiteSheetClose() {
  var sh = document.getElementById('demo-kite-sheet');
  if (!sh || sh.hidden) return;
  sh.hidden = true;
  document.documentElement.classList.remove('dks-open');
  try { if (sh._opener && sh._opener.focus) sh._opener.focus(); } catch (e) {}
}
/* Send basket `pos` (1-based, in the live numbering), or the next one that has
   not been opened yet. */
function sendKiteBasket(pos) {
  if (_mfOrdersPaused()) return;   // V44.3 — not from a copy the server has not confirmed
  // V39.3 — B4. Every send path ends here (the single button, each numbered
  // basket, the sticky bar), so this is the one place the rule has to live:
  // no basket goes to Kite sized to an amount the member never set.
  if (!isDemo && !window._capEntered) {
    abarEditCapital();
    showToast('Enter your amount first — every quantity is sized to it');
    return;
  }
  // V43.8 — and none before the member has said what to place this month.
  if (needsOrderChoice()) {
    abarGoToOrderMode();
    showToast('Choose what to place this month first');
    return;
  }
  var plan = kiteBasketPlan();
  var b = (pos != null) ? plan.live[pos - 1] : (plan.next || null);
  // V44.2 — sales first, then buys. Every send path ends here, so the rule lives here.
  if (plan.buysWait && (!b || b.kind === 'buy')) {
    abarGoToBand();
    showToast(plan.waitFor === 'send' ? 'Sales first: the buys use what they bring in' : 'The buys open once your sales have filled');
    return;
  }
  if (!b || !b.open.length) {
    showToast(plan.openN ? 'Every basket has been opened on Kite — tick what filled' : 'Nothing left to place');
    return;
  }
  var rows = b.open.slice(0, KITE_BASKET_MAX).map(_kbRow);   // <= 10 by construction
  if (!_kbSubmit(rows)) return;            // V40.3 — B1: the sample stops here
  _kbSentMark(b.open);
  var msg = 'Opening ' + rows.length + ' order' + (rows.length === 1 ? '' : 's') + ' on Kite';
  if (plan.total > 1) {
    var p2 = kiteBasketPlan(), after = p2.next;
    msg = p2.buysWait && !after
      ? 'Your sales are opening on Kite. Confirm them there; the buys open here once they fill'
      : 'Basket ' + b.pos + ' of ' + plan.total + ' opened on Kite' +
        (after ? ' — confirm it there, then send basket ' + after.pos : ' — all baskets sent');
  }
  showToast(msg);
  try { refreshKiteBasket(); } catch (e) {}
}

/* Show the button only where it can do something: Kite selected, capital
   entered, and at least one row still to place. Every other broker keeps the
   per-row deeplinks it has today — this basket screen is Kite's. */
/* ── V34.4 — COMING BACK FROM KITE ──────────────────────────────────────────
   V34.3 set the app's Redirect URL to this page, so Kite now returns the member
   here after the basket instead of stranding them on kite.zerodha.com. It
   appends its own query to that return — `?status=success&request_token=…` —
   and those were being left in the address bar. Two reasons to clear them:

   · This site's rule since V29.8 is that no credential-shaped value lives in a
     URL here, because a URL reaches the service-worker cache, the history entry
     and the Referer header. A request_token is single-use and worth nothing
     without the api_secret, which is not on this site at all — but the rule is
     about the shape, not the exploitability, and keeping it is cheaper than
     arguing the exception each time.
   · The session itself is unaffected either way: readDashToken() is
     cookie-primary, so a returning member resolves from the cookie and never
     needed the query at all. Verified — arriving at a bare /dashboard.html with
     the cookie set renders the real dashboard, not the "No Access Token" gate.

   The return is also the one moment worth acknowledging, because nothing else
   tells the member what just happened. `status=success` means the BASKET FLOW
   completed, NOT that anything filled — Kite reports no fill state here and this
   page has no way to know one — so the toast says exactly that and points at the
   tick-list, which remains the record of what was actually placed. */
function mfcHandleKiteReturn() {
  try {
    var q = new URLSearchParams(window.location.search);
    if (!q.has('status') && !q.has('request_token')) return;
    var status = q.get('status');
    q.delete('status'); q.delete('request_token'); q.delete('action');
    var qs = q.toString();
    window.history.replaceState(null, '',
      window.location.pathname + (qs ? '?' + qs : '') + window.location.hash);
    if (status === 'success') {
      showToast('Back from Kite — tick off the orders you placed');
    }
  } catch (e) {}
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mfcHandleKiteReturn);
} else {
  mfcHandleKiteReturn();
}

/* V39.5 — B7. THE ORDER SHEET, FOR A BROKER WITHOUT BASKETS.
   The same kiteBasketPlan() order the Kite band sends (sells first, V35.4), as a
   numbered list: one ticket per line, a Copy per line, and a tick bound to the SAME
   map the picks table and the change card write — so the progress bar, the hero line
   and the sticky bar move together whichever surface the member ticks on. */
/* V44.5: a broker with a working link gets that link on each line; one without gets Copy. */
function _osRowControl(o, line){
  var b = BROKERS[getBroker()] || {};
  var url = (!b.copy && b.link) ? b.link(o) : '';
  if (!url) return '<button type="button" class="broker-link broker-copy os-copy" data-copy="' + escapeHtml(line) + '" onclick="copyOrderLine(this)" aria-label="Copy ' + escapeHtml(line) + '">Copy</button>';
  return '<a class="broker-link os-copy" target="_blank" rel="noopener noreferrer" href="' + url.replace(/"/g, '&quot;') + '" ' +
    'aria-label="Open ' + escapeHtml(o.ticker) + ' on ' + escapeHtml(b.name) + '" ' +
    'style="background:' + b.color + '14;border-color:' + b.color + '33;--bk-ink:' + (b.ink || b.color) + ';--bk-ink-d:' + (b.inkDark || b.ink || b.color) + ';">' +
    escapeHtml(b.name) + ' \u2192</a>';
}
function renderOrderSheet(){
  var sh = document.getElementById('osheet');
  if (!sh) return;
  try {
    if ((BROKERS[getBroker()] || {}).sheet !== true) { sh.hidden = true; return; }
    if (needsOrderChoice()) { sh.hidden = true; return; }   // V43.8 — the sheet waits for the answer
    var oc = cycleOrders(), placed = loadBought(currentStrategy) || {};
    var rows = oc.all.filter(function(o){ return o.qty >= 1; });
    if (!rows.length) { sh.hidden = true; return; }
    var left = rows.filter(function(o){ return !placed[orderKey(o)]; }).length;
    var facts = document.getElementById('osheet-facts');
    if (facts) facts.textContent = left ? (left + ' of ' + rows.length + ' left \u00b7 one ticket per line, in this order')
                                        : ('All ' + rows.length + ' placed \u2014 done for this cycle');
    var list = document.getElementById('osheet-list');
    // V44.2 — both sides in the list: each under its own heading, the sales first
    var osBoth = rows.some(function(o){ return o.side === 'SELL'; }) && rows.some(function(o){ return o.side !== 'SELL'; });
    if (list) list.innerHTML = rows.map(function(o, i){
      var k = orderKey(o), done = !!placed[k];
      var line = o.ticker + ' ' + o.qty;
      var gk = !osBoth ? ''
             : i === 0 ? '<li class="os-gk">Sell first</li>'
             : (rows[i - 1].side === 'SELL' && o.side !== 'SELL') ? '<li class="os-gk">Then buy, once the sales have filled</li>' : '';
      return gk + '<li class="os-row' + (done ? ' is-done' : '') + '">' +
        '<span class="os-n">' + (i + 1) + '</span>' +
        '<span class="os-side ' + (o.side === 'SELL' ? 'is-sell' : 'is-buy') + '">' + o.side + '</span>' +
        '<span class="os-t">' + escapeHtml(o.ticker) + srsTag(o) + '</span>' +
        '<span class="os-meta">' + o.qty + ' share' + (o.qty === 1 ? '' : 's') + ' \u00b7 ~' + escapeHtml(fmtMoney(Math.round(o.qty * (o.price || 0)))) + '</span>' +
        _osRowControl(o, line) +
        '<label class="os-tick"><input type="checkbox" data-okey="' + escapeHtml(k) + '"' + (done ? ' checked' : '') +
          ' onchange="toggleSheetOrder(this)" aria-label="' + escapeHtml(o.side === 'SELL' ? 'Sold' : 'Bought') + ': ' + escapeHtml(line) + '"><span>Placed</span></label>' +
        '</li>';
    }).join('');
    var hb = (oc.holdBack || []).length;
    var note = document.getElementById('osheet-note');
    if (note) note.innerHTML = 'On your broker&rsquo;s own order screen: NSE, delivery (CNC), market or a limit near the price shown. ' +
      (osBoth ? 'Sell first, and place the buys once the sales have filled: a buy needs the money in your account when it is placed, so this way the sales pay for it instead of new cash. ' +
                'How much of a sale you can use the same day depends on your broker.'
              : (function () {   // V44.4: a buys-only list, the same sentence as the Kite band
                  var open = rows.filter(function(o){ return o.side !== 'SELL' && !placed[orderKey(o)]; });
                  var v = open.reduce(function(s, o){ return s + o.qty * (o.price || 0); }, 0);
                  return open.length === rows.filter(function(o){ return !placed[orderKey(o)]; }).length && v > 0 ? _kbNeedsCash(Math.round(v)) + ' ' : '';
                })()) +
      (hb ? ' <b>' + hb + '</b> sale' + (hb === 1 ? ' is' : 's are') + ' held back by your holding period and ' + (hb === 1 ? 'is' : 'are') + ' not on this sheet.' : '') +
      ' <button type="button" class="kb-capbtn" onclick="copyOrderSheet()">Copy the whole list</button>' +
      (_fmNow() ? ' <a href="/learn/first-orders/" target="_blank" rel="noopener">First time? What you will see</a>' : '');
    sh.hidden = false;
  } catch (e) { sh.hidden = true; }
}
function toggleSheetOrder(cb){
  var key = cb.getAttribute('data-okey'); if (!key) return;
  var map = loadBought(currentStrategy);
  // a BUY key is the bare ticker, and records {p,q,t} exactly as the table's tick does;
  // a sale and a re-weight (V41.9) record `true`, the convention the sell rows use
  if (cb.checked) map[key] = (key.indexOf('SELL:') === 0 || key.indexOf('RW:') === 0) ? true : boughtValueFor(key, map[key]);
  else delete map[key];
  saveBought(currentStrategy, map);
  document.querySelectorAll('[data-ticker="' + key.replace(/"/g, '\\"') + '"] .bought-cb, input[data-okey="' + key.replace(/"/g, '\\"') + '"]').forEach(function(x){ if (x !== cb) x.checked = cb.checked; });
  document.querySelectorAll('[data-ticker="' + key.replace(/"/g, '\\"') + '"]').forEach(function(el){ el.classList.toggle('row-bought', cb.checked); });
  _rwSyncTicks(key, cb.checked);
  refreshBoughtProgress();
}
function copyOrderSheet(){
  if (_mfOrdersPaused()) return;   // V44.3
  var oc = cycleOrders(), placed = loadBought(currentStrategy) || {};
  var rows = oc.all.filter(function(o){ return o.qty >= 1 && !placed[orderKey(o)]; });
  if (!rows.length) { showToast('Nothing left to place'); return; }
  var w = rows.reduce(function(m, o){ return Math.max(m, o.ticker.length); }, 6);
  var txt = rows.map(function(o){ return (o.side === 'BUY' ? 'BUY  ' : 'SELL ') + o.ticker + new Array(Math.max(1, w - o.ticker.length + 2)).join(' ') + o.qty; }).join('\n');
  copyText(txt).then(function(){ showToast('Copied ' + rows.length + ' order' + (rows.length === 1 ? '' : 's')); });
}
function abarGoToSheet(){
  var el = document.getElementById('osheet');
  if (!el || el.hidden) return abarGoToPicks();
  var prev = document.documentElement.style.scrollBehavior;
  document.documentElement.style.scrollBehavior = 'auto';
  el.scrollIntoView({ block:'start' });
  document.documentElement.style.scrollBehavior = prev;
}

function refreshKiteBasket() {
  try { renderOrderMode(); } catch (e) {}    // V43.8 — what to place this month (every broker)
  try { renderOrderSheet(); } catch (e) {}   // V39.5 — B7: the other brokers' step 3
  try {
    var wrap = document.getElementById('kbsk');
    if (!wrap) return;
    if (getBroker() !== 'kite') { wrap.hidden = true; return; }
    if (needsOrderChoice()) { wrap.hidden = true; return; }   // V43.8 — nothing is sent before the answer
    var plan = kiteBasketPlan();
    if (!plan.openN) { wrap.hidden = true; return; }

    var label = document.getElementById('kbsk-label');
    var note  = document.getElementById('kbsk-note');
    var facts = document.getElementById('kbsk-facts');
    var list  = document.getElementById('kbsk-list');
    var btn   = document.getElementById('kbsk-btn');
    var eyebrow = wrap.querySelector('.kbsk-eyebrow');
    var multi = plan.total > 1 || plan.buysWait;   // V44.2 — a shut buy basket is drawn in the list

    /* V44.2 — what the sales bring in against what the buys take. */
    var fund = document.getElementById('kbsk-fund');
    if (fund) {
      var fundHtml = _kbFundLine(plan);
      fund.innerHTML = fundHtml;
      fund.hidden = !fundHtml;
      fund.classList.toggle('is-short', plan.both && plan.fundIn < plan.fundOut);
    }

    /* The facts describe the WHOLE cycle — every open order and every rupee of
       it — in both modes. V35.3 split buys from sells (money going out and
       money coming back are not one figure); V37.5 stops the fact row counting
       only the first basket, which is how a ₹15L book came to be introduced as
       "10 orders · ₹9,91,xxx". */
    if (facts) {
      var money = [];
      if (plan.sellVal > 0) money.push('<span class="kbsk-fact">' + escapeHtml(fmtMoney(plan.sellVal)) + '<span>to sell</span></span>');
      if (plan.buyVal  > 0) money.push('<span class="kbsk-fact">' + escapeHtml(fmtMoney(plan.buyVal))  + '<span>to buy</span></span>');
      facts.innerHTML =
        '<span class="kbsk-fact">' + plan.openN + '<span>order' + (plan.openN === 1 ? '' : 's') + '</span></span>' +
        (money.length ? '<i class="kbsk-dot"></i>' + money.join('<i class="kbsk-dot"></i>') : '') +
        (multi ? '<i class="kbsk-dot"></i><span class="kbsk-fact">' + plan.total + '<span>Kite baskets</span></span>' : '') +
        '<i class="kbsk-dot"></i>' +
        '<span class="kbsk-fact">NSE<span>delivery · CNC</span></span>';
    }
    if (eyebrow) eyebrow.textContent = plan.buysWait ? 'Step 3: sell first, then buy'
      : (plan.both && plan.live[0].kind === 'buy') ? 'Step 3: now the buys'
      : multi ? 'Step 3, in ' + plan.total + ' taps' : 'Step 3, in one tap';

    if (!multi) {
      /* ONE BASKET — the V34.2–V35.5 band, unchanged in shape: the total in the
         button, the facts above it. It still reads the plan, so a re-send after
         a return from Kite is marked as such rather than looking brand new. */
      var b = plan.live[0];
      if (list) { list.hidden = true; list.innerHTML = ''; }
      if (btn) btn.hidden = false;
      if (label) {
        var tot = b.buyVal + b.sellVal;
        label.textContent = (b.state === 'sent' ? 'Send again · ' : 'Review ' + b.open.length + ' order' + (b.open.length === 1 ? '' : 's') + ' · ') +
          (tot > 0 ? preciseMoney(tot) : '') + ' on Kite';   // V39.6 — "Kite" alone on the second line at 360
      }
      if (btn) btn.onclick = function () { sendKiteBasket(1); };
      if (label && !isDemo && !window._capEntered) {       // V39.3 — B4
        label.textContent = 'Sized for ' + shortMoney(currentCapital) + ' — enter your amount';
        if (btn) btn.onclick = abarEditCapital;
      }
      if (note) {
        note.innerHTML = _kbCapNote() + _kbHoursNote() + _kbSeriesNote(plan) + _kbOrderNote(plan) +
          (b.state === 'sent'
            ? '<b>Opened on Kite from this device.</b> Tick each order once it fills; send again only if you closed Kite without confirming. '
            : b.state === 'stale'
              ? '<b>Your capital changed after this basket was sent</b>, so the quantities are different now — check what you confirmed on Kite before sending again. '
              : '') +
          'Opens Zerodha’s own order screen with the quantities pre-filled. ' +
          'You sign in there and confirm; nothing is placed until you do, and you can ' +
          'change quantity, order type or price on that screen first.' +
          _sellAuthInline(b.sellVal > 0);   // V43.1 — A1
      }
    } else {
      /* SEVERAL BASKETS — the list IS the action. One row per basket with its
         own count, value and state, and exactly one primary button: the next
         basket not yet opened. A separate primary CTA above the list would be a
         second control doing the same thing, so it steps aside. */
      if (btn) btn.hidden = true;
      if (list) {
        var nextPos = plan.next ? plan.next.pos : 0;
        var capWanted = !isDemo && !window._capEntered;      // V39.3 — B4
        var waiting = plan.live.filter(function (b) { return b.state === 'wait'; });
        list.innerHTML = plan.live.map(function (b) {
          var tot = b.buyVal + b.sellVal;
          var isWait = b.state === 'wait';
          // V44.2 — once the sales may have filled, the first shut basket carries the one action left
          var canFill = isWait && !capWanted && plan.waitFor === 'fill' && b === waiting[0];
          var isNext = b.pos === nextPos || canFill;
          var sideTag = plan.hasSell ? '<span class="om-side ' + (b.kind === 'sell' ? 'is-sell">Sell' : 'is-buy">Buy') + '</span>' : '';
          var names = b.open.map(function (o) { return o.ticker; });
          var stateHtml =
            b.state === 'sent'  ? '<span class="kbsk-b-state is-sent">Opened on Kite</span>' :
            b.state === 'stale' ? '<span class="kbsk-b-state is-stale">Capital changed since sent</span>' :
            isWait              ? '<span class="kbsk-b-state is-wait">After the sales</span>' :
            isNext              ? '<span class="kbsk-b-state is-next">Next</span>' : '';
          var btnLabel = capWanted ? 'Enter your amount'
                       : (b.state === 'sent' || b.state === 'stale') ? 'Send again' : 'Review on Kite';
          var btn = canFill
            ? '<button type="button" class="kbsk-b-btn is-primary" onclick="markSalesFilled()">My sales have filled</button>'
            : (isWait && !capWanted) ? ''
            : '<button type="button" class="kbsk-b-btn' + (isNext ? ' is-primary' : '') + '" ' +
                'onclick="sendKiteBasket(' + b.pos + ')" ' +
                'aria-label="' + escapeHtml(btnLabel + ': ' + (sideTag ? (b.kind === 'sell' ? 'sale ' : 'buy ') : '') + 'basket ' + b.pos + ' of ' + plan.total + ', ' +
                  b.open.length + ' order' + (b.open.length === 1 ? '' : 's') + ', ' + fmtMoney(tot)) + '">' +
                escapeHtml(btnLabel) + '</button>';
          return '<li class="kbsk-b' + (isNext ? ' is-next' : '') + ' is-' + b.state + '">' +
                   '<span class="kbsk-b-n" aria-hidden="true">' + b.pos + '</span>' +
                   '<span class="kbsk-b-main">' +
                     '<span class="kbsk-b-head">' + sideTag + 'Basket ' + b.pos + ' of ' + plan.total + stateHtml + '</span>' +
                     '<span class="kbsk-b-sub"><b>' + b.open.length + '</b> order' + (b.open.length === 1 ? '' : 's') +
                       ' · <b>' + escapeHtml(fmtMoney(tot)) + '</b></span>' +
                     '<span class="kbsk-b-names" title="' + escapeHtml(names.join(', ')) + '">' + escapeHtml(names.join('\u00a0· ')) + '</span>' +
                   '</span>' + btn +
                 '</li>';
        }).join('');
        list.hidden = false;
      }
      if (note) {
        var overTen = plan.live.filter(function (b) { return b.kind === 'sell'; }).length > 1 ||
                      plan.live.filter(function (b) { return b.kind === 'buy'; }).length > 1;
        note.innerHTML = (_fmNow() && !plan.both) ? _kbFirstNote(plan) : _kbCapNote() + (plan.waitFor === 'amo' ? '' : _kbHoursNote()) + _kbSeriesNote(plan) + _kbOrderNote(plan) +
          (overTen ? '<b>Kite accepts ten orders per basket, so this cycle’s ' + plan.openN + ' go in ' + plan.total + '.</b> ' : '') +
          (plan.buysWait && !plan.next ? ''
           : plan.next
            ? 'Send basket ' + plan.next.pos + ', confirm it on Kite, then come back for ' +
              (plan.next.pos < plan.total ? 'the next one. ' : 'any you closed without confirming. ')
            : 'Every basket has been opened on Kite from this device — tick each order once it fills. ') +
          'Each basket opens Zerodha’s own order screen with the quantities pre-filled; nothing is placed until you confirm there, ' +
          'and you can change quantity, order type or price first.' +
          _sellAuthInline(plan.sellVal > 0);   // V43.1 — A1
      }
    }
    wrap.hidden = false;
  } catch (e) {
  } finally {
    /* V35.5 — ONE sync point. The sticky bar mirrors this band, so it refreshes
       on the same event rather than keeping its own set of hooks: every path
       that can change the basket (capital, a tick, a broker switch, a
       re-render) already ends here, and two lists of call sites is how two
       surfaces drift apart.
       In `finally`, and that is the whole point. This function RETURNS EARLY
       from inside the try whenever there is nothing to basket — a broker other
       than Kite, or every order already ticked — and a plain call after the
       try/catch is skipped by that return. Which is precisely the state the bar
       most needs to hear about: it was left showing "Review 4 on Kite · ₹3.97L"
       after the member had switched to Groww and after they had ticked
       everything off. */
    refreshActionBar();
    try { if (window.mfcV431Refresh) window.mfcV431Refresh(); } catch (e) {}   // V43.1 — B1 amount, B2 fold
  }
}

function refreshHowto() {
  try {
    var steps = document.querySelectorAll('.howto-step[data-hs]');
    if (!steps.length) return;

    // V35.3 — the step counts THIS CYCLE's orders, the same list the progress bar,
    // the basket and the CSV read. `total` was the book size, which for a
    // returning member counts eight holdings that need no order and omits the
    // sells entirely.
    var orders  = cycleOrders();
    var map     = orders.all.length ? loadBought(currentStrategy) : {};
    var total   = orders.all.length;
    var placed  = orders.all.filter(function(o){ return !!map[orderKey(o)]; }).length;
    var left    = Math.max(0, total - placed);
    var capital = Number(currentCapital) || 0;
    var nSell   = orders.sells.length;

    // the rupees still to deploy — summed from the SAME rounded per-row amounts
    // the Allocation column prints, for the reason refreshSizeSummary records.
    // Buys only: a sell returns money rather than deploying it, and netting the
    // two into one figure would make "still to deploy" mean neither.
    var toDeploy = 0;
    // V41.9 — A1: a re-weight's add puts money into a position, like a buy
    orders.buys.concat(orders.adds || []).forEach(function(o){
      if (map[orderKey(o)]) return;
      if (!(o.price > 0)) return;
      toDeploy += Math.round(o.qty * o.price);
    });

    var perStockEl = document.getElementById('size-per-stock');
    var perStock   = perStockEl ? String(perStockEl.textContent || '').trim() : '';
    var brokerName = (BROKERS[getBroker()] || {}).name || '';

    var days = null, rebLabel = '';
    try {
      var now = new Date(), nx = nextRebalanceDate(now);
      days = Math.max(0, daysBetween(now, nx));
      rebLabel = mfDate(nx, { day: 'numeric', month: 'short' });
    } catch (e) {}

    // which step is the member actually on
    var now3 = total > 0 && left > 0;
    var lines = {
      1: capital > 0
           // V42.1 — B6: "entered" only for an amount the member typed
           ? '<b>' + fmtMoney(capital) + '</b>' + (window._capEntered ? ' entered' : ', the starting amount, not one you entered') +
             (perStock && perStock !== '—' ? '<span class="hs-sep">·</span>' + perStock + ' per stock' : '')
           : '',
      2: (brokerName && total)
           ? '<b>' + escapeHtml(brokerName) + '</b> selected' +
             '<span class="hs-sep">·</span>' + total + ' order' + (total === 1 ? '' : 's') + ' ready to place'
           : '',
      3: total
           ? '<b>' + placed + ' of ' + total + '</b> placed' +
             (left ? '<span class="hs-sep">·</span>' + fmtMoney(toDeploy) +
                     // V44.2 — while sales are open, this money is theirs: it is not new cash to find
                     (orders.all.some(function(o){ return o.side === 'SELL' && !map[orderKey(o)]; }) ? ' to buy after the sales' : ' still to deploy')
                   : '<span class="hs-sep">·</span>cycle complete')
           : '',
      4: (days !== null && rebLabel)
           ? '<b>' + days + ' day' + (days === 1 ? '' : 's') + '</b> to the ' + rebLabel + ' rebalance'
           : ''
    };
    var done = { 1: capital > 0, 2: !!(brokerName && total), 3: total > 0 && left === 0, 4: false };
    var nowStep = capital <= 0 ? 1 : (now3 ? 3 : (total ? 4 : 0));
    _setHowToStep3(orders);

    steps.forEach(function(step){
      var i = Number(step.getAttribute('data-hs'));
      var el = step.querySelector('.hs-live');
      if (el) {
        if (lines[i]) { el.innerHTML = lines[i]; el.hidden = false; }
        else { el.innerHTML = ''; el.hidden = true; }
      }
      step.classList.toggle('is-now', i === nowStep);
      step.classList.toggle('is-done', !!done[i] && i !== nowStep);
    });

    // V31.3 — the rail, from the SAME `done` and `nowStep` this function just
    // used for the cards. A connector belongs to the step before it.
    var rail = document.getElementById('hs-rail');
    if (rail) {
      var isDone = function (i) { return !!done[i] && i !== nowStep; };
      for (var n = 1; n <= 4; n++) {
        var node = rail.querySelector('.hs-node[data-node="' + n + '"]');
        if (!node) continue;
        node.classList.toggle('is-done', isDone(n));
        node.classList.toggle('is-now', n === nowStep);
      }
      // grow from zero on the first paint so the transition is real, then set
      // directly on later refreshes (a capital edit must not re-animate)
      var first = !rail.dataset.painted;
      for (var k = 1; k <= 3; k++) {
        var link = rail.querySelector('.hs-link[data-link="' + k + '"]');
        if (link) link.classList.toggle('is-done', isDone(k));
      }
      if (first) {
        rail.dataset.painted = '1';
        rail.querySelectorAll('.hs-link').forEach(function (l) {
          var want = l.classList.contains('is-done');
          l.classList.remove('is-done');
          if (want) setTimeout(function () { l.classList.add('is-done'); }, 60);
        });
      }
      var cnt = document.getElementById('hs-rail-count');
      if (cnt) cnt.textContent = nowStep ? ('Step ' + nowStep + ' of 4') : '';
    }

    /* V40.3 — C6. THE FOUR STEPS ARE A FIRST-MONTH LESSON, NOT A MONTHLY CHORE.
       1.65 phone screens of the same four steps sat open on every visit, for
       members who had already done them. A member who ticked orders in the
       previous cycle (the prevKey tick map this page already keeps — server-backed
       since V36.6, so it holds across devices) has done the routine; for them the
       card closes to its title and progress rail. The one-tap Kite band
       (#kbsk) lives outside .howto-grid and stays. First month and every sample:
       open. Nothing is stored — the state is read afresh on each render. */
    var hcard = document.querySelector('.howto-card');
    if (hcard) {
      var returning = false;
      try {
        var bd = window._bookDiff;
        if (!isDemo && bd && bd.known && bd.prevKey) {
          var pk = 'mfc_bought_' + (currentStrategy || 'default').replace(/[^a-z0-9]+/gi, '_') + '__' +
                   String(bd.prevKey).replace(/[^a-z0-9]+/gi, '_');
          var pm = JSON.parse(localStorage.getItem(pk) || '{}');
          returning = !!pm && Object.keys(pm).length > 0;
        } else if (isDemo && window.SAMPLE_CALM !== false && bd && bd.known && bd.prevKey) {
          returning = true;                                 // V43.3 — B5: the sample opens like a second month
        }
      } catch (e) { returning = false; }
      hcard.classList.toggle('is-collapsed', (returning || _fmNow()) && !hcard._hsOpen);   // V44.5: a first month too
      var hb = document.getElementById('hs-show');
      if (hb) hb.setAttribute('aria-expanded', hcard.classList.contains('is-collapsed') ? 'false' : 'true');
    }
  } catch (e) {}
}
function hsShowSteps() {
  var hcard = document.querySelector('.howto-card');
  if (!hcard) return;
  hcard._hsOpen = true;
  hcard.classList.remove('is-collapsed');
  var hb = document.getElementById('hs-show'); if (hb) hb.setAttribute('aria-expanded', 'true');
  var first = hcard.querySelector('.howto-step');
  if (first) { first.setAttribute('tabindex', '-1'); try { first.focus({ preventScroll: true }); } catch (e) {} }
}

// V28.6 — the book that exists WHILE you are placing orders.
// Every diversification panel on this page (sector allocation, portfolio map,
// industry chips) draws the finished 25-name book. None of them describe what a
// member actually holds after six of twenty-five orders — which, because the
// table's default sort groups an industry together, can be the whole of one
// sector. This measures the live book from the same numbers the table's own
// Shares column uses, and compares its worst industry to the model's own ceiling
// (derived from the full book, never hardcoded at 12%).
//
// Deliberately partial-only: nothing placed = no book to describe, everything
// placed = the finished panels above already say it. Fails silent like its
// siblings — a mid-session read must never be able to break the picks table.
function refreshSession(map) {
  try {
    const box = document.getElementById('sess');
    if (!box) return;
    const hide = () => { box.style.display = 'none'; };
    const list = stocksData || [];
    if (!list.length || !(currentCapital > 0)) return hide();
    map = map || loadBought(currentStrategy);

    // Value each pick exactly as the table does: whole shares at rec. price.
    let plannedTotal = 0, placedTotal = 0, placedN = 0, plannedN = 0;
    const byInd = {}, fullByInd = {};
    list.forEach(s => {
      const price = Number(s.recommended_price) || 0;
      if (!(price > 0)) return;
      const shares = Math.floor(allocBudget(s, list, currentCapital) / price);
      if (shares < 1) return;                       // not buyable — a coverage finding
      // Round per pick exactly as refreshSizeSummary does — summing raw floats and
      // rounding once gives ₹14,69,549 against the sizing card's ₹14,69,552 on the
      // demo book, and two rupee totals three inches apart must not disagree.
      const amt = Math.round(shares * price);
      // V30.3: the same grouping key the chips, the allocation card and the KPI
      // ribbon use. Grouping by raw `industry` made this panel vacuous on the
      // MultiAsset book — every holding's industry is "ETF", so it reported
      // "100% ETF at its heaviest, across 1 of 1 industries — close to the
      // finished model's 100.0% ceiling", which is true of any single-industry
      // book at any stage and tells the member nothing. By asset class it says
      // the thing the panel exists to say: what the half-placed book is actually
      // concentrated in right now.
      const ind = groupKeyOf(s) || '—';
      plannedTotal += amt; plannedN++;
      fullByInd[ind] = (fullByInd[ind] || 0) + amt;
      /* V35.4 — a CARRIED-OVER holding is in the book already. This card reads the
         tick map to decide what the member is holding right now, and a held name
         has no order to tick, so every one of them counted as "not yet placed".
         The result was the opposite of what the card exists to say: a returning
         member who had correctly placed both of this cycle's buys — a complete,
         diversified book — was told "the book you actually hold is 50% Pharma,
         across 2 of 7 industries … placing the remaining 8 orders brings it back".
         Eight orders that would have doubled their book, from the panel whose job
         is to warn about concentration. */
      if (isHeldRow(s.ticker) || map[s.ticker]) { placedTotal += amt; placedN++; byInd[ind] = (byInd[ind] || 0) + amt; }
    });
    // strictly partial, and there has to be something to draw
    if (!(placedN > 0 && placedN < plannedN) || !(placedTotal > 0) || !(plannedTotal > 0)) return hide();

    // The model's own ceiling: the heaviest industry in the FINISHED book.
    const capPct = Math.max.apply(null, Object.keys(fullByInd)
      .map(k => fullByInd[k] / plannedTotal * 100));

    const inds = Object.keys(byInd)
      .map(k => ({ nm: k, pct: byInd[k] / placedTotal * 100 }))
      .sort((a, b) => b.pct - a.pct);
    const top = inds[0], nFull = Object.keys(fullByInd).length;
    // Materiality, not arithmetic. A part-placed book is over the finished cap almost
    // by definition — eight equal-weight picks in eight different industries are 12.5%
    // each against a 12.1% ceiling, which is not a risk and reporting it as one is how
    // a panel teaches members to ignore it. Amber only at half again the cap; below
    // that the panel says the same numbers in the neutral ink.
    const hot = top.pct > capPct * 1.5;
    // Every bar is drawn against the same axis: the widest of (worst industry, cap),
    // so the dashed cap line sits in a comparable place on every row.
    const axis = Math.max(top.pct, capPct) * 1.06;

    document.getElementById('sess-fill').style.width =
      (placedTotal / plannedTotal * 100).toFixed(1) + '%';
    document.getElementById('sess-lead').innerHTML =
      'Placed so far: <b>' + fmtMoney(placedTotal) + '</b> of <b>' + fmtMoney(plannedTotal) + '</b>';
    // V30.3: the axis noun follows the grouping key, so an asset-class book is not
    // told about "industries" it does not have.
    const axisWord  = isAssetClassBook(list) ? 'asset class'  : 'industry';
    const axisWords = isAssetClassBook(list) ? 'asset classes' : 'industries';
    document.getElementById('sess-chip').textContent = top.pct.toFixed(0) + '% top ' + axisWord;
    box.classList.toggle('is-clean', !hot);

    const SHOWN = 6;
    document.getElementById('sess-bars').innerHTML = inds.slice(0, SHOWN).map(i => {
      const isOver = i.pct > capPct + 0.05;
      return '<div class="sess-b' + (isOver ? ' is-over' : '') + '">' +
               '<span class="sess-b-nm">' + escapeHtml(i.nm) + '</span>' +
               '<span class="sess-b-tr"><span class="sess-b-fl" data-w="' +
                 Math.min(100, i.pct / axis * 100).toFixed(1) + '%"></span>' +
                 '<span class="sess-b-cap" style="left:' +
                 Math.min(100, capPct / axis * 100).toFixed(1) + '%"></span></span>' +
               '<span class="sess-b-v">' + i.pct.toFixed(0) + '%</span>' +
             '</div>';
    }).join('');
    // grow from zero on the next frame — the site's bar idiom; a bar painted at its
    // final width has a dead transition and never animates again on re-render.
    requestAnimationFrame(() => {
      document.querySelectorAll('#sess-bars .sess-b-fl').forEach(el => { el.style.width = el.dataset.w; });
    });
    setTimeout(() => {
      document.querySelectorAll('#sess-bars .sess-b-fl').forEach(el => { el.style.width = el.dataset.w; });
    }, 120);

    /* V37.6 — `left` counts model picks not yet in the book, i.e. BUYS. It was
       worded "orders", one card below a progress bar that counts the cycle's
       sells as well — "3 to go" over "1 order still to place" on the same screen. */
    const left = plannedN - placedN;
    const leftWord = left === 1 ? ' buy order' : ' buy orders';
    const more = inds.length > SHOWN ? ' (showing the top ' + SHOWN + ' of ' + inds.length + ')' : '';
    const spread = '<b>' + inds.length + '</b> of <b>' + nFull + '</b> ' + axisWords;
    // V39.5 — with restricted names out, the finished book is the member's, not the model's.
    const _rsBook = (stocksData || []).length > list.filter(s => !_isRestricted(s.ticker)).length;
    const _finished = _rsBook ? 'your finished book (the model less your restricted names) peaks in any one '
                              : 'the finished model caps any one ';
    document.getElementById('sess-note').innerHTML = hot
      ? ('Right now the book you actually hold is <b>' + top.pct.toFixed(0) + '%</b> ' + escapeHtml(top.nm) +
         ', across ' + spread + ' &mdash; ' + _finished + axisWord + ' at <b>' + capPct.toFixed(1) +
         '%</b> (dashed line)' + more + '. Placing the remaining <b>' + left + '</b>' + leftWord +
         ' brings it back; spreading them across ' + axisWords + ' as you go keeps it closer on the way.')
      : ('Your part-placed book is <b>' + top.pct.toFixed(0) + '%</b> ' + escapeHtml(top.nm) + ' at its heaviest, across ' +
         spread + ' &mdash; close to ' + (_rsBook ? 'your finished book’s' : 'the finished model’s') + ' <b>' + capPct.toFixed(1) + '%</b> ceiling' + more +
         '. <b>' + left + '</b>' + leftWord + ' still to place.');
    box.style.display = '';
  } catch (e) { /* a mid-session read must never break the table */ }
}

// ── COPY / EXPORT ACTIONS ──────────────────────────────────────────────────
function showToast(msg) {
  const t = document.getElementById('toast');
  document.getElementById('toast-msg').textContent = msg;
  t.classList.add('show');
  clearTimeout(window._toastT);
  window._toastT = setTimeout(() => t.classList.remove('show'), 2200);
}

/* V39.6 — writeText can REJECT, not only be missing: Chrome refuses it while the
   document is not focused ("Document is not focused"), and in-app browsers and
   embedded webviews can deny the permission outright. The rejection went back to
   eight callers that only attach .then(), so a tap on Copy did nothing and logged
   an uncaught error — measured on the order sheet's Copy on a phone and two iPads.
   A rejection now falls through to the textarea path; when that fails too the
   member is told so, and the promise never settles, so no caller paints a
   "Copied" that did not happen. The textarea path keeps focus where it was, so
   a keyboard member's next Tab starts from the button they pressed. */
function _copyViaTextarea(text) {
  var prev = document.activeElement, ok = false;
  var ta = document.createElement('textarea');
  ta.value = text; ta.setAttribute('readonly', '');
  ta.style.position = 'fixed'; ta.style.top = '0'; ta.style.left = '0'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  try { ta.setSelectionRange(0, ta.value.length); } catch(e){}
  try { ok = document.execCommand('copy'); } catch(e){}
  document.body.removeChild(ta);
  if (prev && prev.focus && prev !== document.body) { try { prev.focus({ preventScroll:true }); } catch(e){} }
  return ok;
}
function copyText(text) {
  function fallback() {
    if (_copyViaTextarea(text)) return;
    showToast('Your browser blocked copying — select the text and copy it instead');
    return new Promise(function(){});
  }
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text).catch(fallback);
  }
  return fallback() || Promise.resolve();
}

/* V30.3 — the ticker chips are copy-to-clipboard controls (one per holding, 25 of
   them on an equity book) that were plain <span onclick>: tabIndex −1, no role, no
   key handler. Every other row control on this page is reachable — the company name
   is an <a>, the broker pill is an <a>, the bought box is an <input>, the allocation
   card's rows carry role=button + tabindex + onkeydown — so the chips were the one
   affordance a keyboard member could see and not use. Enter and Space, matching the
   allocation rows' handler, and the same aria-label the tooltip already said. */
function tickerChipKey(ev, el) {
  if (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'Spacebar') {
    ev.preventDefault();
    copyTicker(el);
  }
}
function copyTicker(el) {
  const ticker = el.dataset.ticker;
  copyText(ticker).then(() => {
    el.classList.add('copied');
    showToast('Copied ' + ticker);
    setTimeout(() => el.classList.remove('copied'), 1400);
  });
}

/* V28.0 — the two export buttons read stocksData directly and never consulted
   the visible set, so with "Banks 3" active and three rows on screen, Copy
   tickers put all 25 on the clipboard and Export CSV wrote 25 rows. A member
   who filters to one sector to place that sector's orders got the whole book.
   Both now follow what is actually on screen; the row order follows too, so a
   sorted table exports in the order the member sorted it. With no filter active
   this returns exactly stocksData, so the unfiltered behaviour is unchanged. */
function visibleStocks() {
  var rows = document.querySelectorAll('#stocks-tbody tr[data-row]');
  if (!rows.length) return stocksData.slice();
  var out = [];
  rows.forEach(function(tr){
    if (tr.style.display === 'none') return;
    var s = stocksData[Number(tr.dataset.row)];
    if (s) out.push(s);
  });
  return out.length ? out : stocksData.slice();
}
/* V35.3 — copies THIS CYCLE'S ORDERS when there is a previous cycle to compare
   against, and the whole book when there is not. Pasting ten tickers into a
   broker for a two-order month is the same mistake the basket used to make, and
   this is the button step 2 of the how-to points at. Each side is labelled, so
   the paste cannot be read as a list of buys. */
function copyAllTickers() {
  if (_mfOrdersPaused()) return;   // V44.3
  const orders = cycleOrders();
  /* V41.9 — A1: with the re-weights sized, the copy carries them with their
     quantities (a held name needs the number, not just the ticker). */
  if (orders.known && (orders.rw || []).length) {
    const lines = [], q = o => o.ticker + ' ' + o.qty;
    if (orders.sells.length) lines.push('SELL: ' + orders.sells.map(o => o.ticker).join(', '));
    if (orders.trims.length) lines.push('TRIM: ' + orders.trims.map(q).join(', '));
    if (orders.buys.length)  lines.push('BUY: '  + orders.buys.map(o => o.ticker).join(', '));
    if (orders.adds.length)  lines.push('ADD: '  + orders.adds.map(q).join(', '));
    const n = orders.all.length;
    copyText(lines.join('\n')).then(() => showToast('Copied ' + n + ' order' + (n === 1 ? '' : 's')));
    return;
  }
  if (orders.known && (orders.buys.length || orders.sells.length)) {
    const parts = [];
    if (orders.sells.length) parts.push('SELL: ' + orders.sells.map(o => o.ticker).join(', '));
    if (orders.buys.length)  parts.push('BUY: '  + orders.buys.map(o => o.ticker).join(', '));
    const n = orders.buys.length + orders.sells.length;
    copyText(parts.join('\n')).then(() => showToast('Copied ' + n + ' order' + (n === 1 ? '' : 's')));
    return;
  }
  if (orders.known) {
    /* V35.4 — "no orders" is only true when nothing moved. A weight-rotating book
       has no buys and no sells and plenty to do, so copy the names whose targets
       changed rather than telling the member there is nothing. */
    var rw = (stocksData || []).filter(function(s){ return heldMovePP(s.ticker) != null; });
    if (rw.length){
      copyText('REWEIGHT: ' + rw.map(function(s){ return s.ticker; }).join(', '))
        .then(function(){ showToast('Copied ' + rw.length + ' holding' + (rw.length === 1 ? '' : 's') + ' to re-weight'); });
      return;
    }
    showToast('No orders to place this cycle'); return;
  }
  const rows = visibleStocks();
  if (!rows.length) return;
  const list = rows.map(s => s.ticker).join(', ');
  copyText(list).then(() => showToast('Copied ' + rows.length + ' ticker' + (rows.length === 1 ? '' : 's')));
}

function exportCSV() {
  if (_mfOrdersPaused()) return;   // V44.3
  if (!stocksData.length) return;
  // V28.0: export what is on screen (see visibleStocks). Allocation and shares
  // are still sized against the WHOLE book — allocBudget(s, stocksData, …) —
  // because a filter changes what you are looking at, not what you own.
  const rowsOut = visibleStocks();
  if (!rowsOut.length) return;
  const n = stocksData.length || 1;
  /* V35.3 — AN ACTION COLUMN, BECAUSE A LIST WITHOUT ONE IS A LIST OF BUYS.
     The export had no side, so a member feeding it to a broker's bulk-order
     upload placed the whole book — the same defect as the basket sent, by a
     different route. Every row now says BUY / SELL / HOLD, read from the same
     window._bookDiff the change card is drawn from, and the departing holdings
     are appended as SELL rows with the quantity actually held. With no previous
     cycle recorded the diff is unknown, and there every row is honestly a BUY. */
  const diff = window._bookDiff;
  // V43.8 — the file follows Step 3: under Buy all every row is a BUY (the shape of a
  // first cycle), and under Pick stocks only the ticked orders are marked.
  const omC = orderModeState();
  const known = !!(diff && diff.known) && omC.m !== 'fresh';
  const pickC = omC.m === 'pick' ? (omC.p || {}) : null;
  const addSet = {}; if (known) diff.added.forEach(t => { addSet[t] = 1; });
  const header = ['Action','#','Company','Ticker','Industry','Recommended Price (INR)','Weight (%)','Allocation (INR)','Shares'];
  const lines = [header.join(',')];
  // V41.9 — A1: a sized re-weight says which way and how many, in the Action
  // column (the header, and every other row, stay exactly as they were).
  const ocCsv = known ? cycleOrders() : null;
  const rwAction = t => {
    const o = (ocCsv && ocCsv.rwKnown) ? _rwOrderFor(t, ocCsv) : null;
    if (!o) return 'REWEIGHT';
    if (o.hold) return 'REWEIGHT: SELL ' + o.hold.qty + ' ON OR AFTER ' + _csIso(o.hold.until);
    return o.qty > 0 ? 'REWEIGHT: ' + o.side + ' ' + o.qty : 'REWEIGHT: NO ORDER';
  };
  /* V44.2 — a worklist reads top to bottom, so the sales lead the file: the names that
     left, then the trims, then the rest of the book. `#` is the row's place in the file. */
  const bookRows = [], trimRows = [];
  rowsOut.forEach((s,i) => {
    const price = Number(s.recommended_price)||0;
    const shares = price > 0 ? Math.floor(allocBudget(s, stocksData, currentCapital) / price) : 0;
    const amt = shares * price;
    /* V35.4 — REWEIGHT is a third action, and on MultiAsset it is the only one.
       Every carried-over row exported as HOLD, so a member who took the CSV as
       their worklist for a weight-rotation month came away with a file saying
       there was nothing to do — the same "carried over means untouched"
       assumption the change card and the picks table were both carrying. */
    const mv = known ? heldMovePP(s.ticker) : null;
    const T = String(s.ticker || '').toUpperCase();
    const row = [
      _isRestricted(s.ticker) ? 'RESTRICTED' :   // V39.5 — B1: never sized, never traded
      pickC ? (pickC[T] ? 'BUY' : (mv != null && pickC['RW:' + T] ? rwAction(s.ticker)
                                   : (known && !addSet[s.ticker] ? 'HOLD' : 'NOT CHOSEN'))) :
      known ? (addSet[s.ticker] ? 'BUY' : (mv != null ? rwAction(s.ticker) : 'HOLD')) : 'BUY',
      0,
      JSON.stringify(s.company_name||''),
      JSON.stringify(s.ticker||''),
      JSON.stringify(s.industry||''),
      price.toFixed(2),
      (Number(s.weight_pct)||0).toFixed(2),
      amt.toFixed(2),
      shares
    ];
    (/^REWEIGHT: SELL/.test(row[0]) ? trimRows : bookRows).push(row);
  });
  /* The sells are not rows of the picks table, so they cannot come from
     visibleStocks() — they are appended from the diff. A sector filter narrows
     what you are LOOKING at; it does not narrow what you have to sell, and an
     export that silently dropped a sell because a chip was active would be worse
     than one that never carried them. */
  if (known && diff.removed.length){
    const pp = diff.prevPos || {};
    // V39.5 — no row for a restricted name; a held-back sale carries its date.
    diff.removed.filter(t => !_isRestricted(t) && (!pickC || pickC['SELL:' + String(t).toUpperCase()])).forEach((t, j) => {
      const p = pp[t] || {};
      const until = _csHoldUntil(t);
      lines.push([
        until ? 'SELL ON OR AFTER ' + _csIso(until) : 'SELL', j + 1,
        JSON.stringify(p.n || t), JSON.stringify(t), JSON.stringify('—'),
        (Number(p.rec)||0).toFixed(2), '0.00', '0.00', (Number(p.qty)||'')   // V42.1 — B5: blank, never a guessed zero
      ].join(','));
    });
  }
  trimRows.concat(bookRows).forEach(row => { row[1] = lines.length; lines.push(row.join(',')); });
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const strat = (currentStrategy || 'portfolio').replace(/[^a-z0-9]+/gi,'_');
  const date  = new Date().toISOString().slice(0,10);
  a.href = url; a.download = 'mindforge_' + strat + '_' + date + '.csv';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('CSV downloaded');
}

// ── NOTIFICATION PREFERENCES ──
// V15.5 fix: the rebalance-notification toggle used to reset to OFF on every
// refresh (nothing read the saved preference back on load) and the choice never
// reached the server, so the toggle could not actually arm the backend's
// notifyRebalance() emails. We now (a) persist the preference and RESTORE it on
// load — preferring the server's notify flag (subscription.notify, exposed by
// apps_script.gs handleGetStocks) and falling back to localStorage so the UI
// state survives a refresh even before the backend redeploy lands — and
// (b) register the choice server-side via ?action=set_notify so the flag the
// publish flow reads (subscriptions sheet, col L) actually flips.
var _notifOn = false;
function _notifKey() { return 'mfc_notif_' + (token || (isDemo ? 'demo' : 'anon')); }
function _loadNotifPref() {
  try { var raw = localStorage.getItem(_notifKey()); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
}
function _saveNotifPref(on, email) {
  try { localStorage.setItem(_notifKey(), JSON.stringify({ on: !!on, email: email || '', savedAt: new Date().toISOString() })); } catch (e) {}
}
// Fire-and-forget server registration. The token is the per-subscriber secret, so
// it authorises the write. Non-fatal: if the deployed backend predates this
// action it returns "Invalid action" and we keep the local preference (the
// toggle still persists across refresh); once apps_script.gs is redeployed the
// flag flips server-side and notifyRebalance() emails the subscriber.
function _registerNotif(on, email) {
  if (isDemo || !token) return;
  try {
    var url = APPS_SCRIPT_URL + '?action=set_notify&token=' + encodeURIComponent(token) +
              '&on=' + (on ? '1' : '0') + (email ? '&email=' + encodeURIComponent(email) : '') +
              '&_=' + Date.now();
    fetch(url).catch(function () {});
  } catch (e) {}
}
function _setNotifUI(on, email) {
  _notifOn = !!on;
  var sw = document.getElementById('notif-switch');
  var lbl = document.getElementById('notif-label');
  var row = document.getElementById('notif-email-row');
  var ok = document.getElementById('notif-success');
  var input = document.getElementById('notif-email-input');
  if (!sw) return;
  if (email && input) input.value = email;
  sw.setAttribute('aria-checked', _notifOn ? 'true' : 'false');   // V30.3: role=switch state
  if (_notifOn) {
    sw.classList.add('on'); lbl.textContent = 'On';
    if (row) row.style.display = 'flex';
    if (ok) ok.style.display = 'block';
  } else {
    sw.classList.remove('on'); lbl.textContent = 'Off';
    if (row) row.style.display = 'none';
    if (ok) ok.style.display = 'none';
  }
  try { _setHowToStep4(); } catch (e) {}   // V41.1 — step 4 says what the switch says
  try { if (window.mfcV431Refresh) window.mfcV431Refresh(); } catch (e) {}   // V43.1 — B1 e-mail item
}
// V35.2 — step 4 of "How to invest" is the only place on the page that tells a
// member what happens at the next rebalance, and it named a control that half the
// membership cannot see. One writer, two readings, derived from the same test as
// the toggle itself: with the toggle present it points at it; without, it says
// plainly what a monthly member gets instead, and what the longer plans add.
/* V35.3 — step 3 describes THIS cycle's orders. Three branches, one reading:
   a first cycle (or a device with no history) genuinely does buy the whole book,
   so that member keeps the original sentence; a returning member is told the two
   things that are actually in front of them, sells included; and a weighted book
   with no name changes is rebalancing to new targets rather than buying anything,
   which is the one case where the Shares column is the instruction and there is
   no order list at all. */
function _setHowToStep3(orders){
  var p = document.getElementById('hs3-copy');
  if (!p) return;
  var base = ' Limit orders near rec. price are fine on liquid names.';
  // V43.8 — Pick stocks: the orders the member ticked, in the list below.
  if (orders && orders.mode === 'pick'){
    var pn = orders.all.length, pS = orders.sells.length + (orders.trims || []).length, pB = pn - pS;
    p.textContent = pn
      ? 'The ' + pn + ' order' + (pn === 1 ? '' : 's') + ' you ticked in the list below: ' +
        [pS ? 'sell ' + pS : '', pB ? 'buy ' + pB : ''].filter(Boolean).join(', then ') + ', at the quantities shown there.' + base
      : 'Tick the stocks to buy or sell in the list below, and the orders follow.' + base;
    return;
  }
  if (!orders || !orders.known){
    p.textContent = 'Use the Shares column as your quantity for each ticker.' + base;
    return;
  }
  var nB = orders.buys.length, nS = orders.sells.length;
  /* V41.9 — A1: with the re-weights sized, step 3 is a list like any other. */
  var rwL = orders.rw || [];
  if (rwL.length){
    var nT = rwL.filter(function(o){ return o.side === 'SELL'; }).length, nA = rwL.length - nT;
    var tot = nB + nS + rwL.length;
    var other = (BROKERS[getBroker()] || {}).sheet === true;
    var rwBits = [];
    if (nS) rwBits.push('sell the ' + nS + (nS === 1 ? ' name' : ' names') + ' leaving');
    if (nT) rwBits.push('trim ' + nT);
    if (nB) rwBits.push('buy the ' + nB + ' new ' + (nB === 1 ? 'one' : 'ones'));
    if (nA) rwBits.push('top up ' + nA);
    p.textContent = (nB || nS ? 'Only ' + tot + ' order' + (tot === 1 ? '' : 's') + ' this cycle'
                              : 'No names change this cycle \u2014 ' + tot + ' order' + (tot === 1 ? '' : 's') + ' bring each holding to its new weight') +
      ': ' + rwBits.join(', then ') + ', at the quantities marked above.' +
      (other ? ' The order sheet below lists them in order, one ticket per line.'
             : (getBroker() === 'kite'
                 ? ((nS + nT) && (nB + nA) ? ' On Zerodha the sales go first, in a Kite basket of their own.'   // V44.2
                                           : ' On Zerodha they go in ' + (tot > KITE_BASKET_MAX ? 'Kite baskets' : 'one Kite basket') + '.')
                 : '')) + base;
    return;
  }
  if (!nB && !nS){
    p.textContent = isWeightedBook(stocksData)
      ? 'No names change this cycle — bring each holding to the Allocation shown above and you are done.' + base
      : 'Nothing to place this cycle. Hold what you already own.';
    return;
  }
  var bits = [];
  if (nS) bits.push('sell the ' + nS + (nS === 1 ? ' name' : ' names') + ' marked above');
  if (nB) bits.push('buy the ' + nB + ' new ' + (nB === 1 ? 'one' : 'ones') + ' at the Shares quantity in the table');
  p.textContent = 'Only ' + (nB + nS) + ' order' + (nB + nS === 1 ? '' : 's') + ' this cycle — ' +
    bits.join(', then ') + '. Everything else you already hold, untouched.' + base +
    ((BROKERS[getBroker()] || {}).sheet === true ? ' The order sheet below lists them in order, one ticket per line.' : '');
}

/* V35.3 — "Your picks stay fixed for your subscription" was told to BOTH plans,
   and it is false for the one that sees it in the hasToggle branch. The branch is
   chosen by whether the notification toggle is shown, i.e. duration_months > 1 —
   and apps_script.gs handleGetStocks serves exactly those subscribers
   findLatestRunId(strategy), a NEW book every month, while a monthly sub is
   pinned to the run_id captured at signup. So the sentence told 3/6/12-month
   members that their list would not change (it changes on the 1st, silently) and
   that they should renew to switch to next month's set (they already receive it).
   Both branches are now written from duration_months directly rather than from a
   control's visibility, so the copy cannot drift from the backend rule it
   describes. */
function _setHowToStep4(){
  var p = document.getElementById('hs4-copy');
  if (!p) return;
  var sub = window._currentSub || {};
  var months = Number(sub.duration_months) || 1;
  /* V37.6 — "above" had been false since V35.2 moved this card up the page: the
     notification toggle sits BELOW it, past the Adjust-your-book planner. The
     direction is read from the document rather than typed, so the next reorder
     cannot strand the sentence again. */
  var where = 'below';
  try {
    var ns = document.getElementById('notif-section');
    if (ns && (p.compareDocumentPosition(ns) & Node.DOCUMENT_POSITION_PRECEDING)) where = 'above';
  } catch (e) {}
  if (months <= 1 && _subIsFree(sub)) {           // V39.1 — a legacy 1-month free row
    p.textContent = "This free registration was set up as a single month, so its picks stay fixed. Re-register for free (₹0) and the new registration updates itself on the 1st, with an email when each new set lands.";
    return;
  }
  /* V41.1 — every plan longer than a month starts with notifications ON (apps_script.gs
     notifyFlag), so "Turn on rebalance notifications" told most members to switch on
     something that was already on. The sentence now follows the switch. */
  p.textContent = months > 1
    ? "Your book updates automatically on the 1st\u00A0— the picks here are always the current set, for as long as your subscription runs. " +
      (_notifOn ? "Rebalance notifications are on, so we'll email you the moment a new set lands; the switch is " + where + "."
                : "Turn on rebalance notifications " + where + " and we'll email you the moment a new set lands.")
    : "Your picks stay fixed for your subscription. Next month's set is published on the 1st — renew to switch to it. Automatic monthly updates and email alerts come with the 3-month plan and longer.";
}

// Called from renderDashboard() once we know the subscription. Server flag wins
// when present; otherwise fall back to the locally-saved preference.
function restoreNotifState() {
  var sub = window._currentSub || {};
  // Monthly subs (duration_months ≤ 1) never receive rebalance pick emails — hide the toggle.
  var sec = document.getElementById('notif-section');
  if ((sub.duration_months || 1) <= 1) {
    if (sec) sec.style.display = 'none';
    _setHowToStep4();
    try { _digestRestore(); } catch (e) {}   // V42.6 — the weekly e-mail is for monthly plans too
    return;
  }
  if (sec) sec.style.display = '';
  _setHowToStep4();
  var serverDefined = typeof sub.notify !== 'undefined' && sub.notify !== null && sub.notify !== '';
  var pref = _loadNotifPref();
  var on = serverDefined ? (String(sub.notify).toLowerCase() === 'on') : !!(pref && pref.on);
  var email = (pref && pref.email) || sub.email || '';
  if (serverDefined) _saveNotifPref(on, email);   // keep the device cache in sync with the server
  _setNotifUI(on, email);
  try { _digestRestore(); } catch (e) {}
}
/* V42.6 · M12 — THE WEEKLY E-MAIL SWITCH ("your book this week, explained").
   Shown only once get_progress lists 'digest', so a backend without set_digest is never
   offered a switch that does nothing; until then the card is exactly as it was. The
   server's column Q is the only record of the choice — no device copy to drift from it.
   Its own action, set_digest: an older backend answers "Invalid action" to it rather
   than flipping the rebalance flag that set_notify writes. */
window._digestServer = false;   // set by capitalSyncLoad() from get_progress's `features`
var DIGEST_ON_NOTE = 'On. It arrives on Saturday mornings; the e-mail has a one-click way to stop it.';
function _setDigestUI(on, note, isErr) {
  var sw = document.getElementById('digest-switch'), lbl = document.getElementById('digest-label'), nt = document.getElementById('digest-note');
  if (!sw) return;
  sw.classList.toggle('on', !!on);
  sw.setAttribute('aria-checked', on ? 'true' : 'false');
  if (lbl) lbl.textContent = on ? 'On' : 'Off';
  if (nt) { nt.textContent = note || ''; nt.hidden = !note; nt.className = 'digest-note' + (isErr ? ' is-err' : ''); }
}
function _digestRestore() {
  var sec = document.getElementById('notif-section'), row = document.getElementById('digest-row');
  if (!sec || !row) return;
  var sub = window._currentSub || {};
  var monthly = (sub.duration_months || 1) <= 1;
  var ok = !!window._digestServer && !isDemo && !!token;
  row.hidden = !ok;
  sec.classList.toggle('digest-only', monthly && ok);
  if (monthly) sec.style.display = ok ? '' : 'none';
  if (ok) _setDigestUI(String(sub.digest || '').toLowerCase() === 'on');
}
function toggleDigest() {
  var sw = document.getElementById('digest-switch');
  if (!sw || isDemo || !token) return;
  var turningOn = !sw.classList.contains('on');
  _setDigestUI(turningOn, turningOn ? DIGEST_ON_NOTE : '');
  var fail = function () { _setDigestUI(!turningOn, 'That did not save. Please try again in a minute.', true); };
  fetch(APPS_SCRIPT_URL + '?action=set_digest&token=' + encodeURIComponent(token) + '&on=' + (turningOn ? '1' : '0') + '&_=' + Date.now())
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (!d || d.status !== 'ok' || (d.digest !== 'on' && d.digest !== 'off')) return fail();
      try { (window._currentSub || {}).digest = d.digest; } catch (e) {}
      _setDigestUI(d.digest === 'on', d.digest === 'on' ? DIGEST_ON_NOTE : '');
    })
    .catch(fail);
}
function toggleNotif() {
  var turningOn = !_notifOn;
  var sub = window._currentSub || {};
  var pref = _loadNotifPref();
  var email = (pref && pref.email) || sub.email || '';
  _setNotifUI(turningOn, email);
  // "If a user has switched it on, save it as a preference" — persist + register
  // immediately on toggle (defaulting to the account email), so a refresh keeps
  // it on even if the member never opens the confirm-email row.
  _saveNotifPref(turningOn, email);
  _registerNotif(turningOn, email);
  if (turningOn) {
    var input = document.getElementById('notif-email-input');
    if (input) input.focus();
  }
}
function saveNotifPref() {
  var input = document.getElementById('notif-email-input');
  var email = input.value.trim();
  // Lightweight format check: something@something.tld
  var isValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  if (!isValid) {
    input.style.borderColor = 'var(--red)';
    input.focus();
    showToast('Please enter a valid email');
    return;
  }
  input.style.borderColor = '';
  _notifOn = true;
  _saveNotifPref(true, email);
  _registerNotif(true, email);
  document.getElementById('notif-email-row').style.display = 'none';
  document.getElementById('notif-success').style.display = 'block';
  showToast('Notifications saved');
}

function updateMarketStatus() {
  // V24.5: every book trades on the NSE, so the NYSE branch added in V4.8 for
  // the S&P 500 book is gone — this is IST-only again.
  const tz   = 'Asia/Kolkata';
  const open = 9*60 + 15;
  const close= 15*60 + 30;
  const label= 'NSE';
  const hours= '9:15–15:30 IST';

  const local = new Date(new Date().toLocaleString('en-US', {timeZone: tz}));
  const h = local.getHours(), m = local.getMinutes(), d = local.getDay();
  const mins = h*60 + m;
  const isWeekday = d >= 1 && d <= 5;
  const hol = _nseHolidayOn(local);   // V44.1 — a trading holiday is shut all day
  const isOpen = isWeekday && !hol && mins >= open && mins <= close;

  const lblEl = document.getElementById('market-label');
  if (lblEl) {
    lblEl.innerHTML = isOpen
      ? '<span class="market-open">' + label + ' open</span>'
      : '<span class="market-closed">' + label + ' closed</span>';
  }
  const dot = document.getElementById('market-dot');
  if (dot) dot.className = isOpen ? 'dot-green' : 'dot-red';

  const bar = document.getElementById('market-status');
  if (bar) bar.title = label + ' · ' + hours + ' · Mon–Fri' + (hol ? ' · closed today for ' + hol : '');
}

// V35.2 — `opts.retry` marks an error the member can actually do something about.
// It is opt-IN: "Access Denied" and "No Access Token" are settled answers and a
// retry button on them would just loop, so they keep the dead end they have.
function showError(title, msg, opts) {
  opts = opts || {};
  document.getElementById('state-loading').style.display = 'none';
  // V29.0: an error must never leave the half-built dashboard on screen. init()
  // could reach renderDashboard (which sets this to block) and only THEN throw,
  // leaving the error panel and a broken dashboard visible at the same time.
  var dash = document.getElementById('state-dashboard');
  if (dash) dash.style.display = 'none';
  document.getElementById('state-error').style.display = 'block';
  document.getElementById('error-title').textContent = title;
  document.getElementById('error-msg').textContent = msg;
  // V40.3 — C8 / B2.3: an optional primary action (see the markup note).
  var actBox = document.getElementById('error-action'), actA = document.getElementById('error-action-link');
  if (actBox && actA){
    var act = opts.action;
    actBox.hidden = !act;
    if (act){
      actA.textContent = act.label;
      actA.setAttribute('href', act.href);
      if (act.ext){ actA.setAttribute('target', '_blank'); actA.setAttribute('rel', 'noopener'); }
      else { actA.removeAttribute('target'); actA.removeAttribute('rel'); }
    }
  }
  var pros = document.getElementById('error-prospect');   // V42.1 — A3: only the no-token branch shows it
  if (pros) pros.hidden = true;
  var retry = !!opts.retry;
  var rBox = document.getElementById('error-retry');
  var lock = document.getElementById('error-icon-lock');
  var net  = document.getElementById('error-icon-net');
  if (rBox) rBox.hidden = !retry;
  if (lock) lock.hidden = retry;
  if (net)  net.hidden  = !retry;
  var btn = document.getElementById('error-retry-btn');
  if (btn){
    btn.disabled = false;
    var lbl = document.getElementById('error-retry-label');
    if (lbl) lbl.textContent = 'Try again';
  }
  offerOtherStrategies();
}

// V35.2 — re-run the load in place. init() is idempotent (it either renders or
// calls showError again), so this needs no page reload and costs no OTP.
function retryDashboard(){
  var btn = document.getElementById('error-retry-btn');
  if (btn && btn.disabled) return;            // one flight at a time
  if (btn){
    btn.disabled = true;
    var lbl = document.getElementById('error-retry-label');
    if (lbl) lbl.textContent = 'Reconnecting…';
  }
  document.getElementById('state-error').style.display = 'none';
  document.getElementById('state-loading').style.display = 'block';
  // A retry that resolves in 40ms reads as a button that did nothing; hold the
  // spinner briefly so the state change is legible either way.
  setTimeout(function(){
    Promise.resolve().then(init).catch(function(){
      showError('Connection Error', 'Still could not reach the server. Please check your connection and try again.', {retry:true});
    });
  }, 450);
}

// V29.0 — the way back off the error screen. The strategy switcher is part of the
// dashboard, so when a token fails there is no switcher on screen and the member's
// other, working strategies are invisible even though this device still has their
// tokens. List whatever the registry knows (minus the token that just failed) and
// let one click switch to it. Silent no-op when there is nothing to offer.
/* ── V40.3 · B2.3 · "YOUR ACCESS HAS ENDED", NOT "ACCESS DENIED" ───────────────
   A paying member whose term ran out was shown a padlock and "Access Denied —
   Subscription has expired", with "Sign in again" (which cannot help) as the
   only way on. Their access has ended; nothing was denied. The way back depends
   on the book: a paid one renews (WhatsApp today, the same prefilled message the
   renewal rail uses), the free one starts again at ₹0. The strategy is read from
   this device's switcher registry by token, BEFORE the auth-failure path drops
   it; unknown → the paid wording, which is still true for a free member. */
function _expiredStrategy(){
  try {
    var reg = readStratRegistry();
    return Object.keys(reg).filter(function(n){ return reg[n] === token; })[0] || '';
  } catch (e) { return ''; }
}
function showExpired(name){
  var nm = String(name || '').replace(/ /g, ' ').trim();
  var free = /multiasset/i.test(nm);
  if (free) {
    showError('Your access has ended',
      'Your free MultiAsset registration has run its course. Start it again — still ₹0 — and the next book reaches you.',
      { action: { href: 'signup.html?strategy=multiasset', label: 'Start it again (₹0) →' } });
  } else {
    showError('Your access has ended',
      'Your shares stay in your own demat either way. To keep receiving the monthly book' + (nm ? ' for ' + nm : '') + ', renew.',
      { action: { href: 'https://wa.me/917601032082?text=' + encodeURIComponent(
          'Hi MindForge Capital — my dashboard access has ended and I would like to renew' + (nm ? ' ' + nm : '') + '.'),
        label: 'Renew on WhatsApp →', ext: true } });
  }
}
function offerOtherStrategies(){
  try {
    var box  = document.getElementById('error-strats'),
        list = document.getElementById('error-strats-list');
    if (!box || !list) return;
    var reg = readStratRegistry();
    var names = Object.keys(reg).filter(function(n){ return reg[n] && reg[n] !== token; });
    if (!names.length){ box.style.display = 'none'; return; }
    names.sort(function(a,b){ return a.localeCompare(b); });
    list.innerHTML = names.map(function(n){
      return '<button type="button" class="err-strat-btn" data-tok="' + encodeURIComponent(reg[n]) + '">' +
             escapeHtml(n) + '</button>';
    }).join('');
    list.onclick = function(ev){
      var b = ev.target.closest && ev.target.closest('.err-strat-btn');
      if (!b) return;
      writeDashToken(decodeURIComponent(b.getAttribute('data-tok')));
      window.location.href = 'dashboard.html';
    };
    box.style.display = '';
  } catch(e){}
}

async function refreshDashboard() {
  if (isDemo) {
    // Refresh from demo data + bump time
    const d = _demoData(demoMode);
    if (window._currentSub) d.subscription.expires_at = window._currentSub.expires_at;
    stocksData = d.stocks;
    renderDashboard(d.subscription, d.stocks);
    showToast('Data refreshed');
    return;
  }
  const btn = document.getElementById('btn-refresh');
  if (btn) btn.classList.add('refreshing');
  try {
    const res = await fetch(APPS_SCRIPT_URL + '?action=stocks&token=' + encodeURIComponent(token) + '&_=' + Date.now());
    const data = await res.json();
    /* V30.2 — this path never received the V29.0 guard that init() got, and it is
       the SAME failure one function up. Testing `data.error` alone lets a
       {status:'error', message:'…'} reply through (a shape the backend does emit,
       which is exactly why isErrorPayload exists). What followed was worse than a
       failed refresh: `stocksData` was overwritten with [] BEFORE the payload was
       validated, then renderDashboard(undefined, []) threw on sub.expires_at and
       the outer catch reported "Refresh failed" — leaving the member looking at a
       fully-rendered table backed by an empty stocksData, so the next sort, sector
       chip or capital change silently emptied it. Validate first, assign second.
       A DEFINITIVE auth failure (the subscription lapsed while the tab was open)
       is also not a toast: route it to the same Access Denied panel init() uses,
       which carries the way back to the member's other strategies. */
    if (isErrorPayload(data)) {
      if (isAuthFailure(data)) {
        var _expNm2 = _expiredStrategy();       // V40.3 — B2.3: read before the registry drops it
        clearDashSession({ keepRegistry: true });
        removeStratByToken(token);
        if (/expired/i.test(errMessage(data))) { showExpired(_expNm2); return; }
        showError('Access Denied', errMessage(data) || 'This link is invalid or your subscription has expired.');
        return;
      }
      showToast('Refresh failed'); return;
    }
    if (!data.subscription) { showToast('Refresh failed'); return; }
    _mfLastSave(token, data);   // V44.3
    _mfVerified();              // V44.3 — a Refresh that lands is as good as the first answer
    window._splits = data.splits || null;   // V44.5 — see _splitTicks
    stocksData = data.stocks || [];
    window._mfNote = (data && data.note) || null;   // V42.3 — M10: the analyst's latest note for this book, if any
    // V38.7 — awaited, and ONLY on a device with no history of its own: see
    // bookHistSyncLoad(). On every other load it resolves synchronously-fast
    // without a request, so this costs a first paint nothing in the normal case
    // — and in the case it does cost something, the alternative is painting a
    // fifteen-order month at a member who has four orders to place.
    try { await bookHistSyncLoad(data.subscription.strategy); } catch (e) {}
    renderDashboard(data.subscription, stocksData);
    loadLiveProfit(true);   // V14.3: force-refresh live prices on manual refresh
    showToast('Data refreshed');
  } catch (e) {
    showToast('Refresh failed');
  } finally {
    if (btn) btn.classList.remove('refreshing');
  }
}

// ── LIVE PROFIT SINCE REBALANCE (V14.3) ──────────────────────────────────────
// Shows each holding's return vs the price recommended on the rebalance date,
// and a portfolio-level weighted profit. Live prices come from the backend
// (Yahoo proxy): batch ?action=prices first; if that returns nothing (older
// deployed Apps Script), fall back to the proven per-ticker ?action=chart. The
// price map is cached in localStorage per calendar day, so it refreshes once a
// day automatically ("updated everyday") and is instant on same-day reloads.
function parseRebalanceDate(sub){
  var rid = (sub && sub.run_id) ? String(sub.run_id) : '';
  var m = rid.match(/^(\d{4})(\d{2})(\d{2})/);   // e.g. 20260609_230735_SMC
  if (m){ var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])); if (!isNaN(d.getTime())) return d; }
  if (sub && sub.subscribed_at){ var d2 = new Date(sub.subscribed_at); if (!isNaN(d2.getTime())) return d2; }
  return null;
}
/* ═══════════════════════════════════════════════════════════════════════════
   V35.2 — WHAT CHANGED SINCE LAST MONTH.
   ---------------------------------------------------------------------------
   The homepage sells this in as many words: "after that you are only trading
   the difference between last month's holdings and this month's." The dashboard
   never computed that difference. A member on month one gets the whole book and
   is fine; every member after that has been diffing two lists by hand out of an
   email, which is the single piece of arithmetic this product exists to remove.

   WHY THIS IS DEVICE-LOCAL, AND WHY THAT IS STILL WORTH SHIPPING.
   The backend returns one book — {subscription, stocks} for the CURRENT run and
   nothing before it. Serving last month's holdings would mean a new Apps Script
   endpoint and a redeploy, which is a manual step in a Google account. So the
   comparison basis is kept on the device: each strategy's ticker set is recorded
   under its run_id, and the moment the run_id changes the set we held becomes
   the "previous" one. Consequences, stated rather than papered over:
     · a member who opens the dashboard on a NEW device sees "first cycle
       tracked here" until the next rebalance — never a wrong diff, just no diff;
     · a member who skips a cycle entirely is compared against the last cycle
       they actually opened, which is the honest answer to "what do I trade" for
       THEM, and the module names the cycle it is comparing against;
     · clearing site data resets it to the same honest unknown.
   Every surface below is gated on `known`. Nothing guesses.

   Keyed on run_id (e.g. 20260609_230735_SMC), which changes with every published
   run — parseRebalanceDate() already reads it. Falls back to the rebalance date,
   and tracks nothing at all when neither is available.
   ═══════════════════════════════════════════════════════════════════════════ */
var BOOK_HIST_KEY = 'mfc_book_hist_v1';

function _cycleKey(sub){
  if (sub && sub.run_id) return String(sub.run_id);
  var d = parseRebalanceDate(sub);
  if (d && !isNaN(d.getTime())) return 'd' + d.toISOString().slice(0,10);
  return null;
}
/* V40.1 — A5. V40.0 namespaced the sample's history for NEW writes only. A device
   that opened the sample before 30 Sep 2026 still holds the fixture under the
   real strategy name (cur.key "20260831_090000_LM", prev.key "demo-prev" — found
   on the review browser), and a real member's next visit rolled it over as "the
   set you last opened": what changed, its sells and the sell basket all came from
   the sample's book. The fixture's signature is unmistakable — its run ids are
   YYYYMMDD_090000_<LM|MA|SM> and its previous set is "demo-prev" — so a real load
   drops any non-demo entry carrying it, before anything reads or pushes it. */
var _DEMO_RUN_RE = /^\d{8}_090000_(LM|MA|SM)$/;
function _isDemoResidue(slot){
  if (!slot || typeof slot !== 'object') return false;
  return [slot.cur && slot.cur.key, slot.prev && slot.prev.key].some(function(k){
    return k === 'demo-prev' || (typeof k === 'string' && _DEMO_RUN_RE.test(k));
  });
}
/* V44.5 — A SPLIT OR BONUS INSIDE A CYCLE. A 1:5 split leaves every figure stored before
   the ex-date on the old basis: the published price, the recorded position and the
   member's own ticks. Measured on a sample book at ₹10,00,000, that read −79% on the
   holding and −5 points on the headline, −₹51,530 on Your position, an order for a fifth
   of the intended shares, and on rebalance day a sale of 21 shares out of 105 beside a
   "realised loss" that was really a gain.
   From the ex-date's open the backend serves an older run's rows restated, with `split`
   on the row, and `splits` names the records for this book, so a holding that has left
   the current list is still covered. Stored figures move to the new basis here, at the
   two places they are read, and are marked `spl` so it happens once. A position built
   from a restated row is already on it (_bookPos). */
function _splitOpenMs(sp){ return Date.parse(sp.ex + 'T09:15:00+05:30'); }
function _cycleDay(key){
  var m = /^(\d{4})(\d{2})(\d{2})/.exec(String(key || ''));
  if (m) return m[1] + '-' + m[2] + '-' + m[3];
  m = /^d(\d{4}-\d{2}-\d{2})/.exec(String(key || ''));
  return m ? m[1] : '';
}
function _splitTicks(map){
  var S = window._splits;
  if (!S || !map || !window._currentSub) return map;
  var day = _cycleDay(_cycleKey(window._currentSub));
  if (!day) return map;
  Object.keys(S).forEach(function(t){
    var sp = S[t], v = map[t];
    if (!v || typeof v !== 'object' || v.spl || !(day < sp.ex)) return;
    if (Date.parse(v.t) >= _splitOpenMs(sp)) return;      // placed after it: already on the new basis
    if (Number(v.p) > 0) v.p = Math.round(Number(v.p) / sp.f * 100) / 100;
    if (Number(v.q) > 0) v.q = Math.floor(Number(v.q) * sp.f);
    v.spl = 1;
  });
  return map;
}
function _splitHist(hist){
  var S = window._splits, sub = window._currentSub;
  var slot = (S && sub) ? hist[_bookHistStrat(sub.strategy)] : null;
  if (!slot) return hist;
  [slot.cur, slot.prev].forEach(function(rec){
    var day = (rec && rec.pos) ? _cycleDay(rec.key) : '';
    if (!day) return;
    Object.keys(S).forEach(function(t){
      var sp = S[t], p = rec.pos[t];
      if (!p || p.spl || !(day < sp.ex)) return;
      if (Number(p.qty) > 0) p.qty = Math.floor(Number(p.qty) * sp.f);
      if (Number(p.held) > 0) p.held = Math.floor(Number(p.held) * sp.f);
      if (Number(p.rec) > 0) p.rec = Math.round(Number(p.rec) / sp.f * 100) / 100;
      p.spl = 1;
    });
  });
  return hist;
}
function splitTag(s){
  var sp = s && s.split;
  return sp ? '<span class="srs-tag split-tag">' + escapeHtml(sp.label || 'Split') + '</span>' : '';
}
/* What a member sees beside a broker app that now shows five times the shares. */
function renderSplitNotice(stocks){
  var rows = (stocks || []).filter(function(s){ return s && s.split; });
  var el = document.getElementById('split-notice');
  if (!rows.length){ if (el) el.parentNode.removeChild(el); return; }
  var host = document.querySelector('.table-section');
  if (!host) return;
  if (!el){
    el = document.createElement('p');
    el.id = 'split-notice'; el.className = 'split-notice';
    host.parentNode.insertBefore(el, host);
  }
  el.innerHTML = rows.map(function(s){
    var sp = s.split;
    var when = mfDate(new Date(sp.ex + 'T12:00:00+05:30'), { day:'numeric', month:'short', timeZone:'Asia/Kolkata' });
    return '<b>' + escapeHtml(s.ticker) + ' ' + escapeHtml(String(sp.label || 'split or bonus').toLowerCase()) + ' on ' + when + '</b>, so its ' +
      fmtPrice(sp.was) + ' price is now ' + fmtPrice(s.recommended_price) + '. If you bought before that, your broker shows ' +
      sp.f + ' shares for every 1 you bought, at a lower price. You don’t need to do anything.';
  }).join(' ');
}

function _loadBookHist(){
  try { var o = JSON.parse(localStorage.getItem(BOOK_HIST_KEY) || '{}');
        if (!o || typeof o !== 'object') return {};
        if (!isDemo){
          var healed = false;
          Object.keys(o).forEach(function(k){
            if (k.indexOf('demo::') !== 0 && _isDemoResidue(o[k])) { delete o[k]; healed = true; }
          });
          if (healed) { try { localStorage.setItem(BOOK_HIST_KEY, JSON.stringify(o)); } catch(e2){} }
        }
        return _splitHist(o); } catch(e){ return {}; }
}
function _saveBookHist(o){ try { localStorage.setItem(BOOK_HIST_KEY, JSON.stringify(o)); } catch(e){} }
/* V40.0 — THE SAMPLE KEEPS ITS OWN HISTORY. ?demo stored its fixture under the
   member-facing strategy name, and for MultiAsset that name is identical to a real
   member's ('MindForge MultiAsset'), so opening the sample on a member's own device
   rolled THEIR history over to the fixture: their next "what changed", and the sell
   basket built from it, was computed against the sample's ETFs. And because the seed
   was written once and re-read on every later visit, a returning visitor kept the
   fixture of their first visit (V40.0's fifteen-name book read "9 to buy" beside a
   ten-name previous set). Namespaced here; seeded from the current fixture on every
   load in bookDiff(). For a real member this returns exactly the string it always
   used, so no member's stored history changes key. */
function _bookHistStrat(strategy){
  return (isDemo ? 'demo::' : '') + String(strategy || 'default');
}

/* ── V38.7 · THE BOOK HISTORY FOLLOWS THE MEMBER, NOT THE BROWSER ────────────
   BOOK_HIST_KEY is localStorage, so "what changed this cycle" — the feature that
   turns a fifteen-order month into a four-order one, and the page's whole answer
   to "how much time will this take me" — existed only on the device that had
   seen the previous cycle. Open the same account on a second device and the
   tiles honestly degraded to the whole book: ORDERS TO PLACE 15, "first cycle
   tracked on this device". For a member who reads the rebalance email on a phone
   and places orders on a laptop, that is not an edge case, it is the normal path.

   No backend change is needed and none was made. handleSetProgress already takes
   an arbitrary `cycle_key` and merges a `map` into a per-token blob, so the
   history rides the SAME endpoint the tick map uses, under its own key, as a
   single entry that each save overwrites (`cur[tk] = map[tk]` is an assignment).
   The entry carries its own `t` so the server's keep-newest pruning does not
   treat it as the stalest key on the row.

   The pull is deliberately ONE-WAY AND COLD-START ONLY: the server copy is
   adopted only when this device has no previous cycle at all. It can therefore
   turn "no diff" into "a diff" and can never overwrite, reorder or contradict a
   device that already has history — which matters because the diff drives sell
   quantities and broker baskets, and the failure mode there is a money error,
   not a cosmetic one. Offline, or against a deployment without the endpoints,
   every one of these paths is a no-op and the page behaves exactly as before. */
function _bookHistKey(strategy){
  var st = String(strategy || 'default').replace(/ /g, ' ').trim();
  return ('bookhist::' + st).slice(0, 120);
}

/* Push the rolled-over history up. Called only where the slot actually changed,
   so a plain re-read of the same cycle sends nothing. */
function bookHistPush(strategy, slot){
  if (isDemo || !token || !slot) return;
  try {
    var body = JSON.stringify({
      action: 'set_progress', token: token, cycle_key: _bookHistKey(strategy),
      map: { book: { t: new Date().toISOString(), d: JSON.stringify(slot) } }, removed: []
    });
    fetch(APPS_SCRIPT_URL, { method:'POST', headers:{'Content-Type':'text/plain'},
                             body: body, keepalive: true }).catch(function(){});
  } catch (e) {}
}

/* Cold-start pull. Resolves once, never rejects, and writes nothing unless the
   server knows a previous cycle this device does not. */
function bookHistSyncLoad(strategy){
  if (isDemo || !token) return Promise.resolve(false);
  var strat = _bookHistStrat(strategy);
  var hist = _loadBookHist();
  if (hist[strat] && hist[strat].prev && (hist[strat].prev.tickers || []).length) {
    return Promise.resolve(false);                 // this device already knows
  }
  return _getProgress()
    .then(function(d){
      if (!d || d.status !== 'ok' || !d.progress) return false;
      var entry = d.progress[_bookHistKey(strat)];
      var raw = entry && entry.book && entry.book.d;
      if (!raw) return false;
      var slot = JSON.parse(raw);
      if (!slot || typeof slot !== 'object') return false;
      var prev = slot.prev;
      if (!prev || !(prev.tickers || []).length) return false;
      // V40.1 — A5: never adopt a server copy that a pre-V40.0 sample visit polluted
      if (_isDemoResidue({ prev: prev })) return false;
      var cur = _loadBookHist();
      var mine = cur[strat] || {};
      // Adopt the server's PREV only. `cur` is this render's own book and is
      // authoritative here; taking the server's would re-introduce a stale
      // holdings list into the sell basket.
      mine.prev = prev;
      cur[strat] = mine;
      _saveBookHist(cur);
      return true;
    })
    .catch(function(){ return false; });
}

/* V35.3 — WHAT A CYCLE RECORD HAS TO CARRY IF THE SELLS ARE TO BE ACTIONABLE.
   V35.2 stored a ticker list, which is all a COUNT needs. An order needs more: to
   put a departing name in a broker basket you need its quantity, and to say what
   the sale realises you need the price it entered the book at. Neither is
   recoverable later — the moment the run rolls over, that name is gone from the
   payload and the site has no per-member holdings store to ask.
   So each cycle now also records, per ticker, {y: yahoo symbol, rec: the
   recommended price it was published at, qty: whole shares at the member's own
   capital, n: display name}. `rec` and `y` are facts of the cycle and are written
   once by bookDiff(); `qty` follows the capital box and is re-stamped by
   _recordCurQty() — bookDiff runs at the top of renderDashboard, BEFORE
   setupCapitalCalculator has restored currentCapital, so writing qty here would
   record a book of zeros.
   Records written before this release carry no `pos`. Everything that reads it is
   gated on its presence, so an older device degrades to exactly V35.2's
   behaviour — counts and chips, no sell basket — rather than to a wrong number. */
function _bookPos(stocks, capital){
  var pos = {};
  (stocks || []).forEach(function(s){
    var t = String(s.ticker || ''); if (!t) return;
    var price = Number(s.recommended_price) || 0;
    pos[t] = {
      y:   s.yahoo_ticker || '',
      rec: price,
      qty: (price > 0 && capital > 0) ? Math.floor(allocBudget(s, stocks, capital) / price) : 0,
      // The MODEL weight, not the member's. A weighted book (MultiAsset) keeps the
      // same holdings and rotates their targets, so the only way to measure that
      // cycle's turnover is w_new vs w_prev. Quantities cannot do it: they move
      // when the member changes their capital, which is not a rebalance.
      w:   Number(s.weight_pct) || 0,
      n:   s.company_name || t
    };
    if (s.split) pos[t].spl = 1;                 // V44.5 — already on the new basis
  });
  return pos;
}
/* Re-stamp the CURRENT cycle's quantities at the capital now in the box. Called
   from refreshSizeSummary, i.e. on every capital change and once after the
   calculator restores a saved amount. Touches qty only — never rolls the
   history, never rewrites `rec`, and is a no-op if the slot predates this
   release. */
function _recordCurQty(){
  try {
    var sub = window._currentSub; if (!sub) return;
    var key = _cycleKey(sub); if (!key) return;
    var strat = _bookHistStrat(sub.strategy);
    var hist = _loadBookHist(), slot = hist[strat];
    if (!slot || !slot.cur || slot.cur.key !== key || !slot.cur.pos) return;
    var list = stocksData || [], cap = Number(currentCapital) || 0, dirty = false;
    /* V35.4 — never record a book of zeros. This runs from refreshSizeSummary,
       i.e. on every keystroke in the capital box, so clearing that field (or
       pausing mid-number) wrote qty:0 across the whole book. Harmless while the
       member is still typing — the next keystroke corrects it — but if they leave
       the field empty and the run rolls over before they return, the recorded
       position is what next cycle's SELL tickets are sized from, and every one of
       them would come back unsized. A capital of zero is not a holding of zero,
       it is the absence of a reading; keep the last real one. */
    if (!(cap > 0)) return;
    list.forEach(function(s){
      var t = String(s.ticker || ''), p = slot.cur.pos[t];
      if (!t || !p) return;
      var q = _recordedQty(s, p, list, cap, slot.cur.when);
      if (p.qty !== q){ p.qty = q; dirty = true; }
    });
    /* V42.1 — B5. WHAT THE QUANTITIES WERE SIZED FROM. A quantity recorded at the
       starting amount is not a holding: the member never said they hold it. Until
       now nothing said which it was, so next cycle "N shares held", every trim and
       the realised gain or loss were computed from a default nobody entered — and
       the default moves (LargeMidcap's was ₹15,00,000 in September, ₹10,00,000 in
       October). The cycle record now carries the amount and whether it was typed;
       bookDiff() trusts last cycle's quantities only when it was. */
    var ent = !!window._capEntered;          // the sample's amount counts as entered (V39.3 B4: _capEntered = isDemo || saved)
    if (slot.cur.cap !== cap || slot.cur.entered !== ent){ slot.cur.cap = cap; slot.cur.entered = ent; dirty = true; }
    if (dirty) _saveBookHist(hist);
  } catch(e){}
}

/* V44.5 — WHAT THE MEMBER HOLDS, WHICH IS WHAT NEXT CYCLE'S SALE IS SIZED FROM. A quantity
   was always worked out afresh at this cycle's price, so a stock held into a new month
   drifted away from the shares actually held, with no order to explain it: bought 161,
   recorded 153 after a 5% rise, so a later sale left 8 behind, and after a fall it asked
   to sell more than the member had, which a broker rejects. A name kept at the same weight
   now keeps its shares (_carryHeld). A row split in this cycle counts the whole shares
   the old price bought, multiplied up. */
function _recordedQty(s, p, list, cap, when){
  if (Number(p.held) > 0) return Number(p.held);
  var price = Number(s.recommended_price) || 0;
  if (!(price > 0 && cap > 0)) return 0;
  var budget = allocBudget(s, list, cap), sp = s.split;
  if (sp && _boughtBeforeSplit(s, sp, when)) return Math.floor(Math.floor(budget / sp.was) * sp.f);
  return Math.floor(budget / price);
}
function _boughtBeforeSplit(s, sp, when){
  var tick = (loadBought(currentStrategy) || {})[s.ticker];
  if (tick && typeof tick === 'object' && tick.t) return !!tick.spl;
  return !(Date.parse(when) >= _splitOpenMs(sp));   // no tick: did this cycle start before it?
}
/* A name whose weight did not move gets no order, so its shares are what they were. A moved
   weight is a re-weight order (heldMovePP's test), which takes the holding to its target.
   Only quantities sized at an amount the member entered count as holdings (V42.1 — B5). */
function _carryHeld(slot, sub){
  var was = slot.prev, pos = slot.cur && slot.cur.pos;
  if (!was || !was.pos || !pos || !_histEntered(was, sub)) return;
  Object.keys(pos).forEach(function(t){
    var o = was.pos[t], n = pos[t];
    if (!o || !(Number(o.qty) > 0)) return;
    if (typeof o.w === 'number' && Math.abs((Number(n.w) || 0) - o.w) >= 0.05) return;
    n.qty = n.held = Number(o.qty);
  });
}

/* V42.1 — B5. Was this cycle record sized at an amount the member entered?
   Records written from V42.1 say so (`entered`). Older ones cannot: they count as
   entered only if this device holds an amount the member typed for the book, which
   is exactly the case in which the old code was right. */
function _histEntered(rec, sub){
  if (!rec) return false;
  if (typeof rec.entered === 'boolean') return rec.entered;
  return loadSavedCapital(sub && sub.strategy) > 0;
}

/* Returns {known, added[], removed[], held[], prevKey, prevWhen, prevPos} and, as
   a side effect, rolls the stored history forward. Deliberately called ONCE per
   render from renderDashboard: calling it twice in one paint would roll cur->prev
   again and report an empty diff. */
function bookDiff(sub, stocks){
  var out = { known:false, added:[], removed:[], held:[], prevKey:null, prevWhen:null, prevPos:null, rolled:false };
  var key = _cycleKey(sub);
  var tickers = (stocks || []).map(function(s){ return String(s.ticker || ''); }).filter(Boolean);
  if (!key || !tickers.length) return out;
  var strat = _bookHistStrat(sub && sub.strategy);
  var hist  = _loadBookHist();
  var slot  = hist[strat] || {};
  var pos   = _bookPos(stocks, Number(currentCapital) || 0);

  // ?demo — the fixture has to exercise this branch or the module is never seen
  // in local testing. Seeds a plausible previous cycle instead of the real one —
  // on every load (V40.0), so the sample always shows its own fixture's diff.
  if (isDemo){
    slot = { cur:{ key:key, tickers:tickers, pos:pos, when:new Date().toISOString(), entered:true },
             prev:{ key:'demo-prev', tickers:_demoPrevTickers(), pos:_demoPrevPos(),
                    when:new Date(Date.now()-31*864e5).toISOString(), entered:true } };
    if (demoMode === 'first') delete slot.prev;   // V44.4: no last month, so every surface takes its real first-cycle branch
  } else if (!slot.cur){
    slot.cur = { key:key, tickers:tickers, pos:pos, when:new Date().toISOString() };
    _carryHeld(slot, sub);                                 // V44.5 — a device that only knows the server's last cycle
  } else if (slot.cur.key !== key){
    slot.prev = slot.cur;                                  // the book rolled over
    slot.cur  = { key:key, tickers:tickers, pos:pos, when:new Date().toISOString() };
    _carryHeld(slot, sub);                                 // V44.5
    out.rolled = true;                                     // V35.3 — see migrateBoughtKeys
  } else {
    slot.cur.tickers = tickers;                            // same cycle, re-read
    // Backfill `pos` for a slot written before V35.3, and refresh `rec`/`y` in case
    // publish.py re-stamped the run. Existing quantities are preserved — the
    // member's capital is not known to be restored at this point in the render.
    var had = slot.cur.pos || {};
    Object.keys(pos).forEach(function(t){
      if (!had[t]) return;
      if (had[t].qty) pos[t].qty = had[t].qty;
      if (had[t].held) pos[t].held = had[t].held;   // V44.5
      if (had[t].spl) pos[t].spl = 1;
    });
    slot.cur.pos = pos;
  }
  hist[strat] = slot; _saveBookHist(hist);
  // V38.7 — mirror to the member's row. Only on a rollover or a first record:
  // a same-cycle re-read changes nothing the other device needs.
  if (out.rolled || !slot.prev) bookHistPush(strat, slot);

  if (!slot.prev || !slot.prev.tickers || !slot.prev.tickers.length) return out;
  var prev = slot.prev.tickers, prevSet = {}, curSet = {};
  prev.forEach(function(t){ prevSet[t] = 1; });
  tickers.forEach(function(t){ curSet[t] = 1; });
  out.known   = true;
  out.prevKey = slot.prev.key;
  out.prevWhen= slot.prev.when || null;
  out.prevPos = slot.prev.pos || null;
  // V42.1 — B5: last cycle's quantities are the member's holdings only if they were
  // sized at an amount the member entered. Otherwise every reader below sees them
  // blank, and the existing unknown-quantity paths take over: a sale with no number
  // (placed by hand, never basketed), V41.9's rwUnknown and its Match line, and a
  // cost card that cannot compute a realised gain. Weights and prices stay.
  out.prevQtyKnown = isDemo || _histEntered(slot.prev, sub);
  if (!out.prevQtyKnown && out.prevPos){
    var _blank = {};
    Object.keys(out.prevPos).forEach(function(t){
      var q = out.prevPos[t] || {}, c = {};
      Object.keys(q).forEach(function(k){ c[k] = q[k]; });
      c.qty = 0; _blank[t] = c;
    });
    out.prevPos = _blank;
  }
  out.added   = tickers.filter(function(t){ return !prevSet[t]; });
  out.held    = tickers.filter(function(t){ return  prevSet[t]; });
  out.removed = prev.filter(function(t){ return !curSet[t]; });
  return out;
}

/* ── THE CYCLE'S ORDER LIST — ONE WRITER FOR EVERY SURFACE THAT ACTS ──────────
   V35.2 gave the page a diff and told three surfaces about it: a card, two KPI
   tiles and a row badge. Everything that ACTS on the book was left reading
   stocksData, so the page described a four-order month beside a button that sent
   ten buys — eight of them for positions the card above called "carried over
   untouched", and none of them the two sells it had just named.
   This is the single list every one of those surfaces now reads: the basket, the
   tick-boxes, the progress bar, the how-to's live line, the CSV and the copy
   button. A first cycle (or a device with no history) has no diff, and there the
   book IS the order list — which is exactly true for that member — so `known`
   false falls back to the whole book rather than to an empty basket.
   Sell quantities come from the previous cycle's recorded position; a record
   without one yields a sell the member can tick and open at their broker but
   which cannot be basketed, because a basket row without a quantity is a
   guess about how much of their money to move.
   V43.8 — this is now the REBALANCE: the list for a member who still holds last
   month's book. cycleOrders(), below it, applies what the member said in Step 3
   (rebalance, buy all, or pick stocks), and is what every surface that acts reads.
   The change card and the cost card describe the model's month, and read this. */
function rebalanceOrders(){
  var out = { known:false, buys:[], sells:[], all:[], sellSized:0, sellUnsized:0 };
  var list = stocksData || [];
  if (!list.length) return out;
  var cap  = Number(currentCapital) || 0;
  var diff = window._bookDiff || null;
  var byTicker = {};
  list.forEach(function(s){ byTicker[String(s.ticker || '')] = s; });

  var mkBuy = function(s){ return _mkBuyOrder(s, list, cap); };

  // V39.5 — B1/B2. A restricted name gets no order on either side, ever; a sale
  // still inside the member's minimum holding period waits in `holdBack` (with its
  // date) and joins no list, basket, count or CSV until that date.
  out.holdBack = [];
  var okBuy = function(s){ return !_isRestricted(s && s.ticker); };
  if (!diff || !diff.known){
    out.buys = list.filter(okBuy).map(mkBuy);
    out.all  = out.buys.slice();
    return out;
  }

  out.known = true;
  out.buys = diff.added.map(function(t){ return byTicker[t]; }).filter(Boolean).filter(okBuy).map(mkBuy);

  var pp = diff.prevPos || {};
  var sellable = diff.removed.filter(function(t){
    if (_isRestricted(t)) return false;
    var until = _csHoldUntil(t);
    if (until){ var p0 = pp[t] || {}; out.holdBack.push({ ticker:String(t).toUpperCase(), name:p0.n || t, qty:Number(p0.qty) || 0, until:until }); return false; }
    return true;
  });
  out.sells = sellable.map(function(t){
    var p = pp[t] || {};
    var qty = Number(p.qty) || 0;
    if (qty > 0) out.sellSized++; else out.sellUnsized++;
    return { side:'SELL', ticker:String(t).toUpperCase(), name:p.n || t,
             y:p.y || '', price:Number(p.rec) || 0, qty:qty, stock:null };
  });
  /* V35.4 — SELLS FIRST, and the order is load-bearing rather than cosmetic.
     Kite caps a basket at ten instruments, so a heavy-turnover cycle is split and
     whatever sits at the end of this array is what gets deferred. With buys first,
     an 8-buy / 7-sell month sent eight buys and two sells and held back five
     sells — wrong twice over. The member funds those buys partly out of the sale
     proceeds, so putting the buys first asks them to commit cash that has not
     arrived; and the sells are the model saying "get out of these", which makes
     them the orders that should sit longest if any must. Selling first is also
     what any human would do by hand. */
  /* V41.9 — A1. THE RE-WEIGHTS, AS ORDERS.
     A held name whose model weight moved still has work in it: the name stays,
     the size changes. Until now nothing here made an order for it, so MultiAsset,
     which keeps the same eight ETFs every month and only rotates their weights,
     never produced a basket after month one. The member got "8 to re-weight" and
     a chart link, and did the subtraction by hand against their broker. The
     answer was already on this page: target = the Shares column's own
     expression, held = the quantity this dashboard recorded last cycle (the same
     record that sizes a stock book's sell tickets). The difference is a trim
     (sell) or an add (buy).
     All or nothing: if any moved name has no recorded quantity, there are no
     re-weight orders this cycle and `rwUnknown` says so; a half-sized basket is
     worse than none, and Match my holdings computes them from a pasted file.
     The employer rules apply exactly as they do to a sale: no order for a
     restricted name, and a trim inside the holding period waits in holdBack.
     An equal-weight book in an ordinary cycle has no moved names, so its orders
     are byte-identical to before. */
  out.trims = []; out.adds = []; out.rw = []; out.rwFlat = [];
  out.rwKnown = false; out.rwUnknown = false;
  var moved = diff.held.filter(function(t){ return heldMovePP(t) != null && !_isRestricted(t); });
  if (moved.length){
    var sized = cap > 0 && moved.every(function(t){ var p = pp[t]; return !!(p && Number(p.qty) > 0 && byTicker[t]); });
    if (!sized) out.rwUnknown = true;
    else {
      out.rwKnown = true;
      moved.forEach(function(t){
        var s = byTicker[t], p = pp[t];
        var price = Number(s.recommended_price) || 0;
        var target = price > 0 ? Math.floor(allocBudget(s, list, cap) / price) : 0;
        var held = Number(p.qty) || 0, d = target - held;
        var T = String(t).toUpperCase();
        var o = { side: d < 0 ? 'SELL' : 'BUY', ticker:T, name:s.company_name || p.n || t,
                  y:s.yahoo_ticker || p.y || '', price:price, qty:Math.abs(d), stock:s,
                  rw:true, from:held, to:target };
        if (!d){ out.rwFlat.push(o); return; }
        if (d < 0){
          var until = _csHoldUntil(t);
          if (until){ out.holdBack.push({ ticker:T, name:o.name, qty:o.qty, until:until, rw:true }); return; }
          out.trims.push(o);
        } else out.adds.push(o);
      });
      out.rw = out.trims.concat(out.adds);
    }
  }
  // Names leaving, then trims, then new names, then adds: every sale funds a buy.
  out.all = out.sells.concat(out.trims, out.buys, out.adds);
  return out;
}
/* One name, bought at the Shares column's own expression. */
function _mkBuyOrder(s, list, cap){
  var price = Number(s.recommended_price) || 0;
  var qty   = (price > 0 && cap > 0) ? Math.floor(allocBudget(s, list, cap) / price) : 0;
  return { side:'BUY', ticker:String(s.ticker || '').toUpperCase(), name:s.company_name || s.ticker,
           y:s.yahoo_ticker || '', price:price, qty:qty, stock:s };
}
/* V43.8 — THE MEMBER'S ORDER LIST: the rebalance, the whole book, or what they ticked
   (orderModeState). `mode` says which, for the sentences that describe it. Buy all has
   the shape of a first cycle (known false, the book is the list, nothing to sell), so
   every surface already says the right thing about it; Pick keeps the rebalance's
   held-back sales and re-weight flags and carries only the ticked orders. */
function cycleOrders(){
  var base = rebalanceOrders();
  var om = orderModeState();
  if (om.m === 'fresh' && base.known){
    var buys = wholeBookOrders();
    return { known:false, mode:'fresh', buys:buys, sells:[], all:buys.slice(), sellSized:0, sellUnsized:0,
             holdBack:[], trims:[], adds:[], rw:[], rwFlat:[], rwKnown:false, rwUnknown:false };
  }
  if (om.m === 'pick'){
    var pk = om.p || {};
    var chosen = pickCandidates(base).filter(function(o){ return !!pk[orderKey(o)]; });
    var out = { known:base.known, mode:'pick', holdBack:base.holdBack || [], rwFlat:base.rwFlat || [],
                rwKnown:!!base.rwKnown, rwUnknown:!!base.rwUnknown, sellSized:0, sellUnsized:0 };
    out.sells = chosen.filter(function(o){ return o.side === 'SELL' && !o.rw; });
    out.trims = chosen.filter(function(o){ return o.side === 'SELL' && !!o.rw; });
    out.buys  = chosen.filter(function(o){ return o.side === 'BUY' && !o.rw; });
    out.adds  = chosen.filter(function(o){ return o.side === 'BUY' && !!o.rw; });
    out.rw    = out.trims.concat(out.adds);
    out.sells.forEach(function(o){ if (o.qty > 0) out.sellSized++; else out.sellUnsized++; });
    out.all   = out.sells.concat(out.trims, out.buys, out.adds);
    return out;
  }
  base.mode = base.known ? 'rebal' : 'fresh';
  return base;
}

/* The demo fixture's "last month". Per MODE, because ?demo=2 is the MultiAsset ETF
   book and handing it the equity fixture would print a nonsense 8-in / 10-out cycle
   — the exact stale-fixture failure V33.9 called out, where demo mode stops
   exercising the branch it exists to exercise.
     ?demo=1  LargeMidcap's median month: half of MFTURN:lm:median names swapped
              in each direction (V41.9: 6 in / 6 out / 9 held at the 12-order median)

              V38.7 — THIS USED TO BE 2 IN / 2 OUT, AND THAT WAS THE LIGHTEST
              MONTH IN THE WHOLE RECORD SHOWN AS THE TYPICAL ONE. The sample
              dashboard is what a prospect judges the workload by. The rule set
              then: the fixture sits on LargeMidcap's measured median month.
              V41.9 — A2. THAT RULE BROKE WHEN THE BOOK GREW. The median was 8
              for a ten-name book; V40.0 made it fifteen names, the fixture was
              widened to fifteen but kept 4 in / 4 out, and the real median became
              12 (MFTURN:lm:median, printed on the homepage as "typically ... 12
              on LargeMidcap 250"). The sample showed two-thirds of a real month
              and one Kite basket where the real month needs two. The swap count
              is now READ from that marker (#mfrisk, rewritten every publish), so
              a typed count cannot drift from it again; the pools below are long
              enough for a median of 14, and the numbers gate checks that they
              stay long enough.
     ?demo=2  the ETF sleeve is fixed and only its WEIGHTS rotate, which is what
              MultiAsset actually does -> 0 in / 0 out / 8 held, i.e. the
              "nothing to trade" branch, which nothing else here would reach. */
// Current-fixture names that can be "new this cycle", and last month's names that
// leave, each in the order they are used. Both books stay within two per industry
// for every swap count up to seven (COALINDIA pairs with HINDALCO in Metals &
// Mining; ONGC and GRASIM fill industries the current book's new names vacate).
var _DEMO_LM_NEW   = ['RELIANCE','BHARTIARTL','SUNPHARMA','LT','NTPC','POWERGRID','ULTRACEMCO'];
var _DEMO_LM_LEAVE = ['TITAN','ASIANPAINT','NESTLEIND','HINDUNILVR','COALINDIA','ONGC','GRASIM'];
function _demoSwapN(){
  var m = 0;
  try { var el = document.querySelector('#mfrisk [data-k="lm:median"]'); m = parseInt(el && el.textContent, 10) || 0; } catch (e) {}
  if (!(m > 0)) m = 12;
  return Math.max(1, Math.min(_DEMO_LM_NEW.length, _DEMO_LM_LEAVE.length, Math.round(m / 2)));
}
function _demoPrevTickers(){
  if (demoMode === '2') return ['MON100','HDFCSML250','JUNIORBEES','MID150BEES','EBBETF0431','GOLDBEES','SILVERBEES','NIFTYBEES'];
  var k = _demoSwapN(), gone = _DEMO_LM_NEW.slice(0, k);
  var cur = (stocksData || []).map(function(s){ return String(s.ticker || ''); }).filter(Boolean);
  if (!cur.length) cur = ['INFY','TCS','HDFCBANK','ICICIBANK','MARUTI','M&M','RELIANCE','BHARTIARTL','SUNPHARMA','LT','BAJFINANCE','ULTRACEMCO','NTPC','POWERGRID','HINDALCO'];
  return cur.filter(function(t){ return gone.indexOf(t) === -1; }).concat(_DEMO_LM_LEAVE.slice(0, k));
}
/* V35.3 — the previous cycle's POSITIONS for the fixture, so ?demo exercises the
   sell basket, the realised-gain arithmetic and the cost row rather than only the
   counts. Prices are a month older than the current fixture's (that is the whole
   point — a sell with no cost basis realises nothing), and quantities are the
   ones a ₹10,00,000 book at 10% a name actually buys, so the demo's sell tickets
   reconcile against its own Shares column the way a real cycle's do. */
function _demoPrevPos(){
  var mk = function(rows){
    var o = {};
    rows.forEach(function(r){ o[r[0]] = { y:r[0] + '.NS', rec:r[1], qty:r[2], w:r[3], n:r[4] }; });
    return o;
  };
  // ?demo=2 carries LAST cycle's weights, deliberately different from the current
  // fixture's. MultiAsset's whole cycle IS the weight rotation, so a fixture whose
  // previous weights matched today's would show zero turnover and never exercise
  // the rebalance leg of the cost row.
  // V41.9 — A1: the quantities are what LAST cycle's weights bought at this sample's
  // own ₹1,00,000 — floor(1,00,000 × w / price) — because the re-weight orders are
  // target minus this. (They were sized for no single capital, which would have
  // shown a nonsense sale of hundreds of shares.) At ₹1,00,000 the sample's month
  // is 7 orders, one basket: trims of JUNIORBEES 2, MID150BEES 10, EBBETF0431 2 and
  // NIFTYBEES 7, then adds of MON100 13, HDFCSML250 15 and GOLDBEES 7; SILVERBEES
  // moves +0.2 pp and stays at 20 shares.
  if (demoMode === '2') return mk([
    ['MON100',     291.44,   85, 24.80, 'NASDAQ ETF'],
    ['HDFCSML250', 176.12,   74, 13.05, 'Nifty SmallCap 250 ETF'],
    ['JUNIORBEES', 812.30,   15, 12.90, 'Nifty Next 50 ETF'],
    ['MID150BEES', 233.05,   62, 14.62, 'Nifty Midcap 150 ETF'],
    ['EBBETF0431', 1432.10,   7, 11.44, 'Bharat Bond ETF'],
    ['GOLDBEES',   112.68,  141, 15.90, 'Gold ETF'],
    ['SILVERBEES', 198.44,   20,  4.05, 'Silver ETF'],
    ['NIFTYBEES',  274.90,   11,  3.24, 'Nifty 50 ETF']
  ]);
  // Quantities are floor(66,666 / price) — what a 10,00,000 book at 6.67% a name
  // actually buys (V40.0: fifteen names, was ten at 10%) — so the demo's sell tickets
  // reconcile against its own Shares column. V41.9 — A2: this is every name last
  // month's book can hold; _demoPrevTickers() picks the book for the median swap
  // count (at the 12-order median: the nine that carry over, and TITAN, ASIANPAINT,
  // NESTLEIND, HINDUNILVR, COALINDIA and ONGC leaving), and only those positions
  // are returned. The previous book honours the 2-per-industry cap at every count.
  var keep = {};
  _demoPrevTickers().forEach(function(t){ keep[t] = 1; });
  var all = mk([
    ['INFY',        1498.00,   44, 6.67, 'Infosys'],
    ['TCS',         3755.00,   17, 6.67, 'Tata Consultancy Services'],
    ['HDFCBANK',    1640.50,   40, 6.67, 'HDFC Bank'],
    ['ICICIBANK',   1172.00,   56, 6.67, 'ICICI Bank'],
    ['MARUTI',     11640.00,    5, 6.67, 'Maruti Suzuki India'],
    ['M&M',         2848.00,   23, 6.67, 'Mahindra & Mahindra'],
    ['BAJFINANCE',   921.30,   72, 6.67, 'Bajaj Finance'],
    ['ULTRACEMCO', 11480.00,    5, 6.67, 'UltraTech Cement'],
    ['NTPC',         351.20,  189, 6.67, 'NTPC'],
    ['POWERGRID',    305.10,  218, 6.67, 'Power Grid Corporation'],
    ['HINDALCO',     689.90,   96, 6.67, 'Hindalco Industries'],
    ['TITAN',       3402.00,   19, 6.67, 'Titan Company'],
    ['ASIANPAINT',  2410.00,   27, 6.67, 'Asian Paints'],
    ['NESTLEIND',   2240.00,   29, 6.67, 'Nestle India'],
    ['HINDUNILVR',  2378.00,   28, 6.67, 'Hindustan Unilever'],
    ['COALINDIA',    385.40,  172, 6.67, 'Coal India'],
    ['ONGC',         246.30,  270, 6.67, 'Oil and Natural Gas Corporation'],
    ['GRASIM',      2652.00,   25, 6.67, 'Grasim Industries']
  ]);
  var out = {};
  Object.keys(all).forEach(function(t){ if (keep[t]) out[t] = all[t]; });
  return out;
}

/* ── V35.3 · THE COST OF THE TURNOVER THE PAGE INSTRUCTS ──────────────────────
   One-way trading cost per strategy, mirroring IP/shared/config.py so the
   dashboard and the published backtest quote ONE assumption rather than two.
   LargeMidcap 10 bps and SmallMicro 20 bps are that file's TRANSACTION_COST
   values verbatim. MultiAsset's backtest models no trading cost at all — its
   config block has no TRANSACTION_COST — so rather than borrowing a number the
   backtest never used, its row is labelled as an assumption in its own right and
   the note says so. Getting this wrong in the flattering direction is the failure
   mode that matters, so where a strategy is unrecognised the higher figure is
   used, never the lower. */
var CYCLE_COST_BPS = {
  lm: { bps: 10, src: 'modelled' },
  sm: { bps: 20, src: 'modelled' },
  ma: { bps: 10, src: 'assumed'  }
};
var STCG_RATE = 0.20;   // s.111A (s.196 of the Income-tax Act, 2025 from Apr 2026), the post-23-Jul-2024 regime; config.py TAX.STCG_RATE

/* V40.1 — A7. MULTIASSET IS NOT TAXED AT 20%. Its Indian equity ETFs are; its
   Nasdaq-100, gold and silver ETFs pay the member's SLAB rate on short-term
   gains, and its bond ETF pays the slab rate however long it is held. The cost
   card used to apply 20% to every sale — and, because MultiAsset never swaps a
   holding (it only re-weights the same eight), it found no "sells" at all and
   printed "₹0 · no gain realised" under a rebalance that trims winners. The
   ticker map is fixed (the universe is eight ETFs); an unknown ticker gets no
   estimate rather than a guessed rate. The slab is the member's own answer,
   kept on this device only (the backend's prefs entry accepts no new field). */
var MA_TAX_CLASS = { NIFTYBEES:'eq', JUNIORBEES:'eq', MID150BEES:'eq', HDFCSML250:'eq',
                     MON100:'slab', GOLDBEES:'slab', SILVERBEES:'slab', EBBETF0431:'slab' };
var TAX_SLABS = [30, 25, 20, 15, 10, 5];
function _taxSlab(){
  try { var v = Number(localStorage.getItem(_devKey('mfc_tax_slab'))); if (TAX_SLABS.indexOf(v) > -1) return v; } catch (e) {}
  return 30;
}
function setTaxSlab(v){
  v = Number(v); if (TAX_SLABS.indexOf(v) < 0) return;
  try { localStorage.setItem(_devKey('mfc_tax_slab'), String(v)); } catch (e) {}
  renderCycleCost();
}

/* Three legs, because there are three ways money moves in a rebalance:
     BUY      the names joining, at their published price x the member's shares
     SELL     the names leaving, at the live price where we have one and the price
              they entered at where we do not, x the shares actually held
     REBALANCE  a weighted book keeps its holdings and rotates their targets. The
              only honest measure of that is the WEIGHT change — half the sum of
              |w_new - w_prev|, the standard one-way turnover figure — because
              quantities also move when the member changes their capital, and a
              change of capital is not a rebalance.
   Every leg degrades to zero rather than to a guess: no recorded position means
   no sell leg, no recorded weights means no rebalance leg, and the note says
   which of them is missing. */
function renderCycleCost(){
  var box = document.getElementById('chg-cost');
  if (!box) return;
  var diff = window._bookDiff, list = stocksData || [];
  var cap  = Number(currentCapital) || 0;
  if (!diff || !diff.known || !list.length || cap <= 0){ box.hidden = true; return; }

  var key  = _strategyPerfKey(currentStrategy || '');
  var cost = CYCLE_COST_BPS[key] || { bps: 20, src: 'assumed' };
  var px   = window._livePx || {};
  var pp   = diff.prevPos || {};
  var byTicker = {}; list.forEach(function(s){ byTicker[String(s.ticker || '')] = s; });

  // BUY leg — the same expression the Shares column prints, so the two reconcile.
  var buyVal = 0;
  diff.added.forEach(function(t){
    var s = byTicker[t]; if (!s) return;
    var price = Number(s.recommended_price) || 0; if (price <= 0) return;
    // V44.2 — rounded per row, as the Kite band sums them: raw floats printed ₹3,93,846 beside its ₹3,93,847
    buyVal += Math.round(Math.floor(allocBudget(s, list, cap) / price) * price);
  });

  /* SELL leg — and the realised short-term gain that comes with it.
     A gain is only KNOWN when every departing holding has both a recorded cost
     basis and a live price. Falling back to the entry price where a quote is
     missing keeps the traded VALUE roughly right, but it makes that holding's
     gain exactly zero — and a zero that means "we could not price this" must not
     be printed beside the words "realised loss". Where any leg is unpriced the
     tile says so instead. */
  var sellVal = 0, gain = 0, gainKnown = true, sellSized = 0;
  // V39.5 — a restricted name is never sold here, and a held-back sale is not this cycle's.
  var goneNow = diff.removed.filter(function(t){ return !_isRestricted(t) && !_csHoldUntil(t); });
  goneNow.forEach(function(t){
    var p = pp[t] || {}, qty = Number(p.qty) || 0, rec = Number(p.rec) || 0;
    if (!(qty > 0) || !(rec > 0)){ gainKnown = false; return; }
    sellSized++;
    var q = px[p.y], live = (q && Number(q.price) > 0) ? Number(q.price) : 0;
    if (!live){ gainKnown = false; live = rec; }
    sellVal += Math.round(qty * live);
    gain    += qty * (live - rec);
  });
  if (goneNow.length && !sellSized) gainKnown = false;
  if (!goneNow.length) gainKnown = true;   // nothing sold, nothing realised

  // REBALANCE leg — held names whose model weight moved.
  var rebFrac = 0, rebKnown = false, wDelta = 0, wSeen = 0;
  diff.held.forEach(function(t){
    var s = byTicker[t], p = pp[t];
    if (!s || !p || typeof p.w !== 'number') return;
    wSeen++;
    wDelta += Math.abs((Number(s.weight_pct) || 0) - p.w);
  });
  if (wSeen && wSeen === diff.held.length){ rebKnown = true; rebFrac = wDelta / 200; }
  var rebVal = rebKnown ? rebFrac * cap : 0;
  /* V41.9 — A1. Once the re-weights are sized they are real orders, so the leg is
     their value, both sides, the way the buys and sells above are counted: "X% of
     your capital changes hands" then means the same thing on every book. Their
     trims are sales, so their gains are taxed below. An ordinary cycle has none. */
  var ocC = rebalanceOrders(), rwC = ocC.rw || [], rwTrims = ocC.trims || [];   // V43.8 — the model's month
  var rwSold = 0, rwBought = 0;
  if (rwC.length){
    rwC.forEach(function(o){ var v = o.qty * (o.price || 0); if (o.side === 'SELL') rwSold += v; else rwBought += v; });
    rebVal = rwSold + rwBought;
    if (key !== 'ma') rwTrims.forEach(function(o){
      var p = pp[o.ticker] || {}, rec = Number(p.rec) || 0;
      var q = px[p.y || o.y], live = (q && Number(q.price) > 0) ? Number(q.price) : 0;
      if (!(rec > 0) || !live){ gainKnown = false; return; }
      gain += o.qty * (live - rec);
    });
  }

  var traded  = buyVal + sellVal + rebVal;
  if (traded <= 0){ box.hidden = true; return; }
  var charges = traded * (cost.bps / 10000);
  var tax     = gain > 0 ? gain * STCG_RATE : 0;

  // V40.1 — A7. MultiAsset: the TRIMS are the sales. Each held ETF whose model
  // weight fell gives up (w_prev - w_new)% of the capital; the gain on that slice
  // is its share of the move since the price it was recorded at. Rated per ETF.
  var maTax = null;
  if (key === 'ma' && rwC.length){
    // V41.9 — A1: the trims ARE the sales, in shares, each rated by its own ETF
    var slab = _taxSlab(), eqGain = 0, slGain = 0, unknown = 0;
    rwTrims.forEach(function(o){
      var p = pp[o.ticker] || {}, cls = MA_TAX_CLASS[String(o.ticker).replace(/\.NS$/, '')];
      var q = px[p.y || o.y], live = (q && Number(q.price) > 0) ? Number(q.price) : (Number(o.price) || 0);
      var rec = Number(p.rec) || 0;
      if (!cls || !(live > 0) || !(rec > 0)){ unknown++; return; }
      var g = o.qty * (live - rec);
      if (cls === 'eq') eqGain += g; else slGain += g;
    });
    maTax = { known: unknown === 0, noTrims: !rwTrims.length, eqGain: eqGain, slGain: slGain, slab: slab,
              tax: Math.max(0, eqGain) * STCG_RATE + Math.max(0, slGain) * (slab / 100) * 1.04 };
  } else if (key === 'ma' && rebKnown && rebVal > 0){
    var slab = _taxSlab(), eqGain = 0, slGain = 0, unknown = 0, trimmed = 0;
    diff.held.forEach(function(t){
      var s = byTicker[t], p = pp[t];
      if (!s || !p || typeof p.w !== 'number') return;
      var give = p.w - (Number(s.weight_pct) || 0);
      if (!(give > 0)) return;
      trimmed++;
      var cls = MA_TAX_CLASS[String(t).replace(/\.NS$/, '')];
      var q = px[p.y], live = (q && Number(q.price) > 0) ? Number(q.price) : (Number(s.recommended_price) || 0);
      var rec = Number(p.rec) || 0;
      if (!cls || !(live > 0) || !(rec > 0)){ unknown++; return; }
      var g = (give / 100) * cap * (live - rec) / live;
      if (cls === 'eq') eqGain += g; else slGain += g;
    });
    maTax = { known: unknown === 0 && trimmed > 0, eqGain: eqGain, slGain: slGain, slab: slab,
              tax: Math.max(0, eqGain) * STCG_RATE + Math.max(0, slGain) * (slab / 100) * 1.04 };
  }

  var chip = document.getElementById('cc-chip');
  // "% of your book turns over" would overstate it: this counts BOTH legs, so a
  // 2-in-2-out month on a ten-name book reads 40% while only two holdings in ten
  // actually change. What the figure measures is money changing hands.
  if (chip) chip.textContent = (traded / cap * 100).toFixed(1) + '% of your capital changes hands';

  var cell = function(lbl, val, sub, nil){
    return '<div class="cc-cell"><div class="cc-lbl">' + lbl + '</div>' +
      '<div class="cc-val' + (nil ? ' is-nil' : '') + '">' + val + '</div>' +
      (sub ? '<div class="cc-sub">' + sub + '</div>' : '') + '</div>';
  };
  var grid = document.getElementById('cc-grid');
  if (grid){
    var legs = [];
    if (sellVal > 0) legs.push(fmtMoney(Math.round(sellVal)) + ' sold');
    if (buyVal  > 0) legs.push(fmtMoney(Math.round(buyVal))  + ' bought');
    // V42.1 — B5: a sale with no known quantity is not in the total; say so
    var _unsz = diff.prevQtyKnown === false ? goneNow.length : 0;
    if (_unsz) legs.push(_unsz + (_unsz === 1 ? ' sale' : ' sales') + ' not sized');
    if (rwC.length){                                   // V41.9 — A1
      if (rwSold   > 0) legs.push(fmtMoney(Math.round(rwSold))   + ' trimmed');
      if (rwBought > 0) legs.push(fmtMoney(Math.round(rwBought)) + ' added');
    } else if (rebVal  > 0) legs.push(fmtMoney(Math.round(rebVal))  + ' rebalanced');
    grid.innerHTML =
      cell('Value traded', fmtMoney(Math.round(traded)), legs.join(' &middot; ')) +
      cell('Estimated charges', '~' + fmtMoney(Math.round(charges)),
           cost.bps + '&nbsp;bps a side, ' + (cost.src === 'modelled'
             ? 'the figure the published backtest is net&nbsp;of'
             : 'assumed for liquid&nbsp;ETFs')) +
      (maTax && maTax.noTrims
        ? cell('Short-term tax', fmtMoney(0), 'nothing sold this cycle', true)
        : maTax
        ? (maTax.known
            ? (maTax.tax > 0.5
                ? cell('Short-term tax', '~' + fmtMoney(Math.round(maTax.tax)),
                       '20% on ' + fmtMoney(Math.round(Math.max(0, maTax.eqGain))) + ' &middot; ' +
                       (maTax.slab * 1.04).toFixed(1).replace(/\.0$/, '') + '% on ' + fmtMoney(Math.round(Math.max(0, maTax.slGain))))
                : cell('Short-term tax', fmtMoney(0), 'the trims realise no net gain', true))
            : cell('Short-term tax', '&mdash;', 'needs last cycle&rsquo;s price for each trimmed ETF', true))
        : (!gainKnown && diff.prevQtyKnown === false && (goneNow.length || rwTrims.length || ocC.rwUnknown))
        ? cell('Short-term tax', '&mdash;',      // V42.1 — B5: needs holdings, not prices
               'needs your holdings: <button type="button" class="chg-hint-btn" onclick="_rwOpenMatch()">Match my holdings</button> works it out', true)
        : !gainKnown
        ? cell('Short-term tax', '&mdash;',
               (goneNow.length || rwTrims.length) ? 'needs a live price for each sale' : 'nothing sold this cycle', true)
        : gain > 0.5
          ? cell('Short-term tax', '~' + fmtMoney(Math.round(tax)),
                 '20% on ' + fmtMoney(Math.round(gain)) + ' realised')
          : gain < -0.5
            ? cell('Short-term tax', fmtMoney(0),
                   fmtMoney(Math.round(Math.abs(gain))) + ' realised loss — set it off against other short-term gains', true)
            : cell('Short-term tax', fmtMoney(0), 'no gain realised this cycle', true));
  }
  var note = document.getElementById('cc-note');
  if (note){
    // V42.1 — B6: "you entered" only when they did (V39.3 B4's words otherwise)
    note.innerHTML = (window._capEntered ? 'Estimates, at the capital you entered.' : 'Estimates, at the starting amount, not one you entered.') + ' Charges are a single ' + cost.bps +
      '&nbsp;bps-a-side assumption; your broker’s plan, STT, stamp duty, exchange and SEBI fees and GST are not itemised. ' +
      (key === 'ma'
        ? 'Tax: the Indian equity ETFs pay the 20% short-term rate; the Nasdaq-100, gold, silver and bond ETFs pay your ' +
          'income-tax slab plus 4% cess — estimated on the weight each ETF gives up this cycle. ' +
          '<label class="cc-slab">Your slab <select id="cc-slab" onchange="setTaxSlab(this.value)">' +
          TAX_SLABS.map(function(v){ return '<option value="' + v + '"' + (v === _taxSlab() ? ' selected' : '') + '>' + v + '%</option>'; }).join('') +
          '</select></label> '
        : 'Tax is the 20% short-term rate on gains realised by the sells above ' +
          '— every book here rebalances monthly, so no gain is ever long term. ') +
      '<a href="disclosures.html#' + (key === 'ma' ? 'ma-slab' : 'backtest-methodology') + '" target="_blank" rel="noopener">How the published figures treat cost and tax &rarr;</a>';
  }
  box.hidden = false;
}

/* ══ V37.3 · THE FIRST SENTENCE ON THE PAGE WAS THE ONE FACT NOTHING DERIVED ══
   `#dash-subtitle` has read "Here are this cycle's picks for your strategy.
   Place them in your broker and you're done for the month." since this page
   shipped. It carries an id and nothing has ever written to it.
   For a member in their first cycle that is exactly right. For everybody else it
   is the page contradicting itself in its most-read line: the KPI tile two
   inches below says "Orders to place 4 · 2 buys · 2 sells" and the change card
   says "That is 4 orders to place, not 10", while the sentence above both still
   says place THEM — all ten, including the eight the member already owns and
   must not touch. Same seam as every other hand-written label beside a machine
   number on this site, and this one is in the position a member reads first.
   Every input is already computed by the two callers, so nothing new is derived
   and nothing can disagree: renderBookChange() owns the diff and the counts,
   refreshBoughtProgress() owns how many of them are ticked. With no diff on
   record the original sentence is restored verbatim — an unknown previous book
   must not be reported as "nothing to do". ═══════════════════════════════════ */
var HERO_SUB_DEFAULT = "Here are this cycle\u2019s picks for your strategy. Place them in your broker and you\u2019re done for the month.";
function renderHeroJob(){
  var el = document.getElementById('dash-subtitle');
  if (!el) return;
  // V41.6 — A3: every caller of this line (render, book change, each tick) also
  // re-decides the cycle card's late-joiner line, so a first tick removes it.
  try { _renderLateJoin(); } catch (e) {}
  /* V39.1 — B7. A DASHBOARD THAT ENDS. Once every order this cycle is ticked, the
     first line on the page says there is nothing to do, and until when — the
     state a time-poor member is actually trying to reach. */
  try {
    var _oc = cycleOrders(), _bm = loadBought(currentStrategy) || {};
    var _ks = _oc.all.map(orderKey), _nd = _ks.filter(function(k){ return !!_bm[k]; }).length;
    if (_ks.length && _nd === _ks.length){
      var _nr = window._cycDates && window._cycDates.reb;
      el.textContent = 'Everything this cycle is placed. Nothing to do until ' +
        (_nr && !isNaN(_nr.getTime()) ? mfDate(_nr, { day:'numeric', month:'short' }) : 'the next rebalance') + '.';
      return;
    }
  } catch (e) {}
  /* V43.8 — the line follows the member's answer in Step 3. Unanswered, it says
     what is being asked; Buy all and Pick stocks count their own lists. */
  try {
    var _omS = orderModeState(), _dkn = !!(window._bookDiff && window._bookDiff.known);
    if (_dkn && !_omS.m){
      el.textContent = 'This month\u2019s picks are in. Tell Step 3 whether you still hold last month\u2019s book, and it lists your orders.';
      return;
    }
    if (_dkn && (_omS.m === 'fresh' || _omS.m === 'pick')){
      var _oo = cycleOrders(), _mo = loadBought(currentStrategy) || {};
      var _lft = _oo.all.filter(function(o){ return !_mo[orderKey(o)]; });
      var _lb = _lft.filter(function(o){ return o.side === 'BUY'; }).length, _ls = _lft.length - _lb;
      var _of = _lft.length < _oo.all.length ? _lft.length + ' of ' + _oo.all.length : String(_oo.all.length);
      if (_omS.m === 'fresh'){
        el.textContent = 'Buying the whole book: ' + _of + ' buy order' + (_oo.all.length === 1 ? '' : 's') +
          (_lft.length < _oo.all.length ? ' left' : '') + ' to place.';
      } else if (!_oo.all.length){
        el.textContent = 'Pick stocks: tick what to buy or sell in Step 3, and your orders follow.';
      } else {
        el.textContent = (_lft.length < _oo.all.length
            ? _lft.length + ' of the ' + _oo.all.length + ' orders you ticked left to place'
            : _oo.all.length + ' order' + (_oo.all.length === 1 ? '' : 's') + ' you ticked to place') +
          ' \u2014 ' + [_ls ? _ls + '\u00a0to sell' : '', _lb ? _lb + '\u00a0to buy' : ''].filter(Boolean).join(_ls && _lb ? ' first, then ' : '') + '.';
      }
      return;
    }
  } catch (e) {}
  var diff  = window._bookDiff;
  var total = (stocksData || []).length;
  if (!diff || !diff.known || !total){
    /* V41.6 — A3. A first cycle joined mid-month is not "done for the month": the
       next set lands within weeks, and the cycle card sets out the choice. Every
       other unknown-diff case (a fresh book, a new device, MultiAsset, a pinned
       plan, the sample) keeps the original sentence verbatim. */
    var _lj = _lateJoinState();
    el.textContent = _lj.show
      ? 'Here are this cycle’s picks. The next set lands on ' + mfDate(_lj.nextReb, { day: 'numeric', month: 'short' }) +
        ' — the card below sets out placing them now or then.'
      : HERO_SUB_DEFAULT;
    return;
  }

  /* V39.5 — B1/B2: counted from the member's order list, not the raw diff — a
     restricted name gets no order and a held-back sale is not today's. With no
     rule set these are exactly the diff's counts, so the line is unchanged. */
  var _ocH = cycleOrders();
  var nIn = _ocH.buys.length, nOut = _ocH.sells.length;
  var nHold = diff.held.filter(function(t){ return !_isRestricted(t); }).length;
  var nHb = (_ocH.holdBack || []).length;
  total = memberBook(stocksData || []).length || total;
  var orders = nIn + nOut;
  var plural = function(n, one, many){ return n + '\u00a0' + (n === 1 ? one : many); };
  /* V41.9 — A1. A cycle with re-weight orders says how many are left and which
     way they go, from the same list and tick map as the basket. (Every order
     placed is the "Everything this cycle is placed" line above.) An ordinary
     cycle has none, so the lines below are reached exactly as before. */
  var _rw = _ocH.rw || [];
  if (_rw.length){
    var _m = loadBought(currentStrategy) || {};
    var _lIn  = _ocH.buys.filter(function(o){ return !_m[orderKey(o)]; }).length;
    var _lOut = _ocH.sells.filter(function(o){ return !_m[orderKey(o)]; }).length;
    var _lRw  = _rw.filter(function(o){ return !_m[orderKey(o)]; });
    var _lTr  = _lRw.filter(function(o){ return o.side === 'SELL'; }).length, _lAd = _lRw.length - _lTr;
    var _hbTxt = nHb ? ' ' + (nHb === 1 ? 'One sale waits' : nHb + '\u00a0sales wait') + ' for your holding period.' : '';
    if (!orders){
      el.textContent = 'No names change this cycle \u2014 ' + plural(_lRw.length, 'order', 'orders') +
        (_lRw.length < _rw.length ? ' left' : '') + ' to bring your holdings to the new weights: ' +
        [_lTr ? plural(_lTr, 'trim', 'trims') : '', _lAd ? plural(_lAd, 'add', 'adds') : ''].filter(Boolean).join(', then ') +
        '.' + _hbTxt;
    } else {
      // V44.2 — the sales, then the buys: the same order as the baskets
      var _pOut = [_lOut ? _lOut + '\u00a0to sell' : '', _lTr ? _lTr + '\u00a0to trim' : ''].filter(Boolean).join(' and ');
      var _pIn  = [_lIn ? _lIn + '\u00a0to buy' : '', _lAd ? _lAd + '\u00a0to add' : ''].filter(Boolean).join(' and ');
      el.textContent = plural(_lIn + _lOut + _lRw.length, 'order', 'orders') + ' to place this cycle \u2014 ' +
        (_pOut && _pIn ? _pOut + ' first, then ' + _pIn : (_pOut || _pIn)) + '.' + _hbTxt;
    }
    return;
  }
  if (!orders && nHb){
    var _first = _ocH.holdBack.map(function(h){ return h.until; }).sort(function(a, b){ return a - b; })[0];
    el.textContent = 'Nothing to place today \u2014 ' + (nHb === 1 ? 'one sale waits' : nHb + '\u00a0sales wait') +
      ' for your holding period' + (_first ? ', until ' + mfDate(_first, { day:'numeric', month:'short' }) : '') + '.';
    return;
  }

  /* A weighted book can have zero name changes and still be a full rebalance —
     the same case the Orders tile handles with "weights to adjust". Counting the
     re-scored holdings here rather than re-deriving them keeps the two in step. */
  var nMoved = 0;
  try {
    var pp = diff.prevPos || {};
    diff.held.forEach(function(t){
      var p = pp[t], st = (stocksData || []).filter(function(x){ return x.ticker === t; })[0];
      if (!st || !p || typeof p.w !== 'number') return;
      if (Math.abs((Number(st.weight_pct) || 0) - p.w) >= 0.05) nMoved++;
    });
  } catch(e){}

  if (!orders){
    if (!nMoved){
      el.textContent = 'Nothing to place this cycle. All ' + total +
        ' holdings carry over unchanged — you are already done for the month.';
    } else if (nMoved === 1){
      el.textContent = 'No names change this cycle — one holding needs its weight adjusted, ' +
        (total - 1 === 1 ? 'and the other one carries over untouched.' : 'and the other ' + (total - 1) + ' carry over untouched.');   // V42.1 — one, not "1 carry"
    } else {
      el.textContent = 'No names change this cycle — ' + nMoved + '\u00a0holdings need their weights adjusted' +
        (nMoved < total ? (total - nMoved === 1 ? ', and the other one carries over untouched.' : ', and the other ' + (total - nMoved) + ' carry over untouched.') : ' to this cycle\u2019s targets.');   // V42.1 — one, not "1 carry"
    }
    return;
  }

  /* How much of the job is already done, from the same map the progress bar
     reads — and split by SIDE, because the headline count and the two legs have
     to be on one basis. A first pass counted the remaining orders in the lead
     and the cycle's totals in the legs, which after two ticks read "3 orders to
     place — 2 to buy and 2 to sell": the exact defect this whole line exists to
     close, reintroduced one sentence later. */
  var leftIn = nIn, leftOut = nOut;
  try {
    var map = loadBought(currentStrategy) || {};
    var oc  = cycleOrders();
    leftIn  = oc.buys.filter(function(o){  return !map[orderKey(o)]; }).length;
    leftOut = oc.sells.filter(function(o){ return !map[orderKey(o)]; }).length;
  } catch(e){}
  var left = leftIn + leftOut;

  if (!left){
    el.textContent = 'All ' + plural(orders, 'order', 'orders') + ' placed. You are done for the month — ' +
                     'your ' + total + ' holdings now match this cycle\u2019s book.';
    return;
  }

  /* Name the side whenever there is only one left. "2 orders to place" and
     "2 sell orders to place" cost the same line and the second one says which
     screen to open — the buy legs and the sell legs are different jobs. */
  var lead;
  if (leftIn && leftOut){
    lead = plural(left, 'order', 'orders') + ' to place this cycle \u2014 ' +
           leftOut + '\u00a0to sell first, then ' + leftIn + '\u00a0to buy';
  } else if (leftIn){
    lead = plural(leftIn, 'buy order', 'buy orders') + ' to place this cycle';
  } else {
    lead = plural(leftOut, 'sell order', 'sell orders') + ' to place this cycle';
  }
  // V42.1 — B5: when the re-weights cannot be sized, those holdings are not "untouched".
  var _nUnk = _ocH.rwUnknown ? diff.held.filter(function(t){ return heldMovePP(t) != null && !_isRestricted(t); }).length : 0;
  el.textContent = lead + '. ' +
    (_nUnk ? 'The other ' + nHold + ' of your ' + total + ' stay with new weights; Match my holdings, below, sizes ' +
             (_nUnk === 1 ? 'that order.' : 'those orders.')
     : nHold ? 'The other ' + nHold + ' of your ' + total + ' carry over untouched.'
           : 'Everything else is already in place.') +
    (nHb ? ' ' + (nHb === 1 ? 'One sale waits' : nHb + '\u00a0sales wait') + ' for your holding period.' : '');
}

/* ── V37.6 · THE ORDERS TILE COUNTS WHAT IS LEFT ──────────────────────────────
   "Orders to place · 6" sat beside a hero line reading "3 orders to place" and a
   progress card reading "3 of 6 placed · 3 to go": the tile printed the cycle's
   TOTAL under a label that means the remainder, and it never moved when a member
   ticked an order. It now reads the same tick map, through the same
   cycleOrders()/orderKey() pair, as the hero line and the progress bar, and its
   meter is the share placed rather than a second copy of the turnover the "New
   this cycle" tile beside it already draws. Returns false when the cycle has no
   orders at all, so the caller keeps its rotation / nothing-to-trade wording. */
function refreshOrdersTile(animate){
  var oVal = document.getElementById('stat-orders'), oSub = document.getElementById('stat-orders-sub');
  var oMeter = document.getElementById('ord-meter'), oFill = document.getElementById('ord-meter-fill');
  if (!oVal || !oSub) return false;
  var oc = cycleOrders(), n = oc.all.length;
  if (!n) return false;
  var map = loadBought(currentStrategy) || {};
  var leftIn  = oc.buys.filter(function(o){ return !map[orderKey(o)]; }).length;
  var leftOut = oc.sells.filter(function(o){ return !map[orderKey(o)]; }).length;
  // V41.9 — A1: a re-weight is an order too, counted and ticked like the rest
  var rwAll = oc.rw || [], leftRw = rwAll.filter(function(o){ return !map[orderKey(o)]; });
  var left = leftIn + leftOut + leftRw.length, placed = n - left;
  var sides = function(b, s){
    return [s ? s + (s === 1 ? ' sell' : ' sells') : '', b ? b + (b === 1 ? ' buy' : ' buys') : '']
      .filter(Boolean).join('\u00a0· ');
  };
  var rwSides = function(list){
    var tr = list.filter(function(o){ return o.side === 'SELL'; }).length, ad = list.length - tr;
    return [tr ? tr + (tr === 1 ? ' trim' : ' trims') : '', ad ? ad + (ad === 1 ? ' add' : ' adds') : '']
      .filter(Boolean).join('\u00a0· ');
  };
  if (animate) _animateCount(oVal, left, {});
  else if (String(oVal.textContent) !== String(left)) { oVal._acTok = null; oVal.textContent = left; }

  var first = !oc.known;
  if (rwAll.length){
    var nameSide = function(b, s){ return (b || s) ? sides(b, s) + '\u00a0· ' : ''; };
    if (!placed){
      oSub.textContent = (oc.buys.length || oc.sells.length)
        ? nameSide(oc.buys.length, oc.sells.length) + rwSides(rwAll)
        : rwSides(rwAll) + ' — no names change';
    } else if (left){
      oSub.textContent = 'left of ' + n + ' · ' + nameSide(leftIn, leftOut) + rwSides(leftRw);
    } else {
      oSub.textContent = 'all ' + n + ' placed — done for this cycle';
    }
  } else if (!placed){
    oSub.textContent = (oc.mode === 'fresh' && window._bookDiff && window._bookDiff.known) ? 'the whole book, bought again'   // V43.8
                     : first ? 'the full book — your first tracked cycle'
                             : sides(oc.buys.length, oc.sells.length);
  } else if (left){
    oSub.textContent = 'left of ' + n + ' · ' + (first ? placed + ' placed' : sides(leftIn, leftOut));
  } else {
    oSub.textContent = 'all ' + n + ' placed — done for this cycle';
  }
  if (oMeter && oFill){
    var w = Math.round(placed / n * 100) + '%';
    oFill.setAttribute('data-bar', w);
    if (oFill.style.width) oFill.style.width = w;   // the shared applier has already run
    oMeter.style.display = '';
    oMeter.classList.toggle('is-done', !left);
  }
  var card = document.getElementById('stat-card-orders');
  if (card) card.title = placed + ' of ' + n + ' order' + (n === 1 ? '' : 's') + ' placed this cycle';
  return true;
}

/* ── the change module + the two KPI tiles it feeds ────────────────────────────
   One writer for all three surfaces, so the tiles and the card can never state
   different counts. Everything is gated on diff.known. */
function renderBookChange(diff, stocks){
  var card   = document.getElementById('chg-card');
  var nVal   = document.getElementById('stat-new'),   nSub = document.getElementById('stat-new-sub');
  var oVal   = document.getElementById('stat-orders'),oSub = document.getElementById('stat-orders-sub');
  var nMeter = document.getElementById('new-meter'),  nFill= document.getElementById('new-meter-fill');
  var oMeter = document.getElementById('ord-meter'),  oFill= document.getElementById('ord-meter-fill');
  var total  = (stocks || []).length;

  if (!diff || !diff.known){
    // First cycle recorded on this device. Say that; do not imply a comparison.
    if (card) card.style.display = 'none';
    if (nVal) nVal.textContent = '—';
    if (nSub) nSub.textContent = 'first cycle on record';
    if (nMeter) nMeter.style.display = 'none';
    // Orders is still answerable without a diff: with no previous book, the book
    // IS the order list. That is exactly true for a member in their first cycle.
    if (!refreshOrdersTile(true)){
      if (oVal) _animateCount(oVal, total, {});
      if (oSub) oSub.textContent = total ? 'the full book — your first tracked cycle' : 'no picks published yet';
      if (oMeter) oMeter.style.display = 'none';
    }
    renderHeroJob();
    return;
  }

  var nIn = diff.added.length, nOut = diff.removed.length, nHold = diff.held.length;
  var orders = nIn + nOut;
  /* V35.4 — how many carried-over holdings had their model weight re-scored. On an
     equal-weight book this is always zero. On MultiAsset it is the whole cycle, and
     reporting "0 orders to place" there was the tile agreeing with the basket and
     disagreeing with the card three lines below, which told the member to rebalance
     between all eight. */
  var pp0 = diff.prevPos || {};
  var rotList = diff.held.map(function(t){
    var p = pp0[t], s = (stocks || []).filter(function(x){ return x.ticker === t; })[0];
    if (!s || !p || typeof p.w !== 'number') return null;
    return { t:t, now:Number(s.weight_pct) || 0, was:p.w, d:(Number(s.weight_pct) || 0) - p.w };
  }).filter(Boolean);
  var movedList = rotList.filter(function(r){ return Math.abs(r.d) >= 0.05; });
  var nMoved = movedList.length;
  var topUp = null, topDn = null;
  movedList.forEach(function(r){
    if (r.d > 0 && (!topUp || r.d > topUp.d)) topUp = r;
    if (r.d < 0 && (!topDn || r.d < topDn.d)) topDn = r;
  });

  if (nVal) _animateCount(nVal, nIn, {});
  if (nSub) nSub.textContent = nHold + ' of ' + total + ' held from last cycle';
  if (nMeter && nFill && total){
    nFill.setAttribute('data-bar', Math.round(nIn / total * 100) + '%');
    nMeter.style.display = '';
  }
  // V35.4 — with no names changing but weights re-scored, the work is the
  // rebalance, so the tile counts that instead of printing a contradictory zero.
  var tileN = orders || nMoved;
  // V37.6 — a cycle with orders is counted by refreshOrdersTile(), which reads
  // the tick map; the rotation and no-trade wordings below are unchanged.
  // V41.9 — A1: so is a cycle whose only orders are re-weights.
  var rwOrdersN = (cycleOrders().rw || []).length;
  if (!((orders || rwOrdersN) && refreshOrdersTile(true))){
    if (oVal) _animateCount(oVal, tileN, {});
    if (oSub) oSub.textContent = orders
      ? (nOut + (nOut === 1 ? ' sell' : ' sells') + ' · ' + nIn + (nIn === 1 ? ' buy' : ' buys'))
      : (nMoved
          ? 'weights to adjust — no names change'   // MultiAsset: same sleeve, new targets
          : isWeightedBook(stocks)
            // A weighted book whose previous WEIGHTS were never recorded (a device
            // whose history predates V35.3) cannot know whether they moved. It must
            // not fall through to "nothing to trade", which is the one thing that is
            // never true of MultiAsset.
            ? 'no names change — weights rotate'
            : 'nothing to trade — the book is unchanged');
    if (oMeter && oFill && total){
      oFill.setAttribute('data-bar', Math.min(100, Math.round(tileN / total * 100)) + '%');
      oMeter.style.display = '';
    }
  }

  if (!card) return;
  /* V39.5 — B1/B2: what the member's own rules take out of this cycle. Counted from
     the same cycleOrders() the basket and the tick-list read, so the sentence, the
     rows below and the order count cannot disagree. */
  var ocB = cycleOrders(), hbBy = {};
  (ocB.holdBack || []).forEach(function(h){ hbBy[h.ticker] = h; });
  var rsN = diff.added.concat(diff.removed, diff.held).filter(function(t){ return _isRestricted(t); }).length;
  var hbN = (ocB.holdBack || []).length;
  var csBits = [];
  if (rsN) csBits.push('<strong>' + rsN + '</strong> ' + (rsN === 1 ? 'is' : 'are') + ' on your restricted list');
  if (hbN) csBits.push('<strong>' + hbN + '</strong> sale' + (hbN === 1 ? ' waits' : 's wait') + ' for your holding period');
  var csSentence = csBits.length ? ' Your rules: ' + csBits.join(' and ') + '.' : '';
  var ordersNow = csBits.length ? ocB.all.length : orders;
  /* V41.9 — A1: re-weight orders are part of "that is N orders to place", and a
     re-weight-only cycle says how many and which way. Empty on an ordinary cycle,
     so its sentence is unchanged. */
  var rwNow = ocB.rw || [];
  if (rwNow.length) ordersNow = ocB.all.length;
  var rwTrimN = rwNow.filter(function(o){ return o.side === 'SELL'; }).length, rwAddN = rwNow.length - rwTrimN;
  var rwSentence = rwNow.length
    ? ' That is <strong>' + rwNow.length + '</strong> order' + (rwNow.length === 1 ? '' : 's') + ': ' +
      [rwTrimN ? rwTrimN + (rwTrimN === 1 ? ' trim' : ' trims') : '', rwAddN ? rwAddN + (rwAddN === 1 ? ' add' : ' adds') : '']
        .filter(Boolean).join(', then ') + '.'
    : '';
  // "…of YOUR n carry over" is the member's book once names are taken out — the hero
  // line above says the same, so the two cannot give different counts for one thing.
  var yourHold = rsN ? diff.held.filter(function(t){ return !_isRestricted(t); }).length : nHold;
  var yourTotal = rsN ? (memberBook(stocks || []).length || total) : total;
  var when = document.getElementById('chg-when');
  if (when){
    var w = diff.prevWhen ? new Date(diff.prevWhen) : null;
    when.textContent = (w && !isNaN(w.getTime()))
      ? ('vs the set you last opened on ' + mfDate(w, {day:'numeric',month:'short',year:'numeric'}))
      : 'vs your previous set';
  }
  var line = document.getElementById('chg-line');
  if (line){
    // "Nothing to trade" is only true of an EQUAL-WEIGHT book. MultiAsset holds the
    // same eight ETFs every month and rotates their WEIGHTS, so an empty add/remove
    // set there means rebalancing between the holdings, not sitting still — telling
    // that member there is nothing to trade would be plainly false. Same
    // isWeightedBook() reading the sizing card and the donut are drawn from.
    var weighted = isWeightedBook(stocks);
    /* V35.4 — name the two ends of the rotation. "You are rebalancing between
       them" is true and completely unactionable: it does not say which way any
       holding moves, which is the only thing a member needs before they open
       their broker. The biggest add and the biggest trim are the two facts that
       orient the whole list below. */
    var rotSentence = '';
    if (nMoved && topUp && topDn){
      rotSentence = ' The biggest moves are <strong>' + escapeHtml(topUp.t) + '</strong> up to ' +
        topUp.now.toFixed(1) + '% and <strong>' + escapeHtml(topDn.t) + '</strong> down to ' +
        topDn.now.toFixed(1) + '%.';
    } else if (nMoved && (topUp || topDn)){
      var only = topUp || topDn;
      rotSentence = ' The biggest move is <strong>' + escapeHtml(only.t) + '</strong> ' +
        (only.d > 0 ? 'up' : 'down') + ' to ' + only.now.toFixed(1) + '%.';
    }
    // "carry over UNTOUCHED" is only true when their weights did not move. On a
    // rotating book those holdings are exactly the ones with work to do.
    var carryPhrase = nMoved
      ? ('<strong>' + nHold + '</strong> of your ' + total + ' stay in the book, ' +
         (nMoved === nHold ? 'all of them' : '<strong>' + nMoved + '</strong> of them') + ' re-weighted')
      : ('<strong>' + yourHold + '</strong> of your ' + yourTotal + ' carry over untouched');
    line.innerHTML = orders === 0
      ? (nMoved
          ? 'The model kept the <strong>same ' + total + '</strong> holdings and re-scored their weights. Nothing is bought or sold outright this cycle — you are <strong>rebalancing between them</strong>.' + rotSentence + rwSentence
          : weighted
            ? 'The model kept the <strong>same ' + total + '</strong> holdings and re-scored their weights. Nothing is bought or sold outright this cycle — you are <strong>rebalancing between them</strong>; the Allocation column below is the target.'
            : 'The model re-scored the universe and arrived at the <strong>same ' + total + '</strong> names. <strong>Nothing to trade this cycle</strong> — hold what you have.')
      : ('<strong>' + nOut + '</strong> ' + (nOut === 1 ? 'name leaves' : 'names leave') +
         ' the book and <strong>' + nIn + '</strong> ' + (nIn === 1 ? 'joins' : 'join') + ' it; ' + carryPhrase +
         '.' + csSentence + ' That is <strong>' + ordersNow + '</strong> order' +
         (ordersNow === 1 ? '' : 's') + ' to place' + (ordersNow !== yourTotal ? ', not ' + yourTotal : '') + '.' + rotSentence);
  }
  var box = document.getElementById('chg-groups');
  if (box){
    /* V37.2 — THE BIGGEST GROUP ON THIS CARD CARRIED NO INFORMATION.
       "Hold · carried over" is most of the book — 8 of 10 in a typical equity
       cycle — and it rendered as a wall of bare tickers. The two groups beside it
       each answer a question (what to buy, what to sell); this one answered
       "these ones", which the member could already see in the table below.
       The question it should answer is the only one a carried-over name raises:
       is it working? That number already exists per row — the move since the
       model recommended it — so each chip now carries it.
       Painted by paintLivePrices() through data-px-mode="ret" rather than
       formatted here, so these chips move with the 5-minute repoll instead of
       freezing at whatever the first load happened to show. Before prices land
       they read as a dash, exactly like the table's own cells. */
    var byT = {};
    (stocks || []).forEach(function(s2){ byT[String(s2.ticker || '')] = s2; });
    var chips = function(list){
      if (!list.length) return '<div class="chg-none">None this cycle</div>';
      return '<div class="chg-tks">' + list.map(function(t){
        var s2 = byT[t] || {};
        var rec = Number(s2.recommended_price) || 0;
        var y   = s2.yahoo_ticker || '';
        if (_isRestricted(t)) return '<span class="chg-tk is-restricted" title="On your restricted list — not held through this dashboard">' +
          escapeHtml(t) + '<span class="chg-tk-rs">restricted</span></span>';   // V39.5
        return '<span class="chg-tk">' + escapeHtml(t) +
          (rec > 0 && y
            ? '<span class="px-live chg-tk-px" data-px-mode="ret" data-px="' + escapeHtml(y) +
              '" data-rec="' + rec + '"></span>'
            : '') +
        '</span>';
      }).join('') + '</div>';
    };
    /* V35.3 — the departing names, as orders. Quantity comes from the previous
       cycle's recorded position and is simply omitted when that record predates
       V35.3, because "sell 0 shares" and "sell some unknown number" are different
       statements and only one of them is true. The broker link is the member's own
       choice (getBroker), same as every row in the picks table. */
    var placed = loadBought(currentStrategy) || {};
    var bk     = BROKERS[getBroker()] || BROKERS.kite;
    var pp     = diff.prevPos || {};
    var sells  = function(list){
      if (!list.length) return '<div class="chg-none">None this cycle</div>';
      // V43.8 — Buy all in Step 3: the member holds none of last month's book.
      if (orderModeState().m === 'fresh') return '<div class="chg-none">Nothing to sell here: you chose <b>Buy all</b> in Step 3, which starts from none of last month&rsquo;s book.</div>';
      var unknownN = 0;
      return '<div class="chg-sells">' + list.map(function(t){
        var p    = pp[t] || {};
        var qty  = Number(p.qty) || 0;
        var key  = 'SELL:' + String(t).toUpperCase();
        // V39.5 — B1: a restricted name is never sold from here.
        if (_isRestricted(t)) return '<div class="chg-sell cs-row is-restricted">' + _csLockMark({ ticker:t }) +
          '<span class="chg-sell-id"><span class="chg-sell-t">' + escapeHtml(t) + '</span>' +
          '<span class="chg-sell-q">On your restricted list &mdash; nothing to sell here</span></span></div>';
        // V39.5 — B2: inside the member's holding period — no tick, no link, a date.
        var hb = hbBy[String(t).toUpperCase()];
        if (hb) return '<div class="chg-sell cs-row is-hold">' + _csClockMark() +
          '<span class="chg-sell-id"><span class="chg-sell-t">' + escapeHtml(t) + '</span>' +
            (qty > 0 ? '<span class="chg-sell-q">' + qty + ' share' + (qty === 1 ? '' : 's') + ' held</span>' : '') + '</span>' +
          '<span class="cs-hold-when">Sell on or after <b>' + escapeHtml(mfDate(hb.until, { day:'numeric', month:'short' })) + '</b></span>' +
          '<button type="button" class="chg-sell-lnk cs-cal" onclick="csHoldToCalendar(\'' + escapeHtml(hb.ticker) + '\')">Remind me</button></div>';
        if (_csUnknownBuy(t)) unknownN++;
        var done = !!placed[key];
        var url  = '';
        try { url = bk.link({ ticker: t }) || ''; } catch(e){}
        return '<div class="chg-sell' + (done ? ' is-done' : '') + '" data-okey="' + escapeHtml(key) + '">' +
          '<input type="checkbox" class="chg-sell-cb"' + (done ? ' checked' : '') +
            ' data-okey="' + escapeHtml(key) + '" onchange="toggleOrder(this)"' +
            ' aria-label="Mark ' + escapeHtml(t) + ' as sold">' +
          '<span class="chg-sell-id"><span class="chg-sell-t">' + escapeHtml(t) + '</span>' +
            (qty > 0 ? '<span class="chg-sell-q">' + qty + ' share' + (qty === 1 ? '' : 's') + ' held</span>' : '') +
          '</span>' +
          (url ? '<a class="chg-sell-lnk" href="' + escapeHtml(url) + '" target="_blank" rel="noopener noreferrer">' +
                 escapeHtml(bk.name) + ' &rarr;</a>' : _csCopyBtn(t, qty)) +
        '</div>';
      }).join('') + '</div>' +
      '<div class="chg-hint">' +
        // V42.1 — B5: no quantity because none was entered last month, not a missing price
        (diff.prevQtyKnown === false && list.some(function(t){ return !_isRestricted(t) && !hbBy[String(t).toUpperCase()]; })
          ? 'Sell the shares you bought for this book; any you held before you started it stay yours. Last month&rsquo;s quantities were sized at the starting amount, not one you entered, ' +
            'so your dashboard cannot size these; <button type="button" class="chg-hint-btn" onclick="_rwOpenMatch()">Match my holdings</button> ' +
            'works them out from your broker&rsquo;s list. '
          : '') +
        (nIn ? 'Tick each one once it has sold: its money then pays for the buys.' : 'Tick each one once the sell order is placed.') +
        (unknownN ? ' No purchase date is recorded for ' + (unknownN === 1 ? 'one of these' : unknownN + ' of these') +
          ' &mdash; if you bought ' + (unknownN === 1 ? 'it' : 'any') + ' within your ' + window._mfRules.h +
          '-day holding period, hold ' + (unknownN === 1 ? 'it' : 'those') + ' until the period ends.' : '') + '</div>' +
        // V43.1 — A1: only beside a sale the member will actually place
        (list.some(function(t){ return !_isRestricted(t) && !hbBy[String(t).toUpperCase()]; }) ? _sellAuthNote(true) : '');
    };
    /* V35.4 — ON A WEIGHT-ROTATING BOOK, "HOLD" IS NOT "DO NOTHING".
       MultiAsset keeps the same eight ETFs every month and re-scores their
       weights; that rotation IS the cycle's work. The card said so in words —
       "you are rebalancing between them; the Allocation column below is the
       target" — and then listed the eight as plain chips, leaving the member to
       compare a target column against their own broker holdings by hand. Which
       is the exact arithmetic this product exists to remove, for the one strategy
       whose entire monthly action is the rebalance.
       The previous cycle's model weights are recorded (V35.3 added `w` to the
       position record), so the direction and size of each move are already known.
       Rendered only when the weights actually moved: on an equal-weight book
       every delta is zero and the group stays a list of chips, because there
       "carried over" really does mean nothing to do. */
    /* V36.5 — the buys, as orders. Same skeleton as the sell row, the picks
       table's own tick, and the size read from the shared sizing arithmetic.
       `byT` rather than a second scan: diff.added holds tickers, the price and
       the model weight live on the stock object. */
    var buys = function(list){
      if (!list.length) return '<div class="chg-none">None this cycle</div>';
      return '<div class="chg-sells">' + list.map(function(t){
        var s2   = byT[t];
        if (_isRestricted(t)) return '<div class="chg-buy cs-row is-restricted">' + _csLockMark({ ticker:t }) +   // V39.5 — B1
          '<span class="chg-sell-id"><span class="chg-sell-t">' + escapeHtml(t) + '</span>' +
          '<span class="chg-sell-q">On your restricted list &mdash; not bought</span></span></div>';
        var done = !!placed[t];
        var url  = '';
        try { url = bk.link({ ticker: t }) || ''; } catch(e){}
        return '<div class="chg-buy' + (done ? ' row-bought' : '') + '" data-ticker="' + escapeHtml(t) + '">' +
          '<input type="checkbox" class="bought-cb chg-sell-cb"' + (done ? ' checked' : '') +
            ' onchange="toggleBought(this)"' +
            ' aria-label="Mark ' + escapeHtml(t) + ' as bought">' +
          '<span class="chg-sell-id"><span class="chg-sell-t">' + escapeHtml(t) + '</span>' +
            '<span class="chg-sell-q" data-buyqty="' + escapeHtml(t) + '">' + _buyQtyText(s2) + '</span>' +
          '</span>' +
          (url ? '<a class="chg-sell-lnk" href="' + escapeHtml(url) + '" target="_blank" rel="noopener noreferrer">' +
                 escapeHtml(bk.name) + ' &rarr;</a>' : _csCopyBtn(t, s2 ? sharesFor(s2) : 0)) +
        '</div>';
      }).join('') + '</div>' +
      '<div class="chg-hint">' + ((ocB.sells.length || (ocB.trims || []).length) ? 'Place these after the sales: their money pays for them. ' : '') +
        'Tick each one once the buy order is placed &mdash; the same tick as the picks table below.</div>';
    };
    var rot = rotList.slice(), moved = movedList;
    var holdBody;
    if (moved.length){
      // V44.2 — the trims first, as in the baskets: each one's money pays for the adds
      rot.sort(function(a,b){ return (b.d < 0 ? 1 : 0) - (a.d < 0 ? 1 : 0) || Math.abs(b.d) - Math.abs(a.d); });
      /* V41.9 — A1. When this cycle's re-weights could be sized (cycleOrders()
         .rwKnown), each moved row carries its order: the share count, a tick
         (RW:<ticker>, the same key the basket and the table use) and, for a trim
         inside the holding period, its date. A zero-share move says so. */
      var rwOn = !!ocB.rwKnown;
      holdBody = '<div class="chg-sells">' + rot.map(function(r){
        var up = r.d >= 0, flat = Math.abs(r.d) < 0.05;
        var url = ''; try { url = bk.link({ ticker:r.t }) || ''; } catch(e){}
        /* V42.0 — the pp figure is the difference of the two weights AS PRINTED. It
           was r.d, the unrounded move, so "add to 4.3% from 4.0%" sat beside "+0.2 pp"
           and "trim to 8.3% from 11.4%" beside "−3.2 pp": three of the sample's eight
           rows did not add up on the screen. Two decimals only where both weights
           round to the same tenth (a move under 0.1 pp). Rounding keeps the order, so
           the sign and the arrow are unchanged. */
        var dp = (!flat && r.now.toFixed(1) === r.was.toFixed(1)) ? 2 : 1;
        var nowS = r.now.toFixed(dp), wasS = r.was.toFixed(dp);
        var dS = Math.abs(Number(nowS) - Number(wasS)).toFixed(dp);
        var lbl = flat ? 'unchanged at ' + r.now.toFixed(1) + '%'
                       : (up ? 'add to ' : 'trim to ') + nowS + '% from ' + wasS + '%';
        var o = (rwOn && !flat) ? _rwOrderFor(r.t, ocB) : null;
        var hold = o && o.hold, act = !!(o && !o.hold && o.qty > 0);
        var key = act ? orderKey(o) : '', done = act && !!placed[key];
        var qtyHtml = !o ? ''
          : hold ? '<span class="chg-rot-q">sell\u00a0' + hold.qty + ' on or after ' +
                   escapeHtml(mfDate(hold.until, { day:'numeric', month:'short' })) + '</span>'
          : act  ? '<span class="chg-rot-q">' + (o.side === 'SELL' ? 'sell' : 'buy') + '\u00a0' + o.qty + '</span>'
                 : '<span class="chg-rot-q is-none">no order \u2014 still ' + o.to + '\u00a0share' + (o.to === 1 ? '' : 's') + '</span>';
        return '<div class="chg-rot' + (act ? ' has-cb' : '') + (done ? ' is-done' : '') + '" data-t="' + escapeHtml(r.t) + '">' +
          (act ? '<input type="checkbox" class="chg-sell-cb rw-cb"' + (done ? ' checked' : '') +
                   ' data-okey="' + escapeHtml(key) + '" onchange="toggleOrder(this)"' +
                   ' aria-label="Mark the ' + escapeHtml(r.t) + ' re-weight as placed: ' + (o.side === 'SELL' ? 'sell ' : 'buy ') + o.qty + '">' : '') +
          '<span class="chg-rot-dir ' + (flat ? 'is-flat' : up ? 'is-up' : 'is-dn') + '" aria-hidden="true">' +
            (flat ? '=' : up ? '&uarr;' : '&darr;') + '</span>' +
          '<span class="chg-sell-id"><span class="chg-sell-t">' + escapeHtml(r.t) + '</span>' +
            '<span class="chg-sell-q">' + escapeHtml(lbl) + '</span>' + qtyHtml + '</span>' +
          '<span class="chg-rot-d ' + (flat ? 'is-flat' : up ? 'is-up' : 'is-dn') + '">' +
            (flat ? '&mdash;' : (up ? '+' : '−') + dS + '\u00a0pp') + '</span>' +
          (hold ? '<button type="button" class="chg-sell-lnk cs-cal" onclick="csHoldToCalendar(\'' + escapeHtml(hold.ticker) + '\')">Remind me</button>'
           : url ? '<a class="chg-sell-lnk" href="' + escapeHtml(url) + '" target="_blank" rel="noopener noreferrer">' +
                 escapeHtml(bk.name) + ' &rarr;</a>' : '') +
        '</div>';
      }).join('') + '</div>' +
      (rwOn
        ? '<div class="chg-hint">Sized from the quantities your dashboard recorded last month. If your broker shows different holdings, ' +
          '<button type="button" class="chg-hint-btn" onclick="_rwOpenMatch()">Match my holdings</button> gives exact orders. ' +
          'Tick each one once it is placed.</div>' +
          ((ocB.trims || []).length ? _sellAuthNote(true) : '')   // V43.1 — A1: a trim is a sale too
        : '<div class="chg-hint">The model re-scored these. Bring each one to the Allocation shown in the table below &mdash; ' +
          'no name is bought or sold outright.' +
          (ocB.rwUnknown
            ? (diff.prevQtyKnown === false
                ? ' Last month&rsquo;s quantities were sized at the starting amount, not one you entered, so your dashboard cannot size these. Paste your holdings into '
                : ' Your dashboard has no record of last month&rsquo;s quantities on this device. Paste your holdings into ') +
              '<button type="button" class="chg-hint-btn" onclick="_rwOpenMatch()">Match my holdings</button> to get the exact orders.'
            : '') + '</div>');
    } else {
      holdBody = chips(diff.held);
    }
    var holdLabel = moved.length ? 'Rebalance · weights moved (' + moved.length + ')'
                                 : 'Hold · carried over (' + nHold + ')';
    var mtIn   = nIn  === 0 ? ' is-empty' : '';
    var mtOut  = nOut === 0 ? ' is-empty' : '';
    var mtHold = (moved.length === 0 && nHold === 0) ? ' is-empty' : '';
    box.classList.toggle('has-empty', !!(mtIn || mtOut || mtHold));
    // V44.2 — the sales first, always: their money pays for the buys beside them
    var bothSides = nIn > 0 && ocB.sells.length > 0;
    box.innerHTML =
      '<div class="chg-group is-out' + mtOut + '"><div class="chg-gk"><i></i>' + (bothSides ? 'Sell first' : 'Sell') + ' · left the book (' + nOut + ')</div>' + sells(diff.removed) + '</div>' +
      '<div class="chg-group is-in' + mtIn + '"><div class="chg-gk"><i></i>' + (bothSides ? 'Then buy' : 'Buy') + ' · new this cycle (' + nIn + ')</div>'   + buys(diff.added)    + '</div>' +
      '<div class="chg-group is-hold' + (moved.length ? ' is-rot' : '') + mtHold + '"><div class="chg-gk"><i></i>' +
        holdLabel + '</div>' + holdBody + '</div>';
  }
  /* The hold chips above are .px-live elements created AFTER the last paint, so
     they would sit empty until the next 5-minute poll. Same guard renderTable
     ends with, for the same reason. */
  if (window._livePx) { try { paintLivePrices(); } catch(e){} }
  renderCycleCost();   // V35.3 — what the turnover named above actually costs
  renderHeroJob();     // V37.3 — and what the hero line has to say about it
  window._rwSigShown = _rwSig(ocB);   // V41.9 — A1: what refreshRwRows() compares against
  card.style.display = '';
}

function _pxCacheKey(){ return 'mfc_livepx_' + (token || 'demo'); }
function _todayKey(){ var d = new Date(); return d.getFullYear() + '-' + (d.getMonth()+1) + '-' + d.getDate(); }
/* ── V35.3 · "LIVE" NOW MEANS LIVE ───────────────────────────────────────────
   The cache was bounded by CALENDAR DAY and nothing else. It wrote an `at`
   timestamp and never read it, and there was no repoll — loadLiveProfit ran once
   at load and again only when Refresh was pressed. So a member who opened the
   dashboard at 09:20 and came back at 15:29 read the 09:20 prices under a pulsing
   green "live" dot, beside a status bar saying NSE open, with the headline
   stamped "As of 03:29 pm" because that line printed new Date() rather than the
   time the prices were fetched. The stamp tracked the member's own typing:
   renderProfitHeadline re-runs on every capital change.
   Two bounds, because the right answer differs either side of the closing bell:
   while the exchange is open a quote is stale in minutes, and once it has closed
   the last traded price does not change again until tomorrow. */
var PX_MAX_AGE_OPEN   = 5 * 60 * 1000;    // 5 minutes during market hours
var PX_MAX_AGE_CLOSED = 12 * 60 * 60 * 1000; // the rest of the day once NSE has shut
/* ── V44.1 · NSE'S TRADING HOLIDAYS ─────────────────────────────────────────
   Until V44.1 "NSE is open" meant a weekday between 9:15 and 15:30, so a weekday
   holiday looked open: a Kite basket went as 'regular', which Zerodha refuses while
   NSE is shut (V44.0, below), the status bar said "NSE open", prices were re-polled
   every five minutes and the 1D move was labelled "today". November 2026 has two,
   Tue 10 Nov (Diwali Balipratipada) and Tue 24 Nov (Guru Nanak Jayanti).
   screener/market_data.py writes the list from NSE's holiday master (cash market)
   with every daily refresh. Without the file, or in a year it does not list, the page
   knows weekends only, as before. Diwali's evening Muhurat session is not modelled. */
window._nseHolidays = null;
function loadNseHolidays(){
  if (window._nseHolidaysP) return window._nseHolidaysP;
  window._nseHolidaysP = fetch('screener/nse-holidays.json', { cache: 'no-cache' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) {
      if (!d || !d.holidays || !Array.isArray(d.years)) return null;
      window._nseHolidays = d;
      try { updateMarketStatus(); } catch (e) {}
      try { refreshKiteBasket(); } catch (e) {}
      return d;
    })
    .catch(function () { return null; });
  return window._nseHolidaysP;
}
/* The holiday's name when `day` (an IST wall-clock Date) is one, else ''. */
function _nseHolidayOn(day){
  var h = window._nseHolidays;
  if (!h || !h.holidays || !day) return '';
  var k = day.getFullYear() + '-' + ('0' + (day.getMonth() + 1)).slice(-2) + '-' + ('0' + day.getDate()).slice(-2);
  return Object.prototype.hasOwnProperty.call(h.holidays, k) ? String(h.holidays[k] || 'a trading holiday') : '';
}
/* When Zerodha sends an AMO placed now: 9:00 on the next session (this morning's,
   before 9:00 on a trading day). A date is named only while the list covers it. */
function _nseAmoWhen(local){
  var vague = 'on the next trading morning';
  try {
    var h = window._nseHolidays;
    var day0 = new Date(local.getFullYear(), local.getMonth(), local.getDate()), day = new Date(day0.getTime());
    var trading = function (x) { var g = x.getDay(); return g >= 1 && g <= 5 && !_nseHolidayOn(x); };
    if (!(trading(day) && local.getHours() * 60 + local.getMinutes() < 9 * 60)) {
      var i = 0;
      do { day.setDate(day.getDate() + 1); } while (!trading(day) && ++i < 15);
    }
    if (!h || h.years.indexOf(day0.getFullYear()) < 0 || h.years.indexOf(day.getFullYear()) < 0) return vague;
    var gap = Math.round((day - day0) / 864e5);
    if (gap === 0) return 'this morning';
    if (gap === 1) return 'tomorrow morning';
    var nm = mfDate(day, { weekday: 'long', day: 'numeric', month: 'short' });
    return nm ? 'on ' + nm : vague;
  } catch (e) { return vague; }
}
function _nseIsOpen(){
  try {
    var local = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    var d = local.getDay(); if (d < 1 || d > 5) return false;
    if (_nseHolidayOn(local)) return false;   // V44.1
    var mins = local.getHours() * 60 + local.getMinutes();
    return mins >= (9 * 60 + 15) && mins <= (15 * 60 + 30);
  } catch(e){ return false; }
}
function _pxMaxAge(){ return _nseIsOpen() ? PX_MAX_AGE_OPEN : PX_MAX_AGE_CLOSED; }
/* V39.1 — B2. THE EVENING IS WHEN THIS MEMBER HAS TIME. Zerodha sends after-market
   orders (AMO) to the exchange at 9:00 the next trading morning (support.zerodha.com,
   "What is After Market Order (AMO) & its timings?"; NSE: 4:00 pm to 8:58 am).
   V44.0 — BUT IT DOES NOT TURN OUR BASKET INTO ONE. That page converts an order placed
   outside market hours only on Zerodha's own screens (Kite's order window, Kite's own
   baskets, ChartIQ, TradingView). A basket another site posts through Kite Publisher
   keeps the variety it carries, which defaults to 'regular', and Zerodha's order system
   refuses a regular order while NSE is shut. Seen on the owner's account on Sunday
   1 Nov 2026 at 10 pm: all ten orders of a LargeMidcap basket came back "Error placing
   order". So each row now says 'amo' whenever the market is shut (Publisher accepts
   regular, amo and co: kite.trade/docs/connect/v3/basket). Between Zerodha's AMO cut-off
   (8:58) and the open it stays 'regular', which Kite takes in the pre-open from 9:00.
   V44.1: a trading holiday is shut all day (loadNseHolidays, above), so it sends 'amo'. */
function _kbAmoNow(){
  try {
    if (_nseIsOpen()) return false;
    var local = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    var d = local.getDay(), m = local.getHours() * 60 + local.getMinutes();
    if (d >= 1 && d <= 5 && !_nseHolidayOn(local) && m >= 8 * 60 + 58 && m < 9 * 60 + 15) return false;
    return true;
  } catch (e) { return false; }
}
/* V44.5: a first month's note in plain words. The time-of-day warnings stay as they are, because each is an
   instruction; only the general after-hours sentence changes. The limit-order detail moves behind a fold. */
function _kbFirstNote(plan){
  return _kbCapNote() + (_nseIsOpen() ? 'The market is open, so each order goes in as you confirm it. ' : _kbHoursNote(true)) + _kbSeriesNote(plan) +
    'Nothing is placed until you confirm on Zerodha\u2019s own screen, and you can change any quantity there. ' +
    (!plan.next ? 'Every basket has been opened on Kite from this device: tick each order once it fills. '
     : plan.total > 1 ? 'Kite takes ten orders at a time, so this month\u2019s ' + plan.openN + ' go in ' + plan.total + ': send one, confirm it, come back for the next. ' : '') +
    '<a href="/learn/first-orders/" target="_blank" rel="noopener">First time? What you will see</a>' +
    '<details class="kbsk-more"><summary>Order types</summary>A market order at the open can fill away from the last price on thinner names, so you can switch any row to Limit on Kite\u2019s screen before confirming.</details>';
}
function _kbHoursNote(plain){
  try {
    if (_nseIsOpen()) return '';
    var local = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    var d = local.getDay(), m = local.getHours() * 60 + local.getMinutes();
    var hol = _nseHolidayOn(local);   // V44.1
    var weekday = d >= 1 && d <= 5 && !hol;
    if (weekday && m > 15 * 60 + 30 && m < 16 * 60)
      return '<b>NSE has closed for the day.</b> Zerodha takes after-market orders from 4:00 pm, so send the basket after that. ';
    if (weekday && m >= 8 * 60 + 58 && m < 9 * 60 + 15)
      return '<b>The market opens at 9:15.</b> Kite takes these orders from the open. ';
    if (m >= 60 && m < 5 * 60 + 30)   // V44.0 — Zerodha's nightly AMO maintenance
      return '<b>Zerodha takes no after-market orders between 1:00 and 5:30 am</b> (its nightly maintenance), so send the basket after 5:30. ';
    if (plain) return (hol ? 'NSE is shut today for ' + escapeHtml(hol) + ', so these go in at the open ' : 'The market is shut now, so these go in at the open ') + _nseAmoWhen(local) + '. ';   // V44.5
    return '<b>' + (hol ? 'NSE is shut today for ' + escapeHtml(hol) : 'NSE is closed right now') +
      ', so the basket goes to Kite as after-market orders (AMO).</b> Zerodha sends them to the ' +
      'exchange at 9:00 ' + _nseAmoWhen(local) + '. A market order at the open can fill away from the ' +
      'last price on thinner names, so you can switch any row to Limit on Kite\u2019s screen before confirming. ';
  } catch (e) { return ''; }
}
function _loadCachedPx(){
  try { var raw = localStorage.getItem(_pxCacheKey()); if (!raw) return null;
        var o = JSON.parse(raw);
        if (!o || o.day !== _todayKey() || !o.px) return null;
        var at = Number(o.at) || 0;
        if (!at || (Date.now() - at) > _pxMaxAge()) return null;
        return o; } catch(e){}
  return null;
}
function _saveCachedPx(px){
  var at = Date.now();
  try { localStorage.setItem(_pxCacheKey(), JSON.stringify({ day: _todayKey(), at: at, px: px })); } catch(e){}
  // The headline's "As of" is written from this, not from the clock, so it stays
  // true whether the prices were just fetched or read back out of the cache.
  window._pxAt = at;
}
async function _fetchPricesBatch(yahoos){
  try {
    var res = await fetch(APPS_SCRIPT_URL + '?action=prices&tickers=' + encodeURIComponent(yahoos.join(',')) + '&_=' + Date.now());
    var data = await res.json();
    if (data && data.prices){
      var out = {}, any = false;
      yahoos.forEach(function(y){ var p = data.prices[y]; if (p && p.price != null){ out[y] = { price: Number(p.price), prev: (p.prev_close != null ? Number(p.prev_close) : null) }; any = true; } });
      if (any) return out;
    }
  } catch(e){}
  return null;
}
async function _fetchPricesViaChart(yahoos){
  var out = {}, idx = 0, CONC = 5;
  async function worker(){
    while (idx < yahoos.length){
      var y = yahoos[idx++];
      try {
        var res = await fetch(APPS_SCRIPT_URL + '?action=chart&ticker=' + encodeURIComponent(y) + '&range=1d&_=' + Date.now());
        var d = await res.json();
        if (d && d.status === 'ok' && d.points && d.points.length){
          out[y] = { price: Number(d.points[d.points.length - 1][1]), prev: (d.prev_close != null ? Number(d.prev_close) : null) };
        }
      } catch(e){}
    }
  }
  var workers = []; for (var i = 0; i < Math.min(CONC, yahoos.length); i++) workers.push(worker());
  await Promise.all(workers);
  return out;
}
// V16.3: single baseline = recommended_price (the REC. PRICE shown in the table).
// The portfolio headline, the Top/Lagging chips and the absolute ₹ gain are all
// measured against the SAME rec_price the per-row cells use, so the summary is the
// weight-weighted aggregate of exactly the per-stock returns the user sees in the
// table — they can never disagree again. (Earlier the headline used a separate
// "month-anchored" baseline — the close on the 1st trading day of the month — which
// drifted from rec_price whenever publish.py re-stamped a pick mid-month, making the
// summary % and the Top/Lagging chips contradict the per-row gains. Removed.)
async function loadLiveProfit(force, opts){
  var card = document.getElementById('profit-card');
  if (!card) return;
  if (isDemo){ card.style.display = 'none'; return; }   // demo rec-prices are placeholders
  var sub = window._currentSub || {};
  var stocks = stocksData || [];
  window._rebalDate = parseRebalanceDate(sub);
  var priced = stocks.filter(function(s){ return s.yahoo_ticker && (Number(s.recommended_price) || 0) > 0; });
  if (!priced.length){ card.style.display = 'none'; return; }

  card.style.display = 'flex';
  // V35.3 — a background repoll must not blank a headline that is already on
  // screen and re-run its count-up every 5 minutes. Only a first load or an
  // explicit Refresh shows the skeleton.
  var quiet = !!(opts && opts.quiet) && !!window._livePx;
  if (!quiet){
    window._profitAnimated = false;   // V14.6: re-arm the count-up for this load
    setProfitLoading(window._rebalDate);
  }

  var yahoos = priced.map(function(s){ return s.yahoo_ticker; }).filter(function(v,i,a){ return a.indexOf(v) === i; });
  /* V35.3 — the departing holdings are priced too. They are not in stocksData, so
     nothing had ever fetched them, and without a live price the cost card cannot
     say what a sale realises and the sell tickets cannot show what they are worth.
     Added to the same batch rather than a second request. */
  try {
    var d0 = window._bookDiff;
    if (d0 && d0.known && d0.prevPos){
      d0.removed.forEach(function(t){
        var y = (d0.prevPos[t] || {}).y;
        if (y && yahoos.indexOf(y) === -1) yahoos.push(y);
      });
    }
  } catch(e){}

  var cached = force ? null : _loadCachedPx();
  var px = (cached && cached.px) ? cached.px : null;
  if (px) window._pxAt = Number(cached.at) || Date.now();
  if (!px){
    px = await _fetchPricesBatch(yahoos);
    if (!px) px = await _fetchPricesViaChart(yahoos);
    if (px && Object.keys(px).length) _saveCachedPx(px);
  }
  if (!px || !Object.keys(px).length){ if (!quiet) setProfitUnavailable(); return; }
  window._livePx = px;

  paintLivePrices();
  renderProfitHeadline();
  renderCycleCost();   // the sale value and the realised gain move with the price
}

/* ── V35.3 · THE REPOLL FIVE COMMENTS ALREADY DESCRIBED ───────────────────────
   paintLivePrices' per-element data-px-seen flag, the portfolio-map sync hook and
   the attribution card were all written to be safe "on the 30s repoll". There was
   no repoll. The defensive code was right; the timer was simply never built, and
   its absence is what let a live number sit unchanged for a whole session.
   Polls only while the tab is visible and the exchange is open — a hidden tab and
   a closed market are both cases where a request buys nothing — and refetches
   immediately when a member returns to the tab, which is when a stale number is
   most likely to be read. */
var PX_POLL_MS = 5 * 60 * 1000;
function startPricePolling(){
  if (window._mfPxTimer || isDemo) return;
  window._mfPxTimer = setInterval(function(){
    if (window._mfPxOff || document.hidden || !_nseIsOpen()) return;
    try { loadLiveProfit(true, { quiet:true }); } catch(e){}
  }, PX_POLL_MS);
  document.addEventListener('visibilitychange', function(){
    if (document.hidden || isDemo || window._mfPxOff) return;
    // Returning to the tab: refetch only if what is on screen has actually aged
    // past the bound, so tabbing back and forth does not hammer the endpoint.
    var at = Number(window._pxAt) || 0;
    if (!at || (Date.now() - at) > _pxMaxAge()){
      try { loadLiveProfit(true, { quiet:true }); } catch(e){}
    }
  });
}
function setProfitLoading(rebal){
  var d = document.getElementById('pc-rebal-date');
  if (d) d.textContent = rebal ? ('\u00a0· ' + mfDate(rebal, {day:'numeric',month:'short',year:'numeric'})) : '';   // V41.3 — "·" trails
  var pct = document.getElementById('pc-pct'); if (pct){ pct.innerHTML = '<span class="skel-bar pc-skel-num" role="status" aria-label="Calculating your live profit since the rebalance"></span>'; pct.className = 'pc-pct pc-flat'; }
  var sub = document.getElementById('pc-sub'); if (sub) sub.textContent = 'Fetching live prices for your holdings…';
  var br = document.getElementById('pc-breakdown'); if (br) br.innerHTML = '';
  var ld = document.getElementById('pc-leaders'); if (ld) ld.innerHTML = '';
  var tdy = document.getElementById('pc-today'); if (tdy) tdy.hidden = true;
  var card = document.getElementById('profit-card'); if (card) card.classList.remove('is-down');
}
function setProfitUnavailable(){
  var pct = document.getElementById('pc-pct'); if (pct){ pct.textContent = '—'; pct.className = 'pc-pct pc-flat'; }
  var sub = document.getElementById('pc-sub'); if (sub) sub.textContent = 'Live prices are temporarily unavailable — tap Refresh to try again.';
  var br = document.getElementById('pc-breakdown'); if (br) br.innerHTML = '';
  var ld = document.getElementById('pc-leaders'); if (ld) ld.innerHTML = '';
  var tdy = document.getElementById('pc-today'); if (tdy) tdy.hidden = true;
  // V28.3: the attribution card decomposes a headline that no longer exists —
  // leave nothing behind that looks like live attribution.
  var ac = document.getElementById('attrib-card'); if (ac) ac.style.display = 'none';
}
/* V35.3 — "As of", from the price timestamp. Under a minute old it says so in
   words, because a clock time on a number fetched seconds ago reads as older than
   it is; past that it gives the time, which is what a member checking against
   their broker needs. Falls back to the render clock only when nothing recorded a
   fetch, which is the pre-existing behaviour and is never worse than it was. */
function _asOfLabel(){
  var at = Number(window._pxAt) || 0;
  if (!at) return 'As of ' + mfDateTime(new Date(), {day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
  var age = Date.now() - at;
  if (age < 60000) return 'Prices just now';
  return 'Prices as of ' + mfDateTime(new Date(at), {day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'});
}
function _retPct(rec, live){ return rec > 0 ? ((live - rec) / rec * 100) : null; }
// V14.6: count the headline % up from 0 on first paint (a tactile premium touch,
// matching the KPI count-ups). Only the FIRST render per load animates — capital
// tweaks re-render instantly. Reduced-motion / hidden-tab safe.
function _animatePct(el, target){
  /* V41.3 — the sign follows the PRINTED figure (V37.4's rule for the 1D line): a book down
     0.0035% read "-0.00%" in the headline, a signed zero, beside "net −0.00%" below it. */
  var fmt = function(v){ var s = v.toFixed(2); if (parseFloat(s) === 0) s = (0).toFixed(2); return (parseFloat(s) > 0 ? '+' : '') + s + '%'; };
  /* V30.2 — the tween owned no handle, so a second call inside its 750ms window
     could not stop it: the new value was written, and the frames still queued
     from the OLD run overwrote it and settled on the OLD number. Reproduced by
     re-rendering the headline mid-count-up with an all-negative price set — the
     card went into its is-down state and the attribution card read −5.15 pp
     while the headline still said "+2.31%". Reachable from Refresh (which
     re-arms _profitAnimated) and from the V35.3 price repoll. Cancel before writing. */
  if (window._pctRAF) { cancelAnimationFrame(window._pctRAF); window._pctRAF = null; }
  if (window._profitAnimated || document.hidden ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches){
    el.textContent = fmt(target); window._profitAnimated = true; return;
  }
  window._profitAnimated = true;
  var dur = 750, start = performance.now();
  (function step(now){
    var t = Math.min(1, (now - start) / dur), e = 1 - Math.pow(1 - t, 3);
    el.textContent = fmt(target * e);
    if (t < 1) { window._pctRAF = requestAnimationFrame(step); }
    else { window._pctRAF = null; el.textContent = fmt(target); }
  })(performance.now());
}
function paintLivePrices(){
  // Per-row % = (live − rec_price) / rec_price, using the SAME rec_price shown in
  // the cell. V16.3: the portfolio HEADLINE (renderProfitHeadline) now uses this
  // identical rec_price basis too, so the summary is exactly the weight-weighted
  // aggregate of these per-row returns — they can never drift apart.
  var px = window._livePx || {};
  document.querySelectorAll('.px-live').forEach(function(el){
    var y = el.getAttribute('data-px'); var rec = Number(el.getAttribute('data-rec')) || 0;
    var p = px[y];
    if (!p || !rec){ el.innerHTML = '—'; return; }
    var live = p.price; var r = _retPct(rec, live);
    /* V37.4 — THE SIGN AND THE CLASS WERE DECIDED BY DIFFERENT RULES.
       The class used a ±0.05 flat band; the sign used `r > 0`. So any return
       between 0 and +0.05 was classed `flat` and printed `+0.0%` — a plus sign
       on a figure the page had just declared to be no move — and any return
       between −0.05 and 0 printed `-0.0%`, because `(-0.04).toFixed(1)` is
       "-0.0". Measured live: a row up 0.04% read "+0.0%" and a row down 0.04%
       read "-0.0%", both in the flat ink, three strings for one statement and
       one of them a signed zero.
       The band decides everything now: inside it the figure IS zero and carries
       no sign, outside it the sign follows the direction. Same fix applied to
       the 1D figure below, which had the identical split. */
    var flat = !(r > 0.05) && !(r < -0.05);
    var cls  = flat ? 'flat' : (r > 0 ? 'up' : 'down');
    var sign = (!flat && r > 0) ? '+' : '';
    var rTxt = flat ? (0).toFixed(1) : r.toFixed(1);
    /* V37.2 — THE DAY'S MOVE, WHICH THIS PAGE HAS BEEN FETCHING AND NEVER SHOWING.
       Every price poll already returns prev_close — the Apps Script sends it on
       both the `prices` and the `chart` action, and _fetchPricesBatch has been
       mapping it to p.prev since it was written. Nothing rendered it. So the
       dashboard held the one number every broker app leads with (Kite's
       "LTP 2,311.65 (0.69%)") and showed the member none of it, at zero extra
       request cost.

       IT IS A SEPARATE FACT FROM THE RETURN BESIDE IT and is labelled so. The
       .ret figure is the move since the model RECOMMENDED the name, which can be
       months; 1D is today. Conflating the two would be the derived-verdict error
       — two percentages next to each other that mean different things — so the
       day move carries its own "1D" label and its own muted styling, and the
       since-recommendation return keeps the prominence.

       PERCENT ONLY, never rupees. A day move in rupees is a property of a
       POSITION, and most rows here are "shares to buy" — a rupee figure on a
       name the member does not hold yet is the same error V35.4 removed from the
       tick column. The percentage is a property of the stock and is true for
       every row. (Rupee P&L on what they actually hold already has a home: the
       "Your position" card, which is fed from their own recorded fills.)

       One writer, two surfaces: this function paints both the desktop table cell
       and the phone card, so the markup lands in both and CSS decides how each
       one flows. */
    /* V37.2 — data-px-mode="ret" renders ONLY the return. The "Hold · carried
       over" chips want the verdict, not the price and not the day move: they sit
       three-to-a-row in a narrow column and a full price line would not fit. They
       go through this writer rather than formatting their own number so they
       repaint on the 5-minute repoll like every other live figure on the page —
       a chip that formatted its own value once would be the stale-number bug
       V35.3 spent a release removing. */
    if (el.getAttribute('data-px-mode') === 'ret'){
      el.innerHTML = '<span class="ret ' + cls + '">' + sign + rTxt + '%</span>';
      if (!el.dataset.pxSeen) { el.dataset.pxSeen = '1'; el.classList.add('px-in'); }
      return;
    }
    var dayHtml = '';
    // V44.5 — Yahoo's previous close stays unadjusted on an ex-date, and a one-day move over
    // 35% is a split or bonus, not a move (mfc-insight's rule). No 1D beats a false one.
    if (p.prev != null && Number(p.prev) > 0 && Math.abs((live - p.prev) / p.prev * 100) <= 35){
      var d = (live - p.prev) / p.prev * 100;
      /* The 1D figure prints at TWO decimals, so unlike the return above it can
         still show a real value inside the flat band — −0.04% is a number, not a
         rounded-off zero, and blanking it would throw away the only precision
         this line has. Only the sign is conditioned, and only on what is
         actually printed: `(-0.002).toFixed(2)` is "-0.00", which is the same
         signed zero, one decimal further down. */
      var dcls  = d > 0.05 ? 'up' : (d < -0.05 ? 'down' : 'flat');
      var dTxt  = d.toFixed(2);
      if (parseFloat(dTxt) === 0) dTxt = (0).toFixed(2);
      var dsign = (d > 0 && parseFloat(dTxt) !== 0) ? '+' : '';
      dayHtml = ' <span class="px-day"><i>1D</i><b class="ret ' + dcls + '">' +
                dsign + dTxt + '%</b></span>';
    }
    el.innerHTML = fmtPrice(live) + ' <span class="ret ' + cls + '">' + sign + rTxt + '%</span>' + dayHtml;
    // V24.8: fade each price in the FIRST time it lands (the cells used to pop
    // into existence). Marked per-element so the price repoll — and a sort/filter
    // re-render, which reuses painted cells — never re-flashes the table.
    if (!el.dataset.pxSeen) { el.dataset.pxSeen = '1'; el.classList.add('px-in'); }
  });
  // V36.6 — the member's own P&L moves with the same prices these cells do, so
  // it is re-derived here rather than on a timer of its own.
  try { renderMyPosition(); } catch (e) {}
  try { if (window.adjRefresh) window.adjRefresh(); } catch (e) {}   // V37.5 — sized at live prices
  // V44.2 — a sale is valued at its live price, so the band follows it; only on a change,
  // because a re-draw replaces its buttons and this runs every five minutes
  try {
    var _kp = kiteBasketPlan(), _ks = _kp.fundIn + '|' + _kp.sellVal;
    if (_ks !== window._kbPxSig){ window._kbPxSig = _ks; refreshKiteBasket(); }
  } catch (e) {}
}
/* ══ V36.6 — YOUR POSITION ═══════════════════════════════════════════════════
   The member's own return, from the member's own basis. This is the answer to
   the question a ₹1,499/month subscriber could not previously ask this page:
   not "how did the model do" (renderProfitHeadline, above, against
   recommended_price) and not "how did MindForge's own account do" (the Zerodha
   verified link), but "how am I doing".

   FOUR RULES IT HAS TO KEEP.
   1. It reports only what the member told it. A row with no recorded price is
      skipped, never dashed or guessed at, and a cycle with no priced ticks
      hides the card entirely.
   2. It never borrows the site's other badges. Nothing here says "backtest" —
      because it is not simulated — and nothing wears a LIVE badge, which on
      this site means a figure from live-perf.json. It says "your".
   3. The basis is the member's fill price, NOT recommended_price. Those differ,
      which is the entire point: a member who bought a day late at a worse price
      should see their own number, not the model's.
   4. It is unrealised only, and says so. Realised P&L needs sell-side matching
      across cycles and is not claimed here.
   ═══════════════════════════════════════════════════════════════════════════ */
function renderMyPosition(){
  var card = document.getElementById('mypos-card');
  if (!card) return;
  try {
    var map = loadBought(currentStrategy) || {};
    var px  = window._livePx || {};
    var rows = [], cost = 0, now = 0, priced = 0, unpriced = 0, noLive = 0;
    // renderTable's fmtAmt is a const inside that function, so it is not in
    // scope here. fmtINR() rounds and never signs, so a gain formats the sign
    // itself and OUTSIDE the currency symbol: "−₹1,240", not "₹-1,240".
    var amt  = function (n) { return '₹' + fmtINR(n); };
    var sAmt = function (n) { return (n < 0 ? '\u2212' : '+') + '₹' + fmtINR(Math.abs(n)); };

    (stocksData || []).forEach(function(s){
      var v = map[s.ticker];
      if (!v) return;
      if (typeof v !== 'object' || !(Number(v.p) > 0)) { unpriced++; return; }
      var q = Number(v.q) || 0;
      if (q <= 0) { unpriced++; return; }
      priced++;
      var mine = Number(v.p);
      var p = px[s.yahoo_ticker];
      var live = (p && Number(p.price) > 0) ? Number(p.price) : null;
      if (live == null) noLive++;
      var c = mine * q;
      cost += c;
      if (live != null) now += live * q;
      rows.push({ t: s.ticker, q: q, mine: mine, live: live,
                  gain: (live != null ? (live - mine) * q : null),
                  pct:  (live != null ? (live - mine) / mine * 100 : null) });
    });

    if (!rows.length) { card.style.display = 'none'; return; }
    card.style.display = '';

    document.getElementById('mypos-body').innerHTML = rows.map(function(r){
      var cls = r.gain == null ? '' : (r.gain > 0 ? 'up' : (r.gain < 0 ? 'down' : ''));
      var sign = (r.gain != null && r.gain > 0) ? '+' : '';   // for the % only
      // V37.6 — each cell names its column (class + data-k), so the phone layout
      // below can label and place it without counting columns.
      return '<tr role="row">' +
        '<td role="cell" class="myp-tk">' + escapeHtml(r.t) + '</td>' +
        '<td role="cell" class="r myp-q" data-k="Shares">' + r.q + '</td>' +
        '<td role="cell" class="r myp-paid" data-k="Your price"><input type="number" class="myp-px" inputmode="decimal" step="0.05" min="0"' +
          ' value="' + r.mine.toFixed(2) + '"' +
          ' aria-label="Price you paid for ' + escapeHtml(r.t) + ', per share"' +
          ' data-myp="' + escapeHtml(r.t) + '" onchange="setFillPrice(this)"></td>' +
        '<td role="cell" class="r myp-live" data-k="Live">' + (r.live != null ? fmtPrice(r.live) : '—') + '</td>' +
        '<td role="cell" class="r myp-gain ' + cls + '">' + (r.gain != null
            ? sAmt(r.gain) + ' <span class="' + cls + '">' + sign + r.pct.toFixed(1) + '%</span>'
            : '—') + '</td>' +
      '</tr>';
    }).join('');

    var pnl = now - cost;
    var pnlPct = cost > 0 ? (pnl / cost * 100) : 0;
    var pcls = pnl > 0 ? 'up' : (pnl < 0 ? 'down' : '');
    var psign = pnl > 0 ? '+' : '';
    document.getElementById('mypos-cost').textContent = amt(cost);
    // "Worth now" is only comparable to "You invested" when every row has a
    // live price. When some do not, saying so is the honest move — a total that
    // silently omits three holdings is the self-consistent wrong number this
    // codebase has been bitten by before.
    document.getElementById('mypos-now').textContent = noLive ? '—' : amt(now);
    var pnlEl = document.getElementById('mypos-pnl');
    pnlEl.className = '';
    if (noLive) { pnlEl.textContent = '—'; }
    else {
      pnlEl.innerHTML = '<span class="' + pcls + '">' + sAmt(pnl) +
                        ' (' + psign + pnlPct.toFixed(1) + '%)</span>';
    }

    var sub = priced + (priced === 1 ? ' holding' : ' holdings') + ' you have recorded';
    document.getElementById('mypos-sub').textContent = sub;

    var bits = ['Unrealised only, measured against the price YOU entered — not the recommended price, and not a MindForge performance figure. Correct any price above and this updates.'];
    if (unpriced) bits.push(unpriced + (unpriced === 1 ? ' ticked order has' : ' ticked orders have') +
      ' no price recorded yet, so ' + (unpriced === 1 ? 'it is' : 'they are') +
      ' left out. Un-tick and re-tick to record one.');
    if (noLive) bits.push('Live prices are missing for ' + noLive + ' of these, so the totals are withheld rather than computed from a partial set.');
    var _splN = rows.filter(function(r){ return map[r.t] && map[r.t].spl; }).map(function(r){ return r.t; });   // V44.5
    if (_splN.length) bits.push(_splN.join(', ') + ': shares and price are shown after the split.');
    document.getElementById('mypos-note').textContent = bits.join(' ');

    // The fade is a statement about this table at this width, so it is set from
    // the measurement rather than from a breakpoint, and it comes OFF once the
    // reader has scrolled to the end.
    var sc = card.querySelector('.mypos-scroll');
    if (sc) {
      var cue = function () {
        var more = sc.scrollWidth - sc.clientWidth - sc.scrollLeft > 8;
        sc.classList.toggle('has-more', more);
      };
      if (!sc.dataset.cueBound) {
        sc.dataset.cueBound = '1';
        sc.addEventListener('scroll', cue, { passive: true });
        window.addEventListener('resize', cue, { passive: true });
      }
      cue();
    }
  } catch (e) { try { card.style.display = 'none'; } catch (e2) {} }
}

/* The member correcting a fill price. Writes through saveBought, so the change
   reaches localStorage and the server copy by the same path a tick does. */
function setFillPrice(inp){
  try {
    var t = inp.getAttribute('data-myp');
    var v = Number(inp.value);
    if (!t) return;
    var map = loadBought(currentStrategy) || {};
    var cur = map[t];
    if (!cur || typeof cur !== 'object') return;
    if (!(v > 0)) { inp.value = Number(cur.p || 0).toFixed(2); return; }  // refuse 0 / negative
    cur.p = Math.round(v * 100) / 100;
    cur.t = new Date().toISOString();
    map[t] = cur;
    saveBought(currentStrategy, map);
    renderMyPosition();
  } catch (e) {}
}

function renderProfitHeadline(){
  var px = window._livePx || {}; var stocks = stocksData || [];
  var wSum = 0, wRet = 0, absGain = 0, up = 0, down = 0, flat = 0, n = 0, best = null, worst = null;
  var contrib = [];   // V28.3 — {t, r, wr} per holding; wr/wSum is its pp of the headline
  var day = { w: 0, wr: 0, n: 0, up: 0, down: 0 };   // V37.6 — the book's 1D move
  stocks.forEach(function(s){
    var rec = Number(s.recommended_price) || 0; var p = px[s.yahoo_ticker];
    if (!rec || !p) return;
    // V16.3: baseline = rec_price (same as the per-row cells), so the headline %,
    // the Top/Lagging chips and the absolute ₹ gain all aggregate the exact
    // per-stock returns shown in the table.
    var r = _retPct(rec, p.price); if (r == null) return;
    var w = Number(s.weight_pct) || 0;
    wSum += w; wRet += w * r; n++;
    // Same expression and the same ±0.05 flat band paintLivePrices uses for the
    // row's own 1D figure, so the total is the weighted sum of what the rows print.
    var pv = Number(p.prev) || 0;
    if (pv > 0 && Number(p.price) > 0){
      var dr = (Number(p.price) - pv) / pv * 100;
      if (Math.abs(dr) <= 35){                 // V44.5 — see paintLivePrices
        day.w += w; day.wr += w * dr; day.n++;
        if (dr > 0.05) day.up++; else if (dr < -0.05) day.down++;
      }
    }
    contrib.push({ t: s.ticker, r: r, wr: w * r });
    /* V37.3 — the third class. This counted two and printed two, so a holding
       inside the ±0.05 flat band was silently dropped: the card read "Weighted
       return across 10 holdings" beside "6 up · 3 down", and the tenth was
       nowhere. The band itself is right and is the site-wide convention (see
       screener/index.html::fmtChange and export_static.py::_chg — a dead-flat
       day is not an up day); what was missing was the bucket it sorts into.
       The flat row is rendered only when it is non-empty, so the usual card is
       unchanged and the arithmetic now closes whenever it would not have. */
    if (r > 0.05) up++; else if (r < -0.05) down++; else flat++;
    if (!best || r > best.r) best = { t: s.ticker, r: r };
    if (!worst || r < worst.r) worst = { t: s.ticker, r: r };
    var shares = Math.floor(allocBudget(s, stocks, currentCapital) / rec);
    absGain += shares * rec * (r / 100);
  });
  var card = document.getElementById('profit-card');
  if (!n){ setProfitUnavailable(); return; }
  var port = wSum > 0 ? (wRet / wSum) : 0;
  card.classList.toggle('is-down', port < -0.05);
  var pct = document.getElementById('pc-pct');
  pct.className = 'pc-pct' + (Math.abs(port) <= 0.05 ? ' pc-flat' : '');
  _animatePct(pct, port);
  // Date label: the rebalance date the picks were published (parsed from the run_id,
  // falling back to the subscription date) — i.e. when these rec_prices were set.
  var rebal = window._rebalDate;
  var absSign = absGain >= 0 ? '+' : '−';
  var absStr = fmtMoney(Math.abs(Math.round(absGain)));
  var sub = document.getElementById('pc-sub');
  /* V39.5 — B1: with names on the member's restricted list the percentage is still the
     MODEL's (every published holding) while the rupees are the member's own book, so
     the line says which is which instead of letting one pass for the other. */
  var _nRs = (stocks || []).filter(function(x){ return _isRestricted(x.ticker); }).length;
  var _rsOut = _nRs ? ', leaving out your ' + _nRs + ' restricted name' + (_nRs === 1 ? '' : 's') + ',' : '';
  sub.innerHTML = (_nRs ? 'The model’s weighted return across ' : 'Weighted return across ') + n + ' holding' + (n !== 1 ? 's' : '') + ' since the rebalance' +
    (rebal ? ' on <strong>' + mfDate(rebal, {day:'numeric',month:'short',year:'numeric'}) + '</strong>' : '') +
    (window._capEntered
      ? '. On your ' + fmtMoney(currentCapital) + _rsOut + ' that is <strong class="pc-amt">' + absSign + absStr + '</strong>.'
      // V39.3 — B4: never "your" for an amount the member did not set.
      : '. On ' + fmtMoney(currentCapital) + ', the starting amount rather than one you entered, that is <strong class="pc-amt">' +
        absSign + absStr + '</strong>. <button type="button" class="pc-capfix" onclick="abarEditCapital()">Enter yours</button>');
  var d = document.getElementById('pc-rebal-date'); if (d) d.textContent = '';
  var br = document.getElementById('pc-breakdown');
  if (br) br.innerHTML =
    '<div class="pc-stat"><span class="pc-dot pc-up-dot"></span><b>' + up + '</b> up</div>' +
    '<div class="pc-stat"><span class="pc-dot pc-down-dot"></span><b>' + down + '</b> down</div>' +
    (flat ? '<div class="pc-stat"><span class="pc-dot pc-flat-dot"></span><b>' + flat + '</b> flat</div>' : '') +
    // V35.3 — the time the PRICES were fetched, not the time this line was
    // written. It printed new Date(), and renderProfitHeadline re-runs on every
    // capital change, so the stamp followed the member's typing over prices that
    // could be hours old. _pxAt is set by _saveCachedPx on a fetch and from the
    // cache record on a read, so it is right down both paths.
    '<div class="pc-asof">' + _asOfLabel() + '</div>';
  // V14.4: top / lagging performer chips
  var ld = document.getElementById('pc-leaders');
  if (ld) {
    function chip(lbl, x){
      if (!x) return '';
      var cls = x.r > 0.05 ? 'up' : (x.r < -0.05 ? 'down' : 'flat');
      var sign = x.r > 0 ? '+' : '';
      return '<span class="pc-chip"><span class="pc-chip-lbl">' + lbl + '</span>' + escapeHtml(x.t) +
             ' <span class="pc-chip-ret ' + cls + '">' + sign + x.r.toFixed(1) + '%</span></span>';
    }
    ld.innerHTML = (n >= 2 && best && worst && best.t !== worst.t) ? (chip('Top', best) + chip('Lagging', worst)) : '';
  }
  try { renderTodayMove(day, n); } catch (e) { var tdy = document.getElementById('pc-today'); if (tdy) tdy.hidden = true; }
  // V28.3: attribution card. Same wRet/wSum the headline came from, so it is a
  // decomposition of that number and not a second opinion about it.
  try { renderAttribution(contrib, wSum, port); } catch (e) { var ac = document.getElementById('attrib-card'); if (ac) ac.style.display = 'none'; }
  try { renderRiskLine(port); } catch (e) {}   // V39.1 — B3
  // V27.9: benchmark row. Non-blocking — the headline never waits on it.
  loadBenchPerf().then(function(){ try { renderBenchCompare(port); } catch (e) {} });
  try { if (window.mfcInsight) window.mfcInsight.refresh('prices'); } catch (e) {}   // V42.3 — insight cards read the same prices
}

/* V37.6 — the book's day move, on the line under the since-rebalance headline.
   Two decimals and the ±0.05 band, exactly as each row's own 1D figure, so the
   total reads as the sum of what the table prints. Withheld — not computed from
   a partial set — when fewer than four in five priced holdings carry a previous
   close: a book total that quietly leaves names out is the self-consistent wrong
   number this card has always refused to print. */
function renderTodayMove(day, nPriced){
  var el = document.getElementById('pc-today');
  if (!el) return;
  if (!day || !(day.w > 0) || day.n < 2 || day.n < Math.ceil(nPriced * 0.8)){
    el.hidden = true; el.innerHTML = ''; el.removeAttribute('aria-label'); return;
  }
  var v = day.wr / day.w;
  var num = parseFloat(v.toFixed(2));
  var cls = v > 0.05 ? 'up' : (v < -0.05 ? 'down' : '');
  var txt = (num > 0 ? '+' : num < 0 ? '−' : '') + Math.abs(num).toFixed(2) + '%';
  // NSE closed means prev_close is the session before the last traded one, so
  // the move is that session's, whatever the calendar says.
  var when = _nseIsOpen() ? 'today' : 'on the last session';
  var flat = day.n - day.up - day.down;
  var br = day.up + ' up · ' + day.down + ' down' + (flat ? ' · ' + flat + ' flat' : '') +
           (day.n < nPriced ? ' · ' + day.n + ' of ' + nPriced + ' priced' : '');
  el.innerHTML = '<span class="pct-k" aria-hidden="true">1D</span>' +
    '<span><b class="pct-v ' + cls + '">' + txt + '</b> ' + when + '</span>' +
    '<span class="pct-br">' + br + '</span>';
  el.setAttribute('aria-label', 'Your book moved ' + txt + ' ' + when + ': ' + br + '.');
  el.hidden = false;
}

/* ══════════════════════════════════════════════════════════════════════════
   V28.3 — RETURN ATTRIBUTION
   --------------------------------------------------------------------------
   contribution_i (in percentage points of the headline) = w_i * r_i / SUM(w).
   SUM(contribution_i) === wRet / wSum === the headline, by construction.

   Guards, all of them about not drawing a conclusion the data cannot support:
     * fewer than 3 priced holdings -> no card. With one or two names the split
       IS the ladder and the concentration claim is vacuous.
     * a headline that rounds to 0.00% still gets the card — that is exactly the
       case where lift and drag cancelling is the interesting fact.
     * the ladder is capped, and when it caps it SAYS what it dropped and the
       range those dropped contributions span. A "top 5" list that looks like
       the whole book is the failure mode this comment exists to prevent.
   ══════════════════════════════════════════════════════════════════════════ */
function renderAttribution(rows, wSum, port){
  var card = document.getElementById('attrib-card');
  if (!card) return;
  if (!rows || rows.length < 3 || !(wSum > 0)) { card.style.display = 'none'; return; }

  // pp of the headline, per holding
  var pp = rows.map(function(x){ return { t: x.t, r: x.r, c: x.wr / wSum }; })
               .sort(function(a, b){ return b.c - a.c; });
  var lift = 0, drag = 0;
  pp.forEach(function(x){ if (x.c > 0) lift += x.c; else drag += x.c; });
  var gross = lift - drag;                       // drag is negative
  if (!(gross > 0.0001)) { card.style.display = 'none'; return; }

  var fmtPP = function(v){ var s = Math.abs(v).toFixed(2); return (s === '0.00' ? '' : v > 0 ? '+' : '−') + s; };   // V41.3 — no signed zero
  document.getElementById('at-lift').textContent = fmtPP(lift) + '\u00a0pp';
  document.getElementById('at-drag').textContent = drag < 0 ? fmtPP(drag) + '\u00a0pp' : '0.00\u00a0pp';

  // ── the split. Both segments on ONE track, so the headline reads as a net.
  var liftShare = (lift / gross) * 100;
  // No text inside the segments: the keys directly below already carry the two pp
  // figures, and a share-of-gross % printed here sat 30px from the "top 3 supply
  // N% of the lift" sentence — two different percentages of two different things,
  // side by side. The track is geometry; the numbers live in the keys.
  var segL = document.getElementById('at-seg-lift'), segD = document.getElementById('at-seg-drag');
  segL.setAttribute('data-bar', liftShare.toFixed(1) + '%');
  segD.setAttribute('data-bar', (100 - liftShare).toFixed(1) + '%');
  document.getElementById('at-split-track').setAttribute('title',
    'Gross lift ' + fmtPP(lift) + ' pp against gross drag ' + fmtPP(drag) + ' pp — netting to ' + fmtPP(port) + '%');

  // ── concentration: the "one lucky stock" test
  var top3 = pp.slice(0, Math.min(3, pp.length)).reduce(function(a, x){ return a + Math.max(0, x.c); }, 0);
  var conc = lift > 0.0001 ? Math.round((top3 / lift) * 100) : 0;
  var nDown = pp.filter(function(x){ return x.c < 0; }).length;
  var net = document.getElementById('at-net');
  /* V30.2 — this sentence assumed there was a gain to describe. On a down cycle
     — nothing in the book up, which is an ordinary month, not an edge case —
     lift is 0 while gross is |drag|, so the card passed its guard and rendered
     "The gain is 0% spread beyond the top 3 of 25 holdings, and 25 holdings
     cost you 5.15 pp." There is no gain, 0% of it cannot be spread anywhere,
     and "spread beyond the top 3" is the reassuring end of the concentration
     scale being read out over a loss. Reproduced by feeding the card an
     all-negative price set. Say what happened instead. */
  if (!(lift > 0.0001)) {
    net.innerHTML =
      'Nothing in this book is up since the rebalance &mdash; <b>' + nDown + '</b> of <b>' +
      pp.length + '</b> priced holding' + (pp.length === 1 ? '' : 's') + ' cost you <b>' +
      Math.abs(drag).toFixed(2) + '\u00a0pp</b> between them.';
  } else if (port < -0.05) {
    /* V42.1 — B8. V30.2 handled "nothing up". With something up and the book still
       down it read "The gain is 100% concentrated in the top 3 of 8 holdings" on a
       −1.23% card: there is no gain, and only one holding rose. Say what happened. */
    var nUp = pp.filter(function(x){ return x.c > 0; }).length;
    net.innerHTML =
      'This book is down: <b>' + nDown + '</b> of <b>' + pp.length + '</b> priced holding' + (pp.length === 1 ? '' : 's') +
      ' cost it <b>' + Math.abs(drag).toFixed(2) + '\u00a0pp</b>, and <b>' + nUp + '</b> added <b>' +
      Math.abs(lift).toFixed(2) + '\u00a0pp</b>.';
  } else {
    var concWord = conc >= 75 ? 'concentrated in' : conc >= 50 ? 'led by' : 'spread beyond';
    var nRose = pp.filter(function(x){ return x.c > 0; }).length;   // V42.1 — never a "top N" larger than what rose
    net.innerHTML =
      'The gain is <b>' + conc + '%</b> ' + concWord + ' the top ' + Math.max(1, Math.min(3, pp.length, nRose)) +
      ' of ' + pp.length + ' holdings' +
      (nDown ? ', and <b>' + nDown + '</b> holding' + (nDown === 1 ? '' : 's') +
               ' cost you <b>' + Math.abs(drag).toFixed(2) + '\u00a0pp</b>.' : '.');
  }

  // ── the ladder. Held on window so the Holding / Industry toggle can redraw
  //    it without re-deriving a single contribution (V37.6).
  window._atState = { pp: pp, port: port };
  _atRenderLadder();
  card.style.display = '';
}

/* V37.6 — WHERE THE NUMBER CAME FROM, BY INDUSTRY.
   The ladder answers "which holdings"; a member's next question is "which part
   of the market", and on a two-per-industry book the answer is not visible from
   fifteen rows sorted by size — two Capital Goods names can sit at ranks 2 and 11.
   Each group's figure is the plain SUM of its holdings' contributions, so the
   groups still add up to the headline exactly, the same promise the holdings view
   makes. Grouped by groupKeyOf(), the key the chips, the allocation card and the
   donut already use, so a MultiAsset book reads by asset class here too, and each
   group wears the colour it wears everywhere else on the page. */
function _atRenderLadder(){
  var st = window._atState; if (!st || !st.pp) return;
  var pp = st.pp, port = st.port;
  var card = document.getElementById('attrib-card');
  var fmtPP = function(v){ var s = Math.abs(v).toFixed(2); return (s === '0.00' ? '' : v > 0 ? '+' : '−') + s; };   // V41.3 — no signed zero
  var list = stocksData || [];
  var byT = {}; list.forEach(function(s){ byT[String(s.ticker)] = s; });

  // groups — built first so the toggle can stand down on a one-group book
  var gmap = {}, groups = [];
  pp.forEach(function(x){
    var s = byT[String(x.t)]; if (!s) return;
    var k = groupKeyOf(s);
    if (!gmap[k]){ gmap[k] = { t: k, c: 0, n: 0 }; groups.push(gmap[k]); }
    gmap[k].c += x.c; gmap[k].n++;
  });
  var aclass = isAssetClassBook(list);
  var gWord = aclass ? 'asset class' : 'industry', gWords = aclass ? 'asset classes' : 'industries';
  var head = document.getElementById('at-lhead'), tog = document.getElementById('at-tog');
  var canGroup = groups.length >= 2 && groups.length < pp.length;
  var mode = 'hold';
  try { if (localStorage.getItem(_devKey('mfc_attrib_view')) === 'grp') mode = 'grp'; } catch (e) {}
  if (!canGroup) mode = 'hold';
  if (head){
    head.hidden = !canGroup;
    var gb = document.getElementById('at-tog-grp');
    if (gb) gb.textContent = aclass ? 'Asset class' : 'Industry';
    if (tog){
      tog.querySelectorAll('button[data-at]').forEach(function(b){ b.setAttribute('aria-pressed', String(b.getAttribute('data-at') === mode)); });
      if (!tog.dataset.bound){
        tog.dataset.bound = '1';
        tog.addEventListener('click', function(ev){
          var b = ev.target && ev.target.closest ? ev.target.closest('button[data-at]') : null;
          if (!b) return;
          try { localStorage.setItem(_devKey('mfc_attrib_view'), b.getAttribute('data-at')); } catch (e) {}
          _atRenderLadder();
        });
      }
    }
  }

  var rowsEl = document.getElementById('at-rows'), foot = document.getElementById('at-foot');
  var html = '', base = '';
  if (mode === 'grp'){
    var colorMap = buildSectorColorMap(list);
    var gUp = groups.filter(function(g){ return g.c > 0; }).sort(function(a, b){ return b.c - a.c; });
    var gDn = groups.filter(function(g){ return g.c <= 0; }).sort(function(a, b){ return a.c - b.c; });
    var gMax = Math.max.apply(null, groups.map(function(g){ return Math.abs(g.c); }).concat([0.0001]));
    var gRow = function(g){
      var cls = g.c >= 0 ? 'up' : 'down';
      var w = (Math.abs(g.c) / gMax) * 100;
      return '<div class="at-row at-grow" title="' + escapeHtml(g.t) + ' · ' + g.n + ' holding' + (g.n === 1 ? '' : 's') +
             ' · ' + fmtPP(g.c) + ' pp of the headline">' +
             '<span class="at-tick at-grp"><i class="at-dot" style="background:' + groupColorOf(g.t, colorMap) + '"></i>' +
               '<span class="at-grp-nm">' + escapeHtml(g.t) + '</span><em class="at-grp-n">' + g.n + '</em></span>' +
             '<span class="at-track"><i class="at-fill ' + cls + '" data-bar="' + w.toFixed(1) + '%"></i></span>' +
             '<span class="at-pp ' + cls + '">' + fmtPP(g.c) + '</span></div>';
    };
    html = gUp.map(gRow).join('');
    if (gDn.length){
      if (gUp.length) html += '<div class="at-gap" aria-hidden="true">holding it back</div>';
      html += gDn.map(gRow).join('');
    }
    base = 'Each ' + gWord + '’s figure is the sum of its holdings’ contributions — weight × move since the rebalance, in percentage points of the headline. All ' +
           groups.length + ' ' + gWords + ' sum to that headline exactly; the number beside each name is how many holdings it has.';
  } else {
    // ── Widest bar = largest absolute contribution.
    var LIFT_N = 5, DRAG_N = 3;
    var ups = pp.filter(function(x){ return x.c > 0; });
    var downs = pp.filter(function(x){ return x.c < 0; }).reverse();   // worst first
    var shownUp = ups.slice(0, LIFT_N), shownDown = downs.slice(0, DRAG_N);
    var maxAbs = Math.max.apply(null, pp.map(function(x){ return Math.abs(x.c); }).concat([0.0001]));

    var rowHTML = function(x){
      var cls = x.c >= 0 ? 'up' : 'down';
      var w = (Math.abs(x.c) / maxAbs) * 100;
      return '<div class="at-row" title="' + escapeHtml(x.t) + ' · ' + (x.r > 0 ? '+' : '') + x.r.toFixed(1) +
             '% since the rebalance · ' + fmtPP(x.c) + ' pp of the headline">' +
             '<span class="at-tick">' + escapeHtml(x.t) + '</span>' +
             '<span class="at-track"><i class="at-fill ' + cls + '" data-bar="' + w.toFixed(1) + '%"></i></span>' +
             '<span class="at-pp ' + cls + '">' + fmtPP(x.c) + '</span></div>';
    };
    html = shownUp.map(rowHTML).join('');
    if (shownDown.length){
      // V30.2: the divider separates lift from drag, so it needs something above
      // it. On the all-down cycle above it was the first thing in the ladder —
      // "holding it back" captioning nothing.
      if (shownUp.length) html += '<div class="at-gap" aria-hidden="true">holding it back</div>';
      html += shownDown.map(rowHTML).join('');
    }

    // ── say what was dropped, and the range it spans. Never a silent cap.
    var hidden = (ups.length - shownUp.length) + (downs.length - shownDown.length);
    base = 'Contribution = the holding’s model weight × its move since the rebalance, in percentage points of the headline above. All ' +
           pp.length + ' contributions sum to that headline exactly.';
    if (hidden > 0){
      var rest = ups.slice(shownUp.length).concat(downs.slice(shownDown.length)).map(function(x){ return x.c; });
      var lo = Math.min.apply(null, rest), hi = Math.max.apply(null, rest);
      /* V37.4 — this sentence had one shape for three cases and got two of them
         wrong. Measured on a ten-name book with four holdings down, which is an
         ordinary month: "The 1 not listed each contributed between −0.01 and
         −0.01 pp." — "each" of one, and a range whose ends are the same number.
         The range is only a range when the two ENDS DIFFER ONCE FORMATTED; the
         raw floats almost never tie, so the comparison has to be made on the
         strings the reader actually sees, not on the values behind them. */
      var loS = fmtPP(lo), hiS = fmtPP(hi);
      base += (hidden === 1)
        ? ' The one not listed contributed ' + loS + '\u00a0pp.'
        : (loS === hiS)
          ? ' The ' + hidden + ' not listed each contributed ' + loS + '\u00a0pp.'
          : ' The ' + hidden + ' not listed each contributed between ' + loS + ' and ' + hiS + '\u00a0pp.';
    }
  }
  if (rowsEl) rowsEl.innerHTML = html;
  if (foot) foot.textContent = base;

  document.getElementById('at-sub').textContent = (mode === 'grp'
      ? groups.length + ' ' + (groups.length === 1 ? gWord : gWords)
      : pp.length + ' priced holding' + (pp.length === 1 ? '' : 's')) + ' · net ' + fmtPP(port) + '%';

  // shared [data-bar] applier: paint from 0 so every bar GROWS (site idiom)
  if (!card) return;
  requestAnimationFrame(function(){
    card.querySelectorAll('[data-bar]').forEach(function(b){ b.style.width = b.dataset.bar; });
  });
  setTimeout(function(){
    card.querySelectorAll('[data-bar]').forEach(function(b){ b.style.width = b.dataset.bar; });
  }, 160);   // frame-starved fallback, same as the score distribution bar
}

/* ══════════════════════════════════════════════════════════════════════════
   V27.9 — BENCHMARK COMPARISON ON THE LIVE-PROFIT HEADLINE
   --------------------------------------------------------------------------
   The card has always answered "what did I make?" and never "was that good?".
   The answer is already published: live-perf.json carries each strategy's
   benchmark and that benchmark's own move over the same cycle, and the public
   site has led with it since the V24.2 pivot. The member surface was the one
   place it never reached.

   TWO GUARDS, both about not publishing a misleading comparison:
   (1) the member's % is measured from THEIR rec_prices, i.e. from the cycle
       they are actually holding. live-perf.json's benchmark move is measured
       from the LATEST published rebalance. Those are the same window for
       anyone on the current cycle and different windows for anyone who is not,
       so the row renders only when the two rebalance dates match — a member
       still holding last month's picks gets no row rather than a wrong one.
   (2) the strategy must map to a known key; an unrecognised name renders
       nothing instead of guessing a benchmark.
   Fail-soft throughout: no fetch, no data, no match → the card is exactly what
   it was before. ══════════════════════════════════════════════════════════ */
/* V37.6 — the flag is now the PROMISE. It was a boolean set on the first call,
   and every later call returned Promise.resolve(_benchPerf) — which is null for
   as long as the first request is still in the air. renderDashboard makes the
   first call; renderProfitHeadline makes the second the moment prices land. When
   prices came back first — the price cache, which answers without a request for
   five minutes while NSE is open and all evening after the bell — the benchmark
   row read null, drew nothing, and was never asked again until the member
   happened to change their capital. Every caller now waits on the same fetch. */
var _benchPerf = null, _benchPerfP = null;
function loadBenchPerf(){
  if (_benchPerfP) return _benchPerfP;
  try {
    _benchPerfP = fetch('live-perf.json', { cache: 'no-store' })
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(d){ _benchPerf = d; return d; })
      .catch(function(){ return null; });
  } catch (e) { _benchPerfP = Promise.resolve(null); }
  return _benchPerfP;
}
/* V39.1 — B3. THE RED DAY, SAID ONCE. A member meeting their first losing cycle
   was shown the red figure and nothing else. The honest context is how often this
   happens in the model's own backtest — process information, not advice: there is
   no "hold" and no "stay the course" here. Figures are MFRISK markers (#mfrisk),
   written by inject_site_stats.py from the same curve as the drawdown. */
function renderRiskLine(port){
  var el = document.getElementById('pc-risk');
  if (!el) return;
  el.hidden = true; el.innerHTML = '';
  if (!(typeof port === 'number' && isFinite(port) && port < -0.05)) return;   // the site's flat band
  var key = _strategyPerfKey(String(currentStrategy || '')); if (!key) return;
  var neg = _mfData(key + ':neg'), months = _mfData(key + ':months'), worst = _mfData(key + ':worst');
  if (!neg || !months) return;
  el.innerHTML = 'A losing month is part of this book: <b>' + neg + ' of ' + months + '</b> backtested months were negative' +
    (worst ? ', the worst <b>' + worst.replace('-', '\u2212') + '</b>' : '') +
    ', and the model\u2019s rules do not change in a falling one. ' +
    // V42.1 — A5: the window's limit, said where the member decides whether to hold
    'Its backtest held no crash like 2008\u2019s or 2020\u2019s, so a real one can go deeper. <span class="pc-risk-basis">Backtest, before tax.</span>';
  el.hidden = false;
}

function _strategyPerfKey(name){
  if (/multiasset/i.test(name))  return 'ma';
  if (/largemidcap/i.test(name)) return 'lm';
  if (/smallmicro/i.test(name))  return 'sm';
  return null;
}
function _isoDay(d){
  if (!d || isNaN(d)) return null;
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') +
         '-' + String(d.getDate()).padStart(2, '0');
}
/* ── V35.3 · EVERY CYCLE SO FAR ───────────────────────────────────────────────
   The dashboard could show one number and one benchmark comparison, both for the
   cycle in progress, both wiped by the next publish. A member on month seven had
   no record of months one to six — not the returns, not whether the strategy had
   been ahead of its index more often than behind — and the most
   credibility-bearing thing this service owns was invisible on the one page
   members actually open.
   docs/live-history.json now keeps what live-perf.json used to overwrite. It is a
   static file on the same origin, fetched exactly the way live-perf.json already
   is: no backend change, no Apps Script redeploy, and aggregate-only so a
   forwarded page still leaks no picks.
   Fail-soft throughout: no file, no strategy match, no cycles → the card never
   appears and the page is exactly what it was. */
var _trkP = null;   // V37.6 — the promise, not a flag: see loadBenchPerf
function loadTrackRecord(){
  if (_trkP) return _trkP;
  try {
    _trkP = fetch('live-history.json', { cache:'no-store' })
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(d){ window._trkData = d; return d; })
      .catch(function(){ return null; });
  } catch(e){ _trkP = Promise.resolve(null); }
  return _trkP;
}
// V40.1 — "30 Sept" for the pending row ("opened 30 Sept · no close yet")
function _trkDay(iso){
  var dt = new Date(String(iso) + 'T00:00:00');
  if (isNaN(dt.getTime())) return String(iso);
  return mfDate(dt, { day:'numeric', month:'short' });
}
function renderTrackRecord(){
  var card = document.getElementById('trk-card');
  if (!card) return;
  card.style.display = 'none';
  var d = window._trkData;
  if (!d || !d.cycles || !d.cycles.length) return;
  var key = _strategyPerfKey(currentStrategy || ''); if (!key) return;

  // Only cycles this strategy actually has a figure for. A null live_pct is the
  // coverage guard in live_perf.py firing (fewer than 80% of the book priced) and
  // it publishes null precisely so nothing downstream invents a number for it.
  var rows = d.cycles.map(function(c, ix){
    var s = (c.strategies || {})[key];
    if (!s || s.live_pct == null || !isFinite(s.live_pct)) return null;
    return { ix:ix, when:c.rebalance_date, through:c.data_through, sealed:!!c.sealed,
             // V40.1 — A8. An open cycle whose last measured close IS its baseline
             // has no completed session yet: 0.00 vs 0.00 is the absence of a
             // measurement, not a result, and it must not be judged or drawn as one.
             pending: !c.sealed && !!c.data_through && !!c.rebalance_date &&
                      String(c.data_through) <= String(c.rebalance_date),
             live:Number(s.live_pct),
             bench:(s.bench_pct != null && isFinite(s.bench_pct)) ? Number(s.bench_pct) : null,
             benchName:s.bench_name || '' };
  }).filter(Boolean);
  if (!rows.length) return;

  // ONE scale for every row, so a bar's length means the same thing down the
  // column. 1.0 floors it: a set of near-flat cycles would otherwise be magnified
  // into a dramatic-looking chart of nothing.
  var scale = 1.0;
  rows.forEach(function(r){
    scale = Math.max(scale, Math.abs(r.live), r.bench == null ? 0 : Math.abs(r.bench));
  });

  // V40.1 — A8. Only FINISHED cycles are judged. The sample read "Ahead of the
  // index in 1 of 2" because the cycle that opened that evening (0.00 vs 0.00,
  // no close yet) counted as a cycle that was not ahead.
  var ahead = 0, judged = 0, sealed = 0;
  rows.forEach(function(r){
    if (r.sealed) sealed++;
    if (r.bench == null || !r.sealed) return;
    judged++; if (r.live > r.bench) ahead++;
  });

  var fmtPct = function(v){ return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(2) + '%'; };
  /* V37.3 — "Aug 26" is a MONTH-YEAR on a page that writes day-month everywhere
     else ("31 Aug", "29 Sept 2026", "vs the set you last opened on 11 Aug 2026"),
     so the one cell that meant August 2026 read as the 26th of August.
     The elided form fixes it for the width of one glyph. A four-digit year was
     measured first and rejected: "Sept 2026" plus the inline `live` marker needs
     92px against the 76 this column has, and taking 16px off a 90px axis at 320
     is a worse trade than the ambiguity. An apostrophe before the digits can
     only be a year. Bound with a non-breaking space explicitly — _mfBindDate's
     letter-to-digit rule cannot see across the apostrophe. */
  /* V40.1 — A8. Rows are labelled by the month they MEASURED, not the month the
     book was published: the cycle rebalanced on 31 Aug is the market from 1 Sept
     to 30 Sept, and calling it "Aug ’26" sent a reader checking it against what
     they knew of August. Month-end rebalances make that the next day's month. */
  var mon = function(iso){
    var dt = new Date(iso + 'T00:00:00');
    if (!isNaN(dt.getTime())) dt.setDate(dt.getDate() + 1);
    if (isNaN(dt.getTime())) return iso;
    return mfDate(dt, { month:'short', year:'2-digit' })
             .replace(/[\s\u00a0](\d{2})$/, '\u00a0\u2019$1');
  };

  var box = document.getElementById('trk-rows');
  if (box){
    box.innerHTML = rows.map(function(r){
      var cls  = r.live > 0.05 ? 'up' : (r.live < -0.05 ? 'down' : 'flat');
      var half = Math.min(50, Math.abs(r.live) / scale * 50);
      var left = r.live >= 0 ? 50 : (50 - half);
      var tick = r.bench == null ? '' :
        '<i class="trk-tick" style="left:' + (50 + Math.max(-50, Math.min(50, r.bench / scale * 50))).toFixed(2) + '%"></i>';
      /* V36.3 — the gap, in the eye as well as in the aria-label.
         The tick already puts the benchmark on the axis and the legend names
         it, but its VALUE was spoken to a screen reader ("against −1.20% for
         Nifty LargeMidcap 250") and shown to nobody: a sighted member read
         "−2.36%" beside an unlabelled mark and had to measure the tick by eye
         to learn which side of the index they finished. The `Ahead of the index
         in X of Y` badge cannot cover it either — it is gated at judged >= 2,
         so on the first cycles, when the question is asked hardest, nothing on
         screen answered it.
         Wording, sign convention and inks are lifted verbatim from .lvm-gap in
         mfc-live.js, which prints the same verdict for the same pair on the
         public strategy pages — one idiom, two surfaces, so a member cannot
         meet two phrasings of one fact. `gap >= 0` is ahead, matching it
         exactly; the colour follows the GAP, never the row's own return, so a
         losing cycle that still beat its index reads green on that line. */
      if (r.pending){
        return '<div class="trk-row is-pending">' +
          '<span class="trk-when">' + mon(r.when) + '<i>live</i></span>' +
          '<span class="trk-pend">opened ' + escapeHtml(_trkDay(r.when)) + ' \u00b7 no close yet</span>' +
        '</div>';
      }
      var gapEl = '';
      if (r.bench != null){
        var g = r.live - r.bench, ah = g >= 0, lvl = Math.abs(g) < 0.005;
        gapEl = '<i class="trk-gap' + (ah ? '' : ' behind') + '">' +
                (lvl ? 'level with the index'
                     : (ah ? '+' : '\u2212') + Math.abs(g).toFixed(2) + '\u00a0pts ' + (ah ? 'ahead' : 'behind')) + '</i>';
      }
      var aria = mon(r.when) + ' cycle: ' + fmtPct(r.live) +
        (r.bench == null ? '' : ', against ' + fmtPct(r.bench) + ' for ' + r.benchName) +
        (r.sealed ? '' : ' — cycle still in progress, to the ' + _trkDay(r.through) + ' close');
      return '<div class="trk-row">' +
        '<span class="trk-when">' + mon(r.when) + (r.sealed ? '' : '<i>live</i><i class="trk-to">to ' + escapeHtml(_trkDay(r.through)) + '</i>') + '</span>' +
        '<span class="trk-axis" role="img" aria-label="' + escapeHtml(aria) + '">' +
          '<i class="trk-bar ' + (cls === 'flat' ? 'up' : cls) + '" data-left="' + left.toFixed(2) +
            '" data-w="' + half.toFixed(2) + '" style="left:50%"></i>' + tick +
        '</span>' +
        '<span class="trk-val ' + cls + '">' + fmtPct(r.live) + gapEl + '</span>' +
      '</div>';
    }).join('') +
    // V37.6 — the swatch was always the gain gradient, so a book whose only row
    // is a red loss bar was keyed by a green swatch that matched nothing drawn.
    '<div class="trk-key"><span><i class="' + (function(){
      var anyUp = rows.some(function(r){ return r.live >= 0; }), anyDn = rows.some(function(r){ return r.live < 0; });
      return anyUp && anyDn ? 'is-split' : (anyDn ? 'is-down' : '');
    })() + '"></i>Your strategy</span>' +
      (rows[0].benchName ? '<span><i class="is-tick"></i>' + escapeHtml(rows[0].benchName) + '</span>' : '') +
      // V35.7 — name the scale the bars are drawn against. `scale` is the widest
      // absolute move on the chart (floored at 1.0), and a bar reaching the edge
      // of its row IS that value, so this is the one number that makes a bar
      // length readable rather than merely comparable to its neighbours.
      '<span class="trk-scale">Row edge = &plusmn;' + scale.toFixed(2) + '%</span>' +
    '</div>';
    // Grow from the centre line — the site's bar idiom. Painting the final
    // geometry immediately leaves a dead transition (V23.5).
    setTimeout(function(){
      box.querySelectorAll('.trk-bar').forEach(function(b){
        b.style.left  = b.getAttribute('data-left') + '%';
        b.style.width = b.getAttribute('data-w') + '%';
      });
    }, 60);
  }

  var sub = document.getElementById('trk-sub');
  if (sub){
    sub.textContent = rows.length === 1
      ? 'The first cycle on record. This builds a row a month.'
      : rows.length + ' cycles on record' + (sealed < rows.length ? ', the newest still running' : '');
    /* V37.6 — what the rows add up to. Each cycle rebalances into the next book,
       so the cycles chain multiplicatively, and that is only true when they are
       CONSECUTIVE: a null month skipped by the coverage guard would compound
       across a gap and state a return for a period nobody measured. So it
       renders only when every row is the entry after the one before it, and the
       benchmark half only when every row carries one. */
    var chain = rows.length >= 2 && rows.every(function(r, i){ return !i || r.ix === rows[i - 1].ix + 1; });
    if (chain){
      var cm = 1, cb = 1, hasB = true;
      rows.forEach(function(r){
        cm *= 1 + r.live / 100;
        if (r.bench == null) hasB = false; else cb *= 1 + r.bench / 100;
      });
      sub.textContent += '\u00a0· compounded ' + fmtPct((cm - 1) * 100) +
        (hasB ? ' against ' + fmtPct((cb - 1) * 100) + ' for ' + (rows[rows.length - 1].benchName || 'the index') : '');
    }
  }
  var badge = document.getElementById('trk-badge');
  if (badge){
    if (judged >= 2){ badge.textContent = 'Ahead of the index in ' + ahead + ' of ' + judged; badge.style.display = ''; }
    else { badge.style.display = 'none'; }
  }
  var foot = document.getElementById('trk-foot');
  if (foot){
    var last = rows[rows.length - 1];
    foot.innerHTML = 'Each row is the weight-weighted movement of the model portfolio over that cycle, ' +
      'measured from the published prices against ' + escapeHtml(last.benchName || 'the benchmark') +
      ' over the same window. The newest row is still moving; earlier rows are final. ' +
      'Model-portfolio figures before costs and tax, not audited client returns — ' +
      '<a class="trk-foot-lnk" href="disclosures.html#backtest-methodology" target="_blank" rel="noopener">how these are measured &rarr;</a>';
  }
  card.style.display = '';
}

/* ── V35.3 · THE PAGE ALREADY KNEW A NEWER BOOK EXISTED ──────────────────────
   A monthly subscriber is pinned to the run captured at signup, so someone who
   joined mid-August is still served the August book after September publishes.
   That is correct by design and nothing on the page said it. Worse, the cycle
   rail derives "New picks" from the CALENDAR — nextRebalanceDate() is simply the
   1st of next month — so on 2 September it told that member their next picks
   arrive 1 October, when a fresh set had existed since the previous day and
   renewing would hand it to them immediately.
   The fact was already in the page: live-perf.json carries `rebalance_date`, the
   latest published rebalance, and renderBenchCompare fetches it and compares it
   against the member's own run on every load — using the answer only to HIDE the
   benchmark row. Hiding that row is right, the two windows genuinely differ;
   discarding the knowledge was the miss.
   Gated on the identical comparison, so the notice and the hidden row can never
   disagree. It says a newer set exists and never a word about what is in it. */
function renderNewerSetNotice(){
  var el = document.getElementById('cyc-newer');
  if (!el) return;
  el.hidden = true; el.innerHTML = '';
  var d = _benchPerf; if (!d || !d.rebalance_date) return;
  /* THE GUARD THAT MATTERS. parseRebalanceDate falls back to subscribed_at when
     the run_id is missing or is a `default_run_*` placeholder — and a signup date
     is almost never equal to a rebalance date, so comparing against the fallback
     would tell nearly every such member they were behind. Only a date read from a
     real run_id is evidence about WHICH BOOK they hold. renderBenchCompare shares
     the same _rebalDate but errs safe in the other direction: a wrong date there
     hides a row, which costs nothing. */
  var sub0 = window._currentSub || {};
  // V39.1 — a 3/6/12-month member is served the latest run by the backend, so a
  // newer set cannot exist for them; only a pinned (1-month) plan can be behind.
  if (!_subIsPinned(sub0)) return;
  if (!/^\d{8}/.test(String(sub0.run_id || ''))) return;
  var mine = _isoDay(window._rebalDate);
  if (!mine || mine === d.rebalance_date) return;
  // Only ever forward: a member whose own run is NEWER than the published file
  // (the file lags a publish) must not be told they are behind.
  var latest = new Date(d.rebalance_date + 'T00:00:00');
  if (isNaN(latest.getTime()) || !(latest > window._rebalDate)) return;

  var sub = window._currentSub || {};
  var when = mfDate(latest, { day:'numeric', month:'short' });
  el.innerHTML = '<span><b>A newer set published on ' + when + '.</b> ' +
    'You are holding the previous cycle — the picks below are the ones your subscription covers.</span>' +
    (_subIsFree(sub) ? '<a class="cn-cta" href="signup.html?strategy=multiasset">Re-register free (₹0) to switch to it &rarr;</a>' :
    '<a class="cn-cta" target="_blank" rel="noopener" href="https://wa.me/917601032082?text=' +
    encodeURIComponent('Hi MindForge Capital — I would like to move to the latest set of picks. Strategy: ' +
      (sub.strategy || '') + '. Email: ' + (sub.email || '') + '.') +
    '">Renew to switch to it &rarr;</a>');
  el.hidden = false;
}

/* V39.3 — A2.4 · ONE MOMENT ON BOTH SIDES OF THE PILL.
   This used to subtract live-perf.json's benchmark (measured by the last data
   refresh — on 25 Sep 2026, the 09:12 opening print) from THIS page's live
   headline, so "+2.61 pts ahead" compared two different moments. live_perf.py
   now publishes each benchmark leg's baseline level (bench_legs), so the index
   is priced here, through the same prices endpoint and within the same minutes
   as the member's holdings. If any leg cannot be priced, the pill shows the
   published PAIR instead — both sides from the same close, with that close's
   date — and it never subtracts across two timestamps. */
var _benchLiveP = null, _benchLiveAt = 0, _benchLiveKey = '';
function _benchLive(key, s){
  var legs = (s && Array.isArray(s.bench_legs)) ? s.bench_legs : [];
  if (!legs.length) return Promise.resolve(null);
  if (_benchLiveP && _benchLiveKey === key && (Date.now() - _benchLiveAt) < _pxMaxAge()) return _benchLiveP;
  _benchLiveKey = key; _benchLiveAt = Date.now();
  _benchLiveP = _fetchPricesBatch(legs.map(function(l){ return l.t; })).then(function(px){
    if (!px) return null;
    window._benchPx = { key: key, px: px };   // V42.5 · M12 — the legs' previous closes, for mfc-insight.js's day card (no second request)
    var r = 0;
    for (var i = 0; i < legs.length; i++){
      var l = legs[i], q = px[l.t], base = Number(l.base), w = Number(l.w);
      if (!q || !(q.price > 0) || !(base > 0) || !isFinite(w)) return null;
      r += w * (q.price / base - 1);
    }
    return r * 100;
  }).catch(function(){ return null; });
  return _benchLiveP;
}
function _paintBenchPill(el, s, model, bench, asOfIso){
  var gap = model - bench;
  var state = gap > 0.05 ? 'ahead' : (gap < -0.05 ? 'behind' : 'level');
  // the PILL is a label ("+0.35 pts ahead"); the aria sentence below needs the
  // preposition ("ahead OF Nifty…"). Reusing one string for both left a
  // dangling "of" on screen.
  var pillWord  = state === 'level' ? 'level' : state;
  var ariaWord  = state === 'ahead' ? 'ahead of' : (state === 'behind' ? 'behind' : 'level with');
  // a difference of two percentages is measured in POINTS, not per cent
  var gapTxt = (gap > 0 ? '+' : gap < 0 ? '−' : '±') + Math.abs(gap).toFixed(2) + ' pts';
  var fmt = function(v){ return (v > 0 ? '+' : v < 0 ? '−' : '+') + Math.abs(v).toFixed(2) + '%'; };
  var benchTxt = fmt(bench);
  var benchCls = bench > 0.05 ? 'up' : (bench < -0.05 ? 'down' : '');
  var bname = s.bench_name || 'Benchmark';
  var when = '';
  if (asOfIso){ var dt = new Date(asOfIso + 'T00:00:00'); if (!isNaN(dt)) when = mfDate(dt, {day:'numeric', month:'short'}); }
  var lbl = asOfIso
    ? 'To the ' + escapeHtml(when) + ' close: this book ' + fmt(model) + ' · ' + escapeHtml(bname)
    : escapeHtml(bname) + ' over the same cycle';
  el.innerHTML =
    '<span class="pcb-lbl">' + lbl + '</span> <b class="pcb-bench ' + benchCls + '">' + benchTxt + '</b>' +
    '<span class="pcb-gap ' + state + '">' + gapTxt + ' ' + pillWord + '</span>';
  el.style.display = 'flex';
  el.setAttribute('aria-label', asOfIso
    ? 'To the ' + when + ' close this book moved ' + fmt(model) + ' and ' + bname + ' ' + benchTxt + ': ' + gapTxt + ' ' + ariaWord + ' it.'
    : 'Your portfolio is ' + gapTxt + ' ' + ariaWord + ' ' + bname + ', which moved ' + benchTxt + ' over the same cycle.');
}
function renderBenchCompare(port){
  var el = document.getElementById('pc-bench');
  if (!el) return;
  var hide = function(){ el.style.display = 'none'; el.innerHTML = ''; };
  var d = _benchPerf; if (!d || !d.strategies) return hide();
  var key = _strategyPerfKey(currentStrategy || ''); if (!key) return hide();
  var s = d.strategies[key];
  if (!s || s.bench_pct == null || !isFinite(s.bench_pct)) return hide();
  // guard (1): same window on both sides, or nothing
  if (!d.rebalance_date || _isoDay(window._rebalDate) !== d.rebalance_date) return hide();
  // A capital change re-runs the headline, and with it this; the newest call owns
  // the element, so a slow first fetch can never paint over a later answer.
  var tok = (el._bcTok = (el._bcTok || 0) + 1);
  _benchLive(key, s).then(function(live){
    if (el._bcTok !== tok) return;
    if (live != null && isFinite(live) && isFinite(port)) return _paintBenchPill(el, s, port, live, null);
    if (s.live_pct != null && isFinite(s.live_pct)) return _paintBenchPill(el, s, Number(s.live_pct), Number(s.bench_pct), d.data_through);
    hide();
  });
}

// V15.3: data-freshness chip — reads the auto-refresh timestamp from fii-dii.json
// (smaller payload than stocks.json; updated by the same launchd job). Fails silently
// if the file isn't reachable.
(function(){
  var pill=document.getElementById('pill-fresh'),when=document.getElementById('fresh-when');
  if(!pill||!when)return;
  fetch('/fii-dii/fii-dii.json',{cache:'no-cache'}).then(function(r){return r.ok?r.json():null;}).then(function(d){
    if(!d||!d.generated_at)return;
    // generated_at is written in IST without a TZ designator; pin it to +05:30
    // so the "Xm ago" is correct for viewers in any timezone (no-op for IST).
    var ga=String(d.generated_at); if(!/(?:[zZ]|[+-]\d\d:?\d\d)$/.test(ga)) ga+='+05:30';
    var t=new Date(ga); if(isNaN(t))return;
    var mins=Math.max(0,Math.round((Date.now()-t.getTime())/60000));
    var label;
    if(mins<60) label=mins+'m ago';
    else if(mins<60*24){ var h=Math.round(mins/60); label=h+'h ago'; }
    else label=mfDate(t, {day:'numeric',month:'short'});
    when.textContent='refreshed '+label;
    pill.style.display='';
  }).catch(function(){});
})();
/* V44.3 — WHEN TO DRAW. This file runs a third of the way down dashboard.html, with 50-odd style
   blocks and two dozen scripts still to come. A member's first draw used to wait two seconds for
   the backend, by which time all of that had long arrived. The reads now start in <head>, so the
   answer can land first, and a saved copy is there at once: both would draw into a half-parsed
   page, before later scripts have hooked in, in a state this page has never run a member's book
   in. So a member's draw waits for the parser (on slow 4G about 0.3 s; on anything faster,
   nothing). The sample dashboard stays as it was, drawing at once, because it has no backend to
   wait for and a first-time visitor is who it is for; the styles it needs at that moment are
   copied into <head> (mf-v443-first-fold). With no session there is nothing to draw. */
if (isDemo || !token || document.readyState !== 'loading') init();
else document.addEventListener('DOMContentLoaded', init, { once: true });
