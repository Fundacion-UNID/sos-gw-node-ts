#!/usr/bin/env bash
set -euo pipefail

echo "[E2E real] Precheck: Google auth token"

if ! command -v gcloud >/dev/null 2>&1; then
  echo "ERROR: gcloud CLI is not installed."
  echo "Install it first, then run again."
  exit 2
fi

if ! gcloud auth print-identity-token >/dev/null 2>&1; then
  echo "AUTH_REQUIRED: no active gcloud session with identity token."
  echo "Run:"
  echo "  gcloud auth login"
  echo "Then rerun:"
  echo "  npm run test:e2e:real"
  exit 3
fi

echo "OK: gcloud identity token available."
echo "Running E2E suite..."
npm run test:e2e
