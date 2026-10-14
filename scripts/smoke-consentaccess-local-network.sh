#!/usr/bin/env bash
set -euo pipefail

# This smoke is intentionally didactic:
# 1. submit three distinct consent entries
# 2. verify that GW CORE derives three atomic blockchain rules
# 3. verify that each rule becomes one independent on-chain asset
# 4. submit a second bundle where the first rule is repeated on purpose
# 5. verify that the smart contract keeps a single history revision for that
#    repeated rule id, proving the duplicate write became a no-op

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=/dev/null
source "${ROOT_DIR}/scripts/payload-helpers.sh"

BASE_URL="${BASE_URL:-http://localhost:3000}"
TENANT_ID="${TENANT_ID:-acme-id}"
JURISDICTION="${JURISDICTION:-ES}"
SECTOR="${SECTOR:-health-care}"
SECTION="${SECTION:-individual}"
FORMAT="${FORMAT:-org.hl7.fhir.r4}"
RESOURCE_TYPE="${RESOURCE_TYPE:-Consent}"
ACTION="${ACTION:-_batch}"
CHANNEL_NAME="${CHANNEL_NAME:-health-care-local}"
CHAINCODE_NAME="${CHAINCODE_NAME:-consentaccess-sc}"
FABRIC_TOOLS_CONTAINER="${FABRIC_TOOLS_CONTAINER:-gdc-fabric-tools}"
ORG1_DOMAIN="${ORG1_DOMAIN:-host1.example.com}"
ORG1_MSP_ID="${ORG1_MSP_ID:-Host1MSP}"
SUBJECT_ID="${SUBJECT_ID:-did:web:api.acme-id.org:individual:subject-001}"
THID="${THID:-consentaccess-local-network-three-consents}"
DUPLICATE_THID="${DUPLICATE_THID:-consentaccess-local-network-three-consents-duplicate}"

for cmd in curl jq docker; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "ERROR: missing $cmd"; exit 2; }
done

CONSENT_ENDPOINT="${BASE_URL}/${TENANT_ID}/cds-${JURISDICTION}/v1/${SECTOR}/${SECTION}/${FORMAT}/${RESOURCE_TYPE}/${ACTION}"
POLL_ENDPOINT="${CONSENT_ENDPOINT}-response"

ORG1_ADMIN_MSP="/workspace/organizations/peerOrganizations/${ORG1_DOMAIN}/users/Admin@${ORG1_DOMAIN}/msp"
ORG1_PEER_TLS="/workspace/organizations/peerOrganizations/${ORG1_DOMAIN}/peers/peer0.${ORG1_DOMAIN}/tls/ca.crt"

function query_rule_asset() {
  local rule_id="$1"
  docker exec "${FABRIC_TOOLS_CONTAINER}" bash -lc \
    "CORE_PEER_LOCALMSPID=${ORG1_MSP_ID} \
CORE_PEER_MSPCONFIGPATH=${ORG1_ADMIN_MSP} \
CORE_PEER_ADDRESS=peer0-host1:7051 \
CORE_PEER_TLS_ENABLED=true \
CORE_PEER_TLS_ROOTCERT_FILE=${ORG1_PEER_TLS} \
peer chaincode query -C ${CHANNEL_NAME} -n ${CHAINCODE_NAME} -c '{\"Args\":[\"ReadConsentAccess\",\"${rule_id}\"]}'"
}

function query_rule_history() {
  local rule_id="$1"
  docker exec "${FABRIC_TOOLS_CONTAINER}" bash -lc \
    "CORE_PEER_LOCALMSPID=${ORG1_MSP_ID} \
CORE_PEER_MSPCONFIGPATH=${ORG1_ADMIN_MSP} \
CORE_PEER_ADDRESS=peer0-host1:7051 \
CORE_PEER_TLS_ENABLED=true \
CORE_PEER_TLS_ROOTCERT_FILE=${ORG1_PEER_TLS} \
peer chaincode query -C ${CHANNEL_NAME} -n ${CHAINCODE_NAME} -c '{\"Args\":[\"GetConsentAccessHistory\",\"${rule_id}\"]}'"
}

function wait_for_rule_asset() {
  local rule_id="$1"
  local asset_json=''
  for _ in $(seq 1 10); do
    if asset_json="$(query_rule_asset "${rule_id}" 2>/dev/null)"; then
      printf '%s' "${asset_json}"
      return 0
    fi
    sleep 1
  done

  echo "ERROR: timed out waiting for rule asset ${rule_id} on ${CHANNEL_NAME}" >&2
  return 1
}

function render_consentaccess_payload() {
  local payload_name="$1"
  (
    export SUBJECT_ID THID
    render_demo_consentaccess_payload "$payload_name"
  )
}

function render_duplicate_consentaccess_payload() {
  local payload_name="$1"
  (
    export SUBJECT_ID
    export THID="$DUPLICATE_THID"
    render_demo_consentaccess_payload "$payload_name"
  )
}

echo "[smoke-consentaccess] rendering canonical consent bundle from common-utils fixtures"
request_payload="$(render_consentaccess_payload CONSENT_BATCH_REQUEST)"
rule_ids_json="$(render_consentaccess_payload RULE_ID_LIST)"
expected_rule_count="$(jq 'length' <<<"${rule_ids_json}")"
duplicate_request_payload="$(render_duplicate_consentaccess_payload CONSENT_BATCH_REQUEST_DUPLICATE)"
duplicate_rule_ids_json="$(render_duplicate_consentaccess_payload RULE_ID_LIST_DUPLICATE)"
duplicate_rule_count="$(jq 'length' <<<"${duplicate_rule_ids_json}")"
repeated_rule_id="$(jq -r '.[0]' <<<"${duplicate_rule_ids_json}")"

echo "[smoke-consentaccess] POST ${CONSENT_ENDPOINT}"
curl -sS -X POST "${CONSENT_ENDPOINT}" \
  -H 'Content-Type: application/json' \
  --data-binary "${request_payload}" \
  >/dev/null

echo "[smoke-consentaccess] polling ${POLL_ENDPOINT}"
poll_result=''
for _ in $(seq 1 15); do
  poll_result="$(curl -sS "${POLL_ENDPOINT}?thid=${THID}")"
  if [[ -n "${poll_result}" ]] && [[ "$(jq -r '.status? // empty' <<<"${poll_result}")" != 'PENDING' ]]; then
    break
  fi
  sleep 1
done

actual_status_count="$(jq '[.data[]?.response?.status == "201"] | map(select(. == true)) | length' <<<"${poll_result}")"
if [[ "${actual_status_count}" != "${expected_rule_count}" ]]; then
  echo "ERROR: expected ${expected_rule_count} successful Consent responses but got ${actual_status_count}"
  echo "${poll_result}"
  exit 1
fi

echo "[smoke-consentaccess] verifying ${expected_rule_count} independent rule assets on ${CHANNEL_NAME}"
for rule_id in $(jq -r '.[]' <<<"${rule_ids_json}"); do
  asset_json="$(wait_for_rule_asset "${rule_id}")"
  jq -e --arg rule_id "${rule_id}" \
    '.id == $rule_id and (.data | length) == 1 and .data[0].id == $rule_id' \
    <<<"${asset_json}" >/dev/null
  echo "[smoke-consentaccess] verified rule asset ${rule_id}"
done

echo "[smoke-consentaccess] POST duplicate batch ${CONSENT_ENDPOINT}"
curl -sS -X POST "${CONSENT_ENDPOINT}" \
  -H 'Content-Type: application/json' \
  --data-binary "${duplicate_request_payload}" \
  >/dev/null

echo "[smoke-consentaccess] polling duplicate batch ${POLL_ENDPOINT}"
duplicate_poll_result=''
for _ in $(seq 1 15); do
  duplicate_poll_result="$(curl -sS "${POLL_ENDPOINT}?thid=${DUPLICATE_THID}")"
  if [[ -n "${duplicate_poll_result}" ]] && [[ "$(jq -r '.status? // empty' <<<"${duplicate_poll_result}")" != 'PENDING' ]]; then
    break
  fi
  sleep 1
done

duplicate_status_count="$(jq '[.data[]?.response?.status == "201"] | map(select(. == true)) | length' <<<"${duplicate_poll_result}")"
if [[ "${duplicate_status_count}" != "${duplicate_rule_count}" ]]; then
  echo "ERROR: expected ${duplicate_rule_count} successful duplicate Consent responses but got ${duplicate_status_count}"
  echo "${duplicate_poll_result}"
  exit 1
fi

echo "[smoke-consentaccess] verifying second batch assets and duplicate no-op behavior"
for rule_id in $(jq -r '.[]' <<<"${duplicate_rule_ids_json}"); do
  asset_json="$(wait_for_rule_asset "${rule_id}")"
  jq -e --arg rule_id "${rule_id}" \
    '.id == $rule_id and (.data | length) == 1 and .data[0].id == $rule_id' \
    <<<"${asset_json}" >/dev/null
  echo "[smoke-consentaccess] verified rule asset ${rule_id}"
done

repeated_rule_history="$(query_rule_history "${repeated_rule_id}")"
repeated_rule_history_length="$(jq 'length' <<<"${repeated_rule_history}")"
if [[ "${repeated_rule_history_length}" != "1" ]]; then
  echo "ERROR: expected duplicate rule ${repeated_rule_id} to keep a single blockchain revision but got ${repeated_rule_history_length}"
  echo "${repeated_rule_history}"
  exit 1
fi

combined_unique_rule_count="$(jq -s 'add | unique | length' <<<"${rule_ids_json}
${duplicate_rule_ids_json}")"
echo "[smoke-consentaccess] success: first batch ${expected_rule_count} rules, second batch ${duplicate_rule_count} rules, unique on-chain rule assets ${combined_unique_rule_count}"
