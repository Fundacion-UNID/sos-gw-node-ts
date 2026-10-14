#!/usr/bin/env bash
set -euo pipefail

# This smoke bridges the gap between:
# - consent rules anchored on the local Fabric-backed consent ledger
# - SMART token issuance based on those rules
# - actual endpoint access using the emitted access token
#
# Covered live paths:
# 1. all-sections IPS -> individual consent -> SMART token -> scoped Subject/$summary
# 2. individual consent -> SMART token -> individual Bundle/_search
# 3. research contract + provider consent -> SMART token -> digitaltwin ResearchSubject/_search
# 4. allowed and denied research employees by role and by direct email

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=/dev/null
source "${ROOT_DIR}/scripts/payload-helpers.sh"

BASE_URL="${BASE_URL:-http://localhost:3000}"
TENANT_ID="${TENANT_ID:-acme-id}"
JURISDICTION="${JURISDICTION:-ES}"
SECTOR="${SECTOR:-health-care}"
CHANNEL_NAME="${CHANNEL_NAME:-health-care-local}"
CHAINCODE_NAME="${CHAINCODE_NAME:-consentaccess-sc}"
FABRIC_TOOLS_CONTAINER="${FABRIC_TOOLS_CONTAINER:-gdc-fabric-tools}"
ORG1_DOMAIN="${ORG1_DOMAIN:-host1.example.com}"
ORG1_MSP_ID="${ORG1_MSP_ID:-Host1MSP}"
AUTH_BEARER="${AUTH_BEARER:-demo-token}"
SUBJECT_ID="${SUBJECT_ID:-did:web:api.${TENANT_ID}.org:individual:subject-001}"
PROVIDER_ORGANIZATION_DID="${PROVIDER_ORGANIZATION_DID:-}"
BOOTSTRAP_INDIVIDUAL_AND_DATA="${BOOTSTRAP_INDIVIDUAL_AND_DATA:-true}"
RUN_RESEARCH_SMART_SMOKE="${RUN_RESEARCH_SMART_SMOKE:-true}"

CONSENT_ENDPOINT="${BASE_URL}/${TENANT_ID}/cds-${JURISDICTION}/v1/${SECTOR}/individual/org.hl7.fhir.r4/Consent/_batch"
CONSENT_POLL_ENDPOINT="${CONSENT_ENDPOINT}-response"
SMART_TOKEN_ENDPOINT="${BASE_URL}/${TENANT_ID}/cds-${JURISDICTION}/v1/${SECTOR}/identity/openid/smart/token"
SMART_TOKEN_POLL_ENDPOINT="${BASE_URL}/${TENANT_ID}/cds-${JURISDICTION}/v1/${SECTOR}/identity/openid/smart/_batch-response"
INDIVIDUAL_BUNDLE_SEARCH_ENDPOINT="${BASE_URL}/${TENANT_ID}/cds-${JURISDICTION}/v1/${SECTOR}/individual/org.hl7.fhir.r4/Bundle/_search"
INDIVIDUAL_BUNDLE_SEARCH_POLL_ENDPOINT="${BASE_URL}/${TENANT_ID}/cds-${JURISDICTION}/v1/${SECTOR}/individual/org.hl7.fhir.r4/Bundle/_search-response"
INDIVIDUAL_COMMUNICATION_ENDPOINT="${BASE_URL}/${TENANT_ID}/cds-${JURISDICTION}/v1/${SECTOR}/individual/org.hl7.fhir.r4/Communication/_batch"
INDIVIDUAL_COMMUNICATION_POLL_ENDPOINT="${BASE_URL}/${TENANT_ID}/cds-${JURISDICTION}/v1/${SECTOR}/individual/org.hl7.fhir.r4/Communication/_batch-response"
DIGITAL_TWIN_SEARCH_ENDPOINT="${BASE_URL}/${TENANT_ID}/cds-${JURISDICTION}/v1/${SECTOR}/digitaltwin/org.hl7.fhir.r4/ResearchSubject/_search"
DIGITAL_TWIN_SEARCH_POLL_ENDPOINT="${BASE_URL}/${TENANT_ID}/cds-${JURISDICTION}/v1/${SECTOR}/digitaltwin/org.hl7.fhir.r4/ResearchSubject/_batch-response"

ORG1_ADMIN_MSP="/workspace/organizations/peerOrganizations/${ORG1_DOMAIN}/users/Admin@${ORG1_DOMAIN}/msp"
ORG1_PEER_TLS="/workspace/organizations/peerOrganizations/${ORG1_DOMAIN}/peers/peer0.${ORG1_DOMAIN}/tls/ca.crt"

for cmd in curl jq docker; do
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

wait_for_rule_asset() {
  local rule_id="$1"
  local asset_json=''
  for _ in $(seq 1 15); do
    if asset_json="$(query_rule_asset "${rule_id}" 2>/dev/null)"; then
      printf '%s' "${asset_json}"
      return 0
    fi
    sleep 1
  done

  echo "ERROR: timed out waiting for rule asset ${rule_id}" >&2
  return 1
}

post_json() {
  local url="$1"
  local bearer="$2"
  local payload="$3"
  curl -sS -X POST "${url}" \
    -H "Authorization: Bearer ${bearer}" \
    -H 'Content-Type: application/json' \
    --data-binary "${payload}"
}

poll_async_json() {
  local url="$1"
  local thid="$2"
  local attempts="${3:-40}"
  local sleep_s="${4:-1}"
  for _ in $(seq 1 "${attempts}"); do
    local body
    body="$(curl -sS -X POST "${url}" -H 'Content-Type: application/json' -d "{\"thid\":\"${thid}\"}")"
    local status
    status="$(jq -r '.status? // .body.status? // empty' <<<"${body}")"
    if [[ -n "${body}" && "${status}" != "202" && "${status}" != "PENDING" && "${status}" != "pending" ]]; then
      printf '%s' "${body}"
      return 0
    fi
    sleep "${sleep_s}"
  done
  echo "ERROR: timed out polling ${thid} on ${url}" >&2
  return 1
}

render_smart_payload() {
  local payload_name="$1"
  (
    export TENANT_ID SUBJECT_ID PROVIDER_ORGANIZATION_DID SECTOR
    export SMART_TOKEN_AUDIENCE="${SMART_TOKEN_ENDPOINT}"
    render_demo_smart_access_payload "${payload_name}"
  )
}

submit_consent_batch_and_verify_asset() {
  local payload_name="$1"
  local rule_list_name="$2"

  local request_payload
  request_payload="$(render_smart_payload "${payload_name}")"
  local thid
  thid="$(jq -r '.thid' <<<"${request_payload}")"
  local rule_ids_json
  rule_ids_json="$(render_smart_payload "${rule_list_name}")"
  local expected_rule_count
  expected_rule_count="$(jq 'length' <<<"${rule_ids_json}")"

  echo "[smart-access-smoke] POST consent batch ${payload_name}"
  post_json "${CONSENT_ENDPOINT}" "${AUTH_BEARER}" "${request_payload}" >/dev/null

  local poll_result
  poll_result="$(poll_async_json "${CONSENT_POLL_ENDPOINT}" "${thid}" 30 1)"
  local success_count
  success_count="$(jq '[.data[]?.response?.status == "201"] | map(select(. == true)) | length' <<<"${poll_result}")"
  if [[ "${success_count}" != "${expected_rule_count}" ]]; then
    echo "ERROR: expected ${expected_rule_count} successful consent responses for ${payload_name} but got ${success_count}" >&2
    echo "${poll_result}"
    exit 1
  fi

  for rule_id in $(jq -r '.[]' <<<"${rule_ids_json}"); do
    local asset_json
    asset_json="$(wait_for_rule_asset "${rule_id}")"
    jq -e --arg rule_id "${rule_id}" '.id == $rule_id and (.data | length) == 1 and .data[0].id == $rule_id' <<<"${asset_json}" >/dev/null
    echo "[smart-access-smoke] verified rule asset ${rule_id}"
  done
}

request_smart_token() {
  local payload_name="$1"
  local expect_access_token="$2"

  local request_payload
  request_payload="$(render_smart_payload "${payload_name}")"
  local thid
  thid="$(jq -r '.thid' <<<"${request_payload}")"

  echo "[smart-access-smoke] POST smart token ${payload_name}" >&2
  post_json "${SMART_TOKEN_ENDPOINT}" "mock" "${request_payload}" >/dev/null

  local token_payload
  token_payload="$(poll_async_json "${SMART_TOKEN_POLL_ENDPOINT}" "${thid}" 40 1)"
  local access_token
  access_token="$(jq -r '.access_token // empty' <<<"${token_payload}")"

  if [[ "${expect_access_token}" == "true" ]]; then
    if [[ -z "${access_token}" ]]; then
      echo "ERROR: expected access_token for ${payload_name}" >&2
      echo "${token_payload}" >&2
      exit 1
    fi
  else
    if [[ -n "${access_token}" ]]; then
      echo "ERROR: expected denial for ${payload_name} but received access_token" >&2
      echo "${token_payload}" >&2
      exit 1
    fi
  fi

  printf '%s' "${token_payload}"
}

run_individual_bundle_search_with_token() {
  local access_token="$1"
  local request_payload
  request_payload="$(render_smart_payload INDIVIDUAL_IPS_SEARCH_REQUEST)"
  local thid
  thid="$(jq -r '.thid' <<<"${request_payload}")"

  echo "[smart-access-smoke] POST individual Bundle/_search"
  post_json "${INDIVIDUAL_BUNDLE_SEARCH_ENDPOINT}" "${access_token}" "${request_payload}" >/dev/null

  local search_payload
  search_payload="$(poll_async_json "${INDIVIDUAL_BUNDLE_SEARCH_POLL_ENDPOINT}" "${thid}" 40 1)"
  jq -e '.resourceType == "Bundle" and .data[0].response.status == "200"' <<<"${search_payload}" >/dev/null
  jq -e '.data[0].resource.resourceType == "Bundle" and .data[0].resource.type == "document"' <<<"${search_payload}" >/dev/null
  echo "[smart-access-smoke] verified individual Bundle/_search through SMART token"
}

ingest_individual_all_sections() {
  local request_payload
  request_payload="$(render_smart_payload INDIVIDUAL_ALL_SECTIONS_INGESTION_REQUEST)"
  local thid
  thid="$(jq -r '.thid' <<<"${request_payload}")"
  echo "[smart-access-smoke] POST canonical all-sections IPS"
  post_json "${INDIVIDUAL_COMMUNICATION_ENDPOINT}" "${AUTH_BEARER}" "${request_payload}" >/dev/null
  local ingestion_payload
  ingestion_payload="$(poll_async_json "${INDIVIDUAL_COMMUNICATION_POLL_ENDPOINT}" "${thid}" 60 1)"
  jq -e '.data[0].response.status == "200"' <<<"${ingestion_payload}" >/dev/null || {
    echo "ERROR: canonical all-sections IPS ingestion did not complete" >&2
    echo "${ingestion_payload}" >&2
    return 1
  }
}

run_individual_scoped_summary_with_token() {
  local access_token="$1"
  local request_payload
  request_payload="$(render_smart_payload INDIVIDUAL_SCOPED_SUMMARY_REQUEST)"
  local thid
  thid="$(jq -r '.thid' <<<"${request_payload}")"
  echo "[smart-access-smoke] POST unfiltered Subject/\$summary through section-scoped SMART token"
  post_json "${INDIVIDUAL_COMMUNICATION_ENDPOINT}" "${access_token}" "${request_payload}" >/dev/null
  local summary_payload
  summary_payload="$(poll_async_json "${INDIVIDUAL_COMMUNICATION_POLL_ENDPOINT}" "${thid}" 60 1)"
  jq -e '.data[0].response.status == "200" and .data[0].resource.type == "document"' <<<"${summary_payload}" >/dev/null || {
    echo "ERROR: section-scoped Subject/\$summary did not complete" >&2
    echo "${summary_payload}" >&2
    return 1
  }
  local returned_sections
  returned_sections="$(jq -c '[.data[0].resource.entry[]? | select(.resource.resourceType == "Composition") | .resource.section[]?.code.coding[0].code] | sort' <<<"${summary_payload}")"
  [[ "${returned_sections}" == '["10160-0","11450-4"]' ]] || {
    echo "ERROR: section-scoped Subject/\$summary leaked or omitted sections: ${returned_sections}" >&2
    return 1
  }
  if jq -e '[.data[0].resource.entry[]?.resource.resourceType] | any(. == "AllergyIntolerance" or . == "Immunization" or . == "Observation" or . == "CarePlan")' <<<"${summary_payload}" >/dev/null; then
    echo "ERROR: section-scoped Subject/\$summary leaked an unauthorized clinical resource" >&2
    return 1
  fi
  local returned_document_references
  returned_document_references="$(jq -c '[.data[0].resource.entry[]? | select(.resource.resourceType == "DocumentReference") | .resource.id] | sort' <<<"${summary_payload}")"
  [[ "${returned_document_references}" == '["smart-summary-authorized-medication-document"]' ]] || {
    echo "ERROR: Subject/\$summary leaked or omitted DocumentReference resources: ${returned_document_references}" >&2
    return 1
  }
  jq -e '[.data[0].resource.entry[]?.resource.resourceType] | any(. == "Condition") and any(. == "MedicationStatement")' <<<"${summary_payload}" >/dev/null
  echo "[smart-access-smoke] verified SMART subject and section enforcement at Subject/\$summary"
}

run_digital_twin_search_with_token() {
  local access_token="$1"
  local request_payload
  request_payload="$(render_smart_payload DIGITAL_TWIN_RESEARCH_SUBJECT_SEARCH_REQUEST)"
  local thid
  thid="$(jq -r '.thid' <<<"${request_payload}")"

  echo "[smart-access-smoke] POST digitaltwin ResearchSubject/_search"
  post_json "${DIGITAL_TWIN_SEARCH_ENDPOINT}" "${access_token}" "${request_payload}" >/dev/null

  local search_payload
  search_payload="$(poll_async_json "${DIGITAL_TWIN_SEARCH_POLL_ENDPOINT}" "${thid}" 40 1)"
  if ! jq -e '.resourceType == "Bundle" and .data[0].response.status == "200"' <<<"${search_payload}" >/dev/null; then
    echo "ERROR: digital-twin search did not return a successful batch response" >&2
    echo "${search_payload}" >&2
    return 1
  fi
  if ! jq -e '.data[0].type == "ResearchSubject-search-response-v1.0" and (.data[0].resource.total // 0) >= 1 and .data[0].resource.data[0].resourceType == "ResearchSubject" and .data[0].resource.data[0].contained[0].resourceType == "Composition"' <<<"${search_payload}" >/dev/null; then
    echo "ERROR: digital-twin search returned no R4 ResearchSubject with its contained Composition" >&2
    echo "${search_payload}" >&2
    return 1
  fi
  echo "[smart-access-smoke] verified digitaltwin ResearchSubject/_search with its contained Composition through SMART token"
}

if [[ "${BOOTSTRAP_INDIVIDUAL_AND_DATA}" == "true" ]]; then
  echo "[smart-access-smoke] preparing canonical individual baseline and demo clinical data"
  BASE_URL="${BASE_URL}" \
  TENANT_ID="${TENANT_ID}" \
  JURISDICTION="${JURISDICTION}" \
  SECTOR="${SECTOR}" \
  AUTH_BEARER="${AUTH_BEARER}" \
  SUBJECT_ID="${SUBJECT_ID}" \
  bash "${ROOT_DIR}/scripts/demo-communication-medications-ips.sh"
fi

echo "[smart-access-smoke] verifying individual SMART access"
ingest_individual_all_sections
submit_consent_batch_and_verify_asset INDIVIDUAL_CONSENT_BATCH_REQUEST INDIVIDUAL_RULE_ID_LIST
individual_token_payload="$(request_smart_token INDIVIDUAL_SMART_TOKEN_REQUEST true)"
individual_access_token="$(jq -r '.access_token' <<<"${individual_token_payload}")"
run_individual_scoped_summary_with_token "${individual_access_token}"
run_individual_bundle_search_with_token "${individual_access_token}"

if [[ "${RUN_RESEARCH_SMART_SMOKE}" != "true" ]]; then
  echo "[smart-access-smoke] cross-portal research flow explicitly disabled; this is not a release smoke"
  jq -n \
    --arg subject "${SUBJECT_ID}" \
    --arg channel "${CHANNEL_NAME}" \
    --arg chaincode "${CHAINCODE_NAME}" \
    '{
      subject: $subject,
      channel: $channel,
      chaincode: $chaincode,
      verifiedFlows: ["individual-consent-smart-scoped-summary", "individual-consent-smart-bundle-search"],
      skippedFlows: ["cross-portal-research-smart-access"]
    }'
  exit 0
fi

echo "[smart-access-smoke] seeding research consent rules on ledger"
submit_consent_batch_and_verify_asset RESEARCH_CONSENT_BATCH_REQUEST_ROLE RESEARCH_RULE_ID_LIST_ROLE
submit_consent_batch_and_verify_asset RESEARCH_CONSENT_BATCH_REQUEST_EMAIL RESEARCH_RULE_ID_LIST_EMAIL

echo "[smart-access-smoke] verifying research SMART access allow/deny matrix"
research_role_allow_payload="$(request_smart_token RESEARCH_SMART_TOKEN_REQUEST_ROLE_ALLOW true)"
research_role_allow_token="$(jq -r '.access_token' <<<"${research_role_allow_payload}")"
run_digital_twin_search_with_token "${research_role_allow_token}"

request_smart_token RESEARCH_SMART_TOKEN_REQUEST_ROLE_DENY false >/dev/null

research_email_allow_payload="$(request_smart_token RESEARCH_SMART_TOKEN_REQUEST_EMAIL_ALLOW true)"
research_email_allow_token="$(jq -r '.access_token' <<<"${research_email_allow_payload}")"
run_digital_twin_search_with_token "${research_email_allow_token}"

request_smart_token RESEARCH_SMART_TOKEN_REQUEST_EMAIL_DENY false >/dev/null

echo "[smart-access-smoke] success"
jq -n \
  --arg subject "${SUBJECT_ID}" \
  --arg channel "${CHANNEL_NAME}" \
  --arg chaincode "${CHAINCODE_NAME}" \
  '{
    subject: $subject,
    channel: $channel,
    chaincode: $chaincode,
    verifiedFlows: [
      "individual-consent-smart-scoped-summary",
      "individual-consent-smart-bundle-search",
      "research-contract-consent-smart-digitaltwin-search-role-allow",
      "research-contract-consent-smart-digitaltwin-search-role-deny",
      "research-contract-consent-smart-digitaltwin-search-email-allow",
      "research-contract-consent-smart-digitaltwin-search-email-deny"
    ]
  }'
