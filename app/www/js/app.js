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

  // ── helpers ────────────────────────────────────────────────────────────────
  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function isNS(s){return !(s.yahoo_ticker && !/\.NS$/i.test(s.yahoo_ticker));}
  function curOf(s){return isNS(s)?'₹':'$';}
  function fmtINR(n){return (Number(n)||0).toLocaleString('en-IN',{maximumFractionDigits:0});}
  function fmtMoney(curr,n){return curr==='₹'?('₹'+fmtINR(n)):('$'+(Number(n)||0).toLocaleString('en-US',{maximumFractionDigits:0}));}
  var STRAT_NAMES={largemidcap:'LargeMidcap 250',smallmicro:'SmallMicro 500',multicap:'MultiCap',multiasset:'MultiAsset',sp500:'S&P 500',allaccess:'All-Access'};
  function strategyLabel(s){
    s=String(s||'');
    var key=s.toLowerCase().replace(/[^a-z0-9]/g,'');           // "MindForge LargeMidcap 250" → "mindforgelargemidcap250"
    for(var k in STRAT_NAMES){ if(key.indexOf(k)!==-1) return STRAT_NAMES[k]; }
    return s.replace(/_/g,' ').replace(/\b\w/g,function(c){return c.toUpperCase();}).replace(/Mindforge/i,'MindForge');
  }
  function fmtDate(d){if(!d)return '—';var dt=new Date(d);if(isNaN(dt))return esc(d);return dt.toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'});}
  function daysLeft(d){if(!d)return null;var dt=new Date(d);if(isNaN(dt))return null;return Math.max(0,Math.ceil((dt-new Date())/86400000));}

  var toastTimer;
  function toast(msg,isErr){
    var t=document.getElementById('toast');t.textContent=msg;t.className='toast show'+(isErr?' err':'');
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
          '<img src="assets/favicon-192.png" alt="" style="width:60px;height:60px;border-radius:17px;box-shadow:0 12px 30px -12px rgba(26,80,216,.6)">'+
          '<h1 class="h-title" style="margin-top:16px">Welcome to <span class="gradtext">MindForge</span></h1>'+
          '<p class="h-sub" style="margin:0 auto;max-width:300px">Sign in to view your strategy picks and place them with your broker in one tap.</p>'+
        '</div>'+
        '<div class="card card-grad" id="loginCard"></div>'+
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
      '<div class="otp-inputs" id="otpRow">'+[0,1,2,3,4,5].map(function(i){return '<input class="input" inputmode="numeric" maxlength="1" autocomplete="'+(i===0?'one-time-code':'off')+'" data-i="'+i+'">';}).join('')+'</div>'+
      '<button class="btn btn-primary" id="verifyBtn" style="margin-top:16px">Verify &amp; sign in</button>'+
      '<div class="err" id="loginErr"></div>'+
      '<p class="hint">Didn’t get it? <a href="#" id="resend">Resend code</a> · check spam.</p>';
    var inputs=Array.prototype.slice.call(card.querySelectorAll('#otpRow input'));
    inputs[0].focus();
    inputs.forEach(function(inp,i){
      inp.addEventListener('input',function(){
        inp.value=inp.value.replace(/\D/g,'').slice(0,1);
        if(inp.value&&i<5)inputs[i+1].focus();
        if(inputs.every(function(x){return x.value;}))doVerify(inputs);
      });
      inp.addEventListener('keydown',function(e){if(e.key==='Backspace'&&!inp.value&&i>0)inputs[i-1].focus();if(e.key==='Enter')doVerify(inputs);});
      inp.addEventListener('paste',function(e){
        var d=(e.clipboardData||window.clipboardData).getData('text').replace(/\D/g,'').slice(0,6);
        if(d){e.preventDefault();d.split('').forEach(function(ch,k){if(inputs[k])inputs[k].value=ch;});(inputs[Math.min(d.length,5)]).focus();if(d.length===6)doVerify(inputs);}
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
      MFCStore.setSession(loginEmail,subs);
      var active=subs.filter(function(s){return String(s.status).toLowerCase()==='active';});
      currentToken=(active[0]||subs[0]||{}).token||null;
      toast('Signed in');
      location.hash='#/home';
    }).catch(function(err){
      btn.disabled=false;btn.innerHTML='Verify &amp; sign in';errEl.textContent=err.message;
      inputs.forEach(function(x){x.value='';});inputs[0].focus();
    });
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  HOME  (My Subscriptions)
  // ════════════════════════════════════════════════════════════════════════════
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
      return '<div class="sub-card rise" style="animation-delay:'+(i*60)+'ms" '+(isActive?'data-token="'+esc(s.token)+'"':'')+'>'+
        '<div class="sc-ico"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M7 14l3-3 3 3 5-6"/></svg></div>'+
        '<div class="sc-body"><div class="sc-name">'+esc(strategyLabel(s.strategy))+'</div>'+
        '<div class="sc-meta">'+badge+(isActive&&dl!=null?' · renews in '+dl+' day'+(dl===1?'':'s'):'')+'</div></div>'+
        (isActive?'<div class="sc-chev"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg></div>':'')+
      '</div>';
    }).join(''):
      '<div class="empty"><div class="ico">📭</div><h4>No subscriptions yet</h4><p>Subscribe to a strategy to see your monthly picks here.</p>'+
      '<a class="btn btn-primary" style="margin-top:14px" href="'+C.SIGNUP_URL+'" target="_blank" rel="noopener">Browse strategies →</a></div>';

    render(
      appbarHTML({right:'<button class="ab-btn" data-hash="#/account" aria-label="Account"><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0116 0"/></svg></button>'})+
      '<main class="screen">'+
        '<div class="eyebrow rise">Member dashboard</div>'+
        '<h1 class="h-title rise">Welcome back, <span class="gradtext">'+esc(first)+'</span>.</h1>'+
        '<p class="h-sub rise">'+(active.length?('You have '+active.length+' active '+(active.length===1?'strategy':'strategies')+'. Tap one to view this cycle’s picks.'):'Your subscriptions appear below.')+'</p>'+
        '<div class="list-h"><span class="lt">Your subscriptions</span></div>'+
        cards+
      '</main>','home',function(){
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
        render(appbarHTML({})+'<main class="screen"><div class="empty"><div class="ico">📈</div><h4>No active strategy</h4><p>Subscribe to a strategy to see its holdings.</p></div></main>','holdings');
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
       render(appbarHTML({right:subSwitcher(active,token)})+'<main class="screen"><div class="empty"><div class="ico">⚠️</div><h4>Couldn’t load your picks</h4><p>'+esc(err.message)+'</p><button class="btn btn-ghost" id="retry" style="margin-top:14px;width:auto;padding:11px 20px">Try again</button></div></main>','holdings',function(){
         wireSubSwitcher();var r=document.getElementById('retry');if(r)r.addEventListener('click',function(){viewHoldings(token);});
       });
     });
  }
  function subSwitcher(active,token){
    if(!active||active.length<2)return '';
    return '<select class="ab-btn" id="subSwitch" style="width:auto;padding:0 8px;font-weight:700;color:var(--ink2)" aria-label="Switch strategy">'+
      active.map(function(s){return '<option value="'+esc(s.token)+'"'+(s.token===token?' selected':'')+'>'+esc(strategyLabel(s.strategy))+'</option>';}).join('')+'</select>';
  }
  function wireSubSwitcher(){var sw=document.getElementById('subSwitch');if(sw)sw.addEventListener('change',function(){currentToken=sw.value;location.hash='#/holdings/'+encodeURIComponent(sw.value);});}

  function renderHoldings(token,sub,stocks,active){
    stocks=stocks||[];
    var n=stocks.length||1;
    var industries={};stocks.forEach(function(s){industries[(s.industry||'Unknown').trim()||'Unknown']=1;});
    var nInd=Object.keys(industries).length;
    var dl=daysLeft(sub&&sub.expires_at);
    var anyNS=stocks.some(isNS), curr=anyNS?'₹':'$';
    if(!capital)capital=curr==='₹'?1500000:20000;
    var secCol=sectorColors(stocks);
    var maxW=Math.max.apply(null,stocks.map(function(s){return Number(s.weight_pct)||0;}).concat([1]));

    function holdingHTML(s,i){
      var price=Number(s.recommended_price)||0;
      var w=Number(s.weight_pct)||0;
      var per=capital/n;var shares=price>0?Math.floor(per/price):0;var amt=shares*price;
      var c=curOf(s);
      var ind=(s.industry||'').trim();
      var dot=ind?'<span class="dot" style="background:'+(secCol[ind]||'#cbd5e1')+'"></span>':'';
      var blink=MFCBrokers.orderLink(s);
      var bname=MFCBrokers.current().name;
      return '<div class="holding rise" style="animation-delay:'+Math.min(i*40,400)+'ms">'+
        '<div class="h-top"><div class="h-rank">'+(i+1)+'</div>'+
          '<div class="h-name"><div class="h-co">'+esc(s.company_name||s.ticker)+'</div>'+
          '<div class="h-tk" data-copy="'+esc(s.ticker)+'">'+esc(s.ticker)+' <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg></div>'+
          (ind?'<div><span class="h-sec">'+dot+esc(ind)+'</span></div>':'')+'</div>'+
          '<div style="text-align:right"><div style="font-size:11px;font-weight:700;color:var(--ink3);text-transform:uppercase;letter-spacing:.05em">Weight</div><div style="font-size:18px;font-weight:800;color:var(--accent2)">'+(w?w.toFixed(1)+'%':'—')+'</div></div>'+
        '</div>'+
        '<div class="h-bar"><i style="--w:'+((w/maxW)*100).toFixed(1)+'%;width:'+((w/maxW)*100).toFixed(1)+'%"></i></div>'+
        '<div class="h-grid">'+
          '<div class="h-cell"><div class="k">Rec. price</div><div class="v">'+c+price.toFixed(2)+'</div></div>'+
          '<div class="h-cell"><div class="k">Allocation</div><div class="v accent">'+fmtMoney(c,amt)+'</div></div>'+
          '<div class="h-cell"><div class="k">Shares</div><div class="v">'+shares+'</div></div>'+
        '</div>'+
        '<div class="h-buy">'+
          (blink?'<a class="btn btn-primary btn-sm" href="'+esc(blink)+'" target="_blank" rel="noopener noreferrer">Buy on '+esc(bname)+' →</a>':'<span class="chip-mini">Link a broker to buy</span>')+
          '<button class="chip-mini" data-copy="'+esc(s.ticker)+'">Copy</button>'+
        '</div>'+
      '</div>';
    }

    render(appbarHTML({right:subSwitcher(active,token)})+
      '<main class="screen">'+
        '<div class="eyebrow">'+esc(strategyLabel(sub&&sub.strategy))+'</div>'+
        '<h1 class="h-title">This cycle’s picks</h1>'+
        '<p class="h-sub">Place these with your broker and you’re set for the month.</p>'+
        '<div class="tiles">'+
          tile('Total picks',String(stocks.length),'equal-weighted')+
          tile('Industries',String(nInd),'sector-diversified')+
          tile('Renews in',(dl!=null?dl+' d':'—'),sub&&sub.expires_at?fmtDate(sub.expires_at):'')+
          tile('Broker',esc(MFCBrokers.current().name),'tap a pick to buy')+
        '</div>'+
        '<div class="card" style="margin-top:14px">'+
          '<label style="display:block;font-size:13px;font-weight:800;color:var(--ink2);margin-bottom:9px">Position sizing</label>'+
          '<div class="calc">'+
            '<input class="input" id="capIn" inputmode="numeric" value="'+capital.toLocaleString('en-IN')+'">'+
            (curr==='₹'?['500000','1500000','2500000','5000000'].map(function(v){return '<button class="preset'+(Number(v)===capital?' active':'')+'" data-cap="'+v+'">₹'+(Number(v)/100000)+'L</button>';}).join(''):
              ['10000','25000','50000','100000'].map(function(v){return '<button class="preset'+(Number(v)===capital?' active':'')+'" data-cap="'+v+'">$'+(Number(v)/1000)+'k</button>';}).join(''))+
          '</div>'+
          '<div class="calc-out"><span>Per stock <b>'+fmtMoney(curr,capital/n)+'</b></span><span>'+stocks.length+' picks · equal-weighted</span></div>'+
        '</div>'+
        '<div class="list-h"><span class="lt">Stock picks</span><span class="ls">'+stocks.length+' holdings</span></div>'+
        (stocks.length?stocks.map(holdingHTML).join(''):'<div class="empty"><div class="ico">📄</div><h4>No picks published yet</h4><p>New monthly sets are released on the first business day.</p></div>')+
      '</main>','holdings',function(){
        wireSubSwitcher();
        // copy ticker
        appEl.querySelectorAll('[data-copy]').forEach(function(b){b.addEventListener('click',function(){
          var t=b.getAttribute('data-copy');
          if(navigator.clipboard)navigator.clipboard.writeText(t).then(function(){toast(t+' copied');}).catch(function(){toast(t);});
          else toast(t);
        });});
        // capital calculator
        var capIn=document.getElementById('capIn');
        function applyCap(v){capital=Math.max(0,Math.round(Number(String(v).replace(/[^0-9.]/g,''))||0));renderHoldings(token,sub,stocks,active);}
        if(capIn){capIn.addEventListener('change',function(){applyCap(capIn.value);});}
        appEl.querySelectorAll('[data-cap]').forEach(function(p){p.addEventListener('click',function(){applyCap(p.getAttribute('data-cap'));});});
      });
  }
  function tile(k,v,s){return '<div class="tile"><div class="t-k">'+esc(k)+'</div><div class="t-v">'+v+'</div><div class="t-s">'+esc(s||'')+'</div></div>';}

  // ════════════════════════════════════════════════════════════════════════════
  //  SCANNER  (links to the existing web tools)
  // ════════════════════════════════════════════════════════════════════════════
  function viewScanner(){
    render(appbarHTML({})+
      '<main class="screen">'+
        '<div class="eyebrow">Free tools</div>'+
        '<h1 class="h-title">Research the market</h1>'+
        '<p class="h-sub">The full NSE Scanner and the Integrity Score scorecards, refreshed daily.</p>'+
        toolCard('Scanner','Filter 2,100+ NSE stocks on value, quality, growth & momentum factors.','#1a50d8',C.SCREENER_URL,'M11 4a7 7 0 105.2 11.7L21 21')+
        toolCard('Integrity Score','Every NSE company graded 0–100 on Quality and Value.','#0891b2',C.SITE_URL+'/scores/','M3 3v18h18M7 14l3-3 3 3 5-6')+
        '<p class="note" style="margin-top:14px">These open the live tools on mindforgecapital.com in your browser.</p>'+
      '</main>','scanner');
  }
  function toolCard(name,desc,color,url,icon){
    return '<a class="sub-card rise" href="'+esc(url)+'" target="_blank" rel="noopener" style="margin-bottom:12px;text-decoration:none;color:inherit">'+
      '<div class="sc-ico" style="background:'+color+'"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="'+icon+'"/></svg></div>'+
      '<div class="sc-body"><div class="sc-name">'+esc(name)+'</div><div class="sc-meta">'+esc(desc)+'</div></div>'+
      '<div class="sc-chev"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17L17 7M9 7h8v8"/></svg></div></a>';
  }

  // ════════════════════════════════════════════════════════════════════════════
  //  ACCOUNT  (profile · broker linking · sign out)
  // ════════════════════════════════════════════════════════════════════════════
  function viewAccount(){
    var sess=MFCStore.getSession()||{subscriptions:[]};
    render(appbarHTML({})+
      '<main class="screen">'+
        '<div class="eyebrow">Account</div>'+
        '<h1 class="h-title">'+esc(sess.name||'Your account')+'</h1>'+
        '<p class="h-sub">'+esc(sess.email||'')+'</p>'+

        '<div class="list-h"><span class="lt">Linked broker</span></div>'+
        '<div id="brokerSection"></div>'+

        '<div class="list-h"><span class="lt">Subscriptions</span></div>'+
        (sess.subscriptions&&sess.subscriptions.length?sess.subscriptions.map(function(s){
          var st=String(s.status).toLowerCase();
          var badge=st==='active'?'<span class="badge badge-active"><span class="dot"></span>Active</span>':(st==='expired'?'<span class="badge badge-expired">Expired</span>':'<span class="badge badge-muted">'+esc(st)+'</span>');
          return '<div class="card" style="display:flex;align-items:center;justify-content:space-between;gap:10px"><div><div style="font-weight:800">'+esc(strategyLabel(s.strategy))+'</div><div class="sc-meta">Renews '+fmtDate(s.expires_at)+'</div></div>'+badge+'</div>';
        }).join(''):'<div class="note">No subscriptions on file.</div>')+

        '<div class="list-h"><span class="lt">Support</span></div>'+
        '<a class="broker-opt" href="'+C.WHATSAPP_URL+'" target="_blank" rel="noopener"><div class="broker-logo" style="background:#25D366">💬</div><div class="bo-body"><div class="bo-name">WhatsApp support</div><div class="bo-sub">Renewals, billing & help</div></div></a>'+
        '<a class="broker-opt" href="'+C.SITE_URL+'/recover.html" target="_blank" rel="noopener"><div class="broker-logo" style="background:var(--accent)">✉</div><div class="bo-body"><div class="bo-name">Email me my dashboard links</div><div class="bo-sub">Recover web access</div></div></a>'+

        '<button class="btn btn-ghost" id="signOut" style="margin-top:20px;color:var(--red);border-color:rgba(220,38,38,.3)">Sign out</button>'+
        '<p class="hint" style="text-align:center;margin-top:16px">MindForge Capital · SEBI-registered Research Analyst<br>Research & education only · not investment advice</p>'+
      '</main>','account',function(){
        renderBrokerSection();
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
      html+='<a class="broker-opt" href="'+esc(MFCBrokers.kiteLoginUrl())+'"><div class="broker-logo" style="background:#387ed1">⚡</div><div class="bo-body"><div class="bo-name">Connect Zerodha (live)</div><div class="bo-sub">Kite Connect · live holdings & in-app orders</div></div><div class="bo-state">Connect</div></a>';
    }else{
      html+='<div class="note amber" style="margin-top:4px">⚡ <b>Live account linking</b> (Kite Connect — real holdings & in-app orders) is built in and activates once a Kite Connect API key is configured. Until then, the deeplinks above give you one-tap, pre-filled orders.</div>';
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
