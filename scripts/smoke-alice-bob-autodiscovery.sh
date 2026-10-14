#!/usr/bin/env bash
set -euo pipefail

ALICE_BASE_URL="${ALICE_BASE_URL:-http://localhost:3000}"
BOB_BASE_URL="${BOB_BASE_URL:-http://localhost:3001}"
SECTOR="${SECTOR:-health-care}"
JURISDICTION="${JURISDICTION:-ES}"
JURISDICTION_LOWER="$(printf '%s' "${JURISDICTION:-ES}" | tr '[:upper:]' '[:lower:]')"
VERSION="${VERSION:-v1}"
NETWORK_MODE_NORMALIZED="$(printf '%s' "${NETWORK_MODE:-}" | tr '[:upper:]' '[:lower:]')"
DEFAULT_HOST_NETWORK="test"
if [[ "$NETWORK_MODE_NORMALIZED" == "local-network" || "$NETWORK_MODE_NORMALIZED" == "test-network" || "$NETWORK_MODE_NORMALIZED" == "network" ]]; then
  DEFAULT_HOST_NETWORK="$NETWORK_MODE_NORMALIZED"
fi
HOST_NETWORK="${HOST_NETWORK:-$DEFAULT_HOST_NETWORK}"
INDEX_PROVIDER="${INDEX_PROVIDER:-organization/Composition.cruds}"
DIGITAL_TWIN_PROVIDER="${DIGITAL_TWIN_PROVIDER:-organization/ResearchSubject.cruds}"
READER_ONLY_TENANT="${READER_ONLY_TENANT:-Acme 4 Organization SL}"

for cmd in curl jq; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "ERROR: missing $cmd"; exit 2; }
done

fetch_json() {
  local url="$1"
  curl -sS "$url"
}

post_json() {
  local url="$1"
  local payload="$2"
  curl -sS -X POST "$url" -H "Content-Type: application/json" -d "$payload"
}

assert_eq() {
  local expected="$1"
  local actual="$2"
  local message="$3"
  if [[ "$expected" != "$actual" ]]; then
    echo "ERROR: ${message}. expected='${expected}' actual='${actual}'"
    exit 1
  fi
}

assert_not_contains() {
  local haystack="$1"
  local needle="$2"
  local message="$3"
  if grep -Fq "$needle" <<<"$haystack"; then
    echo "ERROR: ${message}. found='${needle}'"
    exit 1
  fi
}

echo "[smoke] GET Alice host catalog"
alice_catalog="$(fetch_json "${ALICE_BASE_URL}/host/cds-${JURISDICTION_LOWER}/${VERSION}/${HOST_NETWORK}/dsp/catalog/dcat.json")"
assert_eq "1" "$(echo "$alice_catalog" | jq '.["dcat:dataset"] | length')" "Alice should publish one provider dataset"

echo "[smoke] GET Bob host catalog"
bob_catalog="$(fetch_json "${BOB_BASE_URL}/host/cds-${JURISDICTION_LOWER}/${VERSION}/${HOST_NETWORK}/dsp/catalog/dcat.json")"
assert_eq "2" "$(echo "$bob_catalog" | jq '.["dcat:dataset"] | length')" "Bob should publish two provider datasets"
assert_not_contains "$bob_catalog" "$READER_ONLY_TENANT" "Bob catalog must exclude reader-only tenants"

echo "[smoke] POST Alice normalized provider discovery"
alice_providers="$(post_json "${ALICE_BASE_URL}/api/dataspace-discovery/providers" "$(jq -n --arg sector "$SECTOR" --arg jurisdiction "$JURISDICTION" --arg providerCapability "$INDEX_PROVIDER" '{sector:$sector,jurisdiction:$jurisdiction,providerCapability:$providerCapability}')")"
assert_eq "1" "$(echo "$alice_providers" | jq '.providers | length')" "Alice should resolve one index provider"

echo "[smoke] POST Bob normalized provider discovery without capability filter"
bob_all_providers="$(post_json "${BOB_BASE_URL}/api/dataspace-discovery/providers" "$(jq -n --arg sector "$SECTOR" --arg jurisdiction "$JURISDICTION" '{sector:$sector,jurisdiction:$jurisdiction}')")"
assert_eq "2" "$(echo "$bob_all_providers" | jq '.providers | length')" "Bob should resolve two provider entries"
assert_not_contains "$bob_all_providers" "$READER_ONLY_TENANT" "Bob normalized discovery must exclude reader-only tenants"

echo "[smoke] POST Bob index provider filter"
bob_index_providers="$(post_json "${BOB_BASE_URL}/api/dataspace-discovery/providers" "$(jq -n --arg sector "$SECTOR" --arg jurisdiction "$JURISDICTION" --arg providerCapability "$INDEX_PROVIDER" '{sector:$sector,jurisdiction:$jurisdiction,providerCapability:$providerCapability}')")"
assert_eq "1" "$(echo "$bob_index_providers" | jq '.providers | length')" "Bob should resolve one index provider"

echo "[smoke] POST Bob digital twin provider filter"
bob_digital_twin_providers="$(post_json "${BOB_BASE_URL}/api/dataspace-discovery/providers" "$(jq -n --arg sector "$SECTOR" --arg jurisdiction "$JURISDICTION" --arg providerCapability "$DIGITAL_TWIN_PROVIDER" '{sector:$sector,jurisdiction:$jurisdiction,providerCapability:$providerCapability}')")"
assert_eq "1" "$(echo "$bob_digital_twin_providers" | jq '.providers | length')" "Bob should resolve one digital twin provider"

echo "[smoke] autodiscovery checks passed"
