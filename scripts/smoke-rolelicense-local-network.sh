#!/usr/bin/env bash
set -euo pipefail

CHANNEL_NAME="${CHANNEL_NAME:-identity-local}"
CHAINCODE_NAME="${CHAINCODE_NAME:-rolelicense-sc}"
FABRIC_TOOLS_CONTAINER="${FABRIC_TOOLS_CONTAINER:-gdc-fabric-tools}"
ORG1_DOMAIN="${ORG1_DOMAIN:-host1.example.com}"
ORDERER_DOMAIN="${ORDERER_DOMAIN:-example.com}"
ORG1_MSP_ID="${ORG1_MSP_ID:-Host1MSP}"

ORG1_ADMIN_MSP="/workspace/organizations/peerOrganizations/${ORG1_DOMAIN}/users/Admin@${ORG1_DOMAIN}/msp"
ORG1_PEER_TLS="/workspace/organizations/peerOrganizations/${ORG1_DOMAIN}/peers/peer0.${ORG1_DOMAIN}/tls/ca.crt"
ORDERER_TLS_CA="/workspace/organizations/ordererOrganizations/${ORDERER_DOMAIN}/orderers/orderer.${ORDERER_DOMAIN}/tls/ca.crt"

LICENSE_ID="urn:multibase:z6Mkh7pQ2W8YB3Vt"
ORGANIZATION_ID="${LICENSE_ORGANIZATION_ID:-urn:org:uuid:00000000-0000-4000-8000-000000000101}"
CONTACT_ID="urn:multibase:z3mJr7AoUXx2Wqd"
LICENSE_JURISDICTION="${LICENSE_JURISDICTION:-CA-BC}"
LICENSE_SECTOR="${LICENSE_SECTOR:-animal-care}"
LICENSE_ORGANIZATION_OFFICIAL_ID="${LICENSE_ORGANIZATION_OFFICIAL_ID:-00000000-0000-4000-8000-000000000101}"

for command_name in docker jq; do
  command -v "${command_name}" >/dev/null 2>&1 || { echo "ERROR: missing ${command_name}" >&2; exit 2; }
done

peer_env=(
  env
  CORE_PEER_LOCALMSPID="${ORG1_MSP_ID}"
  CORE_PEER_MSPCONFIGPATH="${ORG1_ADMIN_MSP}"
  CORE_PEER_ADDRESS=peer0-host1:7051
  CORE_PEER_TLS_ENABLED=true
  CORE_PEER_TLS_ROOTCERT_FILE="${ORG1_PEER_TLS}"
)

invoke() {
  local function_name="$1"
  shift
  local invocation
  invocation="$(jq -cn --arg fn "${function_name}" --args '{Args: ([$fn] + $ARGS.positional)}' -- "$@")"
  docker exec "${FABRIC_TOOLS_CONTAINER}" "${peer_env[@]}" \
    peer chaincode invoke \
    -o orderer:7050 --ordererTLSHostnameOverride orderer --tls --cafile "${ORDERER_TLS_CA}" \
    -C "${CHANNEL_NAME}" -n "${CHAINCODE_NAME}" -c "${invocation}" --waitForEvent >/dev/null
}

query() {
  local function_name="$1"
  shift
  local invocation
  invocation="$(jq -cn --arg fn "${function_name}" --args '{Args: ([$fn] + $ARGS.positional)}' -- "$@")"
  docker exec "${FABRIC_TOOLS_CONTAINER}" "${peer_env[@]}" \
    peer chaincode query -C "${CHANNEL_NAME}" -n "${CHAINCODE_NAME}" -c "${invocation}"
}

create_payload="$(jq -cn \
  --arg id "${LICENSE_ID}" \
  --arg organizationId "${ORGANIZATION_ID}" \
  --arg organizationOfficialId "${LICENSE_ORGANIZATION_OFFICIAL_ID}" \
  --arg stableContactIdentifier "${CONTACT_ID}" \
  --arg jurisdiction "${LICENSE_JURISDICTION}" \
  --arg sector "${LICENSE_SECTOR}" \
  '{id:$id,organizationId:$organizationId,organizationOfficialId:$organizationOfficialId,jurisdiction:$jurisdiction,stableContactIdentifier:$stableContactIdentifier,licensedRole:"RESPRSN",data:[{sector:$sector,active:true,maxDevices:5}]}')"

echo "[smoke-rolelicense] ensuring the regional organisation-role licence on ${CHANNEL_NAME}"
invoke EnsureRoleLicense "${LICENSE_ID}" "${create_payload}"
invoke UpsertSectorPolicy "${LICENSE_ID}" \
  "$(jq -cn --arg sector "${LICENSE_SECTOR}" '{sector:$sector,active:true,maxDevices:5}')" \
  20

asset="$(query ReadRoleLicense "${LICENSE_ID}")"
jq -e --arg organizationOfficialId "${LICENSE_ORGANIZATION_OFFICIAL_ID}" --arg sector "${LICENSE_SECTOR}" '
  .organizationOfficialId == $organizationOfficialId
  and .licensedRole == "RESPRSN"
  and (.data | any(.sector == $sector and .active == true and .maxDevices == 5))
  and (has("devices") | not)
' <<<"${asset}" >/dev/null

echo "[smoke-rolelicense] Offer/Order role-licence materialisation succeeded without publishing DCR devices"
