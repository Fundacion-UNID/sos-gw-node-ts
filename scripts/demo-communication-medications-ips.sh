#!/usr/bin/env bash
set -euo pipefail

# This demo is intentionally layered:
# 1. optionally prepare the canonical individual baseline
# 2. ingest two medication-bearing Communications
# 3. verify MedicationStatement search
# 4. verify IPS Bundle search
#
# By default the script bootstraps the individual first because most local demos
# need the subject to exist. Pass `--no-create-individual` to exercise negative
# paths where the clinical ingestion should fail because the individual does not
# exist yet.

source "$(dirname "${BASH_SOURCE[0]}")/payload-helpers.sh"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
LOCAL_FABRIC_ENV_FILE="${PROJECT_ROOT}/.env.local-fabric"
DEFAULT_LOCAL_FABRIC_TENANT_ID='acme-id'
CREATE_INDIVIDUAL_BY_DEFAULT='true'

BASE_URL="${BASE_URL:-http://localhost:3000}"
if [[ -f "${LOCAL_FABRIC_ENV_FILE}" ]]; then
  TENANT_ID="${TENANT_ID:-${E2E_TENANT_ID:-$DEFAULT_LOCAL_FABRIC_TENANT_ID}}"
else
  TENANT_ID="${TENANT_ID:-${E2E_TENANT_ID:-acme}}"
fi
JURISDICTION="${JURISDICTION:-${E2E_JURISDICTION:-ES}}"
SECTOR="${SECTOR:-${E2E_SECTOR:-health-care}}"
AUTH_BEARER="${AUTH_BEARER:-demo-token}"
SUBJECT_ID="${SUBJECT_ID:-did:web:api.${TENANT_ID}.org:individual:subject-001}"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-create-individual)
      CREATE_INDIVIDUAL_BY_DEFAULT='false'
      shift
      ;;
    *)
      echo "ERROR: unsupported argument '$1'"
      echo "Usage: demo-communication-medications-ips.sh [--no-create-individual]"
      exit 2
      ;;
  esac
done

THID_COMM="comm-medications-$(date +%s)"
THID_COMM_2="comm-medications-2-$(date +%s)"
THID_MED_SEARCH="medications-search-$(date +%s)"
THID_IPS_SEARCH="ips-search-$(date +%s)"

COMM_URL="$BASE_URL/$TENANT_ID/cds-$JURISDICTION/v1/$SECTOR/individual/org.hl7.fhir.r4/Communication/_batch"
COMM_POLL_URL="$BASE_URL/$TENANT_ID/cds-$JURISDICTION/v1/$SECTOR/individual/org.hl7.fhir.r4/Communication/_batch-response"
MED_SEARCH_URL="$BASE_URL/$TENANT_ID/cds-$JURISDICTION/v1/$SECTOR/individual/org.hl7.fhir.api/MedicationStatement/_search"
MED_SEARCH_POLL_URL="$BASE_URL/$TENANT_ID/cds-$JURISDICTION/v1/$SECTOR/individual/org.hl7.fhir.api/MedicationStatement/_batch-response"
IPS_SEARCH_URL="$BASE_URL/$TENANT_ID/cds-$JURISDICTION/v1/$SECTOR/individual/org.hl7.fhir.r4/Bundle/_search"
IPS_SEARCH_POLL_URL="$BASE_URL/$TENANT_ID/cds-$JURISDICTION/v1/$SECTOR/individual/org.hl7.fhir.r4/Bundle/_search-response"

poll_async() {
  local url="$1"
  local thid="$2"
  local attempts="${3:-40}"
  local sleep_s="${4:-1}"
  for _ in $(seq 1 "$attempts"); do
    local body
    body="$(curl -sS -X POST "$url" -H "Content-Type: application/json" -d "{\"thid\":\"$thid\"}")"
    local status
    status="$(echo "$body" | jq -r '.status // .body.status // empty')"
    if [[ "$status" != "202" && "$status" != "PENDING" && "$status" != "pending" ]]; then
      echo "$body"
      return 0
    fi
    sleep "$sleep_s"
  done
  echo "{\"status\":500,\"issues\":{\"issue\":[{\"diagnostics\":\"Timeout polling thid=$thid\"}]}}"
    return 1
}

if [[ "${CREATE_INDIVIDUAL_BY_DEFAULT}" == 'true' ]]; then
  echo "[0/5] Preparing canonical individual baseline..."
  BASE_URL="${BASE_URL}" \
  TENANT_ID="${TENANT_ID}" \
  JURISDICTION="${JURISDICTION}" \
  SECTOR="${SECTOR}" \
  AUTH_BEARER="${AUTH_BEARER}" \
  EXPECTED_SUBJECT_ID="${SUBJECT_ID}" \
  bash "${SCRIPT_DIR}/demo-create-individual-organization.sh"
else
  echo "[0/4] Skipping individual bootstrap by request (--no-create-individual)"
fi

echo "[1/4] Rendering canonical synthetic demo payloads..."

render_demo_payload_with_runtime() {
  local payload_name="$1"
  local medication_case_index="${2:-0}"
  (
    export SUBJECT_ID THID_COMM THID_MED_SEARCH THID_IPS_SEARCH
    export MEDICATION_CASE_INDEX="$medication_case_index"
    render_demo_payload "$payload_name"
  )
}

render_demo_payload_with_runtime_2() {
  local payload_name="$1"
  local medication_case_index="${2:-1}"
  (
    export SUBJECT_ID THID_MED_SEARCH THID_IPS_SEARCH
    export THID_COMM="$THID_COMM_2"
    export MEDICATION_CASE_INDEX="$medication_case_index"
    render_demo_payload "$payload_name"
  )
}

COMM_REQ="$(render_demo_payload_with_runtime COMMUNICATION_BATCH)"
COMM_REQ_2="$(render_demo_payload_with_runtime_2 COMMUNICATION_BATCH)"

COMM_SUBMIT="$(curl -sS -X POST "$COMM_URL" \
  -H "Authorization: Bearer $AUTH_BEARER" \
  -H "Content-Type: application/json" \
  -d "$COMM_REQ")"
echo "$COMM_SUBMIT" | jq '.'

COMM_SUBMIT_2="$(curl -sS -X POST "$COMM_URL" \
  -H "Authorization: Bearer $AUTH_BEARER" \
  -H "Content-Type: application/json" \
  -d "$COMM_REQ_2")"
echo "$COMM_SUBMIT_2" | jq '.'

echo "[2/4] Polling Communication/_batch-response..."
COMM_DONE="$(poll_async "$COMM_POLL_URL" "$THID_COMM")"
echo "$COMM_DONE" | jq '.'
COMM_DONE_2="$(poll_async "$COMM_POLL_URL" "$THID_COMM_2")"
echo "$COMM_DONE_2" | jq '.'

echo "[3/4] Searching MedicationStatement/_search..."
MED_SEARCH_REQ="$(render_demo_payload_with_runtime MEDICATION_SEARCH)"
MED_SUBMIT="$(curl -sS -X POST "$MED_SEARCH_URL" \
  -H "Authorization: Bearer $AUTH_BEARER" \
  -H "Content-Type: application/json" \
  -d "$MED_SEARCH_REQ")"
echo "$MED_SUBMIT" | jq '.'

echo "[3/4] Polling MedicationStatement search..."
MED_DONE="$(poll_async "$MED_SEARCH_POLL_URL" "$THID_MED_SEARCH")"
echo "$MED_DONE" | jq '.'

echo "[4/4] Searching IPS Bundle/_search by subject + IPS document type..."
IPS_SEARCH_REQ="$(render_demo_payload_with_runtime IPS_SEARCH)"
IPS_SUBMIT="$(curl -sS -X POST "$IPS_SEARCH_URL" \
  -H "Authorization: Bearer $AUTH_BEARER" \
  -H "Content-Type: application/json" \
  -d "$IPS_SEARCH_REQ")"
echo "$IPS_SUBMIT" | jq '.'

echo "[4/4] Polling IPS Bundle search..."
IPS_DONE="$(poll_async "$IPS_SEARCH_POLL_URL" "$THID_IPS_SEARCH")"
echo "$IPS_DONE" | jq '.'
