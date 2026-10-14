#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GW_PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
NODE_VERSION="$(node --version)"
NODE_MAJOR="${NODE_VERSION#v}"
NODE_MAJOR="${NODE_MAJOR%%.*}"

if [[ "$NODE_MAJOR" != '24' ]]; then
  echo "ERROR: secure local E2E requires Node 24; active runtime is ${NODE_VERSION}." >&2
  exit 2
fi

resolve_sdk_root() {
  if [[ -n "${GDC_SDK_NODE_ROOT:-}" ]]; then
    printf '%s' "$GDC_SDK_NODE_ROOT"
    return
  fi
  local candidate
  for candidate in "${GW_PROJECT_ROOT}/../gdc-sdk-node-ts" "${GW_PROJECT_ROOT}/../../gdc-sdk-node-ts"; do
    if [[ -f "${candidate}/package.json" ]]; then
      printf '%s' "$candidate"
      return
    fi
  done
  return 1
}

SDK_PROJECT_ROOT="$(resolve_sdk_root || true)"
if [[ -z "$SDK_PROJECT_ROOT" || ! -f "${SDK_PROJECT_ROOT}/package.json" ]]; then
  echo 'ERROR: gdc-sdk-node-ts was not found; set GDC_SDK_NODE_ROOT to its checkout.' >&2
  exit 2
fi

resolve_ica_root() {
  if [[ -n "${CONNECT_ICA_ROOT:-}" ]]; then
    printf '%s' "$CONNECT_ICA_ROOT"
    return
  fi
  local candidate
  for candidate in "${GW_PROJECT_ROOT}/../connect-ica-ts" "${GW_PROJECT_ROOT}/../../connect-ica-ts"; do
    if [[ -f "${candidate}/package.json" ]]; then
      printf '%s' "$candidate"
      return
    fi
  done
  return 1
}

CONNECT_ICA_ROOT="$(resolve_ica_root || true)"
if [[ -z "$CONNECT_ICA_ROOT" || ! -f "${CONNECT_ICA_ROOT}/package.json" ]]; then
  echo 'ERROR: connect-ica-ts was not found; set CONNECT_ICA_ROOT to its checkout.' >&2
  exit 2
fi

for command_name in curl npm node; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "ERROR: missing required command ${command_name}." >&2
    exit 2
  }
done

RUN_ID="${LIVE_GW_RUN_ID:-$(date -u +%Y%m%dt%H%M%S)}"
HOST_ID_VALUE="${HOST_ID_VALUE:-livee2e-${RUN_ID}-host}"
TENANT_ID="${TENANT_ID:-livee2e-${RUN_ID}}"
TENANT_ROUTE_ID="${TENANT_ROUTE_ID:-${TENANT_ID}}"
E2E_JURISDICTION="${LIVE_GW_E2E_JURISDICTION:-ES}"
E2E_SECTOR="${LIVE_GW_E2E_SECTOR:-animal-care}"
BASE_URL="${BASE_URL:-http://127.0.0.1:3000}"
ICA_PORT="${ICA_PORT:-3310}"
ICA_BASE_URL="${ICA_BASE_URL:-http://127.0.0.1:${ICA_PORT}}"
GW_API_SCRIPT="${LIVE_GW_API_SCRIPT:-api:local-demo}"
GW_LOCAL_ENV_FILE="${LIVE_GW_LOCAL_ENV_FILE:-${GW_PROJECT_ROOT}/.env.demo}"
if [[ ! -f "$GW_LOCAL_ENV_FILE" ]]; then
  GW_LOCAL_ENV_FILE="${GW_PROJECT_ROOT}/env.demo.example"
fi
if [[ ! -f "$GW_LOCAL_ENV_FILE" ]]; then
  echo 'ERROR: secure local E2E requires .env.demo or env.demo.example.' >&2
  exit 2
fi
LOCAL_CLOSE_PORTS="${LIVE_GW_LOCAL_CLOSE_PORTS:-3300,3000,8000}"
RESULTS_DIR="${LIVE_GW_RESULTS_DIR:-${GW_PROJECT_ROOT}/test-results}"
GW_LOG_FILE_BASE="${LIVE_GW_LOG_FILE:-${RESULTS_DIR}/gw-secure-e2e-${RUN_ID}.log}"
E2E_LOG_FILE_BASE="${LIVE_GW_E2E_LOG_FILE:-${RESULTS_DIR}/sdk-secure-e2e-${RUN_ID}.log}"
ICA_LOG_FILE="${LIVE_ICA_LOG_FILE:-${RESULTS_DIR}/ica-secure-e2e-${RUN_ID}.log}"
mkdir -p "$RESULTS_DIR"

cleanup_gw() {
  if [[ -n "${GW_PID:-}" ]]; then
    kill "$GW_PID" >/dev/null 2>&1 || true
    wait "$GW_PID" >/dev/null 2>&1 || true
    GW_PID=''
  fi
  (cd "$GW_PROJECT_ROOT" && PORTS="$LOCAL_CLOSE_PORTS" bash ./scripts/local-close.sh) >/dev/null 2>&1 || true
}

cleanup() {
  cleanup_gw
  if [[ -n "${ICA_PID:-}" ]]; then
    pkill -TERM -P "$ICA_PID" >/dev/null 2>&1 || true
    kill "$ICA_PID" >/dev/null 2>&1 || true
    wait "$ICA_PID" >/dev/null 2>&1 || true
    ICA_PID=''
  fi
}
trap cleanup EXIT

start_local_ica() {
  if curl -fsS "${ICA_BASE_URL}/" >/dev/null 2>&1; then
    echo "ERROR: ${ICA_BASE_URL} is already serving another process; stop it before the reproducible E2E." >&2
    return 1
  fi

  (
    cd "$CONNECT_ICA_ROOT"
    ICA_API_PORT="$ICA_PORT" \
    SECURITY_MODE=demo \
    DEMO_ALLOW_INSECURE_BEARER=true \
    DB_PROVIDER=mem \
    STORAGE_PROVIDER=mem \
    ICA_SUPPORTED_JURISDICTIONS="$E2E_JURISDICTION" \
    ICA_SUPPORTED_SECTORS="$E2E_SECTOR" \
    DID_WEB_DOMAIN="127.0.0.1:${ICA_PORT}" \
    ICA_KNOWN_CERTS_AUTO_DOWNLOAD=true \
    ICA_KNOWN_ROOT_CERT_URLS= \
    ICA_KNOWN_INTERMEDIATE_CERT_URLS= \
    npm run api:local
  ) >"$ICA_LOG_FILE" 2>&1 &
  ICA_PID=$!

  local ready='false'
  for _ in $(seq 1 90); do
    if curl -fsS "${ICA_BASE_URL}/" >/dev/null 2>&1; then
      ready='true'
      break
    fi
    kill -0 "$ICA_PID" >/dev/null 2>&1 || break
    sleep 2
  done
  if [[ "$ready" != 'true' ]]; then
    echo "ERROR: local Connect ICA did not become ready; see ${ICA_LOG_FILE}." >&2
    tail -n 80 "$ICA_LOG_FILE" >&2 || true
    return 1
  fi
}

bootstrap_current_ica_tenant_for_individual_pass() {
  local pass_host_id="$1"
  local pass_tenant_id="$2"
  local pass_tenant_route_id="$3"
  local e2e_log_file="$4"
  local pass_controller_email="controller+${pass_tenant_id}@example.com"
  local pass_auth_bearer
  pass_auth_bearer="$(cd "$GW_PROJECT_ROOT" && node --input-type=module -e '
    import { buildUnsignedJwt } from "gdc-common-utils-ts/utils/jwt";
    process.stdout.write(buildUnsignedJwt({
      sub: process.argv[1],
      tenant_id: process.argv[2],
      email: process.argv[1],
      email_verified: true,
    }));
  ' "$pass_controller_email" "$pass_tenant_id")"

  (
    cd "$SDK_PROJECT_ROOT"
    RUN_LIVE_GW_E2E=1 \
    RUN_LIVE_GW_E2E_ACTOR_CHAIN=1 \
    RUN_LIVE_GW_E2E_IPS_INGESTION=0 \
    RUN_LIVE_GW_E2E_INDIVIDUAL_LIFECYCLE=0 \
    RUN_LIVE_GW_E2E_PROFILE_RUNTIME=0 \
    RUN_LIVE_GW_E2E_HOST_VERIFICATION_TRANSACTION=1 \
    LIVE_GW_ALLOW_HOST_TEARDOWN=0 \
    LIVE_GW_E2E_SUITE=professional \
    LIVE_GW_E2E_TRANSPORT=all \
    HOST_ID_VALUE="$pass_host_id" \
    TENANT_ID="$pass_tenant_id" \
    TENANT_ROUTE_ID="$pass_tenant_route_id" \
    CONTROLLER_EMAIL="$pass_controller_email" \
    PROFESSIONAL_EMAIL="$pass_controller_email" \
    INDIVIDUAL_CONTROLLER_EMAIL="$pass_controller_email" \
    AUTH_BEARER="$pass_auth_bearer" \
    JURISDICTION="$E2E_JURISDICTION" \
    HOST_JURISDICTION="$E2E_JURISDICTION" \
    SECTOR="$E2E_SECTOR" \
    BASE_URL="$BASE_URL" \
    npm run test:e2e:live-gw
  ) 2>&1 | tee -a "$e2e_log_file"
  local bootstrap_status="${PIPESTATUS[0]}"
  if [[ "$bootstrap_status" -ne 0 ]]; then
    return "$bootstrap_status"
  fi

  GDC_SDK_NODE_ROOT="$SDK_PROJECT_ROOT" \
  BASE_URL="$BASE_URL" \
  TENANT_ID="$pass_tenant_id" \
  TENANT_ROUTE_ID="$pass_tenant_route_id" \
  JURISDICTION="$E2E_JURISDICTION" \
  SECTOR="$E2E_SECTOR" \
  CONTROLLER_EMAIL="$pass_controller_email" \
  AUTH_BEARER="$pass_auth_bearer" \
    node "$GW_PROJECT_ROOT/scripts/cleanup-secure-e2e-bootstrap-individual.mjs" \
      2>&1 | tee -a "$e2e_log_file"
  return "${PIPESTATUS[0]}"
}

run_e2e_pass() {
  local pass_name="$1"
  local suite_profile="$2"
  local profile_runtime_enabled="$3"
  local host_teardown_enabled="$4"
  local individual_lifecycle_enabled="$5"
  local host_verification_enabled="$6"
  local pass_host_id="${HOST_ID_VALUE}-${pass_name}"
  local pass_tenant_id="${TENANT_ID}-${pass_name}"
  local pass_tenant_route_id="${TENANT_ROUTE_ID}-${pass_name}"
  local gw_log_file="${GW_LOG_FILE_BASE%.log}-${pass_name}.log"
  local e2e_log_file="${E2E_LOG_FILE_BASE%.log}-${pass_name}.log"

  (cd "$GW_PROJECT_ROOT" && PORTS="$LOCAL_CLOSE_PORTS" bash ./scripts/local-close.sh)
  (
    cd "$GW_PROJECT_ROOT"
    HOST_ID_VALUE="$pass_host_id" \
    ICA_URL_INTERNAL="$ICA_BASE_URL" \
    ICA_URL_EXTERNAL="$ICA_BASE_URL" \
    ICA_JURISDICTION="$E2E_JURISDICTION" \
    HOST_JURISDICTION="$E2E_JURISDICTION" \
    npx dotenv -e "$GW_LOCAL_ENV_FILE" -- npm run "$GW_API_SCRIPT"
  ) >"$gw_log_file" 2>&1 &
  GW_PID=$!

  local ready='false'
  for _ in $(seq 1 120); do
    if curl -fsS "${BASE_URL}/host/ping" >/dev/null 2>&1; then
      ready='true'
      break
    fi
    kill -0 "$GW_PID" >/dev/null 2>&1 || break
    sleep 2
  done
  if [[ "$ready" != 'true' ]]; then
    echo "ERROR: local GW did not become ready; see ${gw_log_file}." >&2
    tail -n 80 "$gw_log_file" >&2 || true
    return 1
  fi

  set +e
  local e2e_status=0
  if [[ "$suite_profile" == 'individual' && "$host_verification_enabled" == '1' ]]; then
    bootstrap_current_ica_tenant_for_individual_pass \
      "$pass_host_id" \
      "$pass_tenant_id" \
      "$pass_tenant_route_id" \
      "$e2e_log_file"
    e2e_status=$?
  fi

  if [[ "$e2e_status" -eq 0 ]]; then
    (
      cd "$SDK_PROJECT_ROOT"
      RUN_LIVE_GW_E2E=1 \
      LIVE_GW_E2E_SUITE="$suite_profile" \
      RUN_LIVE_GW_E2E_ACTOR_CHAIN=1 \
      RUN_LIVE_GW_E2E_IPS_INGESTION=1 \
      RUN_LIVE_GW_E2E_INDIVIDUAL_LIFECYCLE="$individual_lifecycle_enabled" \
      RUN_LIVE_GW_E2E_PROFILE_RUNTIME="$profile_runtime_enabled" \
      RUN_LIVE_GW_E2E_HOST_VERIFICATION_TRANSACTION="$host_verification_enabled" \
      LIVE_GW_ALLOW_HOST_TEARDOWN="$host_teardown_enabled" \
      LIVE_GW_E2E_TRANSPORT=all \
      HOST_ID_VALUE="$pass_host_id" \
      TENANT_ID="$pass_tenant_id" \
      TENANT_ROUTE_ID="$pass_tenant_route_id" \
      JURISDICTION="$E2E_JURISDICTION" \
      HOST_JURISDICTION="$E2E_JURISDICTION" \
      SECTOR="$E2E_SECTOR" \
      BASE_URL="$BASE_URL" \
      npm run test:e2e:live-gw
    ) 2>&1 | tee -a "$e2e_log_file"
    e2e_status=${PIPESTATUS[0]}
  fi

  if [[ "$e2e_status" -eq 0 && "$suite_profile" == 'all' ]]; then
    (
      cd "$SDK_PROJECT_ROOT"
      RUN_LIVE_DIALOGUE_CONSENT_PROFESSIONAL_E2E=1 \
      SMART_SCOPE_SECTION='LOINC|10160-0' \
      TENANT_ID="$pass_tenant_id" \
      TENANT_ROUTE_ID="$pass_tenant_route_id" \
      JURISDICTION="$E2E_JURISDICTION" \
      HOST_JURISDICTION="$E2E_JURISDICTION" \
      SECTOR="$E2E_SECTOR" \
      BASE_URL="$BASE_URL" \
      npm run test:e2e:live-dialogue:consent-professional
    ) 2>&1 | tee -a "$e2e_log_file"
    e2e_status=${PIPESTATUS[0]}
  fi
  set -e

  cleanup_gw
  if [[ "$e2e_status" -ne 0 ]]; then
    return "$e2e_status"
  fi
  if grep -Eiq '(^|[[:space:]])#?[[:space:]]*SKIP([[:space:]]|$)|skipped[[:space:]]+[1-9]|[1-9][0-9]*[[:space:]]+skipped' "$e2e_log_file"; then
    echo "ERROR: secure local E2E reported a skipped journey; see ${e2e_log_file}." >&2
    return 1
  fi
}

start_local_ica

# The complete non-destructive surface shares one tenant. A second isolated
# pass proves the destructive individual and host cleanup contracts against a
# fresh in-memory runtime without descendants created by sibling journeys.
LIVE_GW_ALLOW_HOST_TEARDOWN=0 run_e2e_pass all all 1 0 0 1
RUN_LIVE_GW_E2E_PROFILE_RUNTIME=0 LIVE_GW_E2E_SUITE=individual \
  run_e2e_pass individual-cleanup individual 0 1 1 1

echo "OK: secure local SDK E2E passed on ${NODE_VERSION} with zero skipped journeys."
