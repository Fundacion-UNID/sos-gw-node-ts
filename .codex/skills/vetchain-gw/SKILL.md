---
name: vetchain-gw
description: Preserve VetChain GW host identity, CA-BC routing, BN tenant semantics, canonical FHIR vocabulary, and GW VET-first selective promotion.
---

# VetChain GW

## Public department directory

- Route only `organization/org.schema/Organization` `_batch` and `_search` to
  `DirectoryManager`. Keep registry/legal onboarding Organization and
  individual Organization routes on their existing managers.
- Persist the normalized claims map through `protectConfidentialData` and
  protect governed search attributes before repository storage. Never persist
  a nested Schema.org or native FHIR Organization.
- A department has one stable aggregate HealthcareService projection. Offered
  Service records reference the department id; they are not separate senders.
- The department Organization can be the FHIR Communication sender. Its Group
  remains a private queue recipient and the authenticated employee/device is a
  separate transport actor.

## Mandatory TDD

Use red-green-refactor TDD for every behavior or flow change. Write and run the smallest executable contract test first; it must fail for the intended reason before implementation begins. Then implement the minimum change and make focused, integration and affected end-to-end tests green. Begin every new or modified test suite with a flow-contract comment. Begin every Playwright or other E2E file with the complete numbered journey and its authorization and persistence invariants. Mocks may isolate units but never replace real boundary proof. Never make a test green by accepting an error, placeholder, pending setup or other incomplete terminal state.

Use this skill for VetChain gateway configuration, animal controller/member
flows, deployment profiles, or promotion to GW UNID/GW CORE.

Read [`SYNC.md`](../../../SYNC.md) before promoting a VetChain change. Treat
VetChain as the proving ground, but review GW, Personal, Professional and
telephone/YAML counterparts together. Port only shared invariants with UHC
differential tests; keep animal and human product policy separate.
Every candidate fix originating in CORE, UHC, SOS or another product enters
this Vet-first review before its source branch is considered closed. Record the
source commit and disposition, prove applicable shared behavior in Vet, then
fan it out deliberately. `Not-applicable` requires a written product boundary;
silence, a newer version number or a repository-wide cherry-pick is not proof.

For legal-organization verification, consume the sector/country contract from
`sos-data-utils-ts`. CA/US `animal-care` applications bind the immutable PDF to
an outbound OTP delivered to the existing marketplace organization's official
telephone; confirmation may be web or telephone. Do not copy the human-health
postal-only ceremony. Legal organizations use `Organization/_transaction`,
while `Order/_batch` follows only a newly returned host Offer. The later DCR
activation code is independent.

For continuity-service onboarding, consume the provider capabilities and
`ServiceOfferingRole` from
`sos-data-utils-ts/continuity-service-capabilities`. Keep `index`,
`personal-backup` and `digital-twin` independently selectable. The
organization form/PDF has separate index and personal-backup checkboxes; the
individual selection fields are `selectedPersonalIndexServiceOffer` and
`selectedPersonalBackupServiceOffer`. Personal backup primarily advertises
`organization/DocumentReference.cruds`; advertise its ImagingStudy or Binary
capability only when those runtime operations exist. Never infer backup from
index, expose index resources to a backup-only tenant, or duplicate the shared
capability literals in a product SDK.

## Host tenant and governance contract

- Keep the neutral legal organization identity separate from each hosted
  sector/provider tenant. The official identifier type and complete value find
  the legal organization; the exact public tenant DID in
  `Organization.sameAs` selects one sector/provider binding.
- When a legal identifier has more than one hosted tenant, lifecycle requests
  without the exact `Organization.sameAs` fail with `409`; never select the
  first repository match. Identifier-only compatibility is valid only for one
  unambiguous tenant.
- Store the current sector/provider binding through the existing `artifact-sc`
  contract, using a stable sector/legal asset id and the tenant DID/provider as
  its replaceable value. Registration and enable mark it `validated`; disable
  and purge mark it `revoked`. `artifact-sc` history preserves rotations. This
  does not add or modify a chaincode, package id, endorsement policy or CCAAS.

- ConnectHealth's own host `tenantId` is exactly `704457076`.
- It is a Canadian Business Number: type `BN`, never `VAT`.
- Never prepend or append country, subdivision, identifier type or sector to
  `tenantId`.
- Legal name is `CONNECTING SOLUTION & APPLICATIONS LTD.`.
- Technical host operator is `cto@connecthealth.info`; this is not a legal
  representative or the veterinary admission controller.
- Tenant/API jurisdiction is `CA-BC`, producing `cds-CA-BC` organization routes.
- Host discovery coverage is UN M49 `001` (World), producing the current
  `/host/cds-001/...` route independently of every tenant's ISO jurisdiction.
  A future partner may advertise one or more M49 regions (`002` Africa, `019`
  Americas, `142` Asia, `150` Europe or `009` Oceania). That multi-region routing is future work and must not be implied by the current single-scope runtime.
- Certificate country is `CA`; subdivision/region is `BC`.
- Operator hostnames and root DID domains are private environment-specific
  deployment configuration. Public skills and examples must not contain their
  literal values or deprecated aliases. Production IP and Kubernetes resources
  remain separate from staging and must be provisioned explicitly.
- `GW VET` names the software profile. Kubernetes resources name the
  environment-specific ConnectHealth veterinary host; DNS names must not be
  reused as deployment-resource identities.
- The human-health operator profile is separate; it does not turn the
  veterinary host into a human-data host or replace the FUNDACION UNID EMEA
  host. Resolve each approved identity from private deployment configuration.
- `onehealth-research` is a permitted sector in both GW VET and GW UNID; it is
  never part of either tenant id. In VetChain it may be used by ConnectHealth's
  own tenant for Digital Twins only after separate governance and exact-subject
  Consent; an `animal-care` licence never grants it.
- Antifraud Foundation governs veterinary-organization admission through a
  separate tenant. Its technical controller is `cto@antifraud.online`; its
  legal representative and tenant legal identifier must be independently
  evidenced and must not be invented or replaced with ConnectHealth's BN.
- The billing merchant remains a separate, currently unassigned role.

## Change workflow

1. Before changing inherited gateway behavior, inspect the current GW CORE
   `CHANGELOG.md`, the changelogs of every pinned `gdc-*` dependency, and the
   corresponding focused source/tests. VetChain version numbers are independent
   from GW CORE versions and do not prove fix parity. Record each applicable
   security/protocol fix as ported, already equivalent, product-inapplicable or
   still blocked; never infer parity from a newer VetChain package version.
2. Close grouped functional branches on `main` with their changelog and clean,
   matching refs, without versioning or publishing each branch. Run the full
   cumulative matrix when the group is ready; version on a release branch,
   merge and push it to `main`, then publish only that exact pushed commit.
3. Implement and test in `vet-gw-node-ts` first.
4. Enforce `test -> local-network -> test-network -> network` for every portal.
   The first proof must use normal local UI routes through the real BFF,
   high-level SDK and this GW with `networkKind=test`, in memory and without
   blockchain. Fixture pages, route mocks, API-only Playwright or separate
   UI/GW tests do not satisfy it.
5. For organization registration run `npm run test:organization-registration:local` before building an image. It must reconstruct queue, managers, cache and KMS over persisted pending state between transaction and Order; same-process and mocked decode tests are insufficient.
6. If Fabric or another ledger boundary is affected, run `npm run docker:smoke:local-network` only after the real local portal gate and before Test Network. Staging repeats the journey after deployment and is never the first UI, SDK, Offer/Order or restart proof.
7. Publish a changed shared-package chain from the lowest dependency upward,
   verify each immutable registry release, then pin exact versions and lockfiles
   in every consumer before its tests. Local source cannot substitute for a
   missing published dependency.
8. Keep animal-specific behavior in GW VET.
9. Port human-applicable behavior deliberately to GW UNID.
10. Port only neutral infrastructure/security behavior to GW CORE.
11. Never copy a dirty worktree or blindly synchronize repositories.
12. Verify the live endpoint and effective runtime configuration before
   claiming deployment success.
13. Keep exactly one generic root template for each supported tier: test, demo,
    local-network and staging, with placeholders rather than credentials.
    Runtime `.env*` files stay ignored, and
    `check:environment-template` must run before unit, integration and E2E
    suites; never weaken this gate to make a release pass.

## Explicit lifecycle API contract

- The canonical product/domain term is **Individual Organization** (more
  precisely, an individual family organization). `Family*` class names, route
  labels and wire values are legacy compatibility vocabulary only. Never use
  "family" as a separate canonical resource or expose it as the current model
  in new UI copy, JSDoc, tests, snippets or high-level documentation.
- For an animal Individual Organization, the first `Organization.member` is
  the animal subject itself and its HL7 relationship is always `ONESELF`.
  `Organization.owner` is the authenticated creating controller by default;
  controller `RESPRSN` authority must never be written as the SELF member role.
- Missing `alternateName`, exact NCBI taxonomy in
  `Organization.member.additionalType`, or public Card `sameAs` keeps the
  record `pending`. It is a resumable draft: issue no Card, create no clinical
  Composition and reject its Order activation. These animal-only rules live in
  GW VET and must not be copied into GW CORE.

- Never implement or retain a routable action that is absent from generated
  OpenAPI. Add route JSDoc, Swagger, a canonical payload imported from
  `gdc-common-utils-ts/examples`, unit proof, integration proof and high-level
  SDK documentation together.
- Never expose `_disable-descendants` or `_purge-descendants`. Never accept a
  wildcard id. A controller must address every authorized resource explicitly.
- Legal-organization workers use bounded `Employee` Bundles. The current
  compatibility route is `Employee/_batch` with `entry.request.method =
  DELETE` for soft disable, followed by `Employee/_purge` with explicit ids.
- Individual-organization members use bounded `RelatedPerson` Bundles with an
  explicit resource id per entry: `RelatedPerson/_batch` for disable and
  `RelatedPerson/_purge` for purge. The individual organization itself uses
  its own `Organization/_disable` and `Organization/_purge` operation.
- Search first, page through results, and submit bounded batches. The
  portal/BFF or external management tool owns pagination, chunking, retry and
  partial-result UX; the GW validates authorization and transition rules per
  entry and never discovers an implicit "all" set.
- Describe Employee `DELETE` precisely: the Bundle method follows a FHIR
  request shape, while mapping it to inactive soft-delete is a transitional GW
  lifecycle profile, not native FHIR behavior. Disable preserves the employee
  record and licence seat. Purge requires inactive state and releases or
  disassociates the seat while preserving the required audit record.

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

## Secure profile-enrollment boundary

- A cardless telephone bootstrap has no registered DCR profile. VetChain
  staging therefore uses authenticated `SECURITY_MODE=compat` with native FHIR
  JSON and canonical DIDComm plain enabled, generic JSON disabled and insecure
  bearer disabled. Owner-directory and draft lifecycle operations must bind
  every requested owner contact to the verified bearer stable identifier.
- PetChain web and VetChain telephone are independent DCR device profiles.
  Each has its own `client_id`, `kid`, wallet seed and custody envelope; GW may
  bind both to the same controller but they never copy or split a private seed.
- A registered DCR profile uses encrypted DIDComm form transport. Failure to
  reconstruct its exact registered wallet is terminal; never downgrade it to
  the cardless compatibility carrier.
- An external veterinary system may use native FHIR JSON over TLS with its
  authorized OAuth/SMART identity. Native FHIR changes the representation, not
  the clinical author, attester or authorization. Animal-owner association and
  contact/location data remain personal information.
- Transport is selected once by the trusted BFF/GW composition root and reused
  for submit plus poll. A browser, voice field, payload or retry cannot select
  a weaker carrier.
- `SECURITY_MODE=compat` applies to the complete deployed GW instance. The
  staging setting is temporary integration scope and must not be promoted to
  production as a substitute for a route-scoped bootstrap/EHR endpoint.

- A root host `did:web` always resolves at `/.well-known/did.json`. Keep the
  CDS-scoped host discovery surface as an additional product route; never make
  an SDK or portal guess that route from a root DID.
- Keep the VetChain `test` topology isolated: GW `3200`, ICA `3210`,
  break-glass test receiver `3220`, PetChain `3281`, Professional `3282`,
  Firestore `3285`, Firebase Auth `3292` and GW readiness `3299`.
- Keep transport identity roles explicit: DIDComm `from` is the sender DID,
  JWT `iss` is the signing entity, `kid` is the concrete signing-key DID URL,
  and SMART `sub` is the authorized animal controller or professional. A
  direct flow may reuse one actor DID across `from`, `iss` and `sub`, but the
  roles do not collapse.
- Native FHIR adapters receive `Communication` or `Bundle`, never DIDComm
  identity fields. HTTP Authorization proves the caller and
  `Communication.sender` remains a FHIR business participant reference.
- Final local release evidence registers and executes every selected live E2E
  journey with zero skipped cases before image construction or staging.
- An asynchronous submit/poll HTTP `200` proves only that polling completed.
  Every positive integration, SDK and Playwright journey must parse the
  terminal Bundle with the shared high-level reader, require zero error
  `OperationOutcome` issues and require the expected successful operations.
  Negative journeys assert the exact expected OperationOutcome. Never accept a
  nested error as a green test.
- Inspect the initial asynchronous submit response before polling. A non-2xx
  submit, including `401`, is terminal: preserve its status and first FHIR
  OperationOutcome diagnostic and perform zero poll requests. Polling after a
  rejected submit can only manufacture a misleading secondary `404` because
  no job was created.
- Individual Organization registration returns one canonical organization id. That
  same id owns the controller and member licence seats and is the
  `ownerOrganizationId` used by high-level SDK member operations; never mint a
  second private id or infer it from a route alias.

- Portal and BFF code calls the high-level SDK profile-enrollment facade; it
  never constructs JOSE, worker jobs or verified-token projections.
- Encrypted transport and a nested signature are separate proofs. The API
  facade verifies the JWS whenever a signed request is received.
- An embedded signing JWK is bootstrap material only for the ordered
  pre-DCR `Token/_exchange`, first `Device/_dcr`, and the historical
  `_activate` compatibility flow. It proves key possession, never controller
  authority. Exchange still requires the independently verified account
  bearer and one-use activation licence; DCR requires its initial access token.
- Organization admission keys must match the reviewed controller evidence;
  pre-DCR Order keys must match the protected pending Offer; established
  actors resolve their persisted signing keys.
- For an established DCR actor, keep three proofs independent: the OIDC
  provider verifies the account/contact, the canonical professional DID embeds
  only that contact's stable hash, and the registered device profile supplies
  the public communication keys. A provider-local OIDC `sub` is not the DID;
  authorize it only when an exact DID subject or verified email/phone stable
  identifier matches the signed actor. Never copy an HMAC secret or accept an
  envelope JWK to bridge those identities.
- `Device/_dcr` and every later registered-key lookup must derive the same
  sector-scoped logical tenant vault before calling any repository adapter.
  The unscoped `host` vault stores host configuration; it is not a fallback
  for a tenant controller's device profile. Apply this rule identically to
  Firestore, PostgreSQL, memory and future adapters, and promote it to CORE.
- For a host-routed commercial `Order/_batch`, the controller DID may carry an
  official organization identifier instead of the tenant alternate name.
  Resolve that identifier through the canonical tenant registry before reading
  DCR custody; a missing direct vault must never silently redirect the lookup
  to the host configuration vault.
- Treat the shared path segment as `businessSectorOrNetworkKind`: it is a
  business sector on tenant routes and the exact `networkKind` on host routes.
  Never alias `test` to `test-network`; the ordered stages are `test`
  (in-memory), `local-network`, `test-network`, and `network`.
- `_activate` remains distinct from DCR and must retain its historical route
  behavior while valid signed requests gain integrity verification.

## Canonical FHIR and Schema.org vocabulary

- The native FHIR server base is
  `/{tenantId}/cds-{jurisdiction}/{version}/{sector}/{section}/{format}`.
  Publish its CapabilityStatement at `[base]/metadata` and SMART discovery at
  `[base]/.well-known/smart-configuration`; derive both from the matching
  veterinary tenant DID service selectors. Never combine `individual`,
  `digitaltwin`, R4 or R5 capabilities.
- `org.hl7.fhir.api` is the claims-first context, not a native FHIR release.
  Keep canonical SearchParameter claims, standard extensions and custom
  extensions distinct. Call non-standard extensions custom, not GDC-owned.
  Native create and card-display adapters follow the fields and value sets of
  the applicable IPS profiles.

- Use versionless FHIR `POST Patient/$match` as the public PDQm-style alias for
  exact animal/person resolution. The caller sends one original identifier
  (for example an ISO 11784/11785 chip) with `onlyCertainMatches=true`; it
  never sends the locally derived alias/hash. Standard optional controls such
  as `count` stay optional.
- The public subject-identifier ledger maps that opaque derived alias only to
  `indexProviderDid`. It never carries a public card, subject kind, numeric
  provider id, provider domain or private identifier. The selected provider
  authenticates the caller and resolves the original identifier privately.
- A successful identity match grants no contact action or clinical read.
  Consent, SMART scopes and break-glass policy remain separate authorization
  gates for those subsequent operations.

- Never invent a Schema.org property or type. Never invent a FHIR resource,
  property, lifecycle value, claim namespace or SearchParameter that looks
  standard. Resolve the exact name and value against the declared official
  schema/FHIR version and the shared common-utils catalog before coding.
- FHIR SearchParameter names retain the official lowercase/hyphenated API
  spelling. A local UI field or TypeScript property is not evidence that a
  corresponding FHIR SearchParameter exists.
- Treat R4/R5 differences explicitly. If the chosen version genuinely lacks
  the required concept, use a reviewed extension with a governed canonical URL
  and document its mapping; never create an unregistered pseudo-resource or
  flat namespace as a shortcut.
- A professional permission request is a FHIR `Communication` whose attachment
  is a Bundle of `Consent.status = draft` resources. There is no
  `AccessRequest` resource or `AccessRequest.*` namespace. Draft Consent is
  inbox data and must never authorize; only `active` Consent may participate
  in rule evaluation.
- Add a red regression before implementation that proves invented vocabulary
  is absent and non-active Consent cannot authorize. Keep the exact standard
  shape visible in JSDoc, 101 snippets, OpenAPI examples and test comments.
- Claims-first Encounter, ServiceRequest, Task and CommunicationRequest writes
  receive a GW-authored content version in
  `<ResourceType>.meta.versionId`. Search returns that protected flat claim;
  every `PUT` must echo the preceding value as a weak `request.ifMatch` ETag.
  Reject a stale ETag with 412 and do not write. Treat the version as
  server-owned concurrency metadata, not a FHIR SearchParameter or a
  browser-authored business claim.

## Veterinary digital-twin search contract

### ResearchStudy SMART import boundary

- Keep the professional and organization-controller grants distinct. A
  DCR-bound professional with active study Consent receives exact
  `organization/ResearchSubject.crus?study=ResearchStudy/<id>`; the current
  controller may receive only
  `organization/ResearchSubject.c?study=ResearchStudy/<id>`.
- For controller create, require a verified ServiceControllerCredential, bare
  `RESPRSN`, exact tenant binding, current tenant DID controller membership and
  an existing claims-first ResearchStudy. Never add the controller as a party,
  fabricate professional Consent or label its `sub` as a professional.
- Read the canonical ICA tenant binding from schema.org
  `provider.identifier.value` and compare `owner.sameAs` with the stable
  `urn:multibase` derived from the current controller DID. Accept historical
  `provider.taxID` and full-DID `sameAs` only as compatibility forms; every
  form must still bind the exact tenant and current controller.
- ICA activation proves the DataConv tenant separately. It never substitutes
  for GW SMART authorization. A downstream RFC 8693 exchange must retain the
  actor and exact study scope.
- Workbook bytes do not pass through GW. Do not define
  `RESEARCH_WORKBOOK_MAX_BYTES` or implement multipart-size policy here; that
  shared setting belongs only to the portal/BFF and DataConv boundaries.
- The resource/filter grammar can be reused later for appointment scopes, but
  this research grant confers no scheduling authority. Appointment operations
  need separate actor, clinic, practitioner and location policy tests.

- Ingest native FHIR only through the individual `Communication/_batch` flow;

- Ingest native FHIR only through the individual `Communication/_batch` flow;
  GW derives private search fields and preserves one canonical Composition per
  IPS document/version. Direct canonical writes remain forbidden.
- The public twin and saved-selection discovery route is
  `digitaltwin/.../ResearchSubject/_search`. Preserve the representation
  boundary: `org.hl7.fhir.api` is claims-first and may mix
  `ResearchSubject.*` plus `Composition.*` under the same
  `resource.meta.claims` with `@context: org.hl7.fhir.api`; R4/R5 translate
  those claims into versioned resources and place the canonical Composition
  in `ResearchSubject.contained[]`. Never emit the ad-hoc
  `ResearchSubject.composition` property, never expose `meta.claims` as native
  FHIR metadata, and never split one aggregate into unrelated resources.
- A historical `Composition/_search` DID service authorizes only the replacement
  `ResearchSubject/_search` read. Reconcile the current service catalog at
  startup, remove obsolete resource-specific twin searches and preserve
  unrelated custom services without tenant reactivation or DCR.
- Consent status lookup remains on the individual side: a `Communication`
  carries `Subject/_search` Parameters for subject, index provider, `HRESCH`,
  reader action and source reference. `Subject` is never a Digital Twin type.
- Basic search is a FHIR `Parameters` resource with repeated `section`,
  non-empty `text`, inclusive `date-from`, and optional `date-to`. Sections are
  ORed; text and date are ANDed on the same resource. Missing `date-to` means GW
  current time.
- Do not let browsers supply flat claim names. UI sends section, selected
  resource types, text, `dateFrom` and optional `dateTo`; shared utilities and
  SDK builders derive the Parameters array.
- Canonical MVP search does not accept a caller-supplied `code-text` filter.
  Native FHIR terminology display and local terminology text may feed private
  text matching, while language remains explicit on the clinical resource.
- Keep research-summary terminology and storage boundaries explicit. The
  operational record and its permitted research projection retain canonical
  `<Resource>.code = system|code`, selected `code-display`, confirmed local
  `code-text` and language as source terminology evidence. Consumers must not
  treat either label as authoritative: DataConv or the research terminology
  boundary re-resolves standardized displays and configured translations from
  `system|code`, while preserving the submitted values as provenance. Arbitrary
  notes, instructions and identifying narrative remain subject to anonymization.
  A UI or assistant uses confirmed `code-text` only when its language matches
  the requested language; otherwise it resolves that language from `system|code`
  through the terminology service and falls back to the re-resolved international
  display. If the code is absent or unsupported, show the submitted label as
  unstandardized review evidence; never manufacture an official translation.
  Persistence envelopes, audit state and private query helpers never become
  FHIR claims or public text. Bare envelope `status` is not the same property
  as namespaced `Observation.status` or `MedicationStatement.status`.
- Prove that contract in both `org.hl7.fhir.api` and native FHIR materialized
  summaries. Unit tests inspect exact claim filtering; integration tests ingest
  a veterinary document with an animal subject and verify `ResearchSubject/$summary`.
  Do not reuse a human IPS Patient fixture as the veterinary proof.
- For same-tenant professionals, extract legal tenant id, stable email hash and
  role from internal hosted or public organization DIDs, then require the
  matching active employee. Never compare host aliases or complete DIDs as the
  organization membership test.

## Shared commerce and controller security

- First-time encrypted `Organization/_transaction` runs before DCR. Accept its
  communication keys only from the exact reviewed `resource.controller`
  binding, verify the detached signature, and persist the verified public keys
  plus sender DID inside the protected pending Offer. `Order/_batch` must match
  that same DID and key ids; never require a fictional prior DCR client or
  trust an arbitrary envelope JWK.
- Resolve a tenant's legal route jurisdiction from matching ISO 3166-2
  `Organization.address.addressRegion` when present, otherwise from ISO 3166-1
  `addressCountry`. Use that result consistently for collection, URN, hosted
  DID and operational routes while preserving the country as separate address
  evidence.

- VetChain `animal-care` professional seats cost USD 0 through 2026-12-31.
- Professional seat purchase is still an explicit commercial lifecycle at
  zero price: call the high-level controller SDK Offer operation, then confirm
  its exact identifier through Order. The controller supplies quantity/class;
  GW authors price, currency, payment method, identifier and serial numbers.
  Never replace this with `License/_add`, a browser-authored Offer, direct
  route plumbing or shared portal/host key material.
  From 2027-01-01 the intended price is USD 20 per user/month with a two-seat
  minimum and five registered devices per user. Fail closed for paid offers
  until the billing merchant, tax/terms and payment adapter are configured.

- `Offer -> Order/_batch -> seat inventory -> Employee/_batch` is shared
  across CORE, UNID and VET. Stripe or another regional payment service is an
  adapter selected by the host deployment, not a fork of the licence contract.
- The public organization-role licence stores the bare official identifier,
  canonical sector policy and optional positive `maxDevices`; omit
  `maxDevices` when the GW policy owns that limit. Never publish DCR client or
  installation bindings in this Fabric asset. The GW keeps and enforces those
  bindings in its protected device-licence state.
- After DCR, verify controller `iss + kid` with the stored tenant key. A
  public JWK in the JWT header or DIDComm-plain metadata is optional.
- Route the professional Order through `host`, but resolve controller keys
  from the issuer tenant. Test this with a historical host catalog that omits
  `Order`, otherwise the staging 404 regression is invisible.
- A host-authored onboarding Offer uses the configured VetChain host legal
  jurisdiction, never the applicant country. Keep the pending Offer resolvable
  until mandatory ledger writes succeed and preserve its index on the active
  tenant so an Order retry is deterministic.
- A partial organization ledger commit accepts a newly detached-signed VC only
  when canonical issuer, type/schema, `credentialSubject` and evidence remain
  unchanged. Reissued envelope metadata is retry-safe; a changed veterinary
  organization identity remains a 409 conflict.

## Organization onboarding assurance

- Before exercising automatic staging admission, run
  `bash deploy/vetchain/check-staging-admission-trust.sh`. It must prove the
  exact host issuer and one active `RESPRSN` signer with a pinned public JWK
  thumbprint. External portals, hosts and hosted tenants never share HMAC
  secrets; reject `allowHostAttestedKeys` and reject the attestation-secret
  environment entry. Never print or commit the signer member id. A failed
  bridge check requires deployment repair, not deletion or re-enrollment of an
  applicant, PIN, wallet or credential package.
- If host tenant bootstrap stops after creating its Offer, resume the same
  Offer through the OIDC-authenticated JSON `Offer/_search` read and then
  submit its normal `Order/_batch`; do not create another tenant identity.
  Firestore records are JWE-only at rest, so the authorized host reader opens
  the JWE before projecting Offer/Order claims; never depend on an optional
  in-memory `meta.claims` copy. Older pending records may not carry every
  protected search attribute: an empty indexed lookup falls back to the
  host-authorized section scan and exact post-decryption claim filtering. In
  `/host/.../Offer|Order/_search`, `host` is only the routing sentinel and must
  never become an implicit tenant identifier filter.
- Bootstrap the host legal person's initial operational tenant through the
  normal Offer/Order flow. When its identifier type and value exactly match
  the configured host identifier, tenant finalization must not submit a second
  Fabric organization; this is a duplicate-write guard, not a new identity or
  a general ledger bypass.
- Model registry material as organization identity evidence added by an
  authorized organization controller, parallel to controller-added individual
  identity evidence.
- Implement and prove this contract in VetChain first; only then classify it
  for deliberate promotion to GW UNID or GW CORE.
- Treat an official registration URL as registry provenance, not proof of
  applicant control.
- Keep registry observation, representative-certificate PDF signature and
  postal verification as separate cumulative evidence levels.
- OrgBook/BC Corporate Registry is suitable for BC registration evidence.
- Do not describe an EIN as publicly verifiable through a universal IRS URL;
  use an applicable registry or an authorized IRS matching/document flow.
- For Spain, distinguish BORME/Registro Mercantil evidence from an AEAT census
  certificate and from the representative signing certificate.
- Persist source, jurisdiction, identifier type/value, observed status and
  verification timestamp plus controller/action audit reference without
  changing `tenantId`.
- The controller may submit or withdraw evidence but may not self-assign its
  verifier status.

## Animal individual authority

## Authored clinical batch deletion

- Keep `Communication.sender`, `Composition.author` and resource-specific
  actors such as `Observation.performer` independent. A self-authoring flow may
  use the same registered actor for sender and author, but that equality is not
  a general rule.
- A section-scoped create carries the protected SDK projection in the attached
  Bundle metadata: organization author plus PractitionerRole attester for a
  professional; animal-owner author plus RelatedPerson attester for dictated
  personal content; or RelatedPerson as both for member-originated content.
  Never derive either identity from `Communication.sender`.
- An imported IPS may preserve its external `urn:*` author provenance. The
  importer is not substituted as author and repeating the URN does not prove
  authority to replace or delete the source-authored facts.

- Accept mixed typed `POST` and `DELETE` entries only in `Bundle.type = batch`; do not convert the flow to a transaction.
- `DELETE` addresses exactly `ResourceType/id`, carries no resource body and may include `ifMatch` for optimistic locking.
- Preserve the explicit author as inherited `Composition.author` evidence on
  each projected clinical record. Record a distinct registered submitter only
  for delegated local submission; never treat that submitter as the author.
- Preserve an external `Composition.author = urn:*` when importing an IPS, but
  never treat the controller or BFF that transported it as that author. The
  importer cannot update or delete those source-authored facts.
- For UUID-backed professional onboarding, persist one protected creator
  binding from Employee UUID + Occupation UUID + governed occupational role.
  Employee and Occupation remain the GW model; the Occupation UUID is a
  technical role assignment, not a portal-managed employment contract.
- Treat verified email/phone, operational actor DID, DCR client and signing
  key as aliases of that binding. A new channel may attach aliases only after
  DCR proves the exact preauthorized binding; it must never invent its UUIDs.
- On IPS export, project the employee binding as Practitioner + PractitionerRole,
  keep the legal organization as `Composition.author`, and use the exact
  PractitionerRole UUID as `Composition.attester.party`. Do not store native
  Practitioner resources as the employee-management source of truth.
- A section write carries its per-write Composition-compatible author,
  attester, mode and optional time beside the section resource. When GW VET
  later materializes one IPS document, collect that provenance from the current
  row of every included logical resource as well as from stored Composition
  rows. Do not discard the attester merely because the original write was a
  section batch rather than a document Bundle, and do not let historical rows
  add stale attesters to the current projection.
- Repeating the same external author URN is not source authentication. Require
  independently verified source provenance for replacement; unsigned demo
  imports remain locally immutable under their identifier.
- Authorize deletion against the exact subject plus the authenticated DID or privately linked verified email/phone identifiers. Never copy contact values or hashes into the FHIR resource.
- Return independent `201`, `204`, `403`, `404` or `412` entry results. A failed delete must not roll back a successful sibling create.
- Remove the exact operational fact and its synchronized Digital Twin projection. This is separate from secondary-use `deny` and provider-offboarding purge.
- Persist `Communication.status = preparation` telephone intake in the inbox
  without applying its attached batch. Apply only a later authorized
  `completed` version; retain `not-done` as a rejection without clinical
  projection. Never call this state `draft`.


- Model every animal as an `individual`. “Animal controller” is an exact
  controller relationship to that subject, never another subject type.
- The controller may be a natural person or a legal organization. A
  municipality can therefore control a stray animal without turning the
  municipality, its employee or the animal into the same identity.
- An organization acts through an active employee with protected controller
  delegation. Employment, membership or a browser role label alone grants no
  authority.
- Shelter collaborators, other organization members and veterinarians require
  an active, unexpired grant matching the exact animal, controller, grantee,
  action and purpose. A veterinary credential alone grants no animal access.
- Keep hosting separate from control: ConnectHealth Canada may operate storage
  without becoming controller of every animal hosted by VetChain.
- The high-level profile enrollment performs signed OIDC `id_token` exchange
  and DCR internally. For an individual controller, DCR must persist the exact
  tuple `clientId + actorDid + profileDid + authenticatedSubject +
  authorizedSubjectDid + licenseId`; both actor DIDs must be identical, rooted
  below the licensed individual's canonical subject DID, contact-bound to the
  verified email or telephone, and carry the licensed `RESPRSN` role. The
  deprecated `:family:` DID is never accepted as the canonical path.
- After that exact DCR, a PIN-unlocked wallet proves device possession with
  `client_assertion` / `private_key_jwt`. SMART may omit `vp_token` only for
  that same individual controller and that same animal. A member role such as
  `CHILD`, another subject, a revoked registration or a different JWK must
  fail. Professional, delegated organization and invited-member authorization
  continue to use their required VP/credential evidence.
- When a DCR client exists, verify the assertion with the JWKS stored for that
  client. An assertion-header JWK may match the registered key but may never
  replace it or grant authority by itself.
- Keep the post-DCR SMART exchange distinct from host bootstrap. Submit through
  `.../identity/openid/smart/token` and poll the business result through the
  canonical `.../identity/openid/smart/token-response`. Accept
  `.../identity/openid/smart/_batch-response` only as a temporary compatibility
  alias. Do not invent `_token`; `token` remains the supported action.
- The signed message issuer is the authenticated operational actor DID. The
  `client_assertion` `iss` and `sub` are the registered DCR client id and must
  match `body.client_id`; neither identity may be substituted for the other.
- Add manager/route tests before enabling mutations. Unit tests must cover a
  natural-person controller, a municipality controller acting through an
  employee, invited collaborators and veterinarians, and denials for wrong or
  expired scope. Include JSDoc and comments that explain the authority boundary.

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

## Cross-channel security lifecycle

Use the canonical Spanish security article when a VetChain change affects
capture, terminology selection, authorship, professional attestation, the
animal digital twin, the index, continuity copies or SOS emergency access:

- https://github.com/Fundacion-UNID/soschain-unid-personal-next/blob/main/docs/SECURITY_LIFECYCLE_ARTICLE.es.md

Update its `current` versus `target` status in the same change. Product data may
use authenticated DIDComm plain or FHIR JSON only on an explicitly configured
compatibility boundary; it does not remove DCR, actor provenance or access
control.

## Frozen shared-v1 boundary

- Treat GW CORE v1 (`gwtemplate-node-ts`) and every `gdc-*` repository or package as frozen for new functionality. Only make a narrowly necessary bug, security, or compatibility fix there, backed by a regression test and without product-behavior expansion.
- Implement new VetChain, UHC/UNID, or SOSChain behavior in the corresponding `vet-*`, `uhc-*`, or `sos-*` repository. Keep product roadmaps, feature documentation, examples, and skills in those product repositories; do not add them to GW CORE or `gdc-*`.
