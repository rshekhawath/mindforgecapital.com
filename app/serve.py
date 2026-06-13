#!/usr/bin/env python3
"""Tiny static server for the MindForge app demo.

Serves app/www with **no-cache** headers so the browser always picks up the
latest CSS/JS on reload — avoids the stale-asset "blank/old UI" problem you get
from the default `python3 -m http.server` heuristic caching. Bound to 0.0.0.0 so
a phone on the same Wi-Fi can reach it too.

Usage:  python3 serve.py [port]   (default 9876)
"""
import http.server
import os
import socketserver
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 9876
WWW = os.path.join(os.path.dirname(os.path.abspath(__file__)), "www")
os.chdir(WWW)


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

    def log_message(self, *args):
        pass  # keep the terminal quiet


socketserver.TCPServer.allow_reuse_address = True
print("MindForge app demo serving %s" % WWW)
print("  → http://localhost:%d/?demo=1" % PORT)
try:
    with socketserver.TCPServer(("0.0.0.0", PORT), NoCacheHandler) as httpd:
        httpd.serve_forever()
except KeyboardInterrupt:
    print("\nstopped.")
