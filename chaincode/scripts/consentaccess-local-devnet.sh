#!/usr/bin/env bash
set -euo pipefail

# -----------------------------------------------------------------------------
# Consent Access CCAAS local devnet deployer
#
# This script prepares, installs and commits the `consentaccess-sc` chaincode as
# an external service on the local Fabric v3 devnet that lives in:
#   fabric-multicloud/devnet/fabric-v3
#
# The script is intentionally explicit so a developer who does not know Fabric
# can follow each step and override only a few variables when needed.
#
# Important local assumptions:
# - the smart-contract source of truth is this unified SOS gateway repository
# - the sibling `fabric-multicloud` repository supplies only the local network
# - the local devnet channel for consent access is `health-care-local`
# - the smart contract is deployed as CCAAS, not as in-peer chaincode
# - `weft` is optional here; when it is missing this script builds the standard
#   Fabric CCAAS archive (`metadata.json` + `code.tar.gz`) directly
# - this script assumes the devnet itself is already able to bootstrap a clean
#   orderer/peer/channel state from deterministic CA material
# -----------------------------------------------------------------------------

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORKSPACE_ROOT="$(cd "${ROOT}/../../.." && pwd)"
CHAINCODE_DIR="${CHAINCODE_DIR:-${ROOT}/consentaccess-sc-javascript}"
DEVNET_ROOT="${FABRIC_MULTICLOUD_DIR:-${WORKSPACE_ROOT}/fabric-multicloud}/devnet/fabric-v3"
ENSURE_DEVNET_ENV_SCRIPT="${WORKSPACE_ROOT}/gwtemplate-node-ts/scripts/ensure-fabric-devnet-env.sh"

CHANNEL_NAME="${CHANNEL_NAME:-${HLF_DATA_CHANNEL_NAME:-health-care-local}}"
CHAINCODE_NAME="${CHAINCODE_NAME:-consentaccess-sc}"
CHAINCODE_VERSION="${CHAINCODE_VERSION:-1.0}"
CHAINCODE_SEQUENCE="${CHAINCODE_SEQUENCE:-1}"
CHAINCODE_SIGNATURE_POLICY="${CHAINCODE_SIGNATURE_POLICY:-OR('Host1MSP.member')}"
CHAINCODE_LABEL="${CHAINCODE_LABEL:-consentaccess-sc}"
CHAINCODE_SERVER_CONTAINER_NAME="${CHAINCODE_SERVER_CONTAINER_NAME:-consentaccess-sc}"
CHAINCODE_SERVER_PORT="${CHAINCODE_SERVER_PORT:-9999}"
CHAINCODE_SERVER_ADDRESS="${CHAINCODE_SERVER_ADDRESS:-${CHAINCODE_SERVER_CONTAINER_NAME}:${CHAINCODE_SERVER_PORT}}"
CHAINCODE_IMAGE_TAG="${CHAINCODE_IMAGE_TAG:-consentaccess-sc:latest}"
CHAINCODE_PACKAGE_ARCHIVE="${CHAINCODE_PACKAGE_ARCHIVE:-consentaccess-sc-caas.tgz}"
DEVNET_NETWORK="${DEVNET_NETWORK:-gdc-fabric-v3-devnet}"
FABRIC_TOOLS_CONTAINER="${FABRIC_TOOLS_CONTAINER:-gdc-fabric-tools}"
ORDERER_TLS_HOSTNAME="${ORDERER_TLS_HOSTNAME:-orderer}"
ORDERER_ADDRESS="${ORDERER_ADDRESS:-orderer:7050}"
ORG1_DOMAIN="${ORG1_DOMAIN:-host1.example.com}"
ORDERER_DOMAIN="${ORDERER_DOMAIN:-example.com}"
ORG1_MSP_ID="${ORG1_MSP_ID:-Host1MSP}"

ORG1_ADMIN_MSP="/workspace/organizations/peerOrganizations/${ORG1_DOMAIN}/users/Admin@${ORG1_DOMAIN}/msp"
ORG1_PEER_TLS="/workspace/organizations/peerOrganizations/${ORG1_DOMAIN}/peers/peer0.${ORG1_DOMAIN}/tls/ca.crt"
ORDERER_TLS_CA="/workspace/organizations/ordererOrganizations/${ORDERER_DOMAIN}/orderers/orderer.${ORDERER_DOMAIN}/tls/ca.crt"

function info() {
  printf '\n==> %s\n' "$1"
}

function fail() {
  printf '\nERROR: %s\n' "$1" >&2
  exit 1
}

function require_file() {
  local target="$1"
  [[ -f "${target}" ]] || fail "Missing file: ${target}"
}

function require_dir() {
  local target="$1"
  [[ -d "${target}" ]] || fail "Missing directory: ${target}"
}

function require_command() {
  local target="$1"
  command -v "${target}" >/dev/null 2>&1 || fail "Missing command: ${target}"
}

function exec_tools() {
  docker exec -w /workspace "${FABRIC_TOOLS_CONTAINER}" "$@"
}

function ensure_devnet_ready() {
  require_dir "${DEVNET_ROOT}"
  require_dir "${CHAINCODE_DIR}"
  require_file "${CHAINCODE_DIR}/lib/consent-access-contract.js"
  require_command docker
  require_command npm
  require_command cp
  require_file "${ENSURE_DEVNET_ENV_SCRIPT}"

  [[ -S /var/run/docker.sock ]] || fail "Docker socket not available"
  docker ps --format '{{.Names}}' | grep -qx "${FABRIC_TOOLS_CONTAINER}" \
    || fail "Fabric tools container is not running: ${FABRIC_TOOLS_CONTAINER}"
  require_file "${DEVNET_ROOT}/channel-artifacts/${CHANNEL_NAME}.block"

  info "Ensuring the Fabric devnet backend env exists"
  bash "${ENSURE_DEVNET_ENV_SCRIPT}"
}

function package_chaincode_archive_without_weft() {
  # Fabric CCAAS packages are just:
  # - metadata.json
  # - code.tar.gz containing connection.json
  #
  # `weft` is convenient but not required for that shape, so the local script
  # can generate the archive directly and stay runnable on workstations that do
  # not have the extra packaging tool installed.
  local package_root
  package_root="$(mktemp -d)"
  local code_root="${package_root}/code"
  local connection_json="${code_root}/connection.json"
  local metadata_json="${package_root}/metadata.json"

  mkdir -p "${code_root}"

  cat > "${connection_json}" <<EOF
{"address":"${CHAINCODE_SERVER_ADDRESS}","dial_timeout":"10s","tls_required":false}
EOF

  cat > "${metadata_json}" <<EOF
{"path":"","type":"ccaas","label":"${CHAINCODE_LABEL}"}
EOF

  (cd "${code_root}" && tar -czf "${package_root}/code.tar.gz" connection.json)
  (cd "${package_root}" && tar -czf "${CHAINCODE_DIR}/${CHAINCODE_PACKAGE_ARCHIVE}" metadata.json code.tar.gz)

  rm -rf "${package_root}"
}

function build_chaincode_artifacts() {
  info "Installing exact consentaccess-sc dependencies"
  (cd "${CHAINCODE_DIR}" && npm ci)

  info "Running unit tests for consentaccess-sc"
  (cd "${CHAINCODE_DIR}" && npm test)

  info "Generating metadata.json"
  (cd "${CHAINCODE_DIR}" && npm run metadata)

  info "Packaging CCAAS archive"
  if command -v weft >/dev/null 2>&1; then
    (cd "${CHAINCODE_DIR}" && CHAINCODE_SERVER_ADDRESS="${CHAINCODE_SERVER_ADDRESS}" npm run package:caas)
  else
    package_chaincode_archive_without_weft
  fi
  require_file "${CHAINCODE_DIR}/${CHAINCODE_PACKAGE_ARCHIVE}"

  info "Building the external service image"
  (cd "${CHAINCODE_DIR}" && docker build \
    --build-arg TARGETOS="${CHAINCODE_TARGET_OS:-linux}" \
    --build-arg TARGETARCH="${CHAINCODE_TARGET_ARCH:-amd64}" \
    --target ccaas -f ./Dockerfile -t "${CHAINCODE_IMAGE_TAG}" .)
}

function copy_archive_to_devnet() {
  info "Copying the CCAAS archive into the devnet workspace"
  cp "${CHAINCODE_DIR}/${CHAINCODE_PACKAGE_ARCHIVE}" "${DEVNET_ROOT}/channel-artifacts/${CHAINCODE_PACKAGE_ARCHIVE}"
}

function install_chaincode_package() {
  info "Installing ${CHAINCODE_PACKAGE_ARCHIVE} on peer0-host1"
  exec_tools env \
    CORE_PEER_LOCALMSPID="${ORG1_MSP_ID}" \
    CORE_PEER_ADDRESS="peer0-host1:7051" \
    CORE_PEER_MSPCONFIGPATH="${ORG1_ADMIN_MSP}" \
    CORE_PEER_TLS_ENABLED=true \
    CORE_PEER_TLS_ROOTCERT_FILE="${ORG1_PEER_TLS}" \
    peer lifecycle chaincode install "/workspace/channel-artifacts/${CHAINCODE_PACKAGE_ARCHIVE}"
}

function resolve_package_id() {
  exec_tools env \
    CORE_PEER_LOCALMSPID="${ORG1_MSP_ID}" \
    CORE_PEER_ADDRESS="peer0-host1:7051" \
    CORE_PEER_MSPCONFIGPATH="${ORG1_ADMIN_MSP}" \
    CORE_PEER_TLS_ENABLED=true \
    CORE_PEER_TLS_ROOTCERT_FILE="${ORG1_PEER_TLS}" \
    peer lifecycle chaincode queryinstalled \
    | awk -v label="${CHAINCODE_LABEL}" '$0 ~ label {gsub(/,/, "", $3); print $3}' \
    | tail -n 1
}

function restart_external_service() {
  local package_id="$1"

  info "Restarting the external service container"
  docker rm -f "${CHAINCODE_SERVER_CONTAINER_NAME}" >/dev/null 2>&1 || true

  docker run -d \
    --name "${CHAINCODE_SERVER_CONTAINER_NAME}" \
    --network "${DEVNET_NETWORK}" \
    -e CHAINCODE_SERVER_ADDRESS="${CHAINCODE_SERVER_ADDRESS}" \
    -e CHAINCODE_ID="${package_id}" \
    -p "${CHAINCODE_SERVER_PORT}:${CHAINCODE_SERVER_PORT}" \
    "${CHAINCODE_IMAGE_TAG}" >/dev/null
}

function approve_chaincode_definition() {
  local package_id="$1"

  info "Approving the chaincode definition for ${ORG1_MSP_ID}"
  # The local Docker devnet only exposes Org1 for endorsement. An explicit
  # one-org signature policy keeps the committed definition aligned with that
  # topology and avoids discovery trying to satisfy a broader default policy.
  exec_tools env \
    CORE_PEER_LOCALMSPID="${ORG1_MSP_ID}" \
    CORE_PEER_ADDRESS="peer0-host1:7051" \
    CORE_PEER_MSPCONFIGPATH="${ORG1_ADMIN_MSP}" \
    CORE_PEER_TLS_ENABLED=true \
    CORE_PEER_TLS_ROOTCERT_FILE="${ORG1_PEER_TLS}" \
    peer lifecycle chaincode approveformyorg \
    -o "${ORDERER_ADDRESS}" \
    --ordererTLSHostnameOverride "${ORDERER_TLS_HOSTNAME}" \
    --tls \
    --cafile "${ORDERER_TLS_CA}" \
    --channelID "${CHANNEL_NAME}" \
    --name "${CHAINCODE_NAME}" \
    --version "${CHAINCODE_VERSION}" \
    --package-id "${package_id}" \
    --sequence "${CHAINCODE_SEQUENCE}" \
    --signature-policy "${CHAINCODE_SIGNATURE_POLICY}"
}

function commit_chaincode_definition() {
  info "Committing the chaincode definition on ${CHANNEL_NAME}"
  exec_tools env \
    CORE_PEER_LOCALMSPID="${ORG1_MSP_ID}" \
    CORE_PEER_ADDRESS="peer0-host1:7051" \
    CORE_PEER_MSPCONFIGPATH="${ORG1_ADMIN_MSP}" \
    CORE_PEER_TLS_ENABLED=true \
    CORE_PEER_TLS_ROOTCERT_FILE="${ORG1_PEER_TLS}" \
    peer lifecycle chaincode commit \
    -o "${ORDERER_ADDRESS}" \
    --ordererTLSHostnameOverride "${ORDERER_TLS_HOSTNAME}" \
    --tls \
    --cafile "${ORDERER_TLS_CA}" \
    --channelID "${CHANNEL_NAME}" \
    --name "${CHAINCODE_NAME}" \
    --version "${CHAINCODE_VERSION}" \
    --sequence "${CHAINCODE_SEQUENCE}" \
    --signature-policy "${CHAINCODE_SIGNATURE_POLICY}" \
    --peerAddresses peer0-host1:7051 \
    --tlsRootCertFiles "${ORG1_PEER_TLS}"
}

function print_summary() {
  local package_id="$1"

  cat <<EOF

Consent access CCAAS deployed locally.

Channel:        ${CHANNEL_NAME}
Chaincode:      ${CHAINCODE_NAME}
Version:        ${CHAINCODE_VERSION}
Sequence:       ${CHAINCODE_SEQUENCE}
Signature policy:
                ${CHAINCODE_SIGNATURE_POLICY}
Package label:  ${CHAINCODE_LABEL}
Package id:     ${package_id}
Server address: ${CHAINCODE_SERVER_ADDRESS}
Image tag:      ${CHAINCODE_IMAGE_TAG}

Recommended GW CORE env:
  LEDGER_ENABLED=true
  LEDGER_PROVIDER_DEFAULT=fabric
  LEDGER_MSP_ID=${ORG1_MSP_ID}
  LEDGER_FABRIC_MSP_ID=${ORG1_MSP_ID}
  CONSENT_ACCESS_LEDGER_CHAINCODE=${CHAINCODE_NAME}

Remember:
  ConsentManager writes to channel "\${sector}-\${jurisdiction}".
  Your consent smoke test must use sector/jurisdiction that resolve to ${CHANNEL_NAME}.
  If you rerun this script after changing chaincode packaging inputs, a new
  package id is expected. That is normal for CCAAS lifecycle installs.
EOF
}

ensure_devnet_ready
build_chaincode_artifacts
copy_archive_to_devnet
install_chaincode_package

PACKAGE_ID="$(resolve_package_id)"
[[ -n "${PACKAGE_ID}" ]] || fail "Could not resolve PACKAGE_ID for label ${CHAINCODE_LABEL}"

restart_external_service "${PACKAGE_ID}"
approve_chaincode_definition "${PACKAGE_ID}"
commit_chaincode_definition
print_summary "${PACKAGE_ID}"
