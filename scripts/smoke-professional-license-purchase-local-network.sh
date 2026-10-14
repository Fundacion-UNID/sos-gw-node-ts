#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/payload-helpers.sh"

BASE_URL="${BASE_URL:-http://127.0.0.1:18080}"
AUTH_BEARER="${AUTH_BEARER:-demo-token}"
JURISDICTION="${JURISDICTION:-ES}"
HOST_JURISDICTION="${HOST_JURISDICTION:-EU}"
HOST_REGISTRY_SECTOR="${HOST_REGISTRY_SECTOR:-local-network}"
SECTOR="${SECTOR:-health-care}"
TENANT_ID="${TENANT_ID:-acme-id}"

for command_name in curl jq node; do
  command -v "${command_name}" >/dev/null 2>&1 || {
    echo "ERROR: missing ${command_name}" >&2
    exit 2
  }
done

shared_offer_fixture="$(render_example_payload ORGANIZATION_LICENSE_OFFER_REQUEST '{}')"
ISSUER_DID="${ISSUER_DID:-$(jq -er '.iss' <<<"${shared_offer_fixture}")}"

post_json() {
  local url="$1"
  local payload="$2"
  curl --fail-with-body --silent --show-error -X POST "${url}" \
    -H 'Content-Type: application/json' \
    -H "Authorization: Bearer ${AUTH_BEARER}" \
    --data "${payload}"
}

poll_until_complete() {
  local url="$1"
  local thread_id="$2"
  local response=''
  local operation_status=''
  for _ in $(seq 1 60); do
    response="$(post_json "${url}" "$(jq -n --arg thid "${thread_id}" '{thid:$thid}')")"
    operation_status="$(jq -r '.status // .body.status // empty' <<<"${response}")"
    if [[ "${operation_status}" != 'PENDING' ]]; then
      printf '%s' "${response}"
      return 0
    fi
    sleep 1
  done
  echo "ERROR: operation remained pending for thid=${thread_id}" >&2
  return 1
}

new_thread_id() {
  local operation_name="$1"
  printf 'professional-license-%s-%s-%s' "${operation_name}" "$(date +%s)" "${RANDOM}"
}

inventory_total() {
  local operation_name="$1"
  local thread_id
  thread_id="$(new_thread_id "${operation_name}")"
  local payload
  payload="$(render_example_payload ORGANIZATION_LICENSE_SEARCH_REQUEST "$(jq -n \
    --arg thid "${thread_id}" \
    --arg iss "${ISSUER_DID}" \
    --arg aud "${TENANT_ID}" \
    '{"/thid":$thid,"/jti":$thid,"/iss":$iss,"/aud":$aud}')")"
  post_json \
    "${BASE_URL}/${TENANT_ID}/cds-${JURISDICTION}/v1/${SECTOR}/entity/org.schema/License/_search" \
    "${payload}" >/dev/null
  local result
  result="$(poll_until_complete \
    "${BASE_URL}/${TENANT_ID}/cds-${JURISDICTION}/v1/${SECTOR}/entity/org.schema/License/_search-response" \
    "${thread_id}")"
  jq -er '.body.data[0].resource.total // .data[0].resource.total' <<<"${result}"
}

inventory_before="$(inventory_total before)"

offer_thread_id="$(new_thread_id offer)"
offer_payload="$(render_example_payload ORGANIZATION_LICENSE_OFFER_REQUEST "$(jq -n \
  --arg thid "${offer_thread_id}" \
  --arg iss "${ISSUER_DID}" \
  --arg aud "${TENANT_ID}" \
  '{"/thid":$thid,"/jti":$thid,"/iss":$iss,"/aud":$aud}')")"
post_json \
  "${BASE_URL}/${TENANT_ID}/cds-${JURISDICTION}/v1/${SECTOR}/entity/org.schema/Offer/_create" \
  "${offer_payload}" >/dev/null
offer_result="$(poll_until_complete \
  "${BASE_URL}/${TENANT_ID}/cds-${JURISDICTION}/v1/${SECTOR}/entity/org.schema/Offer/_create-response" \
  "${offer_thread_id}")"

offer_claims="$(jq -ec '.body.data[0].resource.meta.claims // .data[0].resource.meta.claims // .body.data[0].meta.claims // .data[0].meta.claims' <<<"${offer_result}")"
offer_id="$(jq -er '.["org.schema.Offer.identifier"]' <<<"${offer_claims}")"
requested_quantity="$(jq -er '.["org.schema.Offer.eligibleQuantity.value"]' <<<"${offer_claims}")"
payment_method="$(jq -er '.["org.schema.Offer.acceptedPaymentMethod"] | split(",")[0] | ltrimstr(" ") | rtrimstr(" ")' <<<"${offer_claims}")"
if jq -e 'has("org.schema.Offer.serialNumber")' <<<"${offer_claims}" >/dev/null; then
  echo 'ERROR: professional Offer preallocated License serial numbers' >&2
  exit 1
fi

order_thread_id="$(new_thread_id order)"
order_overrides="$(jq -n \
  --arg thid "${order_thread_id}" \
  --arg iss "${ISSUER_DID}" \
  --arg aud "${TENANT_ID}" \
  --arg offerId "${offer_id}" \
  --arg paymentMethod "${payment_method}" \
  '{
    "/thid":$thid,
    "/jti":$thid,
    "/iss":$iss,
    "/aud":$aud,
    "/body/data/0/resource/meta/claims/org.schema.Order.acceptedOffer.identifier":$offerId,
    "/body/data/0/resource/meta/claims/Order.acceptedOffer.identifier":$offerId,
    "/body/data/0/resource/meta/claims/org.schema.Order.paymentMethod":$paymentMethod
  }')"
order_payload="$(render_example_payload ORGANIZATION_LICENSE_ORDER_REQUEST "${order_overrides}")"
post_json \
  "${BASE_URL}/host/cds-${HOST_JURISDICTION}/v1/${HOST_REGISTRY_SECTOR}/registry/org.schema/Order/_batch" \
  "${order_payload}" >/dev/null
order_result="$(poll_until_complete \
  "${BASE_URL}/host/cds-${HOST_JURISDICTION}/v1/${HOST_REGISTRY_SECTOR}/registry/org.schema/Order/_batch-response" \
  "${order_thread_id}")"
order_status="$(jq -er '.body.data[0].response.status // .data[0].response.status' <<<"${order_result}")"
if [[ "${order_status}" != '201' ]]; then
  echo "ERROR: verified professional Order failed with status=${order_status}" >&2
  jq '.' <<<"${order_result}" >&2
  exit 1
fi

inventory_after="$(inventory_total after)"
materialized_quantity="$((inventory_after - inventory_before))"
if [[ "${materialized_quantity}" -ne "${requested_quantity}" ]]; then
  echo "ERROR: Order materialized ${materialized_quantity} seats; expected ${requested_quantity}" >&2
  exit 1
fi

echo "Professional license HTTP smoke passed: Offer=${offer_id} provider=${payment_method} seats=${materialized_quantity}"
