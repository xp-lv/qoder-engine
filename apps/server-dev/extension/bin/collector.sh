#!/bin/bash
# Qoder Monitor Collector - process lifecycle script.
# Principle 3: PID file management + idempotent start + graceful stop.
# Lifecycle is driven by Qoder IDE hooks (SessionStart -> start, Stop -> stop).
set -u

# Resolve plugin root: prefer Qoder-injected env var, fall back to script-relative path.
PLUGIN_ROOT="${QODER_PLUGIN_ROOT:-$(cd "$(dirname "$0")/.." && pwd)}"
PID_FILE="$PLUGIN_ROOT/.collector.pid"
LOG_FILE="$PLUGIN_ROOT/.collector.log"
NODE_BIN="${NODE_BIN:-node}"

cmd="${1:-}"

# Check whether the collector process recorded in the PID file is still alive.
is_running() {
  [ -f "$PID_FILE" ] || return 1
  local pid
  pid="$(cat "$PID_FILE" 2>/dev/null)"
  [ -n "$pid" ] || return 1
  kill -0 "$pid" 2>/dev/null
}

case "$cmd" in
  start)
    # Idempotent start: if a live process exists, do nothing (safe on repeated SessionStart).
    if is_running; then
      echo "collector already running (PID: $(cat "$PID_FILE"))"
      exit 0
    fi
    # Clean up a stale PID file (process died without Stop hook).
    rm -f "$PID_FILE"
    # Launch the collector as a detached background node process, logging to file.
    nohup "$NODE_BIN" "$PLUGIN_ROOT/bin/collector.js" >> "$LOG_FILE" 2>&1 &
    echo $! > "$PID_FILE"
    echo "collector started (PID: $(cat "$PID_FILE"))"
    ;;
  stop)
    if [ ! -f "$PID_FILE" ]; then
      echo "collector not running (no pid file)"
      exit 0
    fi
    PID="$(cat "$PID_FILE" 2>/dev/null)"
    if [ -n "$PID" ]; then
      # Send SIGTERM for graceful shutdown (collector.js clears its setInterval).
      kill -TERM "$PID" 2>/dev/null
      # Poll up to ~3s for graceful exit.
      i=0
      while [ "$i" -lt 6 ]; do
        kill -0 "$PID" 2>/dev/null || break
        sleep 0.5
        i=$((i + 1))
      done
      # Fallback SIGKILL to guarantee no zombie process (quality red line).
      if kill -0 "$PID" 2>/dev/null; then
        kill -KILL "$PID" 2>/dev/null
        echo "collector force-killed (PID: $PID)"
      else
        echo "collector stopped (PID: $PID)"
      fi
    fi
    rm -f "$PID_FILE"
    ;;
  status)
    if is_running; then
      echo "running (PID: $(cat "$PID_FILE"))"
    else
      echo "not running"
    fi
    ;;
  *)
    echo "Usage: $0 {start|stop|status}" >&2
    exit 1
    ;;
esac
