#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/payload-helpers.sh"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
LOCAL_FABRIC_ENV_FILE="${PROJECT_ROOT}/.env.local-fabric"
LOCAL_FABRIC_DEVNET_PRESENT='false'
if [[ -f "${LOCAL_FABRIC_ENV_FILE}" ]]; then
  LOCAL_FABRIC_DEVNET_PRESENT='true'
fi

BASE_URL="${BASE_URL:-http://localhost:3000}"
HOST_AUTHORITY_BASE_URL="${HOST_AUTHORITY_BASE_URL:-${HOST_DEPLOY_URL:-$BASE_URL}}"
AUTH_BEARER="${AUTH_BEARER:-demo-token}"
CONTENT_TYPE="${CONTENT_TYPE:-application/json}"
JURISDICTION="${JURISDICTION:-CA-BC}"
ADDRESS_COUNTRY="${ADDRESS_COUNTRY:-${JURISDICTION%%-*}}"
ADDRESS_REGION="${ADDRESS_REGION:-$JURISDICTION}"
JURISDICTION_LOWER="$(printf '%s' "${JURISDICTION:-CA-BC}" | tr '[:upper:]' '[:lower:]')"
HOST_JURISDICTION="${HOST_JURISDICTION:-CA-BC}"
HOST_JURISDICTION_LOWER="$(printf '%s' "${HOST_JURISDICTION:-CA-BC}" | tr '[:upper:]' '[:lower:]')"
VERSION="${VERSION:-v1}"
NETWORK_MODE_NORMALIZED="$(printf '%s' "${NETWORK_MODE:-}" | tr '[:upper:]' '[:lower:]')"
DEFAULT_HOST_NETWORK="test"
if [[ "$NETWORK_MODE_NORMALIZED" == "local-network" || "$NETWORK_MODE_NORMALIZED" == "test-network" || "$NETWORK_MODE_NORMALIZED" == "network" ]]; then
  DEFAULT_HOST_NETWORK="$NETWORK_MODE_NORMALIZED"
elif [[ "$LOCAL_FABRIC_DEVNET_PRESENT" == 'true' ]]; then
  DEFAULT_HOST_NETWORK="local-network"
fi
HOST_NETWORK="${HOST_NETWORK:-$DEFAULT_HOST_NETWORK}"
HOST_REGISTRY_NETWORK="${HOST_REGISTRY_NETWORK:-$HOST_NETWORK}"
if [[ "$HOST_NETWORK" != "$HOST_REGISTRY_NETWORK" ]]; then
  echo "ERROR: HOST_NETWORK and HOST_REGISTRY_NETWORK must match." >&2
  exit 2
fi
SECTOR="${SECTOR:-animal-care}"
TENANT_ID="${TENANT_ID:-704457076}"
ORGANIZATION_ID_TYPE="${ORGANIZATION_ID_TYPE:-BN}"
ORGANIZATION_ID_VALUE="${ORGANIZATION_ID_VALUE:-$TENANT_ID}"
LEGAL_NAME="${LEGAL_NAME:-CONNECTING SOLUTION & APPLICATIONS LTD.}"
DISPLAY_NAME="${DISPLAY_NAME:-VetChain}"
ORG_URL="${ORG_URL:-beta-gw.vetchain.app}"
ADMIN_EMAIL="${ADMIN_EMAIL:-vetchain-host@connecthealth.info}"
PERSON_OCCUPATION="${PERSON_OCCUPATION:-ISCO-08|1120}"
EMPLOYEE_COUNT="${EMPLOYEE_COUNT:-2}"
SERVICE_IDENTIFIER="${SERVICE_IDENTIFIER:-did:web:api-provider.example.com}"
SERVICE_URL="${SERVICE_URL:-$HOST_AUTHORITY_BASE_URL}"
SERVICE_TYPE="${SERVICE_TYPE:-HostingService}"
SERVICE_AREA_SERVED="${SERVICE_AREA_SERVED:-$JURISDICTION}"
TERMS_OF_SERVICE="${TERMS_OF_SERVICE:-https://example.com/terms}"

# Host onboarding uses the host "registry sector", which is the deployment
# network selector (`test`, `local-network`, `test-network`, `network`), not the business sector.
# For the local Docker Fabric topology, `NETWORK_MODE=local-network`, so the canonical host
# onboarding surface becomes:
# - `/host/cds-<host-jurisdiction>/v1/local-network/registry/...`
# Business resources still use the tenant's business sector, for example:
# - `/<tenantId>/cds-ES/v1/health-care/...`

for cmd in curl jq node; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "ERROR: missing $cmd"; exit 2; }
done

post_json() {
  local url="$1"
  local payload="$2"
  curl -sS -X POST "$url" \
    -H "Content-Type: $CONTENT_TYPE" \
    -H "Authorization: Bearer $AUTH_BEARER" \
    -d "$payload"
}

poll_async() {
  local url="$1"
  local thid="$2"
  post_json "$url" "$(jq -n --arg thid "$thid" '{thid:$thid}')"
}

poll_async_until_complete() {
  local url="$1"
  local thid="$2"
  local response=''
  local status=''

  for _ in $(seq 1 60); do
    response="$(poll_async "$url" "$thid")"
    status="$(echo "$response" | jq -r '.status // .body.status // empty')"
    if [[ "$status" != 'PENDING' ]]; then
      printf '%s' "$response"
      return 0
    fi
    sleep 1
  done

  echo "ERROR: async response remained PENDING for thid='$thid'" >&2
  return 1
}

echo "[bootstrap] ping: $BASE_URL/host/ping"
HOST_PING_URL="${BASE_URL}/host/cds-${HOST_JURISDICTION_LOWER}/${VERSION}/${HOST_REGISTRY_NETWORK}/.well-known/ping"
echo "[bootstrap] ping: $HOST_PING_URL"
ping_body="$(curl -f -sS "$HOST_PING_URL" || true)"
if [[ -z "$ping_body" ]]; then
  echo "ERROR: gateway not reachable at $HOST_PING_URL"
  exit 1
fi

thid_org="thid-org-${ORGANIZATION_ID_VALUE}-$(date +%s)"
org_payload_overrides="$(jq -n \
  --arg thid "$thid_org" \
  --arg iss "$ADMIN_EMAIL" \
  --arg addressCountry "$ADDRESS_COUNTRY" \
  --arg addressRegion "$ADDRESS_REGION" \
  --arg organizationIdType "$ORGANIZATION_ID_TYPE" \
  --arg organizationIdValue "$ORGANIZATION_ID_VALUE" \
  --arg legalName "$LEGAL_NAME" \
  --arg displayName "$DISPLAY_NAME" \
  --argjson employeeCount "$EMPLOYEE_COUNT" \
  --arg orgUrl "$ORG_URL" \
  --arg adminEmail "$ADMIN_EMAIL" \
  --arg personOccupation "$PERSON_OCCUPATION" \
  --arg sector "$SECTOR" \
  --arg serviceIdentifier "$SERVICE_IDENTIFIER" \
  --arg serviceUrl "$SERVICE_URL" \
  --arg serviceType "$SERVICE_TYPE" \
  --arg serviceAreaServed "$SERVICE_AREA_SERVED" \
  --arg termsOfService "$TERMS_OF_SERVICE" \
  '{
    "/thid": $thid,
    "/iss": $iss,
    "/body/data/0/resource/meta/claims/org.schema.Organization.address.addressCountry": $addressCountry,
    "/body/data/0/resource/meta/claims/org.schema.Organization.address.addressRegion": $addressRegion,
    "/body/data/0/resource/meta/claims/org.schema.Organization.identifier.additionalType": $organizationIdType,
    "/body/data/0/resource/meta/claims/org.schema.Organization.identifier.value": $organizationIdValue,
    "/body/data/0/resource/meta/claims/org.schema.Organization.legalName": $legalName,
    "/body/data/0/resource/meta/claims/org.schema.Organization.name": $displayName,
    "/body/data/0/resource/meta/claims/org.schema.Organization.numberOfEmployees.value": $employeeCount,
    "/body/data/0/resource/meta/claims/org.schema.Organization.url": $orgUrl,
    "/body/data/0/resource/meta/claims/org.schema.Person.email": $adminEmail,
    "/body/data/0/resource/meta/claims/org.schema.Person.hasOccupation": $personOccupation,
    "/body/data/0/resource/meta/claims/org.schema.Service.category": $sector,
    "/body/data/0/resource/meta/claims/org.schema.Service.identifier": $serviceIdentifier,
    "/body/data/0/resource/meta/claims/org.schema.Service.url": $serviceUrl,
    "/body/data/0/resource/meta/claims/org.schema.Service.areaServed": $serviceAreaServed,
    "/body/data/0/resource/meta/claims/org.schema.Service.termsOfService": $termsOfService
  } + (if $serviceType != "" then {
    "/body/data/0/resource/meta/claims/org.schema.Service.serviceType": $serviceType
  } else {} end)')"
if [[ -n "${LEGAL_ORGANIZATION_TRANSACTION_JSON:-}" ]]; then
  org_payload="$(printf '%s' "$LEGAL_ORGANIZATION_TRANSACTION_JSON" | jq -c '.payload // error("missing canonical payload")')"
  thid_org="$(printf '%s' "$org_payload" | jq -er '.thid // error("missing canonical payload thid")')"
else
  org_payload="$(render_example_payload ORGANIZATION_REGISTRATION_REQUEST "$org_payload_overrides")"
  org_payload="$(printf '%s' "$org_payload" | HOST_AUTHORITY_BASE_URL="$HOST_AUTHORITY_BASE_URL" node "$SCRIPT_DIR/build-host-authorization-proof.mjs")"
fi

echo "[bootstrap] organization registration (tenantId=$TENANT_ID, ${ORGANIZATION_ID_TYPE}=$ORGANIZATION_ID_VALUE)"
org_create="$(post_json "$BASE_URL/host/cds-$HOST_JURISDICTION/v1/$HOST_REGISTRY_NETWORK/registry/org.schema/Organization/_transaction" "$org_payload")"
echo "$org_create" | jq '.'
org_err="$(echo "$org_create" | jq -r '.body.data[0].response.outcome.issue[0].diagnostics // .data[0].response.outcome.issue[0].diagnostics // .body.issues.issue[0].diagnostics // .issues.issue[0].diagnostics // empty')"
tenant_already_exists='false'
if [[ -n "$org_err" ]]; then
  if [[ "$org_err" == *"already exists"* ]]; then
    tenant_already_exists='true'
  else
    echo "ERROR: organization registration failed: $org_err"
    exit 1
  fi
fi

if [[ -z "$org_err" ]]; then
  org_poll="$(poll_async_until_complete "$BASE_URL/host/cds-$HOST_JURISDICTION/v1/$HOST_REGISTRY_NETWORK/registry/org.schema/Organization/_transaction-response" "$thid_org")"
  echo "$org_poll" | jq '.'
  org_poll_err="$(echo "$org_poll" | jq -r '(
    (.body.data[0].resource.icaResponse.body.issues.issue // .data[0].resource.icaResponse.body.issues.issue // [])
    | map(select(.severity == "error" or .severity == "fatal"))
    | .[0].diagnostics
  ) // .body.data[0].response.outcome.issue[0].diagnostics // .data[0].response.outcome.issue[0].diagnostics // .body.issues.issue[0].diagnostics // .issues.issue[0].diagnostics // empty')"
  if [[ -n "$org_poll_err" && "$org_poll_err" == *"already exists"* ]]; then
    tenant_already_exists='true'
  elif [[ -n "$org_poll_err" ]]; then
    echo "ERROR: organization registration failed: $org_poll_err"
    exit 1
  fi
fi

if [[ "$tenant_already_exists" == 'true' ]]; then
  echo "INFO: tenant already exists, skipping order."
else
  if [[ -z "${org_poll:-}" ]]; then
    echo "ERROR: organization registration did not return an asynchronous result"
    exit 1
  fi
  offer_id="$(echo "$org_poll" | jq -r '.body.data[0].resource.meta.claims["org.schema.Offer.identifier"] // .data[0].resource.meta.claims["org.schema.Offer.identifier"] // empty')"
  if [[ -z "$offer_id" ]]; then
    echo "ERROR: organization registration completed without an Offer identifier"
    exit 1
  fi
  thid_order="thid-order-${ORGANIZATION_ID_VALUE}-$(date +%s)"
  order_payload_overrides="$(jq -n --arg thid "$thid_order" --arg offer "$offer_id" --arg iss "$ADMIN_EMAIL" '{
    "/thid": $thid,
    "/iss": $iss,
    "/body/data/0/resource/meta/claims/org.schema.Order.acceptedOffer.identifier": $offer,
    "/body/data/0/resource/meta/claims/Order.acceptedOffer.identifier": $offer
  }')"
  order_payload="$(render_example_payload ORGANIZATION_ORDER_REQUEST "$order_payload_overrides")"

  echo "[bootstrap] order confirmation"
  order_create="$(post_json "$BASE_URL/host/cds-$HOST_JURISDICTION/v1/$HOST_REGISTRY_NETWORK/registry/org.schema/Order/_batch" "$order_payload")"
  echo "$order_create" | jq '.'
  order_poll="$(poll_async_until_complete "$BASE_URL/host/cds-$HOST_JURISDICTION/v1/$HOST_REGISTRY_NETWORK/registry/org.schema/Order/_batch-response" "$thid_order")"
  echo "$order_poll" | jq '.'
  order_err="$(echo "$order_poll" | jq -r '.body.data[0].response.outcome.issue[0].diagnostics // .data[0].response.outcome.issue[0].diagnostics // .body.issues.issue[0].diagnostics // .issues.issue[0].diagnostics // empty')"
  if [[ -n "$order_err" ]]; then
    echo "ERROR: order confirmation failed: $order_err"
    exit 1
  fi
fi

echo "OK: tenantId='$TENANT_ID' (${ORGANIZATION_ID_TYPE}='$ORGANIZATION_ID_VALUE') ready for individual/org.schema and FHIR flows"
