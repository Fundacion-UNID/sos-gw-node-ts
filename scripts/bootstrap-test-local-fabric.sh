#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORKSPACE_ROOT="$(dirname "$(dirname "${ROOT}")")"
DEVNET_ROOT="${FABRIC_MULTICLOUD_DIR:-${WORKSPACE_ROOT}/fabric-multicloud}/devnet/fabric-v3"
BASE_ENV="${ROOT}/.env.local-network"
OUT_ENV="${ROOT}/.env.local-fabric"
LEGACY_OUT_ENV="${ROOT}/.env.local-fabric-devnet"
DEVNET_ENV="${DEVNET_ROOT}/.env.fabric-devnet"

if [[ ! -d "${DEVNET_ROOT}" ]]; then
  echo "Missing devnet directory: ${DEVNET_ROOT}"
  exit 1
fi

if [[ ! -f "${BASE_ENV}" ]]; then
  echo "Missing ${BASE_ENV}"
  echo "Create it first from env.local-network.example"
  exit 1
fi

echo "==> Bootstrapping local Fabric devnet"
cd "${DEVNET_ROOT}"

export SINGLE_HOST="${SINGLE_HOST:-true}"
./scripts/00-copy-dev-cas.sh
./scripts/01-up-cas.sh
./scripts/02-bootstrap-network.sh
./scripts/04-generate-backend-env.sh

if [[ ! -f "${DEVNET_ENV}" ]]; then
  echo "Expected generated env not found: ${DEVNET_ENV}"
  exit 1
fi

echo "==> Writing merged gwtemplate env"
cd "${ROOT}"
cat "${BASE_ENV}" > "${OUT_ENV}"
cat >> "${OUT_ENV}" <<EOF

# Added by scripts/bootstrap-test-local-fabric.sh
NETWORK_MODE=test-network
LEDGER_PROVIDER_DEFAULT=fabric
LEDGER_PROVIDER_MAP=test=mem,test-network=fabric,network=fabric
LEDGER_MSP_ID=Org1MSP
LEDGER_FABRIC_MSP_ID=Org1MSP
EOF
cat "${DEVNET_ENV}" >> "${OUT_ENV}"

echo "Wrote ${OUT_ENV}"
cp "${OUT_ENV}" "${LEGACY_OUT_ENV}"
echo "Wrote compatibility alias ${LEGACY_OUT_ENV}"
echo
echo "Next step:"
echo "  cd ${ROOT}"
echo "  npm run api:local-fabric"
