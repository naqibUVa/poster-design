#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Interactive Poster Studio — macOS / Linux launcher
#
# Double-click this file in Finder (macOS) or run ./start.command in a terminal.
# It serves this folder over http://127.0.0.1:<port> and opens your browser.
#
# If double-clicking does nothing, the executable bit was lost (this happens when
# the project travels through a .zip or a Windows machine). Fix it once with:
#
#     chmod +x start.command
#
# Why a server at all? The app is built from native ES modules, and browsers
# refuse to load modules from file:// URLs for security reasons. Any static
# server works — this script just picks whichever one you already have.
# ---------------------------------------------------------------------------

set -uo pipefail

# Always operate on the folder this script lives in, whatever the caller's cwd is.
cd "$(dirname "$0")" || exit 1
PROJECT_DIR="$(pwd)"

# PORT may arrive from the environment — the suite launcher one level up sets
# it so the dashboard's iframe knows where to point. When it does the port is
# an assignment, not a preference, so the scan below is skipped: a server that
# quietly moved to 5174 is a tab the dashboard can never reach, and because
# posters live in localStorage a different port is a different origin.
if [ -n "${PORT:-}" ]; then PORT_FIXED=yes; else PORT_FIXED=no; fi
START_PORT="${PORT:-5173}"
MAX_TRIES=20
SERVER_PID=""

say() { printf '%s\n' "$*"; }
hr()  { printf '%s\n' "------------------------------------------------------------"; }

cleanup() {
  if [ -n "$SERVER_PID" ] && kill -0 "$SERVER_PID" 2>/dev/null; then
    say ""
    say "Shutting down the server (pid $SERVER_PID)..."
    kill "$SERVER_PID" 2>/dev/null
    wait "$SERVER_PID" 2>/dev/null
  fi
  say "Interactive Poster Studio stopped."
}
trap cleanup EXIT INT TERM

# Return 0 when nothing is listening on $1. Uses bash's /dev/tcp, so it needs no
# extra tooling; the subshell keeps a failed connection from killing the script.
port_is_free() {
  ( exec 3<>"/dev/tcp/127.0.0.1/$1" ) >/dev/null 2>&1 && return 1
  return 0
}

PORT="$START_PORT"
if [ "$PORT_FIXED" = no ]; then
  tries=0
  while ! port_is_free "$PORT"; do
    tries=$((tries + 1))
    if [ "$tries" -ge "$MAX_TRIES" ]; then
      say "Could not find a free port between $START_PORT and $((START_PORT + MAX_TRIES - 1))."
      say "Close whatever is using them, or edit START_PORT at the top of this script."
      exit 1
    fi
    PORT=$((PORT + 1))
  done
elif ! port_is_free "$PORT"; then
  say "Port $PORT was assigned but something is already listening on it."
  say "Stop that process, or start the suite again — it skips apps already running."
  exit 1
fi

URL="http://127.0.0.1:${PORT}/index.html"

hr
say "  Interactive Poster Studio"
hr
say "  Folder : $PROJECT_DIR"
say "  URL    : $URL"
say ""

# Prefer python3 (present on every modern mac and most Linux distros), then a
# python that is actually version 3, then Node's `serve` via npx.
if command -v python3 >/dev/null 2>&1; then
  say "  Server : python3 -m http.server"
  hr
  python3 -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1 &
  SERVER_PID=$!
elif command -v python >/dev/null 2>&1 && python -c 'import sys; sys.exit(0 if sys.version_info[0] == 3 else 1)' >/dev/null 2>&1; then
  say "  Server : python -m http.server"
  hr
  python -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1 &
  SERVER_PID=$!
elif command -v npx >/dev/null 2>&1; then
  say "  Server : npx serve  (first run downloads the package)"
  hr
  npx --yes serve --listen "$PORT" . >/dev/null 2>&1 &
  SERVER_PID=$!
else
  hr
  say "No usable web server was found."
  say ""
  say "Install either one and run this script again:"
  say "  * Python 3  —  https://www.python.org/downloads/"
  say "  * Node.js   —  https://nodejs.org/  (provides npx)"
  exit 1
fi

# Give the server a moment, then confirm it actually came up.
for _ in 1 2 3 4 5 6 7 8 9 10; do
  sleep 0.3
  port_is_free "$PORT" || break
done

if ! kill -0 "$SERVER_PID" 2>/dev/null; then
  say "The server exited immediately. Try running it by hand to see the error:"
  say "  cd \"$PROJECT_DIR\" && python3 -m http.server $PORT"
  exit 1
fi

# Open the default browser. NO_BROWSER is set by the suite launcher, which
# opens the dashboard itself — six apps each opening their own tab is six tabs
# nobody asked for.
if [ -n "${NO_BROWSER:-}" ]; then
  :
elif command -v open >/dev/null 2>&1; then
  open "$URL"                       # macOS
elif command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$URL" >/dev/null 2>&1 & # Linux desktops
else
  say "Could not detect a browser opener — paste this into your browser:"
  say "  $URL"
fi

say "Server running. Your work auto-saves in the browser as you edit."
say "Press Ctrl+C in this window (or just close it) to stop."
say ""

wait "$SERVER_PID"
