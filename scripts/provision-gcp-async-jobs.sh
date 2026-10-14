#!/usr/bin/env bash
# Provisions one isolated durable async-job boundary for a GW environment.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG_FILE="${1:?Usage: $0 <deployment.config> <runtime.env>}"
RUNTIME_FILE="${2:?Usage: $0 <deployment.config> <runtime.env>}"

source "${ROOT_DIR}/${CONFIG_FILE}"
source "${ROOT_DIR}/${RUNTIME_FILE}"

: "${GCP_PROJECT_ID:?GCP_PROJECT_ID is required}"
: "${GCP_REGION:?GCP_REGION is required}"
: "${GDC_GSA_EMAIL:?GDC_GSA_EMAIL is required}"
: "${GCP_PUBSUB_TOPIC:?GCP_PUBSUB_TOPIC is required}"
: "${GCP_PUBSUB_SUBSCRIPTION:?GCP_PUBSUB_SUBSCRIPTION is required}"
: "${GCP_PUBSUB_JOB_BUCKET:?GCP_PUBSUB_JOB_BUCKET is required}"
: "${ASYNC_RESPONSE_FIRESTORE_COLLECTION:?ASYNC_RESPONSE_FIRESTORE_COLLECTION is required}"

dead_letter_topic="${GCP_PUBSUB_TOPIC}-dead-letter"
dead_letter_subscription="${GCP_PUBSUB_SUBSCRIPTION}-dead-letter"
lifecycle_file="${ROOT_DIR}/deploy/gcp/async-job-bucket-lifecycle.json"

gcloud services enable pubsub.googleapis.com firestore.googleapis.com storage.googleapis.com \
  --project "${GCP_PROJECT_ID}"

gcloud pubsub topics describe "${GCP_PUBSUB_TOPIC}" --project "${GCP_PROJECT_ID}" >/dev/null 2>&1 \
  || gcloud pubsub topics create "${GCP_PUBSUB_TOPIC}" --project "${GCP_PROJECT_ID}"
gcloud pubsub topics describe "${dead_letter_topic}" --project "${GCP_PROJECT_ID}" >/dev/null 2>&1 \
  || gcloud pubsub topics create "${dead_letter_topic}" --project "${GCP_PROJECT_ID}"

if gcloud pubsub subscriptions describe "${GCP_PUBSUB_SUBSCRIPTION}" --project "${GCP_PROJECT_ID}" >/dev/null 2>&1; then
  gcloud pubsub subscriptions update "${GCP_PUBSUB_SUBSCRIPTION}" \
    --project "${GCP_PROJECT_ID}" \
    --dead-letter-topic "${dead_letter_topic}" \
    --max-delivery-attempts 10 \
    --min-retry-delay 10s \
    --max-retry-delay 600s \
    --enable-exactly-once-delivery
else
  gcloud pubsub subscriptions create "${GCP_PUBSUB_SUBSCRIPTION}" \
    --project "${GCP_PROJECT_ID}" \
    --topic "${GCP_PUBSUB_TOPIC}" \
    --dead-letter-topic "${dead_letter_topic}" \
    --max-delivery-attempts 10 \
    --min-retry-delay 10s \
    --max-retry-delay 600s \
    --message-retention-duration 7d \
    --expiration-period never \
    --enable-exactly-once-delivery
fi

if gcloud pubsub subscriptions describe "${dead_letter_subscription}" --project "${GCP_PROJECT_ID}" >/dev/null 2>&1; then
  gcloud pubsub subscriptions update "${dead_letter_subscription}" \
    --project "${GCP_PROJECT_ID}" \
    --message-retention-duration 14d \
    --expiration-period never
else
  gcloud pubsub subscriptions create "${dead_letter_subscription}" \
    --project "${GCP_PROJECT_ID}" \
    --topic "${dead_letter_topic}" \
    --message-retention-duration 14d \
    --expiration-period never
fi

gcloud pubsub topics add-iam-policy-binding "${GCP_PUBSUB_TOPIC}" \
  --project "${GCP_PROJECT_ID}" \
  --member "serviceAccount:${GDC_GSA_EMAIL}" \
  --role roles/pubsub.publisher >/dev/null
gcloud pubsub subscriptions add-iam-policy-binding "${GCP_PUBSUB_SUBSCRIPTION}" \
  --project "${GCP_PROJECT_ID}" \
  --member "serviceAccount:${GDC_GSA_EMAIL}" \
  --role roles/pubsub.subscriber >/dev/null

gcloud beta services identity create --service pubsub.googleapis.com --project "${GCP_PROJECT_ID}" >/dev/null
project_number="$(gcloud projects describe "${GCP_PROJECT_ID}" --format='value(projectNumber)')"
pubsub_service_agent="service-${project_number}@gcp-sa-pubsub.iam.gserviceaccount.com"
gcloud pubsub topics add-iam-policy-binding "${dead_letter_topic}" \
  --project "${GCP_PROJECT_ID}" \
  --member "serviceAccount:${pubsub_service_agent}" \
  --role roles/pubsub.publisher >/dev/null
gcloud pubsub subscriptions add-iam-policy-binding "${GCP_PUBSUB_SUBSCRIPTION}" \
  --project "${GCP_PROJECT_ID}" \
  --member "serviceAccount:${pubsub_service_agent}" \
  --role roles/pubsub.subscriber >/dev/null

if ! gcloud storage buckets describe "gs://${GCP_PUBSUB_JOB_BUCKET}" --project "${GCP_PROJECT_ID}" >/dev/null 2>&1; then
  gcloud storage buckets create "gs://${GCP_PUBSUB_JOB_BUCKET}" \
    --project "${GCP_PROJECT_ID}" \
    --location "${GCP_REGION}" \
    --uniform-bucket-level-access
fi
gcloud storage buckets update "gs://${GCP_PUBSUB_JOB_BUCKET}" --lifecycle-file "${lifecycle_file}" >/dev/null
gcloud storage buckets add-iam-policy-binding "gs://${GCP_PUBSUB_JOB_BUCKET}" \
  --member "serviceAccount:${GDC_GSA_EMAIL}" \
  --role roles/storage.objectAdmin >/dev/null

gcloud firestore fields ttls update expiresAt \
  --project "${GCP_PROJECT_ID}" \
  --collection-group "${ASYNC_RESPONSE_FIRESTORE_COLLECTION}" \
  --enable-ttl

echo "Durable async jobs provisioned for ${GCP_PROJECT_ID}: ${GCP_PUBSUB_TOPIC} -> ${GCP_PUBSUB_SUBSCRIPTION}."
