#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

for chaincode in organization-sc cryptographickey-sc; do
  local_dir="chaincode/${chaincode}-javascript"
  [[ -f "${ROOT_DIR}/${local_dir}/index.js" ]] || {
    echo "ERROR: missing public local-network chaincode: ${local_dir}" >&2
    exit 1
  }
  git -C "${ROOT_DIR}" ls-files --error-unmatch "${local_dir}/index.js" >/dev/null
done

echo "Public identity chaincodes verified: organization-sc, cryptographickey-sc"
