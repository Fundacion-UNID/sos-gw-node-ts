#!/bin/sh
#
# SPDX-License-Identifier: Apache-2.0
#
set -eu
: "${CORE_PEER_TLS_ENABLED:=false}"
: "${DEBUG:=false}"

chaincode_node="./node_modules/.bin/fabric-chaincode-node"

if [ "$(printf '%s' "${DEBUG}" | tr '[:upper:]' '[:lower:]')" = "true" ]; then
  export NODE_OPTIONS="--inspect=0.0.0.0:9229"
fi

if [ -z "${CHAINCODE_SERVER_ADDRESS+x}" ]; then
  exec "${chaincode_node}" start --peer.address "${CORE_PEER_ADDRESS}"
elif [ "$(printf '%s' "${CORE_PEER_TLS_ENABLED}" | tr '[:upper:]' '[:lower:]')" = "true" ]; then
  exec "${chaincode_node}" server \
    --chaincode-address="${CHAINCODE_SERVER_ADDRESS}" \
    --chaincode-id="${CHAINCODE_ID}" \
    --chaincode-tls-key-file=/hyperledger/privatekey.pem \
    --chaincode-tls-client-cacert-file=/hyperledger/rootcert.pem \
    --chaincode-tls-cert-file=/hyperledger/cert.pem
else
  exec "${chaincode_node}" server \
    --chaincode-address="${CHAINCODE_SERVER_ADDRESS}" \
    --chaincode-id="${CHAINCODE_ID}"
fi
