#!/usr/bin/env bash
set -euo pipefail

if [[ -z "${K8S_NAMESPACE_GDC:-}" ]]; then
  echo "Missing K8S_NAMESPACE_GDC. Source the target deployment config first."
  exit 1
fi

required_vars=(
  K8S_NAMESPACE_GDC
  GDC_IMAGE
  GDC_PUBLIC_URL
  GDC_STATIC_IP_NAME
  GCP_PROJECT_ID
  GDC_GSA_EMAIL
  LEDGER_MSP_ID
  LEDGER_FABRIC_MSP_ID
)

for var_name in "${required_vars[@]}"; do
  if [[ -z "${!var_name:-}" ]]; then
    echo "Missing required variable: ${var_name}"
    exit 1
  fi
done

KUBECTL=(kubectl)
if [[ -n "${KUBE_CONTEXT:-}" ]]; then KUBECTL+=(--context "${KUBE_CONTEXT}"); fi

optional_env_defaults=(
  "GDC_RESOURCE_NAME=gwtemplate"
  "GDC_SECRET_NAME=gwtemplate-secret"
  "GDC_SERVICE_TYPE=LoadBalancer"
  "GDC_INGRESS_ENABLED=false"
  "GDC_HOST="
  "GDC_TLS_SIDECAR_ENABLED=false"
  "GDC_TLS_HOST=${GDC_HOST:-}"
  "GDC_TLS_IMAGE=caddy:2.10.2-alpine"
  "GDC_FABRIC_PEER_ALIAS_ENABLED=false"
  "GDC_FABRIC_PEER_ALIAS=peer0"
  "GDC_FABRIC_PEER_TARGET="
  "GDC_FABRIC_PEER_PORT=7051"
  "GDC_WORKLOAD_IDENTITY_ENABLED=false"
  "HOST_EXTERNAL_DOMAIN="
  "HOST_PUBLIC_URL=${GDC_PUBLIC_URL}"
  "NODE_ENV=demo"
  "DEPLOYMENT_ENV=staging"
  "SECURITY_MODE=compat"
  "NETWORK_MODE=test-network"
  "STORAGE_LAYOUT=scoped-v2"
  "HOST_STORAGE_SCOPE=unid"
  "HOST_LEGACY_PHYSICAL_COLLECTION="
  "FHIR_LEGACY=true"
  "JSON_LEGACY=true"
  "DIDCOMM_PLAIN=disabled"
  "DIDCOMM_LEGACY_PLAINTEXT_MEDIA_TYPE=false"
  "DEMO_ALLOW_INSECURE_BEARER=false"
  "AUTH_TOKEN_VERIFIER="
  "OIDC_TRUSTED_PROVIDERS_JSON="
  "FIREBASE_PROJECT_ID=${GCP_PROJECT_ID}"
  "FIREBASE_ADDITIONAL_AUTH_PROJECT_IDS="
  "HOST_LEGACY_REPRESENTATIVE_CONTROLLER=false"
  "TENANT_SERVICE_ROUTES_JSON="
  "DEV_SEED=true"
  "ALLOWED_SECTORS="
  "MAINSECTOR=health"
  "SUBSECTORSALLOWED=care,research,tech"
  "SECTORS_ALLOWED="
  "SUBJECT_IDENTITY_BINDING_TRUSTED_ISSUERS="
  "HOST_LEGACY_CONTROLLER_SCOPES="
  "QUEUE_PROVIDER=mem"
  "ASYNC_RESPONSE_STORE_PROVIDER=mem"
  "ASYNC_RESPONSE_FIRESTORE_COLLECTION=gw_async_responses"
  "ASYNC_RESPONSE_TTL_SECONDS=86400"
  "GCP_PUBSUB_PROJECT_ID=${GCP_PROJECT_ID}"
  "GCP_PUBSUB_TOPIC="
  "GCP_PUBSUB_SUBSCRIPTION="
  "GCP_PUBSUB_JOB_BUCKET="
  "GCP_PUBSUB_JOB_PREFIX=async-jobs"
  "GCP_PUBSUB_MAX_OUTSTANDING_MESSAGES=10"
  "DB_PROVIDER=mem"
  "STORAGE_PROVIDER=mem"
  "KMS_PROVIDER=memory"
  "KMS_REGION="
  "KMS_KEY_ID="
  "KMS_RUNTIME_KEK_ID="
  "LEDGER_ENABLED=true"
  "LEDGER_PROVIDER_DEFAULT=fabric"
  "LEDGER_PROVIDER_MAP=test=mem,test-network=fabric,network=fabric"
  "LEDGER_IDENTITY_CHANNEL_DEFAULT=identity-global"
  "LEDGER_ORGANIZATION_IDENTITY_CHANNEL_DEFAULT=identity-eu"
  "LEDGER_DATA_CHANNEL_DEFAULT="
  "LEDGER_GENESIS_VERIFICATION=false"
  "LEDGER_CHANNEL_GENESIS_SHA256="
  "AS_LOCAL_HOST=false"
  "LOG_PROVIDER=console"
  "REPLAY_PROTECTION_PROVIDER=none"
  "RESEARCH_TERMINOLOGY_BASE_URL="
  "RESEARCH_TERMINOLOGY_LABELS_ENABLED=false"
  "EMAIL_NOTIFICATION_PROVIDER=console"
  "BREAK_GLASS_ENABLED=false"
  "BREAK_GLASS_NOTIFICATION_URL="
  "BREAK_GLASS_CONSENT_TTL_SECONDS=86400"
  "CLEARING_HOUSE_MODE=stub"
  "ICA_MODE="
  "ICA_JURISDICTION="
  "ICA_DID_WEB="
  "HOST_LEGAL_NAME=Gateway Host Services"
  "HOST_JURISDICTION=ES"
  "HOST_ID_TYPE=TAX"
  "HOST_ID_VALUE=A0011223344"
  "HOST_ADMIN_EMAIL=admin@host.com"
  "HOST_ADMIN_UID=host-admin-001"
  "HOST_ADMIN_ROLE=ISCO-08|1111"
  "HOST_TERMS_URL=${GDC_PUBLIC_URL}/terms"
  "GCS_BUCKET_NAME="
  "STARTUP_SKIP_HOST_CACHE_WARMUP_ON_ERROR=false"
)

for entry in "${optional_env_defaults[@]}"; do
  key="${entry%%=*}"
  value="${entry#*=}"
  export "${key}=${!key:-$value}"
done

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
bash "${SCRIPT_DIR}/validate-gw-runtime-profile.sh"
TEMPLATE_DIR="${SCRIPT_DIR%/scripts}/deploy/gke-gw"
RENDER_DIR="$(mktemp -d)"
trap 'rm -rf "$RENDER_DIR"' EXIT

render_template() {
  local src="$1"
  local dest="$2"
  local host_legacy_controller_scopes_sed
  local host_legal_name_sed
  local oidc_trusted_providers_json_sed
  host_legacy_controller_scopes_sed="$(printf '%s' "${HOST_LEGACY_CONTROLLER_SCOPES}" | sed 's/[\\&|]/\\&/g')"
  host_legal_name_sed="$(printf '%s' "${HOST_LEGAL_NAME}" | sed 's/[\\&|]/\\&/g')"
  oidc_trusted_providers_json_sed="$(printf '%s' "${OIDC_TRUSTED_PROVIDERS_JSON}" | sed 's/[\\&|]/\\&/g')"
  sed \
    -e "s|__K8S_NAMESPACE_GDC__|${K8S_NAMESPACE_GDC}|g" \
    -e "s|__GDC_IMAGE__|${GDC_IMAGE}|g" \
    -e "s|__GDC_PUBLIC_URL__|${GDC_PUBLIC_URL}|g" \
    -e "s|__HOST_PUBLIC_URL__|${HOST_PUBLIC_URL}|g" \
    -e "s|__HOST_EXTERNAL_DOMAIN__|${HOST_EXTERNAL_DOMAIN}|g" \
    -e "s|__GDC_STATIC_IP_NAME__|${GDC_STATIC_IP_NAME}|g" \
    -e "s|__GDC_SERVICE_TYPE__|${GDC_SERVICE_TYPE}|g" \
    -e "s|__GDC_HOST__|${GDC_HOST}|g" \
    -e "s|__GDC_TLS_HOST__|${GDC_TLS_HOST}|g" \
    -e "s|__GDC_TLS_IMAGE__|${GDC_TLS_IMAGE}|g" \
    -e "s|__GDC_FABRIC_PEER_ALIAS__|${GDC_FABRIC_PEER_ALIAS}|g" \
    -e "s|__GDC_FABRIC_PEER_TARGET__|${GDC_FABRIC_PEER_TARGET}|g" \
    -e "s|__GDC_FABRIC_PEER_PORT__|${GDC_FABRIC_PEER_PORT}|g" \
    -e "s|__GDC_RESOURCE_NAME__|${GDC_RESOURCE_NAME}|g" \
    -e "s|__GDC_SECRET_NAME__|${GDC_SECRET_NAME}|g" \
    -e "s|__GCP_PROJECT_ID__|${GCP_PROJECT_ID}|g" \
    -e "s|__GCS_BUCKET_NAME__|${GCS_BUCKET_NAME}|g" \
    -e "s|__NODE_ENV__|${NODE_ENV}|g" \
    -e "s|__DEPLOYMENT_ENV__|${DEPLOYMENT_ENV}|g" \
    -e "s|__SECURITY_MODE__|${SECURITY_MODE}|g" \
    -e "s|__NETWORK_MODE__|${NETWORK_MODE}|g" \
    -e "s|__STORAGE_LAYOUT__|${STORAGE_LAYOUT}|g" \
    -e "s|__HOST_STORAGE_SCOPE__|${HOST_STORAGE_SCOPE}|g" \
    -e "s|__HOST_LEGACY_PHYSICAL_COLLECTION__|${HOST_LEGACY_PHYSICAL_COLLECTION}|g" \
    -e "s|__FHIR_LEGACY__|${FHIR_LEGACY}|g" \
    -e "s|__JSON_LEGACY__|${JSON_LEGACY}|g" \
    -e "s|__DIDCOMM_PLAIN__|${DIDCOMM_PLAIN}|g" \
    -e "s|__DIDCOMM_LEGACY_PLAINTEXT_MEDIA_TYPE__|${DIDCOMM_LEGACY_PLAINTEXT_MEDIA_TYPE}|g" \
    -e "s|__DEMO_ALLOW_INSECURE_BEARER__|${DEMO_ALLOW_INSECURE_BEARER}|g" \
    -e "s|__AUTH_TOKEN_VERIFIER__|${AUTH_TOKEN_VERIFIER}|g" \
    -e "s|__OIDC_TRUSTED_PROVIDERS_JSON__|${oidc_trusted_providers_json_sed}|g" \
    -e "s|__FIREBASE_PROJECT_ID__|${FIREBASE_PROJECT_ID}|g" \
    -e "s|__FIREBASE_ADDITIONAL_AUTH_PROJECT_IDS__|${FIREBASE_ADDITIONAL_AUTH_PROJECT_IDS}|g" \
    -e "s|__HOST_LEGACY_REPRESENTATIVE_CONTROLLER__|${HOST_LEGACY_REPRESENTATIVE_CONTROLLER}|g" \
    -e "s|__TENANT_SERVICE_ROUTES_JSON__|${TENANT_SERVICE_ROUTES_JSON}|g" \
    -e "s|__DEV_SEED__|${DEV_SEED}|g" \
    -e "s|__ALLOWED_SECTORS__|${ALLOWED_SECTORS}|g" \
    -e "s|__MAINSECTOR__|${MAINSECTOR}|g" \
    -e "s|__SUBSECTORSALLOWED__|${SUBSECTORSALLOWED}|g" \
    -e "s|__SECTORS_ALLOWED__|${SECTORS_ALLOWED}|g" \
    -e "s|__ALLOWED_SECTORS__|${ALLOWED_SECTORS}|g" \
    -e "s|__SUBJECT_IDENTITY_BINDING_TRUSTED_ISSUERS__|${SUBJECT_IDENTITY_BINDING_TRUSTED_ISSUERS}|g" \
    -e "s|__HOST_LEGACY_CONTROLLER_SCOPES__|${host_legacy_controller_scopes_sed}|g" \
    -e "s|__QUEUE_PROVIDER__|${QUEUE_PROVIDER}|g" \
    -e "s|__ASYNC_RESPONSE_STORE_PROVIDER__|${ASYNC_RESPONSE_STORE_PROVIDER}|g" \
    -e "s|__ASYNC_RESPONSE_FIRESTORE_COLLECTION__|${ASYNC_RESPONSE_FIRESTORE_COLLECTION}|g" \
    -e "s|__ASYNC_RESPONSE_TTL_SECONDS__|${ASYNC_RESPONSE_TTL_SECONDS}|g" \
    -e "s|__GCP_PUBSUB_PROJECT_ID__|${GCP_PUBSUB_PROJECT_ID}|g" \
    -e "s|__GCP_PUBSUB_TOPIC__|${GCP_PUBSUB_TOPIC}|g" \
    -e "s|__GCP_PUBSUB_SUBSCRIPTION__|${GCP_PUBSUB_SUBSCRIPTION}|g" \
    -e "s|__GCP_PUBSUB_JOB_BUCKET__|${GCP_PUBSUB_JOB_BUCKET}|g" \
    -e "s|__GCP_PUBSUB_JOB_PREFIX__|${GCP_PUBSUB_JOB_PREFIX}|g" \
    -e "s|__GCP_PUBSUB_MAX_OUTSTANDING_MESSAGES__|${GCP_PUBSUB_MAX_OUTSTANDING_MESSAGES}|g" \
    -e "s|__STRIPE_ENABLED__|${STRIPE_ENABLED:-false}|g" \
    -e "s|__DB_PROVIDER__|${DB_PROVIDER}|g" \
    -e "s|__STORAGE_PROVIDER__|${STORAGE_PROVIDER}|g" \
    -e "s|__KMS_PROVIDER__|${KMS_PROVIDER}|g" \
    -e "s|__KMS_REGION__|${KMS_REGION}|g" \
    -e "s|__KMS_KEY_ID__|${KMS_KEY_ID}|g" \
    -e "s|__KMS_RUNTIME_KEK_ID__|${KMS_RUNTIME_KEK_ID}|g" \
    -e "s|__LEDGER_ENABLED__|${LEDGER_ENABLED}|g" \
    -e "s|__LEDGER_PROVIDER_DEFAULT__|${LEDGER_PROVIDER_DEFAULT}|g" \
    -e "s|__LEDGER_PROVIDER_MAP__|${LEDGER_PROVIDER_MAP}|g" \
    -e "s|__LEDGER_MSP_ID__|${LEDGER_MSP_ID}|g" \
    -e "s|__LEDGER_FABRIC_MSP_ID__|${LEDGER_FABRIC_MSP_ID}|g" \
    -e "s|__LEDGER_IDENTITY_CHANNEL_DEFAULT__|${LEDGER_IDENTITY_CHANNEL_DEFAULT}|g" \
    -e "s|__LEDGER_ORGANIZATION_IDENTITY_CHANNEL_DEFAULT__|${LEDGER_ORGANIZATION_IDENTITY_CHANNEL_DEFAULT}|g" \
    -e "s|__LEDGER_DATA_CHANNEL_DEFAULT__|${LEDGER_DATA_CHANNEL_DEFAULT}|g" \
    -e "s|__LEDGER_GENESIS_VERIFICATION__|${LEDGER_GENESIS_VERIFICATION}|g" \
    -e "s|__LEDGER_CHANNEL_GENESIS_SHA256__|${LEDGER_CHANNEL_GENESIS_SHA256}|g" \
    -e "s|__AS_LOCAL_HOST__|${AS_LOCAL_HOST}|g" \
    -e "s|__LOG_PROVIDER__|${LOG_PROVIDER}|g" \
    -e "s|__REPLAY_PROTECTION_PROVIDER__|${REPLAY_PROTECTION_PROVIDER}|g" \
    -e "s|__RESEARCH_TERMINOLOGY_BASE_URL__|${RESEARCH_TERMINOLOGY_BASE_URL}|g" \
    -e "s|__RESEARCH_TERMINOLOGY_LABELS_ENABLED__|${RESEARCH_TERMINOLOGY_LABELS_ENABLED}|g" \
    -e "s|__EMAIL_NOTIFICATION_PROVIDER__|${EMAIL_NOTIFICATION_PROVIDER}|g" \
    -e "s|__BREAK_GLASS_ENABLED__|${BREAK_GLASS_ENABLED}|g" \
    -e "s|__BREAK_GLASS_NOTIFICATION_URL__|${BREAK_GLASS_NOTIFICATION_URL}|g" \
    -e "s|__BREAK_GLASS_CONSENT_TTL_SECONDS__|${BREAK_GLASS_CONSENT_TTL_SECONDS}|g" \
    -e "s|__CLEARING_HOUSE_MODE__|${CLEARING_HOUSE_MODE}|g" \
    -e "s|__ICA_MODE__|${ICA_MODE}|g" \
    -e "s|__ICA_JURISDICTION__|${ICA_JURISDICTION}|g" \
    -e "s|__ICA_DID_WEB__|${ICA_DID_WEB}|g" \
    -e "s|__HOST_LEGAL_NAME__|${host_legal_name_sed}|g" \
    -e "s|__HOST_JURISDICTION__|${HOST_JURISDICTION}|g" \
    -e "s|__HOST_ID_TYPE__|${HOST_ID_TYPE}|g" \
    -e "s|__HOST_ID_VALUE__|${HOST_ID_VALUE}|g" \
    -e "s|__HOST_ADMIN_EMAIL__|${HOST_ADMIN_EMAIL}|g" \
    -e "s|__HOST_ADMIN_UID__|${HOST_ADMIN_UID}|g" \
    -e "s#__HOST_ADMIN_ROLE__#${HOST_ADMIN_ROLE}#g" \
    -e "s|__HOST_TERMS_URL__|${HOST_TERMS_URL}|g" \
    -e "s|__STARTUP_SKIP_HOST_CACHE_WARMUP_ON_ERROR__|${STARTUP_SKIP_HOST_CACHE_WARMUP_ON_ERROR}|g" \
    -e "s|__GDC_GSA_EMAIL__|${GDC_GSA_EMAIL}|g" \
    -e "s|__DATASPACE_ICA_EXTERNAL_URL__|${DATASPACE_ICA_EXTERNAL_URL:-}|g" \
    "$src" > "$dest"
}

"${KUBECTL[@]}" get namespace "${K8S_NAMESPACE_GDC}" >/dev/null 2>&1 || "${KUBECTL[@]}" create namespace "${K8S_NAMESPACE_GDC}"

for file in namespace.yaml serviceaccount.yaml configmap.yaml deployment.yaml service.yaml internal-service.yaml; do
  render_template "${TEMPLATE_DIR}/${file}" "${RENDER_DIR}/${file}"
done
if [[ "$GDC_FABRIC_PEER_ALIAS_ENABLED" == "true" ]]; then
  [[ -n "$GDC_FABRIC_PEER_TARGET" ]] || { echo "GDC_FABRIC_PEER_TARGET is required when GDC_FABRIC_PEER_ALIAS_ENABLED=true." >&2; exit 1; }
  render_template "${TEMPLATE_DIR}/fabric-peer-alias.yaml" "${RENDER_DIR}/fabric-peer-alias.yaml"
fi
if [[ "$GDC_WORKLOAD_IDENTITY_ENABLED" == "true" ]]; then
  render_template "${TEMPLATE_DIR}/workload-identity-patch.yaml" "${RENDER_DIR}/workload-identity-patch.yaml"
fi
if [[ "$GDC_TLS_SIDECAR_ENABLED" == "true" ]]; then
  [[ -n "$GDC_TLS_HOST" ]] || { echo "GDC_TLS_HOST is required when GDC_TLS_SIDECAR_ENABLED=true." >&2; exit 1; }
  for file in tls-pvc.yaml deployment-tls-patch.yaml service-tls-patch.yaml; do
    render_template "${TEMPLATE_DIR}/${file}" "${RENDER_DIR}/${file}"
  done
fi
if [[ "$GDC_INGRESS_ENABLED" == "true" ]]; then
  [[ -n "$GDC_HOST" ]] || { echo "GDC_HOST is required when GDC_INGRESS_ENABLED=true." >&2; exit 1; }
  render_template "${TEMPLATE_DIR}/ingress.yaml" "${RENDER_DIR}/ingress.yaml"
  gcloud compute addresses describe "$GDC_STATIC_IP_NAME" --global --project "$GCP_PROJECT_ID" >/dev/null 2>&1 \
    || gcloud compute addresses create "$GDC_STATIC_IP_NAME" --global --project "$GCP_PROJECT_ID"
fi

"${KUBECTL[@]}" apply -f "${RENDER_DIR}/namespace.yaml"
"${KUBECTL[@]}" apply -f "${RENDER_DIR}/serviceaccount.yaml"
"${KUBECTL[@]}" apply -f "${RENDER_DIR}/configmap.yaml"
if [[ "$GDC_FABRIC_PEER_ALIAS_ENABLED" == "true" ]]; then
  "${KUBECTL[@]}" apply -f "${RENDER_DIR}/fabric-peer-alias.yaml"
fi

if "${KUBECTL[@]}" -n "${K8S_NAMESPACE_GDC}" get secret "${GDC_SECRET_NAME}" >/dev/null 2>&1; then
  echo "Applying deployment with existing secret '${GDC_SECRET_NAME}'."
else
  echo "ERROR: secret '${GDC_SECRET_NAME}' not found in namespace '${K8S_NAMESPACE_GDC}'."
  echo "Create it first from ${TEMPLATE_DIR}/secret.template.yaml."
  exit 1
fi

"${KUBECTL[@]}" apply -f "${RENDER_DIR}/deployment.yaml"
if [[ "$GDC_WORKLOAD_IDENTITY_ENABLED" == "true" ]]; then
  "${KUBECTL[@]}" -n "${K8S_NAMESPACE_GDC}" patch deployment "${GDC_RESOURCE_NAME}" \
    --type strategic --patch-file "${RENDER_DIR}/workload-identity-patch.yaml"
fi
"${KUBECTL[@]}" apply -f "${RENDER_DIR}/service.yaml"
"${KUBECTL[@]}" apply -f "${RENDER_DIR}/internal-service.yaml"
if [[ "$GDC_TLS_SIDECAR_ENABLED" == "true" ]]; then
  "${KUBECTL[@]}" apply -f "${RENDER_DIR}/tls-pvc.yaml"
  "${KUBECTL[@]}" -n "${K8S_NAMESPACE_GDC}" patch deployment "${GDC_RESOURCE_NAME}" \
    --type strategic --patch-file "${RENDER_DIR}/deployment-tls-patch.yaml"
  "${KUBECTL[@]}" -n "${K8S_NAMESPACE_GDC}" patch service "${GDC_RESOURCE_NAME}" \
    --type strategic --patch-file "${RENDER_DIR}/service-tls-patch.yaml"
fi
if [[ "$GDC_INGRESS_ENABLED" == "true" ]]; then
  "${KUBECTL[@]}" apply -f "${RENDER_DIR}/ingress.yaml"
fi

# ConfigMap and existing Secret values are consumed through envFrom. Kubernetes
# does not otherwise replace a pod when only those objects change, so every
# successful render must restart the deployment before callers verify it.
"${KUBECTL[@]}" -n "${K8S_NAMESPACE_GDC}" rollout restart "deployment/${GDC_RESOURCE_NAME}"

echo "GW manifests applied in namespace '${K8S_NAMESPACE_GDC}'."
echo "Service URL: ${GDC_PUBLIC_URL}"
echo "Static IP name: ${GDC_STATIC_IP_NAME}"
if [[ "$GDC_TLS_SIDECAR_ENABLED" == "true" ]]; then
  echo "TLS sidecar: true (${GDC_TLS_HOST})"
else
  echo "TLS sidecar: false"
fi
echo "Runtime mode: NODE_ENV=${NODE_ENV} DB_PROVIDER=${DB_PROVIDER} STORAGE_PROVIDER=${STORAGE_PROVIDER}"
if [[ -n "${DATASPACE_ICA_EXTERNAL_URL:-}" ]]; then
  echo "External ICA URL: ${DATASPACE_ICA_EXTERNAL_URL}"
else
  echo "External ICA URL: not configured"
fi
