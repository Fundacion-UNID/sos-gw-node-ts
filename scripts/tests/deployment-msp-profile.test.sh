#!/usr/bin/env bash
# Flow contract: each staging profile declares its exact Fabric MSP; the shared deployer never guesses one and no production profile is introduced during this migration.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
human_staging_profile="${repo_root}/deploy/profiles/human/staging/gke.config"

staging_values="$({
  source "${human_staging_profile}"
  printf '%s\n%s\n' "${LEDGER_MSP_ID:-}" "${LEDGER_FABRIC_MSP_ID:-}"
})"

expected_staging=$'UNIDSTAGINGMSP\nUNIDSTAGINGMSP'
if [[ "${staging_values}" != "${expected_staging}" ]]; then
  echo "The human staging profile must declare UNIDSTAGINGMSP for both ledger MSP settings." >&2
  exit 1
fi

if [[ -d "${repo_root}/deploy/profiles/human/production" || -d "${repo_root}/deploy/uhc-production" ]]; then
  echo "Production profiles are outside the current staging migration." >&2
  exit 1
fi

if grep -Eq '^  "LEDGER_(FABRIC_)?MSP_ID=[^\"]+' "${repo_root}/scripts/deploy-gke-gw.sh"; then
  echo "The shared deployment script must not guess an environment MSP." >&2
  exit 1
fi

grep -Fq 'LEDGER_MSP_ID' "${repo_root}/scripts/deploy-gke-gw.sh"
grep -Fq 'LEDGER_FABRIC_MSP_ID' "${repo_root}/scripts/deploy-gke-gw.sh"

echo "Deployment MSP staging profile contract: PASS"
