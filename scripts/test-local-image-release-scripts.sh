#!/usr/bin/env bash
# Flow contract: a VetChain release proves individual SMART plus provider- and
# consumer-authorized research access; an explicitly skipped research flow is
# never accepted as the default release profile.
set -euo pipefail

# Flow contract: a product GW release owns its workload manifests and deployer;
# fabric-multicloud may provide Fabric network inputs but never deploy the GW.
if grep -Eq '05-k8s-deploy-gdc|FABRIC_MULTICLOUD_DIR' ./cloud_deploy.sh; then
  echo "cloud_deploy.sh must not delegate GW deployment to fabric-multicloud" >&2
  exit 1
fi
test -x ./scripts/deploy-gke-gw.sh
test -x ./scripts/validate-gw-runtime-profile.sh
test -f ./deploy/gke-gw/deployment.yaml
grep -Fq 'validate-gw-runtime-profile.sh' ./scripts/deploy-gke-gw.sh
grep -Fq 'GDC_REQUIRED_FIREBASE_AUTH_PROJECT_IDS' ./deploy/vetchain/staging.config
grep -Fq 'rollout restart "deployment/${GDC_RESOURCE_NAME}"' ./scripts/deploy-gke-gw.sh
grep -Fq 'RESEARCH_TERMINOLOGY_BASE_URL=' ./scripts/deploy-gke-gw.sh
grep -Fq 'RESEARCH_TERMINOLOGY_LABELS_ENABLED=false' ./scripts/deploy-gke-gw.sh
grep -Fq '__RESEARCH_TERMINOLOGY_BASE_URL__' ./scripts/deploy-gke-gw.sh
grep -Fq 'RESEARCH_TERMINOLOGY_BASE_URL:' ./deploy/gke-gw/configmap.yaml
grep -Fq 'RESEARCH_TERMINOLOGY_LABELS_ENABLED:' ./deploy/gke-gw/configmap.yaml
# A legal name may contain sed replacement metacharacters (notably `&`). The
# deployer must escape it before rendering so staging metadata stays exact.
grep -Fq 'host_legal_name_sed=' ./scripts/deploy-gke-gw.sh
grep -Fq '__HOST_LEGAL_NAME__|${host_legal_name_sed}' ./scripts/deploy-gke-gw.sh
if grep -q '^QUEUE_PROVIDER=mem' ./deploy/vetchain/production.runtime.env; then
  echo "production must not use an in-memory queue" >&2
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

bash -n \
  ./docker_build_local.sh \
  ./docker_run_local.sh \
  ./cloud_deploy.sh \
  ./scripts/deploy-gke-gw.sh \
  ./scripts/validate-gw-runtime-profile.sh \
  ./scripts/bootstrap-test-local-fabric.sh \
  ./chaincode/scripts/consentaccess-local-devnet.sh \
  ./chaincode/scripts/deploy-consentaccess-unid-test-network.sh \
  ./scripts/ensure-fabric-devnet-env.sh \
  ./scripts/ensure-consentaccess-runtime.sh \
  ./scripts/load-fabric-host-env.sh \
  ./scripts/prepare-consentaccess-local-fabric-env.sh \
  ./scripts/demo-create-individual-organization.sh \
  ./scripts/smoke-consentaccess-local-network.sh \
  ./scripts/smoke-smart-access-local-network.sh \
  ./scripts/smoke-docker-local-network.sh \
  ./scripts/smoke-rolelicense-local-network.sh

auth_gate_base=(
  env DEPLOYMENT_ENV=staging NODE_ENV=demo
  DB_PROVIDER=firestore STORAGE_PROVIDER=gcs GCS_BUCKET_NAME=test-bucket
  QUEUE_PROVIDER=gcp-pubsub ASYNC_RESPONSE_STORE_PROVIDER=firestore
  ASYNC_RESPONSE_FIRESTORE_COLLECTION=test-responses GCP_PUBSUB_TOPIC=test-topic
  GCP_PUBSUB_SUBSCRIPTION=test-subscription GCP_PUBSUB_JOB_BUCKET=test-jobs
  KMS_PROVIDER=gcp KMS_KEY_ID=projects/test/locations/test/keyRings/test/cryptoKeys/test
  KMS_RUNTIME_KEK_ID=test-runtime-kek AUTH_TOKEN_VERIFIER=trusted-oidc
  GDC_REQUIRED_FIREBASE_AUTH_PROJECT_IDS=personal-auth,professional-auth
  FIREBASE_PROJECT_ID=gateway-auth
  FIREBASE_ADDITIONAL_AUTH_PROJECT_IDS=personal-auth,professional-auth
)
"${auth_gate_base[@]}" \
  OIDC_TRUSTED_PROVIDERS_JSON='[{"iss":"https://securetoken.google.com/personal-auth","aud":"personal-auth"},{"iss":"https://securetoken.google.com/professional-auth","aud":"professional-auth"}]' \
  bash ./scripts/validate-gw-runtime-profile.sh
if "${auth_gate_base[@]}" \
  OIDC_TRUSTED_PROVIDERS_JSON='[{"iss":"https://securetoken.google.com/personal-auth","aud":"personal-auth"}]' \
  bash ./scripts/validate-gw-runtime-profile.sh; then
  echo 'ERROR: staging auth gate accepted a missing required professional audience.' >&2
  exit 1
fi

ica_gate_base=(
  env DEPLOYMENT_ENV=staging NODE_ENV=demo
  DB_PROVIDER=firestore STORAGE_PROVIDER=gcs GCS_BUCKET_NAME=test-bucket
  QUEUE_PROVIDER=gcp-pubsub ASYNC_RESPONSE_STORE_PROVIDER=firestore
  ASYNC_RESPONSE_FIRESTORE_COLLECTION=test-responses GCP_PUBSUB_TOPIC=test-topic
  GCP_PUBSUB_SUBSCRIPTION=test-subscription GCP_PUBSUB_JOB_BUCKET=test-jobs
  KMS_PROVIDER=gcp KMS_KEY_ID=projects/test/locations/test/keyRings/test/cryptoKeys/test
  KMS_RUNTIME_KEK_ID=test-runtime-kek GDC_REQUIRE_ICA=true ICA_MODE=external
)
"${ica_gate_base[@]}" \
  DATASPACE_ICA_EXTERNAL_URL=https://ica.example.test \
  ICA_DID_WEB=did:web:ica.example.test \
  bash ./scripts/validate-gw-runtime-profile.sh
if "${ica_gate_base[@]}" \
  DATASPACE_ICA_EXTERNAL_URL= \
  ICA_DID_WEB=did:web:ica.example.test \
  bash ./scripts/validate-gw-runtime-profile.sh; then
  echo 'ERROR: staging ICA gate accepted a missing external ICA URL.' >&2
  exit 1
fi
if "${ica_gate_base[@]}" \
  DATASPACE_ICA_EXTERNAL_URL=https://ica.example.test \
  ICA_DID_WEB= \
  bash ./scripts/validate-gw-runtime-profile.sh; then
  echo 'ERROR: staging ICA gate accepted a missing ICA DID.' >&2
  exit 1
fi

node ./scripts/bootstrap-local-fabric-stack.mjs --help | grep -q -- '--prepare-only'
grep -Fq "awk '\$2 ~ /^dev-peer0-host/ {print \$1}'" \
  ./scripts/bootstrap-local-fabric-stack.mjs
bash ./scripts/smoke-docker-local-network.sh --help | grep -q 'SKIP_FABRIC_PREP'
bash ./scripts/smoke-docker-local-network.sh --help | grep -q 'RUN_RESEARCH_SMART_SMOKE'
grep -q 'RUN_RESEARCH_SMART_SMOKE="${RUN_RESEARCH_SMART_SMOKE:-true}"' \
  ./scripts/smoke-docker-local-network.sh
grep -Fq 'mkdir -p "${ROOT_DIR}/logs"' \
  ./scripts/smoke-docker-local-network.sh
grep -Fq 'BASE_ENV_FILE="$BASE_ENV_FILE"' \
  ./scripts/smoke-docker-local-network.sh
grep -Fq "case 'INDIVIDUAL_ALL_SECTIONS_INGESTION_REQUEST':" \
  ./scripts/render-demo-smart-access-payload.mts
grep -Fq "case 'INDIVIDUAL_SCOPED_SUMMARY_REQUEST':" \
  ./scripts/render-demo-smart-access-payload.mts
grep -Fq 'individual-consent-smart-scoped-summary' \
  ./scripts/smoke-smart-access-local-network.sh
grep -Fq 'DocumentReference' ./scripts/smoke-smart-access-local-network.sh
grep -q 'BASE_URL="${BASE_URL:-http://127.0.0.1:${HOST_PORT}}"' \
  ./scripts/smoke-docker-local-network.sh
grep -q 'HOST_NETWORK="${HOST_NETWORK:-local-network}"' \
  ./scripts/smoke-docker-local-network.sh
grep -q 'HOST_PREAUTHORIZATION_TEST_SEED="${HOST_PREAUTHORIZATION_TEST_SEED:-local-vetchain-host-preauthorization-smoke-seed}"' \
  ./scripts/smoke-docker-local-network.sh
grep -q 'HOST_NETWORK="$HOST_NETWORK"' \
  ./scripts/smoke-docker-local-network.sh
grep -q 'HOST_PREAUTHORIZATION_TEST_SEED="$HOST_PREAUTHORIZATION_TEST_SEED"' \
  ./scripts/smoke-docker-local-network.sh
grep -q 'SERVICE_URL="${SERVICE_URL:-${BASE_URL/#http:/https:}}"' \
  ./scripts/bootstrap-single-tenant.sh
grep -q 'icaResponse.body.issues.issue' \
  ./scripts/bootstrap-single-tenant.sh
grep -q 'INDIVIDUAL_KYC_VERIFIED_AT=' \
  ./scripts/demo-create-individual-organization.sh
grep -q '"kyc_verified_at": $kycVerifiedAt' \
  ./scripts/demo-create-individual-organization.sh
grep -q 'ICA_FABRIC_MSP_ID=${LEDGER_MSP_ID_VALUE}' \
  ./scripts/prepare-consentaccess-local-fabric-env.sh
grep -Fq 'bash ./scripts/ensure-consentaccess-runtime.sh' \
  ./scripts/smoke-docker-local-network.sh
grep -Fq 'peer lifecycle chaincode queryapproved' \
  ./scripts/ensure-consentaccess-runtime.sh
grep -Fq 'LocalPackage.package_id' \
  ./scripts/ensure-consentaccess-runtime.sh
grep -q 'SMOKE_PROVIDER_ORGANIZATION_DID=' ./scripts/smoke-docker-local-network.sh
grep -q 'PROVIDER_ORGANIZATION_DID="$SMOKE_PROVIDER_ORGANIZATION_DID"' \
  ./scripts/smoke-docker-local-network.sh
if grep -q 'GW UNID release profile' \
  ./scripts/smoke-smart-access-local-network.sh \
  ./scripts/smoke-docker-local-network.sh; then
  echo 'ERROR: VetChain smoke scripts must not inherit a GW UNID release profile.' >&2
  exit 1
fi
grep -q 'CONTAINER_NAME="${CONTAINER_NAME:-gw-vetchain-local-network-smoke}"' \
  ./scripts/smoke-docker-local-network.sh
grep -q 'SMOKE_HOST_JURISDICTION="${SMOKE_HOST_JURISDICTION:-CA-BC}"' \
  ./scripts/smoke-docker-local-network.sh
grep -q 'SMOKE_SECTOR="${SMOKE_SECTOR:-animal-care}"' \
  ./scripts/smoke-docker-local-network.sh
if grep -q 'gw-unid-local-network-smoke' ./scripts/smoke-docker-local-network.sh; then
  echo 'ERROR: VetChain image smoke must not inherit the UNID container identity.' >&2
  exit 1
fi
grep -Fq 'HOST_LEGACY_REPRESENTATIVE_CONTROLLER="$HOST_LEGACY_REPRESENTATIVE_CONTROLLER"' \
  ./cloud_deploy.sh
grep -Fq 'ALLOWED_SECTORS="$ALLOWED_SECTORS"' \
  ./cloud_deploy.sh
grep -Fq 'PUBLISH_ONLY' ./cloud_deploy.sh
grep -Fq 'Image published without changing the GKE workload' ./cloud_deploy.sh
grep -Fq 'GDC_FABRIC_PEER_TARGET=peer0-connecthealth-staging.test-fabric-v3.svc.cluster.local' \
  ./deploy/vetchain/staging.config
grep -Fq 'ALLOWED_SECTORS=health-care,health-research,health-tech,onehealth-research' \
  ./env.staging.example
grep -Fq 'HOST_LEGACY_REPRESENTATIVE_CONTROLLER=false' \
  ./env.test.example

while IFS= read -r env_example; do
  if grep -q '^MAINSECTOR=' "$env_example" \
    && ! grep -q '^ALLOWED_SECTORS=.*onehealth-research' "$env_example"; then
    echo "ERROR: ${env_example} must declare canonical ALLOWED_SECTORS with onehealth-research." >&2
    exit 1
  fi
done < <(git ls-files 'env*.example')
grep -q 'org.schema.Order.acceptedOffer.identifier' \
  ./scripts/demo-create-individual-organization.sh
grep -q 'kyc_verified_at' ./scripts/demo-create-individual-organization.sh
if grep -q 'del("/body/' ./scripts/demo-create-individual-organization.sh; then
  echo 'ERROR: JSON-pointer override keys must be deleted through object-key paths.' >&2
  exit 1
fi
grep -qx 'node_modules' .dockerignore
grep -qx 'build' .dockerignore
grep -qx '.git' .dockerignore
grep -Fqx '.env.*' .dockerignore
if grep -Eq 'COPY .*\.env' ./Dockerfile; then
  echo 'ERROR: runtime profiles must be injected, never copied into the image.' >&2
  exit 1
fi
if grep -Eq 'COPY[[:space:]]+vendor|file:vendor/' ./Dockerfile package.json package-lock.json; then
  echo 'ERROR: clean releases must install published npm packages, never ignored vendor tarballs.' >&2
  exit 1
fi
grep -Fq 'WORKSPACE_ROOT="$(dirname "$(dirname "${ROOT}")")"' \
  ./scripts/prepare-consentaccess-local-fabric-env.sh
grep -Fq 'deduplicate_env_assignments "${OUT_ENV}"' \
  ./scripts/prepare-consentaccess-local-fabric-env.sh
grep -Fq 'WORKSPACE_ROOT="$(dirname "$(dirname "${ROOT}")")"' \
  ./scripts/ensure-fabric-devnet-env.sh
grep -Fq 'WORKSPACE_ROOT="$(cd "${ROOT}/../../.." && pwd)"' \
  ./chaincode/scripts/consentaccess-local-devnet.sh
grep -Fq 'CHAINCODE_DIR="${CHAINCODE_DIR:-${ROOT}/consentaccess-sc-javascript}"' \
  ./chaincode/scripts/consentaccess-local-devnet.sh
if grep -Eq 'CANONICAL_CHAINCODE_DIR|ConsentAccess is a GW CORE contract' \
  ./chaincode/scripts/consentaccess-local-devnet.sh; then
  echo 'ERROR: unified SOS GW must not fall back to a divergent GW CORE ConsentAccess source.' >&2
  exit 1
fi
grep -Fq 'WORKSPACE_ROOT="$(cd "${ROOT}/../../.." && pwd)"' \
  ./chaincode/scripts/deploy-consentaccess-unid-test-network.sh
published_runtime_manifest="$(
  sed -n '/        - name: consentaccess-sc/,/          ports:/p' \
    ./chaincode/scripts/deploy-consentaccess-unid-test-network.sh
)"
grep -Fq 'name: CHAINCODE_NAME' <<<"${published_runtime_manifest}"
grep -Fq 'value: "${CHAINCODE_NAME}"' <<<"${published_runtime_manifest}"
grep -Fq 'SKIP_CHAINCODE_INSTALL="${SKIP_CHAINCODE_INSTALL:-false}"' \
  ./chaincode/scripts/deploy-consentaccess-unid-test-network.sh
grep -Fq 'Participant phase already installed CCAAS package' \
  ./chaincode/scripts/deploy-consentaccess-unid-test-network.sh
grep -Fq 'peer lifecycle chaincode queryapproved' \
  ./chaincode/scripts/deploy-consentaccess-unid-test-network.sh
grep -Fq 'RUNTIME_PACKAGE_ID="$(resolve_runtime_package_id "${PACKAGE_ID}")"' \
  ./chaincode/scripts/deploy-consentaccess-unid-test-network.sh
runtime_line="$(grep -n 'apply_chaincode_runtime "${RUNTIME_PACKAGE_ID}"' ./chaincode/scripts/deploy-consentaccess-unid-test-network.sh | cut -d: -f1)"
lifecycle_line="$(grep -n 'run_lifecycle_job "${PACKAGE_ID}"' ./chaincode/scripts/deploy-consentaccess-unid-test-network.sh | cut -d: -f1)"
[[ -n "$runtime_line" && -n "$lifecycle_line" && "$runtime_line" -gt "$lifecycle_line" ]]
grep -Fq 'Governance phase leaves the participant-owned CCAAS runtime unchanged' \
  ./chaincode/scripts/deploy-consentaccess-unid-test-network.sh
if [[ "$(grep -Ec '^FROM node:24-alpine($| AS )' ./chaincode/consentaccess-sc-javascript/Dockerfile)" -ne 4 ]]; then
  echo 'ERROR: every ConsentAccess build and runtime stage must use the workspace Node.js 24 line.' >&2
  exit 1
fi
if [[ "$(grep -Fc 'tini-static-${PLATFORM} /tini' ./chaincode/consentaccess-sc-javascript/Dockerfile)" -ne 2 ]]; then
  echo 'ERROR: Alpine ConsentAccess runtimes must use the static tini binary.' >&2
  exit 1
fi
if [[ "$(head -n 1 ./chaincode/consentaccess-sc-javascript/docker/docker-entrypoint.sh)" != '#!/bin/sh' ]]; then
  echo 'ERROR: the Alpine ConsentAccess entrypoint must use the available POSIX shell.' >&2
  exit 1
fi
if [[ "$(node -p "require('./chaincode/consentaccess-sc-javascript/package.json').engines?.node || ''")" != '^24.0.0' ]]; then
  echo 'ERROR: ConsentAccess development and tests must require the workspace Node.js 24 line.' >&2
  exit 1
fi
test -f ./chaincode/consentaccess-sc-javascript/lib/consent-access-contract.js
if git check-ignore -q ./chaincode/consentaccess-sc-javascript/lib/consent-access-contract.js; then
  echo 'ERROR: authored ConsentAccess runtime sources must be tracked in clean checkouts.' >&2
  exit 1
fi

dry_run_output="$(
  GKE_ENV_FILE=deploy/vetchain/staging.runtime.env \
  GDC_IMAGE_TAG=0.0.0-dryrun \
  DEPLOY_DRY_RUN=true \
    ./cloud_deploy.sh \
      gke \
      vetchain \
      deploy/vetchain/staging.config
)"
grep -Fq "/connecthealth-vet-host-staging:0.0.0-dryrun" <<<"$dry_run_output"
expected_allowed_sectors="$(
  bash -c 'source "$1"; printf "%s" "$ALLOWED_SECTORS"' \
    _ deploy/vetchain/staging.runtime.env
)"
grep -Fq "Allowed sectors:    ${expected_allowed_sectors}" \
  <<<"$dry_run_output"
grep -Fq 'wait_for_public_endpoint' ./cloud_deploy.sh
grep -Fq '"${GDC_PUBLIC_URL%/}/host/ping"' ./cloud_deploy.sh
grep -Fq '"${GDC_PUBLIC_URL%/}/api-docs/"' ./cloud_deploy.sh

echo "Local image release scripts validated."
