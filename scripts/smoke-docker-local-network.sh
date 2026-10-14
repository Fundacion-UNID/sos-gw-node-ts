#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORKSPACE_ROOT="$(dirname "$(dirname "${ROOT_DIR}")")"
CONNECT_ICA_ROOT="${CONNECT_ICA_ROOT:-${WORKSPACE_ROOT}/connect-ica-ts}"
IMAGE_NAME="${IMAGE_NAME:-gwtemplate}"
CONTAINER_NAME="${CONTAINER_NAME:-gw-vetchain-local-network-smoke}"
HOST_PORT="${HOST_PORT:-18080}"
CONTAINER_PORT="${CONTAINER_PORT:-3000}"
DOCKER_NETWORK="${DOCKER_NETWORK:-gdc-fabric-v3-devnet}"
ENV_FILE="${ENV_FILE:-${ROOT_DIR}/.env.local-fabric}"
BASE_ENV_FILE="${BASE_ENV_FILE:-${ROOT_DIR}/.env.local-network}"
if [[ ! -f "$BASE_ENV_FILE" ]]; then
  BASE_ENV_FILE="${ROOT_DIR}/env.local-network.example"
fi
BASE_URL="${BASE_URL:-http://127.0.0.1:${HOST_PORT}}"
RUN_FULL_SMOKE="${RUN_FULL_SMOKE:-true}"
KEEP_CONTAINER="${KEEP_CONTAINER:-false}"
SKIP_FABRIC_PREP="${SKIP_FABRIC_PREP:-false}"
RUN_RESEARCH_SMART_SMOKE="${RUN_RESEARCH_SMART_SMOKE:-true}"
HOST_NETWORK="${HOST_NETWORK:-local-network}"
HOST_PREAUTHORIZATION_TEST_SEED="${HOST_PREAUTHORIZATION_TEST_SEED:-local-vetchain-host-preauthorization-smoke-seed}"
SMOKE_HOST_JURISDICTION="${SMOKE_HOST_JURISDICTION:-CA-BC}"
SMOKE_TENANT_JURISDICTION="${SMOKE_TENANT_JURISDICTION:-CA-BC}"
SMOKE_SECTOR="${SMOKE_SECTOR:-animal-care}"
SMOKE_DATA_CHANNEL="${SMOKE_DATA_CHANNEL:-animal-care-local}"
SMOKE_IDENTITY_CHANNEL="${SMOKE_IDENTITY_CHANNEL:-identity-local}"
SMOKE_RESEARCH_CHANNEL="${SMOKE_RESEARCH_CHANNEL:-${SMOKE_SECTOR}-local-research}"
LOCAL_ICA_PORT="${LOCAL_ICA_PORT:-3210}"
LOCAL_ICA_CONTAINER_URL="${LOCAL_ICA_CONTAINER_URL:-http://host.docker.internal:${LOCAL_ICA_PORT}}"
START_LOCAL_ICA="${START_LOCAL_ICA:-true}"
CONNECT_ICA_PID=''
# This UUID is a local executable fixture, never a real clinic identifier.
SMOKE_TENANT_ID="${SMOKE_TENANT_ID:-00000000-0000-4000-8000-000000000101}"

print_help() {
  cat <<'EOF'
Usage: bash scripts/smoke-docker-local-network.sh

Prepares the local Fabric network, runs the selected immutable Docker image on
the Fabric Docker network, verifies the VetChain CA-BC local-network profile,
bootstraps a synthetic clinic and runs the consent/SMART local-network smoke tests.

Environment:
  IMAGE_NAME       Local image to test. Default: gwtemplate
  CONTAINER_NAME   Temporary container name
  HOST_PORT        Host-side smoke port. Default: 18080
  CONTAINER_PORT   GW port inside the local-network container. Default: 3000
  DOCKER_NETWORK   Fabric Docker network. Default: gdc-fabric-v3-devnet
  RUN_FULL_SMOKE   true runs consent and SMART smokes; false checks ping only
  KEEP_CONTAINER   true leaves the smoke container running
  SKIP_FABRIC_PREP true reuses an already prepared devnet
  START_LOCAL_ICA  true starts and owns the sibling Connect ICA process
  RUN_RESEARCH_SMART_SMOKE
                   true runs the mandatory provider/consumer-authorized
                   cross-portal research flow. Default: true.
                   false is diagnostic-only and is not a release smoke.
EOF
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  print_help
  exit 0
fi

for command_name in docker curl node npm; do
  command -v "$command_name" >/dev/null 2>&1 || {
    echo "ERROR: missing command: ${command_name}" >&2
    exit 2
  }
done

docker image inspect "$IMAGE_NAME" >/dev/null 2>&1 || {
  echo "ERROR: local image not found: ${IMAGE_NAME}" >&2
  exit 2
}

cleanup() {
  if [[ "$KEEP_CONTAINER" != "true" ]]; then
    docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
  fi
  if [[ -n "$CONNECT_ICA_PID" ]]; then
    kill "$CONNECT_ICA_PID" >/dev/null 2>&1 || true
    wait "$CONNECT_ICA_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

cd "$ROOT_DIR"
mkdir -p "${ROOT_DIR}/logs"

if [[ "$START_LOCAL_ICA" == "true" ]]; then
  [[ -f "${CONNECT_ICA_ROOT}/package.json" ]] || {
    echo "ERROR: sibling Connect ICA repo not found: ${CONNECT_ICA_ROOT}" >&2
    exit 2
  }
  if curl --silent --output /dev/null --max-time 1 "http://127.0.0.1:${LOCAL_ICA_PORT}/"; then
    echo "ERROR: local Connect ICA port is already in use: ${LOCAL_ICA_PORT}" >&2
    exit 2
  fi
  LOCAL_HOST_DID_DOCUMENT="$(
    HOST_AUTHORITY_BASE_URL="http://localhost:${CONTAINER_PORT}" \
    HOST_PREAUTHORIZATION_TEST_SEED="$HOST_PREAUTHORIZATION_TEST_SEED" \
      node ./scripts/build-local-host-did-document.mjs
  )"
  (
    cd "$CONNECT_ICA_ROOT"
    ICA_API_PORT="$LOCAL_ICA_PORT" \
    NODE_ENV=development \
    SECURITY_MODE=demo \
    NETWORK_MODE=local-network \
    ICA_SUPPORTED_JURISDICTIONS='CA,CA-*' \
    ICA_SUPPORTED_SECTORS="$SMOKE_SECTOR" \
    ICA_PREAUTHORIZED_HOST_DOMAINS=localhost \
    ICA_PREAUTHORIZED_HOST_NETWORK_KINDS=local-network \
    ICA_PREAUTHORIZED_HOST_DID_DOCUMENTS_JSON="$LOCAL_HOST_DID_DOCUMENT" \
    ICA_CREDENTIAL_LEDGER_ENABLED=false \
    ICA_CREDENTIAL_LEDGER_REQUIRED=false \
      npm run api:local >"${ROOT_DIR}/logs/local-connect-ica-smoke.log" 2>&1
  ) &
  CONNECT_ICA_PID=$!
  for _ in $(seq 1 30); do
    if curl --silent --output /dev/null --max-time 1 "http://127.0.0.1:${LOCAL_ICA_PORT}/"; then
      break
    fi
    sleep 1
  done
  curl --silent --output /dev/null --max-time 2 "http://127.0.0.1:${LOCAL_ICA_PORT}/" || {
    tail -120 "${ROOT_DIR}/logs/local-connect-ica-smoke.log" >&2 || true
    echo "ERROR: local Connect ICA did not start on port ${LOCAL_ICA_PORT}" >&2
    exit 1
  }
fi

if [[ "$SKIP_FABRIC_PREP" != "true" ]]; then
  BASE_ENV_FILE="$BASE_ENV_FILE" node ./scripts/bootstrap-local-fabric-stack.mjs \
    --tenant-id "$SMOKE_TENANT_ID" \
    --host-jurisdiction "$SMOKE_HOST_JURISDICTION" \
    --data-channel "$SMOKE_DATA_CHANNEL" \
    --identity-channel "$SMOKE_IDENTITY_CHANNEL" \
    --research-channel "$SMOKE_RESEARCH_CHANNEL" \
    --prepare-only \
    --no-bootstrap-tenant
fi

docker ps --format '{{.Names}}' | grep -qx 'gdc-peer0-host1' || {
  echo "ERROR: local Fabric peer is not running: gdc-peer0-host1" >&2
  exit 2
}
docker ps --format '{{.Names}}' | grep -qx 'gdc-fabric-tools' || {
  echo "ERROR: local Fabric tools container is not running: gdc-fabric-tools" >&2
  exit 2
}

CHANNEL_NAME="$SMOKE_DATA_CHANNEL" \
  bash ./scripts/ensure-consentaccess-runtime.sh

CHANNEL_NAME="$SMOKE_DATA_CHANNEL" \
IDENTITY_CHANNEL_NAME="$SMOKE_IDENTITY_CHANNEL" \
RESEARCH_CHANNEL_NAME="$SMOKE_RESEARCH_CHANNEL" \
HOST_JURISDICTION_VALUE="$SMOKE_HOST_JURISDICTION" \
TENANT_JURISDICTION_VALUE="$SMOKE_TENANT_JURISDICTION" \
SECTOR_VALUE="$SMOKE_SECTOR" \
FABRIC_PEER_ENDPOINT_VALUE=peer0-host1:7051 \
ICA_URL_EXTERNAL_VALUE="$LOCAL_ICA_CONTAINER_URL" \
BASE_ENV_FILE="$BASE_ENV_FILE" \
  npm run prepare:local-fabric-env

docker network inspect "$DOCKER_NETWORK" >/dev/null 2>&1 || {
  echo "ERROR: Fabric Docker network not found: ${DOCKER_NETWORK}" >&2
  exit 2
}

ENV_FILE="$ENV_FILE" \
IMAGE_NAME="$IMAGE_NAME" \
CONTAINER_NAME="$CONTAINER_NAME" \
HOST_PORT="$HOST_PORT" \
CONTAINER_PORT="$CONTAINER_PORT" \
DOCKER_NETWORK="$DOCKER_NETWORK" \
FORCE_RECREATE=true \
  ./docker_run_local.sh

SMOKE_HOST_JURISDICTION_LOWER="$(printf '%s' "$SMOKE_HOST_JURISDICTION" | tr '[:upper:]' '[:lower:]')"
PING_URL="${BASE_URL}/host/cds-${SMOKE_HOST_JURISDICTION_LOWER}/v1/local-network/.well-known/ping"
for _ in $(seq 1 60); do
  if curl --fail --silent --show-error --max-time 2 "$PING_URL" >/dev/null 2>&1; then
    echo "Docker local-network ping succeeded: ${PING_URL}"
    break
  fi
  sleep 1
done

curl --fail --silent --show-error --max-time 5 "$PING_URL" >/dev/null || {
  docker logs "$CONTAINER_NAME" --tail 120 >&2 || true
  echo "ERROR: Docker local-network ping failed: ${PING_URL}" >&2
  exit 1
}

if [[ "$RUN_FULL_SMOKE" == "true" ]]; then
  BASE_URL="$BASE_URL" \
  HOST_AUTHORITY_BASE_URL="http://localhost:${CONTAINER_PORT}" \
  SERVICE_URL="http://localhost:${CONTAINER_PORT}" \
  HOST_NETWORK="$HOST_NETWORK" \
  HOST_PREAUTHORIZATION_TEST_SEED="$HOST_PREAUTHORIZATION_TEST_SEED" \
    npx dotenv -e "$ENV_FILE" -- bash -c \
      'TENANT_ID="$1" ORGANIZATION_ID_TYPE=UUID ORGANIZATION_ID_VALUE="$1" JURISDICTION="$2" HOST_JURISDICTION="$3" SECTOR="$4" LEGAL_NAME="Local VetChain Clinic Fixture" DISPLAY_NAME="Local VetChain Clinic" ADMIN_EMAIL="clinic.fixture@vetchain.invalid" ORG_URL="local-clinic.vetchain.invalid" SERVICE_AREA_SERVED="$2" ./scripts/bootstrap-single-tenant.sh' \
      _ "$SMOKE_TENANT_ID" "$SMOKE_TENANT_JURISDICTION" "$SMOKE_HOST_JURISDICTION" "$SMOKE_SECTOR"
  BASE_URL="$BASE_URL" TENANT_ID="$SMOKE_TENANT_ID" \
  JURISDICTION="$SMOKE_TENANT_JURISDICTION" SECTOR="$SMOKE_SECTOR" \
  CHANNEL_NAME="$SMOKE_DATA_CHANNEL" \
    bash ./scripts/smoke-consentaccess-local-network.sh
  TENANT_DID_ENDPOINT="${BASE_URL}/${SMOKE_TENANT_ID}/cds-${SMOKE_TENANT_JURISDICTION}/v1/${SMOKE_SECTOR}/.well-known/did.json"
  SMOKE_PROVIDER_ORGANIZATION_DID="$(curl --fail --silent --show-error --max-time 10 "${TENANT_DID_ENDPOINT}" | node -e 'let body=""; process.stdin.on("data", chunk => body += chunk); process.stdin.on("end", () => { const id = JSON.parse(body).id; if (typeof id !== "string" || !id.startsWith("did:web:")) process.exit(1); process.stdout.write(id); });')"
  echo "Resolved local provider organization DID: ${SMOKE_PROVIDER_ORGANIZATION_DID}"
  BASE_URL="$BASE_URL" \
  TENANT_ID="$SMOKE_TENANT_ID" \
  JURISDICTION="$SMOKE_TENANT_JURISDICTION" \
  SECTOR="$SMOKE_SECTOR" \
  CHANNEL_NAME="$SMOKE_DATA_CHANNEL" \
  PROVIDER_ORGANIZATION_DID="$SMOKE_PROVIDER_ORGANIZATION_DID" \
  RUN_RESEARCH_SMART_SMOKE="$RUN_RESEARCH_SMART_SMOKE" \
    bash ./scripts/smoke-smart-access-local-network.sh
  CHANNEL_NAME="$SMOKE_IDENTITY_CHANNEL" \
  LICENSE_JURISDICTION="$SMOKE_TENANT_JURISDICTION" \
  LICENSE_SECTOR="$SMOKE_SECTOR" \
  LICENSE_ORGANIZATION_ID="urn:org:uuid:${SMOKE_TENANT_ID}" \
    bash ./scripts/smoke-rolelicense-local-network.sh

  research_channel_info="$(docker exec gdc-fabric-tools bash -lc \
    "CORE_PEER_LOCALMSPID=Host1MSP \
CORE_PEER_MSPCONFIGPATH=/workspace/organizations/peerOrganizations/host1.example.com/users/Admin@host1.example.com/msp \
CORE_PEER_ADDRESS=peer0-host1:7051 \
CORE_PEER_TLS_ENABLED=true \
CORE_PEER_TLS_ROOTCERT_FILE=/workspace/organizations/peerOrganizations/host1.example.com/peers/peer0.host1.example.com/tls/ca.crt \
peer channel getinfo -c ${SMOKE_RESEARCH_CHANNEL}" 2>&1)"
  research_channel_height="$(sed -n 's/^Blockchain info: //p' <<<"${research_channel_info}" | jq -r '.height // 0')"
  [[ "${research_channel_height}" -gt 3 ]] || {
    echo "${research_channel_info}" >&2
    echo 'ERROR: Research channel contains no post-deployment registration transaction.' >&2
    exit 1
  }
  echo "Research registration channel validated: channel=${SMOKE_RESEARCH_CHANNEL} height=${research_channel_height}"
fi

IMAGE_ID="$(docker image inspect "$IMAGE_NAME" --format '{{.Id}}')"
echo "Validated image: ${IMAGE_NAME}"
echo "Image ID: ${IMAGE_ID}"
