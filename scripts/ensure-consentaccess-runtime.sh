#!/usr/bin/env bash
# Flow contract: the local release smoke resolves the exact package approved by
# Host1MSP and runs that CCAAS service before the GW submits any Consent write.
# Authorization invariant: the runtime cannot select an arbitrary installed
# package; it must use the channel approval's LocalPackage.package_id.
# Persistence invariant: restarting the external process does not change the
# committed chaincode definition or ledger state.
set -euo pipefail

CHANNEL_NAME="${CHANNEL_NAME:-animal-care-local}"
CHAINCODE_NAME="${CHAINCODE_NAME:-consentaccess-sc}"
CHAINCODE_SEQUENCE="${CHAINCODE_SEQUENCE:-1}"
CHAINCODE_CONTAINER="${CHAINCODE_CONTAINER:-consentaccess-sc}"
CHAINCODE_IMAGE="${CHAINCODE_IMAGE:-consentaccess-sc:latest}"
CHAINCODE_SERVER_ADDRESS="${CHAINCODE_SERVER_ADDRESS:-${CHAINCODE_CONTAINER}:9999}"
DEVNET_NETWORK="${DEVNET_NETWORK:-gdc-fabric-v3-devnet}"
FABRIC_TOOLS_CONTAINER="${FABRIC_TOOLS_CONTAINER:-gdc-fabric-tools}"
HOST1_MSP_ID="${HOST1_MSP_ID:-Host1MSP}"
HOST1_DOMAIN="${HOST1_DOMAIN:-host1.example.com}"

HOST1_ADMIN_MSP="/workspace/organizations/peerOrganizations/${HOST1_DOMAIN}/users/Admin@${HOST1_DOMAIN}/msp"
HOST1_PEER_TLS="/workspace/organizations/peerOrganizations/${HOST1_DOMAIN}/peers/peer0.${HOST1_DOMAIN}/tls/ca.crt"

for required_container in "${FABRIC_TOOLS_CONTAINER}" gdc-peer0-host1; do
  docker ps --format '{{.Names}}' | grep -qx "${required_container}" || {
    echo "ERROR: required Fabric container is not running: ${required_container}" >&2
    exit 2
  }
done

docker image inspect "${CHAINCODE_IMAGE}" >/dev/null 2>&1 || {
  echo "ERROR: consent access runtime image is missing: ${CHAINCODE_IMAGE}" >&2
  exit 2
}
docker network inspect "${DEVNET_NETWORK}" >/dev/null 2>&1 || {
  echo "ERROR: Fabric Docker network is missing: ${DEVNET_NETWORK}" >&2
  exit 2
}

approval_json="$(
  docker exec -w /workspace "${FABRIC_TOOLS_CONTAINER}" env \
    CORE_PEER_LOCALMSPID="${HOST1_MSP_ID}" \
    CORE_PEER_ADDRESS=peer0-host1:7051 \
    CORE_PEER_MSPCONFIGPATH="${HOST1_ADMIN_MSP}" \
    CORE_PEER_TLS_ENABLED=true \
    CORE_PEER_TLS_ROOTCERT_FILE="${HOST1_PEER_TLS}" \
    peer lifecycle chaincode queryapproved \
      --channelID "${CHANNEL_NAME}" \
      --name "${CHAINCODE_NAME}" \
      --sequence "${CHAINCODE_SEQUENCE}" \
      --output json
)"

package_id="$(
  node -e '
    const approval = JSON.parse(process.argv[1]);
    const LocalPackage = approval?.source?.Type?.LocalPackage;
    const packageId = LocalPackage?.package_id;
    if (typeof packageId !== "string" || packageId.length === 0) process.exit(1);
    process.stdout.write(packageId);
  ' "${approval_json}"
)" || {
  echo "ERROR: approved ${CHAINCODE_NAME} definition has no local package id" >&2
  exit 1
}

if docker ps --format '{{.Names}}' | grep -qx "${CHAINCODE_CONTAINER}"; then
  running_package_id="$(
    docker inspect "${CHAINCODE_CONTAINER}" \
      --format '{{range .Config.Env}}{{println .}}{{end}}' \
      | sed -n 's/^CHAINCODE_ID=//p'
  )"
  if [[ "${running_package_id}" == "${package_id}" ]]; then
    echo "Consent access runtime ready: ${CHAINCODE_CONTAINER} (${package_id})"
    exit 0
  fi
fi

docker rm -f "${CHAINCODE_CONTAINER}" >/dev/null 2>&1 || true
docker run -d \
  --name "${CHAINCODE_CONTAINER}" \
  --network "${DEVNET_NETWORK}" \
  -e CHAINCODE_SERVER_ADDRESS="${CHAINCODE_SERVER_ADDRESS}" \
  -e CHAINCODE_ID="${package_id}" \
  "${CHAINCODE_IMAGE}" >/dev/null

for _ in $(seq 1 30); do
  if docker ps --format '{{.Names}}' | grep -qx "${CHAINCODE_CONTAINER}"; then
    echo "Consent access runtime ready: ${CHAINCODE_CONTAINER} (${package_id})"
    exit 0
  fi
  sleep 1
done

docker logs "${CHAINCODE_CONTAINER}" --tail 100 >&2 || true
echo "ERROR: consent access runtime did not remain running: ${CHAINCODE_CONTAINER}" >&2
exit 1
