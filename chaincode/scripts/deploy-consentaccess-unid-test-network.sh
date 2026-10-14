#!/usr/bin/env bash
set -euo pipefail

# -----------------------------------------------------------------------------
# ConsentAccess CCAAS deployer for the real UNID test-network on GKE
# -----------------------------------------------------------------------------
#
# Why this script exists:
# - the local devnet deployer already proves the chaincode package works
# - the shared UNID test-network needs the same chaincode as an external
#   Chaincode-as-a-Service (CCAAS) workload inside Kubernetes
# - the peer must install the CCAAS package, approve it, and commit it on the
#   real `health-care-eu` channel
#
# What this script does:
# 1. builds the chaincode metadata and CCAAS archive
# 2. computes the Fabric PACKAGE_ID before install
# 3. builds and pushes the external service image to Artifact Registry
# 4. deploys `consentaccess-sc` as a Kubernetes Deployment + Service in UNID
# 5. runs a Kubernetes Job that installs, approves and commits the chaincode
#
# Important assumptions:
# - UNID is the bootstrap org for the current network phase
# - the peer and orderer already exist in the UNID test cluster
# - the Fabric channel `health-care-eu` already exists
# - the namespace already contains:
#   - secret `peer-msp`
#   - secret `osnadmin-tls`
# - the peer is reachable in-cluster as `peer0:7051`
# - the orderer is reachable in-cluster as `orderer:7050`
# - the peer uses the repo's current non-TLS peer service setup
#
# Typical usage:
#   gcloud auth login
#   gcloud config set project uhc-unid
#   bash ./gwtemplate-node-ts/chaincode/scripts/deploy-consentaccess-unid-test-network.sh
#
# Safe reruns:
# - the Deployment/Service and ConfigMap are applied declaratively
# - the lifecycle Job is deleted and recreated each run
# - if the package is already installed, the job skips reinstall
#
# Main overrides:
# - CHANNEL_NAME
# - CHAINCODE_VERSION
# - CHAINCODE_SEQUENCE
# - CHAINCODE_IMAGE_TAG
# - CHAINCODE_IMAGE_REPOSITORY
# - CHAINCODE_IMAGE (an immutable shared CCAAS runtime may be reused)
# - SKIP_CHAINCODE_IMAGE_BUILD
# - SKIP_CHAINCODE_ARTIFACT_TESTS
# - SKIP_CHAINCODE_INSTALL (governance phase after participant installation)
# - K8S_NAMESPACE_FABRIC
# -----------------------------------------------------------------------------

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORKSPACE_ROOT="$(cd "${ROOT}/../../.." && pwd)"
CHAINCODE_DIR="${ROOT}/consentaccess-sc-javascript"
FABRIC_ROOT="${FABRIC_MULTICLOUD_DIR:-${WORKSPACE_ROOT}/fabric-multicloud}"
PROFILE_FILE="${WORKSPACE_ROOT}/private-infra/fabric-multicloud-env/org-profiles/unid.env"
DEPLOYMENT_PROFILE_FILE="${DEPLOYMENT_PROFILE_FILE:-}"
SKIP_CHAINCODE_IMAGE_BUILD="${SKIP_CHAINCODE_IMAGE_BUILD:-false}"
SKIP_CHAINCODE_ARTIFACT_TESTS="${SKIP_CHAINCODE_ARTIFACT_TESTS:-false}"
SKIP_CHAINCODE_INSTALL="${SKIP_CHAINCODE_INSTALL:-false}"

CHANNEL_NAME="${CHANNEL_NAME:-health-care-eu}"
CHAINCODE_NAME="${CHAINCODE_NAME:-consentaccess-sc}"
CHAINCODE_VERSION="${CHAINCODE_VERSION:-1.0}"
CHAINCODE_SEQUENCE="${CHAINCODE_SEQUENCE:-1}"
CHAINCODE_LABEL="${CHAINCODE_LABEL:-consentaccess-sc}"
CHAINCODE_PACKAGE_ARCHIVE="${CHAINCODE_PACKAGE_ARCHIVE:-consentaccess-sc-caas.tgz}"
CHAINCODE_SERVER_PORT="${CHAINCODE_SERVER_PORT:-9999}"
CHAINCODE_SERVICE_NAME="${CHAINCODE_SERVICE_NAME:-consentaccess-sc}"
CHAINCODE_ADVERTISE_ADDRESS="${CHAINCODE_ADVERTISE_ADDRESS:-${CHAINCODE_SERVICE_NAME}:${CHAINCODE_SERVER_PORT}}"
CHAINCODE_RUNTIME_ADDRESS="${CHAINCODE_RUNTIME_ADDRESS:-0.0.0.0:${CHAINCODE_SERVER_PORT}}"
CHAINCODE_SIGNATURE_POLICY="${CHAINCODE_SIGNATURE_POLICY:-OR('UNIDMSP.member')}"
CHAINCODE_K8S_DEPLOYMENT_NAME="${CHAINCODE_K8S_DEPLOYMENT_NAME:-consentaccess-sc}"
CHAINCODE_K8S_PACKAGE_CONFIGMAP="${CHAINCODE_K8S_PACKAGE_CONFIGMAP:-consentaccess-sc-package}"
CHAINCODE_K8S_JOB_NAME="${CHAINCODE_K8S_JOB_NAME:-consentaccess-sc-lifecycle}"

ARTIFACT_REGISTRY_NAME="${ARTIFACT_REGISTRY_NAME:-fabric-chaincode}"
CHAINCODE_IMAGE_NAME="${CHAINCODE_IMAGE_NAME:-consentaccess-sc-unid-test-network}"
CHAINCODE_IMAGE_TAG="${CHAINCODE_IMAGE_TAG:-latest}"

FABRIC_VERSION="${FABRIC_VERSION:-3.1.4}"
FABRIC_TOOLS_ROOT="${FABRIC_TOOLS_ROOT:-${FABRIC_ROOT}/tools/fabric-${FABRIC_VERSION}}"

if [[ -d "${FABRIC_TOOLS_ROOT}/darwin-amd64-bin/bin" ]]; then
  FABRIC_LOCAL_BIN_DIR="${FABRIC_LOCAL_BIN_DIR:-${FABRIC_TOOLS_ROOT}/darwin-amd64-bin/bin}"
elif [[ -d "${FABRIC_TOOLS_ROOT}/darwin-amd64/bin" ]]; then
  FABRIC_LOCAL_BIN_DIR="${FABRIC_LOCAL_BIN_DIR:-${FABRIC_TOOLS_ROOT}/darwin-amd64/bin}"
else
  FABRIC_LOCAL_BIN_DIR="${FABRIC_LOCAL_BIN_DIR:-${FABRIC_TOOLS_ROOT}/bin}"
fi

PEER_BIN="${PEER_BIN:-${FABRIC_LOCAL_BIN_DIR}/peer}"
if [[ -d "$(dirname "${FABRIC_LOCAL_BIN_DIR}")/config" ]]; then
  FABRIC_CFG_PATH="${FABRIC_CFG_PATH:-$(dirname "${FABRIC_LOCAL_BIN_DIR}")/config}"
else
  FABRIC_CFG_PATH="${FABRIC_CFG_PATH:-${FABRIC_TOOLS_ROOT}/config}"
fi
PEER_COMMAND_CFG_PATH="${FABRIC_CFG_PATH}"
if [[ -d "${FABRIC_ROOT}/artifacts/test-network/pki-host/UNIDMSP/msp" ]]; then
  ADMIN_MSP_DIR="${ADMIN_MSP_DIR:-${FABRIC_ROOT}/artifacts/test-network/pki-host/UNIDMSP/msp}"
elif [[ -d "${FABRIC_ROOT}/artifacts/test-network/pki-host/UNIDMSP/admin/msp" ]]; then
  ADMIN_MSP_DIR="${ADMIN_MSP_DIR:-${FABRIC_ROOT}/artifacts/test-network/pki-host/UNIDMSP/admin/msp}"
elif [[ -d "${FABRIC_ROOT}/artifacts/test/pki-host/UNIDMSP/msp" ]]; then
  ADMIN_MSP_DIR="${ADMIN_MSP_DIR:-${FABRIC_ROOT}/artifacts/test/pki-host/UNIDMSP/msp}"
else
  ADMIN_MSP_DIR="${ADMIN_MSP_DIR:-${FABRIC_ROOT}/artifacts/test/pki-host/UNIDMSP/admin/msp}"
fi
ADMIN_MSP_SECRET_NAME="${ADMIN_MSP_SECRET_NAME:-peer-admin-msp}"

function info() {
  printf '\n==> %s\n' "$1"
}

function fail() {
  printf '\nERROR: %s\n' "$1" >&2
  exit 1
}

function require_file() {
  [[ -f "$1" ]] || fail "Missing file: $1"
}

function require_dir() {
  [[ -d "$1" ]] || fail "Missing directory: $1"
}

function require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "Missing command: $1"
}

require_dir "${CHAINCODE_DIR}"
require_dir "${FABRIC_ROOT}"
require_file "${PROFILE_FILE}"
require_file "${PEER_BIN}"
require_dir "${ADMIN_MSP_DIR}"
if [[ "${SKIP_CHAINCODE_IMAGE_BUILD}" != "true" ]]; then
  require_command docker
fi
require_command kubectl
require_command gcloud
require_command npm
require_command tar
require_command awk
require_command sed

# shellcheck disable=SC1090
source "${PROFILE_FILE}"
if [[ -n "${DEPLOYMENT_PROFILE_FILE}" ]]; then
  require_file "${DEPLOYMENT_PROFILE_FILE}"
  # shellcheck disable=SC1090
  source "${DEPLOYMENT_PROFILE_FILE}"
fi
FABRIC_CFG_PATH="${CHAINCODE_FABRIC_CFG_PATH:-${PEER_COMMAND_CFG_PATH}}"

K8S_NAMESPACE_FABRIC="${K8S_NAMESPACE_FABRIC:-${K8S_NAMESPACE_FABRIC_TEST:-test-fabric-v3}}"
KUBE_CONTEXT="${KUBE_CONTEXT:-}"
GCP_PROJECT_ID="${GCP_PROJECT_ID:-uhc-unid}"
GCP_REGION="${GCP_REGION:-europe-southwest1}"
ORG_MSP_ID="${ORG_MSP_ID:-UNIDMSP}"
ORDERER_SERVICE_NAME="${ORDERER_SERVICE_NAME:-orderer}"
PEER_SERVICE_NAME="${PEER_SERVICE_NAME:-peer0}"
PEER_MSP_SECRET_NAME="${PEER_MSP_SECRET_NAME:-peer-msp}"
OSNADMIN_TLS_SECRET_NAME="${OSNADMIN_TLS_SECRET_NAME:-osnadmin-tls}"

CHAINCODE_IMAGE_REPOSITORY="${CHAINCODE_IMAGE_REPOSITORY:-${GCP_REGION}-docker.pkg.dev/${GCP_PROJECT_ID}/${ARTIFACT_REGISTRY_NAME}/${CHAINCODE_IMAGE_NAME}}"
CHAINCODE_IMAGE="${CHAINCODE_IMAGE:-${CHAINCODE_IMAGE_REPOSITORY}:${CHAINCODE_IMAGE_TAG}}"

KUBECTL=(kubectl)
if [[ -n "${KUBE_CONTEXT}" ]]; then
  KUBECTL+=(--context "${KUBE_CONTEXT}")
fi

function package_chaincode_archive_without_weft() {
  local package_root
  package_root="$(mktemp -d)"
  local code_root="${package_root}/code"
  local connection_json="${code_root}/connection.json"
  local metadata_json="${package_root}/metadata.json"

  mkdir -p "${code_root}"

  cat > "${connection_json}" <<EOF
{"address":"${CHAINCODE_ADVERTISE_ADDRESS}","dial_timeout":"10s","tls_required":false}
EOF

  cat > "${metadata_json}" <<EOF
{"path":"","type":"ccaas","label":"${CHAINCODE_LABEL}"}
EOF

  (cd "${code_root}" && COPYFILE_DISABLE=1 tar --exclude='._*' --exclude='__MACOSX' -czf "${package_root}/code.tar.gz" connection.json)
  (cd "${package_root}" && COPYFILE_DISABLE=1 tar --exclude='._*' --exclude='__MACOSX' -czf "${CHAINCODE_DIR}/${CHAINCODE_PACKAGE_ARCHIVE}" metadata.json code.tar.gz)
  rm -rf "${package_root}"
}

function build_chaincode_artifacts() {
  if [[ "${SKIP_CHAINCODE_ARTIFACT_TESTS}" == "true" ]]; then
    info "Reusing the published runtime; skipping unavailable local chaincode source tests"
  else
    info "Running unit tests for consentaccess-sc"
    (cd "${CHAINCODE_DIR}" && npm test)

    info "Generating metadata.json"
    (cd "${CHAINCODE_DIR}" && npm run metadata)
  fi

  info "Packaging CCAAS archive for ${CHAINCODE_ADVERTISE_ADDRESS}"
  if command -v weft >/dev/null 2>&1; then
    (cd "${CHAINCODE_DIR}" && CHAINCODE_SERVER_ADDRESS="${CHAINCODE_ADVERTISE_ADDRESS}" npm run package:k8s)
  else
    package_chaincode_archive_without_weft
  fi
  require_file "${CHAINCODE_DIR}/${CHAINCODE_PACKAGE_ARCHIVE}"
}

function calculate_package_id() {
  printf '\n==> %s\n' "Calculating Fabric package id locally" >&2
  FABRIC_CFG_PATH="${FABRIC_CFG_PATH}" "${PEER_BIN}" lifecycle chaincode calculatepackageid "${CHAINCODE_DIR}/${CHAINCODE_PACKAGE_ARCHIVE}" | tail -n 1 | tr -d '\r'
}

function ensure_artifact_registry() {
  info "Ensuring Artifact Registry repository exists"
  gcloud config set project "${GCP_PROJECT_ID}" >/dev/null
  gcloud services enable artifactregistry.googleapis.com >/dev/null
  if ! gcloud artifacts repositories describe "${ARTIFACT_REGISTRY_NAME}" --location="${GCP_REGION}" >/dev/null 2>&1; then
    gcloud artifacts repositories create "${ARTIFACT_REGISTRY_NAME}" \
      --repository-format=docker \
      --location="${GCP_REGION}" \
      --description="Fabric chaincode images for UNID test-network"
  fi
  gcloud auth configure-docker "${GCP_REGION}-docker.pkg.dev" --quiet >/dev/null
}

function build_and_push_chaincode_image() {
  info "Building external chaincode image ${CHAINCODE_IMAGE}"
  (cd "${CHAINCODE_DIR}" && docker build --target ccaas -f ./Dockerfile -t "${CHAINCODE_IMAGE}" .)

  info "Pushing external chaincode image"
  docker push "${CHAINCODE_IMAGE}"
}

function apply_package_configmap() {
  info "Publishing CCAAS archive as ConfigMap ${CHAINCODE_K8S_PACKAGE_CONFIGMAP}"
  "${KUBECTL[@]}" -n "${K8S_NAMESPACE_FABRIC}" create configmap "${CHAINCODE_K8S_PACKAGE_CONFIGMAP}" \
    --from-file=chaincode.tgz="${CHAINCODE_DIR}/${CHAINCODE_PACKAGE_ARCHIVE}" \
    --dry-run=client -o yaml | "${KUBECTL[@]}" apply -f -
}

function apply_admin_msp_secret() {
  info "Publishing admin MSP as Secret ${ADMIN_MSP_SECRET_NAME}"
  local temp_archive
  temp_archive="$(mktemp /tmp/peer-admin-msp.XXXXXX.tgz)"
  COPYFILE_DISABLE=1 tar --exclude='._*' --exclude='__MACOSX' -czf "${temp_archive}" -C "${ADMIN_MSP_DIR}" .
  "${KUBECTL[@]}" -n "${K8S_NAMESPACE_FABRIC}" create secret generic "${ADMIN_MSP_SECRET_NAME}" \
    --from-file=msp.tgz="${temp_archive}" \
    --dry-run=client -o yaml | "${KUBECTL[@]}" apply -f -
  rm -f "${temp_archive}"
}

function apply_chaincode_runtime() {
  local package_id="$1"

  info "Deploying CCAAS runtime ${CHAINCODE_K8S_DEPLOYMENT_NAME}"
  cat <<EOF | "${KUBECTL[@]}" apply -f -
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${CHAINCODE_K8S_DEPLOYMENT_NAME}
  namespace: ${K8S_NAMESPACE_FABRIC}
spec:
  replicas: 1
  selector:
    matchLabels:
      app: ${CHAINCODE_K8S_DEPLOYMENT_NAME}
  template:
    metadata:
      labels:
        app: ${CHAINCODE_K8S_DEPLOYMENT_NAME}
    spec:
      containers:
        - name: consentaccess-sc
          image: ${CHAINCODE_IMAGE}
          imagePullPolicy: Always
          env:
            - name: CHAINCODE_SERVER_ADDRESS
              value: "${CHAINCODE_RUNTIME_ADDRESS}"
            - name: CHAINCODE_ID
              value: "${package_id}"
            - name: CHAINCODE_NAME
              value: "${CHAINCODE_NAME}"
          ports:
            - containerPort: ${CHAINCODE_SERVER_PORT}
---
apiVersion: v1
kind: Service
metadata:
  name: ${CHAINCODE_SERVICE_NAME}
  namespace: ${K8S_NAMESPACE_FABRIC}
spec:
  selector:
    app: ${CHAINCODE_K8S_DEPLOYMENT_NAME}
  ports:
    - name: chaincode
      port: ${CHAINCODE_SERVER_PORT}
      targetPort: ${CHAINCODE_SERVER_PORT}
EOF

  "${KUBECTL[@]}" -n "${K8S_NAMESPACE_FABRIC}" rollout status deployment/"${CHAINCODE_K8S_DEPLOYMENT_NAME}" --timeout=180s
}

function run_lifecycle_job() {
  local package_id="$1"

  info "Recreating lifecycle Job ${CHAINCODE_K8S_JOB_NAME}"
  "${KUBECTL[@]}" -n "${K8S_NAMESPACE_FABRIC}" delete job "${CHAINCODE_K8S_JOB_NAME}" --ignore-not-found >/dev/null 2>&1 || true

  cat <<EOF | "${KUBECTL[@]}" apply -f -
apiVersion: batch/v1
kind: Job
metadata:
  name: ${CHAINCODE_K8S_JOB_NAME}
  namespace: ${K8S_NAMESPACE_FABRIC}
spec:
  backoffLimit: 1
  template:
    spec:
      restartPolicy: Never
      initContainers:
        - name: init-msp
          image: busybox:1.36
          command:
            - sh
            - -c
            - |
              set -e
              if [ -f /msp-src/msp.tgz ]; then
                tar -xzf /msp-src/msp.tgz -C /msp-dst
              else
                cp -R /msp-src/* /msp-dst/
              fi
          volumeMounts:
            - name: peer-msp-secret
              mountPath: /msp-src
            - name: peer-msp
              mountPath: /msp-dst
      containers:
        - name: lifecycle
          image: hyperledger/fabric-peer:3.1.3
          env:
            - name: CORE_PEER_LOCALMSPID
              value: "${ORG_MSP_ID}"
            - name: CORE_PEER_MSPCONFIGPATH
              value: /msp
            - name: CORE_PEER_ADDRESS
              value: "${PEER_SERVICE_NAME}:7051"
            - name: CORE_PEER_TLS_ENABLED
              value: "true"
            - name: CORE_PEER_TLS_ROOTCERT_FILE
              value: /crypto/peer-ca.pem
            - name: CHANNEL_NAME
              value: "${CHANNEL_NAME}"
            - name: CHAINCODE_NAME
              value: "${CHAINCODE_NAME}"
            - name: CHAINCODE_VERSION
              value: "${CHAINCODE_VERSION}"
            - name: CHAINCODE_SEQUENCE
              value: "${CHAINCODE_SEQUENCE}"
            - name: CHAINCODE_SIGNATURE_POLICY
              value: "${CHAINCODE_SIGNATURE_POLICY}"
            - name: PACKAGE_ID
              value: "${package_id}"
          command:
            - bash
            - -lc
            - |
              set -euo pipefail
              if [[ "${SKIP_CHAINCODE_INSTALL}" == "true" ]]; then
                echo "Participant phase already installed CCAAS package: ${PACKAGE_ID}"
              elif peer lifecycle chaincode queryinstalled | grep -Fq "${PACKAGE_ID}"; then
                echo "Package already installed: ${PACKAGE_ID}"
              else
                peer lifecycle chaincode install /chaincode-src/chaincode.tgz
              fi

              peer lifecycle chaincode approveformyorg \
                -o ${ORDERER_SERVICE_NAME}:7050 \
                --tls --cafile /crypto/ica-ca.pem \
                --channelID "${CHANNEL_NAME}" \
                --name "${CHAINCODE_NAME}" \
                --version "${CHAINCODE_VERSION}" \
                --package-id "${PACKAGE_ID}" \
                --sequence "${CHAINCODE_SEQUENCE}" \
                --signature-policy "${CHAINCODE_SIGNATURE_POLICY}"

              peer lifecycle chaincode commit \
                -o ${ORDERER_SERVICE_NAME}:7050 \
                --tls --cafile /crypto/ica-ca.pem \
                --channelID "${CHANNEL_NAME}" \
                --name "${CHAINCODE_NAME}" \
                --version "${CHAINCODE_VERSION}" \
                --sequence "${CHAINCODE_SEQUENCE}" \
                --signature-policy "${CHAINCODE_SIGNATURE_POLICY}" \
                --peerAddresses ${PEER_SERVICE_NAME}:7051 \
                --tlsRootCertFiles /crypto/peer-ca.pem

              APPROVED_PACKAGE_ID="\$(peer lifecycle chaincode queryapproved \
                --channelID "${CHANNEL_NAME}" \
                --name "${CHAINCODE_NAME}" \
                --sequence "${CHAINCODE_SEQUENCE}" \
                --output json \
                | sed -n 's/.*"package_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
                | tail -n 1)"
              test -n "\${APPROVED_PACKAGE_ID}"
              echo "APPROVED_PACKAGE_ID=\${APPROVED_PACKAGE_ID}"
          volumeMounts:
            - name: peer-msp
              mountPath: /msp
            - name: crypto
              mountPath: /crypto
            - name: chaincode-src
              mountPath: /chaincode-src
      volumes:
        - name: peer-msp-secret
          secret:
            secretName: ${ADMIN_MSP_SECRET_NAME}
        - name: peer-msp
          emptyDir: {}
        - name: crypto
          secret:
            secretName: ${OSNADMIN_TLS_SECRET_NAME}
        - name: chaincode-src
          configMap:
            name: ${CHAINCODE_K8S_PACKAGE_CONFIGMAP}
EOF

  "${KUBECTL[@]}" -n "${K8S_NAMESPACE_FABRIC}" wait --for=condition=complete job/"${CHAINCODE_K8S_JOB_NAME}" --timeout=240s
  "${KUBECTL[@]}" -n "${K8S_NAMESPACE_FABRIC}" logs job/"${CHAINCODE_K8S_JOB_NAME}"
}

function resolve_runtime_package_id() {
  local fallback_package_id="$1"
  local approved_package_id
  approved_package_id="$(
    "${KUBECTL[@]}" -n "${K8S_NAMESPACE_FABRIC}" logs job/"${CHAINCODE_K8S_JOB_NAME}" \
      | sed -n 's/^APPROVED_PACKAGE_ID=//p' \
      | tail -n 1
  )"
  if [[ -n "${approved_package_id}" ]]; then
    printf '%s\n' "${approved_package_id}"
  else
    printf '%s\n' "${fallback_package_id}"
  fi
}

function print_summary() {
  local package_id="$1"
  cat <<EOF

ConsentAccess deploy prepared for the real UNID test-network.

Cluster:
  project:         ${GCP_PROJECT_ID}
  region:          ${GCP_REGION}
  context:         ${KUBE_CONTEXT}
  namespace:       ${K8S_NAMESPACE_FABRIC}

Chaincode:
  channel:         ${CHANNEL_NAME}
  name:            ${CHAINCODE_NAME}
  version:         ${CHAINCODE_VERSION}
  sequence:        ${CHAINCODE_SEQUENCE}
  package label:   ${CHAINCODE_LABEL}
  package id:      ${package_id}
  policy:          ${CHAINCODE_SIGNATURE_POLICY}

CCAAS runtime:
  service:         ${CHAINCODE_SERVICE_NAME}
  advertised:      ${CHAINCODE_ADVERTISE_ADDRESS}
  runtime listen:  ${CHAINCODE_RUNTIME_ADDRESS}
  image:           ${CHAINCODE_IMAGE}

GW runtime values expected afterwards:
  NETWORK_MODE=test-network
  LEDGER_MSP_ID=${ORG_MSP_ID}
  LEDGER_FABRIC_MSP_ID=${ORG_MSP_ID}
  CONSENT_ACCESS_LEDGER_CHAINCODE=${CHAINCODE_NAME}
  sector=health-care
  jurisdiction=eu
EOF
}

build_chaincode_artifacts
PACKAGE_ID="$(calculate_package_id)"
[[ -n "${PACKAGE_ID}" ]] || fail "Could not resolve PACKAGE_ID for ${CHAINCODE_PACKAGE_ARCHIVE}"

if [[ "${SKIP_CHAINCODE_IMAGE_BUILD}" == "true" ]]; then
  info "Reusing existing external chaincode image ${CHAINCODE_IMAGE}"
else
  ensure_artifact_registry
  build_and_push_chaincode_image
fi
apply_package_configmap
apply_admin_msp_secret
run_lifecycle_job "${PACKAGE_ID}"
if [[ "${SKIP_CHAINCODE_INSTALL}" == "true" ]]; then
  info "Governance phase leaves the participant-owned CCAAS runtime unchanged"
  RUNTIME_PACKAGE_ID="${PACKAGE_ID}"
else
  RUNTIME_PACKAGE_ID="$(resolve_runtime_package_id "${PACKAGE_ID}")"
  apply_chaincode_runtime "${RUNTIME_PACKAGE_ID}"
fi
print_summary "${RUNTIME_PACKAGE_ID}"
