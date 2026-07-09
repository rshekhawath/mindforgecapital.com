/* ============================================================================
   MindForge Capital — Member App · shell, router & views
   ----------------------------------------------------------------------------
   A tiny dependency-free SPA: hash router + 5 screens (Login · Home · Holdings ·
   Scanner · Account). Talks to the existing Apps Script backend via MFCApi, keeps
   the signed-in session in MFCStore, and links brokers via MFCBrokers. Designed
   to run as an installed PWA or inside a Capacitor iOS/Android shell.
   ========================================================================== */
(function () {
  "use strict";
  var C = window.MFC_CONFIG;
  var appEl = document.getElementById('app');
  var currentTab = '';
  var currentToken = null;            // the subscription whose holdings we're viewing
  var holdingsCache = {};             // token -> {subscription, stocks} (for offline/back)
  var capital = 0;                    // allocation-calculator capital
  var capitalCurr = '';               // currency capital was set for — reset when strategy currency changes
  // V20.3 — native page transitions. Set true at the top of a genuine route change
  // (router()) and consumed once by the next render() so the incoming screen plays a
  // subtle scale+fade "push". In-place re-renders (the Holdings capital calculator,
  // which re-renders WITHOUT a hash change) leave it false, so recalculating a
  // position size never replays the whole-screen transition. Reduced-motion-safe
  // (the .route-in animation is defined only under prefers-reduced-motion:no-preference).
  var pendingNav = false;

  // WhatsApp support mark (V20.0) — the REAL, official WhatsApp glyph (the filled
  // phone-in-speech-bubble, verbatim brand vector), white on the WhatsApp-green
  // tile. Inline SVG so the strict CSP (img-src 'self' data:) is satisfied.
  var WA_LOGO = '<svg width="23" height="23" viewBox="0 0 24 24" fill="#fff" aria-hidden="true">'+
    '<path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/></svg>';

  // ── helpers ────────────────────────────────────────────────────────────────
  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function isNS(s){return !(s.yahoo_ticker && !/\.NS$/i.test(s.yahoo_ticker));}
  function curOf(s){return isNS(s)?'₹':'$';}
  function fmtINR(n){return (Number(n)||0).toLocaleString('en-IN',{maximumFractionDigits:0});}
  function fmtMoney(curr,n){return curr==='₹'?('₹'+fmtINR(n)):('$'+(Number(n)||0).toLocaleString('en-US',{maximumFractionDigits:0}));}
  var STRAT_NAMES={largemidcap:'LargeMidcap 250',smallmicro:'SmallMicro 500',multicap:'MultiCap',multiasset:'MultiAsset',sp500:'S&P 500',allaccess:'All-Access'};
  // Per-strategy colour identity (V13.2) — a signature gradient per strategy so each
  // subscription is recognisable at a glance across Home + Account (vs. one flat blue).
  var STRAT_ACCENT={largemidcap:'linear-gradient(135deg,#1a50d8,#3b82f6)',smallmicro:'linear-gradient(135deg,#0891b2,#2dd4bf)',multicap:'linear-gradient(135deg,#7c3aed,#a855f7)',multiasset:'linear-gradient(135deg,#d97706,#f59e0b)',sp500:'linear-gradient(135deg,#059669,#10b981)',allaccess:'linear-gradient(135deg,#0c1831,#1e3a5f)'};
  function strategyKey(s){var key=String(s||'').toLowerCase().replace(/[^a-z0-9]/g,'');for(var k in STRAT_NAMES){if(key.indexOf(k)!==-1)return k;}return '';}
  function strategyLabel(s){
    s=String(s||'');
    var k=strategyKey(s); if(k)return STRAT_NAMES[k];           // "MindForge LargeMidcap 250" → "LargeMidcap 250"
    return s.replace(/_/g,' ').replace(/\b\w/g,function(c){return c.toUpperCase();}).replace(/Mindforge/i,'MindForge');
  }
  function strategyAccent(s){var k=strategyKey(s);return (k&&STRAT_ACCENT[k])||'var(--grad)';}
  // Member initials for the Account avatar (e.g. "Riya Sharma" → "RS").
  function initials(name){var p=String(name||'').trim().split(/\s+/).filter(Boolean);if(!p.length)return 'MF';return ((p[0].charAt(0)||'')+(p.length>1?p[p.length-1].charAt(0):'')).toUpperCase();}
  function fmtDate(d){if(!d)return '—';var dt=new Date(d);if(isNaN(dt))return esc(d);return dt.toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'});}
  function daysLeft(d){if(!d)return null;var dt=new Date(d);if(isNaN(dt))return null;return Math.max(0,Math.ceil((dt-new Date())/86400000));}

  // V20.1 — a time-aware, "living" greeting for the Home hero. The salutation +
  // an inline sun/moon glyph + a colour-of-day accent shift with the member's real
  // local hour (morning → gold sunrise, afternoon → blue sun, evening/night →
  // indigo moon), and the eyebrow carries today's date — so the app's landing
  // screen feels personal and current on every open. Pure client clock; the CSS
  // glyph glow freezes for reduced-motion.
  function greeting(){
    var h=new Date().getHours();
    if(h>=5&&h<12)return {t:'Good morning',k:'morn',
      ic:'<circle cx="12" cy="13.5" r="3.6"/><path d="M12 4v2.4M4.6 13.5H2.8M21.2 13.5h-1.8M5.9 7.4l1.3 1.3M18.1 7.4l-1.3 1.3M2.5 19.2h19"/>'};
    if(h>=12&&h<17)return {t:'Good afternoon',k:'noon',
      ic:'<circle cx="12" cy="12" r="4.4"/><path d="M12 2.4v2.3M12 19.3v2.3M2.4 12h2.3M19.3 12h2.3M5.1 5.1l1.6 1.6M17.3 17.3l1.6 1.6M18.9 5.1l-1.6 1.6M6.7 17.3l-1.6 1.6"/>'};
    return {t:'Good evening',k:'eve',
      ic:'<path d="M21 12.8A8.5 8.5 0 1111.2 3a6.6 6.6 0 009.8 9.8z"/>'};
  }
  function todDate(){try{return new Date().toLocaleDateString('en-IN',{weekday:'long',day:'numeric',month:'short'});}catch(e){return 'Member dashboard';}}

  var toastTimer;
  function toast(msg,isErr){
    var t=document.getElementById('toast');
    // V18.2 — a ✓ / ! glyph so toasts read at a glance; msg appended as a TEXT
    // node (it can carry user/API strings, so it never goes through innerHTML).
    t.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+
      (isErr?'<circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16.6h.01"/>':'<path d="M20 6L9 17l-5-5"/>')+'</svg>';
    t.appendChild(document.createTextNode(msg));
    t.className='toast show'+(isErr?' err':'');
    clearTimeout(toastTimer);toastTimer=setTimeout(function(){t.className='toast';},2600);
  }

  // Deterministic sector colours — same approach the website uses (V11.3), so the
  // app's holding pills match the look members already know from the dashboard.
  var SECTOR_COLORS=['#1a50d8','#0891b2','#2dd4bf','#10b981','#84cc16','#eab308','#d97706','#ef4444','#ec4899','#8b5cf6','#6366f1','#0ea5e9'];
  function sectorColors(stocks){
    var agg={};(stocks||[]).forEach(function(s){var k=(s.industry||'Unknown').trim()||'Unknown';agg[k]=(agg[k]||0)+(Number(s.weight_pct)||0);});
    var map={};Object.keys(agg).sort(function(a,b){return agg[b]-agg[a];}).forEach(function(n,i){map[n]=SECTOR_COLORS[i%SECTOR_COLORS.length];});
    return map;
  }
  function prefersReduced(){return !!(window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches);}
  // Roll a number from 0 → its value (same easing as the website's count-up).
  function countUp(el){
    var to=parseFloat(el.getAttribute('data-count')); if(isNaN(to))return;
    var suf=el.getAttribute('data-suffix')||'';
    if(prefersReduced()||!('requestAnimationFrame' in window)){el.textContent=to+suf;return;}
    var dur=850,start=null,done=false; el.textContent='0'+suf;
    requestAnimationFrame(function step(ts){
      if(start===null)start=ts;
      var p=Math.min(1,(ts-start)/dur),e=1-Math.pow(1-p,3);
      el.textContent=Math.round(to*e)+suf;
      if(p<1)requestAnimationFrame(step);else{done=true;el.textContent=to+suf;}
    });
    // fallback: if rAF frames never flow (backgrounded/headless tab) pin the final
    // value so a stat can never stick mid-roll (same guard the website's count-up uses)
    setTimeout(function(){if(!done)el.textContent=to+suf;},dur+250);
  }

  // Branded empty/error illustration (V13.5) — a soft gradient medallion + an
  // inline-SVG glyph, replacing the old placeholder emoji so empty states match
  // the app's all-SVG premium language. `warn` switches to the amber error look.
  var EMPTY_ILL={
    inbox:'<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><path d="M3.5 13H8l1.6 2.5h4.8L16 13h4.5"/>',
    chart:'<path d="M4 5v14h16"/><path d="M8 15l3.5-4 3 2.5L20 8"/>',
    doc:'<path d="M7 3h7l4 4v14H7z"/><path d="M14 3v4h4"/><path d="M10 13h5M10 16.5h5"/>',
    alert:'<path d="M12 4.5l8.5 15h-17z"/><path d="M12 10v4.2"/><path d="M12 17.4h.01"/>'
  };
  function emptyIll(kind,warn){
    return '<div class="empty-ill'+(warn?' warn':'')+'" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">'+(EMPTY_ILL[kind]||EMPTY_ILL.doc)+'</svg></div>';
  }

  // Sector-allocation donut + legend — the website dashboard's signature data-viz,
  // ported to mobile. Slices draw in (staggered) when the .alloc-card gets .fx.
  function sectorAllocCard(stocks,secCol){
    var agg={};(stocks||[]).forEach(function(s){var k=(s.industry||'Unknown').trim()||'Unknown';agg[k]=(agg[k]||0)+(Number(s.weight_pct)||0);});
    var rows=Object.keys(agg).map(function(k){return {name:k,w:agg[k]};}).sort(function(a,b){return b.w-a.w;});
    if(rows.length<2)return '';
    var total=rows.reduce(function(a,r){return a+r.w;},0)||1, C=2*Math.PI*40, cum=0, slices='';
    rows.forEach(function(r,i){
      var len=(r.w/total)*C, start=-90+(cum/total)*360; cum+=r.w;
      slices+='<circle class="dslice" cx="50" cy="50" r="40" fill="none" stroke="'+(secCol[r.name]||'#cbd5e1')+'" stroke-width="13" '+
        'data-sec="'+i+'" data-pc="'+((r.w/total)*100).toFixed(1)+'" data-nm="'+esc(r.name)+'" '+
        'stroke-dasharray="'+len.toFixed(2)+' '+(C-len).toFixed(2)+'" style="--len:'+len.toFixed(2)+';transform:rotate('+start.toFixed(2)+'deg);animation-delay:'+(i*80)+'ms"/>';
    });
    var legend=rows.slice(0,6).map(function(r,i){
      return '<div class="leg-row" data-sec="'+i+'" role="button" tabindex="0" aria-label="'+esc(r.name)+' '+((r.w/total)*100).toFixed(1)+' percent" style="animation-delay:'+(160+i*60)+'ms"><span class="leg-sw" style="background:'+(secCol[r.name]||'#cbd5e1')+'"></span>'+
        '<span class="leg-nm">'+esc(r.name)+'</span><span class="leg-pc">'+((r.w/total)*100).toFixed(1)+'%</span></div>';
    }).join('');
    if(rows.length>6)legend+='<div class="leg-row" style="animation-delay:'+(160+6*60)+'ms"><span class="leg-sw" style="background:#cbd5e1"></span><span class="leg-nm">+'+(rows.length-6)+' more</span></div>';
    return '<div class="card alloc-card" style="margin-top:14px">'+
      '<div class="alloc-head"><span class="alloc-ttl">Sector allocation</span><span class="alloc-meta">'+rows.length+' sectors · equal-weighted</span></div>'+
      '<div class="alloc-body">'+
        '<div class="donut-wrap"><svg class="donut" viewBox="0 0 100 100" aria-hidden="true"><circle class="dbg" cx="50" cy="50" r="40" fill="none" stroke-width="13"/>'+slices+'</svg>'+
          '<div class="donut-c"><span class="donut-n ink-grad" data-count="'+rows.length+'">'+rows.length+'</span><span class="donut-l">sectors</span></div></div>'+
        '<div class="legend">'+legend+'</div>'+
      '</div></div>';
  }

  // ── tab bar ─────────────────────────────────────────────────────────────────
  var TABS=[
    {id:'home',label:'Home',hash:'#/home',icon:'M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10'},
    {id:'holdings',label:'Holdings',hash:'#/holdings',icon:'M4 5h16v4H4zM4 11h10v8H4zM16 11h4v8h-4z'},
    {id:'scanner',label:'Scanner',hash:'#/scanner',icon:'M11 4a7 7 0 105.2 11.7L21 21M11 4a7 7 0 010 14'},
    {id:'account',label:'Account',hash:'#/account',icon:'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21a8 8 0 0116 0'}
  ];
  function tabbarHTML(active){
    return '<nav class="tabbar" id="tabbar">'+TABS.map(function(t){
      return '<button class="tab'+(t.id===active?' active':'')+'" data-hash="'+t.hash+'">'+
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="'+t.icon+'"/></svg>'+
        '<span>'+t.label+'</span></button>';
    }).join('')+'</nav>';
  }

  function appbarHTML(opts){
    opts=opts||{};
    return '<header class="appbar">'+
      (opts.back?'<button class="ab-btn" data-back="1" aria-label="Back"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg></button>':
        '<div class="logo"><img src="assets/favicon-192.png" alt=""><span>MindForge</span></div>')+
      '<div class="spacer"></div>'+
      (opts.right||'')+
    '</header>';
  }

  // ── render plumbing ──────────────────────────────────────────────────────────
  function render(html,activeTab,wire){
    appEl.innerHTML=html+(activeTab?tabbarHTML(activeTab):'');
    currentTab=activeTab||'';
    // V20.3 — play the whole-screen "push" once per genuine navigation (see pendingNav).
    if(pendingNav){pendingNav=false;var _scr=appEl.querySelector('.screen');if(_scr)_scr.classList.add('route-in');}
    // wire tab + back + delegated nav
    appEl.querySelectorAll('[data-hash]').forEach(function(b){b.addEventListener('click',function(){location.hash=b.getAttribute('data-hash');});});
    appEl.querySelectorAll('[data-back]').forEach(function(b){b.addEventListener('click',function(){history.length>1?history.back():(location.hash='#/home');});});
    if(wire)wire();
    window.scrollTo(0,0);
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  LOGIN  (email → OTP → verify)
  // ════════════════════════════════════════════════════════════════════════════
  var loginEmail='', resendAt=0;
  function viewLogin(){
    render(
      '<main class="screen screen--center rise">'+
        '<div style="text-align:center;margin-bottom:26px">'+
          '<img src="assets/favicon-192.png" alt="" class="login-logo" style="width:60px;height:60px;border-radius:17px">'+
          '<h1 class="h-title" style="margin-top:16px">Welcome to <span class="gradtext">MindForge</span></h1>'+
          '<p class="h-sub" style="margin:0 auto;max-width:300px">Sign in to view your strategy picks and place them with your broker in one tap.</p>'+
        '</div>'+
        '<div class="card card-grad" id="loginCard"></div>'+
        '<div class="trust-strip rise">'+
          '<span class="trust"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 3v6c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V6z"/></svg>Bank-grade security</span>'+
          '<span class="trust"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h7l-1 8 10-12h-7z"/></svg>Passwordless</span>'+
          '<span class="trust"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg>One-tap orders</span>'+
        '</div>'+
        '<p class="hint" style="text-align:center;margin-top:18px">Not a member yet? <a href="'+C.SIGNUP_URL+'" target="_blank" rel="noopener">Get started →</a></p>'+
      '</main>','',function(){renderEmailStep();});
  }
  function renderEmailStep(){
    var card=document.getElementById('loginCard');
    card.innerHTML=
      '<div class="field"><label for="em">Email address</label>'+
      '<input class="input" id="em" type="email" inputmode="email" autocomplete="email" placeholder="you@example.com" value="'+esc(loginEmail)+'"></div>'+
      '<button class="btn btn-primary" id="sendBtn">Email me a sign-in code</button>'+
      '<div class="err" id="loginErr"></div>'+
      '<p class="hint">We’ll send a 6-digit code to your registered email. No password needed.</p>';
    var em=document.getElementById('em');
    em.focus();
    document.getElementById('sendBtn').addEventListener('click',function(){doRequestOtp(em.value);});
    em.addEventListener('keydown',function(e){if(e.key==='Enter')doRequestOtp(em.value);});
  }
  function doRequestOtp(email){
    email=(email||'').trim();
    var errEl=document.getElementById('loginErr');
    if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)){errEl.textContent='Please enter a valid email address.';return;}
    loginEmail=email;errEl.textContent='';
    var btn=document.getElementById('sendBtn');btn.disabled=true;btn.innerHTML='<span class="spinner"></span> Sending…';
    MFCApi.requestOtp(email).then(function(){resendAt=Date.now()+C.OTP_RESEND_COOLDOWN_S*1000;renderOtpStep();})
      .catch(function(err){btn.disabled=false;btn.textContent='Email me a sign-in code';errEl.textContent=err.message;});
  }
  function renderOtpStep(){
    var card=document.getElementById('loginCard');
    card.innerHTML=
      '<div style="margin-bottom:6px"><button class="btn-sm btn-ghost" id="editEmail" style="border:none;background:none;padding:0;color:var(--ink3);font-weight:700">← '+esc(loginEmail)+'</button></div>'+
      '<label style="display:block;font-size:13px;font-weight:700;color:var(--ink2);margin:6px 0 9px">Enter the 6-digit code</label>'+
      '<div class="otp-inputs" id="otpRow">'+[0,1,2,3,4,5].map(function(i){return '<input class="input" inputmode="numeric" autocomplete="'+(i===0?'one-time-code':'off')+'" data-i="'+i+'">';}).join('')+'</div>'+
      '<div class="otp-prog" aria-hidden="true"><i id="otpProg"></i></div>'+
      '<button class="btn btn-primary" id="verifyBtn" style="margin-top:16px">Verify &amp; sign in</button>'+
      '<div class="err" id="loginErr"></div>'+
      '<p class="hint">Didn’t get it? <a href="#" id="resend">Resend code</a> · check spam.</p>';
    var inputs=Array.prototype.slice.call(card.querySelectorAll('#otpRow input'));
    // V18.2 — the micro progress track under the boxes fills as digits land
    function syncProg(){var pg=document.getElementById('otpProg');if(!pg)return;var n=inputs.filter(function(x){return x.value;}).length;pg.style.width=(n/6*100)+'%';}
    // One writer for a digit string starting at box `start` — handles typing
    // overflow, paste into any box, and iOS/Android one-time-code autofill
    // (which drops all 6 digits into the focused box as a single input event;
    // the old maxlength="1" truncated that to one digit and broke autofill).
    function fillFrom(digits,start){
      if(digits.length>=6)start=0;
      digits.split('').forEach(function(ch,k){var b=inputs[start+k];if(b){b.value=ch;b.classList.add('filled');}});
      inputs[Math.min(start+digits.length,5)].focus();
      syncProg();
      if(inputs.every(function(x){return x.value;}))doVerify(inputs);
    }
    inputs[0].focus();
    inputs.forEach(function(inp,i){
      inp.addEventListener('input',function(){
        var v=inp.value.replace(/\D/g,'');
        if(v.length>1){inp.value='';fillFrom(v.slice(0,6),i);return;}
        inp.value=v;
        inp.classList.toggle('filled',!!v);
        syncProg();
        if(v&&i<5)inputs[i+1].focus();
        if(inputs.every(function(x){return x.value;}))doVerify(inputs);
      });
      inp.addEventListener('keydown',function(e){if(e.key==='Backspace'&&!inp.value&&i>0)inputs[i-1].focus();if(e.key==='Enter')doVerify(inputs);});
      inp.addEventListener('paste',function(e){
        var d=(e.clipboardData||window.clipboardData).getData('text').replace(/\D/g,'').slice(0,6);
        if(d){e.preventDefault();fillFrom(d,i);}
      });
    });
    document.getElementById('verifyBtn').addEventListener('click',function(){doVerify(inputs);});
    document.getElementById('editEmail').addEventListener('click',renderEmailStep);
    document.getElementById('resend').addEventListener('click',function(e){
      e.preventDefault();
      if(Date.now()<resendAt){toast('Please wait a few seconds before resending');return;}
      doRequestOtp(loginEmail);
    });
  }
  function doVerify(inputs){
    var otp=inputs.map(function(x){return x.value;}).join('');
    var errEl=document.getElementById('loginErr');
    if(otp.length<6){errEl.textContent='Enter all 6 digits.';return;}
    var btn=document.getElementById('verifyBtn');btn.disabled=true;btn.innerHTML='<span class="spinner"></span> Verifying…';
    errEl.textContent='';
    MFCApi.verifyOtp(loginEmail,otp).then(function(data){
      var subs=data.subscriptions||[];
      // A verified email with ZERO subscriptions used to toast "Signed in" and
      // silently bounce back here (isSignedIn() needs ≥1 sub) — explain instead.
      if(!subs.length){
        btn.disabled=false;btn.innerHTML='Verify &amp; sign in';
        errEl.textContent='This email has no subscriptions on file. Use the email you subscribed with, or start a plan first.';
        return;
      }
      MFCStore.setSession(loginEmail,subs);
      var active=subs.filter(function(s){return String(s.status).toLowerCase()==='active';});
      currentToken=(active[0]||subs[0]||{}).token||null;
      toast('Signed in');
      location.hash='#/home';
    }).catch(function(err){
      btn.disabled=false;btn.innerHTML='Verify &amp; sign in';errEl.textContent=err.message;
      inputs.forEach(function(x){x.value='';x.classList.remove('filled');});inputs[0].focus();
      var pg=document.getElementById('otpProg');if(pg)pg.style.width='0';
    });
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  HOME  (My Subscriptions)
  // ════════════════════════════════════════════════════════════════════════════

  // V17.0 — "Your portfolio" overview: a signature card for the app's sparsest
  // screen. A count-up active-strategy stat, the nearest renewal, and a "strategy
  // mix" bar + legend in each strategy's signature accent (the same gradients on
  // the sub-card icons + Account swatches). Session-data only — no extra fetch.
  // Draws in; reduced-motion-safe (CSS freezes the entrance).
  function pfOverviewHTML(active){
    if(!active||!active.length)return '';
    var withDays=active.map(function(s){return {s:s,d:daysLeft(s.expires_at)};}).filter(function(x){return x.d!=null;});
    withDays.sort(function(a,b){return a.d-b.d;});
    var near=withDays[0];
    var segs=active.map(function(s,i){return '<i style="background:'+strategyAccent(s.strategy)+';animation-delay:'+(120+i*70)+'ms"></i>';}).join('');
    var legend=active.map(function(s,i){return '<span class="pf-leg" style="animation-delay:'+(220+i*70)+'ms"><span class="sw" style="background:'+strategyAccent(s.strategy)+'"></span>'+esc(strategyLabel(s.strategy))+'</span>';}).join('');
    var renew=near?('<div class="pf-renew"><div class="pf-renew-k">Next renewal</div>'+
      '<div class="pf-renew-v'+(near.d<=7?' soon':'')+'">'+near.d+' day'+(near.d===1?'':'s')+'</div>'+
      '<div class="pf-renew-s">'+esc(strategyLabel(near.s.strategy))+'</div></div>'):'';
    return '<div class="pf-overview card card-grad rise">'+
      '<div class="pf-top">'+
        '<div class="pf-stat"><div class="pf-n"><span data-count="'+active.length+'">'+active.length+'</span></div>'+
        '<div class="pf-k">Active '+(active.length===1?'strategy':'strategies')+'</div></div>'+
        renew+
      '</div>'+
      '<div class="pf-bar" aria-hidden="true">'+segs+'</div>'+
      '<div class="pf-legend">'+legend+'</div>'+
    '</div>';
  }

  function viewHome(){
    var sess=MFCStore.getSession()||{subscriptions:[]};
    var subs=sess.subscriptions||[];
    var active=subs.filter(function(s){return String(s.status).toLowerCase()==='active';});
    var first=(sess.name||'').split(' ')[0]||'there';
    var cards=subs.length?subs.map(function(s,i){
      var st=String(s.status).toLowerCase();
      var isActive=st==='active';
      var dl=daysLeft(s.expires_at);
      var badge=isActive?'<span class="badge badge-active"><span class="dot"></span>Active</span>':
        (st==='expired'?'<span class="badge badge-expired">Expired</span>':'<span class="badge badge-muted">'+esc(st)+'</span>');
      return '<div class="sub-card rise" style="animation-delay:'+(i*60)+'ms'+(isActive?';--sc-accent:'+strategyAccent(s.strategy):'')+'" '+(isActive?'data-token="'+esc(s.token)+'" data-accent="1"':'')+'>'+
        '<div class="sc-ico" style="background:'+strategyAccent(s.strategy)+(isActive?'':';filter:grayscale(.55);opacity:.7')+'"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M7 14l3-3 3 3 5-6"/></svg></div>'+
        '<div class="sc-body"><div class="sc-name">'+esc(strategyLabel(s.strategy))+'</div>'+
        '<div class="sc-meta">'+badge+(isActive&&dl!=null?' · renews in '+dl+' day'+(dl===1?'':'s'):'')+'</div></div>'+
        (isActive?'<div class="sc-chev"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg></div>'
          :(st==='expired'?'<a class="sc-renew" href="'+esc(C.WHATSAPP_URL+(C.WHATSAPP_URL.indexOf('?')<0?'?':'&')+'text='+encodeURIComponent('Hi, I’d like to renew my MindForge '+strategyLabel(s.strategy)+' subscription.'))+'" target="_blank" rel="noopener" aria-label="Renew '+esc(strategyLabel(s.strategy))+' on WhatsApp">Renew<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" style="margin-left:2px"><path d="M5 12h14M13 6l6 6-6 6"/></svg></a>':''))+
      '</div>';
    }).join(''):
      '<div class="empty">'+emptyIll('inbox')+'<h4>No subscriptions yet</h4><p>Subscribe to a strategy to see your monthly picks here.</p>'+
      '<a class="btn btn-primary" style="margin-top:14px" href="'+C.SIGNUP_URL+'" target="_blank" rel="noopener">Browse strategies →</a></div>';

    render(
      appbarHTML({right:'<button class="ab-btn" data-hash="#/account" aria-label="Account"><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0116 0"/></svg></button>'})+
      '<main class="screen">'+
        (function(){var g=greeting();return ''+
          '<div class="eyebrow eyebrow-tod tod-'+g.k+' rise"><span class="tod-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+g.ic+'</svg></span>'+esc(todDate())+'</div>'+
          '<h1 class="h-title rise">'+g.t+', <span class="gradtext">'+esc(first)+'</span>.</h1>';})()+
        '<p class="h-sub rise">'+(active.length?('You have '+active.length+' active '+(active.length===1?'strategy':'strategies')+'. Tap one to view this cycle’s picks.'):'Your subscriptions appear below.')+'</p>'+
        pfOverviewHTML(active)+
        '<div class="list-h"><span class="lt">Your subscriptions</span>'+(subs.length?'<span class="ls">'+subs.length+(subs.length===1?' plan':' plans')+'</span>':'')+'</div>'+
        cards+
      '</main>','home',function(){
        appEl.querySelectorAll('[data-count]').forEach(countUp);
        appEl.querySelectorAll('.sub-card[data-token]').forEach(function(c){
          c.addEventListener('click',function(){currentToken=c.getAttribute('data-token');location.hash='#/holdings/'+encodeURIComponent(currentToken);});
        });
      });
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  HOLDINGS  (the "dashboard" — picks for one subscription)
  // ════════════════════════════════════════════════════════════════════════════
  function viewHoldings(token){
    token=token||currentToken;
    var active=MFCStore.activeSubscriptions();
    if(!token){
      if(active.length){currentToken=active[0].token;token=currentToken;}
      else{
        render(appbarHTML({})+'<main class="screen"><div class="empty">'+emptyIll('chart')+'<h4>No active strategy</h4><p>Subscribe to a strategy to see its holdings.</p></div></main>','holdings');
        return;
      }
    }
    currentToken=token;
    // skeleton while loading
    render(appbarHTML({right:subSwitcher(active,token)})+
      '<main class="screen"><div class="skeleton" style="height:26px;width:55%;margin:6px 0 16px"></div>'+
      '<div class="tiles">'+[0,0,0,0].map(function(){return '<div class="skeleton" style="height:70px"></div>';}).join('')+'</div>'+
      '<div class="skeleton" style="height:96px;margin-top:14px"></div>'+
      [0,0,0].map(function(){return '<div class="skeleton" style="height:120px;margin-top:10px"></div>';}).join('')+
      '</main>','holdings',function(){wireSubSwitcher();});

    var cached=holdingsCache[token];
    var p=cached?Promise.resolve(cached):MFCApi.stocks(token).then(function(d){holdingsCache[token]={subscription:d.subscription,stocks:d.stocks};return holdingsCache[token];});
    p.then(function(d){renderHoldings(token,d.subscription,d.stocks,active);})
     .catch(function(err){
       render(appbarHTML({right:subSwitcher(active,token)})+'<main class="screen"><div class="empty">'+emptyIll('alert',true)+'<h4>Couldn’t load your picks</h4><p>'+esc(err.message)+'</p><button class="btn btn-ghost" id="retry" style="margin-top:14px;width:auto;padding:11px 20px">Try again</button></div></main>','holdings',function(){
         wireSubSwitcher();var r=document.getElementById('retry');if(r)r.addEventListener('click',function(){viewHoldings(token);});
       });
     });
  }
  function subSwitcher(active,token){
    if(!active||active.length<2)return '';
    return '<select class="ab-btn" id="subSwitch" aria-label="Switch strategy">'+
      active.map(function(s){return '<option value="'+esc(s.token)+'"'+(s.token===token?' selected':'')+'>'+esc(strategyLabel(s.strategy))+'</option>';}).join('')+'</select>';
  }
  function wireSubSwitcher(){var sw=document.getElementById('subSwitch');if(sw)sw.addEventListener('change',function(){currentToken=sw.value;location.hash='#/holdings/'+encodeURIComponent(sw.value);});}

  // Interactive sector donut (V13.4) — tap a legend row or a slice to spotlight
  // that sector: its slice lifts, the others dim, and the donut centre swaps to
  // show the sector's exact weight + name. Tap it again (or pick another) to
  // change / clear. Re-wired on every holdings render; keyboard-operable
  // (Enter/Space on a legend row); reduced-motion-safe (CSS freezes the motion).
  function wireDonut(){
    var card=appEl.querySelector('.alloc-card'); if(!card)return;
    var svg=card.querySelector('.donut'), center=card.querySelector('.donut-c');
    if(!svg||!center)return;
    var def=center.innerHTML, sel=null;
    function reset(){sel=null;svg.classList.remove('sel-active');
      card.querySelectorAll('.dslice.on,.leg-row.on').forEach(function(e){e.classList.remove('on');});
      center.innerHTML=def;}
    function pick(i){
      if(i===sel){reset();return;}
      sel=i;svg.classList.add('sel-active');
      card.querySelectorAll('.dslice.on,.leg-row.on').forEach(function(e){e.classList.remove('on');});
      var slice=svg.querySelector('.dslice[data-sec="'+i+'"]'), row=card.querySelector('.leg-row[data-sec="'+i+'"]');
      if(slice)slice.classList.add('on');
      if(row)row.classList.add('on');
      if(slice)center.innerHTML='<span class="donut-n donut-pc ink-grad">'+esc(slice.getAttribute('data-pc'))+'<i>%</i></span>'+
        '<span class="donut-l donut-nm">'+esc(slice.getAttribute('data-nm'))+'</span>';
    }
    card.querySelectorAll('[data-sec]').forEach(function(el){
      el.addEventListener('click',function(){pick(el.getAttribute('data-sec'));});
      el.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();pick(el.getAttribute('data-sec'));}});
    });
  }

  function renderHoldings(token,sub,stocks,active,opts){
    opts=opts||{}; var skipFx=!!opts.skipFx;   // capital changes re-render without replaying entrances
    stocks=stocks||[];
    var n=stocks.length||1;
    var industries={};stocks.forEach(function(s){industries[(s.industry||'Unknown').trim()||'Unknown']=1;});
    var nInd=Object.keys(industries).length;
    var dl=daysLeft(sub&&sub.expires_at);
    var anyNS=stocks.some(isNS), curr=anyNS?'₹':'$';
    if(!capital||capitalCurr!==curr){capital=curr==='₹'?1500000:20000;capitalCurr=curr;}
    var secCol=sectorColors(stocks);
    var maxW=Math.max.apply(null,stocks.map(function(s){return Number(s.weight_pct)||0;}).concat([1]));
    // Capital actually deployable once shares are whole numbers — the remainder is
    // idle cash. Surfaced as a deployment meter so members see real uninvested cash.
    var perStock=capital/n, deployed=0;
    stocks.forEach(function(s){var pr=Number(s.recommended_price)||0;if(pr>0)deployed+=Math.floor(perStock/pr)*pr;});
    deployed=Math.round(deployed);
    var cashLeft=Math.max(0,capital-deployed);
    var depPct=capital>0?Math.min(100,deployed/capital*100):0;

    function holdingHTML(s,i){
      var price=Number(s.recommended_price)||0;
      var w=Number(s.weight_pct)||0;
      var per=capital/n;var shares=price>0?Math.floor(per/price):0;var amt=shares*price;
      var c=curOf(s);
      var ind=(s.industry||'').trim();
      var dot=ind?'<span class="dot" style="background:'+(secCol[ind]||'#cbd5e1')+'"></span>':'';
      var blink=MFCBrokers.orderLink(s);
      var bcur=MFCBrokers.current();
      var bname=bcur.name, blogo=bcur.logo||'';
      return '<div class="holding'+(skipFx?'':' rise')+'" style="--h-acc:'+(ind?(secCol[ind]||'transparent'):'transparent')+(skipFx?'':';animation-delay:'+Math.min(i*40,400)+'ms')+'">'+
        '<div class="h-top"><div class="h-rank'+(i<3?' medal m'+(i+1):'')+'">'+(i+1)+'</div>'+
          '<div class="h-name"><div class="h-co">'+esc(s.company_name||s.ticker)+'</div>'+
          '<div class="h-tk" data-copy="'+esc(s.ticker)+'">'+esc(s.ticker)+' <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg></div>'+
          (ind?'<div><span class="h-sec">'+dot+esc(ind)+'</span></div>':'')+'</div>'+
          '<div class="h-wt"><div class="h-wt-k">Weight</div><div class="h-wt-v ink-grad">'+(w?w.toFixed(1)+'%':'—')+'</div></div>'+
        '</div>'+
        '<div class="h-bar"><i style="--w:'+((w/maxW)*100).toFixed(1)+'%;width:'+(skipFx?((w/maxW)*100).toFixed(1)+'%':'0')+'"></i></div>'+
        '<div class="h-grid">'+
          '<div class="h-cell"><div class="k">Rec. price</div><div class="v">'+c+price.toFixed(2)+'</div></div>'+
          '<div class="h-cell"><div class="k">Allocation</div><div class="v accent">'+fmtMoney(c,amt)+'</div></div>'+
          '<div class="h-cell"><div class="k">Shares</div><div class="v">'+shares+'</div></div>'+
        '</div>'+
        '<div class="h-buy">'+
          (blink?'<a class="btn btn-primary btn-sm" href="'+esc(blink)+'" target="_blank" rel="noopener noreferrer"><span class="bk-glyph">'+blogo+'</span>Buy on '+esc(bname)+' →</a>':'<span class="chip-mini">Link a broker to buy</span>')+
          '<button class="chip-mini" data-copy="'+esc(s.ticker)+'">Copy</button>'+
        '</div>'+
      '</div>';
    }

    render(appbarHTML({right:subSwitcher(active,token)})+
      '<main class="screen">'+
        '<div class="eyebrow">'+esc(strategyLabel(sub&&sub.strategy))+'</div>'+
        '<h1 class="h-title">This cycle’s picks</h1>'+
        '<p class="h-sub">Place these with your broker and you’re set for the month.</p>'+
        '<div class="tiles'+(skipFx?'':' tiles-in')+'">'+
          tileNum('Total picks',stocks.length,'','equal-weighted')+
          tileNum('Industries',nInd,'','sector-diversified')+
          (dl!=null?tileRenew(dl,sub&&sub.expires_at?fmtDate(sub.expires_at):''):tile('Renews in','—',sub&&sub.expires_at?fmtDate(sub.expires_at):''))+
          tileBroker()+
        '</div>'+
        sectorAllocCard(stocks,secCol)+
        '<div class="card" style="margin-top:14px">'+
          '<label style="display:block;font-size:13px;font-weight:800;color:var(--ink2);margin-bottom:9px">Position sizing</label>'+
          '<div class="calc">'+
            '<input class="input" id="capIn" inputmode="numeric" value="'+capital.toLocaleString(curr==='₹'?'en-IN':'en-US')+'">'+
            (curr==='₹'?['500000','1500000','2500000','5000000'].map(function(v){return '<button class="preset'+(Number(v)===capital?' active':'')+'" data-cap="'+v+'">₹'+(Number(v)/100000)+'L</button>';}).join(''):
              ['10000','25000','50000','100000'].map(function(v){return '<button class="preset'+(Number(v)===capital?' active':'')+'" data-cap="'+v+'">$'+(Number(v)/1000)+'k</button>';}).join(''))+
          '</div>'+
          '<div class="calc-out"><span>Per stock <b>'+fmtMoney(curr,capital/n)+'</b></span><span>'+stocks.length+' picks · equal-weighted</span></div>'+
          '<div class="deploy">'+
            '<div class="deploy-bar"><i style="--w:'+depPct.toFixed(1)+'%;width:'+(skipFx?depPct.toFixed(1)+'%':'0')+'"></i></div>'+
            '<div class="deploy-meta"><span class="dep-on"><span class="dep-dot"></span>Deployed <b>'+fmtMoney(curr,deployed)+'</b> · <span data-count="'+depPct.toFixed(0)+'" data-suffix="%">'+depPct.toFixed(0)+'%</span></span><span>Idle cash <b>'+fmtMoney(curr,cashLeft)+'</b></span></div>'+
          '</div>'+
        '</div>'+
        '<div class="list-h"><span class="lt">Stock picks</span>'+
          (stocks.length?'<button class="copy-all" data-copyall aria-label="Copy all '+stocks.length+' tickers to your clipboard"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>Copy all '+stocks.length+'</button>':'')+
        '</div>'+
        (stocks.length?stocks.map(holdingHTML).join(''):'<div class="empty">'+emptyIll('doc')+'<h4>No picks published yet</h4><p>New monthly sets are released on the first business day.</p></div>')+
      '</main>','holdings',function(){
        wireSubSwitcher();
        wireDonut();
        // copy ticker
        appEl.querySelectorAll('[data-copy]').forEach(function(b){b.addEventListener('click',function(){
          var t=b.getAttribute('data-copy');
          if(navigator.clipboard)navigator.clipboard.writeText(t).then(function(){toast(t+' copied');}).catch(function(){toast(t);});
          else toast(t);
        });});
        // V20.3 — "Copy all" copies every ticker (space-separated) so a member can paste
        // the whole month's basket straight into a broker watchlist in one go.
        var copyAll=appEl.querySelector('[data-copyall]');
        if(copyAll)copyAll.addEventListener('click',function(){
          var all=stocks.map(function(s){return (s.ticker||'').toUpperCase();}).filter(Boolean).join(' ');
          if(navigator.clipboard&&all)navigator.clipboard.writeText(all).then(function(){toast(stocks.length+' tickers copied');}).catch(function(){toast('Tickers copied');});
          else toast(all?'Tickers copied':'Nothing to copy');
        });
        // capital calculator — re-render WITHOUT replaying entrance animations
        var capIn=document.getElementById('capIn');
        function applyCap(v){capital=Math.max(0,Math.round(Number(String(v).replace(/[^0-9.]/g,''))||0));capitalCurr=curr;renderHoldings(token,sub,stocks,active,{skipFx:true});}
        if(capIn){capIn.addEventListener('change',function(){applyCap(capIn.value);});}
        appEl.querySelectorAll('[data-cap]').forEach(function(p){p.addEventListener('click',function(){applyCap(p.getAttribute('data-cap'));});});
        // entrances: count up the stats + draw in the donut/legend (first render only)
        if(!skipFx){
          appEl.querySelectorAll('[data-count]').forEach(countUp);
          var ac=appEl.querySelector('.alloc-card'); if(ac)ac.classList.add('fx');
          // Fill the weight + deployment bars from 0 → their target so the CSS
          // width transition actually plays. (An inline *target* width paints full
          // on the first frame and silently skips the animation.) The bars render
          // at width:0; we force ONE reflow so that 0 commits as the transition's
          // start value, then set each target — the browser tweens 0 → --w.
          var bars=appEl.querySelectorAll('.h-bar>i,.deploy-bar>i');
          if(bars.length){
            void appEl.offsetHeight;   // flush layout: width:0 is now the "from" state
            bars.forEach(function(b){b.style.width=b.style.getPropertyValue('--w');});
          }
        }
      });
  }
  function tile(k,v,s,cls){return '<div class="tile'+(cls?' '+cls:'')+'"><div class="t-k">'+esc(k)+'</div><div class="t-v">'+v+'</div><div class="t-s">'+esc(s||'')+'</div></div>';}
  // V20.0 — the "Broker" KPI tile now carries the linked broker's REAL logo badge
  // (white glyph on its brand colour, or Groww's two-tone badge), so the picks
  // screen visibly reflects where a one-tap order will land — tying the new brand
  // marks into the Holdings KPI row. Falls back gracefully if no logo is present.
  function tileBroker(){
    var b=MFCBrokers.current();
    var badge=b.logo?'<span class="tb-badge" style="background:'+b.color+'">'+b.logo+'</span>':'';
    return '<div class="tile tile-broker"><div class="t-k">Broker</div>'+
      '<div class="t-v tb-v">'+badge+'<span class="tb-nm">'+esc(b.name)+'</span></div>'+
      '<div class="t-s">tap a pick to buy</div></div>';
  }
  function tileNum(k,num,suffix,s){return '<div class="tile"><div class="t-k">'+esc(k)+'</div><div class="t-v"><span class="v-flow" data-count="'+num+'" data-suffix="'+(suffix||'')+'">'+num+(suffix||'')+'</span></div><div class="t-s">'+esc(s||'')+'</div></div>';}
  // V18.2 — the "Renews in" KPI carries a mini countdown ring (days left of a
  // ~monthly cycle); gold once ≤7 days out. Draws in with the tile entrance on
  // first paint; a capital re-render (.tiles, no -in) pins it at its value.
  function tileRenew(dl,dateStr){
    var CIRC=97.39;                                   // 2π·15.5 — ring circumference
    var frac=Math.max(0,Math.min(1,dl/30));
    var off=(CIRC*(1-frac)).toFixed(2);
    return '<div class="tile tile-renew'+(dl<=7?' soon':'')+'"><div class="t-k">Renews in</div>'+
      '<div class="t-v"><span class="v-flow" data-count="'+dl+'" data-suffix=" d">'+dl+' d</span></div>'+
      '<div class="t-s">'+esc(dateStr||'')+'</div>'+
      '<svg class="renew-ring" viewBox="0 0 38 38" aria-hidden="true">'+
        '<defs><linearGradient id="rrg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#2563eb"/><stop offset="1" stop-color="#0891b2"/></linearGradient></defs>'+
        '<circle class="rr-bg" cx="19" cy="19" r="15.5"/>'+
        '<circle class="rr-fg" cx="19" cy="19" r="15.5" style="--rc:97.39;--ro:'+off+'"/>'+
      '</svg></div>';
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  SCANNER  (links to the existing web tools)
  // ════════════════════════════════════════════════════════════════════════════
  // The four style factors the Scanner scores every NSE name on. Colours match the
  // per-strategy accent palette (STRAT_ACCENT) so the app reads as one system; each
  // lens carries an inline-SVG glyph in a tinted medallion + a plain-English one-liner.
  var FACTOR_LENSES=[
    {nm:'Value',   grad:'linear-gradient(135deg,#0891b2,#2dd4bf)', d:'Priced low vs. earnings, book & cash flow',
      ic:'<path d="M20.6 13.4l-7.2 7.2a2 2 0 01-2.8 0l-7-7A2 2 0 013 12.2V4a2 2 0 012-2h8.2a2 2 0 011.4.6l7 7a2 2 0 010 2.8z"/><path d="M7.5 7.5h.01"/>'},
    {nm:'Quality', grad:'linear-gradient(135deg,#1a50d8,#3b82f6)', d:'Strong balance sheet, high return on capital',
      ic:'<path d="M12 3l7 3v6c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V6z"/><path d="M9 12l2 2 4-4"/>'},
    {nm:'Growth',  grad:'linear-gradient(135deg,#7c3aed,#a855f7)', d:'Rising sales, profits & margins',
      ic:'<path d="M3 17l6-6 4 4 8-8"/><path d="M17 7h4v4"/>'},
    {nm:'Momentum',grad:'linear-gradient(135deg,#d97706,#f59e0b)', d:'Price & earnings trending higher',
      ic:'<path d="M13 2L3 14h7l-1 8 10-12h-7z"/>'}
  ];
  function lensGridHTML(){
    return '<div class="lens-grid">'+FACTOR_LENSES.map(function(f,i){
      return '<div class="lens" style="--lc:'+f.grad+';animation-delay:'+(i*55)+'ms">'+
        '<span class="lens-ic"><svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'+f.ic+'</svg></span>'+
        '<div class="lens-nm">'+esc(f.nm)+'</div><div class="lens-d">'+esc(f.d)+'</div></div>';
    }).join('')+'</div>';
  }
  function viewScanner(){
    render(appbarHTML({})+
      '<main class="screen intro">'+
        '<div class="eyebrow">Free tools</div>'+
        '<h1 class="h-title">Research the market</h1>'+
        '<p class="h-sub">The full NSE Scanner and Integrity Score scorecards, refreshed daily — plus the monthly India Factor Report.</p>'+
        toolCard('Scanner','Filter 2,100+ NSE stocks on value, quality, growth & momentum factors.','#1a50d8',C.SCREENER_URL,'M11 4a7 7 0 105.2 11.7L21 21')+
        toolCard('Integrity Score','Every NSE company graded 0–100 on Quality and Value.','#0891b2',C.SITE_URL+'/scores/','M3 3v18h18M7 14l3-3 3 3 5-6')+
        toolCard('Factor Report','This month’s India factor scoreboard — which styles are leading, ranked by trailing return.','#7c3aed',C.SITE_URL+'/factor-report/','M3 20h18M6 20v-4M12 20v-8M18 20v-12','Updated monthly')+
        '<div class="list-h"><span class="lt">The four factor lenses</span><span class="ls">scored daily</span></div>'+
        lensGridHTML()+
        '<p class="note" style="margin-top:14px">The Scanner and scorecards open the live tools on mindforgecapital.com in your browser.</p>'+
      '</main>','scanner');
  }
  function toolCard(name,desc,color,url,icon,cadence){
    return '<a class="sub-card rise" href="'+esc(url)+'" target="_blank" rel="noopener" style="margin-bottom:12px;text-decoration:none;color:inherit">'+
      '<div class="sc-ico" style="background:'+color+'"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="'+icon+'"/></svg></div>'+
      '<div class="sc-body"><div class="sc-name">'+esc(name)+'</div><div class="sc-meta">'+esc(desc)+'</div><span class="live-tag"><span class="live-dot"></span>'+esc(cadence||'Live · refreshed daily')+'</span></div>'+
      '<div class="sc-chev"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17L17 7M9 7h8v8"/></svg></div></a>';
  }

  // Appearance segmented control (V15.6) — Auto / Light / Dark, mirroring iOS
  // Settings. Reflects the stored preference; driven by window.MFCTheme (theme.js).
  function appearanceSegHTML(){
    var cur=(window.MFCTheme&&window.MFCTheme.get&&window.MFCTheme.get())||'auto';
    var OPTS=[
      {k:'auto', label:'Auto', icon:'<circle cx="12" cy="12" r="9"/><path d="M12 21a9 9 0 000-18" fill="currentColor" stroke="none"/>'},
      {k:'light',label:'Light',icon:'<circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.4M12 19.1v2.4M2.5 12h2.4M19.1 12h2.4M5.1 5.1l1.7 1.7M17.2 17.2l1.7 1.7M18.9 5.1l-1.7 1.7M6.8 17.2l-1.7 1.7"/>'},
      {k:'dark', label:'Dark', icon:'<path d="M21 12.8A8.5 8.5 0 1111.2 3a6.6 6.6 0 009.8 9.8z"/>'}
    ];
    return '<div class="seg" id="appearanceSeg" role="group" aria-label="Appearance">'+
      OPTS.map(function(o){
        return '<button class="seg-btn'+(o.k===cur?' active':'')+'" data-theme-set="'+o.k+'" aria-pressed="'+(o.k===cur)+'">'+
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">'+o.icon+'</svg>'+esc(o.label)+'</button>';
      }).join('')+'</div>'+
      '<p class="hint" style="margin-top:9px">Auto follows your device’s Light / Dark setting.</p>';
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  ACCOUNT  (profile · broker linking · appearance · sign out)
  // ════════════════════════════════════════════════════════════════════════════
  function viewAccount(){
    var sess=MFCStore.getSession()||{subscriptions:[]};
    var nActive=(sess.subscriptions||[]).filter(function(s){return String(s.status).toLowerCase()==='active';}).length;
    render(appbarHTML({})+
      '<main class="screen intro">'+
        '<div class="eyebrow">Account</div>'+
        '<div class="acct-head rise">'+
          '<div class="acct-av">'+esc(initials(sess.name))+'</div>'+
          '<div class="acct-id"><div class="acct-nm">'+esc(sess.name||'Your account')+'</div>'+
            '<div class="acct-em">'+esc(sess.email||'')+'</div>'+
            (nActive?'<span class="acct-chip"><span class="dot"></span>'+nActive+' active '+(nActive===1?'subscription':'subscriptions')+'</span>':'')+
          '</div>'+
        '</div>'+

        '<div class="list-h"><span class="lt">Linked broker</span></div>'+
        '<div id="brokerSection"></div>'+

        '<div class="list-h"><span class="lt">Subscriptions</span></div>'+
        (sess.subscriptions&&sess.subscriptions.length?sess.subscriptions.map(function(s){
          var st=String(s.status).toLowerCase();
          var badge=st==='active'?'<span class="badge badge-active"><span class="dot"></span>Active</span>':(st==='expired'?'<span class="badge badge-expired">Expired</span>':'<span class="badge badge-muted">'+esc(st)+'</span>');
          return '<div class="card acct-sub"><span class="acct-sub-sw" style="background:'+strategyAccent(s.strategy)+'"></span><div class="acct-sub-id"><div class="acct-sub-nm">'+esc(strategyLabel(s.strategy))+'</div><div class="sc-meta">Renews '+fmtDate(s.expires_at)+'</div></div>'+badge+'</div>';
        }).join(''):'<div class="note">No subscriptions on file.</div>')+

        '<div class="list-h"><span class="lt">Support</span></div>'+
        '<a class="broker-opt" href="'+C.WHATSAPP_URL+'" target="_blank" rel="noopener"><div class="broker-logo" style="background:#25D366">'+WA_LOGO+'</div><div class="bo-body"><div class="bo-name">WhatsApp support</div><div class="bo-sub">Renewals, billing &amp; help</div></div></a>'+
        '<a class="broker-opt" href="'+C.SITE_URL+'/recover.html" target="_blank" rel="noopener"><div class="broker-logo" style="background:var(--accent)"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7.5l9 6 9-6"/></svg></div><div class="bo-body"><div class="bo-name">Email me my dashboard links</div><div class="bo-sub">Recover web access</div></div></a>'+

        '<div class="list-h"><span class="lt">Appearance</span></div>'+
        appearanceSegHTML()+

        '<button class="btn btn-ghost" id="signOut" style="margin-top:20px;color:var(--red);border-color:rgba(220,38,38,.3)">Sign out</button>'+
        '<p class="hint" style="text-align:center;margin-top:16px">MindForge Capital · SEBI-registered Research Analyst<br>Research & education only · not investment advice</p>'+
      '</main>','account',function(){
        renderBrokerSection();
        // Appearance — Auto / Light / Dark (persists via theme.js; recolours live)
        var seg=document.getElementById('appearanceSeg');
        if(seg)seg.querySelectorAll('[data-theme-set]').forEach(function(b){
          b.addEventListener('click',function(){
            var v=b.getAttribute('data-theme-set');
            if(window.MFCTheme)window.MFCTheme.set(v);
            seg.querySelectorAll('.seg-btn').forEach(function(x){var on=x===b;x.classList.toggle('active',on);x.setAttribute('aria-pressed',on);});
            toast(v==='auto'?'Appearance · Auto':(v==='dark'?'Dark mode on':'Light mode on'));
          });
        });
        document.getElementById('signOut').addEventListener('click',function(){
          MFCStore.signOut();holdingsCache={};currentToken=null;toast('Signed out');location.hash='#/login';
        });
      });
  }

  function renderBrokerSection(){
    var host=document.getElementById('brokerSection');if(!host)return;
    var linked=MFCStore.getBroker();
    var html=MFCBrokers.list().map(function(b){
      var on=linked&&linked.id===b.id;
      return '<div class="broker-opt'+(on?' linked':'')+'" data-broker="'+b.id+'">'+
        '<div class="broker-logo" style="background:'+b.color+'">'+b.logo+'</div>'+
        '<div class="bo-body"><div class="bo-name">'+esc(b.name)+'</div><div class="bo-sub">'+(on?'Linked · one-tap order links on':'Tap to link for one-tap orders')+'</div></div>'+
        '<div class="bo-state">'+(on?'✓ Linked':'Link')+'</div>'+
      '</div>';
    }).join('');
    // Kite Connect (API) tier
    if(MFCBrokers.kiteEnabled()){
      html+='<a class="broker-opt" href="'+esc(MFCBrokers.kiteLoginUrl())+'"><div class="broker-logo" style="background:#387ed1">'+((MFCBrokers.get('kite')||{}).logo||'')+'</div><div class="bo-body"><div class="bo-name">Connect Zerodha (live)</div><div class="bo-sub">Kite Connect · live holdings &amp; in-app orders</div></div><div class="bo-state">Connect</div></a>';
    }else{
      html+='<div class="note amber" style="margin-top:4px"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#d97706" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px"><path d="M13 2L3 14h7l-1 8 10-12h-7z"/></svg> <b>Live account linking</b> (Kite Connect — real holdings &amp; in-app orders) is built in and activates once a Kite Connect API key is configured. Until then, the deeplinks above give you one-tap, pre-filled orders.</div>';
    }
    if(linked)html+='<button class="btn btn-ghost btn-sm" id="unlinkBroker" style="margin-top:10px;width:auto;padding:8px 14px;color:var(--ink3)">Unlink broker</button>';
    host.innerHTML=html;
    host.querySelectorAll('[data-broker]').forEach(function(b){b.addEventListener('click',function(){
      MFCBrokers.linkDeeplink(b.getAttribute('data-broker'));toast('Broker linked');renderBrokerSection();
    });});
    var un=document.getElementById('unlinkBroker');if(un)un.addEventListener('click',function(){MFCBrokers.unlink();toast('Broker unlinked');renderBrokerSection();});
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  ROUTER
  // ════════════════════════════════════════════════════════════════════════════
  function router(){
    pendingNav=true;                    // V20.3 — the next render() plays the route transition
    var hash=location.hash||'';
    if(!MFCStore.isSignedIn()&&hash!=='#/login'){location.replace('#/login');return;}
    if(hash==='#/login'){if(MFCStore.isSignedIn()){location.replace('#/home');return;}return viewLogin();}
    if(hash.indexOf('#/holdings/')===0)return viewHoldings(decodeURIComponent(hash.slice('#/holdings/'.length)));
    switch(hash){
      case '#/home': return viewHome();
      case '#/holdings': return viewHoldings(currentToken);
      case '#/scanner': return viewScanner();
      case '#/account': return viewAccount();
      default: location.replace(MFCStore.isSignedIn()?'#/home':'#/login');
    }
  }

  // ── offline awareness ─────────────────────────────────────────────────────────
  function reflectOnline(){var b=document.getElementById('offline');if(b)b.className='offline'+(navigator.onLine?'':' show');}
  window.addEventListener('online',reflectOnline);window.addEventListener('offline',reflectOnline);

  // app-bar elevates as the screen scrolls (parity with the website nav)
  window.addEventListener('scroll',function(){var ab=document.querySelector('.appbar');if(ab)ab.classList.toggle('scrolled',(window.scrollY||0)>4);},{passive:true});

  // ── boot ──────────────────────────────────────────────────────────────────────
  window.addEventListener('hashchange',router);
  reflectOnline();
  if(!location.hash)location.replace(MFCStore.isSignedIn()?'#/home':'#/login');else router();

  // service worker — register ONLY on the deployed HTTPS site (where offline support
  // helps). On local demos (http://localhost or a LAN IP) skip it AND unregister any
  // stale one + drop its caches: a leftover service worker serving an old shell after
  // the local server restarts is the classic cause of a blank / "offline" page.
  if('serviceWorker' in navigator){
    if(location.protocol==='https:'){
      window.addEventListener('load',function(){navigator.serviceWorker.register('sw.js').catch(function(){});});
    }else{
      navigator.serviceWorker.getRegistrations().then(function(rs){rs.forEach(function(r){r.unregister();});}).catch(function(){});
      if(window.caches&&caches.keys){caches.keys().then(function(ks){ks.forEach(function(k){if(/^mfc-app/.test(k))caches.delete(k);});}).catch(function(){});}
    }
  }
})();
