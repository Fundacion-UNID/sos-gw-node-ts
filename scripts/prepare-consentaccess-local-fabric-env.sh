#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORKSPACE_ROOT="$(dirname "$(dirname "${ROOT}")")"
DEVNET_ROOT="${FABRIC_MULTICLOUD_DIR:-${WORKSPACE_ROOT}/fabric-multicloud}/devnet/fabric-v3"
BASE_ENV="${BASE_ENV_FILE:-${ROOT}/.env.local-network}"
OUT_ENV="${ROOT}/.env.local-fabric"
LEGACY_OUT_ENV="${ROOT}/.env.local-fabric-devnet"
DEVNET_ENV="${DEVNET_ROOT}/.env.fabric-devnet"
ENSURE_DEVNET_ENV_SCRIPT="${ROOT}/scripts/ensure-fabric-devnet-env.sh"
ORG1_DOMAIN="${ORG1_DOMAIN:-host1.example.com}"

CHANNEL_NAME="${CHANNEL_NAME:-animal-care-local}"
CONSENT_CHAINCODE_NAME="${CONSENT_CHAINCODE_NAME:-consentaccess-sc}"
LEDGER_MSP_ID_VALUE="${LEDGER_MSP_ID_VALUE:-Host1MSP}"
HOST_JURISDICTION_VALUE="${HOST_JURISDICTION_VALUE:-CA-BC}"
TENANT_JURISDICTION_VALUE="${TENANT_JURISDICTION_VALUE:-CA-BC}"
SECTOR_VALUE="${SECTOR_VALUE:-animal-care}"
NETWORK_MODE_VALUE="${NETWORK_MODE_VALUE:-local-network}"
IDENTITY_CHANNEL_NAME="${IDENTITY_CHANNEL_NAME:-identity-local}"
RESEARCH_CHANNEL_NAME="${RESEARCH_CHANNEL_NAME:-${SECTOR_VALUE}-local-research}"
BOOTSTRAP_CHANNELS_VALUE="${BOOTSTRAP_CHANNELS_VALUE:-${IDENTITY_CHANNEL_NAME},${CHANNEL_NAME},${RESEARCH_CHANNEL_NAME}}"
FABRIC_PEER_ENDPOINT_VALUE="${FABRIC_PEER_ENDPOINT_VALUE:-localhost:7051}"
ICA_URL_EXTERNAL_VALUE="${ICA_URL_EXTERNAL_VALUE:-}"

function fail() {
  printf '\nERROR: %s\n' "$1" >&2
  exit 1
}

function to_env_one_line_pem() {
  perl -0pe 's/\n/\\n/g' "$1"
}

# Docker accepts duplicate --env-file assignments and silently keeps the last
# one. Keep that last-value contract explicit in the generated file itself so
# a demo/base value cannot override the local-network Fabric values below.
function deduplicate_env_assignments() {
  local env_file="$1"
  local deduplicated_file
  deduplicated_file="$(mktemp "${env_file}.deduplicated.XXXXXX")"
  awk -F= '
    FNR == NR {
      if ($0 ~ /^[A-Za-z_][A-Za-z0-9_]*=/) last[$1] = FNR
      next
    }
    $0 ~ /^[A-Za-z_][A-Za-z0-9_]*=/ && last[$1] != FNR { next }
    { print }
  ' "${env_file}" "${env_file}" > "${deduplicated_file}"
  mv "${deduplicated_file}" "${env_file}"
}

[[ -d "${DEVNET_ROOT}" ]] || fail "Missing devnet directory: ${DEVNET_ROOT}"
[[ -f "${BASE_ENV}" ]] || fail "Missing base env file: ${BASE_ENV}"
[[ -f "${ENSURE_DEVNET_ENV_SCRIPT}" ]] || fail "Missing helper script: ${ENSURE_DEVNET_ENV_SCRIPT}"

bash "${ENSURE_DEVNET_ENV_SCRIPT}"
[[ -f "${DEVNET_ENV}" ]] || fail "Missing devnet env file after generation: ${DEVNET_ENV}"

ORG1_ADMIN_CERT="${DEVNET_ROOT}/organizations/peerOrganizations/${ORG1_DOMAIN}/users/Admin@${ORG1_DOMAIN}/msp/signcerts/cert.pem"
ORG1_ADMIN_KEY="$(ls -1 "${DEVNET_ROOT}/organizations/peerOrganizations/${ORG1_DOMAIN}/users/Admin@${ORG1_DOMAIN}/msp/keystore/"* | head -n 1)"
ORG1_PEER_TLS_CA="${DEVNET_ROOT}/organizations/peerOrganizations/${ORG1_DOMAIN}/peers/peer0.${ORG1_DOMAIN}/tls/ca.crt"

[[ -f "${ORG1_ADMIN_CERT}" ]] || fail "Missing Org1 admin certificate: ${ORG1_ADMIN_CERT}"
[[ -f "${ORG1_ADMIN_KEY}" ]] || fail "Missing Org1 admin private key under keystore."
[[ -f "${ORG1_PEER_TLS_CA}" ]] || fail "Missing Org1 peer TLS CA certificate: ${ORG1_PEER_TLS_CA}"

sed '/^HLF_[A-Za-z0-9_]*=/d' "${BASE_ENV}" > "${OUT_ENV}"
awk '
  BEGIN { skip = 0 }
  /^HLF_/ { skip = 1; next }
  skip == 1 {
    if ($0 ~ /^[A-Z0-9_]+=|^#|^$/) { skip = 0 } else { next }
  }
  { print }
' "${DEVNET_ENV}" >> "${OUT_ENV}"
cat >> "${OUT_ENV}" <<EOF

# Added by scripts/prepare-consentaccess-local-fabric-env.sh
# These overrides must be appended after the devnet-generated Fabric env so they
# remain the final effective values.
#
# Important local rule:
# - local-network now exercises both the identity ledger and consent ledger
# - host/tenant onboarding writes go to identity-local
# - consent lifecycle writes go to health-care-local
NETWORK_MODE=${NETWORK_MODE_VALUE}
LEDGER_ENABLED=true
LEDGER_PROVIDER_DEFAULT=mem
LEDGER_PROVIDER_MAP=test=mem,local-network=fabric,test-network=fabric,network=fabric
LEDGER_MSP_ID=${LEDGER_MSP_ID_VALUE}
LEDGER_FABRIC_MSP_ID=${LEDGER_MSP_ID_VALUE}
# The ICA credential registry uses its own explicit MSP selector. It must name
# the organization that issued HLF_CERTIFICATE; falling back to Org1MSP while
# using a Host1MSP certificate produces a malformed Fabric creator identity.
ICA_FABRIC_MSP_ID=${LEDGER_MSP_ID_VALUE}
LEDGER_FABRIC_ITEM_TYPE=credential
LEDGER_ORG_CHAINCODE=organization-sc
LEDGER_CRYPTOGRAPHIC_KEY_CHAINCODE=cryptographickey-sc
LEDGER_SUBJECT_KEY_BINDING_CHAINCODE=subjectkeybinding-sc
LEDGER_ROLE_LICENSE_CHAINCODE=rolelicense-sc
LEDGER_ARTIFACT_CHAINCODE=artifact-sc
LEDGER_ARTIFACT_EVENT_CHAINCODE=artifactevent-sc
LEDGER_EVIDENCE_CHAINCODE=evidence-sc
LEDGER_IDENTITY_CHANNEL_DEFAULT=${IDENTITY_CHANNEL_NAME}
AS_LOCAL_HOST=true
HLF_DATA_CHANNEL_NAME=${CHANNEL_NAME}
HLF_IDENTITY_CHANNEL_NAME=${IDENTITY_CHANNEL_NAME}
HLF_RESEARCH_CHANNEL_NAME=${RESEARCH_CHANNEL_NAME}
HLF_BOOTSTRAP_CHANNELS=${BOOTSTRAP_CHANNELS_VALUE}
HLF_MSP_ID_ORG1=${LEDGER_MSP_ID_VALUE}
HLF_CONNECTION_PEER=${FABRIC_PEER_ENDPOINT_VALUE}
HLF_CONNECTION_PEM=$(to_env_one_line_pem "${ORG1_PEER_TLS_CA}")
HLF_CERTIFICATE=$(to_env_one_line_pem "${ORG1_ADMIN_CERT}")
HLF_PRIVATE_KEY=$(to_env_one_line_pem "${ORG1_ADMIN_KEY}")
CONSENT_ACCESS_LEDGER_CHAINCODE=${CONSENT_CHAINCODE_NAME}
FHIR_VERSION_LEDGER_CHAINCODE=fhir-versioning
HLF_CHANNEL_NAME=${CHANNEL_NAME}
HOST_JURISDICTION=${HOST_JURISDICTION_VALUE}
ICA_JURISDICTION=${HOST_JURISDICTION_VALUE}
JURISDICTION=${TENANT_JURISDICTION_VALUE}
DEFAULT_SECTOR=${SECTOR_VALUE}
EOF

if [[ -n "${ICA_URL_EXTERNAL_VALUE}" ]]; then
  cat >> "${OUT_ENV}" <<EOF
ICA_URL_EXTERNAL=${ICA_URL_EXTERNAL_VALUE}
EOF
fi

deduplicate_env_assignments "${OUT_ENV}"
duplicate_keys="$(awk -F= '
  /^[A-Za-z_][A-Za-z0-9_]*=/ { count[$1]++ }
  END { for (key in count) if (count[key] > 1) print key }
' "${OUT_ENV}")"
[[ -z "${duplicate_keys}" ]] || fail "Generated local Fabric env contains duplicate keys: ${duplicate_keys}"

cat <<EOF
Wrote ${OUT_ENV}

Consent access local Fabric env:
  animal data channel:${CHANNEL_NAME}
  identity channel:   ${IDENTITY_CHANNEL_NAME}
  research channel:   ${RESEARCH_CHANNEL_NAME}
  bootstrap channels: ${BOOTSTRAP_CHANNELS_VALUE}
  sector:     ${SECTOR_VALUE}
  host jurisdiction:${HOST_JURISDICTION_VALUE}
  tenant jurisdiction:${TENANT_JURISDICTION_VALUE}
  mspId:      ${LEDGER_MSP_ID_VALUE}
  chaincode:  ${CONSENT_CHAINCODE_NAME}
  peer:       ${FABRIC_PEER_ENDPOINT_VALUE}

Run GW VetChain with:
  cd ${ROOT}
  npm run api:local-fabric
EOF

cp "${OUT_ENV}" "${LEGACY_OUT_ENV}"
printf 'Wrote compatibility alias %s\n' "${LEGACY_OUT_ENV}"
