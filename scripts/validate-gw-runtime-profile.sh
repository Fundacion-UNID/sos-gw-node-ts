#!/usr/bin/env bash
# Flow contract: staging and production GW deployments must use durable data
# stores and externally custodied envelope encryption before Kubernetes changes.
set -euo pipefail

node_env="${NODE_ENV:-development}"
deployment_env="${DEPLOYMENT_ENV:-${node_env}}"
db_provider="${DB_PROVIDER:-mem}"
storage_provider="${STORAGE_PROVIDER:-mem}"
queue_provider="${QUEUE_PROVIDER:-mem}"
kms_provider="${KMS_PROVIDER:-memory}"

case "${deployment_env}" in
  staging|production)
    [[ "${db_provider}" != "mem" ]] || {
      echo "DB_PROVIDER=mem is prohibited when DEPLOYMENT_ENV=${deployment_env}." >&2
      exit 1
    }
    [[ "${storage_provider}" != "mem" ]] || {
      echo "STORAGE_PROVIDER=mem is prohibited when DEPLOYMENT_ENV=${deployment_env}." >&2
      exit 1
    }
    [[ "${queue_provider}" != "mem" ]] || {
      echo "QUEUE_PROVIDER=mem is prohibited when DEPLOYMENT_ENV=${deployment_env}." >&2
      exit 1
    }
    [[ "${kms_provider}" != "memory" && "${kms_provider}" != "local" ]] || {
      echo "KMS_PROVIDER=${kms_provider} is prohibited when DEPLOYMENT_ENV=${deployment_env}." >&2
      exit 1
    }
    ;;
esac

if [[ -n "${GDC_REQUIRED_FIREBASE_AUTH_PROJECT_IDS:-}" ]]; then
  [[ "${AUTH_TOKEN_VERIFIER:-}" == "trusted-oidc" ]] || {
    echo "AUTH_TOKEN_VERIFIER=trusted-oidc is required by this deployment profile." >&2
    exit 1
  }
  node - \
    "${GDC_REQUIRED_FIREBASE_AUTH_PROJECT_IDS}" \
    "${FIREBASE_PROJECT_ID:-}" \
    "${FIREBASE_ADDITIONAL_AUTH_PROJECT_IDS:-}" \
    "${OIDC_TRUSTED_PROVIDERS_JSON:-}" <<'NODE'
const [, , requiredText, primaryProject, additionalText, providersText] = process.argv;
const split = (value) => String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
const required = split(requiredText);
const configuredFirebaseProjects = new Set([primaryProject, ...split(additionalText)].filter(Boolean));
let providers;
try {
  providers = JSON.parse(providersText || '');
} catch {
  console.error('OIDC_TRUSTED_PROVIDERS_JSON must be valid JSON for the required Firebase auth projects.');
  process.exit(1);
}
if (!Array.isArray(providers)) {
  console.error('OIDC_TRUSTED_PROVIDERS_JSON must be an array.');
  process.exit(1);
}
for (const projectId of required) {
  if (!configuredFirebaseProjects.has(projectId)) {
    console.error(`Required Firebase auth project '${projectId}' is absent from the Firebase project allowlist.`);
    process.exit(1);
  }
  const expectedIssuer = `https://securetoken.google.com/${projectId}`;
  if (!providers.some((provider) => provider?.iss === expectedIssuer && provider?.aud === projectId)) {
    console.error(`Required Firebase auth project '${projectId}' is absent from OIDC_TRUSTED_PROVIDERS_JSON.`);
    process.exit(1);
  }
}
NODE
fi

if [[ "${storage_provider}" == "gcs" && -z "${GCS_BUCKET_NAME:-}" ]]; then
  echo "GCS_BUCKET_NAME is required when STORAGE_PROVIDER=gcs." >&2
  exit 1
fi

if [[ "${queue_provider}" == "gcp-pubsub" ]]; then
  [[ "${ASYNC_RESPONSE_STORE_PROVIDER:-}" == "firestore" ]] || {
    echo "ASYNC_RESPONSE_STORE_PROVIDER=firestore is required when QUEUE_PROVIDER=gcp-pubsub." >&2
    exit 1
  }
  for required_name in ASYNC_RESPONSE_FIRESTORE_COLLECTION GCP_PUBSUB_TOPIC GCP_PUBSUB_SUBSCRIPTION GCP_PUBSUB_JOB_BUCKET; do
    [[ -n "${!required_name:-}" ]] || {
      echo "${required_name} is required when QUEUE_PROVIDER=gcp-pubsub." >&2
      exit 1
    }
  done
fi

if [[ "${kms_provider}" == "gcp" ]]; then
  [[ "${KMS_KEY_ID:-}" == projects/*/locations/*/keyRings/*/cryptoKeys/* ]] || {
    echo "KMS_KEY_ID must be a full Google Cloud CryptoKey resource name." >&2
    exit 1
  }
  [[ -n "${KMS_RUNTIME_KEK_ID:-}" ]] || {
    echo "KMS_RUNTIME_KEK_ID is required when KMS_PROVIDER=gcp." >&2
    exit 1
  }
fi

if [[ "${GDC_REQUIRE_ICA:-false}" == "true" ]]; then
  [[ "${ICA_MODE:-}" == "external" ]] || {
    echo "ICA_MODE=external is required when GDC_REQUIRE_ICA=true." >&2
    exit 1
  }
  [[ "${DATASPACE_ICA_EXTERNAL_URL:-}" == https://* ]] || {
    echo "DATASPACE_ICA_EXTERNAL_URL must be an HTTPS URL when GDC_REQUIRE_ICA=true." >&2
    exit 1
  }
  [[ "${ICA_DID_WEB:-}" == did:web:* ]] || {
    echo "ICA_DID_WEB must be a did:web identifier when GDC_REQUIRE_ICA=true." >&2
    exit 1
  }
fi
