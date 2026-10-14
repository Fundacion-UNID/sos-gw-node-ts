#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OS_NAME="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH_NAME="$(uname -m)"
case "${ARCH_NAME}" in
  x86_64) ARCH_NAME="amd64" ;;
  arm64|aarch64) ARCH_NAME="arm64" ;;
esac

PLATFORM="${FABRIC_PLATFORM:-${OS_NAME}-${ARCH_NAME}}"
TOOLS_DIR="${ROOT_DIR}/tools/fabric-3.1.3/${PLATFORM}"
BIN="${TOOLS_DIR}/bin/configtxgen"
TARBALL_URL="https://sourceforge.net/projects/hyperledger-fabric.mirror/files/v3.1.3/hyperledger-fabric-${PLATFORM}-3.1.3.tar.gz/download"

CONFIGTX_SRC="${ROOT_DIR}/artifacts/test/channel-artifacts/configtx-channels.yaml"
CHANNELS_MAP="${ROOT_DIR}/artifacts/test/channel-artifacts/channels.map"
OUT_DIR="${ROOT_DIR}/artifacts/test/channel-artifacts"

MSP_SRC="${ROOT_DIR}/artifacts/test/enroll/UNID/msp"
ORDERER_TLS_CERT="${ROOT_DIR}/artifacts/test/enroll/UNID/orderer/tls/signcerts/cert.pem"
ROOT_CA="${ROOT_DIR}/artifacts/test/fabric-ca-server-root/ca-cert.pem"
ICA_CA="${ROOT_DIR}/artifacts/test/fabric-ca-server-ica/TAXES-G02793479_TEST-EUR-ICA_UNID_ONLINE/ca-cert.pem"
ADMIN_CERT_SRC="${ROOT_DIR}/artifacts/test/enroll/UNID/msp/signcerts/cert.pem"

if [[ ! -f "${CONFIGTX_SRC}" ]]; then
  echo "Missing configtx: ${CONFIGTX_SRC}" >&2
  exit 1
fi
if [[ ! -f "${CHANNELS_MAP}" ]]; then
  echo "Missing channels map: ${CHANNELS_MAP}" >&2
  exit 1
fi
if [[ ! -f "${ROOT_CA}" || ! -f "${ICA_CA}" ]]; then
  echo "Missing Fabric CA certs (root/ica) under artifacts/test/fabric-ca-server-*" >&2
  exit 1
fi
if [[ ! -f "${ORDERER_TLS_CERT}" ]]; then
  echo "Missing orderer TLS cert: ${ORDERER_TLS_CERT}" >&2
  exit 1
fi
if [[ ! -f "${ADMIN_CERT_SRC}" ]]; then
  echo "Missing MSP admin cert: ${ADMIN_CERT_SRC}" >&2
  exit 1
fi

if [[ -d "${OUT_DIR}" && -n "$(ls -1 "${OUT_DIR}"/*.block 2>/dev/null || true)" ]]; then
  if [[ "${GDC_FORCE:-}" != "1" ]]; then
    read -r -p "Channel blocks already exist in ${OUT_DIR}. Overwrite? [y/N] " confirm
    if [[ "${confirm}" != "y" && "${confirm}" != "Y" ]]; then
      echo "Aborted."
      exit 1
    fi
  fi
fi

mkdir -p "${TOOLS_DIR}"
if [[ ! -x "${BIN}" ]]; then
  if ! command -v curl >/dev/null 2>&1; then
    echo "curl is required to download Fabric binaries." >&2
    exit 1
  fi
  if ! command -v tar >/dev/null 2>&1; then
    echo "tar is required to extract Fabric binaries." >&2
    exit 1
  fi
  echo "Downloading Fabric v3.1.3 binaries for ${PLATFORM}..."
  mkdir -p "${TOOLS_DIR}"
  curl -L -o "${TOOLS_DIR}/fabric-3.1.3.tgz" "${TARBALL_URL}"
  tar -xzf "${TOOLS_DIR}/fabric-3.1.3.tgz" -C "${TOOLS_DIR}"
fi

if [[ ! -x "${BIN}" ]]; then
  echo "configtxgen not found at ${BIN}" >&2
  exit 1
fi

TMP_DIR="$(mktemp -d)"
cleanup() { rm -rf "${TMP_DIR}"; }
trap cleanup EXIT

MSP_DIR="${TMP_DIR}/msp/UNIDMSP"
CERTS_DIR="${TMP_DIR}/certs"
mkdir -p "${MSP_DIR}"
cp -R "${MSP_SRC}/." "${MSP_DIR}/"

mkdir -p "${MSP_DIR}/admincerts"
cp "${ADMIN_CERT_SRC}" "${MSP_DIR}/admincerts/admin-cert.pem"

rm -rf "${MSP_DIR}/cacerts" "${MSP_DIR}/intermediatecerts" "${MSP_DIR}/tlscacerts"
mkdir -p "${MSP_DIR}/cacerts" "${MSP_DIR}/intermediatecerts" "${MSP_DIR}/tlscacerts"
cp "${ROOT_CA}" "${MSP_DIR}/cacerts/root-ca.pem"
cp "${ICA_CA}" "${MSP_DIR}/intermediatecerts/ica-ca.pem"
cp "${ICA_CA}" "${MSP_DIR}/tlscacerts/ica-tls-ca.pem"

mkdir -p "${CERTS_DIR}"
cp "${ORDERER_TLS_CERT}" "${CERTS_DIR}/orderer.crt"

CONFIGTX_TMP="${TMP_DIR}/configtx.yaml"
sed -e "s|MSPDir: /msp/UNIDMSP|MSPDir: ${MSP_DIR}|g" \
    -e "s|/certs/orderer.crt|${CERTS_DIR}/orderer.crt|g" \
    "${CONFIGTX_SRC}" > "${CONFIGTX_TMP}"

export FABRIC_CFG_PATH="${TMP_DIR}"

rm -f "${OUT_DIR}"/*.block
while IFS=: read -r channel profile; do
  echo "Generating ${channel} from ${profile}"
  "${BIN}" -profile "${profile}" -outputBlock "${OUT_DIR}/${channel}.block" -channelID "${channel}"
done < "${CHANNELS_MAP}"

"${BIN}" --version
echo "Generated $(ls -1 "${OUT_DIR}"/*.block | wc -l | tr -d ' ') channel blocks."
