#!/usr/bin/env bash
set -euo pipefail

# -----------------------------------------------------------------------------
# prepare-test-network-env.sh
# -----------------------------------------------------------------------------
# Generates a full GW CORE runtime env for one organization in the shared
# Fabric-backed test network.
#
# Usage:
#   bash ./scripts/prepare-test-network-env.sh unid
#   bash ./scripts/prepare-test-network-env.sh accuro
#   bash ./scripts/prepare-test-network-env.sh connecthealth
#   bash ./scripts/prepare-test-network-env.sh antifraud
#
# Output:
#   .env.test-network-<org>
#
# Important runtime assumption:
# - the resulting env is valid only where `peer0:7051` resolves and the peer TLS
#   certificate with SAN `DNS:peer0` is acceptable
# - in practice this means the GW runtime should run inside the organization's
#   Kubernetes environment, or the peer TLS/exposure must be redesigned first
# -----------------------------------------------------------------------------

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORKSPACE_ROOT="$(cd "${ROOT}/../.." && pwd)"
BASE_ENV="${ROOT}/.env.demo"
LOADER_SCRIPT="${ROOT}/scripts/load-fabric-host-env.sh"
PROFILE_ROOT="${WORKSPACE_ROOT}/private-infra/fabric-multicloud-env/org-profiles"

ORG_ID="${1:-}"

function fail() {
  printf '\nERROR: %s\n' "$1" >&2
  exit 1
}

function require_file() {
  [[ -f "$1" ]] || fail "Missing file: $1"
}

function default_host_jurisdiction_for_org() {
  case "$1" in
    unid|accuro) echo "eu" ;;
    connecthealth|antifraud) echo "na" ;;
    *) echo "eu" ;;
  esac
}

function default_tenant_jurisdiction_for_org() {
  case "$1" in
    unid|accuro) echo "ES" ;;
    connecthealth|antifraud) echo "US" ;;
    *) echo "ES" ;;
  esac
}

function default_sector_for_org() {
  case "$1" in
    connecthealth) echo "health-care" ;;
    *) echo "health-care" ;;
  esac
}

[[ -n "${ORG_ID}" ]] || fail "Usage: bash ./scripts/prepare-test-network-env.sh <unid|accuro|connecthealth|antifraud>"
require_file "${BASE_ENV}"
require_file "${LOADER_SCRIPT}"

PROFILE_FILE="${PROFILE_ROOT}/${ORG_ID}.env"
require_file "${PROFILE_FILE}"

# shellcheck disable=SC1090
source "${PROFILE_FILE}"

MSP_ID="${MSP_ID:-${ORG_MSP_ID:-}}"
[[ -n "${MSP_ID}" ]] || fail "ORG_MSP_ID missing in ${PROFILE_FILE}"

NETWORK_MODE_VALUE="${NETWORK_MODE_VALUE:-test-network}"
ARTIFACT_MODE="${ARTIFACT_MODE:-test-network}"
CONSENT_CHAINCODE_NAME="${CONSENT_CHAINCODE_NAME:-consentaccess-sc}"
DB_PROVIDER_VALUE="${DB_PROVIDER_VALUE:-firestore}"
STORAGE_PROVIDER_VALUE="${STORAGE_PROVIDER_VALUE:-gcs}"
QUEUE_PROVIDER_VALUE="${QUEUE_PROVIDER_VALUE:-mem}"
HOST_JURISDICTION_VALUE="${HOST_JURISDICTION_VALUE:-$(default_host_jurisdiction_for_org "${ORG_ID}")}"
TENANT_JURISDICTION_VALUE="${TENANT_JURISDICTION_VALUE:-$(default_tenant_jurisdiction_for_org "${ORG_ID}")}"
SECTOR_VALUE="${SECTOR_VALUE:-$(default_sector_for_org "${ORG_ID}")}"
HOST_EXTERNAL_DOMAIN_VALUE="${HOST_EXTERNAL_DOMAIN_VALUE:-${HOST_PUBLIC_HOST_HEALTH:-${HOST_PUBLIC_HOST:-}}}"
OUT_ENV="${ROOT}/.env.test-network-${ORG_ID}"

(
  cd "${ROOT}"
  source "${LOADER_SCRIPT}" "${MSP_ID}" "${ARTIFACT_MODE}" >/tmp/prepare-test-network-env.log

  TLS_CA_VALUE="${HLF_CONNECTION_PEM}"
  CERT_VALUE="${HLF_CERTIFICATE}"
  KEY_VALUE="${HLF_PRIVATE_KEY}"
  PEER_VALUE="${HLF_CONNECTION_PEER}"

  sed '/^HLF_[A-Za-z0-9_]*=/d' "${BASE_ENV}" > "${OUT_ENV}"
  cat >> "${OUT_ENV}" <<EOF

# Added by scripts/prepare-test-network-env.sh
NETWORK_MODE=${NETWORK_MODE_VALUE}
DB_PROVIDER=${DB_PROVIDER_VALUE}
STORAGE_PROVIDER=${STORAGE_PROVIDER_VALUE}
QUEUE_PROVIDER=${QUEUE_PROVIDER_VALUE}
LEDGER_ENABLED=false
LEDGER_PROVIDER_DEFAULT=mem
LEDGER_PROVIDER_MAP=test=mem,local-network=fabric,test-network=fabric,network=fabric
LEDGER_MSP_ID=${MSP_ID}
LEDGER_FABRIC_MSP_ID=${MSP_ID}
LEDGER_FABRIC_ITEM_TYPE=credential
LEDGER_ROLE_LICENSE_CHAINCODE=rolelicense-sc
HLF_MSP_ID_ORG1=${MSP_ID}
HLF_CONNECTION_PEER=${PEER_VALUE}
HLF_CONNECTION_PEM=${TLS_CA_VALUE}
HLF_CERTIFICATE=${CERT_VALUE}
HLF_PRIVATE_KEY=${KEY_VALUE}
CONSENT_ACCESS_LEDGER_CHAINCODE=${CONSENT_CHAINCODE_NAME}
FHIR_VERSION_LEDGER_CHAINCODE=fhir-versioning
HOST_JURISDICTION=${HOST_JURISDICTION_VALUE}
JURISDICTION=${TENANT_JURISDICTION_VALUE}
DEFAULT_SECTOR=${SECTOR_VALUE}
HOST_EXTERNAL_DOMAIN=${HOST_EXTERNAL_DOMAIN_VALUE}
EOF
)

cat <<EOF
Wrote ${OUT_ENV}

Test-network GW env:
  org:          ${ORG_ID}
  mspId:        ${MSP_ID}
  artifacts:    ${ARTIFACT_MODE}
  network mode: ${NETWORK_MODE_VALUE}
  db provider:  ${DB_PROVIDER_VALUE}
  storage:      ${STORAGE_PROVIDER_VALUE}
  queue:        ${QUEUE_PROVIDER_VALUE}
  chaincode:    ${CONSENT_CHAINCODE_NAME}
  sector:       ${SECTOR_VALUE}
  jurisdiction: ${TENANT_JURISDICTION_VALUE}
  peer:         peer0:7051
  host domain:  ${HOST_EXTERNAL_DOMAIN_VALUE:-<unset>}

Important:
  This env only works where 'peer0:7051' resolves and the peer TLS cert with
  SAN 'DNS:peer0' is valid.

Run:
  cd ${ROOT}
  npm run api:test-network-${ORG_ID}
EOF
