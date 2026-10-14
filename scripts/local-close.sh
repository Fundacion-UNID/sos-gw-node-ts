#!/usr/bin/env bash
set -euo pipefail

PORTS_RAW="${PORTS:-3000,8000}"

if ! command -v lsof >/dev/null 2>&1; then
  echo "ERROR: lsof is required but not installed."
  exit 1
fi

close_port() {
  local port="$1"
  local pids
  pids="$(lsof -tiTCP:${port} -sTCP:LISTEN 2>/dev/null || true)"

  if [[ -z "${pids}" ]]; then
    echo "[local:close] no process is listening on port ${port}"
    return 0
  fi

  echo "[local:close] closing processes on port ${port}: ${pids}"
  kill ${pids} || true
  sleep 1

  local remaining
  remaining="$(lsof -tiTCP:${port} -sTCP:LISTEN 2>/dev/null || true)"
  if [[ -n "${remaining}" ]]; then
    echo "[local:close] forcing close on remaining processes on port ${port}: ${remaining}"
    kill -9 ${remaining} || true
  fi
}

IFS=',' read -r -a PORTS <<<"${PORTS_RAW}"
for p in "${PORTS[@]}"; do
  port_trimmed="$(echo "$p" | xargs)"
  [[ -n "${port_trimmed}" ]] && close_port "${port_trimmed}"
done

echo "[local:close] done"
