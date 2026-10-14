#!/usr/bin/env bash
# Flow contract: the mandatory secure SDK E2E starts one isolated in-memory Connect ICA,
# routes GW verification to it, and tears both processes down after the journey.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SCRIPT="${ROOT_DIR}/scripts/run-secure-e2e-google-user.sh"

bash -n "$SCRIPT"
grep -Fq 'CONNECT_ICA_ROOT=' "$SCRIPT"
if grep -Fq 'DATASPACE_ICA_ROOT' "$SCRIPT"; then
  echo 'ERROR: secure E2E must not launch the deprecated dataspace-ica runtime.' >&2
  exit 1
fi
grep -Fq 'BASE_URL="${BASE_URL:-http://127.0.0.1:3000}"' "$SCRIPT"
grep -Fq 'npm run api:local' "$SCRIPT"
grep -Fq 'curl -fsS "${ICA_BASE_URL}/"' "$SCRIPT"
grep -Fq 'ICA_URL_INTERNAL="$ICA_BASE_URL"' "$SCRIPT"
grep -Fq 'ICA_URL_EXTERNAL="$ICA_BASE_URL"' "$SCRIPT"
grep -Fq 'DID_WEB_DOMAIN="127.0.0.1:${ICA_PORT}"' "$SCRIPT"
grep -Fq 'PROFESSIONAL_EMAIL="$pass_controller_email"' "$SCRIPT"
grep -Fq 'INDIVIDUAL_CONTROLLER_EMAIL="$pass_controller_email"' "$SCRIPT"
grep -Fq 'AUTH_BEARER="$pass_auth_bearer"' "$SCRIPT"
grep -Fq 'email_verified: true' "$SCRIPT"
grep -Fq 'cleanup-secure-e2e-bootstrap-individual.mjs' "$SCRIPT"
grep -Fq 'start_local_ica' "$SCRIPT"

echo 'OK: secure E2E owns its local Connect ICA boundary.'
