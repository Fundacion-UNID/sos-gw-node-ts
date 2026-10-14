---
name: govern-digital-twin-consent
description: Implement or audit the FHIR Consent, IPS projection, pseudonymous subject, disable and provider-offboarding contracts for Digital Twin flows across GW CORE and gdc-sdk-node-ts. Use for secondary-use permit or deny, HRESCH claims, stable Consent identifiers, individual Communication ingestion, direct digitaltwin Composition routes, twin urn:uuid validation, study-specific consent separation, materialization, purge, 101 docs, tests, SDK releases, or cleanup of erroneous research-index records.
---

# Govern Digital Twin Consent

## Mandatory TDD

Use red-green-refactor TDD for every behavior or flow change. Write and run the smallest executable contract test first; it must fail for the intended reason before implementation begins. Then implement the minimum change and make focused, integration and affected end-to-end tests green. Begin every new or modified test suite with a flow-contract comment. Begin every Playwright or other E2E file with the complete numbered journey and its authorization and persistence invariants. Mocks may isolate units but never replace real boundary proof. Never make a test green by accepting an error, placeholder, pending setup or other incomplete terminal state.

## Read before acting

Read the current files in both repositories:

- GW CORE:
  - `AGENTS.md`
  - `docs/01-OVERVIEW-AND-GUIDES/101-01.I-LIFECYCLE.md`
  - `docs/90.F-UC_CAPABILITY_MATRIX_SEDIA.md`
  - `src/utils/consent-storage.ts`
  - `src/utils/digital-twin-secondary-use.ts`
  - `src/utils/digital-twin-research-projection.ts`
- Node SDK:
  - `docs/101-DIGITAL_TWIN_SDK.md`
  - `tests/101-digital-twin-sdk.test.mjs`
  - `src/digital-twin.ts`
  - `src/resource-operations.ts`
  - `src/orchestration/individual-controller-sdk.ts`

Verify current branches, versions and published npm state before release claims.

## Preserve the application contract

- Accept only the product-level browser choice `{ enabled: boolean }`.
- Resolve the authenticated subject, index-provider organization and enrollment state in the BFF. Never accept them from browser JSON.
- Keep portal facade names product-neutral: `/subject` owns the individual,
  `/research` owns researcher operations, `/host/*` owns host administration
  and `/test-network/*` owns Test Network governance. Product-branded paths are
  compatibility aliases only. Domain profiles may specialize `individual`
  without changing the consent or twin contract.
- Call `IndividualControllerSdk.setDigitalTwinSecondaryUseConsent(...)` with `decision: 'permit' | 'deny'`.
- Author one FHIR `Consent` through `resource.meta.claims` and `entry.meta.claims`:
  - `Consent.subject`: authenticated operational subject DID
  - `Consent.actor-identifier`: organization/tenant that provides the subject index
  - `Consent.actor-role`: `*`
  - `Consent.purpose`: `HRESCH`
  - `Consent.action`: canonical `ServiceCapability.DigitalTwinReader`
- `Consent.decision`: `permit` or `deny`
- `Consent.source-reference`: stable portal/software/study URL or URI
- Do not add an ODRL attachment to this provider-level secondary-use Consent.
- Do not introduce `researchOrganizationDid` into the patient toggle. Distinguish each portal, software product or study with its own `Consent.source-reference`.

## Resolve the Consent from its application/study reference

- The BFF passes `researchUseReference`, a stable URL or URI identifying its portal, software product or study.
- GW resolves the rule by subject, index provider, HRESCH, DigitalTwinReader and `Consent.source-reference`.
- GW alone assigns and reuses the internal `Consent.identifier`; the BFF never generates, stores, sends or receives it.
- Reusing the same source reference updates one rule. A different source reference creates a separate FHIR Consent.
- Status lookup must include active deny rules; "active" is validity/period state and must not be confused with `decision=permit`.
- Read status through an individual `Communication` carrying
  `Subject/_search` FHIR Parameters for subject, index provider, HRESCH,
  DigitalTwinReader and source reference. Match canonical or contextualized
  FHIR claim keys. Consent is not part of clinical
  `Bundle/_search`, and the individual Subject is not a twin ResearchSubject.

## Keep projection separate from consent

- Ingest the operational IPS through the existing individual `Communication/_batch` flow, normally via `ingestCommunicationAndUpdateIndex(...)`.
- Let GW create or refresh the research projection when consent is `permit`.
- Absence of an explicit permit is disabled; never project by default.
- Create one canonical Composition per IPS document/version with all IPS sections. Never create one Composition per section.
- Assign the twin subject only inside GW from its tenant-private alias as a registered `urn:uuid:<uuid>`.
- Reject operational DIDs, caller-invented UUIDs and unregistered UUIDs on canonical research records.
- Never teach a patient portal to submit an IPS Bundle or canonical Composition to `digitaltwin/.../Composition/_batch`.
- Treat the direct Composition batch only as explicitly scoped adapter/compatibility plumbing for a pre-authorized registered twin; keep it outside the portal 101.

## Preserve consent-scoped operational summaries

- Enforce the authenticated `organization/Composition` SMART subject and
  section constraints while materializing `Subject/$summary`.
- Omitted application section filters inherit authorization; explicit filters
  are narrowed to the requested/authorized intersection. Reject subject
  mismatch and empty intersection with `403`.
- Let returned `Composition.section` describe disclosure and preserve its full
  direct/transitive document graph. Exclude unrelated Communication
  attachment/index wrappers from section-limited summaries.

## Preserve MVP discovery and organization authorization

- Treat `/{tenantId}/cds-{jurisdiction}/{version}/{sector}/{section}/{format}`
  as one exact native FHIR server base. Publish its CapabilityStatement at
  `[base]/metadata` and SMART discovery at
  `[base]/.well-known/smart-configuration`; derive advertised resources from
  the matching tenant DID services and never combine `individual`,
  `digitaltwin`, R4 or R5 capabilities.
- `org.hl7.fhir.api` is the claims-first context, not a native FHIR release.
  Keep canonical SearchParameter claims, standard extensions and custom
  extensions distinct; call non-standard extensions custom, not GDC-owned.

- Use one public search contract for discovery and saved selections:
  `digitaltwin/.../ResearchSubject/_search` with a FHIR `Parameters` body.
- A ResearchSubject is the public twin aggregate. Its `composition` declares
  `resourceType: "Composition"` and is the canonical Composition GW uses to index it and connect its
  projected resources; do not expose `Composition/_search` as the app contract.
- `saveSelection(...)` selects a ResearchSubject. Its private persistence may
  use a researcher-owned Composition, but `searchSelections(...)` reopens it
  through the same public `ResearchSubject/_search` route.
- For employee-specific selections, search with `section` plus
  `Composition.meta-tag`; the SDK binds `Composition.author` to the employee
  DID and GW verifies it against the authenticated SMART `sub`.
- The default SMART reader scope is
  `organization/ResearchSubject.rs?subject=*`; the SDK also completes an
  explicitly supplied bare `organization/ResearchSubject.rs` to that form.
- Basic search accepts one or more IPS section tokens, inclusive `date-from`,
  optional inclusive `date-to`, and non-empty `text`.
- Sections use OR. Text and date use AND and must match the same clinical
  resource. Resolve an omitted end date to GW current time.
- A section may map to several resource families. Never require the BFF to
  choose or know a resource type for basic search.
- Append private derived text/date/language properties to the same projected resource record
  during projection. They are not a separate collection or a
  second index, and `__digitalTwinSearch.*` is never a public FHIR claim family.
  Consume those properties only for Composition-wide matching and strip them
  from search matches and materialized resources.
- Preserve `<Resource>.code = system|code`, selected `code-display`, confirmed
  local `code-text` and language in the permitted projection as source
  terminology evidence. Consumers must not treat either label as authoritative:
  DataConv re-resolves standardized terms and configured translations from the
  code while retaining submitted labels as provenance. A UI or assistant uses
  confirmed local text only when its language matches; otherwise it resolves the
  requested language through the terminology service and falls back to the
  re-resolved international display. An absent or unsupported code leaves the
  submitted label as unstandardized review evidence, never an invented official
  translation. Bare envelope `status` remains distinct from namespaced clinical
  claims such as `Observation.status`.
- Keep age range and host-wide aggregation out of the MVP.
- For a tenant DID created before ResearchSubject became the public aggregate,
  accept its existing read-only digitaltwin Composition `_search` declaration
  as authorization for replacement `ResearchSubject/_search`; do not require
  tenant reactivation or DCR and do not widen mutation authority. Startup
  reconciliation must publish the canonical route, remove obsolete
  resource-specific twin search routes and preserve unrelated custom services.
- Reconcile every persisted tenant's canonical sector service catalog at
  startup even without split-runtime overrides. Remove obsolete
  resource-specific twin search declarations and preserve unrelated custom DID
  services.
- Same-tenant access uses verified employee proof. Foreign access also needs a
  matching FHIR Contract VC and provider authorization.
- Recover the full hosted organization DID from both `:employee:` and
  `:member:` actor DIDs. A root `did:web` domain is only an alias/discovery
  identity and must not turn a same-tenant employee into a foreign consumer.
- Treat DID parsing only as routing evidence. Extract the VAT/tax tenant id,
  employee email-derived `z...` identifier and role from either the internal
  hosted form or the public `organization:(taxid|vatid):<VAT>` form; never use
  the hostname as organization authority or compare whole DID aliases.
- Same-tenant access additionally requires an active employee in the extracted
  tenant vault. Recompute `urn:multibase:z...` from that encrypted employee's
  normalized email, match the extracted role, and require the verified
  `EmployeeCredential.sameAs` to carry the same stable identifier.
- Emit signer roles `provider-authorized-signatory` and
  `consumer-authorized-signatory`; accept `provider-controller` and
  `consumer-controller` only as deprecated read aliases.
- Require two already-verified `contractAgreement` proofs over the same
  immutable Contract VC. `RESPRSN` proves technical tenant control, not legal
  authority to sign, unless a separate verified delegation explicitly grants it.

## Preserve lifecycle semantics

- `deny` is reversible disable: pause later synchronization, retain the private alias and freeze published anonymous data.
- A later `permit` reuses the alias and rebuilds from current operational data.
- `purgeDigitalTwinSubjectLink(...)` is provider offboarding only: delete the private operational-subject to twin correspondence, never anonymous research data.
- A later enrollment after purge receives a new twin UUID and cannot reconnect the old projection.
- Administrative cleanup of erroneous direct records must resolve the exact tenant, section, document ids and subject first. Delete only proven erroneous index records; do not represent cleanup as patient purge, and do not claim immutable audit anchors were erased.

## Preserve authored clinical deletion

- For the current direct `updateClinicalSummary(...)` call, set `sender` to
  the operational `ActorSession.actorDid` returned with the authenticated
  role-specific profile, never a stable multibase URN or a DID/alias owned by
  the portal. This applies equally to controller, member/caregiver and
  professional sessions. Set `recipient` to the real provider-tenant DID inside
  the host that accommodates that tenant, never the host DID or a portal alias.
  The subject remains the individual DID.
- To edit an imported IPS in a demo, first call
  `cloneImportedClinicalDocumentForDemo(...)` with the protected
  `clinicalCreator` export. The helper gives the copy new resource ids and uses
  stable FHIR author/attester references; session `actorDid` remains sender and
  it never rewrites the imported source document.
- For generated clinical content, resolve provenance from the authenticated
  protected creator binding. The closed `owner | creator` choice is
  compatibility only. A member/controller may use one registered RelatedPerson
  as both author and attester; a professional uses the jurisdictional CDS
  legal-organization URN as author and its registered PractitionerRole as
  attester.
- A member recording content created or dictated by the individual selects
  owner: the individual is author and the RelatedPerson is attester. A member
  creating the content selects creator: the RelatedPerson is both.
- Never accept an author/attester reference from UI input or infer it from the
  operational actor DID, DIDComm sender, DCR client or signing key.
- Permit correction versions from another registered member with the same
  individual owner and from an authorized tenant professional. Preserve the
  actual author/attester of the correction and keep delete exact-author only.
- Submit Communication-carried confidential versions as one sanitized
  primary-document `data[]` batch. Process every entry as an individual asset
  keyed by its resource CID in one transaction; never persist `fullUrl` or the
  confidential FHIR resource. Distinguish a local memory receipt from a
  real Fabric transaction id in tests, docs and release evidence.
- Keep clinical-evidence and consent-access ledger routing inside their GW
  managers. Derive the governed channel from trusted normalized domain context
  and select the canonical smart contract in code; never make a request, SDK,
  BFF or environment variable choose either name. Poison legacy routing
  variables in contract tests so an accidental override fails visibly.
- Preserve an imported external `urn:*` author as provenance only. The local
  importer cannot update or delete that record merely by repeating the URN.
- Authorize the existing version before replacing it: update accepts the exact
  author or the governed correction rules above; delete accepts only the exact
  author. Never overwrite first and attempt authorization afterwards.
- Use `Bundle.type = batch`; each entry independently selects `.create()`, `.update()` or `.delete()`. Do not turn this flow into a transaction.
- A typed delete addresses exactly `ResourceType/id`, has no resource body and may carry `.ifMatch(versionId)`.
- Store only the resolved owner or registered FHIR creator reference in
  `Composition.author`. Never store email, phone or their stable hashes there.
- At delete time, authorize the exact subject and creator. Resolve linked verified email/phone login channels from private identity metadata outside the resource, so phone-created and email-created data remain manageable after account linking.
- In that protected metadata, store the actor/member UUID, a distinct
  relationship or professional-assignment UUID, its owner and governed role.
  Operational DIDs, verified contacts, DCR clients and `kid` values are aliases
  only. Consent targets the assignment UUID plus its separate role. An
  assignment is the technical Occupation or relationship record; do not claim
  that GW manages employment/caregiver contracts, periods or renewals.
- Require an employee/member import or authorized onboarding record before DCR
  may link a stable creator binding. DCR can add its verified client, actor DID
  and public `kid` aliases to the exact existing binding; it cannot create or
  alter the actor UUID, assignment UUID, owner or role.
- At IPS export time, replace a locally stored operational author DID with the
  bound FHIR author reference and include RelatedPerson or
  PractitionerRole/Practitioner resources. Preserve unbound external source
  authors exactly; never rewrite author identity during direct ingestion.
- Remove the exact fact from later operational summaries and the synchronized research projection when enabled. This is neither secondary-use `deny` nor provider-offboarding link purge.
- Keep 101 documentation at application level: actor, subject, hosted
  provider-tenant recipient, typed batch entry, authorization result and
  visible summary behavior, without DIDComm rendering, vault, queue or hashing
  plumbing.

## Keep every artifact aligned

For any contract change, update together:

- manager/utility tests and route integration tests in GW CORE;
- SDK JSDoc and exported types/functions;
- executable `tests/101-digital-twin-sdk.test.mjs` showing that the BFF stores only its stable research-use reference;
- copyable snippets in `docs/101-DIGITAL_TWIN_SDK.md`;
- GW high-level lifecycle and SEDIA capability matrix;
- README public-surface inventory and changelogs;
- this skill in both repository-local copies.
- Cross-link and synchronize GW CORE
  `docs/01-OVERVIEW-AND-GUIDES/101-01.N-AUTHENTICATED-CLINICAL-AUTHOR.md`
  with Node SDK `docs/101-BFF_CLINICAL_WRITES.md`.

Search for stale claims before finishing, especially `researchOrganizationDid`, `secondaryUseClaimKey`, ODRL in the provider toggle, operational `Composition.subject`, one Composition per section, and portal calls to direct digitaltwin Composition batch.

## Verification

- Run targeted GW consent, projection and Composition route tests plus typecheck/build/Swagger when the GW contract changes.
- Run SDK build, product-neutrality, typecheck, executable 101 and full tests when the SDK surface changes.
- Confirm branch, commit, push and merge state in each changed repository.
- For npm, verify `npm view <package>@<version>`, `dist.integrity`, `latest`, a clean install and the exported public surface before declaring publication.
- For deployed cleanup or behavior, verify the exact target runtime tuple and
  never infer product identity from a legacy project, cluster or workload name.

## Mandatory release authorization continuity

Fail-fast order is unit and integration with `networkKind=test`, followed by a
real local UI -> BFF -> SDK -> GW/DataConv Playwright journey without blockchain.
An unpublished SDK uses an immutable `npm pack` tarball as temporary
`--no-save` local input without committing dependency or lockfile changes.
Publish only after the entire affected local matrix is green; then install the
exact registry version and run the minimal artifact smoke before
`local-network` and staging.
After a failure, resume at the smallest failed gate. Rerun predecessor gates
only when they create required state, the fix changes an earlier boundary, or
environment state is no longer trustworthy. Run the complete suite once at
branch closure.

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
  only the artifact smoke before its merge and staging.
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
