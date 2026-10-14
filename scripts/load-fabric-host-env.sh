#!/usr/bin/env bash
#
# load-fabric-host-env.sh
# -----------------------
# Source this helper before starting `gwtemplate` when the host should use the
# Fabric-backed ledger adapter.
#
# What it does:
# - resolves the host/admin MSP material for the requested MSP ID
# - reads the signcert, private key, and TLS CA from the standard artifacts tree
# - exports the `LEDGER_*` and `HLF_*` variables expected by `gwtemplate`
#
# Typical usage:
#   source ./scripts/load-fabric-host-env.sh UNIDMSP
#   source ./scripts/load-fabric-host-env.sh UNIDMSP test-network
#   npm run api:local-demo
#
# Optional overrides:
# - `FABRIC_HOST_ARTIFACTS_ROOT`
#     Defaults to `../fabric-multicloud/artifacts/<mode>/pki-host`
# - `HLF_CONNECTION_PEER_OVERRIDE`
#     Defaults to `peer0:7051`
#
# Important:
# - this script must be `source`d so the exported variables remain in the
#   current shell
# - the MSP must already exist under the artifacts tree
# - this helper loads client identity material for the host runtime; it does not
#   generate certificates or talk to the CA

if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
  echo "This script must be sourced, not executed."
  echo "Usage: source ./scripts/load-fabric-host-env.sh <MSP_ID>"
  exit 1
fi

set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: source ./scripts/load-fabric-host-env.sh <MSP_ID> [test-local|test-network|network]"
  return 1
fi

MSP_ID="$1"
ARTIFACT_MODE="${2:-test-network}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
WORKSPACE_ROOT="$(dirname "$(dirname "${REPO_ROOT}")")"

DEFAULT_ARTIFACTS_ROOT="${FABRIC_MULTICLOUD_DIR:-${WORKSPACE_ROOT}/fabric-multicloud}/artifacts/${ARTIFACT_MODE}/pki-host"
LEGACY_ARTIFACTS_ROOT="${FABRIC_MULTICLOUD_DIR:-${WORKSPACE_ROOT}/fabric-multicloud}/artifacts/test/pki-host"
ARTIFACTS_ROOT="${FABRIC_HOST_ARTIFACTS_ROOT:-${DEFAULT_ARTIFACTS_ROOT}}"

if [[ -z "${FABRIC_HOST_ARTIFACTS_ROOT:-}" && ! -d "${ARTIFACTS_ROOT}" && -d "${LEGACY_ARTIFACTS_ROOT}" ]]; then
  ARTIFACTS_ROOT="${LEGACY_ARTIFACTS_ROOT}"
fi

MSP_DIR="${ARTIFACTS_ROOT}/${MSP_ID}"
PEER_ENDPOINT="${HLF_CONNECTION_PEER_OVERRIDE:-peer0:7051}"

ADMIN_MSP_DIR="${MSP_DIR}/admin/msp"
CERT_FILE="${ADMIN_MSP_DIR}/signcerts/cert.pem"
KEY_FILE="$(find "${ADMIN_MSP_DIR}/keystore" -maxdepth 1 -type f -name '*_sk' | sort | head -n 1)"
TLS_CA_FILE="$(find "${MSP_DIR}" -path '*/tlscacerts/*' -type f | sort | head -n 1)"

if [[ ! -d "${MSP_DIR}" ]]; then
  echo "MSP artifacts directory not found: ${MSP_DIR}"
  return 1
fi

if [[ ! -f "${CERT_FILE}" ]]; then
  echo "MSP signcert not found: ${CERT_FILE}"
  return 1
fi

if [[ -z "${KEY_FILE}" || ! -f "${KEY_FILE}" ]]; then
  echo "MSP private key not found under: ${ADMIN_MSP_DIR}/keystore"
  return 1
fi

if [[ -z "${TLS_CA_FILE}" || ! -f "${TLS_CA_FILE}" ]]; then
  echo "TLS CA file not found under: ${MSP_DIR}"
  return 1
fi

# Convert a PEM file into the single-line `\n`-escaped format expected by the
# existing `HLF_*` environment variables consumed by the Fabric gateway code.
to_env_one_line_pem() {
  awk '{printf "%s\\n",$0}' "$1"
}

export LEDGER_PROVIDER_DEFAULT="${LEDGER_PROVIDER_DEFAULT:-fabric}"
export LEDGER_PROVIDER_MAP="${LEDGER_PROVIDER_MAP:-network=fabric}"
export LEDGER_MSP_ID="${MSP_ID}"
export LEDGER_FABRIC_MSP_ID="${MSP_ID}"
export LEDGER_FABRIC_ITEM_TYPE="${LEDGER_FABRIC_ITEM_TYPE:-credential}"

export HLF_CONNECTION_PEER="${PEER_ENDPOINT}"
export HLF_CONNECTION_PEM="$(to_env_one_line_pem "${TLS_CA_FILE}")"
export HLF_CERTIFICATE="$(to_env_one_line_pem "${CERT_FILE}")"
export HLF_PRIVATE_KEY="$(to_env_one_line_pem "${KEY_FILE}")"

echo "Loaded Fabric host env for ${MSP_ID}"
echo "Artifacts root: ${ARTIFACTS_ROOT}"
echo "Peer endpoint: ${PEER_ENDPOINT}"
echo "Signcert: ${CERT_FILE}"
echo "Private key: ${KEY_FILE}"
echo "TLS CA: ${TLS_CA_FILE}"
