#!/usr/bin/env bash
set -euo pipefail

PORT="${GW_PORT:-3000}"

# Stop known local GW process patterns (child + parent supervisors).
pkill -f "gwtemplate-node-ts.*src/main.ts" >/dev/null 2>&1 || true
pkill -f "nodemon.*gwtemplate-node-ts" >/dev/null 2>&1 || true
pkill -f "npm run api:local-demo" >/dev/null 2>&1 || true
pkill -f "npm run api:local-fabric" >/dev/null 2>&1 || true
pkill -f "npm run api:local-fabric-devnet" >/dev/null 2>&1 || true
pkill -f "npm run dev" >/dev/null 2>&1 || true

kill_listen_pids() {
  if ! command -v lsof >/dev/null 2>&1; then
    return 0
  fi
  local pids
  pids="$(lsof -tiTCP:${PORT} -sTCP:LISTEN 2>/dev/null || true)"
  if [ -n "${pids}" ]; then
    echo "[api:close] killing LISTEN pid(s) on port ${PORT}: ${pids}"
    kill ${pids} >/dev/null 2>&1 || true
    sleep 1
    pids="$(lsof -tiTCP:${PORT} -sTCP:LISTEN 2>/dev/null || true)"
    if [ -n "${pids}" ]; then
      echo "[api:close] force killing pid(s) on port ${PORT}: ${pids}"
      kill -9 ${pids} >/dev/null 2>&1 || true
    fi
  fi
}

kill_listen_pids

# Wait briefly in case a supervisor restarts once before being killed.
for _ in 1 2 3 4 5; do
  if ! command -v lsof >/dev/null 2>&1; then
    break
  fi
  if ! lsof -tiTCP:${PORT} -sTCP:LISTEN >/dev/null 2>&1; then
    echo "[api:close] done. port ${PORT} is free."
    exit 0
  fi
  kill_listen_pids
  sleep 1
done

if command -v lsof >/dev/null 2>&1 && lsof -tiTCP:${PORT} -sTCP:LISTEN >/dev/null 2>&1; then
  echo "[api:close] port ${PORT} still in use by:"
  lsof -nP -iTCP:${PORT} -sTCP:LISTEN || true
  exit 1
fi

echo "[api:close] done."
