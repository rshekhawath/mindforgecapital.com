/*
================================================================================
  MindForge Capital — Google Apps Script Backend
================================================================================

SETUP INSTRUCTIONS:
1. Create a Google Sheet with 3 sheets: "strategy_runs", "subscriptions", "leads"
2. Add the column headers to each sheet (see SHEET STRUCTURE below)
3. Go to Extensions → Apps Script
4. Paste this entire code into the editor
5. Save the project
6. Click Deploy → New Deployment → Web App
7. Execute as: Me (your account)
8. Who has access: Anyone
9. Click Deploy → Authorize → Grant permission to MindForge Capital
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

// ─────────────────────────────────────────────────────────────────────────────
// MAIN HANDLERS
// ─────────────────────────────────────────────────────────────────────────────

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
      return handleActivate(payload);
    } else {
      // Legacy: save to leads sheet
      return handleLegacyLead(payload);
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
      return handleGetLeads();
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

// ─────────────────────────────────────────────────────────────────────────────
// ACTION HANDLERS
// ─────────────────────────────────────────────────────────────────────────────

function handleSubscribe(payload) {
  const token = payload.token;
  const email = payload.email;
  const name = payload.name;
  const phone = payload.phone;
  const strategy = payload.strategy;
  const paymentId = payload.payment_id;

  // Find latest run_id for this strategy
  const runId = findLatestRunId(strategy);

  // Calculate expiry (30 days from now)
  const subscribedAt = new Date();
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 30);

  // Save to subscriptions sheet
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
    'active'
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

  return ContentService.createTextOutput(JSON.stringify({
    status: 'ok',
    run_id: runId,
    count: stocks.length
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
  sheet.appendRow([
    new Date().toISOString(),
    payload.name  || '',
    payload.email || '',
    payload.phone || '',
    payload.strategy || '',
    payload.price || '',
    'pending'
  ]);

  // Notify admin of new lead
  sendAdminLeadNotification(payload.name || '', payload.email || '', payload.phone || '', payload.strategy || '', payload.price || '');

  return ContentService.createTextOutput(JSON.stringify({
    status: 'ok',
    message: 'Lead saved'
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

  // 30-day expiry
  const subscribedAt = new Date();
  const expiresAt    = new Date();
  expiresAt.setDate(expiresAt.getDate() + 30);

  // Find latest run_id for this strategy
  const runId = findLatestRunId(strategy);

  // Append to subscriptions sheet
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
    'active'
  ]);

  // Mark lead as activated in leads sheet — find the most recent PENDING row
  // (avoids skipping a row when two leads share the same email)
  const leadsSheet = getSheet('leads');
  const leadsData  = leadsSheet.getDataRange().getValues();
  for (let i = leadsData.length - 1; i >= 1; i--) {
    const rowEmail  = (leadsData[i][2] || '').toLowerCase().trim();
    const rowStatus = (leadsData[i][6] || '').toLowerCase();
    if (rowEmail === email && rowStatus !== 'activated') {
      leadsSheet.getRange(i + 1, 7).setValue('activated');
      break;
    }
  }

  // Send dashboard access email
  const dashboardUrl = getBaseUrl() + '/dashboard.html?token=' + token;
  sendActivationEmail(email, name, strategy, dashboardUrl, expiresAt);

  return ContentService.createTextOutput(JSON.stringify({
    status: 'ok',
    token: token,
    dashboard_url: dashboardUrl,
    message: 'Subscriber activated and email sent'
  })).setMimeType(ContentService.MimeType.JSON);
}

function handleGetLeads() {
  const sheet = getSheet('leads');
  const data  = sheet.getDataRange().getValues();
  const leads = [];

  for (let i = 1; i < data.length; i++) {
    leads.push({
      timestamp: data[i][0],
      name:      data[i][1],
      email:     data[i][2],
      phone:     data[i][3],
      strategy:  data[i][4],
      price:     data[i][5],
      status:    data[i][6] || 'pending'
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
        status: subData[i][9]
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

  // Always use the LATEST run for the strategy so the dashboard
  // shows the most current portfolio picks, regardless of signup time.
  const latestRunId = findLatestRunId(subscription.strategy);
  subscription.run_id = latestRunId;

  const runSheet = getSheet('strategy_runs');
  const runData = runSheet.getDataRange().getValues();
  const stocks = [];

  for (let i = 1; i < runData.length; i++) {
    // Filter by BOTH run_id AND strategy — guards against run_id collisions
    // where multiple strategies share the same timestamp-based id.
    if (runData[i][0] === latestRunId && runData[i][2] === subscription.strategy) {
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
          token: subData[i][0],
          email: subData[i][1],
          name: subData[i][2],
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

  // Send recovery email
  const dashboardUrl = getBaseUrl() + '/dashboard.html?token=' + latestSubscription.token;
  sendRecoveryEmail(latestSubscription.email, latestSubscription.name, dashboardUrl);

  return ContentService.createTextOutput(JSON.stringify({
    status: 'ok',
    dashboard_url: dashboardUrl,
    message: 'Recovery link sent to your email'
  })).setMimeType(ContentService.MimeType.JSON);
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────

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

// ─────────────────────────────────────────────────────────────────────────────
// EMAIL FUNCTIONS
// ─────────────────────────────────────────────────────────────────────────────
//
// Spam / deliverability notes:
//   1. All outbound emails now include a plain-text body (the 3rd arg to
//      GmailApp.sendEmail). HTML-only emails are a major spam signal.
//   2. A `replyTo` address is set so inbox providers see a valid return path.
//   3. Visible Unsubscribe links are included in every footer — the single
//      biggest factor for Gmail / Outlook bulk-sender reputation since Feb 2024.
//   4. Subject lines no longer use ✅ / 🎉 / 🔔 emojis, which heuristic spam
//      filters penalise on transactional mail.
//
// Things still to do OUTSIDE this script (Apps Script alone cannot fix these):
//   a. Add an SPF record for mindforgecapital.com that includes _spf.google.com
//      (e.g. "v=spf1 include:_spf.google.com ~all")
//   b. Enable DKIM signing for mindforgecapital.com in Google Workspace Admin
//      (Apps → Google Workspace → Gmail → Authenticate email).
//   c. Add a DMARC record: "v=DMARC1; p=quarantine; rua=mailto:postmaster@mindforgecapital.com"
//   d. Switch sender to a branded Workspace address (e.g. sagar.shekhawath@mindforgecapital.com)
//      instead of a @gmail.com account — Gmail's bulk-sender rules require
//      domain-aligned From addresses for best deliverability.
//   e. Warm the sender: start with low volume and ramp slowly.
//
// ─────────────────────────────────────────────────────────────────────────────

function sendSubscriptionEmail(email, name, strategy, dashboardUrl, expiresAt) {
  const subject = 'Your MindForge Capital dashboard access';

  const htmlBody = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; background: #0a0a0f; color: #f0f0f5; margin: 0; padding: 20px; }
        .container { max-width: 600px; margin: 0 auto; background: #12121a; border: 1px solid rgba(255,255,255,0.06); border-radius: 12px; overflow: hidden; }
        .header { background: linear-gradient(135deg, #6c63ff 0%, #2dd4bf 100%); padding: 40px 20px; text-align: center; }
        .header h1 { margin: 0; font-size: 28px; font-weight: 700; }
        .content { padding: 40px 30px; }
        .content h2 { font-size: 22px; margin: 0 0 12px 0; color: #f0f0f5; }
        .content p { color: #8b8b99; line-height: 1.6; margin: 12px 0; }
        .button-container { text-align: center; margin: 32px 0; }
        .button { display: inline-block; background: #6c63ff; color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 16px; }
        .button:hover { background: #5a52cc; }
        .details { background: rgba(108,99,255,0.1); border-left: 3px solid #6c63ff; padding: 16px; margin: 24px 0; border-radius: 6px; font-size: 14px; }
        .details-row { display: flex; justify-content: space-between; margin: 8px 0; }
        .details-label { color: #8b8b99; }
        .details-value { color: #f0f0f5; font-weight: 600; }
        .footer { background: rgba(255,255,255,0.02); padding: 24px; text-align: center; font-size: 12px; color: #6b7280; border-top: 1px solid rgba(255,255,255,0.06); }
        .warning { background: rgba(239,68,68,0.1); border-left: 3px solid #ef4444; padding: 12px 16px; margin: 16px 0; border-radius: 4px; font-size: 12px; color: #fca5a5; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>MindForge Capital</h1>
        </div>
        <div class="content">
          <h2>Welcome ` + name + `!</h2>
          <p>Your MindForge Capital subscription is now active. Your personalized dashboard is ready to use.</p>

          <div class="button-container">
            <a href="` + dashboardUrl + `" class="button">Access Your Dashboard</a>
          </div>

          <div class="details">
            <div class="details-row">
              <span class="details-label">Strategy</span>
              <span class="details-value">` + strategy + `</span>
            </div>
            <div class="details-row">
              <span class="details-label">Valid Until</span>
              <span class="details-value">` + expiresAt.toLocaleDateString('en-IN') + `</span>
            </div>
          </div>

          <p>Your dashboard link is unique and personal. <strong>Do not share it with others.</strong> If you need to recover your link later, visit the recovery page with your email address.</p>

          <div class="warning">
            <strong>Important:</strong> This portfolio is for educational purposes. Past performance does not guarantee future results. Always consult with a financial advisor before making investment decisions.
          </div>
        </div>
        <div class="footer">
          <p>
            <strong>SEBI Disclaimer:</strong> MindForge Capital provides educational information only and is not registered with SEBI. This is not financial advice. Trade at your own risk. Please review our privacy policy and terms of service.
          </p>
          <p style="margin-top: 16px; color: #9ca3af;">© 2026 MindForge Capital. All rights reserved.<br><a href="mailto:sagar.shekhawath@mindforgecapital.com?subject=unsubscribe" style="color:#9ca3af;">Unsubscribe</a> · <a href="https://mindforgecapital.com/privacy.html" style="color:#9ca3af;">Privacy</a></p>
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
    'Your dashboard link is unique — please do not share it. If you lose it, recover it at https://mindforgecapital.com/recover.html\n\n' +
    'SEBI Disclaimer: MindForge Capital provides educational information only and is not registered with SEBI. This is not financial advice.\n\n' +
    'To unsubscribe, reply with "unsubscribe" in the subject line.\n\n' +
    '— MindForge Capital\n' +
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

  const htmlBody = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif; background: #0a0a0f; color: #f0f0f5; margin: 0; padding: 20px; }
        .container { max-width: 600px; margin: 0 auto; background: #12121a; border: 1px solid rgba(255,255,255,0.06); border-radius: 12px; overflow: hidden; }
        .header { background: linear-gradient(135deg, #6c63ff 0%, #2dd4bf 100%); padding: 40px 20px; text-align: center; }
        .header h1 { margin: 0; font-size: 28px; font-weight: 700; }
        .content { padding: 40px 30px; }
        .content h2 { font-size: 22px; margin: 0 0 12px 0; color: #f0f0f5; }
        .content p { color: #8b8b99; line-height: 1.6; margin: 12px 0; }
        .button-container { text-align: center; margin: 32px 0; }
        .button { display: inline-block; background: #6c63ff; color: white; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 16px; }
        .button:hover { background: #5a52cc; }
        .footer { background: rgba(255,255,255,0.02); padding: 24px; text-align: center; font-size: 12px; color: #6b7280; border-top: 1px solid rgba(255,255,255,0.06); }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>MindForge Capital</h1>
        </div>
        <div class="content">
          <h2>Hello ` + name + `!</h2>
          <p>We received your request to recover your dashboard link. Your personalized dashboard is still active and ready to use.</p>

          <div class="button-container">
            <a href="` + dashboardUrl + `" class="button">Access Your Dashboard</a>
          </div>

          <p style="font-size: 14px; color: #6b7280; margin-top: 24px;">If you did not request this link, you can safely ignore this email. Your subscription is secure.</p>
        </div>
        <div class="footer">
          <p>© 2026 MindForge Capital. All rights reserved.<br><a href="mailto:sagar.shekhawath@mindforgecapital.com?subject=unsubscribe" style="color:#6b7280;">Unsubscribe</a></p>
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
    '— MindForge Capital\n' +
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

          <div class="btn-wrap">
            <a href="` + dashboardUrl + `" class="btn">Open My Dashboard &#8594;</a>
          </div>

          <div class="details">
            <div class="details-row">
              <span class="details-label">Strategy</span>
              <span class="details-value">` + strategy + `</span>
            </div>
            <div class="details-row">
              <span class="details-label">Valid Until</span>
              <span class="details-value">` + expiresAt.toLocaleDateString('en-IN', {day:'numeric',month:'long',year:'numeric'}) + `</span>
            </div>
          </div>

          <div class="note">
            <strong>Keep this link private.</strong> Your dashboard link is unique to you — do not share it. If you ever lose it, use the <a href="https://mindforgecapital.com/recover.html">link recovery page</a>.
          </div>

          <p style="font-size:13px;color:#94a3b8;">
            <strong>SEBI Disclaimer:</strong> MindForge Capital provides educational information only and is not registered with SEBI as an investment advisor. This is not financial advice. Past performance does not guarantee future results. Trade at your own risk.
          </p>
        </div>
        <div class="footer">
          <p>© 2026 MindForge Capital · <a href="https://mindforgecapital.com" style="color:#1a50d8;text-decoration:none;">mindforgecapital.com</a><br><a href="mailto:sagar.shekhawath@mindforgecapital.com?subject=unsubscribe" style="color:#94a3b8;text-decoration:none;">Unsubscribe</a> · <a href="https://mindforgecapital.com/privacy.html" style="color:#94a3b8;text-decoration:none;">Privacy</a></p>
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
    'SEBI Disclaimer: MindForge Capital provides educational information only and is not registered with SEBI as an investment advisor. Past performance does not guarantee future results.\n\n' +
    'To unsubscribe, reply with "unsubscribe" in the subject line.\n\n' +
    '— MindForge Capital\n' +
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
      <p>MindForge Capital — Admin Notification</p>
    </div>
    <div class="content">
      <div class="row"><span class="label">Name</span><span class="value">` + name + `</span></div>
      <div class="row"><span class="label">Email</span><span class="value">` + email + `</span></div>
      <div class="row"><span class="label">Phone</span><span class="value">` + phone + `</span></div>
      <div class="row"><span class="label">Strategy</span><span class="value">` + strategy + `</span></div>
      <div class="row"><span class="label">Price</span><span class="value">` + price + `</span></div>
      <div class="btn-wrap">
        <a href="https://mindforgecapital.com/admin.html" class="btn">Open Admin Panel &#8594;</a>
      </div>
    </div>
    <div class="footer">© 2026 MindForge Capital</div>
  </div>
</body>
</html>`;

  try {
    GmailApp.sendEmail(adminEmail, subject, body, {
      htmlBody: htmlBody,
      name: 'MindForge Capital Alerts',
      replyTo: 'rshekhawath@gmail.com'
    });
  } catch (err) {
    Logger.log('Admin notification email error: ' + err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SETUP UTILITY (run once to initialize)
// ─────────────────────────────────────────────────────────────────────────────

function setupSheetId() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  PropertiesService.getScriptProperties().setProperty('SHEET_ID', ss.getId());
  Logger.log('Sheet ID set: ' + ss.getId());
  Logger.log('Now deploy this as a Web App (Deploy → New Deployment → Web App)');
}
