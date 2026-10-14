#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOGS_ROOT="${ROOT_DIR}/logs"
RUN_ID="$(date -u +%Y%m%dT%H%M%SZ)"
RUN_LOG_DIR="${LOGS_ROOT}/project-audit-demo-${RUN_ID}"

MODE="demo"
TENANT_ID="${TENANT_ID:-acme-id}"
BASE_URL="${BASE_URL:-http://localhost:3000}"
HOST_JURISDICTION="${HOST_JURISDICTION:-eu}"
JURISDICTION="${JURISDICTION:-ES}"
SECTOR="${SECTOR:-health-care}"
AUTH_BEARER="${AUTH_BEARER:-demo-token}"
DATA_CHANNEL="${DATA_CHANNEL:-health-care-local}"
IDENTITY_CHANNEL="${IDENTITY_CHANNEL:-identity-local}"
BOOTSTRAP_INDIVIDUAL=true
RESTART_GW=true
SKIP_STACK=false
SKIP_CONSENT_ASSETS=false
SKIP_LIFECYCLE=false
SKIP_SMART_ACCESS=false

print_help() {
  cat <<'EOF'
Usage: bash ./scripts/project-audit-demo.sh [options]

Runs the current audited local demo path for GW CORE:
1. bootstrap local Fabric + GW CORE
2. create the canonical demo individual baseline
3. execute the consent lifecycle smoke against health-care-local
4. execute the SMART access smoke for both individual and digitaltwin flows

Options:
  --mode <demo>              Execution mode. Only demo is packaged here today.
  --tenant-id <id>           Tenant id. Default: acme-id
  --base-url <url>           GW base URL. Default: http://localhost:3000
  --host-jurisdiction <cc>   Host route jurisdiction. Default: eu
  --jurisdiction <cc>        Tenant jurisdiction. Default: ES
  --sector <name>            Business sector. Default: health-care
  --auth-bearer <token>      Bearer used by local demo flows. Default: demo-token
  --data-channel <name>      Fabric data channel. Default: health-care-local
  --identity-channel <name>  Fabric identity channel. Default: identity-local
  --no-bootstrap-individual  Skip the canonical demo individual creation
  --no-restart-gw            Do not force-stop any previous GW listener
  --skip-stack               Do not run local:fabric:stack
  --skip-consent-assets      Do not run the canonical consent asset smoke
  --skip-lifecycle           Do not run the consent lifecycle smoke
  --skip-smart-access        Do not run the SMART access smoke
  --help, -h                 Show this help

Artifacts:
  - wrapper logs: logs/project-audit-demo-<timestamp>/
  - stack logs: logs/local-fabric-stack-<timestamp>/
  - GW pid file: .local-fabric-gw.pid

Notes:
  - `compat/legacy` and `strict` are documented as project-closeout targets,
    but this wrapper currently packages only the validated local demo path.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode)
      MODE="$2"
      shift 2
      ;;
    --tenant-id)
      TENANT_ID="$2"
      shift 2
      ;;
    --base-url)
      BASE_URL="$2"
      shift 2
      ;;
    --host-jurisdiction)
      HOST_JURISDICTION="$2"
      shift 2
      ;;
    --jurisdiction)
      JURISDICTION="$2"
      shift 2
      ;;
    --sector)
      SECTOR="$2"
      shift 2
      ;;
    --auth-bearer)
      AUTH_BEARER="$2"
      shift 2
      ;;
    --data-channel)
      DATA_CHANNEL="$2"
      shift 2
      ;;
    --identity-channel)
      IDENTITY_CHANNEL="$2"
      shift 2
      ;;
    --no-bootstrap-individual)
      BOOTSTRAP_INDIVIDUAL=false
      shift
      ;;
    --no-restart-gw)
      RESTART_GW=false
      shift
      ;;
    --skip-stack)
      SKIP_STACK=true
      shift
      ;;
    --skip-consent-assets)
      SKIP_CONSENT_ASSETS=true
      shift
      ;;
    --skip-lifecycle)
      SKIP_LIFECYCLE=true
      shift
      ;;
    --skip-smart-access)
      SKIP_SMART_ACCESS=true
      shift
      ;;
    --help|-h)
      print_help
      exit 0
      ;;
    *)
      echo "ERROR: unknown argument: $1" >&2
      print_help >&2
      exit 2
      ;;
  esac
done

mkdir -p "${RUN_LOG_DIR}"

if [[ "${MODE}" != "demo" ]]; then
  echo "ERROR: mode '${MODE}' is not yet packaged in gwtemplate-node-ts." >&2
  echo "See docs-internal/00-project-closeout-todo.md for compat/legacy and strict status." >&2
  exit 3
fi

run_logged() {
  local step="$1"
  shift
  echo "[project-audit-demo] step=${step}"
  "$@" \
    > >(tee "${RUN_LOG_DIR}/${step}.stdout.log") \
    2> >(tee "${RUN_LOG_DIR}/${step}.stderr.log" >&2)
}

if [[ "${SKIP_STACK}" != "true" ]]; then
  stack_args=(run local:fabric:stack -- --tenant-id "${TENANT_ID}" --base-url "${BASE_URL}" --host-jurisdiction "${HOST_JURISDICTION}" --data-channel "${DATA_CHANNEL}" --identity-channel "${IDENTITY_CHANNEL}")
  if [[ "${BOOTSTRAP_INDIVIDUAL}" == "true" ]]; then
    stack_args+=("--bootstrap-individual")
  fi
  if [[ "${RESTART_GW}" == "true" ]]; then
    stack_args+=("--restart-gw")
  fi
  run_logged bootstrap-stack npm "${stack_args[@]}"
fi

if [[ "${SKIP_CONSENT_ASSETS}" != "true" ]]; then
  run_logged consent-assets env \
    BASE_URL="${BASE_URL}" \
    TENANT_ID="${TENANT_ID}" \
    JURISDICTION="${JURISDICTION}" \
    SECTOR="${SECTOR}" \
    AUTH_BEARER="${AUTH_BEARER}" \
    CHANNEL_NAME="${DATA_CHANNEL}" \
    CREATE_INDIVIDUAL_BY_DEFAULT=false \
    bash "${ROOT_DIR}/scripts/smoke-consentaccess-local-network.sh"
fi

if [[ "${SKIP_LIFECYCLE}" != "true" ]]; then
  run_logged consent-lifecycle env \
    BASE_URL="${BASE_URL}" \
    TENANT_ID="${TENANT_ID}" \
    JURISDICTION="${JURISDICTION}" \
    SECTOR="${SECTOR}" \
    AUTH_BEARER="${AUTH_BEARER}" \
    CHANNEL_NAME="${DATA_CHANNEL}" \
    CREATE_INDIVIDUAL_BY_DEFAULT=false \
    bash "${ROOT_DIR}/scripts/smoke-consentaccess-lifecycle-local-network.sh"
fi

if [[ "${SKIP_SMART_ACCESS}" != "true" ]]; then
  run_logged smart-access env \
    BASE_URL="${BASE_URL}" \
    TENANT_ID="${TENANT_ID}" \
    JURISDICTION="${JURISDICTION}" \
    SECTOR="${SECTOR}" \
    AUTH_BEARER="${AUTH_BEARER}" \
    CHANNEL_NAME="${DATA_CHANNEL}" \
    BOOTSTRAP_INDIVIDUAL_AND_DATA=true \
    bash "${ROOT_DIR}/scripts/smoke-smart-access-local-network.sh"
fi

echo "[project-audit-demo] success"
echo "[project-audit-demo] wrapper logs: ${RUN_LOG_DIR}"
echo "[project-audit-demo] stack logs: ${LOGS_ROOT}/local-fabric-stack-*"
echo "[project-audit-demo] next cross-repo reference: ../gdc-sdk-node-ts/docs/101-LIVE_GW_LOCAL.md"
