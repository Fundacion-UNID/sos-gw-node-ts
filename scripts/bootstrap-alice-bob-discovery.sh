#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

ALICE_BASE_URL="${ALICE_BASE_URL:-http://localhost:3000}"
BOB_BASE_URL="${BOB_BASE_URL:-http://localhost:3001}"
JURISDICTION="${JURISDICTION:-ES}"
JURISDICTION_LOWER="$(printf '%s' "${JURISDICTION:-ES}" | tr '[:upper:]' '[:lower:]')"
NETWORK_MODE_NORMALIZED="$(printf '%s' "${NETWORK_MODE:-}" | tr '[:upper:]' '[:lower:]')"
DEFAULT_HOST_REGISTRY_NETWORK="test"
if [[ "$NETWORK_MODE_NORMALIZED" == "local-network" || "$NETWORK_MODE_NORMALIZED" == "test-network" || "$NETWORK_MODE_NORMALIZED" == "network" ]]; then
  DEFAULT_HOST_REGISTRY_NETWORK="$NETWORK_MODE_NORMALIZED"
fi
HOST_REGISTRY_NETWORK="${HOST_REGISTRY_NETWORK:-$DEFAULT_HOST_REGISTRY_NETWORK}"
SECTOR="${SECTOR:-health-care}"
TERMS_OF_SERVICE="${TERMS_OF_SERVICE:-https://example.org/terms}"

bootstrap_tenant() {
  local base_url="$1"
  local tenant_id="$2"
  local tax_id="$3"
  local legal_name="$4"
  local display_name="$5"
  local admin_email="$6"
  local service_type="$7"

  local tenant_url="${base_url}/${tenant_id}/cds-${JURISDICTION_LOWER}/v1/${SECTOR}"
  local service_identifier="did:web:${base_url#http://}:${tenant_id}"

  echo "[alice-bob-bootstrap] tenant=${tenant_id} base=${base_url} capability=${service_type}"
  BASE_URL="$base_url" \
  TENANT_ID="$tenant_id" \
  TAX_ID="$tax_id" \
  LEGAL_NAME="$legal_name" \
  DISPLAY_NAME="$display_name" \
  ORG_URL="${tenant_id}.example.org" \
  ADMIN_EMAIL="$admin_email" \
  JURISDICTION="$JURISDICTION" \
  HOST_REGISTRY_NETWORK="$HOST_REGISTRY_NETWORK" \
  SECTOR="$SECTOR" \
  SERVICE_URL="$tenant_url" \
  SERVICE_IDENTIFIER="$service_identifier" \
  SERVICE_TYPE="$service_type" \
  SERVICE_AREA_SERVED="${JURISDICTION},EU" \
  TERMS_OF_SERVICE="$TERMS_OF_SERVICE" \
  ./scripts/bootstrap-single-tenant.sh
}

bootstrap_tenant "$ALICE_BASE_URL" "acme-1" "acme-1" "Acme 1 Organization SL" "Acme 1" "admin1@acme1.example.org" "organization/Composition.cruds"
bootstrap_tenant "$BOB_BASE_URL" "acme-2" "acme-2" "Acme 2 Organization SL" "Acme 2" "admin1@acme2.example.org" "organization/Composition.cruds"
bootstrap_tenant "$BOB_BASE_URL" "acme-3" "acme-3" "Acme 3 Organization SL" "Acme 3" "admin1@acme3.example.org" "organization/ResearchSubject.cruds"
bootstrap_tenant "$BOB_BASE_URL" "acme-4" "acme-4" "Acme 4 Organization SL" "Acme 4" "admin1@acme4.example.org" "organization/Composition.rs"

echo "[alice-bob-bootstrap] completed"
