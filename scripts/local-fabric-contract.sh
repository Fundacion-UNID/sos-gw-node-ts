#!/usr/bin/env bash

# Canonical identity of the single hosting organization in the shared local
# Fabric v3 devnet. Every deployer, GW runtime and ledger smoke must author
# proposals with the same MSP id configured on peer0-host1.
readonly LOCAL_FABRIC_HOST_MSP_ID="${HLF_MSP_ID_HOST1:-Host1MSP}"
readonly LOCAL_FABRIC_CHAINCODE_SIGNATURE_POLICY="OR('${LOCAL_FABRIC_HOST_MSP_ID}.member')"
