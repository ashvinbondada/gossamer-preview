#!/usr/bin/env bash
# PostToolUse hook: when an agent writes or edits an HTML file while running
# inside a cmux terminal, open it in cmux's embedded browser with live reload.
#
# This recreates Gossamer's "auto-open + live reload" workflow for the cmux /
# coding-agent context: the agent writes report.html, and it appears (and keeps
# updating) in a browser pane beside the terminal — no manual step.
#
# The hook never blocks the agent: it always exits 0, and all preview work is
# best-effort and backgrounded.
set -uo pipefail

input="$(cat)"

# Only act inside a cmux-managed terminal. Outside cmux there's no browser to
# drive, so we stay completely silent.
if [ -z "${CMUX_SOCKET_PATH:-}${CMUX_SURFACE_ID:-}${CMUX_WORKSPACE_ID:-}" ]; then
  exit 0
fi

# Extract tool_input.file_path from the hook payload. Use node (already required
# by gossamer) so we don't depend on jq being installed.
file="$(printf '%s' "$input" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const j=JSON.parse(s);process.stdout.write((j.tool_input&&j.tool_input.file_path)||"")}catch(e){}})' 2>/dev/null || true)"

case "$file" in
  *.html|*.htm) ;;
  *) exit 0 ;;
esac

[ -f "$file" ] || exit 0

# Prefer an installed `gossamer` binary; fall back to npx. gossamer itself
# decides whether to spawn the daemon and whether to split the pane.
if command -v gossamer >/dev/null 2>&1; then
  gossamer open "$file" >/dev/null 2>&1 || true
else
  npx --yes gossamer-cmux open "$file" >/dev/null 2>&1 || true
fi

exit 0
