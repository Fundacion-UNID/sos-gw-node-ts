#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

ALICE_ENV="${ALICE_ENV:-.env.alice}"
BOB_ENV="${BOB_ENV:-.env.bob}"
ALICE_BASE_URL="${ALICE_BASE_URL:-http://localhost:3000}"
BOB_BASE_URL="${BOB_BASE_URL:-http://localhost:3001}"
JURISDICTION="${JURISDICTION:-ES}"
JURISDICTION_LOWER="$(printf '%s' "${JURISDICTION:-ES}" | tr '[:upper:]' '[:lower:]')"
VERSION="${VERSION:-v1}"
HOST_NETWORK="${HOST_NETWORK:-test}"
PORTS_TO_CLOSE="${PORTS_TO_CLOSE:-3000,3001}"
SKIP_BUILD="${SKIP_BUILD:-false}"
SKIP_CLOSE="${SKIP_CLOSE:-false}"

for cmd in curl npx node npm; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "ERROR: missing $cmd"; exit 2; }
done

for env_file in "$ALICE_ENV" "$BOB_ENV"; do
  if [[ ! -f "$env_file" ]]; then
    echo "ERROR: missing env file '$env_file'"
    exit 1
  fi
done

mkdir -p logs

if [[ "$SKIP_CLOSE" != "true" ]]; then
  PORTS="$PORTS_TO_CLOSE" bash ./scripts/local-close.sh
fi

if [[ "$SKIP_BUILD" != "true" ]]; then
  npm run build:swagger >/dev/null
fi

start_instance() {
  local label="$1"
  local env_file="$2"
  local log_file="logs/${label}-gw.log"
  local pid_file="logs/${label}-gw.pid"

  echo "[alice-bob] starting ${label} using ${env_file}"
  TS_NODE_TRANSPILE_ONLY=1 \
  TS_NODE_SKIP_IGNORE=1 \
  TS_NODE_COMPILER_OPTIONS='{"module":"NodeNext","moduleResolution":"NodeNext","allowImportingTsExtensions":true}' \
  nohup npx dotenv -e "$env_file" -- node --loader ts-node/esm --experimental-specifier-resolution=node src/main.ts \
    >"$log_file" 2>&1 &

  local pid=$!
  echo "$pid" > "$pid_file"
  echo "[alice-bob] ${label} pid=${pid} log=${log_file}"
}

wait_for_ping() {
  local label="$1"
  local base_url="$2"
  local url="${base_url}/host/cds-${JURISDICTION_LOWER}/${VERSION}/${HOST_NETWORK}/.well-known/ping"

  for _ in $(seq 1 60); do
    local status
    status="$(curl -sS -o /tmp/${label}-ping.out -w "%{http_code}" "$url" || true)"
    if [[ "$status" == "200" ]]; then
      echo "[alice-bob] ${label} is ready at ${base_url}"
      return 0
    fi
    sleep 1
  done

  echo "ERROR: ${label} did not become ready at ${url}"
  [[ -s /tmp/${label}-ping.out ]] && cat /tmp/${label}-ping.out
  return 1
}

start_instance "alice" "$ALICE_ENV"
start_instance "bob" "$BOB_ENV"

wait_for_ping "alice" "$ALICE_BASE_URL"
wait_for_ping "bob" "$BOB_BASE_URL"

echo "[alice-bob] both gateways are ready"
