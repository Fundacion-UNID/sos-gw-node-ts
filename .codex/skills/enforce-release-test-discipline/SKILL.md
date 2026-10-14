---
name: enforce-release-test-discipline
description: Enforce branch, TDD, canonical FHIR and schema.org vocabulary, fixture, test-layer, product-neutrality, changelog, semantic-version, npm publication, deployment and merge discipline across GW CORE, shared gdc SDKs and product portals. Use for every behavior fix, FHIR-like resource or search contract, flow change, test or 101 example, documentation contract, shared-package release, portal dependency promotion, App Hosting rollout, or request to ship with branch, patch, changelog and merge to main.
---

# Enforce Release and Test Discipline

## Start on a branch

1. Read the repository `AGENTS.md` and applicable product/contract skill.
2. Inspect the worktree and preserve unrelated user changes.
3. Work only inside the owning repository's existing checkout. Do not create a
   worktree, clone, copy, temporary checkout or task directory outside that
   repository, including under a workspace-level `.codex-worktrees`, `/tmp` or
   `/private/tmp` path.
4. An external worktree is allowed only after the user explicitly authorizes
   it for two identified, intentionally concurrent branches. State both branch
   names, their owners/paths and why simultaneous checkouts are required before
   creating it. Authorization is task-specific and does not carry forward.
5. Never use another checkout to route around earlier unmerged work, defer its
   integration, or plan to test unrelated branches together later. Close the
   earlier branch correctly through its own tests, merge and cleanup first. If
   it cannot be closed without affecting work owned by somebody else, stop and
   ask instead of creating a parallel folder.
6. If the current checkout is clean and its branch is already contained in the
   intended remote base, switch that same checkout to the updated base and
   continue there. Update local knowledge of the remote, start from the
   intended current base, and create a named branch before editing.
7. Never implement or commit directly on `main`. If that already happened,
   disclose it; do not rewrite published history to manufacture a merge.
8. At closure, push the explicit merge to `main`, delete the task branch and
   remove every task-specific auxiliary checkout that the user authorized.
   Do not delete pre-existing branches or directories whose ownership is
   unknown; report them separately.

## Write the contract test first

- Use red-green-refactor for every behavior or flow change. Run the smallest
  executable test and retain the intended failure before implementation.
- Make this the first physical line of every new or modified test file:
  `// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.`
- Import synthetic identities, routes, DIDs, tokens, codes, dates and other
  governed examples from the canonical shared test-data/example module.
  Prefer the applicable `*-data-utils-ts` package or
  `gdc-common-utils-ts/examples`; add a missing fixture there once instead of
  repeating a local literal.
- Import defined enums, constants, claim names, resource types, transport
  profiles and HTTP methods from their owning package. Never restate their wire
  strings merely to make a test pass.
- Preserve the primary-document Bundle boundary: a DIDComm payload body is one
  FHIR-like/JSON-primary-document Bundle, and each successful result belongs in
  `body.data[].resource` (or canonical FHIR `entry[].resource`). Never place a
  second `{ total, data }` search list inside `BundleEntry.resource` except in
  the isolated, explicitly deprecated rolling-deployment serializer. Add a
  negative assertion against `resource.data` for the current profile and prove
  the legacy profile separately without teaching it in high-level snippets.
- Literal values are allowed only when the literal itself is the behavior under
  test, such as malformed input or an exact serialization assertion. State
  that reason beside it.

## Preserve standard vocabularies

- Before authoring a FHIR-like resource, property, status, search parameter or
  flat claim, verify the exact name and value against the applicable official
  HL7 FHIR version and the canonical catalog already exported by
  `gdc-common-utils-ts`. Do the same for schema.org types and properties.
- Never invent a FHIR resource name, pseudo-resource namespace such as
  `AccessRequest.*`, property, status or search parameter. FHIR-like flat
  claims keep the owning HL7 resource and original API/search parameter name;
  they do not create a parallel vocabulary.
- When R4 and R5 differ, state the selected profile explicitly and use only a
  value valid for that profile. For a shared claims-first contract, choose a
  deliberately supported cross-version representation and prove both
  projections. Never infer a value from a different FHIR release.
- Model native FHIR discovery at the exact tenant-sector `section/format`
  server base. `[base]/metadata` and
  `[base]/.well-known/smart-configuration` must never merge capabilities across
  sections or releases. `org.hl7.fhir.api` remains a flat-claims context.
- Human cross-provider identity lookup has two hard boundaries: derive the
  canonical opaque subject identifier only for the provider-only Fabric
  lookup, then stop that hash at Fabric; resolve `indexProviderDid` and use IHE
  PDQm ITI-119 `POST Patient/$match` with the original governed identifier.
  Do not implement PIXm or `$ihe-pix`. Direct FHIR carries one Parameters;
  DIDComm carries exactly one Parameters entry in `body.data[]`; strict mode
  carries that signed/encrypted DIDComm message in form fields `request` and
  `response`. Managers/adapters own ledger channel and smart-contract routing;
  SDKs, BFFs and portals never configure either name.
- Introduce an extension only after proving that neither FHIR nor schema.org
  covers the requirement. Give it an explicit canonical extension URL,
  document ownership and compatibility, add it to the shared catalog first,
  and keep it visibly separate from native standard fields.
- Model a professional permission request as one auditable `Communication`
  carrying a Bundle of ordinary `Consent.status=draft` resources. Draft
  Consent describes requested rules and grants no access. Only the
  controller-approved active Consent enters authorization evaluation; the
  historical status-less rule is read-only migration compatibility.
- Add regression assertions that reject invented namespaces and that prove
  non-active Consent states cannot authorize. Cite the official vocabulary in
  JSDoc and high-level docs, while tests import the governed constants instead
  of copying wire literals.

## Enforce claims-first persistence

- Treat `resource.meta.claims` as the canonical business source of truth for
  every claims-first GW request and response. A manager must persist those flat
  claims in `ConfidentialStorageDoc.content.claims`; it must not discard them
  and replace them with a version-specific nested FHIR resource.
- Pass incoming flat claims through the existing
  `normalizeContextualizedClaims` canonical FHIR-claim validation before
  `protectConfidentialData`. Reuse its `normalizeFhirApiClaimKey` contract;
  never create a manager-local or parallel validator.
- Build `indexed.attributes` only from the governed searchable subset of those
  claims and pass that subset through `protectAttributesNameAndValue` before
  repository persistence. Never expose plaintext searchable claim names or
  values outside encrypted content.
- Materialize native FHIR only at an explicit import, projection, or export
  adapter boundary. `validateFhirResource` validates native FHIR at that
  boundary, not the canonical flat-claims representation. Native FHIR input
  may be normalized into flat claims, but it never replaces flat claims as the
  stored source of truth.
- Make this an obligatory gate for every new persistence manager. Before its
  implementation can pass review, add a focused test that inspects the exact
  argument sent to `protectConfidentialData`, proves `content.claims` is the
  canonical payload, proves protected `indexed.attributes`, and rejects nested
  FHIR fields as persisted business state. Add the corresponding route test and
  keep an affected real local E2E with no skip.

## Keep test layers separate

### Inviolable end-to-end acceptance line

- Unit and mocked integration tests prove only local behavior; they never
  authorize “the flow works.”
- Before that claim, run the exact user journey across every affected real
  local process: ICA when applicable, GW, persistent adapter, BFF, SDK
  wallet/DCR and portal/channel runtime.
- Prove idempotency by replaying the same operation identity and prove
  persistence by reading the durable result back through the public boundary.
- A skip, accepted error, placeholder terminal state, mocked process boundary,
  unverified retry or a user acting as the first manual tester is a failed
  release gate. Automated proof must precede a manual acceptance call.

- Enforce the same portal progression everywhere: `test -> local-network -> test-network -> network`.
  First run unit and integration tests with `networkKind=test`, then prove the
  normal local UI -> BFF -> high-level SDK -> GW/DataConv journey with real
  Playwright, in-memory services and no blockchain.
  Fixture pages, mocked routes and API-only Playwright are diagnostics and
  never satisfy this cross-system gate. Run Fabric/local-network only after it
  is green; staging repeats the journey after deployment, and production is
  last.
- Enable and execute every affected package or SDK live E2E against the real
  local services before releasing it. A live E2E reported as `SKIP` means the
  release gate failed; it is not passing evidence. Complete these live E2E
  gates before `npm publish` or any container image build.
- To fail fast across unpublished packages, use an immutable `npm pack` tarball
  only as a temporary `--no-save` consumer install. After the test, restore the
  registry dependency and lockfile and prove a clean diff: no `file:`, Git,
  workspace or vendored dependency may be committed. Publish only after unit,
  integration and local browser gates are green; reinstall the exact registry
  version, repeat the reproducible gate, and only then run `local-network` and
  staging.
- After a failure, resume at the smallest failed gate. Rerun predecessor gates
  only when they create required state, the fix changes an earlier boundary, or
  environment state is no longer trustworthy. Run the complete suite once at
  branch closure.
- Preserve identity roles at every transport boundary: DIDComm `from` is a
  sender DID, JWT `iss` is the signing entity, `kid` is a concrete key DID URL,
  and SMART `sub` is the authorized actor. Native FHIR Communication/Bundle
  inputs carry none of those DIDComm fields; HTTP Authorization proves the
  caller and `Communication.sender` keeps its FHIR business meaning.
- Treat assisted or telephone clinical intake as `Communication.status =
  preparation`: persist the Communication for audit but do not execute attached
  clinical mutations. Only `completed` projects clinical state; `not-done`
  records rejection without projection. Never call this state `draft`.
- For generated clinical content, resolve Composition provenance from the
  protected registered creator binding. The closed `owner | creator` BFF choice
  is compatibility only: member/controller content may use one registered
  RelatedPerson as both author and attester; professional content keeps the
  jurisdictional CDS legal-organization URN as author and its registered
  PractitionerRole as attester. Never accept an arbitrary author reference
  from UI input or infer it from actorDid.
- Correction authority is separate from authorship: a registered member with
  the same individual owner or an authorized tenant professional may create a
  new version. Delete remains exact-author only. Preserve the new version's
  real author/attester and the verified submitter audit.
- Communication-carried clinical Bundles submit one sanitized primary-document
  `data[]` batch. The smart contract must process every entry as an individual
  asset keyed by that resource CID in one transaction; never persist `fullUrl`
  or confidential FHIR content. Do not publish `resource.meta.claims`; only the
  positive ledger-safe `meta.tag[]` allowlist and SHA3-384 multihashes in
  historical `relationships`/`ownerships` may cross that
  boundary. Keep author, attester, custodian, sender, verified submitter,
  signing-key and subject-ownership links distinct; never send their raw DID,
  URN, URL, key id or contact value. UUID-backed references must hash the
  canonical 16 UUID bytes so bare, `urn:uuid`, FHIR-relative and
  `:instance:<uuid>` forms converge for the same UUID. Keep the professional
  assignment link (PractitionerRole UUID), employee/person link (employee UUID)
  and organization link (complete CDS legal-organization URN) distinct.
  `artifact-sc.relationships.attester[]` must join the assignment asset in
  `employee-sc`; that asset joins employee and organization, and
  `subjectkeybinding-sc` repeats the same three opaque links beside `keyId`.
  Expose
  the real Fabric transaction id. A memory-adapter
  receipt is local proof only and must never be reported as on-chain evidence.
- Ledger channel and smart-contract selection is manager-owned policy. Managers
  derive the channel from trusted normalized domain context and select the
  canonical contract internally. Never accept either name from a request, BFF,
  SDK or deployment environment variable. Contract tests must poison legacy
  channel/chaincode variables and still prove the canonical selection.
- Keep the GW authenticated-authorship 101, Node BFF clinical-writes 101,
  public JSDoc, test journey comments, snippets, README summaries and the
  repository-local provenance skill mutually linked and synchronized.

- High-level `101`, documentation snippets and E2E journeys use only public
  application/SDK facades and assert user-visible or contract-visible results.
  They must not provision wallets, decode compact JOSE, record raw fetch calls,
  construct internal routes, inspect queues/vaults or instantiate transport
  adapters.
- Put algorithm and helper behavior in unit tests.
- Put HTTP serialization, encrypted transport, persistence adapters and route
  boundaries in focused integration tests.
- Put complete cross-system behavior in numbered E2E journeys with explicit
  authorization and persistence invariants. Mocks never count as boundary
  proof.
- Do not make high-level examples green by embedding internal plumbing. Move
  that proof to the correct lower-level suite and leave the high-level example
  copyable.

## Preserve SMART summary authorization and the document graph

- Treat a section-limited SMART token as the server-side boundary for
  `Subject/$summary`: omitted application filters inherit the authorized set;
  explicit filters use the requested/authorized intersection. Subject mismatch
  and an empty intersection fail with `403`.
- Keep FHIR token comparison coding-system aware and use returned
  `Composition.section` as the disclosed set.
- Preserve directly and transitively linked resources, including
  `Composition -> Consent -> DocumentReference`; exclude unrelated transport
  wrappers and never assign them to the first section of a multi-section IPS.
- Prove the contract with unit, HTTP integration, real SDK E2E and
  local-network gates. A BFF-only filter is not authorization evidence.

## Preserve shared-package neutrality

- Never place a product name, branded hostname, product route or product policy
  in GW CORE or a shared `gdc-*` package, including tests, examples, docs,
  comments and changelogs.
- Use neutral shared fixtures and enforce the rule with a repository check.
- Keep product-specific names and behavior only in the owning product repo.

## Release the complete change

Treat closure as one indivisible gate: one behavior or flow branch owns one
patch release, and no new fix or feature branch may start until the current one
has completed red-green TDD, every required no-skip test layer, changelog,
package and lockfile patch, branch commit and push, any required immutable npm
publication and clean-install verification, exact downstream pins, explicit
merge commit, pushed `main`, matching remote refs and a clean worktree.

When more than one reusable package changes, publish from the lowest changed
dependency upward. The next package or deployable consumer may be changed only
after the previous immutable version exists in the registry and its integrity
and exported surface have been verified.

1. Update the owning changelog with tested behavior. Shared changelogs remain
   product-neutral.
2. Run focused tests, affected integration/E2E tests, full tests, typecheck,
   build and neutrality/skill checks required by the repository. Enable every
   affected live E2E and reject a run containing `SKIP` before release.
3. Commit on the branch and push the branch.
4. Merge the reviewed branch into `main` with an explicit merge commit unless
   repository policy requires a PR merge. Push `main` and verify both remote
   refs and a clean worktree.
5. For a reusable bug fix, publish the next immutable patch version from a real
   TTY. Verify `npm view <package>@<version>`, integrity, the `latest` tag,
   clean registry installation and exported surface.
6. Pin deployable consumers to the exact registry version and update their
   lockfiles. Never substitute GitHub, `file:`, workspace or vendored tarball
   dependencies for a released package.
   When a product gateway is a long-lived fork of GW CORE or another gateway,
   never merge or cherry-pick the upstream release commit into the product
   branch. Start from a clean, current product `main`, inspect the exact
   upstream diff, and reproduce only the applicable semantic changes in the
   corresponding destination files. Preserve product-specific behavior,
   fixtures, documentation and deployment profiles; prove the port with the
   product's own tests and review its resulting diff before commit.
7. Verify the actual deployment/revision and live boundary before reporting
   completion.

Report separately: branch, commit, pushed branch, merge commit, pushed
`main`, package version/integrity, consumer pin, deployment and live result.

## Mandatory release authorization continuity

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

## Preserve legal organization and hosted-tenant boundaries

- A legal identifier addresses the neutral organization. It cannot select one
  hosted sector/provider tenant when that organization has several.
- Registration and lifecycle operations select the exact tenant with legal
  identifier type/value plus its public DID in `Organization.sameAs`.
  Identifier-only compatibility is allowed only for exactly one match;
  ambiguity is `409 Conflict`.
- Store the current sector/provider binding through the existing `artifact-sc`
  contract on the identity-zone channel. This is a GW payload change and never
  authorizes chaincode, CCAAS, policy or Fabric lifecycle mutation.
- An asynchronous SDK validates the initial submit before polling. A submit
  non-2xx is terminal: preserve status, body, `OperationOutcome` diagnostic and
  `Location`, and perform zero polls. Never replace an initial `401` with a
  later poll `404`.
