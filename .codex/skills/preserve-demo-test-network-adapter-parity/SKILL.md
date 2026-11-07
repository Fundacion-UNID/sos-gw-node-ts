---
name: preserve-demo-test-network-adapter-parity
description: Preserve the same GW managers and IVaultRepository contract across Demo, Test Network, production and Expo consumers.
---

# Preserve Demo and Test Network adapter parity

Demo and Test Network execute the same GW managers. Demo changes synthetic
seeding and authority evidence, never managers or persistence models.

All-local injects `VaultMemRepository`; Expo injects SQLite through the same
Confidential Storage contract; durable deployments explicitly select
Firestore or PostgreSQL. Adapter imports belong only in `buildInfrastructure`.
Every change requires a negative architecture test and the same local
UI -> BFF -> SDK -> GW journey before Test Network.

The CH all-local portal profile does not start or require Chat, the telephone
assistant or the optional web assistant. Treat RTC as a dedicated provider and
persist invitations, terminal states and unanswered audio as Communications.

## Mandatory local-first release continuity

Follow `docs/LOCAL_FIRST_RELEASE_CONTRACT.md`. Make at most three attempts at
npm authorization and keep each attempt alive for five minutes. An authorization
failure must never stop the test stage. Continue the local test with an immutable
`npm pack` tarball installed `--no-save` on pushed but unmerged branches;
never commit `file:`, Git, workspace or vendored dependencies, and restore the
registry dependency and lockfile afterward.

Do not attempt `npm publish` until every affected local unit, integration,
local services, real UI and Playwright gate is green. Run unit and integration
with `networkKind=test`, then the real UI -> BFF -> SDK -> GW/DataConv
Playwright journey. Resume only the smallest failed gate and do not repeat a
green gate unless an earlier boundary changed or required state is invalid.
Resume a failed gate; rerun a predecessor only when it creates required state.

The order is merge functional work to main, validate local packages and the
full local matrix, publish bottom-up, install the exact registry version on
main, then staging. Registry publish precedes consumer merge and deploy. A
missing release blocks only consumer merge, image build, local-network,
test-network and network. A gateway installs the exact registry version before
its image and local-network; a portal may use the temporary tarball through
local-network, then installs the exact registry version before staging. After
publication run the minimal install/export smoke and do not repeat the green
matrix unless the artifact differs.

Every test file starts on its first line with a `Flow contract:` comment. Reuse
canonical types from HL7/FHIR, LOINC, SNOMED CT, ICD-10, WHO ATC and Schema.org
before inventing a type. Put missing reusable types in the versioned domain data
package or `common-utils` shared package. Reuse its fixtures and allow no
duplicated literals.

An authorization failure must never stop the test stage.
Use an immutable tarball with `--no-save` on pushed but unmerged branches.
Resume only the smallest failed gate; do not repeat a green gate.
Run the exact registry version minimal install/export smoke; do not repeat the matrix.
Every test file's first line is a Flow contract; fixtures come from the versioned domain data package or common-utils with no duplicated literals.
Reuse types from HL7, LOINC, SNOMED CT, ICD-10, WHO ATC and Schema.org before inventing any type.
Put missing types in the versioned domain data package or common-utils shared package.
An npm pack tarball is temporary no-save input; restore the registry dependency and lockfile.
Resume the failed gate; rerun a predecessor only when required state is missing.

