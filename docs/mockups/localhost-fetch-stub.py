#!/usr/bin/env python3
"""Stub server for docs/mockups/localhost-fetch-test.html.

GET  /ping  -> {"ok": true, "ts": ...}
POST /save  -> echoes the JSON body back inside {"saved": ...}

Listens on 127.0.0.1:7655.

CORS notes:
  As of Gossamer Preview v2.1.5, the extension declares VS Code `portMapping`
  for common dev ports (including 7655). With portMapping in place, the
  webview's service worker can resolve the webview ID, proxy localhost
  fetches, and add its own CORS headers. Helper servers can either set or
  omit Access-Control-Allow-* headers — both work.

  This script omits them for simplicity. If you do set them, use a single
  value, not duplicates.

See docs/briefs/localhost-fetch-blocked-followup.md for the full story.
"""
from http.server import BaseHTTPRequestHandler, HTTPServer
import json
import sys
import time


class H(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def do_GET(self):
        if self.path == "/ping":
            body = json.dumps({"ok": True, "ts": time.time()}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        self.send_response(404)
        self.end_headers()

    def do_POST(self):
        n = int(self.headers.get("Content-Length", "0") or "0")
        raw = self.rfile.read(n).decode("utf-8", "replace") if n else ""
        try:
            payload = json.loads(raw) if raw else None
        except Exception:
            payload = raw
        body = json.dumps({"saved": payload}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt, *args):
        sys.stderr.write("[stub] %s\n" % (fmt % args))


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 7655
    HTTPServer(("127.0.0.1", port), H).serve_forever()
