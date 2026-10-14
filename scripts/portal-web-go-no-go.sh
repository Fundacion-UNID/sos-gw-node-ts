#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/payload-helpers.sh"

BASE_URL="${BASE_URL:-http://localhost:3000}"
AUTH_BEARER="${AUTH_BEARER:-demo-token}"
JURISDICTION="${JURISDICTION:-ES}"
JURISDICTION_LOWER="$(printf '%s' "${JURISDICTION:-ES}" | tr '[:upper:]' '[:lower:]')"
VERSION="${VERSION:-v1}"
HOST_REGISTRY_NETWORK="${HOST_REGISTRY_NETWORK:-test}"
TENANT_ID="${TENANT_ID:-acme}"
SECTOR="${SECTOR:-health-care}"
CONTENT_TYPE="${CONTENT_TYPE:-application/json}"
ACTIVATION_VP_TOKEN="${ACTIVATION_VP_TOKEN:-<ica-proof-token>}"
SMART_SCOPE="${SMART_SCOPE:-}"
EMPLOYEE_EMAIL="${EMPLOYEE_EMAIL:-doctor1@example.com}"
EMPLOYEE_ROLE="${EMPLOYEE_ROLE:-ISCO-08|2211}"
FAMILY_OWNER_EMAIL="${FAMILY_OWNER_EMAIL:-family@example.com}"

THID_SUFFIX="$(date +%s)"
THID_ACTIVATE="thid-activate-${THID_SUFFIX}"
THID_ORG_OFFER="thid-org-offer-${THID_SUFFIX}"
THID_ORG_ORDER="thid-org-order-${THID_SUFFIX}"
THID_EMPLOYEE="thid-employee-${THID_SUFFIX}"
THID_EXCHANGE="thid-exchange-${THID_SUFFIX}"
THID_DCR="thid-dcr-${THID_SUFFIX}"
THID_SMART="thid-smart-${THID_SUFFIX}"
THID_FAMILY="thid-family-${THID_SUFFIX}"

PASS_COUNT=0
FAIL_COUNT=0
SKIP_COUNT=0
LAST_BODY_FILE="/tmp/gw_check_body.out"

print_result() {
  local status="$1"
  local name="$2"
  local code="$3"
  local detail="$4"
  if [[ "$status" == "PASS" ]]; then
    printf '[PASS] %-45s status=%s %s\n' "$name" "$code" "$detail"
    PASS_COUNT=$((PASS_COUNT + 1))
  elif [[ "$status" == "SKIP" ]]; then
    printf '[SKIP] %-45s status=%s %s\n' "$name" "$code" "$detail"
    SKIP_COUNT=$((SKIP_COUNT + 1))
  else
    printf '[FAIL] %-45s status=%s %s\n' "$name" "$code" "$detail"
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required command: $1"
    exit 2
  }
}

require_cmd curl
require_cmd node
require_cmd jq

call_api() {
  local method="$1"
  local url="$2"
  local body="${3:-}"
  local code
  if [[ -n "$body" ]]; then
    code="$(curl -sS -o "$LAST_BODY_FILE" -w "%{http_code}" -X "$method" "$url" \
      -H "Authorization: Bearer $AUTH_BEARER" \
      -H "Content-Type: $CONTENT_TYPE" \
      -d "$body" || true)"
  else
    code="$(curl -sS -o "$LAST_BODY_FILE" -w "%{http_code}" -X "$method" "$url" || true)"
  fi
  echo "$code"
}

assert_ping() {
  local name="$1"
  local code="$2"
  if [[ "$code" == "200" ]]; then
    print_result "PASS" "$name" "$code" ""
  else
    local snippet
    snippet="$(head -c 180 "$LAST_BODY_FILE" 2>/dev/null || true)"
    print_result "FAIL" "$name" "$code" "expected=200 body='${snippet}'"
  fi
}

assert_route_available() {
  local name="$1"
  local code="$2"
  if [[ "$code" == "000" || "$code" == "404" ]]; then
    local snippet
    snippet="$(head -c 180 "$LAST_BODY_FILE" 2>/dev/null || true)"
    print_result "FAIL" "$name" "$code" "route unavailable body='${snippet}'"
  else
    print_result "PASS" "$name" "$code" ""
  fi
}

extract_json_value() {
  local jq_expr="$1"
  jq -r "$jq_expr // empty" "$LAST_BODY_FILE" 2>/dev/null || true
}

echo "Running Portal Web Go/No-Go checks against:"
echo "  BASE_URL=$BASE_URL"
echo "  tenant=$TENANT_ID jurisdiction=$JURISDICTION sector=$SECTOR host_registry_network=$HOST_REGISTRY_NETWORK"
echo "  mode=route-smoke payloads=canonical-fixtures"
echo

# 1) Ping
CODE="$(call_api GET "$BASE_URL/host/ping")"
assert_ping "Ping host/ping" "$CODE"

CODE="$(call_api GET "$BASE_URL/host/cds-$JURISDICTION_LOWER/$VERSION/$HOST_REGISTRY_NETWORK/.well-known/ping")"
assert_ping "Ping host scoped .well-known/ping" "$CODE"

# 2) Activate submit
ACTIVATE_REQ="$(render_example_payload ORGANIZATION_ACTIVATION_REQUEST "$(jq -n \
  --arg thid "$THID_ACTIVATE" \
  --arg vpToken "$ACTIVATION_VP_TOKEN" \
  '{
    "/thid": $thid,
    "/body/vp_token": $vpToken
  }' )")"
CODE="$(call_api POST \
  "$BASE_URL/host/cds-$JURISDICTION/v1/$HOST_REGISTRY_NETWORK/registry/org.schema/Organization/_activate" \
  "$ACTIVATE_REQ")"
assert_route_available "Organization _activate submit" "$CODE"

# 3) Activate poll
CODE="$(call_api POST \
  "$BASE_URL/host/cds-$JURISDICTION/v1/$HOST_REGISTRY_NETWORK/registry/org.schema/Organization/_activate-response" \
  "{\"thid\":\"$THID_ACTIVATE\"}")"
assert_route_available "Organization _activate poll" "$CODE"

# 4) Organization offer submit (legacy _batch flow)
ORG_OFFER_REQ="$(render_example_payload ORGANIZATION_REGISTRATION_REQUEST "$(jq -n \
  --arg thid "$THID_ORG_OFFER" \
  --arg tenantId "$TENANT_ID" \
  --arg jurisdiction "$JURISDICTION" \
  --arg sector "$SECTOR" \
  --arg employeeEmail "$EMPLOYEE_EMAIL" \
  '{
    "/thid": $thid,
    "/body/data/0/meta/claims/org.schema.Organization.identifier.value": $tenantId,
    "/body/data/0/meta/claims/org.schema.Organization.address.addressCountry": $jurisdiction,
    "/body/data/0/meta/claims/org.schema.Service.category": $sector,
    "/body/data/0/meta/claims/org.schema.Person.email": $employeeEmail
  }' )")"
CODE="$(call_api POST \
  "$BASE_URL/host/cds-$JURISDICTION/v1/$HOST_REGISTRY_NETWORK/registry/org.schema/Organization/_batch" \
  "$ORG_OFFER_REQ")"
assert_route_available "Organization _batch submit (Offer)" "$CODE"

# 5) Organization offer poll
CODE="$(call_api POST \
  "$BASE_URL/host/cds-$JURISDICTION/v1/$HOST_REGISTRY_NETWORK/registry/org.schema/Organization/_batch-response" \
  "{\"thid\":\"$THID_ORG_OFFER\"}")"
assert_route_available "Organization _batch poll (Offer)" "$CODE"
ORDER_ACCEPTED_OFFER_ID="$(extract_json_value '.body.data[0].resource.meta.claims["org.schema.Offer.identifier"] | select(type=="string" and length > 0)')"

# 6) Organization order submit
ORDER_OVERRIDES="$(jq -n --arg thid "$THID_ORG_ORDER" '{ "/thid": $thid }')"
if [[ -n "$ORDER_ACCEPTED_OFFER_ID" ]]; then
  ORDER_OVERRIDES="$(jq -n \
    --arg thid "$THID_ORG_ORDER" \
    --arg acceptedOfferId "$ORDER_ACCEPTED_OFFER_ID" \
    '{
      "/thid": $thid,
      "/body/data/0/resource/meta/claims/Order.acceptedOffer.identifier": $acceptedOfferId
    }')"
fi
ORG_ORDER_REQ="$(render_example_payload ORGANIZATION_ORDER_REQUEST "$ORDER_OVERRIDES")"
CODE="$(call_api POST \
  "$BASE_URL/host/cds-$JURISDICTION/v1/$HOST_REGISTRY_NETWORK/registry/org.schema/Order/_batch" \
  "$ORG_ORDER_REQ")"
assert_route_available "Organization Order _batch submit" "$CODE"

# 7) Organization order poll
CODE="$(call_api POST \
  "$BASE_URL/host/cds-$JURISDICTION/v1/$HOST_REGISTRY_NETWORK/registry/org.schema/Order/_batch-response" \
  "{\"thid\":\"$THID_ORG_ORDER\"}")"
assert_route_available "Organization Order _batch poll" "$CODE"

# 8) Employee submit
EMPLOYEE_REQ="$(render_example_payload EMPLOYEE_REGISTRATION_REQUEST "$(jq -n \
  --arg thid "$THID_EMPLOYEE" \
  --arg employeeEmail "$EMPLOYEE_EMAIL" \
  --arg employeeRole "$EMPLOYEE_ROLE" \
  '{
    "/thid": $thid,
    "/body/data/0/meta/claims/org.schema.Person.email": $employeeEmail,
    "/body/data/0/meta/claims/org.schema.Person.hasOccupation.identifier.value": $employeeRole
  }')")"
CODE="$(call_api POST \
  "$BASE_URL/$TENANT_ID/cds-$JURISDICTION/v1/$SECTOR/entity/org.schema/Employee/_batch" \
  "$EMPLOYEE_REQ")"
assert_route_available "Employee _batch submit" "$CODE"

# 9) Employee poll
CODE="$(call_api POST \
  "$BASE_URL/$TENANT_ID/cds-$JURISDICTION/v1/$SECTOR/entity/org.schema/Employee/_batch-response" \
  "{\"thid\":\"$THID_EMPLOYEE\"}")"
assert_route_available "Employee _batch poll" "$CODE"

# 10) Token exchange submit
TOKEN_EXCHANGE_REQ="$(render_example_payload INITIAL_ACCESS_TOKEN_EXCHANGE_REQUEST "$(jq -n --arg thid "$THID_EXCHANGE" '{ "/thid": $thid }')")"
CODE="$(call_api POST \
  "$BASE_URL/$TENANT_ID/cds-$JURISDICTION/v1/$SECTOR/identity/openid/Token/_exchange" \
  "$TOKEN_EXCHANGE_REQ")"
assert_route_available "Token _exchange submit" "$CODE"

# 11) Token exchange poll
CODE="$(call_api POST \
  "$BASE_URL/$TENANT_ID/cds-$JURISDICTION/v1/$SECTOR/identity/openid/Token/_exchange-response" \
  "{\"thid\":\"$THID_EXCHANGE\"}")"
assert_route_available "Token _exchange poll" "$CODE"

# 12) Device DCR submit
DEVICE_DCR_REQ="$(render_example_payload DEVICE_REGISTRATION_REQUEST "$(jq -n --arg thid "$THID_DCR" '{
  "/thid": $thid,
  "/body/client_name": "web-portal-smoke"
}')")"
CODE="$(call_api POST \
  "$BASE_URL/$TENANT_ID/cds-$JURISDICTION/v1/$SECTOR/identity/openid/Device/_dcr" \
  "$DEVICE_DCR_REQ")"
assert_route_available "Device _dcr submit" "$CODE"

# 13) SMART token submit
SMART_OVERRIDES="$(jq -n --arg thid "$THID_SMART" '{ "/thid": $thid }')"
if [[ -n "$SMART_SCOPE" ]]; then
  SMART_OVERRIDES="$(jq -n --arg thid "$THID_SMART" --arg smartScope "$SMART_SCOPE" '{
    "/thid": $thid,
    "/body/scope": $smartScope
  }')"
fi
SMART_REQ="$(render_example_payload SMART_TOKEN_REQUEST "$SMART_OVERRIDES")"
CODE="$(call_api POST \
  "$BASE_URL/$TENANT_ID/cds-$JURISDICTION/v1/$SECTOR/identity/openid/smart/token" \
  "$SMART_REQ")"
assert_route_available "SMART token submit" "$CODE"

# 14) Family organization submit
FAMILY_REQ="$(render_example_payload FAMILY_REGISTRATION_REQUEST "$(jq -n \
  --arg thid "$THID_FAMILY" \
  --arg familyOwnerEmail "$FAMILY_OWNER_EMAIL" \
  '{
    "/thid": $thid,
    "/body/data/0/meta/claims/Organization.owner.email": $familyOwnerEmail
  }' )")"
CODE="$(call_api POST \
  "$BASE_URL/$TENANT_ID/cds-$JURISDICTION/v1/$SECTOR/individual/org.schema/Organization/_batch" \
  "$FAMILY_REQ")"
assert_route_available "Family Organization _batch submit" "$CODE"

echo
echo "Summary: pass=$PASS_COUNT fail=$FAIL_COUNT skip=$SKIP_COUNT"
if [[ "$FAIL_COUNT" -gt 0 ]]; then
  echo "NO-GO"
  exit 1
fi
echo "GO"
