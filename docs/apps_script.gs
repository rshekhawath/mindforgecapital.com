/*
================================================================================
  MindForge Capital - Google Apps Script Backend
================================================================================

SETUP INSTRUCTIONS:
1. Create a Google Sheet with 3 sheets: "strategy_runs", "subscriptions", "leads"
2. Add the column headers to each sheet (see SHEET STRUCTURE below)
3. Go to Extensions -> Apps Script
4. Paste this entire code into the editor
5. Save the project
6. Click Deploy -> New Deployment -> Web App
7. Execute as: Me (your account)
8. Who has access: Anyone
9. Click Deploy -> Authorize -> Grant permission to MindForge Capital
10. Copy the Deployment ID and Web App URL
11. Replace PLACEHOLDER_APPS_SCRIPT_URL in:
    - dashboard.html
    - recover.html
    - strategies.html
    - mindforge_runner.py
12. Test by visiting dashboard.html?token=TEST_TOKEN

SHEET STRUCTURE:
  Sheet "strategy_runs":
    A: run_id
    B: run_time
    C: strategy
    D: ticker
    E: yahoo_ticker
    F: company_name
    G: industry
    H: recommended_price
    I: weight_pct

  Sheet "subscriptions":
    A: token
    B: email
    C: name
    D: phone
    E: strategy
    F: run_id
    G: subscribed_at
    H: expires_at
    I: payment_id
    J: status

  Sheet "leads":
    A: timestamp
    B: name
    C: email
    D: phone
    E: strategy
    F: price
    G: status  (pending | activated)

================================================================================
*/

const SHEET_NAME = 'MindForge Capital'; // Change to your Google Sheet name

// -----------------------------------------------------------------------------
// MAIN HANDLERS
// -----------------------------------------------------------------------------

// -- ADMIN AUTH ---------------------------------------------------------------
// activate / decline / get_leads require admin_secret matching ADMIN_SECRET in
// Script Properties. Set it once via the Apps Script editor:
//   Project Settings -> Script Properties -> Add property
//   Key: ADMIN_SECRET   Value: <a long random string you keep private>
// Without it set, admin endpoints fail-closed (return an error).
function adminAuthOk(provided) {
  const expected = PropertiesService.getScriptProperties().getProperty('ADMIN_SECRET');
  if (!expected) return false; // fail-closed if not configured
  if (!provided) return false;
  return String(provided) === String(expected);
}
function adminAuthError() {
  return ContentService.createTextOutput(JSON.stringify({
    status: 'error',
    error:  'Unauthorized: admin_secret missing or invalid'
  })).setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);
    const action = payload.action;

    if (action === 'subscribe') {
      return handleSubscribe(payload);
    } else if (action === 'save_run') {
      return handleSaveRun(payload);
    } else if (action === 'save_lead') {
      return handleSaveLead(payload);
    } else if (action === 'activate') {
      if (!adminAuthOk(payload.admin_secret)) return adminAuthError();
      return handleActivate(payload);
    } else if (action === 'decline') {
      if (!adminAuthOk(payload.admin_secret)) return adminAuthError();
      return handleDecline(payload);
    } else if (!action) {
      // Legacy payload with no action - treat as a save_lead.
      return handleLegacyLead(payload);
    } else {
      // Reject unknown actions explicitly. The previous code silently
      // fell through to handleLegacyLead, which meant any *new* action
      // (e.g. 'decline') against a not-yet-redeployed Apps Script would
      // create a phantom pending lead and return {status: 'ok'} -
      // misleading the caller into thinking the action succeeded.
      return ContentService.createTextOutput(JSON.stringify({
        status: 'error',
        error:  'Unknown action: ' + action
      })).setMimeType(ContentService.MimeType.JSON);
    }
  } catch (err) {
    Logger.log('doPost error: ' + err);
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error',
      error: 'Invalid request'
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  try {
    const action = e.parameter.action;

    if (action === 'stocks') {
      return handleGetStocks(e.parameter.token);
    } else if (action === 'prices') {
      return handleGetPrices(e.parameter.tickers);
    } else if (action === 'recover') {
      return handleRecover(e.parameter.email, e.parameter.phone);
    } else if (action === 'get_leads') {
      if (!adminAuthOk(e.parameter.admin_secret)) return adminAuthError();
      return handleGetLeads();
    } else if (action === 'request_otp') {
      return handleRequestOTP(e.parameter.email);
    } else if (action === 'verify_otp') {
      return handleVerifyOTP(e.parameter.email, e.parameter.otp);
    } else {
      return ContentService.createTextOutput(JSON.stringify({
        status: 'error',
        error: 'Invalid action'
      })).setMimeType(ContentService.MimeType.JSON);
    }
  } catch (err) {
    Logger.log('doGet error: ' + err);
    return ContentService.createTextOutput(JSON.stringify({
      status: 'error',
      error: 'Server error'
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

// -----------------------------------------------------------------------------
// ACTION HANDLERS
// -----------------------------------------------------------------------------

function handleSubscribe(payload) {
  const token = payload.token;
  const email = payload.email;
  const name = payload.name;
  const phone = payload.phone;
  const strategy = payload.strategy;
  const paymentId = payload.payment_id;

  // Find latest run_id for this strategy
  const runId = findLatestRunId(strategy);

  // Expiry by duration months (item 9). Legacy callers without duration_months
  // default to 1 month so they never accidentally get a 30-day plan when the
  // user paid for a longer one.
  const durationMonths = parseInt(payload.duration_months, 10) || 1;
  const subscribedAt = new Date();
  const expiresAt    = new Date();
  expiresAt.setMonth(expiresAt.getMonth() + durationMonths);
  const notifyFlag = durationMonths > 1 ? 'on' : 'off';

  // Save to subscriptions sheet (K: duration_months, L: notify flag)
  const sheet = getSheet('subscriptions');
  sheet.appendRow([
    token,
    email,
    name,
    phone,
    strategy,
    runId,
    subscribedAt.toISOString(),
    expiresAt.toISOString(),
    paymentId,
    'active',
    durationMonths,
    notifyFlag
  ]);

  // Send confirmation email
  sendSubscriptionEmail(email, name, strategy,
    getBaseUrl() + '/dashboard.html?token=' + token,
    expiresAt);

  return ContentService.createTextOutput(JSON.stringify({
    status: 'ok',
    message: 'Subscription saved. Confirmation email sent.'
  })).setMimeType(ContentService.MimeType.JSON);
}

function handleSaveRun(payload) {
  const runId = payload.run_id;
  const runTime = payload.run_time;
  const strategy = payload.strategy;
  const stocks = payload.stocks; // array of {ticker, yahoo_ticker, company_name, industry, recommended_price, weight_pct}

  const sheet = getSheet('strategy_runs');

  stocks.forEach(function(stock) {
    sheet.appendRow([
      runId,
      runTime,
      strategy,
      stock.ticker,
      stock.yahoo_ticker,
      stock.company_name,
      stock.industry,
      stock.recommended_price,
      stock.weight_pct
    ]);
  });

  Logger.log('Saved ' + stocks.length + ' stocks for ' + strategy);

  // Item 11: email a rebalance notification to non-monthly subscribers of this
  // strategy (notify flag on, still active). Non-fatal.
  let notified = 0;
  try { notified = notifyRebalance(strategy, runId); }
  catch (err) { Logger.log('notifyRebalance failed: ' + err); }

  return ContentService.createTextOutput(JSON.stringify({
    status: 'ok',
    run_id: runId,
    count: stocks.length,
    notified: notified
  })).setMimeType(ContentService.MimeType.JSON);
}

function handleLegacyLead(payload) {
  const sheet = getSheet('leads');
  sheet.appendRow([
    new Date().toISOString(),
    payload.name || '',
    payload.email || '',
    payload.phone || '',
    payload.strategy || '',
    payload.amount || '',
    'pending'
  ]);

  return ContentService.createTextOutput(JSON.stringify({
    status: 'ok'
  })).setMimeType(ContentService.MimeType.JSON);
}

function handleSaveLead(payload) {
  const sheet = getSheet('leads');
  const ts = new Date().toISOString();
  const durationMonths = parseInt(payload.duration_months, 10) || 1;

  // Item 12: when the user ticked the T&C box (agreement:true), generate a
  // signed-agreement PDF and store it in Drive alongside the backend sheet.
  // Non-fatal: if it fails the lead still saves.
  let pdfUrl = '';
  if (payload.agreement) {
    try { pdfUrl = generateAgreementPdf(payload, ts); }
    catch (err) { Logger.log('Agreement PDF generation failed: ' + err); }
  }

  sheet.appendRow([
    ts,
    payload.name  || '',
    payload.email || '',
    payload.phone || '',
    payload.strategy || '',
    payload.price || '',
    'pending',
    durationMonths,  // H: requested duration (months)
    pdfUrl           // I: signed-agreement PDF link (Drive)
  ]);

  // Notify admin of new lead
  sendAdminLeadNotification(payload.name || '', payload.email || '', payload.phone || '', payload.strategy || '', payload.price || '');

  return ContentService.createTextOutput(JSON.stringify({
    status: 'ok',
    message: 'Lead saved',
    agreement_pdf: pdfUrl
  })).setMimeType(ContentService.MimeType.JSON);
}

function handleActivate(payload) {
  const email    = (payload.email    || '').toLowerCase().trim();
  const strategy = payload.strategy  || '';
  const name     = payload.name      || '';
  const phone    = payload.phone     || '';

  if (!email || !strategy) {
    return errorResponse('email and strategy are required');
  }

  // Generate secure token
  const token = generateToken();
  const strategyClean = String(strategy || '').toLowerCase().trim();

  // Mark the matching pending lead as activated AND read the duration it was
  // created with (leads col H, item 9/10) so the subscription expiry + notify
  // flag match what the subscriber signed up for. payload.duration_months
  // overrides if the admin passed one explicitly.
  const leadsSheet = getSheet('leads');
  const leadsData  = leadsSheet.getDataRange().getValues();
  let durationMonths = parseInt(payload.duration_months, 10) || 0;
  let matched = false;
  // Pass 1: exact (email, strategy) match, newest pending first
  for (let i = leadsData.length - 1; i >= 1; i--) {
    const rowEmail    = String(leadsData[i][2] || '').toLowerCase().trim();
    const rowStrategy = String(leadsData[i][4] || '').toLowerCase().trim();
    const rowStatus   = String(leadsData[i][6] || '').toLowerCase();
    if (rowEmail === email && rowStrategy === strategyClean && rowStatus !== 'activated' && rowStatus !== 'declined') {
      leadsSheet.getRange(i + 1, 7).setValue('activated');
      if (!durationMonths) durationMonths = parseInt(leadsData[i][7], 10) || 1;
      matched = true;
      break;
    }
  }
  // Pass 2 (fallback): email-only match - legacy behaviour
  if (!matched) {
    for (let i = leadsData.length - 1; i >= 1; i--) {
      const rowEmail  = String(leadsData[i][2] || '').toLowerCase().trim();
      const rowStatus = String(leadsData[i][6] || '').toLowerCase();
      if (rowEmail === email && rowStatus !== 'activated' && rowStatus !== 'declined') {
        leadsSheet.getRange(i + 1, 7).setValue('activated');
        if (!durationMonths) durationMonths = parseInt(leadsData[i][7], 10) || 1;
        break;
      }
    }
  }
  if (!durationMonths) durationMonths = 1;

  // Expiry by duration (item 9): 1 / 3 / 6 / 12 calendar months.
  const subscribedAt = new Date();
  const expiresAt    = new Date();
  expiresAt.setMonth(expiresAt.getMonth() + durationMonths);

  // Item 11: non-monthly subscribers get rebalance notifications auto-on.
  const notifyFlag = durationMonths > 1 ? 'on' : 'off';

  // Find latest run_id for this strategy (pinned at activation)
  const runId = findLatestRunId(strategy);

  // Append to subscriptions sheet (K: duration_months, L: notify flag)
  const subSheet = getSheet('subscriptions');
  subSheet.appendRow([
    token,
    email,
    name,
    phone,
    strategy,
    runId,
    subscribedAt.toISOString(),
    expiresAt.toISOString(),
    'manual_upi',
    'active',
    durationMonths,
    notifyFlag
  ]);

  // Send dashboard access email
  const dashboardUrl = getBaseUrl() + '/dashboard.html?token=' + token;
  sendActivationEmail(email, name, strategy, dashboardUrl, expiresAt);

  return ContentService.createTextOutput(JSON.stringify({
    status: 'ok',
    token: token,
    dashboard_url: dashboardUrl,
    duration_months: durationMonths,
    message: 'Subscriber activated and email sent'
  })).setMimeType(ContentService.MimeType.JSON);
}

// -----------------------------------------------------------------------------
// DECLINE - admin marks a pending lead as declined so they stop appearing in
// the activation queue. No email is sent, no subscription is created.
// Looks up by email; finds the most recent row whose status is neither
// already 'activated' nor already 'declined', and sets status='declined'.
// -----------------------------------------------------------------------------
function handleDecline(payload) {
  // Row identification is timestamp-first, email-fallback.
  // Timestamp is the only field that's guaranteed unique even for leads with
  // no email (e.g. "Newsletter only" rows or stale blank rows) - pre-fix
  // those rows could never be declined because the only matcher was email.
  const email     = String(payload.email     || '').toLowerCase().trim();
  const timestamp = String(payload.timestamp || '').trim();

  if (!email && !timestamp) return errorResponse('No email or timestamp provided');

  // Normalize both sides to ISO strings so a Date in the sheet matches the
  // string the frontend sends back.
  function tsString(v) {
    if (v instanceof Date) return v.toISOString();
    const s = String(v || '').trim();
    // Some legacy rows store the timestamp without milliseconds; normalize
    // via Date parsing where possible so the comparison is canonical.
    const d = new Date(s);
    return isNaN(d.getTime()) ? s : d.toISOString();
  }

  const targetTs = timestamp ? tsString(timestamp) : '';

  const leadsSheet = getSheet('leads');
  const leadsData  = leadsSheet.getDataRange().getValues();
  let updated = false;

  // Pass 1: exact timestamp match (works for empty-email rows too)
  if (targetTs) {
    for (let i = leadsData.length - 1; i >= 1; i--) {
      const rowTs     = tsString(leadsData[i][0]);
      const rowStatus = String(leadsData[i][6] || '').toLowerCase();
      if (rowTs === targetTs && rowStatus !== 'activated' && rowStatus !== 'declined') {
        leadsSheet.getRange(i + 1, 7).setValue('declined');
        updated = true;
        break;
      }
    }
  }

  // Pass 2 (fallback): email match - legacy behaviour for clients that
  // haven't been updated to send timestamp yet.
  if (!updated && email) {
    for (let i = leadsData.length - 1; i >= 1; i--) {
      const rowEmail  = String(leadsData[i][2] || '').toLowerCase().trim();
      const rowStatus = String(leadsData[i][6] || '').toLowerCase();
      if (rowEmail === email && rowStatus !== 'activated' && rowStatus !== 'declined') {
        leadsSheet.getRange(i + 1, 7).setValue('declined');
        updated = true;
        break;
      }
    }
  }

  if (!updated) return errorResponse('No pending lead found to decline');

  return ContentService.createTextOutput(JSON.stringify({
    status:  'ok',
    message: 'Lead declined'
  })).setMimeType(ContentService.MimeType.JSON);
}

function handleGetLeads() {
  const sheet = getSheet('leads');
  const data  = sheet.getDataRange().getValues();
  const leads = [];

  for (let i = 1; i < data.length; i++) {
    leads.push({
      timestamp:       data[i][0],
      name:            data[i][1],
      email:           data[i][2],
      phone:           data[i][3],
      strategy:        data[i][4],
      price:           data[i][5],
      status:          data[i][6] || 'pending',
      // V5.0: surface duration_months (col H) + agreement_pdf (col I) so the
      // admin's Activate modal can pre-select the duration the customer
      // chose at signup. Falls back to 1 if the column is empty (legacy rows).
      duration_months: parseInt(data[i][7], 10) || 1,
      agreement_pdf:   data[i][8] || ''
    });
  }

  // Most recent first
  leads.reverse();

  return ContentService.createTextOutput(JSON.stringify({
    status: 'ok',
    leads: leads
  })).setMimeType(ContentService.MimeType.JSON);
}

function handleGetStocks(token) {
  if (!token) {
    return errorResponse('No token provided');
  }

  // Find subscription by token
  const subSheet = getSheet('subscriptions');
  const subData = subSheet.getDataRange().getValues();
  let subscription = null;

  for (let i = 1; i < subData.length; i++) {
    if (subData[i][0] === token) {
      subscription = {
        token: subData[i][0],
        email: subData[i][1],
        name: subData[i][2],
        phone: subData[i][3],
        strategy: subData[i][4],
        run_id: subData[i][5],
        subscribed_at: subData[i][6],
        expires_at: subData[i][7],
        payment_id: subData[i][8],
        status: subData[i][9],
        duration_months: parseInt(subData[i][10], 10) || 1
      };
      break;
    }
  }

  if (!subscription) {
    return errorResponse('Subscription not found');
  }

  // Check if expired
  const expiryDate = new Date(subscription.expires_at);
  if (expiryDate < new Date()) {
    return errorResponse('Subscription has expired');
  }

  // Check if active
  if (subscription.status !== 'active') {
    return errorResponse('Subscription is not active');
  }

  // Which run to serve:
  //  - MONTHLY subscribers (duration 1 month) are LOCKED to the run pinned at
  //    signup. To receive a newer monthly rebalance they renew, and each
  //    renewal creates a fresh subscription row pinned to that month's run.
  //  - NON-MONTHLY subscribers (3/6/12-month) receive the LATEST rebalance for
  //    the life of their subscription (they paid for ongoing signals and are
  //    emailed on each rebalance - see notifyRebalance()).
  // Fallback: if a monthly sub's stored run_id is missing or a 'default_run_*'
  // placeholder, fall back to the latest run so the dashboard isn't empty.
  let pinnedRunId;
  if ((subscription.duration_months || 1) > 1) {
    pinnedRunId = findLatestRunId(subscription.strategy);
  } else {
    pinnedRunId = subscription.run_id;
    if (!pinnedRunId || String(pinnedRunId).indexOf('default_run_') === 0) {
      pinnedRunId = findLatestRunId(subscription.strategy);
    }
  }
  subscription.run_id = pinnedRunId;

  const runSheet = getSheet('strategy_runs');
  const runData = runSheet.getDataRange().getValues();
  const stocks = [];

  for (let i = 1; i < runData.length; i++) {
    // Filter by BOTH run_id AND strategy - guards against run_id collisions
    // where multiple strategies share the same timestamp-based id.
    if (runData[i][0] === pinnedRunId && runData[i][2] === subscription.strategy) {
      stocks.push({
        ticker: runData[i][3],
        yahoo_ticker: runData[i][4],
        company_name: runData[i][5],
        industry: runData[i][6],
        recommended_price: parseFloat(runData[i][7]) || 0,
        weight_pct: parseFloat(runData[i][8]) || 0
      });
    }
  }

  return ContentService.createTextOutput(JSON.stringify({
    status: 'ok',
    subscription: subscription,
    stocks: stocks
  })).setMimeType(ContentService.MimeType.JSON);
}

function handleGetPrices(tickers) {
  if (!tickers) {
    return errorResponse('No tickers provided');
  }

  const tickerArray = tickers.split(',').map(t => t.trim()).filter(t => t);
  const prices = {};

  tickerArray.forEach(function(ticker) {
    try {
      const url = 'https://query1.finance.yahoo.com/v8/finance/chart/' + ticker + '?interval=1d&range=1d';
      const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });

      if (response.getResponseCode() === 200) {
        const data = JSON.parse(response.getContentText());

        if (data.chart && data.chart.result && data.chart.result.length > 0) {
          const result = data.chart.result[0];
          const quote = result.meta;

          if (result.timestamp && result.close && result.close.length > 0) {
            const lastClose = result.close[result.close.length - 1];
            const prevClose = quote.previousClose || lastClose;
            const change = ((lastClose - prevClose) / prevClose) * 100;

            prices[ticker] = {
              price: lastClose,
              prev_close: prevClose,
              change_pct: change
            };
          }
        }
      }
    } catch (err) {
      Logger.log('Error fetching ' + ticker + ': ' + err);
    }
  });

  return ContentService.createTextOutput(JSON.stringify({
    status: 'ok',
    prices: prices
  })).setMimeType(ContentService.MimeType.JSON);
}

function handleRecover(email, phone) {
  const emailClean = (email || '').toLowerCase().trim();
  const phoneClean = (phone || '').replace(/\D/g, '').slice(-10); // last 10 digits

  if (!emailClean && !phoneClean) {
    return errorResponse('Please provide your subscription email address or phone number');
  }

  // Find most recent active subscription matching email OR phone
  const subSheet = getSheet('subscriptions');
  const subData = subSheet.getDataRange().getValues();
  let latestSubscription = null;
  let latestDate = null;

  for (let i = 1; i < subData.length; i++) {
    if (subData[i][9] !== 'active') continue;

    const rowEmail = (subData[i][1] || '').toLowerCase().trim();
    const rowPhone = (subData[i][3] || '').toString().replace(/\D/g, '').slice(-10);

    const emailMatch = emailClean && rowEmail === emailClean;
    const phoneMatch = phoneClean && rowPhone === phoneClean;

    if (emailMatch || phoneMatch) {
      const subDate = new Date(subData[i][6]);
      if (!latestDate || subDate > latestDate) {
        latestDate = subDate;
        latestSubscription = {
          token:      subData[i][0],
          email:      subData[i][1],
          name:       subData[i][2],
          phone:      subData[i][3],
          expires_at: subData[i][7]
        };
      }
    }
  }

  if (!latestSubscription) {
    return errorResponse('No active subscription found. Please check your email or phone number.');
  }

  // Check if expired
  const expiryDate = new Date(latestSubscription.expires_at);
  if (expiryDate < new Date()) {
    return errorResponse('Your subscription has expired. Please renew to access your dashboard.');
  }

  // Send recovery email. The dashboard URL is delivered ONLY via this email so
  // an attacker who knows just the phone number (and not the inbox) can't
  // exfiltrate the link by hitting the API. Pre-fix, the URL was also returned
  // in the JSON response, which leaked it to anyone who could guess phone or
  // email.
  const dashboardUrl = getBaseUrl() + '/dashboard.html?token=' + latestSubscription.token;
  sendRecoveryEmail(latestSubscription.email, latestSubscription.name, dashboardUrl);

  // Mask the email partially so the UI can confirm where the link went,
  // without disclosing the full address to a guessing attacker.
  const fullEmail = String(latestSubscription.email || '');
  let maskedEmail = '';
  if (fullEmail.includes('@')) {
    const [local, domain] = fullEmail.split('@');
    const localMasked = local.length <= 2
      ? local[0] + '*'
      : local[0] + '*'.repeat(Math.max(1, local.length - 2)) + local.slice(-1);
    maskedEmail = localMasked + '@' + domain;
  }

  return ContentService.createTextOutput(JSON.stringify({
    status: 'ok',
    masked_email: maskedEmail,
    message: 'Recovery link sent to your email'
  })).setMimeType(ContentService.MimeType.JSON);
}

// -----------------------------------------------------------------------------
// OTP LOGIN HANDLERS
// -----------------------------------------------------------------------------

function handleRequestOTP(email) {
  const emailClean = (email || '').toLowerCase().trim();
  if (!emailClean) return errorResponse('Please provide an email address.');

  // Check if any active subscription exists for this email
  const subSheet = getSheet('subscriptions');
  const subData  = subSheet.getDataRange().getValues();
  let found = false;
  for (let i = 1; i < subData.length; i++) {
    if ((subData[i][1] || '').toLowerCase().trim() === emailClean) { found = true; break; }
  }
  if (!found) {
    return errorResponse('No subscriptions found for this email. Please subscribe to a strategy first, or check the email you used when subscribing.');
  }

  // Generate 6-digit OTP and store with 10-min expiry in Script Properties
  const otp = Math.floor(100000 + Math.random() * 900000).toString();
  const expiry = new Date(Date.now() + 10 * 60 * 1000).toISOString();
  const key = 'otp_' + emailClean.replace(/[^a-z0-9]/g, '_');
  // `attempts` caps brute-force guessing within the 10-min window - a 6-digit
  // code is only 10^6 wide, so without a cap it is guessable by a script.
  PropertiesService.getScriptProperties().setProperty(key, JSON.stringify({ otp, expiry, attempts: 0 }));

  // Email the OTP
  sendOTPEmail(emailClean, otp);

  return ContentService.createTextOutput(JSON.stringify({
    status: 'ok',
    message: 'OTP sent'
  })).setMimeType(ContentService.MimeType.JSON);
}

function handleVerifyOTP(email, otp) {
  const emailClean = (email || '').toLowerCase().trim();
  const otpClean   = (otp   || '').trim();
  if (!emailClean || !otpClean) return errorResponse('Email and OTP are required.');

  const key = 'otp_' + emailClean.replace(/[^a-z0-9]/g, '_');
  const stored = PropertiesService.getScriptProperties().getProperty(key);
  if (!stored) return errorResponse('No code found for this email. Please request a new one.');

  let parsed;
  try { parsed = JSON.parse(stored); } catch(e) { return errorResponse('Invalid code. Please request a new one.'); }

  // Check expiry
  if (new Date(parsed.expiry) < new Date()) {
    PropertiesService.getScriptProperties().deleteProperty(key);
    return errorResponse('This code has expired. Please request a new one.');
  }

  // Brute-force guard: after 5 wrong tries, burn the code so the attacker must
  // request a fresh one (which re-emails the legitimate owner, surfacing abuse).
  const attempts = Number(parsed.attempts || 0);
  if (attempts >= 5) {
    PropertiesService.getScriptProperties().deleteProperty(key);
    return errorResponse('Too many incorrect attempts. Please request a new code.');
  }

  // Check OTP value
  if (parsed.otp !== otpClean) {
    parsed.attempts = attempts + 1;
    PropertiesService.getScriptProperties().setProperty(key, JSON.stringify(parsed));
    return errorResponse('Incorrect code. Please try again.');
  }

  // OTP valid - delete it so it can't be reused
  PropertiesService.getScriptProperties().deleteProperty(key);

  // Return all subscriptions for this email.
  // Recompute `status` from `expires_at` so subs past their 30-day window
  // are reported as 'expired' to the UI, instead of inheriting the stale
  // 'active' value written at creation time. login.html relies on this to
  // grey out expired entries.
  const subSheet = getSheet('subscriptions');
  const subData  = subSheet.getDataRange().getValues();
  const subscriptions = [];
  const nowMs = Date.now();
  for (let i = 1; i < subData.length; i++) {
    if ((subData[i][1] || '').toLowerCase().trim() !== emailClean) continue;
    const storedStatus = String(subData[i][9] || '').toLowerCase().trim();
    const expiryMs     = subData[i][7] ? new Date(subData[i][7]).getTime() : 0;
    let liveStatus;
    if (storedStatus === 'cancelled' || storedStatus === 'inactive') {
      liveStatus = storedStatus;
    } else if (expiryMs && expiryMs < nowMs) {
      liveStatus = 'expired';
    } else {
      liveStatus = storedStatus || 'active';
    }
    subscriptions.push({
      token:      subData[i][0],
      email:      subData[i][1],
      name:       subData[i][2],
      strategy:   subData[i][4],
      expires_at: subData[i][7],
      status:     liveStatus
    });
  }
  // Most recent first
  subscriptions.reverse();

  return ContentService.createTextOutput(JSON.stringify({
    status:        'ok',
    subscriptions: subscriptions
  })).setMimeType(ContentService.MimeType.JSON);
}

function sendOTPEmail(email, otp) {
  const subject = 'Your MindForge Capital sign-in code: ' + otp;
  const htmlBody = `<!DOCTYPE html>
<html>
<head><meta charset="UTF-8">
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;background:#f0f5ff;color:#0c1831;margin:0;padding:20px;}
  .container{max-width:480px;margin:0 auto;background:#fff;border:1px solid #dbeafe;border-radius:16px;overflow:hidden;}
  .header{background:linear-gradient(135deg,#1a50d8,#2563eb);padding:32px 24px;text-align:center;}
  .header h1{margin:0;font-size:22px;font-weight:700;color:#fff;letter-spacing:-.5px;}
  .header p{margin:6px 0 0;color:rgba(255,255,255,.8);font-size:13px;}
  .content{padding:36px 32px;}
  .otp-box{background:#f0f5ff;border:2px solid #dbeafe;border-radius:12px;text-align:center;padding:24px;margin:20px 0;}
  .otp-code{font-family:-apple-system,BlinkMacSystemFont,'SF Pro Display',Helvetica,Arial,sans-serif;font-size:42px;font-weight:800;letter-spacing:.18em;color:#1a50d8;}
  .otp-note{font-size:12px;color:#64748b;margin-top:8px;}
  p{font-size:14px;color:#475569;line-height:1.7;margin:10px 0;}
  .footer{background:#f8fafc;padding:20px;text-align:center;font-size:11px;color:#94a3b8;border-top:1px solid #e2e8f0;}
</style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>MindForge Capital</h1>
      <p>Sign-in verification</p>
    </div>
    <div class="content">
      <p>Your one-time sign-in code is:</p>
      <div class="otp-box">
        <div class="otp-code">` + otp + `</div>
        <div class="otp-note">Expires in 10 minutes</div>
      </div>
      <p>Enter this code on the sign-in page to access your dashboard. If you didn't request this, you can safely ignore this email.</p>
      <p style="font-size:12px;color:#94a3b8;margin-top:20px;">Do not share this code with anyone.</p>
    </div>
    <div class="footer">
      &copy; 2026 MindForge Capital &middot;
      <a href="https://mindforgecapital.com" style="color:#1a50d8;text-decoration:none;">mindforgecapital.com</a>
    </div>
  </div>
</body>
</html>`;

  const plainBody =
    'Your MindForge Capital sign-in code is: ' + otp + '\n\n' +
    'This code expires in 10 minutes.\n\n' +
    'If you didn\'t request this, please ignore this email.\n\n' +
    '-- MindForge Capital\nhttps://mindforgecapital.com';

  try {
    GmailApp.sendEmail(email, subject, plainBody, {
      htmlBody: htmlBody,
      name: 'MindForge Capital',
      replyTo: 'sagar.shekhawath@mindforgecapital.com'
    });
  } catch(err) {
    Logger.log('OTP email error: ' + err);
  }
}

// -----------------------------------------------------------------------------
// HELPER FUNCTIONS
// -----------------------------------------------------------------------------

function getSheet(sheetName) {
  const ss = SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('SHEET_ID'));
  if (!ss) {
    throw new Error('Google Sheet not found. Set SHEET_ID in Script Properties.');
  }
  return ss.getSheetByName(sheetName);
}

function findLatestRunId(strategy) {
  const sheet = getSheet('strategy_runs');
  const data = sheet.getDataRange().getValues();
  let latestRunId = null;
  let latestTime = null;

  for (let i = 1; i < data.length; i++) {
    if (data[i][2] === strategy) {
      const runTime = new Date(data[i][1]);
      if (!latestTime || runTime > latestTime) {
        latestTime = runTime;
        latestRunId = data[i][0];
      }
    }
  }

  return latestRunId || 'default_run_' + strategy;
}

function generateToken() {
  return 'MFC' + Utilities.getUuid().replace(/-/g, '').substr(0, 20);
}

function getBaseUrl() {
  return 'https://mindforgecapital.com';
}

function errorResponse(error) {
  return ContentService.createTextOutput(JSON.stringify({
    error: error
  })).setMimeType(ContentService.MimeType.JSON);
}

// -----------------------------------------------------------------------------
// EMAIL FUNCTIONS
// -----------------------------------------------------------------------------
//
// Spam / deliverability notes:
//   1. All outbound emails now include a plain-text body (the 3rd arg to
//      GmailApp.sendEmail). HTML-only emails are a major spam signal.
//   2. A `replyTo` address is set so inbox providers see a valid return path.
//   3. Visible Unsubscribe links are included in every footer - the single
//      biggest factor for Gmail / Outlook bulk-sender reputation since Feb 2024.
//   4. Subject lines no longer use (check) / (party) / (bell) emojis, which heuristic spam
//      filters penalise on transactional mail.
//
// Things still to do OUTSIDE this script (Apps Script alone cannot fix these):
//   a. Add an SPF record for mindforgecapital.com that includes _spf.google.com
//      (e.g. "v=spf1 include:_spf.google.com ~all")
//   b. Enable DKIM signing for mindforgecapital.com in Google Workspace Admin
//      (Apps -> Google Workspace -> Gmail -> Authenticate email).
//   c. Add a DMARC record: "v=DMARC1; p=quarantine; rua=mailto:postmaster@mindforgecapital.com"
//   d. Switch sender to a branded Workspace address (e.g. sagar.shekhawath@mindforgecapital.com)
//      instead of a @gmail.com account - Gmail's bulk-sender rules require
//      domain-aligned From addresses for best deliverability.
//   e. Warm the sender: start with low volume and ramp slowly.
//
// -----------------------------------------------------------------------------

function sendSubscriptionEmail(email, name, strategy, dashboardUrl, expiresAt) {
  const subject = 'Your MindForge Capital dashboard access';

  // V5.1: rebuilt on the LIGHT brand theme to match the website + the
  // newer sendActivationEmail / sendRecoveryEmail templates. All button
  // styles inline so Gmail/Outlook never strip the white-on-blue text.
  const htmlBody = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        body { font-family: 'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f0f5ff; color: #0c1831; margin: 0; padding: 20px; }
        .container { max-width: 600px; margin: 0 auto; background: #ffffff; border: 1px solid #dbeafe; border-radius: 16px; overflow: hidden; }
        .header { background: linear-gradient(135deg, #1a50d8 0%, #2563eb 50%, #0891b2 100%); padding: 40px 20px; text-align: center; }
        .header h1 { margin: 0; font-size: 26px; font-weight: 700; color: #ffffff; letter-spacing: -0.5px; }
        .header p { margin: 8px 0 0 0; color: rgba(255,255,255,0.85); font-size: 14px; }
        .content { padding: 40px 32px; }
        .content h2 { font-size: 20px; margin: 0 0 12px 0; color: #0c1831; }
        .content p { color: #475569; line-height: 1.7; margin: 12px 0; font-size: 15px; }
        .btn-wrap { text-align: center; margin: 32px 0; }
        .details { background: #f0f5ff; border-left: 3px solid #1a50d8; padding: 16px 20px; margin: 24px 0; border-radius: 8px; }
        .details-row { display: flex; justify-content: space-between; margin: 6px 0; font-size: 14px; }
        .details-label { color: #64748b; }
        .details-value { color: #0c1831; font-weight: 600; }
        .warning { background: #fee2e2; border-left: 3px solid #dc2626; padding: 12px 16px; margin: 16px 0; border-radius: 6px; font-size: 13px; color: #7f1d1d; }
        .footer { background: #f8fafc; padding: 24px; text-align: center; font-size: 11px; color: #94a3b8; border-top: 1px solid #e2e8f0; }
        .footer a { color: #1a50d8; text-decoration: none; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>MindForge Capital</h1>
          <p>Your dashboard is ready</p>
        </div>
        <div class="content">
          <h2>Welcome ` + (name || 'Investor') + `,</h2>
          <p>Your MindForge Capital subscription is now active. Your personalised dashboard is ready to use.</p>

          <div class="btn-wrap" style="text-align:center;margin:32px 0;">
            <a href="` + dashboardUrl + `"
               style="display:inline-block;background:linear-gradient(135deg,#1a50d8 0%,#2563eb 50%,#0891b2 100%);background-color:#1a50d8;color:#ffffff !important;padding:14px 36px;border-radius:10px;text-decoration:none;font-weight:700;font-size:15px;letter-spacing:.02em;box-shadow:0 6px 18px -8px rgba(26,80,216,.55);">
              <span style="color:#ffffff !important;">Access My Dashboard &nbsp;&#8594;</span>
            </a>
          </div>

          <div class="details">
            <div class="details-row">
              <span class="details-label">Strategy:&nbsp;</span>
              <span class="details-value">` + strategy + `</span>
            </div>
            <div class="details-row">
              <span class="details-label">Valid Until:&nbsp;</span>
              <span class="details-value">` + expiresAt.toLocaleDateString('en-IN', {day:'numeric',month:'long',year:'numeric'}) + `</span>
            </div>
          </div>

          <p>Your dashboard link is unique and personal. <strong>Do not share it with others.</strong> If you ever lose it, recover it at the <a href="https://mindforgecapital.com/recover.html" style="color:#1a50d8;">recovery page</a>.</p>

          <div class="warning">
            <strong>Important:</strong> This portfolio is for educational purposes. Past performance does not guarantee future results. Always consult with a financial advisor before making investment decisions.
          </div>
        </div>
        <div class="footer">
          <p><strong>SEBI Disclaimer:</strong> MindForge Capital provides quantitative research and educational information only. Research is published under SEBI-registered Research Analyst Sagar Shekhawath. This is not personalised investment advice. Trade at your own risk.</p>
          <p style="margin-top: 12px;">&copy; 2026 MindForge Capital &middot; <a href="https://mindforgecapital.com">mindforgecapital.com</a><br><a href="mailto:sagar.shekhawath@mindforgecapital.com?subject=unsubscribe">Unsubscribe</a> &middot; <a href="https://mindforgecapital.com/privacy.html">Privacy</a></p>
        </div>
      </div>
    </body>
    </html>
  `;

  const plainBody =
    'Hello ' + name + ',\n\n' +
    'Your MindForge Capital subscription is active.\n\n' +
    'Dashboard: ' + dashboardUrl + '\n' +
    'Strategy: ' + strategy + '\n' +
    'Valid until: ' + expiresAt.toLocaleDateString('en-IN') + '\n\n' +
    'Your dashboard link is unique -- please do not share it. If you lose it, recover it at https://mindforgecapital.com/recover.html\n\n' +
    'SEBI Disclaimer: MindForge Capital provides quantitative research and educational information only. Research is published under SEBI-registered Research Analyst Sagar Shekhawath. This is not personalised investment advice.\n\n' +
    'To unsubscribe, reply with "unsubscribe" in the subject line.\n\n' +
    '-- MindForge Capital\n' +
    'https://mindforgecapital.com';

  try {
    GmailApp.sendEmail(email, subject, plainBody, {
      htmlBody: htmlBody,
      name: 'MindForge Capital',
      replyTo: 'sagar.shekhawath@mindforgecapital.com'
    });
  } catch (err) {
    Logger.log('Email send error: ' + err);
  }
}

function sendRecoveryEmail(email, name, dashboardUrl) {
  const subject = 'Your MindForge Capital dashboard link';

  // V5.1: rebuilt on the LIGHT brand theme used by sendActivationEmail —
  // matches the website (background #f0f5ff, brand blue gradient header).
  // All button styles inline so Gmail/Outlook don't strip white-on-blue text.
  const htmlBody = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        body { font-family: 'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f0f5ff; color: #0c1831; margin: 0; padding: 20px; }
        .container { max-width: 600px; margin: 0 auto; background: #ffffff; border: 1px solid #dbeafe; border-radius: 16px; overflow: hidden; }
        .header { background: linear-gradient(135deg, #1a50d8 0%, #2563eb 50%, #0891b2 100%); padding: 40px 20px; text-align: center; }
        .header h1 { margin: 0; font-size: 26px; font-weight: 700; color: #ffffff; letter-spacing: -0.5px; }
        .header p { margin: 8px 0 0 0; color: rgba(255,255,255,0.85); font-size: 14px; }
        .content { padding: 40px 32px; }
        .content h2 { font-size: 20px; margin: 0 0 12px 0; color: #0c1831; }
        .content p { color: #475569; line-height: 1.7; margin: 12px 0; font-size: 15px; }
        .btn-wrap { text-align: center; margin: 32px 0; }
        .note { background: #f0f5ff; border-left: 3px solid #1a50d8; padding: 12px 16px; margin: 20px 0; border-radius: 6px; font-size: 13px; color: #475569; }
        .footer { background: #f8fafc; padding: 24px; text-align: center; font-size: 11px; color: #94a3b8; border-top: 1px solid #e2e8f0; }
        .footer a { color: #1a50d8; text-decoration: none; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>MindForge Capital</h1>
          <p>Dashboard link recovery</p>
        </div>
        <div class="content">
          <h2>Hello ` + (name || 'Investor') + `,</h2>
          <p>We received your request to recover your dashboard link. Your personalised dashboard is still active and ready to use.</p>

          <div class="btn-wrap" style="text-align:center;margin:32px 0;">
            <a href="` + dashboardUrl + `"
               style="display:inline-block;background:linear-gradient(135deg,#1a50d8 0%,#2563eb 50%,#0891b2 100%);background-color:#1a50d8;color:#ffffff !important;padding:14px 36px;border-radius:10px;text-decoration:none;font-weight:700;font-size:15px;letter-spacing:.02em;box-shadow:0 6px 18px -8px rgba(26,80,216,.55);">
              <span style="color:#ffffff !important;">Access My Dashboard &nbsp;&#8594;</span>
            </a>
          </div>

          <div class="note">
            <strong>Keep this link private.</strong> Your dashboard link is unique to you — do not share it. If you did not request this email, you can safely ignore it; your subscription is secure.
          </div>
        </div>
        <div class="footer">
          <p>&copy; 2026 MindForge Capital &middot; <a href="https://mindforgecapital.com">mindforgecapital.com</a><br><a href="mailto:sagar.shekhawath@mindforgecapital.com?subject=unsubscribe">Unsubscribe</a> &middot; <a href="https://mindforgecapital.com/privacy.html">Privacy</a></p>
        </div>
      </div>
    </body>
    </html>
  `;

  const plainBody =
    'Hello ' + name + ',\n\n' +
    'You requested a dashboard link recovery. Your subscription is still active.\n\n' +
    'Dashboard: ' + dashboardUrl + '\n\n' +
    'If you did not request this, please ignore this email.\n\n' +
    'To unsubscribe, reply with "unsubscribe" in the subject line.\n\n' +
    '-- MindForge Capital\n' +
    'https://mindforgecapital.com';

  try {
    GmailApp.sendEmail(email, subject, plainBody, {
      htmlBody: htmlBody,
      name: 'MindForge Capital',
      replyTo: 'sagar.shekhawath@mindforgecapital.com'
    });
  } catch (err) {
    Logger.log('Recovery email send error: ' + err);
  }
}

function sendActivationEmail(email, name, strategy, dashboardUrl, expiresAt) {
  const subject = 'Your MindForge Capital dashboard is active';

  const htmlBody = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        body { font-family: 'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f0f5ff; color: #0c1831; margin: 0; padding: 20px; }
        .container { max-width: 600px; margin: 0 auto; background: #ffffff; border: 1px solid #dbeafe; border-radius: 16px; overflow: hidden; }
        .header { background: linear-gradient(135deg, #1a50d8 0%, #2563eb 100%); padding: 40px 20px; text-align: center; }
        .header h1 { margin: 0; font-size: 26px; font-weight: 700; color: #ffffff; letter-spacing: -0.5px; }
        .header p { margin: 8px 0 0 0; color: rgba(255,255,255,0.8); font-size: 14px; }
        .content { padding: 40px 32px; }
        .content h2 { font-size: 20px; margin: 0 0 12px 0; color: #0c1831; }
        .content p { color: #475569; line-height: 1.7; margin: 12px 0; font-size: 15px; }
        .btn-wrap { text-align: center; margin: 32px 0; }
        .btn { display: inline-block; background: #1a50d8; color: #ffffff !important; padding: 14px 36px; border-radius: 10px; text-decoration: none; font-weight: 700; font-size: 15px; letter-spacing: 0.01em; }
        .details { background: #f0f5ff; border-left: 3px solid #1a50d8; padding: 16px 20px; margin: 24px 0; border-radius: 8px; }
        .details-row { display: flex; justify-content: space-between; margin: 6px 0; font-size: 14px; }
        .details-label { color: #64748b; }
        .details-value { color: #0c1831; font-weight: 600; }
        .note { background: #fef9c3; border-left: 3px solid #eab308; padding: 12px 16px; margin: 20px 0; border-radius: 6px; font-size: 13px; color: #713f12; }
        .footer { background: #f8fafc; padding: 24px; text-align: center; font-size: 11px; color: #94a3b8; border-top: 1px solid #e2e8f0; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>MindForge Capital</h1>
          <p>Quant-powered investment strategies</p>
        </div>
        <div class="content">
          <h2>Welcome aboard, ` + (name || 'Investor') + `!</h2>
          <p>Your payment has been verified and your dashboard is now active. Click the button below to access your personalised strategy portfolio.</p>

          <div class="btn-wrap" style="text-align:center;margin:32px 0;">
            <!-- V5.1: inline button styles so Gmail/Outlook never strip the white text -->
            <a href="` + dashboardUrl + `"
               style="display:inline-block;background:linear-gradient(135deg,#1a50d8 0%,#2563eb 50%,#0891b2 100%);background-color:#1a50d8;color:#ffffff !important;padding:14px 36px;border-radius:10px;text-decoration:none;font-weight:700;font-size:15px;letter-spacing:.02em;box-shadow:0 6px 18px -8px rgba(26,80,216,.55);">
              <span style="color:#ffffff !important;">Open My Dashboard &nbsp;&#8594;</span>
            </a>
          </div>

          <div class="details">
            <div class="details-row">
              <span class="details-label">Strategy:&nbsp;</span>
              <span class="details-value">` + strategy + `</span>
            </div>
            <div class="details-row">
              <span class="details-label">Valid Until:&nbsp;</span>
              <span class="details-value">` + expiresAt.toLocaleDateString('en-IN', {day:'numeric',month:'long',year:'numeric'}) + `</span>
            </div>
          </div>

          <div class="note">
            <strong>Keep this link private.</strong> Your dashboard link is unique to you - do not share it. If you ever lose it, use the <a href="https://mindforgecapital.com/recover.html">link recovery page</a>.
          </div>

          <p style="font-size:13px;color:#94a3b8;">
            <strong>SEBI Disclaimer:</strong> MindForge Capital provides quantitative research and educational information only and is not a SEBI-registered investment advisor. Research is published under SEBI-registered Research Analyst Sagar Shekhawath. This is not personalised investment advice. Past performance does not guarantee future results. Trade at your own risk.
          </p>
        </div>
        <div class="footer">
          <p>&copy; 2026 MindForge Capital &middot; <a href="https://mindforgecapital.com" style="color:#1a50d8;text-decoration:none;">mindforgecapital.com</a><br><a href="mailto:sagar.shekhawath@mindforgecapital.com?subject=unsubscribe" style="color:#94a3b8;text-decoration:none;">Unsubscribe</a> &middot; <a href="https://mindforgecapital.com/privacy.html" style="color:#94a3b8;text-decoration:none;">Privacy</a></p>
        </div>
      </div>
    </body>
    </html>
  `;

  const plainBody =
    'Welcome aboard, ' + (name || 'Investor') + '!\n\n' +
    'Your payment has been verified and your MindForge Capital dashboard is now active.\n\n' +
    'Dashboard: ' + dashboardUrl + '\n' +
    'Strategy: ' + strategy + '\n' +
    'Valid until: ' + expiresAt.toLocaleDateString('en-IN', {day:'numeric',month:'long',year:'numeric'}) + '\n\n' +
    'Keep this link private. It is unique to you. If you ever lose it, use the recovery page at https://mindforgecapital.com/recover.html\n\n' +
    'SEBI Disclaimer: MindForge Capital provides quantitative research and educational information only and is not a SEBI-registered investment advisor. Research is published under SEBI-registered Research Analyst Sagar Shekhawath. This is not personalised investment advice. Past performance does not guarantee future results.\n\n' +
    'To unsubscribe, reply with "unsubscribe" in the subject line.\n\n' +
    '-- MindForge Capital\n' +
    'https://mindforgecapital.com';

  try {
    GmailApp.sendEmail(email, subject, plainBody, {
      htmlBody: htmlBody,
      name: 'MindForge Capital',
      replyTo: 'sagar.shekhawath@mindforgecapital.com'
    });
  } catch (err) {
    Logger.log('Activation email send error: ' + err);
  }
}

function sendAdminLeadNotification(name, email, phone, strategy, price) {
  const adminEmail = 'sagar.shekhawath@mindforgecapital.com';
  const subject = 'New MindForge lead: ' + name + ' (' + strategy + ')';

  const body = 'New lead registered on MindForge Capital.\n\n'
    + 'Name:     ' + name     + '\n'
    + 'Email:    ' + email    + '\n'
    + 'Phone:    ' + phone    + '\n'
    + 'Strategy: ' + strategy + '\n'
    + 'Price:    ' + price    + '\n\n'
    + 'Log in to the admin panel to review and activate:\n'
    + 'https://mindforgecapital.com/admin.html';

  const htmlBody = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f8fafc; color: #0c1831; margin: 0; padding: 20px; }
    .container { max-width: 520px; margin: 0 auto; background: #ffffff; border: 1px solid #dbeafe; border-radius: 12px; overflow: hidden; }
    .header { background: linear-gradient(135deg, #1a50d8 0%, #2563eb 100%); padding: 28px 24px; }
    .header h1 { margin: 0; font-size: 20px; font-weight: 700; color: #ffffff; }
    .header p { margin: 4px 0 0; color: rgba(255,255,255,0.8); font-size: 13px; }
    .content { padding: 28px 28px; }
    .row { display: flex; padding: 8px 0; border-bottom: 1px solid #f1f5f9; font-size: 14px; }
    .label { width: 90px; color: #64748b; flex-shrink: 0; }
    .value { color: #0c1831; font-weight: 600; }
    .btn-wrap { text-align: center; margin: 28px 0 0; }
    .btn { display: inline-block; background: #1a50d8; color: #ffffff; padding: 12px 28px; border-radius: 8px; text-decoration: none; font-weight: 700; font-size: 14px; }
    .footer { background: #f8fafc; padding: 16px 24px; text-align: center; font-size: 11px; color: #94a3b8; border-top: 1px solid #e2e8f0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>New Lead Registered</h1>
      <p>MindForge Capital - Admin Notification</p>
    </div>
    <div class="content">
      <div class="row"><span class="label">Name</span><span class="value">` + name + `</span></div>
      <div class="row"><span class="label">Email</span><span class="value">` + email + `</span></div>
      <div class="row"><span class="label">Phone</span><span class="value">` + phone + `</span></div>
      <div class="row"><span class="label">Strategy</span><span class="value">` + strategy + `</span></div>
      <div class="row"><span class="label">Price</span><span class="value">` + price + `</span></div>
      <div class="btn-wrap" style="text-align:center;margin:28px 0 0;">
        <!-- V5.1: inline styles so Gmail/Outlook never strip the white text colour -->
        <a href="https://mindforgecapital.com/admin.html"
           style="display:inline-block;background:linear-gradient(135deg,#1a50d8 0%,#2563eb 50%,#0891b2 100%);background-color:#1a50d8;color:#ffffff !important;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:700;font-size:14px;letter-spacing:.02em;box-shadow:0 6px 16px -6px rgba(26,80,216,.55);mso-padding-alt:0;">
          <span style="color:#ffffff !important;">Open Admin Panel &nbsp;&#8594;</span>
        </a>
      </div>
    </div>
    <div class="footer">&copy; 2026 MindForge Capital</div>
  </div>
</body>
</html>`;

  try {
    GmailApp.sendEmail(adminEmail, subject, body, {
      htmlBody: htmlBody,
      name: 'MindForge Capital Alerts',
      replyTo: 'sagar.shekhawath@mindforgecapital.com'
    });
  } catch (err) {
    Logger.log('Admin notification email error: ' + err);
  }
}

// -----------------------------------------------------------------------------
// SETUP UTILITY (run once to initialize)
// -----------------------------------------------------------------------------

function setupSheetId() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  PropertiesService.getScriptProperties().setProperty('SHEET_ID', ss.getId());
  Logger.log('Sheet ID set: ' + ss.getId());
  Logger.log('Now deploy this as a Web App (Deploy -> New Deployment -> Web App)');
}

// -----------------------------------------------------------------------------
// AGREEMENT PDF (item 12) + REBALANCE NOTIFICATIONS (item 11)
// -----------------------------------------------------------------------------

function escapeHtmlGs(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Drive folder (next to the backend Sheet) that stores signed-agreement PDFs.
function getOrCreateAgreementsFolder() {
  var parent;
  try {
    var ssId = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
    var parents = DriveApp.getFileById(ssId).getParents();
    parent = parents.hasNext() ? parents.next() : DriveApp.getRootFolder();
  } catch (e) {
    parent = DriveApp.getRootFolder();
  }
  var existing = parent.getFoldersByName('MindForge Agreements');
  return existing.hasNext() ? existing.next() : parent.createFolder('MindForge Agreements');
}

// Item 12: generate the subscriber's T&C agreement as a PDF, store in Drive, return URL.
function generateAgreementPdf(payload, ts) {
  var name = payload.name || 'Subscriber';
  var html =
    '<html><body style="font-family:Arial,Helvetica,sans-serif;padding:36px;color:#0c1831;">' +
    '<h2 style="margin:0 0 4px;">MindForge Capital - Subscription Agreement</h2>' +
    '<p style="color:#64748b;margin:0 0 20px;font-size:12px;">Recorded ' + escapeHtmlGs(ts) + '</p>' +
    '<table cellpadding="8" style="font-size:13px;border-collapse:collapse;width:100%;">' +
    '<tr><td style="width:140px;color:#64748b;">Name</td><td><b>'     + escapeHtmlGs(name) + '</b></td></tr>' +
    '<tr><td style="color:#64748b;">Email</td><td>'    + escapeHtmlGs(payload.email || '') + '</td></tr>' +
    '<tr><td style="color:#64748b;">Phone</td><td>'    + escapeHtmlGs(payload.phone || '') + '</td></tr>' +
    '<tr><td style="color:#64748b;">Strategy</td><td>' + escapeHtmlGs(payload.strategy || '') + '</td></tr>' +
    '<tr><td style="color:#64748b;">Plan</td><td>'     + escapeHtmlGs(payload.price || '') + '</td></tr>' +
    '</table>' +
    '<h3 style="margin-top:24px;">Acknowledgement</h3>' +
    '<p style="font-size:13px;line-height:1.6;">By submitting the registration form on mindforgecapital.com, the subscriber named above confirmed that they have read and agree to the MindForge Capital Terms &amp; Conditions, and acknowledge that they accept all investment risks, including the possible total loss of capital. Research is published by Sagar Shekhawath, a SEBI-registered Research Analyst. MindForge provides research only and is not an investment adviser, portfolio manager, or fiduciary. All investment decisions are the subscriber\'s own.</p>' +
    '<p style="margin-top:32px;font-size:11px;color:#94a3b8;">Generated automatically when the subscriber accepted the Terms &amp; Conditions checkbox. Timestamp: ' + escapeHtmlGs(ts) + '.</p>' +
    '</body></html>';
  var pdf = Utilities.newBlob(html, 'text/html', 'agreement.html').getAs('application/pdf');
  var folder = getOrCreateAgreementsFolder();
  var safe = (name + '_' + (payload.strategy || '') + '_' + ts).replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 80);
  var file = folder.createFile(pdf).setName('MFC_Agreement_' + safe + '.pdf');
  return file.getUrl();
}

// Item 11: email non-monthly active subscribers of a strategy that a new rebalance is live.
function notifyRebalance(strategy, runId) {
  var subSheet = getSheet('subscriptions');
  var data = subSheet.getDataRange().getValues();
  var now = Date.now();
  var count = 0;
  for (var i = 1; i < data.length; i++) {
    var sStrategy = data[i][4];
    var status    = String(data[i][9] || '').toLowerCase();
    var notify    = String(data[i][11] || '').toLowerCase();   // L: notify flag
    var expiresMs = data[i][7] ? new Date(data[i][7]).getTime() : 0;
    if (sStrategy === strategy && status === 'active' && notify === 'on' && expiresMs > now) {
      try {
        sendRebalanceEmail(data[i][1], data[i][2], strategy, getBaseUrl() + '/dashboard.html?token=' + data[i][0]);
        count++;
      } catch (e) {
        Logger.log('rebalance email failed for ' + data[i][1] + ': ' + e);
      }
    }
  }
  return count;
}

function sendRebalanceEmail(email, name, strategy, dashboardUrl) {
  if (!email) return;
  var subject = 'New ' + strategy + ' rebalance is live - MindForge Capital';
  var html = '<!DOCTYPE html><html><head><meta charset="UTF-8"></head>' +
    '<body style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif;background:#f0f5ff;color:#0c1831;margin:0;padding:20px;">' +
    '<div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #dbeafe;border-radius:14px;overflow:hidden;">' +
    '<div style="background:linear-gradient(135deg,#1a50d8,#2563eb);padding:28px 24px;"><h1 style="margin:0;font-size:20px;color:#fff;">MindForge Capital</h1><p style="margin:4px 0 0;color:rgba(255,255,255,.85);font-size:13px;">Monthly rebalance published</p></div>' +
    '<div style="padding:28px;">' +
    '<p style="font-size:15px;">Hello ' + escapeHtmlGs(name || 'Investor') + ',</p>' +
    '<p style="font-size:14px;color:#475569;line-height:1.6;">This month\'s <b>' + escapeHtmlGs(strategy) + '</b> rebalance is now live on your dashboard. As an active multi-month subscriber, your dashboard already reflects the latest picks - open it to review and place your orders.</p>' +
    '<div style="text-align:center;margin:28px 0;"><a href="' + dashboardUrl + '" style="display:inline-block;background:linear-gradient(135deg,#1a50d8 0%,#2563eb 50%,#0891b2 100%);background-color:#1a50d8;color:#ffffff !important;padding:14px 36px;border-radius:10px;text-decoration:none;font-weight:700;font-size:15px;letter-spacing:.02em;box-shadow:0 6px 18px -8px rgba(26,80,216,.55);"><span style="color:#ffffff !important;">Open My Dashboard &nbsp;&#8594;</span></a></div>' +
    '<p style="font-size:12px;color:#94a3b8;">SEBI Disclaimer: Research is published by Sagar Shekhawath, a SEBI-registered Research Analyst. This is not personalised investment advice. Past performance does not guarantee future results.</p>' +
    '</div>' +
    '<div style="background:#f8fafc;padding:18px;text-align:center;font-size:11px;color:#94a3b8;border-top:1px solid #e2e8f0;">&copy; 2026 MindForge Capital &middot; <a href="mailto:sagar.shekhawath@mindforgecapital.com?subject=unsubscribe" style="color:#94a3b8;">Unsubscribe</a></div>' +
    '</div></body></html>';
  var plain = 'Hello ' + (name || 'Investor') + ',\n\nThis month\'s ' + strategy + ' rebalance is live on your dashboard:\n' + dashboardUrl + '\n\nSEBI Disclaimer: Research is published by Sagar Shekhawath, a SEBI-registered Research Analyst. Not personalised investment advice.\n\nTo unsubscribe, reply with "unsubscribe".\n\n-- MindForge Capital\nhttps://mindforgecapital.com';
  GmailApp.sendEmail(email, subject, plain, { htmlBody: html, name: 'MindForge Capital', replyTo: 'sagar.shekhawath@mindforgecapital.com' });
}

// -----------------------------------------------------------------------------
// V5.2 #14 + #15 — Lifecycle email cron jobs
//
// These are designed to be invoked by Apps Script time-driven triggers
// (NOT by the doGet/doPost web endpoints). To wire them:
//   1. In Apps Script editor: Triggers (⏰ icon) → "Add Trigger"
//   2. cronRebalanceReminder    → Day timer, between 9am-10am, monthly trigger,
//                                 day-of-month = 28
//   3. cronWelcomeCheckin       → Day timer, between 9am-10am, daily trigger
//
// Both are idempotent within a single run by tagging the subscriptions sheet
// (col M = reminder_sent_ts, col N = checkin_sent_ts). If the column is empty
// or older than this calendar month, the email goes out; otherwise it's skipped.
// -----------------------------------------------------------------------------

// V5.2 #14: 3-day rebalance reminder — fire on the 28th of each month.
// Emails every ACTIVE subscriber that next monthly rebalance is in 3 days.
function cronRebalanceReminder() {
  var subSheet = getSheet('subscriptions');
  var data = subSheet.getDataRange().getValues();
  var now = Date.now();
  var nowMonth = new Date().toISOString().slice(0, 7); // "2026-05"
  var sent = 0;

  for (var i = 1; i < data.length; i++) {
    var token   = data[i][0];
    var email   = String(data[i][1] || '').trim();
    var name    = data[i][2];
    var strategy= data[i][4];
    var expiresMs = data[i][7] ? new Date(data[i][7]).getTime() : 0;
    var status  = String(data[i][9] || '').toLowerCase().trim();
    var lastSentRaw = data[i][12] || '';
    var lastSentMonth = lastSentRaw ? String(lastSentRaw).slice(0, 7) : '';

    if (!email) continue;
    if (status !== 'active') continue;
    if (expiresMs && expiresMs < now) continue;
    if (lastSentMonth === nowMonth) continue; // already sent this month

    try {
      sendReminderEmail(email, name, strategy, getBaseUrl() + '/dashboard.html?token=' + token);
      subSheet.getRange(i + 1, 13).setValue(new Date().toISOString()); // col M
      sent++;
    } catch (e) {
      Logger.log('cronRebalanceReminder: failed for ' + email + ' — ' + e);
    }
  }
  Logger.log('cronRebalanceReminder: sent ' + sent + ' reminders');
  return sent;
}

function sendReminderEmail(email, name, strategy, dashboardUrl) {
  var subject = strategy + ' rebalance in 3 days — MindForge Capital';
  var html = '<!DOCTYPE html><html><head><meta charset="UTF-8"></head>' +
    '<body style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif;background:#f0f5ff;color:#0c1831;margin:0;padding:20px;">' +
    '<div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #dbeafe;border-radius:14px;overflow:hidden;">' +
    '<div style="background:linear-gradient(135deg,#1a50d8,#2563eb,#0891b2);padding:28px 24px;"><h1 style="margin:0;font-size:20px;color:#fff;">MindForge Capital</h1><p style="margin:4px 0 0;color:rgba(255,255,255,.85);font-size:13px;">Rebalance reminder</p></div>' +
    '<div style="padding:28px;">' +
    '<p style="font-size:15px;">Hello ' + escapeHtmlGs(name || 'Investor') + ',</p>' +
    '<p style="font-size:14px;color:#475569;line-height:1.6;">Your next <b>' + escapeHtmlGs(strategy) + '</b> rebalance drops in <b>3 days</b> — on the 1st of next month. The model will publish a fresh set of picks; you\'ll get a separate email when they\'re live.</p>' +
    '<p style="font-size:14px;color:#475569;line-height:1.6;">In the meantime, you can review this month\'s portfolio on your dashboard:</p>' +
    '<div style="text-align:center;margin:28px 0;"><a href="' + dashboardUrl + '" style="display:inline-block;background:linear-gradient(135deg,#1a50d8 0%,#2563eb 50%,#0891b2 100%);background-color:#1a50d8;color:#ffffff !important;padding:14px 36px;border-radius:10px;text-decoration:none;font-weight:700;font-size:15px;letter-spacing:.02em;box-shadow:0 6px 18px -8px rgba(26,80,216,.55);"><span style="color:#ffffff !important;">Open My Dashboard &nbsp;&#8594;</span></a></div>' +
    '<p style="font-size:12px;color:#94a3b8;">SEBI Disclaimer: Research is published by Sagar Shekhawath, a SEBI-registered Research Analyst. Not personalised investment advice.</p>' +
    '</div>' +
    '<div style="background:#f8fafc;padding:18px;text-align:center;font-size:11px;color:#94a3b8;border-top:1px solid #e2e8f0;">&copy; 2026 MindForge Capital &middot; <a href="mailto:sagar.shekhawath@mindforgecapital.com?subject=unsubscribe" style="color:#94a3b8;">Unsubscribe</a></div>' +
    '</div></body></html>';
  var plain = 'Hello ' + (name || 'Investor') + ',\n\nYour ' + strategy + ' rebalance drops in 3 days — on the 1st of next month.\nReview this month\'s portfolio: ' + dashboardUrl + '\n\nSEBI Disclaimer: Research is published by Sagar Shekhawath, a SEBI-registered Research Analyst.\n\nTo unsubscribe, reply with "unsubscribe".\n\n-- MindForge Capital\nhttps://mindforgecapital.com';
  GmailApp.sendEmail(email, subject, plain, { htmlBody: html, name: 'MindForge Capital', replyTo: 'sagar.shekhawath@mindforgecapital.com' });
}

// V5.2 #15: 30-day welcome check-in — fires daily, picks subscribers whose
// subscribed_at is between 28 and 32 days ago and hasn't been checked-in yet.
function cronWelcomeCheckin() {
  var subSheet = getSheet('subscriptions');
  var data = subSheet.getDataRange().getValues();
  var now = Date.now();
  var sent = 0;

  for (var i = 1; i < data.length; i++) {
    var token        = data[i][0];
    var email        = String(data[i][1] || '').trim();
    var name         = data[i][2];
    var strategy     = data[i][4];
    var subbedMs     = data[i][6] ? new Date(data[i][6]).getTime() : 0;
    var status       = String(data[i][9] || '').toLowerCase().trim();
    var checkinSent  = data[i][13] || ''; // col N

    if (!email) continue;
    if (status !== 'active') continue;
    if (checkinSent) continue;             // already sent
    if (!subbedMs) continue;

    var ageDays = (now - subbedMs) / 86400000;
    if (ageDays < 28 || ageDays > 32) continue;

    try {
      sendCheckinEmail(email, name, strategy, getBaseUrl() + '/dashboard.html?token=' + token);
      subSheet.getRange(i + 1, 14).setValue(new Date().toISOString()); // col N
      sent++;
    } catch (e) {
      Logger.log('cronWelcomeCheckin: failed for ' + email + ' — ' + e);
    }
  }
  Logger.log('cronWelcomeCheckin: sent ' + sent + ' check-ins');
  return sent;
}

function sendCheckinEmail(email, name, strategy, dashboardUrl) {
  var renewUrl = 'https://wa.me/917601032082?text=' + encodeURIComponent(
    'Hi MindForge Capital — I want to renew my ' + strategy + ' subscription.'
  );
  var subject = 'How\'s it going with ' + strategy + '? — MindForge Capital';
  var html = '<!DOCTYPE html><html><head><meta charset="UTF-8"></head>' +
    '<body style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif;background:#f0f5ff;color:#0c1831;margin:0;padding:20px;">' +
    '<div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #dbeafe;border-radius:14px;overflow:hidden;">' +
    '<div style="background:linear-gradient(135deg,#1a50d8,#2563eb,#0891b2);padding:28px 24px;"><h1 style="margin:0;font-size:20px;color:#fff;">MindForge Capital</h1><p style="margin:4px 0 0;color:rgba(255,255,255,.85);font-size:13px;">30-day check-in</p></div>' +
    '<div style="padding:28px;">' +
    '<p style="font-size:15px;">Hello ' + escapeHtmlGs(name || 'Investor') + ',</p>' +
    '<p style="font-size:14px;color:#475569;line-height:1.6;">It has been 30 days since you started with <b>' + escapeHtmlGs(strategy) + '</b>. How is it going? If you have a moment, just reply to this email and tell us — we read every response personally.</p>' +
    '<p style="font-size:14px;color:#475569;line-height:1.6;">If your subscription is about to expire and you would like to renew, the easiest way is on WhatsApp:</p>' +
    '<div style="text-align:center;margin:28px 0;"><a href="' + renewUrl + '" style="display:inline-block;background:linear-gradient(135deg,#25d366,#1da954);background-color:#25d366;color:#ffffff !important;padding:14px 36px;border-radius:10px;text-decoration:none;font-weight:700;font-size:15px;letter-spacing:.02em;box-shadow:0 6px 18px -8px rgba(37,211,102,.55);"><span style="color:#ffffff !important;">Renew on WhatsApp &nbsp;&#8594;</span></a></div>' +
    '<p style="font-size:14px;color:#475569;line-height:1.6;">Or open your dashboard directly:</p>' +
    '<div style="text-align:center;margin:18px 0;"><a href="' + dashboardUrl + '" style="display:inline-block;background:linear-gradient(135deg,#1a50d8 0%,#2563eb 50%,#0891b2 100%);background-color:#1a50d8;color:#ffffff !important;padding:12px 28px;border-radius:10px;text-decoration:none;font-weight:600;font-size:14px;"><span style="color:#ffffff !important;">Open My Dashboard</span></a></div>' +
    '<p style="font-size:12px;color:#94a3b8;">SEBI Disclaimer: Research is published by Sagar Shekhawath, a SEBI-registered Research Analyst. Not personalised investment advice.</p>' +
    '</div>' +
    '<div style="background:#f8fafc;padding:18px;text-align:center;font-size:11px;color:#94a3b8;border-top:1px solid #e2e8f0;">&copy; 2026 MindForge Capital &middot; <a href="mailto:sagar.shekhawath@mindforgecapital.com?subject=unsubscribe" style="color:#94a3b8;">Unsubscribe</a></div>' +
    '</div></body></html>';
  var plain = 'Hello ' + (name || 'Investor') + ',\n\nIt has been 30 days since you started with ' + strategy + '. How is it going? Reply to this email and tell us.\n\nRenew on WhatsApp: ' + renewUrl + '\nOr open your dashboard: ' + dashboardUrl + '\n\nSEBI Disclaimer: Research is published by Sagar Shekhawath, a SEBI-registered Research Analyst.\n\nTo unsubscribe, reply with "unsubscribe".\n\n-- MindForge Capital\nhttps://mindforgecapital.com';
  GmailApp.sendEmail(email, subject, plain, { htmlBody: html, name: 'MindForge Capital', replyTo: 'sagar.shekhawath@mindforgecapital.com' });
}
