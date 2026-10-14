#!/usr/bin/env bash
set -euo pipefail

# This smoke validates the full consent-access lifecycle for one atomic rule:
# 1. activate the rule
# 2. revoke that same rule
# 3. reactivate that same rule
# 4. verify that blockchain history now contains exactly three revisions
# 5. print timing metrics for each operation in the local Fabric dev network

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
AUTH_BEARER="${AUTH_BEARER:-demo-token}"
CREATE_INDIVIDUAL_BY_DEFAULT="${CREATE_INDIVIDUAL_BY_DEFAULT:-true}"

ACTIVATE_THID="${ACTIVATE_THID:-consentaccess-lifecycle-activate}"
REVOKE_THID="${REVOKE_THID:-consentaccess-lifecycle-revoke}"
REACTIVATE_THID="${REACTIVATE_THID:-consentaccess-lifecycle-reactivate}"

CONSENT_ENDPOINT="${BASE_URL}/${TENANT_ID}/cds-${JURISDICTION}/v1/${SECTOR}/${SECTION}/${FORMAT}/${RESOURCE_TYPE}/${ACTION}"
POLL_ENDPOINT="${CONSENT_ENDPOINT}-response"

ORG1_ADMIN_MSP="/workspace/organizations/peerOrganizations/${ORG1_DOMAIN}/users/Admin@${ORG1_DOMAIN}/msp"
ORG1_PEER_TLS="/workspace/organizations/peerOrganizations/${ORG1_DOMAIN}/peers/peer0.${ORG1_DOMAIN}/tls/ca.crt"

for cmd in curl jq docker python3; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "ERROR: missing $cmd"; exit 2; }
done

query_rule_asset() {
  local rule_id="$1"
  docker exec "${FABRIC_TOOLS_CONTAINER}" bash -lc \
    "CORE_PEER_LOCALMSPID=${ORG1_MSP_ID} \
CORE_PEER_MSPCONFIGPATH=${ORG1_ADMIN_MSP} \
CORE_PEER_ADDRESS=peer0-host1:7051 \
CORE_PEER_TLS_ENABLED=true \
CORE_PEER_TLS_ROOTCERT_FILE=${ORG1_PEER_TLS} \
peer chaincode query -C ${CHANNEL_NAME} -n ${CHAINCODE_NAME} -c '{\"Args\":[\"ReadConsentAccess\",\"${rule_id}\"]}'"
}

query_rule_history() {
  local rule_id="$1"
  docker exec "${FABRIC_TOOLS_CONTAINER}" bash -lc \
    "CORE_PEER_LOCALMSPID=${ORG1_MSP_ID} \
CORE_PEER_MSPCONFIGPATH=${ORG1_ADMIN_MSP} \
CORE_PEER_ADDRESS=peer0-host1:7051 \
CORE_PEER_TLS_ENABLED=true \
CORE_PEER_TLS_ROOTCERT_FILE=${ORG1_PEER_TLS} \
peer chaincode query -C ${CHANNEL_NAME} -n ${CHAINCODE_NAME} -c '{\"Args\":[\"GetConsentAccessHistory\",\"${rule_id}\"]}'"
}

now_ms() {
  python3 - <<'PY'
import time
print(int(time.time() * 1000))
PY
}

render_lifecycle_payload() {
  local payload_name="$1"
  local thid_value="$2"
  (
    export SUBJECT_ID
    export THID="$thid_value"
    render_demo_consentaccess_payload "$payload_name"
  )
}

poll_until_completed() {
  local thid="$1"
  local attempts="${2:-30}"
  local sleep_s="${3:-1}"
  for _ in $(seq 1 "$attempts"); do
    local body
    body="$(curl -sS "${POLL_ENDPOINT}?thid=${thid}")"
    local status
    status="$(jq -r '.status? // empty' <<<"${body}")"
    if [[ -n "${body}" && "${status}" != 'PENDING' ]]; then
      printf '%s' "${body}"
      return 0
    fi
    sleep "$sleep_s"
  done

  echo "ERROR: timed out polling thid=${thid}" >&2
  return 1
}

wait_for_history_length() {
  local rule_id="$1"
  local expected_length="$2"
  local history_json=''
  for _ in $(seq 1 15); do
    history_json="$(query_rule_history "${rule_id}" 2>/dev/null || true)"
    if [[ -n "${history_json}" ]] && [[ "$(jq 'length' <<<"${history_json}")" == "${expected_length}" ]]; then
      printf '%s' "${history_json}"
      return 0
    fi
    sleep 1
  done

  echo "ERROR: timed out waiting for history length ${expected_length} for ${rule_id}" >&2
  return 1
}

run_lifecycle_step() {
  local label="$1"
  local payload_name="$2"
  local thid_value="$3"
  local expected_history_length="$4"
  local expected_status="$5"
  local rule_id="$6"

  local payload
  payload="$(render_lifecycle_payload "${payload_name}" "${thid_value}")"

  local started_ms
  started_ms="$(now_ms)"
  curl -sS -X POST "${CONSENT_ENDPOINT}" \
    -H "Authorization: Bearer ${AUTH_BEARER}" \
    -H 'Content-Type: application/json' \
    --data-binary "${payload}" \
    >/dev/null
  local submit_done_ms
  submit_done_ms="$(now_ms)"

  local poll_result
  poll_result="$(poll_until_completed "${thid_value}")"
  local completed_ms
  completed_ms="$(now_ms)"

  local success_count
  success_count="$(jq '[.data[]?.response?.status == "201"] | map(select(. == true)) | length' <<<"${poll_result}")"
  if [[ "${success_count}" != "1" ]]; then
    echo "ERROR: expected exactly one successful consent response for ${label}"
    echo "${poll_result}"
    exit 1
  fi

  local asset_json
  asset_json="$(query_rule_asset "${rule_id}")"
  jq -e --arg expected_status "${expected_status}" '.meta.audit.status == $expected_status' <<<"${asset_json}" >/dev/null

  local history_json
  history_json="$(wait_for_history_length "${rule_id}" "${expected_history_length}")"

  jq -n \
    --arg step "${label}" \
    --arg ruleId "${rule_id}" \
    --arg expectedStatus "${expected_status}" \
    --argjson submitMs "$((submit_done_ms - started_ms))" \
    --argjson completionMs "$((completed_ms - started_ms))" \
    --argjson historyLength "$(jq 'length' <<<"${history_json}")" \
    '{
      step: $step,
      ruleId: $ruleId,
      expectedStatus: $expectedStatus,
      submit_ms: $submitMs,
      completion_ms: $completionMs,
      history_length: $historyLength
    }'
}

if [[ "${CREATE_INDIVIDUAL_BY_DEFAULT}" == 'true' ]]; then
  echo "[lifecycle-smoke] preparing canonical individual baseline"
  BASE_URL="${BASE_URL}" \
  TENANT_ID="${TENANT_ID}" \
  JURISDICTION="${JURISDICTION}" \
  SECTOR="${SECTOR}" \
  AUTH_BEARER="${AUTH_BEARER}" \
  EXPECTED_SUBJECT_ID="${SUBJECT_ID}" \
  bash "${ROOT_DIR}/scripts/demo-create-individual-organization.sh"
fi

echo "[lifecycle-smoke] rendering canonical lifecycle rule id"
rule_id="$(render_lifecycle_payload RULE_ID_LIST_LIFECYCLE "${ACTIVATE_THID}" | jq -r '.[0]')"

activate_metrics="$(run_lifecycle_step activate CONSENT_LIFECYCLE_ACTIVATE_REQUEST "${ACTIVATE_THID}" 1 active "${rule_id}")"
revoke_metrics="$(run_lifecycle_step revoke CONSENT_LIFECYCLE_REVOKE_REQUEST "${REVOKE_THID}" 2 revoked "${rule_id}")"
reactivate_metrics="$(run_lifecycle_step reactivate CONSENT_LIFECYCLE_REACTIVATE_REQUEST "${REACTIVATE_THID}" 3 active "${rule_id}")"

echo "[lifecycle-smoke] success"
jq -n \
  --arg network local-network \
  --arg channel "${CHANNEL_NAME}" \
  --arg chaincode "${CHAINCODE_NAME}" \
  --argjson activate "${activate_metrics}" \
  --argjson revoke "${revoke_metrics}" \
  --argjson reactivate "${reactivate_metrics}" \
  '{
    network: $network,
    channel: $channel,
    chaincode: $chaincode,
    operations: [$activate, $revoke, $reactivate]
  }'
