#!/usr/bin/env bash
set -euo pipefail

# This script creates the canonical legacy-compatible "individual organization"
# used by local GW CORE demos that need a concrete subject before they ingest
# clinical payloads such as Communication, MedicationStatement or Consent.
#
# Why this exists as a standalone script:
# - many local demos need the individual baseline but do not need medications
# - negative tests may want to skip this bootstrap on purpose
# - the canonical transport for this flow is `individual/org.schema/Organization`
#   and not the older `individual/org.schema/Person` alias
#
# Flow performed here:
# 1. submit `FAMILY_REGISTRATION_REQUEST` to `.../individual/org.schema/Organization/_transaction`
# 2. poll `_transaction-response` until an Offer arrives
# 3. submit `FAMILY_ORDER_REQUEST` with that exact `org.schema.Offer.identifier`
# 4. poll the Order response until the legacy order is confirmed
#
# The resulting local demos conventionally use:
# - tenant: `acme-id`
# - jurisdiction: `ES`
# - sector: supplied by the caller (`animal-care` in the VetChain release smoke)
# - expected subject DID: `did:web:api.<tenant>.org:individual:subject-001`

source "$(dirname "${BASH_SOURCE[0]}")/payload-helpers.sh"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
LOCAL_FABRIC_ENV_FILE="${PROJECT_ROOT}/.env.local-fabric"
DEFAULT_LOCAL_FABRIC_TENANT_ID='acme-id'

BASE_URL="${BASE_URL:-http://localhost:3000}"
if [[ -f "${LOCAL_FABRIC_ENV_FILE}" ]]; then
  TENANT_ID="${TENANT_ID:-${E2E_TENANT_ID:-$DEFAULT_LOCAL_FABRIC_TENANT_ID}}"
else
  TENANT_ID="${TENANT_ID:-${E2E_TENANT_ID:-acme}}"
fi
JURISDICTION="${JURISDICTION:-${E2E_JURISDICTION:-ES}}"
SECTOR="${SECTOR:-${E2E_SECTOR:-health-care}}"
AUTH_BEARER="${AUTH_BEARER:-demo-token}"

INDIVIDUAL_CONTROLLER_EMAIL="${INDIVIDUAL_CONTROLLER_EMAIL:-adult1@example.com}"
INDIVIDUAL_CONTROLLER_PHONE="${INDIVIDUAL_CONTROLLER_PHONE:-}"
INDIVIDUAL_MEMBER_EMAIL="${INDIVIDUAL_MEMBER_EMAIL:-child1@example.com}"
INDIVIDUAL_ORGANIZATION_IDENTIFIER="${INDIVIDUAL_ORGANIZATION_IDENTIFIER:-00000000-0000-4000-8000-000000000001}"
INDIVIDUAL_MEMBER_IDENTIFIER="${INDIVIDUAL_MEMBER_IDENTIFIER:-00000000-0000-4000-8000-000000000002}"
INDIVIDUAL_ALTERNATE_NAME="${INDIVIDUAL_ALTERNATE_NAME:-Doraemon}"
INDIVIDUAL_UHC_ID="${INDIVIDUAL_UHC_ID:-}"
INDIVIDUAL_CONTROLLER_GIVEN_NAME="${INDIVIDUAL_CONTROLLER_GIVEN_NAME:-Dora}"
INDIVIDUAL_CONTROLLER_FAMILY_NAME="${INDIVIDUAL_CONTROLLER_FAMILY_NAME:-Nobi}"
INDIVIDUAL_CONTROLLER_ID_NUMBER="${INDIVIDUAL_CONTROLLER_ID_NUMBER:-ID-DEMO-DORAEMON-001}"
INDIVIDUAL_CONTROLLER_COUNTRY="${INDIVIDUAL_CONTROLLER_COUNTRY:-ES}"
INDIVIDUAL_CONTROLLER_CITY="${INDIVIDUAL_CONTROLLER_CITY:-Madrid}"
INDIVIDUAL_CONTROLLER_ADDRESS="${INDIVIDUAL_CONTROLLER_ADDRESS:-Calle Demo 1}"
INDIVIDUAL_CONTROLLER_POSTAL_CODE="${INDIVIDUAL_CONTROLLER_POSTAL_CODE:-28001}"
INDIVIDUAL_CONTROLLER_BIRTHDATE="${INDIVIDUAL_CONTROLLER_BIRTHDATE:-1985-01-01}"
INDIVIDUAL_CONTROLLER_GENDER="${INDIVIDUAL_CONTROLLER_GENDER:-F}"
CANONICAL_KYC_VERIFIED_AT="$(node --input-type=module -e \
  "import { EXAMPLE_KYC_CONTROLLER_VERIFIED_AT } from 'gdc-common-utils-ts/examples/shared'; process.stdout.write(EXAMPLE_KYC_CONTROLLER_VERIFIED_AT)")"
INDIVIDUAL_MEMBER_BIRTHDATE="${INDIVIDUAL_MEMBER_BIRTHDATE:-2010-01-01}"
INDIVIDUAL_KYC_VERIFIED_AT="${INDIVIDUAL_KYC_VERIFIED_AT:-$CANONICAL_KYC_VERIFIED_AT}"
INDIVIDUAL_SIGNATURE_FLOW="${INDIVIDUAL_SIGNATURE_FLOW:-otp}"
SIGNED_INDIVIDUAL_FORM_PDF_BASE64="${SIGNED_INDIVIDUAL_FORM_PDF_BASE64:-JVBERi0xLjQKMSAwIG9iago8PCAvVHlwZSAvQ2F0YWxvZyAvUGFnZXMgMiAwIFIgPj4KZW5kb2JqCjIgMCBvYmoKPDwgL1R5cGUgL1BhZ2VzIC9LaWRzIFszIDAgUl0gL0NvdW50IDEgPj4KZW5kb2JqCjMgMCBvYmoKPDwgL1R5cGUgL1BhZ2UgL1BhcmVudCAyIDAgUiAvTWVkaWFCb3ggWzAgMCAzMDAgMjAwXSAvQ29udGVudHMgNCAwIFIgL1Jlc291cmNlcyA8PCAvRm9udCA8PCAvRjEgNSAwIFIgPj4+PiA+PgplbmRvYmoKNCAwIG9iago8PCAvTGVuZ3RoIDQ0ID4+CnN0cmVhbQpCVAovRjEgMjQgVGYKMTAwIDEwMCBUZAooSGVsbG8gUERGKSBUagoKRVQKZW5kc3RyZWFtCmVuZG9iago1IDAgb2JqCjw8IC9UeXBlIC9Gb250IC9TdWJ0eXBlIC9UeXBlMSAvQmFzZUZvbnQgL0hlbHZldGljYSA+PgplbmRvYmoKeHJlZgowIDYKMDAwMDAwMDAwMCA2NTUzNSBmIAowMDAwMDAwMDEwIDAwMDAwIG4gCjAwMDAwMDAwNTMgMDAwMDAgbiAKMDAwMDAwMDEwNiAwMDAwMCBuIAowMDAwMDAwMjU1IDAwMDAwIG4gCjAwMDAwMDAzNDMgMDAwMDAgbiAKdHJhaWxlcgo8PCAvU2l6ZSA2IC9Sb290IDEgMCBSID4+CnN0YXJ0eHJlZgo0MDMKJSVFT0Y=}"
EXPECTED_SUBJECT_ID="${EXPECTED_SUBJECT_ID:-did:web:api.${TENANT_ID}.org:individual:subject-001}"

REGISTRATION_THID="${REGISTRATION_THID:-family-registration-thread-$(date +%s)}"
ORDER_THID="${ORDER_THID:-family-order-thread-$(date +%s)}"
REGISTRATION_JTI="${REGISTRATION_JTI:-family-registration-request-$(date +%s)}"
ORDER_JTI="${ORDER_JTI:-family-order-request-$(date +%s)}"
TENANT_DID_WEB="${TENANT_DID_WEB:-did:web:api.${TENANT_ID}.org}"

INDIVIDUAL_ORGANIZATION_BATCH_URL="${BASE_URL}/${TENANT_ID}/cds-${JURISDICTION}/v1/${SECTOR}/individual/org.schema/Organization/_transaction"
INDIVIDUAL_ORGANIZATION_POLL_URL="${BASE_URL}/${TENANT_ID}/cds-${JURISDICTION}/v1/${SECTOR}/individual/org.schema/Organization/_transaction-response"
INDIVIDUAL_ORDER_BATCH_URL="${BASE_URL}/${TENANT_ID}/cds-${JURISDICTION}/v1/${SECTOR}/individual/org.schema/Order/_batch"
INDIVIDUAL_ORDER_POLL_URL="${BASE_URL}/${TENANT_ID}/cds-${JURISDICTION}/v1/${SECTOR}/individual/org.schema/Order/_batch-response"

for cmd in curl jq node; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "ERROR: missing $cmd"; exit 2; }
done

poll_async() {
  local url="$1"
  local thid="$2"
  local attempts="${3:-40}"
  local sleep_s="${4:-1}"
  for _ in $(seq 1 "$attempts"); do
    local body
    body="$(curl -sS -X POST "$url" -H 'Content-Type: application/json' -d "{\"thid\":\"$thid\"}")"
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

echo "[individual] Rendering canonical individual-organization registration payload..."
registration_fixture="FAMILY_REGISTRATION_REQUEST"
registration_overrides="$(jq -n \
  --arg jti "$REGISTRATION_JTI" \
  --arg thid "$REGISTRATION_THID" \
  --arg iss "${INDIVIDUAL_CONTROLLER_EMAIL:-${INDIVIDUAL_CONTROLLER_PHONE}}" \
  --arg aud "$TENANT_DID_WEB" \
  --arg pdfBase64 "$SIGNED_INDIVIDUAL_FORM_PDF_BASE64" \
  --arg jurisdiction "$JURISDICTION" \
  --arg organizationIdentifier "$INDIVIDUAL_ORGANIZATION_IDENTIFIER" \
  --arg controllerEmail "$INDIVIDUAL_CONTROLLER_EMAIL" \
  --arg controllerPhone "$INDIVIDUAL_CONTROLLER_PHONE" \
  --arg memberEmail "$INDIVIDUAL_MEMBER_EMAIL" \
  --arg memberIdentifier "$INDIVIDUAL_MEMBER_IDENTIFIER" \
  --arg sector "$SECTOR" \
  --arg alternateName "$INDIVIDUAL_ALTERNATE_NAME" \
  --arg uhcId "$INDIVIDUAL_UHC_ID" \
  --arg controllerGivenName "$INDIVIDUAL_CONTROLLER_GIVEN_NAME" \
  --arg controllerFamilyName "$INDIVIDUAL_CONTROLLER_FAMILY_NAME" \
  --arg controllerIdNumber "$INDIVIDUAL_CONTROLLER_ID_NUMBER" \
  --arg controllerCountry "$INDIVIDUAL_CONTROLLER_COUNTRY" \
  --arg controllerCity "$INDIVIDUAL_CONTROLLER_CITY" \
  --arg controllerAddress "$INDIVIDUAL_CONTROLLER_ADDRESS" \
  --arg controllerPostalCode "$INDIVIDUAL_CONTROLLER_POSTAL_CODE" \
  --arg controllerBirthdate "$INDIVIDUAL_CONTROLLER_BIRTHDATE" \
  --arg controllerGender "$INDIVIDUAL_CONTROLLER_GENDER" \
  --arg memberBirthdate "$INDIVIDUAL_MEMBER_BIRTHDATE" \
  --arg kycVerifiedAt "$INDIVIDUAL_KYC_VERIFIED_AT" \
  --arg signatureFlow "$INDIVIDUAL_SIGNATURE_FLOW" \
  '{
    "/jti": $jti,
    "/thid": $thid,
    "/iss": $iss,
    "/aud": $aud,
    "/body/data/0/resource/meta/claims/Organization.address.addressCountry": $jurisdiction,
    "/body/data/0/resource/meta/claims/Organization.identifier.value": $organizationIdentifier,
    "/body/data/0/resource/meta/claims/Organization.owner.email": $controllerEmail,
    "/body/data/0/resource/meta/claims/Organization.owner.telephone": $controllerPhone,
    "/body/data/0/resource/meta/claims/Person.email": $memberEmail,
    "/body/data/0/resource/meta/claims/Person.identifier.value": $memberIdentifier,
    "/body/data/0/resource/meta/claims/Service.category": $sector,
    "/body/data/0/resource/meta/claims/Organization.sameAs": $uhcId,
    "/body/data/0/meta/kyc": {
      "method": $signatureFlow,
      "individualAlternateName": $alternateName,
      "individualBirthDate": $memberBirthdate,
      "controllerEmail": $controllerEmail,
      "profile": {
        "first_name": $controllerGivenName,
        "last_name": $controllerFamilyName,
        "id_number": $controllerIdNumber,
        "country": $controllerCountry,
        "city": $controllerCity,
        "address": $controllerAddress,
        "postal_code": $controllerPostalCode,
        "phone_number": $controllerPhone,
        "birthdate": $controllerBirthdate,
        "gender": $controllerGender,
        "kyc_verified_at": $kycVerifiedAt
      }
    }
  }')"

if [[ -z "${INDIVIDUAL_UHC_ID}" ]]; then
  registration_overrides="$(jq 'del(
    .["/body/data/0/resource/meta/claims/Organization.sameAs"]
  )' <<<"${registration_overrides}")"
fi

if [[ "${INDIVIDUAL_SIGNATURE_FLOW}" == "certificate" ]]; then
  registration_fixture="FAMILY_REGISTRATION_REQUEST_INLINE_BASE64"
  registration_overrides="$(jq \
    --arg pdfBase64 "$SIGNED_INDIVIDUAL_FORM_PDF_BASE64" \
    '. + {"/attachments/0/data/base64": $pdfBase64}' \
    <<<"${registration_overrides}")"
else
  registration_overrides="$(jq \
    '. + {"/attachments": []}' \
    <<<"${registration_overrides}")"
fi

registration_payload="$(render_example_payload "${registration_fixture}" "${registration_overrides}")"

echo "[individual] POST ${INDIVIDUAL_ORGANIZATION_BATCH_URL}"
registration_submit="$(curl -sS -X POST "${INDIVIDUAL_ORGANIZATION_BATCH_URL}" \
  -H "Authorization: Bearer ${AUTH_BEARER}" \
  -H 'Content-Type: application/json' \
  -d "${registration_payload}")"
echo "${registration_submit}" | jq '.'

echo "[individual] Polling ${INDIVIDUAL_ORGANIZATION_POLL_URL}"
registration_done="$(poll_async "${INDIVIDUAL_ORGANIZATION_POLL_URL}" "${REGISTRATION_THID}")"
echo "${registration_done}" | jq '.'

offer_identifier="$(echo "${registration_done}" | jq -r '.body.data[0].resource.meta.claims["org.schema.Offer.identifier"] // .data[0].resource.meta.claims["org.schema.Offer.identifier"] // empty')"
if [[ -z "${offer_identifier}" ]]; then
  echo "ERROR: registration poll did not return org.schema.Offer.identifier"
  exit 1
fi

echo "[individual] Rendering canonical individual order payload..."
order_overrides="$(jq -n \
  --arg jti "$ORDER_JTI" \
  --arg thid "$ORDER_THID" \
  --arg iss "$INDIVIDUAL_CONTROLLER_EMAIL" \
  --arg aud "$TENANT_DID_WEB" \
  --arg offerIdentifier "$offer_identifier" \
  '{
    "/jti": $jti,
      "/thid": $thid,
      "/iss": $iss,
      "/aud": $aud,
          "/body/data/0/resource/meta/claims/org.schema.Order.acceptedOffer.identifier": $offerIdentifier
  }')"
order_payload="$(render_example_payload FAMILY_ORDER_REQUEST "$order_overrides")"

echo "[individual] POST ${INDIVIDUAL_ORDER_BATCH_URL}"
order_submit="$(curl -sS -X POST "${INDIVIDUAL_ORDER_BATCH_URL}" \
  -H "Authorization: Bearer ${AUTH_BEARER}" \
  -H 'Content-Type: application/json' \
  -d "${order_payload}")"
echo "${order_submit}" | jq '.'

echo "[individual] Polling ${INDIVIDUAL_ORDER_POLL_URL}"
order_done="$(poll_async "${INDIVIDUAL_ORDER_POLL_URL}" "${ORDER_THID}")"
echo "${order_done}" | jq '.'
order_status="$(jq -r '.body.data[0].response.status // .data[0].response.status // empty' <<<"${order_done}")"
if [[ "${order_status}" != "201" ]]; then
  echo "ERROR: individual order failed with status ${order_status:-missing}" >&2
  exit 1
fi

echo "[individual] OK: legacy-compatible individual organization prepared"
echo "[individual] Expected subject DID for follow-up demos: ${EXPECTED_SUBJECT_ID}"
