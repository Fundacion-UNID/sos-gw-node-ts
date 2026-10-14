---
name: gw-vetchain-local-image-release
description: Build, validate, publish and deploy one immutable GW VetChain image from vet-gw-node-ts using the VetChain staging or production profiles.
---

# GW VetChain local image release

Build and test one repository-scoped `linux/amd64` image. Publish that exact
local image and deploy only its registry digest. Never reuse the CORE or UNID
target tuple, image repository, runtime profile or public verification story.

## Mandatory TDD and source gates

Every behavior or deployment-script change starts with a failing executable
contract test. Before the release build, require a clean committed branch,
focused and full tests, typecheck, build, `git diff --check`, and a pushed
commit. The service is private and must never be published to npm.

Reusable SDKs consumed by portals or telephone services must already be exact
npm registry releases. Do not put Git+SSH, GitHub archives, workspace `file:`
dependencies, vendored package tarballs or private keys into any image build.

## VetChain target tuple

Resolve and print these checked-in values before mutation:

- repository/package: `vet-gw-node-ts`
- product: `VetChain`
- staging project: `uhc-can`
- staging region: `northamerica-northeast2`
- staging cluster/context: `fabric-uhc-can-test` /
  `gke_uhc-can_northamerica-northeast2_fabric-uhc-can-test`
- staging namespace: `staging-connecthealth-vet-v2`
- Deployment/Service: `vetchain-gw`
- public URL: `https://beta-gw.vetchain.app`
- runtime profile: `deploy/vetchain/staging.runtime.env`
- The GW repository owns its image build, environment profiles, Kubernetes
  manifests and workload rollout. `fabric-multicloud` owns Fabric network
  lifecycle only and must never be invoked to deploy a GW process.
- orchestration profile: `deploy/vetchain/staging.config`
- image repository: `connecthealth-vet-host-images/connecthealth-vet-host-staging`

Production is a separate target. Stop unless every required production host,
project, cluster, KMS, storage, Firebase, genesis fingerprint and service
account variable is explicitly supplied. Never infer it from staging.

## Inviolable persistence red lines

- Treat either `NODE_ENV` or `DEPLOYMENT_ENV` equal to `staging` or
  `production` as authoritative. A misleading `NODE_ENV=demo` never permits an
  in-memory database, confidential storage or local/memory KMS in a deployed
  environment.
- Configuration is not operational proof. Before accepting a new digest, run
  a real write, read, compare and delete against GCS from the candidate image
  with the deployment's Kubernetes service account and Workload Identity.
- After rollout, repeat that roundtrip from the application container, delete
  exactly that pod, wait for a replacement pod, and repeat the roundtrip from
  the replacement pod. A CORE PostgreSQL/IPFS restart proof, local-network
  smoke, ping, startup log, unit mock or provider name cannot substitute for
  the effective Firestore/GCS/KMS staging profile.
- Verify the exact deployed digest and package version, Firestore, GCS bucket,
  enabled Cloud KMS key, wrapped runtime KEK ciphertext, absence of plaintext
  KEK variables, bucket region, uniform access, public-access prevention and
  versioning. Do not print secret or ciphertext values.
- `QUEUE_PROVIDER=mem` is a documented staging-only transient bridge and never
  confidential storage. It is forbidden in production until a persistent queue
  and restart/readback test are configured.
- Production promotion is forbidden if any local, canary, live roundtrip,
  restart, policy, endpoint or clean-main gate is missing. Preserve the prior
  digest for rollback and report the failed gate; never downgrade a provider
  to make a rollout boot.
- Read and follow
  [`docs/PERSISTENCE_RELEASE_RED_LINES.md`](../../../docs/PERSISTENCE_RELEASE_RED_LINES.md)
  for the human-operable evidence checklist.

## Product contract

- Digital-twin discovery is only
  `digitaltwin/.../ResearchSubject/_search`. In claims-first
  `org.hl7.fhir.api`, one `ResearchSubject.meta.claims` map intentionally mixes
  `ResearchSubject.*` and `Composition.*`; in strict R4/R5, the translated
  Composition is a `ResearchSubject.contained[]` resource. It is the canonical
  index, never a second public search result and never an ad-hoc
  `ResearchSubject.composition` property. Historical tenant DIDs
  may authorize this read through their former `Composition/_search`
  declaration, but startup must replace that service and preserve custom ones.
- Digital Twin Consent status is an individual `Subject/_search` transported by
  `Communication`. Filter contextualized HRESCH rules by subject, provider,
  reader action and exact source reference; do not interpret `Subject` as a
  Digital Twin resource.
- Tenant id is the exact Canadian Business Number `704457076`; jurisdiction
  `CA-BC`, identifier type `BN` and sectors stay separate.
- Required sectors are `animal-care`, `animal-research`, `animal-index`,
  `animal-tech` and `onehealth-research`.
- Human/global identity, regional professional identity and animal data use
  their configured channels independently; deployment must not collapse them.
- `STRIPE_ENABLED=false` means the optional webhook is not mounted. Enabling it
  requires both signing secrets and separate payment-flow verification.
- The image is environment-neutral: local smoke uses `local-network`, staging
  uses `test-network`, and production uses `network`.

## Build and validate locally

## Authored clinical batch deletion

- Accept mixed typed `POST` and `DELETE` entries only in `Bundle.type = batch`; do not convert the flow to a transaction.
- `DELETE` addresses exactly `ResourceType/id`, carries no resource body and may include `ifMatch` for optimistic locking.
- Keep operational sender DID, clinical author and attester separate. For
  professionals, persist the legal organization as `Composition.author` and
  the exact PractitionerRole assignment as `Composition.attester`; for
  personal writes use the protected owner/member selection. The sender DID is
  `audit.creatorDid`, never an automatically inferred FHIR author or attester.
- Authorize deletion against the exact subject plus the authenticated DID or privately linked verified email/phone identifiers. Never copy contact values or hashes into the FHIR resource.
- Return independent `201`, `204`, `403`, `404` or `412` entry results. A failed delete must not roll back a successful sibling create.
- Remove the exact operational fact and its synchronized Digital Twin projection. This is separate from secondary-use `deny` and provider-offboarding purge.


```bash
release_tag="$(node -p "require('./package.json').version")-$(git rev-parse --short HEAD)"
local_image="gw-vetchain:${release_tag}"

DOCKER_PLATFORM=linux/amd64 LOCAL_IMAGE_NAME="${local_image}" \
  ./docker_build_local.sh

IMAGE_NAME="${local_image}" npm run docker:smoke:local-network
```

Use the checked-in script and this repository as Docker context. Do not replace
it with an ad-hoc build. A ping-only container check is not a release smoke;
the DCR, registered JWKS, individual-controller SMART continuation, Consent,
Fabric role-licence and animal subject boundaries must remain green.
`RUN_RESEARCH_SMART_SMOKE=true` is the mandatory default: the smoke must prove
the provider-authorized-signatory and consumer-authorized-signatory research
allow/deny matrix, by role and by email, followed by Digital Twin search. An
explicitly disabled or skipped research flow is diagnostic-only and cannot be
used as release evidence. Resolve the provider organization DID from the live
tenant `.well-known/did.json` and bind the inter-tenant Contract VC to that
exact DID; a synthetic or assumed hostname is not valid release evidence.

## Dry run, publish and deploy staging

First validate without mutation:

```bash
GKE_ENV_FILE=deploy/vetchain/staging.runtime.env \
GDC_IMAGE_TAG="${release_tag}" DEPLOY_DRY_RUN=true \
  ./cloud_deploy.sh gke vetchain deploy/vetchain/staging.config
```

For publication and deployment, isolate GCloud, kube and Docker configuration
in task-specific temporary directories. Verify the account, project, region,
cluster, context, namespace, current Deployment image and rollback digest.
Then reuse the tested local image:

```bash
GKE_ENV_FILE=deploy/vetchain/staging.runtime.env \
GDC_IMAGE_TAG="${release_tag}" SKIP_BUILD=true \
LOCAL_IMAGE_NAME="${local_image}" DEPLOY_CONFIRM=true \
  ./cloud_deploy.sh gke vetchain deploy/vetchain/staging.config
```

The deployment script must resolve the pushed tag to a digest before applying
manifests. After rollout, verify the effective pod digest, required sectors,
`NETWORK_MODE=test-network`, exact trusted OIDC `iss`/`aud` providers,
persistent providers,
`/host/ping`, `/api-docs/`, host DID and public JWKS. Never claim deployment
from a successful local build or registry push alone.

## Finish

Record commit, tag, local image ID, registry digest, previous digest, target
tuple, rollout and endpoint results. Update `CHANGELOG.md`, push the branch,
merge it to `main`, push `main`, delete the completed patch branch and finish
with clean worktrees. Report any missing production authority or secrets as a
blocker instead of inventing values.

## Mandatory release authorization continuity

Run unit and integration tests with `networkKind=test`, then the real local UI
-> BFF -> SDK -> GW/DataConv Playwright journey without blockchain. An `npm pack`
tarball is a temporary `--no-save` input only; restore the dependency and
lockfile. Publish only after the full affected local matrix is green, install
the exact registry version, run its minimal artifact smoke, then run
`local-network` and staging. Resume at the smallest failed gate; rerun predecessor gates only
for required state, an earlier-boundary change, or untrustworthy state.

For any release chain that requires npm authorization, make at most three
attempts and keep each command session and browser window alive for up to five
minutes. Never end the turn or imply continued work while a window is pending.
After all three attempts fail, keep the release unpublished and continue the
local `test` stage with an immutable `npm pack` tarball. Never commit a
`file:`, Git, workspace or vendored tarball dependency.

Follow the canonical contract in
[`docs/LOCAL_FIRST_RELEASE_CONTRACT.md`](../../../docs/LOCAL_FIRST_RELEASE_CONTRACT.md):

- Do not attempt `npm publish` until every affected local `test` gate is
  green, including unit, integration, local services, real UI and Playwright.
- An npm publish or authorization failure must never stop the `test` stage.
- Continue unit, integration, local service, UI and Playwright gates with the
  immutable tarball installed `--no-save` on pushed but unmerged branches.
- The `npm pack` tarball is temporary: install it `--no-save`, then restore
  the registry dependency and lockfile before committing dependency state.
- Start the consumer from `npm ci`. If `npm install --no-save <tarball>`
  re-resolves unrelated dependency ranges, overlay the exact packed contents in
  the matching `node_modules` directory, or use an equivalent isolated method
  that leaves manifests and lockfiles unchanged. Verify the local package
  versions and runtime-sensitive baseline dependencies before testing; remove
  the overlay with the next `npm ci`.
- After a failure, resume only the smallest failed gate; do not repeat a green
  gate unless the fix changed its boundary, it creates required state, or the
  environment is no longer trustworthy.
- Resume the failed gate; rerun a predecessor only for required state, a
  changed earlier boundary or an untrustworthy environment.
- After publication, install the exact registry version and run only the minimal
  install/export smoke; do not repeat the green local matrix unless the
  published artifact differs from the tested tarball or invalidates that
  evidence.
- Missing exact registry publication blocks only consumer merge, image build,
  `local-network`, `test-network`/staging and `network` promotion.
- A gateway consumer installs the exact registry version before its merge,
  image build and `local-network`. A portal consumer may retain the immutable
  tarball on its pushed, unmerged branch throughout `local-network`; after
  `local-network` is green, it installs the exact registry version and runs
  only the artifact smoke before its merge and staging. Do not reinstall or
  rerun an already-green portal merely to build the gateway image or execute
  the Fabric `local-network` gate.
- Publish only after the local matrix is green, install the exact registry
  version in the gateway before `local-network`, and install it in portals
  before staging.
- Registry order is dependency publish and verification, then consumer install
  and lockfile pin, then package merge, consumer merge, image build and deploy.
- Every test file's first line must be a `Flow contract:` comment linking this
  policy. Apply TDD red -> green -> refactor: red must fail because the
  production behavior is absent or wrong; green must prove the production
  contract. A skip, accepted error, placeholder, pending setup, fixture-only UI
  or mock replacing a real boundary is never green.
- Reuse canonical types and terminology from HL7/FHIR, LOINC, SNOMED CT,
  ICD-10, WHO ATC, Schema.org or the applicable governed standard before
  inventing a local type, enum, code, identifier or vocabulary.
- Put missing reusable types in the versioned domain data package or
  `common-utils`, with tests in that owning shared package, before downstream
  use.
- Reuse canonical fixtures, builders, claims, identifiers and vocabulary from
  the versioned domain data package (`<version>-data` or
  `<version>-data-utils`) or `common-utils`; no duplicated literals are
  allowed. If the reusable datum does not exist, add it first to its owning
  shared package with tests and consume that export downstream.


## Frozen shared-v1 boundary

- Treat GW CORE v1 (`gwtemplate-node-ts`) and every `gdc-*` repository or package as frozen for new functionality. Only make a narrowly necessary bug, security, or compatibility fix there, backed by a regression test and without product-behavior expansion.
- Implement new VetChain, UHC/UNID, or SOSChain behavior in the corresponding `vet-*`, `uhc-*`, or `sos-*` repository. Keep product roadmaps, feature documentation, examples, and skills in those product repositories; do not add them to GW CORE or `gdc-*`.
