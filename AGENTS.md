# AGENTS.md - sos-gw-node-ts

## Mandatory TDD

Use red-green-refactor TDD for every behavior or flow change. Write and run the smallest executable contract test first; it must fail for the intended reason before implementation begins. Then implement the minimum change and make focused, integration and affected end-to-end tests green. Begin every new or modified test suite with a flow-contract comment. Begin every Playwright or other E2E file with the complete numbered journey and its authorization and persistence invariants. Mocks may isolate units but never replace real boundary proof. Never make a test green by accepting an error, placeholder, pending setup or other incomplete terminal state.

## Non-negotiable cumulative release closure

Grouped functional branches close independently with their changelog, explicit
merge commit into `main`, pushed `main`, matching local and remote refs, and a
clean worktree. Do not bump or publish once per functional branch, and do not
describe these integration commits as released.

When the accumulated functionality is ready, run the complete affected local
matrix with no skip. Apply the semantic version only on the cumulative release
branch, merge and push that release to `main`, verify matching refs, and only
then publish the exact pushed `main` commit. Consumers subsequently pin the
exact registry version and commit their lockfiles.

For shared-package changes, publish and verify the dependency chain from the
lowest changed package upward, then pin each consumer to the exact registry
version and regenerate its lockfile before testing it. For deployable services
and portals, promote only `test -> local-network -> test-network -> network`.
No later stage substitutes for an earlier stage, and a skipped E2E blocks
publication, image construction and deployment.

## Purpose
Shared SOS gateway trunk for asynchronous secure ingestion, indexing, search,
care journeys and communications across human and animal emergency contexts.
The implementation is derived directly from GDC Core. Common managers are
implemented once; human and animal rules remain thin, neutral profiles.

Provider gateways remain authoritative for their canonical subject indexes.
This repository must not merge their tenants, data, KMS custody, ICA,
MSP/channel profiles, domains or release evidence.

Host, tenant, controller, sector, commercial and deployment identities are
configuration owned by each environment. They must not be embedded in the
neutral SOSChain source narrative or inferred from a human or animal profile.

Primary references:
- `README.md`
- `docs/API_INTEGRATORS_GUIDE.md`
- `docs/02-API-AND-ENDPOINTS/02.A-API-ENDPOINTS.md`
- `docs/01-OVERVIEW-AND-GUIDES/01.G-TESTING-PATTERNS.md`
- `docs/UC_CAPABILITY_MATRIX_SEDIA.md`
- `TESTING.md` / `TESTING-GUIDE.md`

## Scope Governance
1. Keep core GW scope explicit and testable.
2. Features outside current core narrative must be documented as extension scope, not mixed into core acceptance criteria.
3. OpenAPI/examples/tests must describe actual behavior, not aspirational behavior.
4. Prove new shared GW behavior against the current GDC Core contract first.
5. Record each applicable GDC Core change in `SYNC.md` as adopted, already
   equivalent, profile-specific or blocked. Never copy whole branches into
   this trunk.
6. Do not cite downstream products or deprecated gateways as architectural
   sources, compatibility baselines, profiles or authorities.

## Hard Rules
0. In production each Kubernetes pod/process must unwrap the encrypted service
runtime KEK exactly once through KMS during bootstrap. Inject that process-owned
resource from `buildInfrastructure`; tenant operations use it locally and must
not call KMS. Do not add a singleton/global registry or shared plaintext key.
Google Cloud KMS and AWS KMS are supported production roots behind the same
`KMS_*` configuration contract. `KEK_SECRET` remains local/demo custody and
must not be represented as the audited production profile.
1. Manager logic is deterministic and claim-driven.
2. Search semantics must be explicit:
- accepted query params
- 0..n result behavior
- OperationOutcome behavior for errors.
3. For DocumentReference indexing/retrieval:
- `DocumentReference.identifier` is logical identifier (UUID/URN)
- `DocumentReference.contenthash` is content hash/CID
- hash-based retrieval must use canonical claim name (`contenthash`), with legacy aliases only if documented.
4. Communication atomic profile constraints must not be presented as native FHIR limitations.
5. Activation controller checks must consume shared policy from
`gdc-common-utils-ts` (no duplicated local role parsing).
6. Canonical examples/docs keep these dimensions separate:
- legal-representative and technical occupations use ISCO-08;
- tenant controller authority uses bare `RESPRSN` in
  `ServiceControllerCredential.credentialSubject.owner.additionalType`;
- avoid `|RESPRSN` as canonical output.
7. Never add a routable action that is absent from generated OpenAPI. Every
public action must have route JSDoc, generated Swagger, a shared
`gdc-common-utils-ts/examples` payload, and unit plus integration proof in the
same change.
8. Organization teardown never uses wildcard ids, implicit cascades,
`_disable-descendants`, or `_purge-descendants`. Controllers enumerate
authorized resources and send bounded Bundles with an explicit id per entry:
- legal-organization workers use `Employee/_batch` with entry method `DELETE`
  for the current soft-disable compatibility profile, then `Employee/_purge`;
- individual-organization members use `RelatedPerson/_batch`, then
  `RelatedPerson/_purge`;
- the individual organization itself uses its explicit
  `Organization/_disable` and `Organization/_purge` lifecycle.
The BFF or management client owns search pagination, chunking, retry and
partial-result handling. The GW validates every entry independently and never
interprets `id = "*"`.
9. FHIR Bundle `DELETE` normally denotes delete. When the current Employee
compatibility profile maps it to inactive soft-delete, label that behavior as
a GW lifecycle profile, never as a native FHIR limitation. Employee disable
keeps the seat; purge requires inactive state and releases or disassociates it.
10. Claims-first persistence is mandatory for operational FHIR-like routes:
- `resource.meta.claims` is the canonical input and response source;
- every new or changed manager must invoke its resource-specific flat-claim validator
  and reject native resource fields before any persistence call;
- confidential documents encrypt `content: { claims }`, never a nested native
  FHIR resource;
- every searchable attribute name and value must pass through
  `protectAttributesNameAndValue` before persistence or comparison;
- native FHIR JSON exists only at explicit import, projection, or versioned
  export boundaries and must not become the operational storage model.
Historical nested FHIR records encountered by claims-first managers fail closed
and require an explicit recoverable migration. Reads and PATCH operations must
never delete or silently rewrite them.

## Naming Discipline
1. Keep the common concept first and the specialization last.
2. Prefer names such as:
- `UserProfileIndexStoreInMemory`
- `UserProfileIndexStoreFirestore`
- `UserProfileVaultFirestore`
3. Avoid inverted names such as:
- `InMemoryUserProfileIndexStore`
- `FirestoreUserProfileIndexStore`
4. The reason is programming/autocomplete consistency across backend and SDK runtimes.

## TDD Policy
For any endpoint/manager behavior change:
1. Add failing unit test in manager layer.
2. Add/adjust integration test in route layer.
3. Validate SDK live E2E impact when core flow is affected.

## Quality Gates
- Portal release order is always `test -> local-network -> test-network ->
  network`. First run unit and integration tests with `networkKind=test`, then
  prove the normal local UI -> BFF -> high-level SDK -> GW/DataConv journey
  with real Playwright, in-memory state and no blockchain. Fixture pages, mocked
  routes, API-only Playwright, or separate UI/GW tests never satisfy this gate.
- An unpublished SDK may use an immutable `npm pack` tarball only as a temporary
  `--no-save` fail-fast install. Restore the registry dependency and lockfile;
  publish only after local gates pass, install the exact registry version, then
  continue through `local-network` and staging. After a failure, resume at the
  smallest failed gate; rerun predecessor gates only for required state, an
  earlier-boundary change, or untrustworthy environment state.
- Organization onboarding: `npm run test:organization-registration:local`
  before any Test Network image. This must reconstruct process-local GW/KMS
  state over the persisted pending Offer. Run `npm run docker:smoke:local-network`
  only after the real local portal gate, as an additional proof when
  Fabric/ledger behavior is affected. Staging repeats the same journey.
- Type/build scripts as applicable.
- Unit: `npm run test:unit` or targeted jest files.
- Integration: `npm run test:integration` or targeted jest files.
- E2E (when needed): `npm run test:e2e`.
- Swagger/profile sync when changing contract/examples:
  - `npm run build:swagger`

## Core Test Anchors
- `src/__tests__/unit/managers/CommunicationManager.unit.test.ts`
- `src/__tests__/unit/managers/DocumentReferenceManager.test.ts`
- `src/__tests__/integration/composition.bundle-search.api.test.ts`
- `src/__tests__/unit/adapters/activation-trust.adapter.test.ts`

## Live E2E Execution Policy
For real core validation, use orchestration script instead of ad-hoc direct test command:
- `./scripts/run-secure-e2e-google-user.sh`

Collect and preserve audit artifacts:
1. `gw-secure-e2e-*.log`
2. `live-gw-http-trace-*.jsonl`
3. `live-gw-uc5-debug-*.jsonl`

## Release Discipline
- This repository is a deployable service, not an npm package. Keep
  `package.json#private` set to `true` and preserve the failing
  `prepublishOnly` guard; never run or document `npm publish`. Release
  immutable container images to Artifact Registry and deploy them by digest.
- Update `CHANGELOG.md` under `Unreleased` with explicit endpoint/manager effects.
- Keep docs and API examples synchronized with test-proven behavior.
