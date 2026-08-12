#!/usr/bin/env python3
"""Transform the local Flask screener frontends into static docs/screener/ pages.
Exact-string replacements with assertions so any mismatch fails loudly."""
import os

SRC = "/Users/rshekhawath/Desktop/MFC/screener"
DST = "/Users/rshekhawath/Desktop/MFC/docs/screener"

def repl(text, old, new, where, required=True, count=1):
    n = text.count(old)
    if required and n == 0:
        raise SystemExit(f"[{where}] MISSING marker:\n{old[:120]!r}")
    if n and count and n != count:
        print(f"  ! [{where}] expected {count} got {n} (continuing)")
    return text.replace(old, new)

# ───────────────────────── index.html ─────────────────────────
with open(os.path.join(SRC, "index.html"), encoding="utf-8") as f:
    idx = f.read()

idx = repl(idx, "</head>", '<script src="screener-data.js"></script>\n<link rel="stylesheet" href="../assets/mfc-finish.css">\n</head>', "index:script")
idx = repl(idx, 'const API="http://localhost:5001/api";', 'const API="/api";', "index:api")

idx = repl(idx,
'''    <div class="sidebar-section">
      <div class="sidebar-title">Data</div>
      <button class="btn btn-ghost btn-full btn-sm" onclick="document.getElementById('fetchModal').classList.add('show')">⬇ &nbsp;Fetch / Refresh Data</button>
      <div class="cache-chip" id="cacheInfo">— stocks cached</div>
    </div>''',
'''    <!-- (Data / snapshot section is local-operator only; omitted from the live screener) -->''', "index:datasection")

idx = repl(idx,
'''<!-- Fetch Modal -->
<div class="modal-overlay" id="fetchModal">
  <div class="modal">
    <h3>Fetch Stock Data</h3>
    <p>Pulls fundamental data from Yahoo Finance for NSE-listed stocks and caches locally for 1 hour.</p>
    <div style="margin-bottom:16px">
      <label class="form-label">Universe</label>
      <select class="filter-select" id="fetchUniverse" style="font-size:14px;padding:9px 12px">
        <option value="50">Nifty 50 — fast (~1 min)</option>
        <option value="100">Nifty 100 (~2 min)</option>
        <option value="99999" selected>Full universe — all 2123 stocks (~35 min)</option>
      </select>
    </div>
    <div class="modal-footer">
      <button class="btn btn-ghost" onclick="document.getElementById('fetchModal').classList.remove('show')">Cancel</button>
      <button class="btn btn-primary" onclick="startFetch()">Start Fetching</button>
    </div>
  </div>
</div>''',
'<!-- (Static snapshot — no live fetch modal) -->', "index:fetchmodal")

idx = repl(idx,
'            <div style="font-size:13px">Click <strong>Fetch / Refresh Data</strong> then <strong>Run Screen</strong></div>',
'            <div style="font-size:13px">Adjust filters on the left, then click <strong>Run Screen</strong></div>',
"index:emptyhint")

idx = repl(idx,
'showToast("Backend not running — double-click start.command first","error",8000);',
'showToast("Could not load screener data — please refresh.","error",8000);', "index:offline")

with open(os.path.join(DST, "index.html"), "w", encoding="utf-8") as f:
    f.write(idx)
print("✓ index.html")

# (watchlist.html removed — feature retired from the screener)
print("Done.")
