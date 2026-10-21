## Unreleased

- Remove the deprecated HostingManager individual-registration shortcut that
  bypassed Offer and Order. Individual Organization, Offer and Order jobs remain
  routed exclusively through the existing FamilyManager lifecycle.
- Log caller-declared portal application id/version and the safe routed request
  dimensions at gateway ingress so cross-portal incompatibilities can be traced
  without logging tokens or personal claims.

- Keep the local-network ICA verification jurisdiction aligned with the host
  route jurisdiction instead of inheriting the generic base profile value.

- Normalize regular employee `org.schema.Person.sameAs` CSV values, index each
  alias independently and publish those employee-owned aliases in the employee
  DID Document `alsoKnownAs` without conflating them with subject cards.
- Align all portal BFF authorized-subject discovery on the shared
  `sos-sdk-node-ts` Organization/License submit-and-poll contract, and document
  multiple-controller relationships plus future explicit principal rotation.

## [2.0.0] - 2026-10-14

- Start the public SOSCHAIN Gateway history from a clean, secret-free source
  snapshot rather than publishing the inherited private Git history.
- Replace copied GW CORE and former product documentation with a focused
  SOSCHAIN documentation set that links to the canonical GW CORE v1/v2 and
  original SOSCHAIN sources.
- Document the public FHIR, SOS and GDC utility/SDK repositories and distinguish
  runtime dependencies from client integration peers.
- Remove committed CA private keys and deprecated product-specific deployment
  profiles from the public source tree.

- Advertise organization-scoped FHIR R5 `HealthcareService` batch and search
  routes for newly activated tenants so the professional service catalogue can
  create and reload department services through the unified SOS gateway. Route
  those jobs to claims-first encrypted persistence with governed FHIR search
  claims and explicit required identifiers, status, provider and name.
- Require release work to stay inside the owning repository checkout. Permit
  an external worktree only with explicit, task-specific authorization for two
  identified concurrent branches, never to bypass or postpone closure of an
  earlier unmerged branch; merge to `main` and remove task artifacts at closure.
- Replace specialized public environment profiles with exactly one generic
  template for each supported tier: test, demo, local-network and staging.
  Reject additional templates, populated secrets and concrete company, tenant,
  domain, project, cluster or service-account identity; real runtime values
  remain in ignored `.env*` files or the deployment secret store.
- Document and enforce the least-privilege separation between individual
  registration, Department-scoped authority, exact Group membership updates
  and individual-scoped clinical access; define `HOPERAT` and distinguish the
  responsible-party controller, historical `Organization.owner` projection and
  DID document controller. Organization workflow Consent now accepts only
  subject registration filtered to the exact routed Organization.

- Migrate the mandatory secure local SDK journey from the deprecated
  `dataspace-ica-ts` runtime to `connect-ica-ts`. The Antifraud onboarding
  fixture now uses only FNMT trust downloads, and the destructive pass removes
  its verified controller's bootstrap individual before testing tenant
  teardown.
- Make local Fabric preparation reproducible by installing the exact
  `consentaccess-sc` dependency tree before its tests and deploying
  `artifact-sc` on both the data and research channels used by the gateway.
- Establish GDC Core as the direct architectural origin of SOSChain GW, replace
  cross-product parity inventories with a neutral origin contract and keep
  human and animal policy as domain profiles owned by this repository.
- Register professionally attested, coded research evidence as a code-only
  `ResearchAsset` followed by an opaque `VersionAsset` with `parent` and
  `research=true`; source resource/version ids and labels never reach Fabric.
  Optional host-wide terminology enrichment defaults off. When enabled, a
  failed lookup leaves the private write intact, returns an `OperationOutcome`
  warning and withholds research registration. An uncoded professional
  MedicationStatement may retain source text privately with
  `user-selected=false`, but is never registered on the research ledger.
- Remove the unwired-by-SDK direct personal Observation ingestion surface.
  Symptom and wellbeing reports are Communications with optional DIDComm
  transport and are not professionally attested clinical research data.
- Make the Node.js 24 Alpine ConsentAccess CCAAS runtime executable by using
  the static `tini` binary and a POSIX `sh` entrypoint. The release contract
  now rejects images that depend on glibc `tini` or an unavailable Bash shell.
- Own the shared ConsentAccess CCAAS runtime in the unified SOS gateway and
  require Node.js 24 for its development, build, CCAAS and Kubernetes stages.
  Track its authored `lib/` sources so a clean public checkout can test and
  build the chaincode without relying on ignored files or fallback source from
  the legacy GW CORE repository.
- Forward the selected private or tracked synthetic base environment through
  every local-network smoke preparation step so clean checkouts remain
  reproducible after Fabric and ConsentAccess bootstrap.
- Create the ignored local smoke-log directory explicitly so the immutable
  Docker release gate also runs from a clean checkout.
- Let the local Fabric release gate use the tracked synthetic local-network
  profile when no private `.env.local-network` exists, without copying or
  committing secrets.
- Add a fail-closed hospital MVP gate that bootstraps human and animal tenant
  registrations before running the affected portal suites. Keep the separate
  no-bootstrap command as a long-running manual environment; it never reports
  automated test success. Local processes must use isolated assigned ports.
- Add one Test Network frontend command that validates configured Firebase Web
  applications and localhost authorization, resolves App Hosting secrets
  directly from Secret Manager and starts the portals without a local gateway
  or hand-written environment files.

- Accept a native FHIR Communication transport shell on the version-neutral
  `org.hl7.fhir.api` route while persisting and indexing only its governed
  `resource.meta.claims`; native shell fields never become stored business
  state. Keep native FHIR import semantics on explicit versioned routes.
- Track the build, Jest and type-check TypeScript configurations so a clean
  checkout is installable, testable and compilable without ignored local files.
- Make the secure local SDK release journey select the ICA-supported
  jurisdiction and `animal-care` sector explicitly, and use the
  current ICA verification flow for both normal and destructive passes.
- Add fail-closed, structure-only SOSChain staging examples and a regression
  guard that rejects concrete deployment inventory. Real per-product,
  per-environment profiles remain private and outside this repository.
- Make unified SOS gateway capability ownership executable: clinical shared,
  human and veterinary profiles are separate from organization administration
  and deployment/key-custody profiles. Add fixture-source guards so veterinary
  tests cannot use `Patient` references and human tests cannot use `Animal`
  references, while retaining explicitly shared adapter compatibility tests.
- Adopt human subject-scoped Appointment storage, represented-subject OpenID,
  durable audited break-glass, employee OTP recovery, clinical author/attester
  ledger links and professional Offer-to-Order seat issuance as SOSChain-owned
  capabilities. Keep human deployment configuration separate, retain one copy
  of equivalent tests and use `Animal` references in animal scheduling
  contracts rather than human `Patient` fixtures.
- Preserve cardless human Individual Organization drafts beside the existing
  animal draft lifecycle: a valid birth year permits a private pending human
  draft, only the verified controller may resume or delete it, and human and
  animal readiness remain distinct policies over the same persistence path.
  Adoption of artifact and employee chaincode contracts does not authorize any
  Fabric deployment.
- Preserve distinct human-profile integration contracts for controller DCR,
  ICA-derived legal identity, KMS restart key replay, optional Stripe
  fail-closed startup, historical employee Offer compatibility, and separate
  human and animal discovery metadata. Collapse the duplicate host-sector
  routing case and keep animal-only fixtures based on `Animal`.
- Preserve the distinct strict encrypted `Patient/$match` transport contract:
  an authenticated human-health request returns the compact JWE continuation
  synchronously, while the existing veterinary journey continues to resolve
  an `Animal` fixture through the compatible patient-match boundary.
- Converge the runtime-KEK provisioning tests without dropping provider
  coverage: canonical AWS inputs and authenticated context, HashiCorp Transit,
  and deprecated GCP migration aliases remain distinct executable contracts.
- Separate subject fixtures in veterinary tests and persistence contracts:
  animal research cohorts, Encounters, ServiceRequests and Tasks now use the
  canonical `Animal/animal-one` reference, while person cohorts retain
  `Patient/patricia-doe`; `Group.type` rejects cross-profile references.

- Enforce the authenticated SMART subject and section constraints while
  materializing `Subject/$summary`: omitted request filters inherit authorized
  sections, explicit filters are intersected, and unrelated clinical resources
  or transport/index `DocumentReference` records are excluded. Directly or
  transitively section-linked document resources remain in the returned FHIR
  graph. The complete Jest E2E gate now runs in one worker, and its live ICA
  fixture supplies distinct controller and organization public keys required
  by `test-network` verification.

- Preserve the canonical `Communication.partOf` channel identifier in
  participant-search projections. Claims-first Communications can now be
  grouped and reopened by an authorized BFF without depending on the removed
  legacy top-level `thid` field.
- Accept controller-approved claims-first FHIR R5 organization workflow
  Consent for the exact routed organization, operational Group and active
  DCR-bound PractitionerRole member. Keep Group membership descriptive,
  restrict authorization to the governed encounter or scheduling capability
  set, and support protected search plus explicit revocation in a separate
  workflow-consent lifecycle section.
- Admit the separate multisector `Subject/Composition.cuds` clinical
  contribution capability for an exact active PractitionerRole Group member.
  This capability does not grant clinical read, attestation, index update or
  message delivery, and it is never widened to `organization/Composition`.

- Accept claims-first FHIR R5 `EncounterHistory` milestones inside authorized
  Communication batch projections and store them beside the subject's
  Encounter records, enabling auditable service handovers without persisting a
  nested native FHIR resource.
- Synchronize the GW CORE employee identity fix: derive the employee URN path
  from the shared canonical stable actor identifier so licence, profile and DCR
  validation resolve the same normalized email identity.

## [1.28.3] - 2026-10-04

- Preserve legal host names containing shell and `sed` replacement
  metacharacters when rendering the GKE ConfigMap, preventing `&` from being
  replaced by the deployment-template placeholder in staging metadata.

## [1.28.2] - 2026-10-04

- Synchronize the applicable GW CORE activation and ICA trust fixes: derive
  Gaia-X legal identity from the validated ICA OrganizationCredential,
  preserve the exact resource covered by an incoming host proof, and sign
  PDF-free ICA verification requests with the VetChain host ES384 key.
- Enforce a secret-free `env.example` and run the environment-template policy
  before unit, integration and E2E suites.
- Audit the other recent CORE changes in `SYNC.md`, recording research
  terminology and stable storage/provenance as already equivalent and generic
  public-image promotion as outside the product-owned VetChain image boundary.

## [1.28.1] - 2026-10-04

- Allow a verified professional to start an additional device DCR with an
  explicit route sector plus the neutral employee authorization URN. The
  gateway resolves only the matching active organization, employee UUID, role,
  licensed email and device allowance; it does not create an employee seat or
  grant access to any patient.
- Persist the neutral organization/member/role URN as an employee DID alias
  while retaining the existing hosted role-bearing URN and DID identity.
- Keep the mandatory local-network release smoke on the canonical claims-first
  individual and Communication batch contracts after removing legacy aliases.

## [1.28.0] - 2026-10-02

- Prove that DataConv export-completion Communication writes are matched by a
  native FHIR R5 Communication Subscription and delivered through the durable
  BFF rest-hook outbox.
- Intersect matching pseudonymous subject sets when one digital-twin
  `ResearchSubject/_search` Parameters request contains filters for multiple
  clinical resource families. Repeated sections remain OR alternatives, while
  distinct resource-family constraints are ANDed before loading the matching
  ResearchSubjects.

- Correct the local VetChain tenant bootstrap overrides so Organization and
  Order values replace the canonical `body.data[0].resource.meta.claims`
  fields. The bootstrap no longer leaves the default health-care sector in the
  fixture and therefore no longer fails veterinary ICA admission before E2E.

- Align the GW VET scheduling runtime with `fhir-data-utils-ts` 0.6,
  `sos-data-utils-ts` 0.5.1, `vet-data-utils-ts` 0.7 and
  `vet-sdk-core-ts` 0.7.1 so current Schedule service references and planning
  horizon claims from the professional portal pass the governed allowlist.

- Distinguish a neutral legal organization from each hosted sector/provider
  tenant. Lifecycle operations now select an exact tenant with
  `Organization.sameAs`, reject ambiguous identifier-only requests, keep the
  current binding in the existing `artifact-sc`, and return the exact tenant
  DID in both new and replayed Order results. No CCAAS change is required.

- Make scheduling persistence claims-first: encrypted Location, Schedule,
  Slot, Appointment and AppointmentResponse content is exactly `{ claims }`;
  native FHIR remains an explicit import or materialization boundary.
- Apply standard inclusive `ge`/`le` date searches to `Slot.start`,
  `Appointment.date` and `AppointmentResponse._lastUpdated`. Protected exact
  filters still run first, then the GW evaluates the range only on decrypted
  candidate claims.
- Advertise organization-scoped `Communication/_batch` and `_search` beside
  scheduling resources so appointment notices authored with the shared outer
  Bundle editor can traverse the declared tenant route.

- Clarify that lifecycle authority belongs exclusively to the network
  governing entity, UNID under the applicable rulebook: per-provider
  `approveformyorg` records are local CCAAS package bindings, never votes,
  quorum members or majority requirements. This governance role does not grant
  access to hosted or clinical data.

- Add the controller-only claims-first public department `Organization` to the
  Vet directory alongside Place, Service and Product. Legal onboarding and
  individual Organizations keep their existing managers; only
  `organization/org.schema/Organization` reaches the directory manager.
- Persist encrypted department claims and protected search attributes in the
  dedicated `organizations` section so offered Services can reference one
  stable department and its aggregate HealthcareService projection.
- Add a practical host-provider Fabric onboarding guide that separates the
  provider's two Helm phases from governor-only MSP/channel/lifecycle changes
  and defines the exact read-only checks required before enabling GW.

- Extend the controller-only claims-first FHIR R5 `Group` manager from
  professional research teams to frozen `animal` and `person` alert cohorts.
  Cohort members remain independent deterministic `Patient/<id>` projections;
  membership is descriptive and never grants access.

- Add claims-first FHIR R5 organization routes for `Encounter`,
  `ServiceRequest`, triage `Task` and `CommunicationRequest`. Each manager
  rejects native or unknown business fields before persistence, encrypts only
  normalized flat claims, and protects only its governed search allowlist.
  This supplies the GW VET boundary for appointment-to-encounter continuity,
  emergency request/triage separation and governed campaign intent without
  changing GW CORE.
- Add content-derived versions and weak-ETag optimistic locking to those
  care-continuity records. `_search` returns the GW-authored
  `<ResourceType>.meta.versionId`; `PUT` now requires the matching `ifMatch`
  and rejects stale replacements with `412` without changing stored state.

- Asynchronous ICA verification now fails closed when its
  terminal DIDComm envelope contains an error, failed resource or HTTP-style
  error entry, and restores the canonical verified-at fixture required by the
  immutable local-network release smoke.

- Resolve normalized local and English terminology for new digital-twin
  research projections from the governed exact `system|code` service. The
  research plane no longer trusts `code-text` or `code-display` received from
  an individual UI, EHR, BFF or imported document; without a configured
  terminology service it remains searchable by exact code only.

- Resolve a controller-owned animal's public Card alias through that animal's
  encrypted Individual Organization before issuing SMART access. The active
  controller seat and DCR key remain the authority; a public directory match
  alone never grants access, and denied personal DCR access now reports the
  actual subject-authorization failure instead of a misleading missing
  `vp_token` error.

- Make the immutable local-network smoke own its local Connect ICA process,
  inject the container-reachable ICA URL into the generated environment and
  pin the deterministic public host DID document. The organization
  transaction now proves the real GW-to-ICA verification and Offer/Order path
  instead of failing through an omitted test dependency.
- Keep the host-facing mapped port separate from the authority URL signed for
  ICA, and use that same authority as the governed hosting-service URL so the
  issuer DID, organization DID and service domain remain identical.

- Let an already registered personal DCR open a legacy animal controller seat
  created before stable `activatedBy` bindings existed only when both the
  original seat and the selected animal seat match the same exact email or
  telephone verified into that device profile. Modern mismatched actor
  bindings and contact collisions remain rejected, and no `vp_token` is
  fabricated for the controller.

- Bind VetChain staging explicitly to its deployed Connect ICA and reject the
  rollout before Kubernetes mutation when the required HTTPS endpoint or
  `did:web` identity is absent, preventing card activation from running with an
  empty ICA configuration.

- Normalize provider-linked Firebase email and telephone identities only after
  token verification, so portal and telephone wallets resolve the same
  controller seats while SMART `sub` remains the requester and the selected
  animal remains a separate subject context.
- Keep the PetChain, VetChain and SOSChain Personal/Professional Firebase
  audiences in the product-owned staging runtime and fail deployment before
  Kubernetes mutation if any required project is absent from either the
  Firebase allowlist or the trusted OIDC provider list.

- Make the local release smoke reject nested ICA verification failures before
  purchasing an Offer, and attach the required verification timestamp to its
  synthetic individual KYC profile so the canonical registration journey can
  reach the controller SMART checks. Bind the ICA credential-ledger client to
  the same MSP that issued its generated Fabric client certificate.
- Keep the local host-service onboarding claim at the host HTTPS/origin
  boundary instead of manufacturing a tenant resource path that the ICA host
  form contract must reject.
- Keep the VetChain local-network image smoke host URL overridable and pass its
  explicit local network kind plus deterministic non-production
  preauthorization seed into host onboarding, so the ICA verifies the same
  signed local host proof instead of failing on missing subprocess variables.
- Let one registered personal DCR select another exact animal controlled by
  the same actor only when both subjects have active individual-controller
  seats with bare `RESPRSN` and the same stable activation binding. Do not
  fabricate a presentation token, infer ownership from a directory match, or
  authorize a subject belonging to a different controller.
- Restore the pre-SMART personal directory for legacy DCR profiles that
  protected the OIDC subject and controller actor DID before issued contact
  fields were persisted. The current verified email or telephone must hash to
  the exact member identifier already embedded in that registered actor DID;
  a different account, contact, actor or client remains rejected.
- Refuse the VetChain staging topology when its historical host-registry
  collection binding was omitted. This prevents a rollout from bootstrapping
  an empty parallel registry and making persisted tenant DID routes return 404
  after a pod restart.
- Restore the reserved physical Host registry name: new deployments use
  `host` (scoped as `<deployment>_<networkMode>_<hostScope>__host`) instead of
  deriving storage from the operator's legal identifier. Existing deployments
  may pin their exact legacy collection during an audited migration; controller
  emails and authority are unchanged.
- Preserve external Composition author and attester provenance when importing
  IPS documents, including DocumentReference-wrapped Bundles; only explicit
  section-edit commands apply the authenticated creator binding.
- Wire the already-built FHIR R5 `SubscriptionManager` into the production
  Worker registry so `SubscriptionTopic` and `Subscription` jobs execute and
  successful resource writes can emit durable rest-hook notifications.

- Publish separate DCAT offerings for individual index, personal document
  backup and Digital Twin services using the shared `sos-data-utils-ts`
  capability vocabulary. A backup-only tenant now exposes only its enabled
  DocumentReference/ImagingStudy/Binary resource families and cannot inherit
  Composition or ResearchSubject surfaces. Document the independent provider
  PDF checkboxes and individual service-offer selections for the Vet-first
  rollout.

- Preserve coded veterinary meaning across permitted Digital Twin projection
  and `ResearchSubject/$summary`: canonical `system|code`, selected display,
  confirmed local text and language remain available as source evidence, while
  persistence envelopes and private query metadata never surface as FHIR
  claims. Research terminology is re-resolved from the code rather than
  trusting received labels. Add an animal-subject integration fixture instead
  of reusing a human IPS Patient document.
- Keep generic vault repository mocks compatible with the current Jest type
  contract so the claims-first Communication suite executes instead of
  failing during TypeScript compilation.
- Persist the complete Immunization graph, including linked Medication,
  DocumentReference, ImmunizationRecommendation and 1m/1w/1d reminder Tasks.
- Add active/inactive/delete Consent lifecycle handling and revoke the matching
  authorization projection when a controller deactivates or deletes a grant.
- Apply shared professional access by exact role and jurisdiction: a country
  grant covers its ISO 3166-2 subdivisions, while a subdivision stays exact.
- Keep production host identities in private deployment configuration rather
  than public documentation or skills.
- Bootstrap legal veterinary clinics through `Organization/_transaction` and
  its asynchronous response route; reserve `_batch` for the later `Order`
  confirmation and never use it to create a legal organization.
- Preserve the caller-signed host authorization resource byte-for-byte while
  forwarding it to Connect-ICA, then normalize claims separately for gateway
  validation and persistence.

- Complete the internal veterinary health-card projection over authoritative
  FHIR Bundle readback: standard SMART Health Cards use a dedicated tenant
  P-256/ES256 credential key, while each resolved attester contributes an
  exact-byte RFC 7797 ML-DSA companion proof. No endpoint is advertised yet.

- Make Vet-first synchronization bidirectional: every candidate fix from CORE
  or another product now requires an explicit source commit, applicability
  classification, Vet proof when shared, and recorded downstream fan-out.
- Close the two previously unmerged Vet fix lines: record the already-equivalent
  SUBSETTED import fix and promote the evidence/provenance security fix to UHC.
- Scope CapabilityStatement and SMART discovery to each exact tenant
  `section/format` FHIR server base and advertise only the veterinary resources
  configured in that tenant's DID services.

- Define cumulative release closure: grouped functional branches merge and
  push to `main` with changelog but without per-branch version/publication; the
  integrated matrix, release version and exact-SHA publication happen once at
  cumulative release closure.
- Correct the Animal ICA onboarding skill to resolve the production host from
  private deployment configuration and synchronize the sector/country
  organization-verification boundary with VetChain and UHC products.
- Release `1.27.3` lets a DCR-bound individual controller request a SMART
  token for the public card alias of its own subject. GW resolves the active
  device licence to one opaque individual record and verifies the protected
  `Organization.sameAs`; unrelated aliases and inactive or mismatched licences
  remain denied without a `vp_token`.
- Release `1.27.2` records the GW VET implementation backlog for authenticated
  RFC 7662/RFC 9701 SMART introspection. The future route must authenticate the
  registered EHR client and re-check current assignment, licence, device, key
  and Consent state; documentation continues to identify it as non-routable
  until its manager, route and executable gates exist.
- Define VetChain as the tested source for reviewed full-stack synchronization
  to UHC across GW, Personal, Professional and telephone/YAML adapters, with
  explicit shared, veterinary-only and human-health-only classifications.
- Permit only the exact pre-SMART personal account-directory searches needed
  after profile unlock. Bind the verified OIDC subject and contact to the same
  active DCR device profile, add a server-only worker marker, and reject empty,
  mismatched or enumerable owner/card lookups before clinical authorization.
- Release `1.27.1` accepts the canonical ICA ServiceControllerCredential shape
  when issuing a controller's study-scoped ResearchSubject create token:
  schema.org `provider.identifier.value` binds the tenant and the stable
  `owner.sameAs` multibase identifier binds the current controller DID. The
  historical `provider.taxID` and full-DID forms remain compatible, while
  cross-tenant and different-controller proofs still fail closed.
- Release `1.27.0` replaces the process-local async queue and polling state in
  staging/production with an isolated Pub/Sub pull subscription and Firestore
  response store. Complete job envelopes are held in a private expiring GCS
  bucket, acknowledgements occur only after the result is durable, and failed
  result persistence causes redelivery. Add idempotent GCP provisioning for
  exactly-once delivery, retry/backoff, dead lettering with a retained 14-day
  inspection subscription, Workload Identity IAM, bucket lifecycle and
  Firestore TTL.
- Release `1.26.58` moves the VetChain GW Kubernetes renderer, manifests and runtime validation
  into this repository. GW releases no longer invoke `fabric-multicloud` to
  deploy workloads; production also requires an explicit durable queue.
- Release `1.26.57` aligns every transitive GCS metadata client with the
  workspace gaxios runtime so GKE Workload Identity can persist confidential
  VetChain blobs instead of failing during token retrieval.
- Release `1.26.56` makes the private veterinary production hostname the only canonical
  production ConnectHealth veterinary host and aligns Animal ICA approval,
  DID examples and product configuration with it. It also records the separate
  ConnectHealth host/backup and Antifraud PetChain/VetChain/ICA GCP projects,
  CryptoKeys, service-account custody, clinic authorship and restore gates.
- Propagate `ICA_ALLOW_CONTROLLER_REBIND_ON_REVERIFY` through the rendered
  Animal ICA runtime ConfigMap, enable it only in staging, keep production
  fail-closed, and execute the staging renderer in the deployment contract
  test so a documented-but-dropped variable cannot recur.
- Issue an exact create-only, study-pinned ResearchSubject SMART token to the
  verified current tenant controller only after its ServiceControllerCredential,
  bare `RESPRSN`, tenant binding and existing claims-first ResearchStudy pass.
  The professional DCR plus active-Consent `crus` profile remains unchanged;
  neither grant includes delete or appointment authority.
- Pin the staging host-controller ML-DSA-65 verification identity used by
  existing VetChain Test Network organization credentials. The Animal ICA
  receives that explicit public signer only in staging; production configures
  an empty Test Network signer list and remains fail-closed. Select the
  immutable Connect ICA `1.2.28-6af26db` image digest for staging.
- Recover an active animal controller's original activation grant when a
  historical individual record omitted its activation-code projection. The
  repair is limited to the single issued `RESPRSN` seat matching the same
  animal, accepted Offer, and verified owner contact, and never mints or
  exposes a replacement code. Pin the proven `1.26.56-6d9bd23d` staging image
  by immutable digest.
- Pin the Animal Connect ICA staging workload to the immutable `1.2.25`
  artifact that exposes the authenticated organization-proof verifier required
  by DataConv tenant activation; this keeps orchestration in the VetChain BFF
  and does not add DataConv state management to GW VET.
- Configure VetChain staging as authenticated compatibility transport for
  cardless telephone drafts and veterinary FHIR integrations: enable native
  FHIR JSON and canonical DIDComm plain, keep generic JSON and insecure bearer
  disabled, and document the mandatory transition to encrypted DIDComm after
  DCR profile enrollment. The staging-wide profile is not approved for
  production; production requires route-scoped bootstrap/EHR compatibility.
- Select the locally proven `1.26.50-0989cd78` amd64 image by immutable digest
  for the VetChain staging deployment.

## [1.26.49] - 2026-09-13

### Fixed

- Make the local tenant bootstrap idempotent when an existing-tenant conflict
  arrives from the asynchronous poll rather than the initial empty submit, so
  real portal and telephone Playwright gates can reuse the running GW safely.
- Select the locally proven `1.26.49-395ba45b` amd64 image by immutable digest
  for the private VetChain staging deployment.

## [1.26.48] - 2026-09-13

### Fixed

- Classify incomplete animals as `draft_saved` in the authenticated owner
  directory and return their missing name, species and card fields so trusted
  product BFFs can resume or delete them without exposing the private UUID to
  telephone callbacks.
- Select the locally proven `1.26.48-13bcf2b9` amd64 image by immutable digest
  for the private VetChain staging deployment.

## [1.26.47] - 2026-09-13

### Fixed

- Preserve the animal as the Individual Organization's `ONESELF` member and
  keep the creating human in the separate `owner` controller boundary.
- Persist incomplete animal registrations as resumable `pending` drafts,
  without a public Card, and reject activation until name, exact NCBI species
  and Card alias are all present.

## [1.26.46] - 2026-09-12

### Added

- Add GW VET scheduling managers and tenant services for organization-owned
  `Location`, `Schedule` and `Slot`, plus shared `Appointment` and
  `AppointmentResponse` state with encrypted governed claims.
- Materialize the principal individual controller as a canonical
  `RelatedPerson` when the registration Order issues its `RESPRSN` licence.

### Changed

- Pin `gdc-common-utils-ts@2.9.14` and `vet-data-utils-ts@0.5.30` for the
  current identity, insurance Consent and scheduling contracts.
- Replace the appointment-only manager with the care-sector-neutral
  `SchedulingManager` shared by animal and human care products.

### Fixed

- Preserve the controller's bare UUID across registration, licence issuance
  and the principal relationship assignment.
- Generate a private UUID document id when demo or legacy individual
  registration payloads carry placeholders or business identifiers, so a
  controller licence cannot bind to a non-canonical animal subject.
- Preserve Composition-compatible author and attester claims while
  materializing IPS documents.

- Release GW VET `1.26.45` with exact ISO 3166-2 Consent actor matching, so
  `CA-BC` and `US-WA` remain subdivision rules and cannot collapse into their
  parent countries or match neighbouring subdivisions.
- Release GW VET `1.26.44` with configuration-owned Animal ICA jurisdictions.
  Remove the stale `CA-BC`-only deployment override and the `ES` forwarding
  fallback: deployment profiles explicitly supply `ES,CA,CA-*,US,US-*`, while
  live signed-PDF E2E supplies its fixture jurisdiction independently from the
  approved host's `CA-BC` route jurisdiction. Restore Spanish certificate
  verification by loading the official FNMT root and intermediate trust
  anchors with deployment-pinned SHA-256 fingerprints instead of expecting
  certificate files that are absent from the runtime image.
- Release GW VET `1.26.43` with fail-closed animal-insurance Consent/ODRL
  parity validation, consuming the exact `vet-data-utils-ts@0.5.29` contract.
- Keep preliminary vital-sign Observations and documents in the operational
  individual plane while excluding them from Digital Twin research projection
  and blockchain evidence. Preserve supplied FHIR EventTiming values as the
  flat `Observation.date-when` claim and project unchanged clinical content
  only after the parent Composition becomes final.
- Require the standard root `Bundle.meta.tag` coding
  `http://terminology.hl7.org/CodeSystem/v3-ObservationValue|SUBSETTED` before
  treating tagged resources inside a FHIR document as metadata-only index
  projections. Resource tags in ordinary full documents no longer discard
  their clinical fields.
- Mark the individual `Composition/_batch` and `_batch-response` operations as
  deprecated compatibility endpoints in OpenAPI and integrator documentation;
  their runtime behavior remains unchanged.
- Release GW VET `1.26.42` so metadata-only entries in a Composition document
  may carry additional native FHIR fields without persisting or rejecting
  them; only resource-qualified, allowlisted `meta.tag` values enrich the
  existing encrypted clinical claims.
- Release GW VET `1.26.41` with the final neutral GW CORE Consent/Fabric
  corrections and executable local ICA boundary evidence.
- Replace the misleading conditional `IcaManager` online integration with a
  no-skip HostingManager forwarding E2E against the real local `connect-ica`
  service and a real multi-signature organization fixture. Keep the separate
  Fabric-CA unit contract explicit about its Authorization header and
  `entry.resource.status` response shape.
- Pin `gdc-common-utils-ts` 2.9.14 so GW VET proves the same canonical
  `individual:multibase` identity contract consumed by the released SDK.
- Accept Composition document index entries containing only `resourceType`,
  `id` and `meta.tag`; derive the allowlisted searchable claims and ignore all
  other tags instead of rejecting the document.
- Merge metadata-only index claims into existing clinical state without
  replacing private resource claims or triggering a Digital Twin projection.

- Remove pending Jest placeholders for unimplemented connection-channel and
  future shared-lifecycle surfaces; the suite now reports only executable
  contracts for behavior shipped by GW VET.
- Bind individual owner-directory search, disable, and purge requests to the
  authenticated bearer email/telephone, while retaining explicit same-tenant
  `RESPRSN` controller authority; another authenticated owner now fails with
  403 before any vault query or lifecycle mutation.
### Added

- Add the product-local Antifraud request-bound SD-JWT pilot for verified
  `Person` and `Animal` flat claims. The controller submits a UUID
  `Parameters.id` equal to the DIDComm `thid`; the tenant signs per-claim seed
  claims and SHA-384 disclosure commitments while attribute values and
  HKDF-SHA-384 final salts remain absent from the response.

- Add a product-local, controller-only FHIR R5 `Provenance` manager. It stores
  encrypted claims, indexes all thirteen standard resource-specific search
  parameters plus correlated `Provenance.agent-<type>-who`, and binds `who` to
  the server-issued professional assignment as `PractitionerRole/<UUID>` rather
  than an operational employee or role-license URN.
- Add controller-only encrypted HealthDCAT `Catalog`, `Dataset`,
  `CatalogRecord`, `Distribution` and `DataService` managers to GW VET. A
  published `CatalogRecord` exposes dataset metadata; changing it to
  `archived` removes that metadata from the external discovery projection
  without deleting the linked `ResearchStudy` or changing Dataset access
  rights.
- Add Schema.org `Product` persistence and indexed search beside the existing
  clinic `Place` and `Service` marketplace records, allowing insurer tenants
  to publish plan definitions without confusing them with a person's FHIR
  `Coverage`.

- Add encrypted claims-only Schema.org `Place` and `Service` managers under
  organization routes for VetChain clinic directories. Their allowlisted flat
  claims are HMAC-protected indexed attributes and are not added to GW CORE.

- Add GW VET scheduling managers and tenant services for organization-owned
  `Location`, `Schedule` and `Slot`, plus shared `Appointment` and
  `AppointmentResponse` state. Every governed flat claim is encrypted and its
  FHIR SearchParameter attributes are protected before `_batch` persistence or
  `_search` comparison; governed native FHIR fields are preserved encrypted.

### Changed

- Release GW VET `1.26.37` against the exact published
  `vet-data-utils-ts@0.5.28` and `vet-sdk-core-ts@0.4.37` contracts. Public
  marketplace and HealthDCAT publication writes are restricted to the tenant
  controller; scheduling remains available to authorized organization
  employees.

- Release GW VET `1.26.36` with the applicable GW CORE individual-controller
  DCR correction and the published `vet-sdk-core-ts@0.4.32`; its SDK tests now
  consume the same `vet-data-utils-ts@0.5.21` contract as the gateway instead
  of installing a nested obsolete `0.5.6` copy.
- Release GW VET `1.26.35` against published
  `vet-data-utils-ts@0.5.21` for the product-local directory vocabulary.

- Expose one care-sector-neutral `SchedulingManager`, neutral storage sections
  and canonical scheduling SearchParameters so the same manager can move to
  human-health gateways without duplicating business logic.
- Release GW VET `1.26.33` against the published
  `vet-data-utils-ts@0.5.16` scheduling vocabulary.

### Fixed

- Canonicalize `Consent.actor-role` before building the primary ledger
  document and CID, so semantically equivalent legacy and canonical actor-role
  claims resolve to the same on-chain asset identifier.
- Deduplicate generated `.env.local-fabric` assignments with deterministic
  last-assignment-wins semantics and fail if the generated file still contains
  duplicate keys. The release-script gate now derives the expected UHC sector
  matrix from the deployment profile instead of asserting a stale order.
- Remove the false conditional EN 16931 XSD test and document the implemented
  UBL boundary accurately: GW VET hashes invoice XML for anchoring but does not
  claim XSD or Schematron conformance validation.
- Backfill a missing controller UUID and RelatedPerson when the verified
  individual controller replays an active legacy Order. Preserve an existing
  multibase `authorizedSubjectDid`, and keep complete replays idempotent.
- Apply the neutral GW CORE `1.25.9` external-custody correction to HashiCorp
  Transit: it now encrypts/decrypts one process runtime KEK like GCP and AWS,
  rather than invoking Transit for ordinary tenant key operations.
- Replace the obsolete `:family:` individual-controller DCR check with the
  canonical contact-bound individual-member DID contract from GW CORE
  `1.25.1`. Repair legacy licence seats missing their subject DID, require the
  exact UUID-backed `RESPRSN` creator assignment, and continue to reject
  non-controller roles and mismatched subject/contact bindings.
- Verify the authenticated-attributes signature against the embedded PDF
  certificate chain and fail closed for a false signature or altered digest.
- Treat request claims as compatibility/routing input, require an auditable
  `kyc_verified_at` for KYC fallback, and keep certificate-signed PDF fields at
  the highest onboarding-evidence precedence.
- Require direct subject-section writes to carry the exact attester assignment
  bound to the authenticated profile, while preserving imported document
  provenance as a separate path.
- Preserve `Organization.owner.identifier.value` as the canonical bare UUID
  for an individual controller, generate one only for legacy registrations
  that omitted or malformed it, and reuse that exact UUID for the issued
  `RESPRSN` licence and gateway-materialized principal `RelatedPerson`.
- Preserve the current section resource's Composition-compatible author and
  attester when materializing an IPS document, including the professional
  PractitionerRole projection.

## [1.26.30] - 2026-09-08

### Fixed

- Bind section-scoped clinical authors and attesters to the authenticated
  professional or personal assignment instead of treating the operational DID
  as FHIR provenance. Professional writes retain the legal organization as
  author and the exact PractitionerRole as attester; the sender remains audit.
- Permit corrections by another active assignment of the same owner, retain
  exact-attester deletion, reject forged attesters before persistence, and
  require a later Composition date for same-organization document successors.
- Keep telephone intake with Communication status `preparation` or `not-done`
  in the auditable inbox without projecting its attached clinical batch; only
  `completed` commits the mutation.

### Changed

- Pin `gdc-common-utils-ts@2.9.10`, `vet-data-utils-ts@0.5.6` and the VET SDK
  test contract at `vet-sdk-core-ts@0.4.20`.

## [1.26.29] - 2026-09-08

### Added

- Accept the provider-neutral `EVM_TRANSFER` Order method only with the BFF's
  invoice reference and no blockchain or wallet claims.
- Add the authenticated IHE PDQm `POST Patient/$match` facade for an exact
  microchip or public-card identifier. Native FHIR, DIDComm plain and protected
  form transports return the same FHIR search Bundle synchronously; the JSON
  compatibility transport retains asynchronous submit/poll behavior.
- Add real local route-to-worker-to-encrypted-vault integration proof for
  exact Patient matching without forwarding or returning the derived alias.
- Port the current neutral federated SMART introspection contract from GW CORE
  into GW VET while preserving animal-index and veterinary authorization
  boundaries. The planned tenant `smart/token/_verify` profile remains
  explicitly unimplemented until its manager, route, ledger and no-skip local
  E2E gates exist.
- Verify portal-managed native USDC transfers against the server-owned EVM
  chain, token contract, recipient, exact offer amount and minimum confirmation
  count before professional seats are issued.
- Prove the real local wallet journey against an Anvil-deployed ERC-20 contract
  while keeping Base mainnet disabled pending its production release gate.

### Fixed

- Remove the EVM JSON-RPC client, receipt verifier and transaction-hash replay
  lookup from GW; the authenticated payment BFF owns quote verification,
  finality, idempotency and FHIR financial reconciliation before seat issuance.

### Changed

- Pin the VetChain staging profile to the locally validated `1.26.29` image
  digest before the `test-network` rollout.
- Reduce the public `subjectidentifier-sc` value to `indexProviderDid` only.
  Public card, subject kind, numeric provider id/domain and private identifier
  remain off-ledger; the resolved provider receives the original authenticated
  identifier through `Patient/$match`, never a caller-supplied hash.
- Consume the published `gdc-common-utils-ts@2.9.7` subject-resolution and
  federated SMART documentation contract.
- Keep the animal index provider as the SMART token audience and define the
  tenant introspection response as a compact JWT-VP containing the unchanged
  original professional VC.

## [1.26.26] - 2026-09-07

### Added

- Adds AWS KMS root custody while preserving the one-decrypt-per-pod bootstrap
  contract and local runtime-KEK wrapping for host and tenant key records.

### Changed

- Makes `KMS_PROVIDER`, `KMS_REGION`, `KMS_KEY_ID`,
  `KMS_RUNTIME_KEK_ID`, and `KMS_RUNTIME_KEK_CIPHERTEXT` the canonical
  provider-neutral deployment contract for GCP and AWS.
- Requires `KMS_REGION` explicitly for AWS. `AWS_REGION` and
  `AWS_DEFAULT_REGION` are not consumed as compatibility aliases.

## [1.26.25] - 2026-09-06

### Fixed

- Supplies canonical flat `Consent.status=active` in the local-network smoke
  payload so ConsentManager can materialize its rules without treating native
  FHIR `resource.status` as a persistence input.

## [1.26.24] - 2026-09-06

### Fixed

- Restores confirmed terminology-code and local `code-text` matching through
  the private Digital Twin text projection without exposing that derived index
  or the local source claim in materialized resources.
- Keeps the claims-first Communication integration gates aligned with encrypted
  persistence and claims-only FHIR API ingestion.

### Added

- Completes the controller-owned claims-first ResearchStudy lifecycle: PUT
  replaces validated base claims, DELETE can remove one explicit associated
  party projection, and base DELETE removes the study plus its party
  projections without persisting versioned native FHIR JSON.
- Returns ResearchStudy associated parties after refresh as independent,
  claims-only search entries correlated by the common study id. Base searches
  include all parties, party-claim filters include only matching projections,
  and every party index name and value is protected before persistence.
- Adds explicit Group member deletion while retaining the Group and its
  canonical SDK-derived ResearchStudy association in `Group.identifier`.
- Makes ResearchStudy Consent activation idempotent, adds explicit
  `Consent.status=inactive` revocation and protected controller-only
  `Consent/_search`; Consent lifecycle remains distinct from SMART token
  issuance and lifetime.

### Changed

- Pins the published `vet-sdk-core-ts@0.4.16` contract and exposes
  organization R5 Consent search in tenant DID service capabilities and
  OpenAPI.

## [1.26.23] - 2026-09-06

### Fixed

- Authorizes a same-tenant professional wildcard Digital Twin search only when
  the current active Employee and licence are accompanied by at least one
  active subject-specific HRESCH Consent targeting that provider organization.
  The SMART manager enumerates only the tenant's subject rule sections; rules
  for another organization, purpose or capability remain inapplicable.
- Indexes canonical terminology codes together with their English
  `code-display` values in the private Digital Twin search projection, while
  continuing to exclude local `code-text` values.
- Restores each Employee's correlated native `Occupation` in `_search`
  responses so authorized consumers can project the stable PractitionerRole
  identifier without substituting the Employee identity.
- Returns participant-search `Communication` results as claims-only resources,
  including their category, topic, content reference and protected attachment
  claims, so an addressed research invitation can be validated and opened
  without exposing the internal DIDComm channel record.
- Persists a subjectless `Communication` in its addressed recipient channel
  while leaving `Communication.subject` absent, allowing FHIR-valid invitations
  to be received without inventing a business subject claim.
- Enforces the claims-first persistence gate for `Communication`: the manager
  stores only encrypted `content: { claims }`, protects every participant,
  category and topic index before comparison, projects native R4 input at the
  import boundary, and fails closed on historical nested records pending an
  explicit recoverable migration.

## [1.26.22] - 2026-09-06

### Fixed

- Aligned the encrypted FHIR R5 Group query index with the shared veterinary
  contract: identifiers now use only canonical `system|value`, referenced
  characteristics are indexed only by `characteristic-reference`, and the
  token/composite `value` projections contain only CodeableConcept or boolean
  values. Group membership remains descriptive and grants no authorization.
- Made ResearchStudy and Group persistence claims-first: encrypted content is
  exactly `{ claims }`, protected search indexes are derived from the validated
  flat claims, each study party and Group PractitionerRole member is stored as
  its own deterministic record in a parent-scoped internal section, and native
  historical records fail closed without destructive deletion and require an
  explicit recoverable migration. Responses expose only `resourceType`, `id`
  and `meta.claims`.
- Made ResearchStudy Consent activation and SMART readback claims-first. The GW
  validates the exact authoritative role plus current active Employee and
  licence, protects Consent index names and values, encrypts only `{ claims }`,
  and rejects legacy native Consent records.
- Decrypts every candidate professional licence with the tenant vault key before
  validating status, expiry, role, email and stable actor binding. An unreadable
  licence now fails closed for that document without hiding a later valid match.
- Made deterministic ResearchStudy and Group POST retries idempotent: identical
  normalized claims return 200 without another write, divergent claims return
  409, and legacy native records remain intact for explicit migration.
- Added standards-defined path-based `did:web` tenant resolution at
  `/{tenantId}/cds-{jurisdiction}/{version}/{sector}/did.json`; the existing
  `.well-known/did.json` endpoint remains as a compatibility alias and both
  return the same tenant DID document.
- Published the legacy ES signing key in both DID `authentication` and
  `assertionMethod` so the same compatibility key can verify JWTs and VCs.
  Historical DID documents are normalized in memory, private KMS purpose
  labels remain hidden, and the ML communication/VC keys retain their separate
  relationships.

## [1.26.21] - 2026-09-06

### Added

- Added the VET-only FHIR R5 organization `Consent/_batch` activation route
  for one controller-approved ResearchStudy permission. It requires the exact
  associated PractitionerRole to have completed DCR and persists the active
  study correlation encrypted in the isolated tenant collection.
- Added study-scoped SMART issuance for exactly
  `organization/ResearchSubject.crus?study=ResearchStudy/<id>`. The requester
  must present its DCR-bound private-key client assertion, professional VP,
  active employee licence and matching active Consent. Draft, delete, wrong
  study, tenant, actor or jurisdiction fail closed; Group and associatedParty
  remain descriptive. The signed token retains the professional `sub` and adds
  `purpose: HRESCH` plus the exact `study: ResearchStudy/<id>` reference for
  offline downstream validation.

## [1.26.20] - 2026-09-06

### Added

- Added the VET-only FHIR R5 `ResearchStudy/_batch` and `_search` organization
  routes. Writes require a current tenant DID controller; POST creates an
  encrypted study record and PATCH adds one correlated `associatedParty`
  without changing status. Search indexes only the official R5 ResearchStudy
  SearchParameters and enforces tenant, sector and ISO route-jurisdiction
  isolation.
- Added the VET-only FHIR R5 `Group/_batch` and `_search` organization routes.
  A controller can independently create, replace or delete batch entries;
  readers receive native Group resources through the official R5 search
  parameters. Membership remains descriptive and never grants SMART access or
  replaces the separate active-Consent authorization boundary.

## [1.26.19] - 2026-09-06

- Require an explicit `active` Consent status before materializing or using an
  authorization rule, including Consent resources carried by Communication.
- Enforce SMART CRUDS operation coverage so a read/search permit cannot grant
  create, update, or delete access.
- Require same-tenant ResearchSubject access to retain its matching active
  Employee record and applicable professional licence as well as a matching
  subject-scoped Consent; neither employment nor Consent substitutes the other.

## [1.26.18] - 2026-09-04

- Reconstruct consolidated IPS documents with the source organization or
  subject as `Composition.author` and the bound professional/member role as
  `Composition.attester`, including its supporting FHIR resources.
- Preserve directly indexed multi-valued attester modes, parties and times in
  both native R4 and claims-first summary exports.
- Migrate historical operational-author records during export without
  rewriting their stored source evidence.

## [1.26.17] - 2026-09-04

- Project document-level Composition identifier, author, attester, custodian,
  date, type and title claims into every confidential clinical resource.
- Index sector and every value of multi-valued provenance claims while keeping
  the authenticated submitter DID and verified signing key as separate audit
  evidence.
- Keep resource content versions stable when only document-container metadata
  changes, while preserving author and clinical-section replacement semantics.
- Consume `gdc-common-utils-ts@2.8.6` for the canonical confidential-document
  provenance index builder.

## [1.26.16] - 2026-09-04

- Preserve veterinary assistant submitters as audit-only provenance: they may
  create for a registered author but may not later update or delete that
  author's clinical resource.
- Resolve IPS author organizations from the FHIR document graph and allow a
  same-id replacement only for the same organization with a strictly later
  `Composition.date`.
- Bind an employee DCR automatically to its unique pre-authorized clinical
  creator assignment from the activation license subject and governed role;
  explicit binding metadata remains accepted during compatibility rollout.
- Consume `gdc-common-utils-ts@2.8.5` for the shared successor policy,
  canonical ISCO-08 `3240` veterinary technician and assistant role, and the
  lossless Composition author, custodian and attester claims projection.

## [1.26.15] - 2026-09-04

- Require every repository skill to preserve three five-minute npm
  authorization attempts and restrict immutable tarballs to provisional local
  consumer tests until registry publication permits merge and deployment.

## [1.26.14] - 2026-09-04

- Make individual-organization Order completion fail closed and remain pending
  when its controller activation code cannot be issued; persist activation
  material before exposing a successful Order and materialize its seat pool
  idempotently for safe retry.
- Make branch closure, patch versioning, dependency publication order and the
  `test -> local-network -> test-network -> network` promotion sequence
  explicit non-negotiable repository and skill gates.

## [1.26.13] - 2026-09-04

- Move the VetChain Test Network runtime from the retired
  `CONNECTHEALTHMSP` peer to `CONNECTHEALTHSTAGINGMSP`, including the exact
  peer hostname required by its TLS certificate.
- Keep production on its unsuffixed MSP while making the staging MSP and peer
  selection executable in the deployment-overlay and release-script gates.

## [1.26.12] - 2026-09-04

- Start a participant CCAAS runtime with the package ID returned by that MSP's
  committed lifecycle approval, and keep governance-only runs from replacing
  the participant-owned runtime.
- Add canonical SHA-256 identity fields to every break-glass audit artifact,
  satisfying the deployed artifact smart-contract while keeping emergency
  Consent, notification and token-authorization records content-addressed.
- Fix the VetChain staging overlay to select the implemented Clearing House
  stub adapter, so SMART token issuance no longer fails merely because the
  deployment network is `test-network`.
- Allow the governed test-network lifecycle deployer to reuse the immutable
  shared CCAAS host runtime by passing the selected chaincode name explicitly,
  avoiding an unnecessary single-contract image rebuild when sources match.
- Separate participant-local CCAAS installation from the network-governance
  approval and commit phase so the governance MSP is never used as a local
  peer administrator.

## [1.26.11] - 2026-09-03

- Issue SMART access tokens as canonical compact JWS values whose signature
  covers the exact JWT claims returned to the caller. This restores strict
  verification of controller-authorized Consent writes in staging.
- Record the dependency fingerprint produced by the validated 1.26.11 image
  build so subsequent local image builds invalidate their cache only when the
  package manifests change again.

## [1.26.10] - 2026-09-03

- Verify legacy `ES384` tenant SMART signatures through JOSE instead of routing
  them through the ML-DSA verifier. This restores strict staging Consent writes
  for individual-controller sessions while retaining ML-DSA verification for
  post-quantum tenant keys.

## [1.26.9] - 2026-09-03

- Verify tenant-signed SMART access tokens on individual and digital-twin FHIR
  data routes in strict security mode, including tenant key, audience, lifetime
  and scope-bearing claim checks. Lifecycle and DCR routes remain limited to
  their existing OIDC or controller-proof authorization contracts.
- Allow controller sessions to submit Consent and other authorized individual
  FHIR writes in staging without replacing the operational actor DID with the
  login channel or device identity.

## [1.26.8] - 2026-09-03

- Serve the root host JWKS at `/jwks.json`, the exact public URL advertised by
  the root `did:web` document.
- Wait through the LoadBalancer handover window before declaring the public GW
  ping and API documentation unavailable after a successful GKE rollout.

## [1.26.7] - 2026-09-03

- Keep the canonical `resource.meta.claims` registration and Order views in
  sync with runtime overrides in the local-network individual bootstrap. This
  prevents the VetChain `animal-care` release smoke from silently retaining
  the fixture's `health-care` sector or placeholder UUIDs.

## [1.26.6] - 2026-09-03

- Align Family lifecycle assertions with the canonical
  `entry.resource.meta.claims` response shape so the complete release gate
  verifies the same contract enforced by production writers.
- Keep the clean-install dependency contract synchronized with the published
  `gdc-common-utils-ts@2.8.1` runtime already pinned by the service.

## [1.26.5] - 2026-09-03

- Separate authenticated Communication sender, explicit clinical author and
  Observation performer. Section creates accept a registered author, delegated
  submissions retain their submitter audit, and PUT/DELETE preserve authorship.
- Accept creator-authorized `PUT ResourceType/id` entries in section-scoped
  clinical batches, including optional weak-ETag matching, while preserving
  subject and creator ownership checks independently for every batch entry.
- Create Employee/Occupation clinical creator bindings only for roles in the
  governed clinical catalog, so non-clinical employees cannot poison later
  DCR alias resolution or FHIR IPS author projection.
- Read the persisted organization Offer identifier from the canonical
  `entry.resource.meta.claims` response shape during local tenant bootstrap,
  retaining legacy entry-level claims only as a compatibility fallback.
- Bind each UUID-backed Employee and its generated Occupation UUID to one
  stable professional clinical creator. Verified contacts, operational actor
  DIDs, DCR clients and signing keys are channel aliases of that binding.
- Authorize clinical update/delete across linked web and telephone devices,
  while preserving imported external authors as immutable provenance.
- Export locally authored IPS data with `Composition.author` referencing a
  `PractitionerRole`, plus the corresponding `Practitioner`; GW continues to
  manage Employee, Occupation and activate/deactivate rather than employment
  contracts or native FHIR practitioner records.
- Consume `gdc-common-utils-ts@2.8.1` for the shared creator identity contract.
- Consume the published `vet-data-utils-ts@0.4.7` package from npm for the
  governed member and role data contract.

## [1.25.40] - 2026-09-03

- Consume `gdc-common-utils-ts@2.7.8` and complete the canonical claims writer
  migration: new Bundle responses place claims only at
  `entry.resource.meta.claims`, while request and response readers continue to
  accept legacy entry-level claims during the compatibility window.
- Add a source-level regression gate covering direct and indirect response
  writers so licence, Order, clinical, messaging and internal job responses
  cannot reintroduce `entry.meta.claims`.
- Keep tolerant worker normalization silent for already-canonical payloads and
  emit the compatibility warning only when legacy entry-level claims are
  actually consumed.

## [1.25.39] - 2026-09-03

- Document the post-DCR SMART contract consistently in the VetChain skill,
  JSDoc, 101 guide and SDK snippet: submit with `token`, poll canonical
  `token-response`, retain `_batch-response` only as a temporary compatibility
  alias, and keep the operational actor DID distinct from the registered DCR
  client id.

## [1.25.38] - 2026-09-03

- Allow only the registered individual profile's SMART `token`, canonical
  `token-response`, and temporary `_batch-response` compatibility poll to use
  its valid account OIDC bearer before a SMART actor-bound bearer exists. The
  encrypted registered-wallet message, DCR keys, JWS and `private_key_jwt`
  checks remain mandatory, and all other secure routes retain
  bearer-to-message-issuer binding.
- Keep the SMART request issuer as the operational actor DID while validating
  `private_key_jwt` `iss`/`sub` against `body.client_id` and the exact active
  DCR profile, rather than incorrectly requiring the client ID to equal the
  actor DID.

## [1.25.37] - 2026-09-03

- Open encrypted device-license seats through the configured KMS before
  revocation and protect the updated seat again, so Firestore-backed employee
  cleanup revokes exactly one installation without losing the remaining ones.

## [1.25.36] - 2026-09-02

- Normalize a persisted organization authorization URN back to its bare
  official identifier when rebuilding an employee role-license identity during
  DCR or revocation, while retaining support for already-normalized seats.

## [1.25.35] - 2026-09-02

- Bind employee DCR signing and encryption keys to the employee's canonical,
  role-bearing URN and exact role-license asset, matching the identity
  chaincode contract used by test-network Fabric.
- Reuse the same role-bearing identity for device revocation so ledger cleanup
  cannot target the deprecated stable-contact identifier.

## [1.25.34] - 2026-09-02

- Require and persist the created employee resource `subjectId` when issuing a
  professional seat, so DCR and employee inventory resolve the same actor.
- Consume `gdc-common-utils-ts@2.7.4`, including the current clinical-document
  copy and provenance contract used by portal SDKs.

## [1.25.33] - 2026-09-02

- Require lockfile-authoritative npm ci, effective internal dependency
  verification with npm ls, and immediate E2E/Playwright termination after
  the first failed project before expanding to sibling browsers or journeys.

## [1.25.32] - 2026-09-02

- Query the local research projection by the canonical coded
  `MedicationStatement.code` fixture instead of removed free text, allowing
  the release smoke to prove de-identified Digital Twin discovery.
- Validate the actual R4 ResearchSubject response shape through its contained
  Composition and print the complete asynchronous response when that invariant
  fails, instead of silently testing a non-existent `composition` property.

## [1.25.31] - 2026-09-02

- Project GW-owned secondary-use Consent identifiers in the SMART release
  runner with the active animal sector before calculating Fabric rule IDs,
  keeping expected and persisted research assets identical.

## [1.25.30] - 2026-09-02

- Complete the canonical local-network SMART Consent fixture with its shared
  attachment content type and data, so the immutable Fabric smoke reaches the
  authorization flow instead of terminating with a validation error.

## [1.25.29] - 2026-09-02

- Require Node 24 in the package engine contract as well as both Docker image
  stages, preventing immutable-image builds from accepting an older runtime.

## [1.25.28] - 2026-09-02

- Build and run the immutable GW VET image on Node 24, with an executable
  release prerequisite that rejects any older Docker base runtime.

## [1.25.27] - 2026-09-02

- Add the mandatory public identity-chaincode parity gate before building the
  immutable local image used by the Fabric `local-network` release smoke.

## [1.25.26] - 2026-09-02

- Decrypt protected device-license records before a repeated
  `Token/_exchange`, so one active seat can authorize its permitted second
  installation without exposing or downgrading the at-rest license document.
- Make the local tenant bootstrap fail closed on entry-level Organization
  `OperationOutcome` errors and on a missing Offer identifier; it can no longer
  print a false ready result after an unsupported-sector response.
- Pin `gdc-common-utils-ts@2.7.2`, the first shared runtime release that
  exports `ConsentStatuses`; a clean GW VET install now starts with the same
  dependency contract exercised by tests instead of relying on stale local
  `node_modules` state.
- Exclude terminal employee purge tombstones from the current Employee search
  directory while retaining disabled employees for the explicit disable then
  purge lifecycle and keeping the protected tombstone for audit.
- Keep each generated individual/family organization identifier identical in
  the registration response, persisted record and owned member-seat pool.
  Family `Order` now scopes both controller and available seats by
  `ownerOrganizationId`, so a controller can invite a caregiver without
  borrowing another individual's licence.
- Repair a historical unowned controller seat only when it belongs to the
  exact family `Order` being completed; the canonical owner is persisted and
  seats already owned by another organization remain ineligible.
- Make local live validation inspect every terminal Bundle and nested
  `OperationOutcome`; an asynchronous HTTP `200` is transport completion, not
  proof that the requested business operation succeeded.

## [1.25.24] - 2026-09-01

- Keep professional permission requests as auditable `Communication`
  attachments containing canonical FHIR `Consent.status = draft` Bundles.
  Draft entries remain in the individual inbox and cannot be projected as
  active authorization rules; no `AccessRequest.*` pseudo-resource is used.
- Make tenant disable and purge non-cascading: active or unpurged employees,
  individual organizations and members return `409` until their explicit
  resource lifecycle completes. Remove the hidden descendant-wide actions.
- Reject wildcard Employee and RelatedPerson lifecycle ids. Management
  clients page searches and submit bounded Bundles containing one explicit id
  per entry.
- Publish Employee and RelatedPerson disable/purge contracts and shared
  common-utils-derived examples in Swagger. The current Employee Bundle
  `DELETE` profile is documented as GW soft disable: it retains the licence
  seat until explicit inactive-state purge releases or disassociates it.
- Expose the host tenant lifecycle status preflight so clients can read
  authoritative descendant counters without attempting a destructive action.
- Keep GKE `DEPLOY_DRY_RUN=true` independent of the external
  `fabric-multicloud` checkout; the helper repository is resolved only for an
  actual deployment.
- Decrypt DCR-protected device-license documents inside the trusted tenant
  boundary before `License/_search` filtering and projection. Organization
  inventory now retains both initial authority seats after controller DCR,
  while ciphertext and activation material remain absent from responses.
- Keep terminal RelatedPerson purge markers for audit while excluding them
  from current subject-scoped search readback, so a purged caregiver cannot
  reappear as an active relationship in personal portals.
- Mark the local portal/BFF mapping as a VetChain implementation and extension
  guide that defers to the canonical GW CORE document, preventing product GWs
  from forking the reusable base API vocabulary.

## [1.25.23] - 2026-09-01

- Resolve the root host `did:web` at `/.well-known/did.json` while retaining
  the CDS-scoped discovery route, so portal and SDK verification can resolve
  the exact host issuer during the real local Playwright lifecycle.
- Document the isolated VetChain local allocation: GW `3200`, ICA `3210`,
  break-glass test receiver `3220`, PetChain `3281`, Professional `3282`,
  Firestore `3285`, Firebase Auth `3292` and GW readiness `3299`.

## [1.25.22] - 2026-09-01

- Preserve the authenticated bearer subject in explicitly insecure local demo
  mode so animal-care local E2E exercises the same author-authorization checks
  as deployed modes without treating an unsigned token as verified proof.
- Store newly projected DocumentReference, Composition and Communication flat
  claims under version-neutral `org.hl7.fhir.api`; native FHIR retains its R4
  or R5 representation and deprecated contextual prefixes remain read-only.
- Pin `gdc-common-utils-ts@2.7.1` and `vet-data-utils-ts@0.4.5` for canonical
  identity, ISO jurisdiction and veterinary portal contracts.
- Make deterministic JWT fixtures consume the released shared package instead
  of a sibling-worktree path, keeping clean worktree and CI execution portable.

- Verify the fresh wallet signing key during the ordered pre-DCR
  `Token/_exchange` step so individual-controller profile enrollment can reach
  DCR. The embedded public key proves possession only; the verified account
  bearer and one-use activation licence remain the authority, and established
  actors still require registered DCR keys.
- Version search results so the outer DIDComm `payload.body` remains the only
  Bundle: staging returns one match per `body.data[].resource`, while the
  absent deployment setting temporarily preserves the deprecated nested
  reader format during rolling upgrades.
- Apply the response profile consistently to employee, licence, appointment,
  task, medication, digital-twin, related-person, subject and Offer/Order
  searches, with shared fixtures and explicit legacy/current tests.
- Remove the nonexistent `License/_add` endpoint, service declaration,
  validator exception, manager path and OpenAPI surface. Licence inventory is
  created only by organization onboarding or the Offer -> Order lifecycle.
- Pin `gdc-common-utils-ts@2.6.3` for the shared response entry types,
  canonical fixtures and dual-format SDK projection contract.

## [1.25.21] - 2026-09-01

- Make local Fabric release reset remove stale peer-launched chaincode
  containers before recreating the devnet, preventing false endorsement
  failures during the immutable-image smoke.

## [1.25.20] - 2026-08-31

- Model the shared route segment explicitly as
  `businessSectorOrNetworkKind`: tenant routes carry a business sector, while
  host commercial routes carry the exact deployment `networkKind`.
- Reject `test` on a `test-network` host. The network kinds are distinct:
  `test` (in-memory), `local-network`, `test-network`, and `network`.

## [1.25.19] - 2026-08-31

- Corrected in 1.25.20: this version temporarily accepted the distinct
  in-memory `test` network kind on a `test-network` host. Do not deploy it as a
  final runtime.

## [1.25.18] - 2026-08-31

- Resolve host-routed commercial `Order/_batch` controller custody through the
  canonical tenant registry when the DID path contains an official identifier
  rather than the tenant alternate name. The correction is repository-adapter
  neutral and prevents an established controller DCR from falling back to the
  host configuration vault.
- Add a focused regression for the exact official-identifier-to-canonical-vault
  continuation used by the first professional-seat purchase.

## [1.25.17] - 2026-08-31

- Resolve every post-DCR tenant sender from the exact sector-scoped logical
  vault used by `Device/_dcr`. This adapter-neutral correction prevents a
  newly activated tenant controller from being looked up in the unscoped host
  configuration vault when it requests its first professional-seat Offer.
- Add a focused custody regression that keeps host configuration and tenant
  device-profile vaults distinct across Firestore, PostgreSQL, memory and
  future repository adapters.

## [1.25.16] - 2026-08-31

- Bind established DCR request keys to either an exact SMART subject DID or
  the canonical stable actor identifier derived from a trusted OIDC verified
  email/phone. External identity-provider account subjects remain independent
  from actor DIDs; unverified or different contacts still fail closed.
- Add a focused authorization regression proving that a Firebase-style
  provider-local subject can operate the matching organization-controller DCR
  device without sharing keys or weakening registered-key lookup.

## [1.25.15] - 2026-08-31

- Publish and process the explicit tenant-controller
  `entity/org.schema/Offer/_create` route for professional seats. Controllers
  request only quantity and seat class; GW authors price, currency, payment
  methods, identifier and serials, persists the pending Offer under host
  custody, and the existing host `Order/_batch` performs confirmation and seat
  materialization.
- Add unit, service-catalog and asynchronous HTTP/KMS-restart coverage for the
  explicit Offer and Order lifecycle used by the high-level Node SDK.
- Pin VetChain staging to the immutable `1.25.14` image that first repaired the
  encrypted activation payload; the next deployment replaces that pin only
  after the new `1.25.15` image passes the same local gates.

## [1.25.14] - 2026-08-31

- Normalize signed and encrypted high-level SDK activation messages into the
  manager `content.body` contract after their original bytes have been
  verified. `Token/_exchange` and the following DCR can therefore consume the
  activation licence without weakening DIDComm signature or key resolution.

## [1.25.13] - 2026-08-31

- Resolve the accepted Offer from contextualized schema.org Order claims before
  DCR. The reviewed pending controller keys now authorize the first Order
  without attempting to load tenant HMAC keys that do not exist until that
  Order finalizes the tenant.

## [1.25.12] - 2026-08-31

- Verify the host-issued initial access token for encrypted `Device/_dcr`
  requests and project its verified claims into the worker job, matching the
  existing plaintext route without allowing the request body to assert its own
  controller authority.
- Verify the nested DIDComm signature independently from JWE decryption.
  Embedded signing keys remain limited to explicit bootstrap routes; reviewed
  organization/Order keys and registered actor keys remain authoritative.
- Add a high-level secure profile-enrollment 101 and SDK-only BFF snippet.
- Restore Consent, RelatedPerson and research-access integration journeys with
  a deterministically verified actor. Local clinical authors remain
  fail-closed and imported IPS fixtures declare external provenance.
- Correct the phone-only family-controller test pool so its reusable seat is
  bound to the exact Offer/Order, preserving cross-order license isolation.

## [1.25.11] - 2026-08-31

- Make a reverified pre-DCR organization transaction resume an older pending
  registration without replacing its Offer. It may backfill only the same
  controller DID and verified public communication keys; identity or key
  changes fail closed.
- Add a local restart integration that discards queue, async state, managers,
  tenant cache and KMS between transaction and continuation, then proves the
  preserved Offer reaches Order and issues the activation licence. Document
  this focused gate as mandatory before optional local-network and Test Network
  validation.

## [1.25.10] - 2026-08-31

- Make the synthetic IPS ingestion fixture and its integration journeys
  declare the canonical external author URN. The high-level flow now proves
  first-import provenance under strict clinical-author validation without
  treating an unauthenticated demo bearer as author evidence.

## [1.25.9] - 2026-08-31

- Pin the staging gateway rollout to the tested immutable image digest and
  record the matching service release version in its deployment profile.

- Make the staging Test Network admission policy auditable and remove the
  symmetric host-attested-key capability from the verifier and parser.
  The deployment profile pins the exact host issuer, while a live preflight
  requires an active `RESPRSN` signer with an exact public JWK thumbprint and
  rejects the former compatibility property or any portal/GW shared HMAC secret.

- Reject updates and deletes when the stored clinical author does not match the
  authenticated actor, while preserving an external author URN on first IPS
  import. Repeating an external URN is not accepted as source authentication.

- Make active Order replay idempotent only for the same verified controller,
  accepted Offer and activation code, so interrupted setup can resume without
  issuing a second licence or weakening the original binding.

- Fix encrypted first-time organization onboarding before DCR. The host now
  verifies the transaction against the exact communication keys in the
  reviewed controller binding, stores those verified keys and controller DID
  inside the protected pending Offer, and accepts only that same binding for
  `Order/_batch`. No arbitrary envelope JWK becomes authority.
- Route regional official identifiers through their ISO 3166-2 jurisdiction.
  `CA-BC` now owns the tenant DID, URN, collection and operational route while
  `CA` remains the independent postal-address country.

- Separate the current VetChain host coverage (UN M49 `001`, World) from the
  host operator's ISO Canadian jurisdiction (`CA-BC`) in staging, production
  and shared runtime profiles. Multi-region M49 partner routing remains future
  work and does not rewrite tenant legal jurisdiction.

- Accept `Bundle.type=batch` clinical commands attached to `Communication` with
  independent per-entry create/delete results. Persist the verified DIDComm
  issuer as creator evidence; only that creator may delete the subject-scoped
  record by `resource.id`. `request.ifMatch` is optional, but when present its
  weak ETag is enforced with `412` on a stale version; one failed entry never
  rolls back another successful entry. Deleting an erroneous source record also
  removes its correlated digital-twin projection when secondary use is active.

- Separate the veterinary emergency `ETREAT` Consent from each break-glass
  SMART token. Persist and anchor one Consent for up to 24 hours, notify the
  animal controller with a minimized FHIR Communication, and reuse it for
  independently audited tokens lasting at most 15 minutes. Fabric exposes the
  requester organization and jurisdiction while hashing veterinarian, client
  and audience identifiers.
  Artifact registration now owns its canonical `artifact-sc` target instead
  of accepting caller-selected or environment-fallback chaincode names.

- Scope Animal ICA signing custody by environment: staging now uses
  `animal-ica-st-signing-seed`, production reserves
  `animal-ica-prod-signing-seed`, and deployment validation rejects the former
  ambiguous name without rotating the live staging identity.

- Validate Test Network scope only from the signed
  `OrganizationTestNetworkCredential` and `TestNetworkCredential` types.
  Remove the non-schema.org `targetNetwork` requirement from organization,
  representative and service-controller credential subjects and evidence.

- Add the isolated Animal ICA staging overlay and deploy its immutable shared
  runtime with a dedicated namespace, Workload Identity, Firestore/audit
  custody, reserved IP and an Animal ICA signing leaf chained to the common
  offline UNID data-space Root. Preserve Antifraud Foundation's `US-WA`
  Business Number as typed `BN` with registry scheme `US-WA UBI`, and the
  host's `CA-BC` Business Number as typed `BN`; never use EIN, VAT, identifier
  type UBI or a composite tenant id.

- Fix Firestore-backed Offer/Order reads to open the host-owned JWE when no
  in-memory plaintext claim projection exists. Pending tenant bootstrap and
  later commercial license Orders can now recover their authoritative Offer.
  If an older pending record lacks a requested protected index, the authorized
  host reader scans that section and applies the same exact claim filter after
  opening each candidate. The `/host` routing sentinel is not treated as an
  implicit tenant identifier during these administrative reads.

- Allow an OIDC-authenticated host controller to read its pending bootstrap
  Offer through `registry/org.schema/Offer/_search` in strict mode, so an
  interrupted Organization/Order sequence can resume without recreating the
  tenant or weakening other JSON routes.

- Fix initial host-tenant bootstrap when the tenant legal identifier exactly
  matches the already registered host identifier: finalize the tenant without
  submitting the same legal organization to Fabric a second time. Other
  tenants and identifier mismatches retain normal ledger registration.

- Add multi-provider OIDC verification with canonical `iss`/`aud`, standard
  OpenID discovery, conflict-safe compatibility aliases and an explicit
  VetChain beta trust profile for personal, professional and GlobalDataCare.

- Type the canonical `composition` embedded in every public Digital Twin
  `ResearchSubject/_search` result as FHIR `resourceType: "Composition"`.

- Name the local SMART release fixture after its public
  `ResearchSubject/_search` resource and assert that every result carries its
  canonical embedded `Composition`; no public Digital Twin `Composition`
  request remains in the executable release smoke.

- Keep legacy tenants functional after the public Digital Twin aggregate moved
  from `Composition` to `ResearchSubject`: the old read declaration authorizes
  only the replacement search, startup republishes the canonical tenant service
  catalog and removes obsolete twin search routes. Subject Consent lookup now
  reads contextualized HRESCH rules by subject, provider, action and source
  reference so SDK status matches the rule created by `permit` or `deny`.
- Publish Digital Twin discovery through canonical FHIR
  `digitaltwin/.../ResearchSubject/_search` with a `Parameters` array. Basic
  search accepts repeated IPS sections, text, inclusive start date and optional
  end date, then returns each pseudonymous ResearchSubject with its canonical
  embedded Composition.
- Resolve same-tenant veterinary professionals by extracting the legal tenant
  identifier, stable email hash and role from hosted or public organization
  DIDs, and require the matching active protected employee instead of comparing
  hostname aliases or complete DID strings.
- Store private derived text, date and language fields beside projected
  clinical records, strip them from public results, and document/test the
  ResearchSubject, saved-selection and Composition boundaries.
- Seed an explicit direct-email deny in the mandatory research SMART smoke so
  its negative employee case remains valid alongside the broader role permit
  and proves the intended direct-rule precedence on the live ledger path.
- Make the VetChain local release smoke execute cross-portal Digital Twin
  research authorization by default, including provider/consumer signatory
  role and email allow/deny proofs; an explicit skip is diagnostic-only and no
  longer qualifies as release evidence.
- Bind the local inter-tenant research Contract VC to the provider tenant DID
  resolved from its live well-known document, instead of a synthetic hostname
  that cannot match the SMART token issuer.
- Make the native FHIR IPS release fixture carry canonical `Coding.display`,
  allowing GW ingestion to derive `MedicationStatement.code-display` for the
  governed research index without retaining local `code-text`.
- Align the local SMART fixture and release gates with canonical Digital Twin
  search (`Composition.section`, `code-display`, governed date claim) and make
  integration onboarding stories declare their synthetic ICA jurisdiction
  explicitly instead of depending on an untracked developer environment file.
- Separate ConnectHealth index hosting from Antifraud Foundation organization
  admission and from the unassigned billing merchant. Apply the VetChain
  `animal-care` launch offer in USD (free through 2026-12-31, then USD 20 per
  user/month with two seats minimum) without granting `onehealth-research`,
  which remains separately governed and Consent-bound.
- Permit strict-mode JSON only on the Firebase/OIDC-authenticated tenant and
  individual controller bootstrap routes that run before a DCR wallet exists;
  all other plaintext JSON routes remain rejected by the security-mode gate.
- Bind each animal-controller activation seat to its exact card DID, persist the
  authenticated account and actor tuple during DCR, and allow PIN-unlocked SMART
  access without misusing an OIDC identity token as `vp_token`. Require the
  licensed `RESPRSN` role, reject member-role promotion, and verify every
  registered client assertion with the DCR-stored JWKS rather than trusting an
  assertion-header key.
- Make Stripe an explicitly enabled integration so production VetChain hosts
  without payment processing can start safely, and route organization bootstrap
  to `LEDGER_ORGANIZATION_IDENTITY_CHANNEL_DEFAULT` before the human identity
  fallback.
- Synchronize the legacy-controller skill with the Node 101 communication-wallet
  contract: legacy `_activate` avoids a second DCR but still registers the
  role-signing key and the wallet's separate public DIDComm JWKS; private keys,
  protected seed and optional PIN remain portal-owned.
- Add a dedicated VetChain immutable-image release skill and checked-in staging
  and production overlays. Make the shared deploy script product-aware so its
  dry run validates the VetChain sector catalog and target tuple without
  inheriting UNID labels or defaults; keep production blocked until its exact
  infrastructure and custody values are supplied.
- Require host commercial `Order/_batch` to use the configured registry network
  selector (`test`, `local-network`, `test-network`, or `network`) instead of a
  tenant business sector, while retaining DCR-registered sender-key custody.
- Make the immutable-image local Fabric smoke VetChain-native: CA-BC host and
  tenant routing, `animal-care-local`, a clearly synthetic UUID clinic fixture,
  animal-care Consent/SMART paths and regional role-license assertions. Remove
  the inherited UNID container identity and EU/health-care bootstrap defaults.
- Replace the ignored `vendor/` tarball dependency with the exact published
  `vet-data-utils-ts@0.3.0` npm release, and make the release-script gate reject
  Docker or lockfile references to local vendor artifacts.
- Align the GW adapter and local Fabric smoke with the privacy-preserving
  organization-role licence contract: send the bare official identifier,
  serialize sector policy as JSON, omit delegated `maxDevices`, and keep DCR
  installation bindings exclusively in protected GW state.

## [1.25.3] - 2026-08-26

- Project one individual and one pseudonymous research `Composition` per IPS
  section from native `Communication/_batch` ingestion. This replaces the
  earlier combined comma-list projection while keeping direct canonical
  digital-twin writes forbidden.
- Add canonical one-section, multi-resource Digital Twin search using
  `Composition.section`, governed `code-display` plus resource date ranges;
  AND within a resource family, OR across families, deduplicate subjects, and
  default an omitted end date to GW current time.
- Retain derived `code-display` in the private research index while excluding
  local `code-text`, narrative fields and direct identifiers.

## [1.25.2] - 2026-08-26

- Make the local Fabric smoke pass explicit Linux/amd64 CCAAS build arguments,
  allowing the immutable-image release gate to run with Docker's classic
  builder when BuildKit is unavailable.
- Align the GW VET local Fabric release scripts with the shared devnet's
  `Host1MSP`, `host1.example.com`, and `peer0-host1` topology so the immutable
  image smoke validates against the network it actually bootstraps.
- Map the VET smoke to its configured internal port `3000`, matching the
  container runtime profile used by the immutable image.

## [1.25.1] - 2026-08-26

- Clarify and test the controller bootstrap split: legacy
  `Organization/_activate` binds the submitted historical representative key
  without a second DCR, while modern service-controller and employee device
  exchange requires a separately signed trusted OIDC `id_token` for the
  account/email binding. A controller VP proves role authority and cannot be
  used as the `_exchange` email proof.

- Preserve one digital-twin `Composition` per source IPS document/version with
  all indexed IPS section tokens in the same `Composition.section` claim.
  Section-first search now treats that claim as multi-valued instead of
  synthesizing one Composition per section.
- Make subject-level secondary-use withdrawal a reversible digital-twin
  disable. `Consent.purpose=HRESCH`,
  `Consent.action=organization/ResearchSubject.rs`, and
  `Consent.decision=deny` pauses future synchronization without deleting the
  already published anonymous twin, operational clinical data, stable private
  subject alias, or consent audit evidence. A later `permit` rebuilds the same
  twin from current operational records.
- Add index-provider offboarding through
  `individual/.../ResearchSubject/_purge`. It deletes only the private
  individual-to-twin correspondence; the detached anonymous twin remains
  intact, and later enrollment allocates a new UUID.
- Restrict direct digital-twin `Composition/_batch` to researcher working
  selections whose subject is a tenant-registered UUID URN. Canonical writes,
  operational DIDs, and invented UUIDs are rejected.
- Document the portal/index-provider consent as an idempotent rule selected by
  its stable `Consent.identifier`, so future study-specific research consents
  cannot be mistaken for the portal toggle.
- Release GW VET `1.25.0` with the canonical `vet-data-utils-ts` veterinary
  values used by animal-only break-glass policy.
- Reject legacy UHC/generic animal DID aliases during exceptional access; only
  current VetChain card DIDs are accepted.
- Keep exceptional access restricted to verified veterinarians (`ISCO-08|2250`):
  veterinary technicians and assistants (`ISCO-08|3240`) do not inherit it.
- Consume the released `vet-data-utils-ts@0.2.0` veterinary contract instead
  of retaining competing local animal/emergency values.

- Add a cross-repository veterinary MVP readiness checklist covering the
  missing shared data package, veterinary section catalog, GW/DNS deployment,
  portal adapters, controller notifier, chat-node HTTPS service, governed care
  roles and final authenticated animal-card E2E.

- Enforce the shared-package boundary: dependency-light veterinary contracts
  in `vet-data-utils-ts`, SDK builders/parsers in `vet-sdk-core-ts`, and all
  authorization decisions retained in GW VET.

## [1.24.0] - 2026-08-26

- Adopt the reviewed GW CORE break-glass capability for veterinary emergency
  reads. An animal request is confined to `animal-care`, ISCO-08 veterinarian
  occupation `2250`, a ledger-verified professional VP, one animal subject,
  read-only SMART scope and a maximum lifetime of 15 minutes.
- Keep human, research, One Health research, cross-kind and write access
  fail-closed. Persist only coded and hashed evidence to Fabric and require
  controller-notification acknowledgement before issuing the token.

- Resume organization activation after a partial Fabric commit when a newly
  detached-signed VC preserves canonical issuer, type/schema,
  `credentialSubject` and evidence. Reissued envelope metadata is retry-safe;
  a changed veterinary organization identity still returns 409.
- Build host-authored onboarding Offer URNs with the host's legal jurisdiction
  instead of the applicant country. Keep pending registration authoritative
  until mandatory ledger writes succeed, and retain the Offer index on the
  active tenant for deterministic Order replay.
- Return the effective `maxDevices` beside `licenseId` in every successful
  `License/_issue` entry so VetChain portals display the allowance persisted
  on the reserved seat instead of substituting a local default.
- Synchronize the shared controller and commercial Order security contract:
  compat-mode DIDComm plain may carry an optional public JWK, while tenant
  operations use the authoritative DCR-registered `iss + kid` key. Keep
  encrypted professional `Order/_batch` host-routed but resolve its sender
  keys from the issuer tenant, including hosts with historical service
  catalogs that do not advertise the later commercial endpoint.

- Define and test the VetChain animal-individual authority contract: an animal
  is always the individual; its controller may be a person or organization;
  organizations act through explicitly delegated employees; and shelter
  collaborators, members and veterinarians require an exact active subject,
  action and purpose grant. Add deterministic policy JSDoc, ten unit scenarios,
  product documentation and the matching repo skill guardrails.

- Allow a personal Firebase identity without a `tenant_id` custom claim to
  exchange an activation code only in the tenant named by the authenticated
  request route. An explicit organization `tenant_id` claim remains mandatory
  to match that route exactly.
- Preserve phone-only individual-controller onboarding as phone identity
  evidence when materializing the controller licence instead of incorrectly
  storing the telephone number as an email address.
- Recognize a provider-issued `IndividualControllerCredential` as first-party
  authority only for its exact actor, animal subject, relationship and issuer,
  without requiring the controller to grant a separate Consent to itself.
- Initialize the independent VetChain GW from committed GW UNID baseline
  `bda3fce77f7cc28703dfbb3d4afc5ea456f547e6`, without copying its dirty
  working tree.
- Add explicit VetChain staging and production profiles for tenant Business
  Number `704457076`, `CA-BC` routing, `CA` certificate country and the
  `beta-gw.vetchain.app` / `<retired-private-product-alias>` hosts. The tenant id remains
  the bare Business Number and is never a composite identifier.
- Rebase the single-tenant local bootstrap on the same bare `BN`, `CA-BC` and
  `animal-care` contract, while allowing `onehealth-research` alongside the
  animal sectors.
- Accept nine-digit Canadian Business Numbers as subject-index provider ids,
  prefer `VET_PROVIDER_*` runtime variables and retain `UHC_PROVIDER_*` only
  as migration aliases.
- Separate the X.509 country code from a more specific business jurisdiction
  and document the GW VET-first selective promotion policy.
- Define cumulative Test Network organization assurance: official registry
  provenance, representative-certificate PDF signature and postal verification
  remain distinct controller-added identity evidence instead of being
  collapsed into one verified flag. Evidence mutation requires an authorized
  controller; verifier status cannot be self-asserted.

- Register every assigned professional, legal-representative and controller
  licence through `rolelicense-sc` on the regional organization identity
  channel. The SHA3-384 identity uses official organization id, stable hashed
  contact and licensed role; controller seats use `RESPRSN`, while ISCO
  occupation remains a separate credential fact.
- Persist exact/catch-all sector policy and concrete DCR host/installations on
  the ledger. Exact sector deactivation revokes only matching devices; global
  revocation remains separate, and `maxDevices: null` delegates to the shared
  GW/portal default.
- Remove the professional `License/_add` shortcut in every environment.
  Test Network now follows the same Offer, Order, invoice/payment verification,
  seat materialization and ledger registration path as production.
- Require an available professional seat for every current `Employee/_batch`
  create. With no seat, return a commercial Offer without creating a partial
  employee; a future import workflow must use its own explicit operation
  instead of a private claim or environment-controlled bypass.
- Derive employee Offer jurisdiction and sector from the authoritative tenant
  URN. License persistence uses the job sector, and the legacy activation
  exchange requires a sector in its verified token; no runtime path silently
  substitutes `us` or `health-care`. The host jurisdiction fallback is defined
  once in server configuration as `es`.
- Require payment method and invoice/payment evidence for portal-managed
  zero-price Test Network orders so seat materialization exercises the same
  Offer/Order and invoice path as paid deployments.
- Persist employee-seat Offers with the shared Offer/Order searchable index so
  the following `Order/_batch` resolves the exact Offer instead of returning a
  nested 404.

- Retain `License/_add` only for individual-member pools; professional seat
  purchases must use the commercial Offer/Order contract.
- Decrypt protected device-licence records before projecting public tenant
  controller status, so a completed historical DCR is reported as `dcr_active`
  instead of remaining incorrectly at `credential_issued`.
- Complete controller and employee DCR against the tenant registry's resolved
  physical collection while licences and device profiles remain in the logical
  vault. Protected and historical plaintext licence records are both read and
  rewritten encrypted, and DCR now fails with `409` before persisting a client
  when its licensed identity cannot actually receive the submitted keys.
- Make GW UNID organization activation safe to retry after a partial Fabric
  commit. The gateway now uses the idempotent `EnsureOrganization` and
  `EnsureKey` contracts, groups public and hosted DID verification-method
  aliases by JWK thumbprint, and writes one key/binding per physical key while
  retaining all alias ids as metadata.
- Inspect Fabric Gateway endorsement details so deterministic organization or
  key incompatibilities return activation conflict (`409`), while a generic
  endorsement `ABORTED` remains a retryable server error.

- Make `onehealth-research` an enforced GW UNID deployment invariant: the
  checked-in GKE profile includes it in canonical `ALLOWED_SECTORS`, the
  release script refuses an invalid UNID profile, propagates the catalog to
  the Kubernetes Deployment, and verifies the effective post-rollout value.

## [1.23.10] - 2026-08-20

- Repair an exact two-seat initial professional inventory by converting its
  free second seat into the contact-free technical-controller reservation.
  Inventory therefore reports both initial licences as assigned before the
  later binding/DCR, without replacing a historical professional seat.

## [1.23.9] - 2026-08-20

- Resolve historical employee records through the authoritative tenant
  registry/cache mapping during startup reconciliation, with deterministic and
  logical collection names as read-only fallbacks. This restores missing
  public controller references when the physical collection name predates the
  current normalized naming scheme.

## [1.23.8] - 2026-08-20

- Reserve the first two seats of newly registered professional organizations
  for the verified legal representative and a contact-free technical
  controller binding. `Organization/_issue` reuses that second reservation
  instead of consuming another employee seat.
- Preserve historical inventories exactly: when the second seat already
  belongs to a professional, GW never reassigns it and never creates an
  implicit third controller seat. A later technical controller must wait for a
  newly added or purchased licence before completing its binding.
- Repair a missing historical representative reservation at startup from
  protected, verified tenant claims without evicting an existing member, and
  restore only controller DID references backed by active protected employee
  records.
- Allow controller-authorized zero-cost professional `License/_add` in
  non-production `test` (in-memory), `local-network`, and `test-network`;
  `prod` or `network` remains on the signed payment and ledger-verifiable Order
  path. New seats support five independently revocable
  device/channel bindings.

## [1.23.7] - 2026-08-20

- Read and persist employee records in the tenant's resolved physical
  collection while keeping licences in the logical tenant vault.
- Keep employee creation and licence issuance as separate operations so
  create-plus-issue returns the activation credential reliably.
- Reconcile legacy representative re-registration to two employee seats
  without replacing technical controllers, synchronize outer and inner active
  licence status, and default new organization offers to two seats.
- Raise the default per-seat installation allowance from two to five
  independently revocable device/channel bindings.
## [1.23.6] - 2026-08-20

- Replace tenant/sector legacy allowlists with deployment-wide
  `HOST_LEGACY_REPRESENTATIVE_CONTROLLER` compatibility for portals that
  historically register every organization through the legal representative.
  Preserve normal VP and credential trust checks, modern service-controller
  onboarding, and live GKE propagation after shared manifests are applied.

- Build bootstrap controllers with the shared `buildProfessionalDidWeb(...)`
  and `normalizeSameAsHash(...)` contracts. Internal `urn:gdc:*` identifiers
  and portal-specific card/profile DIDs remain aliases; the tenant controller
  reference, employee record and public DID document use one operational DID.
- Resolve controller DID documents from their protected employee records,
  including multiple controllers and historical containers whose storage id
  differed from the embedded DID. Deduplicate the primary controller JWK when
  forwarding additional JWKS to ICA DID registration.

- Resolve legacy lowercase `did:web` discovery requests for VAT tenants against
  their canonical uppercase tenant identifier, without changing opaque tenant
  paths or the canonical DID document returned by GW.
- Add the safe tenant lifecycle resource
  `/.well-known/tenant-status.json`, separating missing controller binding,
  issued controller credentials and completed DCR while exposing only
  controller DIDs and public key identifiers.
- Restore the GlobalDataCare legacy representative
  controller flow for `_activate` and `_transaction`, including idempotent
  existing-tenant re-registration and controller-key rotation without pinning
  credential ids, issuers or kids. Preserve independently registered service
  controllers and avoid creating another Offer or Order during re-registration.
- Accept secure asynchronous polling requests with `thid` protected inside the
  form-encoded `request=<JWE>` envelope, matching the SDK submit-and-poll
  transport contract for every `*-response` endpoint.

- Make a verified legacy `Organization/_activate` re-registration of an
  existing tenant complete directly with `200`; it updates the historical
  representative controller without an Offer, Order, payment, license, or
  second tenant provisioning.

- Document one policy-driven UNID tenant migration contract for local
  `test -> local-network`, the legacy GlobalDataCare Test Host -> independent
  UNID Staging Test Network split, and Test Network -> Production, including
  destination Organization/controller admission, fail-closed employee-seat
  parity, real-encryption versus demo handling, resumable audit states and a
  signed controller report.
- Add structured `operation_outcome_error` logs for HTTP failures, failed
  entries inside HTTP 200 batch responses, and worker results before DIDComm
  encryption. Logs expose status, issue metadata and correlation fields while
  omitting request and response payloads and redacting tokens in diagnostics.
- Make `ALLOWED_SECTORS` the authoritative explicit gateway sector catalog,
  retain `SECTORS_ALLOWED` and `MAINSECTOR` + `SUBSECTORSALLOWED` only as
  deprecated fallbacks, and configure UNID Test Network explicitly for
  `health-care`, `health-research`, `health-tech`, and the existing
  `onehealth-research` tenant identifier.

## [1.23.5] - 2026-08-16

- Synchronize the GW CORE Test Network fix that separates review authorization
  from postal-address verification. Admission no longer requires or persists
  `postalActivationLicense`; GW Order issues the controller activation
  credential later consumed by exchange and DCR.

## [1.23.4] - 2026-08-16

- Use the canonical HL7 v3 ActReason `HRESCH` for healthcare-research SMART,
  Consent, and inter-tenant contract authorization.
- Remove the non-FHIR `Composition.branch` and `Composition.branch-version`
  claims from researcher selections; ownership and recovery use standard
  `Composition.identifier`, `subject`, `author`, and `meta.tag` metadata.
- Enforce employee-private digital-twin worksets from the authenticated SMART
  subject: tagged Composition searches are scoped to that hosted employee DID,
  and saved-selection writes reject a different client-supplied author.
- Project individual clinical ingestion into a minimal research-safe digital
  twin: retain a private stable subject alias, replace identifiers and
  subject references, remove patient and free text/display/narrative claims, and
  exclude identity-bearing Patient, RelatedPerson and Consent resources.
- Permit `DigitalTwinReader` for a verified employee of the provider tenant
  without an inter-tenant contract; foreign organizations still require the
  matching contract and consent policy. Research SMART scopes now expose the
  pseudonymous twin subject instead of the operational individual DID.
- Replace free-text twin search examples and E2E cases with coded FHIR claims.
- Publish `digitaltwin/Composition/_batch` for FHIR tenants so researchers can
  persist ledger-safe tagged working selections between coded discovery and
  `ResearchSubject/$summary`. Preserve that route for existing tenants whose
  stored service declaration exposed only Composition search, and prove the
  public batch-to-`Composition.meta-tag=system|code` lifecycle.

## [1.23.3] - 2026-08-16

- Clarify the image-neutral `local-network`/`test-network`/`network` release
  boundary in the repository skill and enforce that runtime `.env` profiles
  are excluded from Docker images.
- Synchronize the GW CORE Test Network admission contract: accept only
  `resource.organizationTestNetworkCredential` plus exactly three reviewer-
  signed domain VCs, return only those domain VCs in `vc[]`, and retain no
  authorization-named credential alias.
- Consume `gdc-common-utils-ts` 2.5.7 and bind controller identity to
  `resource.controller.email`, independently from the legal representative.
- Keep existing-tenant reissue responsibilities separate: GW projects the
  ICA-issued `ServiceControllerCredential` into the controller employee and
  tenant DID, while consuming BFFs persist the organization, representative
  and controller VCs in their own databases.

## [1.23.2] - 2026-08-13

- Refresh Firebase and Google Cloud runtime dependencies and enforce audited
  transitive versions; the production dependency tree now reports zero known
  vulnerabilities.
- Migrate Firebase Admin usage and Firestore tests to the modular v14 app,
  auth and firestore entry points.
- Consume the canonical three-credential ICA activation proof: organization,
  legal representative and service controller. Validate controller authority
  and key binding on `ServiceControllerCredential`, independently from the
  representative's professional ISCO occupation.
- Match canonical medication `code-display` and `code-text-local` search claims
  alongside their historical compact spellings.

- Add controller-authorized `Device/_revoke` support for one selected employee
  installation. Revocation removes that device's DID verification methods,
  revokes its ledger bindings and profile, and preserves the employee seat and
  every other active installation.

- Accept Test Network organization registration only when an active UNID
  reviewer/controller in the host signer registry unlocks their existing
  wallet and adds the ML-DSA-65 authorization proof. The MVP registry binds
  the employee actor DID, hashed normalized email, `RESPRSN` role and
  revocation state; a Fabric-backed policy can replace the registry later.
- Verify the host-attested reviewer key, persist the protected postal binding
  as server-owned pending metadata, and redeem the exact physically delivered
  activation/licence code. Do not generate a second `lic-*` code.
- Keep Test Network authorization fail-closed outside the `test-network`
  runtime and route; production organization registration remains ICA-backed.

- Restore ICA-compatible simple actor aliases as
  `urn:multibase:<contact-hash>`, keep authorization roles separate, and use
  the bare HL7 v3 `RESPRSN` code for organization controllers.

## [1.23.1] - 2026-08-10

- Refresh compatible transitive runtime dependencies to remove all critical
  and high npm advisories from the production dependency tree, without forced
  or breaking-version upgrades.

## [1.23.0] - 2026-08-10

- Allow an explicit immutable release tag to replace the previous deployment
  digest before publishing the already-tested local image; retain the digest
  unchanged when no new tag is requested.
- Require `gdc-common-utils-ts@^2.5.0` for the canonical Subject identity
  collection and deterministic locator contract.
- Replace the private `SubjectIdentifier` pseudo-resource with the neutral
  `Subject` collection over semantic `Person`, `Animal` and future `Place`
  Bundle entries. Add encrypted card-scoped batch/search/delete handling,
  deterministic SHA3-384 `type|jurisdiction-or-empty|value` lookup (including
  global microchip `||` plus optional regional aliases), optional Fabric card/provider resolution,
  current-state erasure, runtime routing, 101 and audit evidence.

## [1.22.1] - 2026-08-09

- Sync CORE's stable actor contract:
  `urn:multibase:<hash(normalized email or phone)>:professional|personal`.
  Fabric DCR/revocation bindings use the URN while portal DIDs remain audit
  metadata; IdP-local `sub` values never define seat identity.

## [1.22.0] - 2026-08-09

- Consume Common Utils 2.4.0 for neutral SubscriptionTopic matching,
  notification Bundles and multi-device seat models.
- Consume the GW CORE multi-device seat contract: two portal/device DCR clients
  can coexist for one professional or individual-member license without
  revoking the first device or its current key bindings.
- Consume the GW CORE SubscriptionTopic matcher and encrypted rest-hook outbox;
  no UHC-specific duplicate Subscription implementation remains.
- Added encrypted FHIR R5 `Subscription/_batch` registration for tenant/BFF
  (`entity`) and exact-subject (`individual`) scopes. Device push delivery is
  intentionally a separate BFF fan-out concern.
- Persist RFC 7591 `software_id`, `software_version`, and `application_type`
  metadata with DCR device profiles.

## [1.21.33] - 2026-08-09

### Added

- Preserve a governed legal-organization controller DID and all submitted
  public JWKS during activation, reference that DID from the tenant DID, and
  resolve its separate multikey `did:web` document at the canonical employee
  DID path.

## [1.21.32] - 2026-08-05

### Fixed

- Repair only missing `Organization.sameAs` and member-role claims when an
  owner-plus-nickname onboarding retry finds a legacy individual record. The GW
  preserves existing card identities and returns the authoritative Organization
  id so portal and telephone clients can recover the same card.
- Collapse historical versions sharing one business identifier in `$summary`
  and rehydrate canonical
  claims into native FHIR fields such as Immunization occurrence/lot data.
- Preserve CORE's unambiguous legacy fallback for single-section records that
  predate the explicit `Composition.section` membership claim.
- Consume Common Utils 2.3.27 and keep clinical indexes/readback on canonical
  `org.hl7.fhir.api` search-parameter claims for the complete IPS round-trip.

## [1.21.31] - 2026-08-04

### Fixed

- Pin Stripe `20.4.1` in both the manifest and lockfile so local typechecking
  and immutable Docker builds use the same `2026-02-25.clover` API contract.

## [1.21.30] - 2026-08-04

### Added

- Persist subject-linked identifiers through `SubjectIdentifier/_batch` and
  `_search` as encrypted, subject-scoped tenant-vault records. The manager
  verifies the bearer subject/controller binding and never indexes or anchors
  raw identifier values, assigners, or validity dates.

### Fixed

- Align Stripe client initialization with the installed SDK's
  `2026-02-25.clover` API contract so immutable-image release typechecking
  succeeds before Docker build.

## [1.21.28] - 2026-08-04

### Security

- Treat malformed and boundary-ended Consent periods as inactive, reject new
  SMART issuance after expiry, and cap every issued token `exp` at the earliest
  applicable `Consent.period-end`.

### Fixed

- Recognize an individual Organization when its authenticated controller has
  either `Organization.owner.email` or `Organization.owner.telephone`. Google
  email-only creation, including a first represented-person card, no longer
  gets misclassified as legal-organization onboarding that requires `Person`
  claims.
- Repair only missing `Organization.sameAs` and member-role claims when an
  owner-plus-nickname onboarding retry finds a legacy individual record. The GW
  preserves existing card identities and returns the authoritative Organization
  id so portal and telephone clients can recover the same card.
- Allow the portal BFF to recover every individual Organization indexed to an
  exact verified owner email/telephone without a browser-known nickname,
  returning a deduplicated searchset for cross-browser card recovery.

## [1.21.27] - 2026-08-03

### Fixed

- Match the canonical ISCO role stored by GW UNID (for example,
  `org.ilo.isco-08|2211`) with the equivalent compact role carried by a
  verified professional DID or VP (`ISCO-08|2211`). The SMART evaluator still
  denies unrelated occupation codes after normalization.

## [1.21.26] - 2026-08-03

### Changed

- Synchronize the GW CORE Communication boundary: portals and SDKs exchange
  signed/encrypted `Communication` resources, while `Subject/$summary` and
  `Bundle/_search` remain internal GW projection operations.
- Add the visual GW contract map to the integrator documentation and `/api-docs`,
  and keep generated OpenAPI CORE/compatibility/extension profiles aligned.

### Fixed

- Persist the individual controller's public `Organization.sameAs` on the
  active ONESELF license during onboarding, repair historical missing bindings
  during exact controller lookup, and keep portal and telephone discovery on
  the same authoritative GW record.
- Preserve failed SMART token polling responses on stderr in the immutable-image
  release smoke, including when the request runs inside command substitution,
  so a denied release gate retains the authoritative gateway error.
- Make the mandatory same-portal SMART smoke create and anchor its own exact
  subject, professional DID, purpose and IPS-document Consent rule before
  token issuance instead of depending on an unrelated generic ConsentAccess
  smoke or a mutable license email projection.
- Let the plaintext compatibility DCR route validate its host-issued
  `initial_access_token` directly instead of first rejecting it as though it
  were a Firebase or controller-proof bearer.

## [1.21.24] - 2026-08-01

### Fixed

- Reconcile a persisted host DID identifier against `HOST_EXTERNAL_DOMAIN` so
  an earlier Kubernetes-internal `*.svc.cluster.local` bootstrap cannot remain
  published through the public host-scoped `did.json` endpoint. The migration
  rebuilds verification-method identifiers and reissues the host legal
  participant/self-description VCs with the existing host keys and claims.
- Stop publishing the private KMS labels `comm_sig` and `vc_sign` as JWK
  members. DID documents now place the communication ML-DSA key under
  `authentication`, both ML-DSA/ES384 credential keys under `assertionMethod`,
  and ML-KEM under `keyAgreement`.
- Resolve Common Utils tests through the declared npm dependency instead of a
  non-existent sibling checkout under `custom`.
- Resolve the local ConsentAccess smoke renderer through the same declared
  Common Utils package exports, so release validation also works from the
  canonical `custom/uhc-unid-gw-node` checkout.
- Apply the same package-export boundary to the SMART/IPS release renderer;
  neither mandatory smoke now depends on a sibling Common Utils source tree.
- Resolve GW CORE and `fabric-multicloud` from the workspace root when local
  smoke or GKE deployment runs from the product repository under `custom`.
- Apply the same workspace-root resolution to every Fabric env/bootstrap
  helper and legacy Compose CA mount used by the UNID product checkout.
- Correct the deeper `chaincode/scripts` workspace calculation for both local
  and test-network ConsentAccess deployers.
- Route host `Organization/_transaction` verification to the ICA path section
  selected by `NETWORK_MODE` (`local-network`, `test-network`, or `network`),
  while preserving `terms` as the compatibility alias for `test`.
- Allow an explicit `FIREBASE_ADDITIONAL_AUTH_PROJECT_IDS` list of portal
  authentication issuers while retaining `FIREBASE_PROJECT_ID` as the primary data project;
  each token is still fully verified against its allowlisted audience.

## [1.21.23] - 2026-07-30

### Fixed

- Resolve accepted individual-member licenses by verified telephone as well as
  email, so a phone invitation remains discoverable after activation.
- Index every `Organization.sameAs` alias and allow the accepted-license
  readback to resolve one exact authorized subject without scanning hosted
  individuals or requiring controller contact claims.
- Narrow read-only `organization/Composition` SMART scopes to the sections
  actually granted by authoritative Consent rules.
- Require an exact active individual-member license for the actor, subject and
  role before accepting a member VP for SMART access; use the accepted
  license's verified contact when evaluating Consent.

### Dependencies

- Raise `gdc-common-utils-ts` to `^2.3.15` for the shared SMART-scope
  projection and complete IPS fixture contract.

## [1.21.22] - 2026-07-30

### Fixed

- Reconstruct IPS Composition sections from each indexed resource's
  `Composition.section` claim instead of copying every shared
  Observation/Condition collection into every compatible section.
- Persist and return the IPS alert (`Flag`) and medical-device
  (`DeviceUseStatement`) sections during Communication import and
  `Subject/$summary` readback.
- Keep the Stripe API version literal aligned with the reproducibly installed
  Stripe 20.2 SDK.

### Dependencies

- Raise `gdc-common-utils-ts` to `^2.3.13`.

### Changed

- Mark the gateway as a private npm project, add a failing `prepublishOnly`
  guard, and document that releases are immutable container images deployed by
  digest, never npm packages.

## [1.21.21] - 2026-07-30

### Dependencies

- Raise `gdc-common-utils-ts` to `^2.3.12` so deployed gateways consume the
  complete IPS all-section claims, localized coded-name and fixture contract.

## [1.21.20] - 2026-07-29

### Fixed

- Preserve canonical `<ResourceType>.code-text`, `code-display` and `language`
  claims when projecting native FHIR resources; compatibility aliases can no
  longer replace manual text with `system|code`.
- Rehydrate canonical `code-display` claims into `Coding.display`.

### Changed

- Consume the official all-sections IPS fixture from
  `gdc-common-utils-ts/fixtures` instead of maintaining a gateway copy.

### Dependencies

- Raise `gdc-common-utils-ts` to `^2.3.9`.

## [1.21.19] - 2026-07-28

### Fixed

- Accept the independently addressable historical `onehealth-research`
  compatibility sector alongside the canonical health sector matrix.
- Bind a newly consumed employee license to the employee email and canonical
  role as well as its subject id, so the subsequent `License/_issue`,
  `Token/_exchange` and DCR flow can reuse the seat and register the employee
  device keys on `identity-eu`.

### Changed

- Split identity ledger routing: natural-person individuals remain on
  `identity-global`, while EU organizations, employees/controllers, locations,
  keys, identity evidence and identity events use `identity-eu`.
- Preserve the Root governance controller as a global person/key commitment
  referenced by its regional organization relationship.
- Separate controller approval from the privileged infrastructure reconciler
  that updates channel membership, joins selected peers and activates the
  committed chaincodes.

### Dependencies

- Raise `gdc-common-utils-ts` to `^2.3.8`.

## [1.21.18] - 2026-07-27

### Fixed
- Resolve Fabric composition and organization/device ledger writes from the
  provider selected for the active `NETWORK_MODE`; `test=mem` no longer opens
  Fabric because `test-network` or `network` map to Fabric.
- Accept process-owned `HLF_CONNECTION_PEER`, `HLF_CONNECTION_PEM`,
  `HLF_CERTIFICATE`, and `HLF_PRIVATE_KEY` as the canonical GW Fabric
  connection contract while retaining MSP-suffixed deployment variables as a
  compatibility fallback.

### Added
- Synchronize the authored `subjectkeybinding-sc` runtime sources, tests and
  lifecycle documentation from GW CORE, keeping key assets and subject-key
  relationship state as separate Fabric concerns.
- Accept the `insurance` specialization for both `animal` and `health`
  deployments and expose the complete staging sector matrix.

### Changed
- Synchronize GW CORE `1.20.17` documentation for subject summary, SMART
  individual self-read, DID endpoint resolution, Fabric loaders and
  multi-cluster peer connectivity while preserving the GW UNID extensions.

### Tests
- Cover active-mode ledger selection, canonical and compatibility Fabric
  connection variables, scoped-v2 `test` isolation, device replacement ledger
  bootstrap, subject-key binding behavior and expanded Composition search.

## [1.21.17] - 2026-07-24

### Fixed
- Process canonical Communication operation references and attachments directly
  from `resource.meta.claims`; manager execution no longer manufactures a
  native FHIR `payload[]` before running `Subject/$summary`, subject search or
  attached clinical projection.
- Keep native FHIR Communication payloads as a compatible input projection
  without making API claims-first jobs depend on R4 field materialization.
- Normalize native EHR FHIR resources through the shared
  `normalizeClaimsFromFhirResource(...)` boundary before indexed persistence;
  existing `resource.meta.claims` remain authoritative when present.

### Tests
- Add a claims-first `$summary` unit flow that executes the attached Parameters
  while asserting the incoming Communication has no native `payload[]`.
- Retain native FHIR Communication unit coverage alongside the claims-first
  flow so neither interoperability direction can silently replace the other.

## [1.21.16] - 2026-07-24

### Fixed
- Synchronize GW CORE clinical Communication handling: claims-first API
  Communications now restore `$summary` references, attached Parameters and
  section-update attachments instead of returning an empty read.
- Remove the invented medication section, index explicit
  batch/collection section updates, and preserve the Composition section graph
  in API summary responses for SDK readers.

### Tests
- Reuse the portal Playwright contract that writes one allergy section through
  the public SDK and reads its full claims back through `Subject/$summary`.

## [1.21.15] - 2026-07-24

### Fixed
- Consume reminder authorization helpers through the supported
  `uhc-sdk-core-ts/reminder-permissions` package export, keeping GW UNID
  compatible with strict ESM package exports during Docker builds.

### Changed
- Raise the UHC extension baseline to `uhc-sdk-core-ts@^0.3.3`.

## [1.21.14] - 2026-07-24

### Fixed
- Accept both OpenID DCR `application_type=web` and `native`, aligning GW UNID
  with protected browser profile enrollment from the UHC Node SDK.

### Changed
- Raise the runtime baseline to `gdc-common-utils-ts@^2.3.6` and
  `uhc-sdk-core-ts@^0.3.2`.

### Added
- Add the repository-local `gw-unid-local-image-release` skill with explicit
  local-network, immutable image, isolated client configuration, digest rollout
  and future VetChain adaptation gates.
- Add a containerized local Fabric smoke that validates the selected GW image
  against consent and SMART local-network flows.
- Add a checked-in GW UNID GKE runtime profile and release-script contract
  checks.

### Documentation
- Distinguish total Bundle entries, top-level UI-visible resources and
  section/type/date-filtered resources in the mirrored clinical lifecycle.
- Teach the immutable `FhirDocumentFacade` section/type/clinical-date-range
  chain in the mirrored lifecycle 101 instead of raw Bundle-query filter
  fields or separate FHIR date/Period setters.
- Complete the mirrored GW lifecycle 101 with the Communication
  `Subject/$summary` read path and concrete section, count, entry and
  section/type/date resource-consumption examples.

### Fixed
- Build Docker images from the GW repository context instead of the workspace
  parent, exclude local dependencies/artifacts from the context and default
  release images to `linux/amd64`.
- Make GKE deployment reuse the tested local image, honor explicit immutable
  tags, resolve the pushed digest, wait for rollout and verify public health and
  API-docs endpoints.
- Allow Docker-local profiles to map their configured internal GW port instead
  of assuming every container listens on port 3000.
- Allow local Fabric preparation without starting a host TypeScript GW process,
  so the container under test is the only gateway serving the smoke flow.
- Resolve the local ConsentAccess chaincode from its canonical GW CORE source
  when the historical UNID copy lacks the ignored `lib/` implementation.
- Package all generic identity chaincodes from their canonical GW CORE owner
  during the UNID local-network image smoke.
- Wait for Fabric commit status in the common write helper and reject invalid
  transactions, so successful asynchronous responses imply durable ledger
  state before the connection is closed.
- Derive local ConsentAccess smoke assertions with GW UNID's deployed
  blockchain projection while continuing to reuse the canonical shared consent
  examples, preventing false failures when shared helper projections evolve.
- Delete the optional card alias from individual demo overrides using the
  correct JSON-pointer-key expression, allowing the SMART smoke baseline to run
  when no UHC identifier is supplied.
- Override the canonical contextualized accepted-offer claim in individual
  demo orders and fail the script unless the asynchronous order returns `201`.
- Build SMART smoke `client_assertion` JWTs for the exact token endpoint
  audience instead of the tenant organization DID.
- Keep SMART token progress logs on stderr so command substitution returns
  parseable JSON only.
- Include the canonical shared consent attachment in live research consent
  fixtures so they satisfy the current Consent ingestion contract.
- Keep the GW UNID image-release gate scoped to same-portal individual SMART
  access; the cross-portal research matrix remains an explicit opt-in smoke.

### Documentation
- Document the deny-by-default cross-portal subject-binding issuer allowlist in
  canonical and staging environment profiles, including reciprocal GW
  configuration and the identities that must never be allowlisted.
- Distinguish the externally routable `HOST_PUBLIC_URL` from Kubernetes
  `ClusterIP` and GKE control-plane addresses.

### Fixed
- Configure the staging Kubernetes Service manifest as an external
  `LoadBalancer` backed by the reserved `uhc-unid-gw-staging-ip`, so
  `/host/ping` and `/api-docs` can be reached outside the cluster.

## [1.21.13] - 2026-07-23

### Added
- Define and test the public DID Web profile for scanned UHC cards and PETDs,
  keeping physical support, person/animal, controller, index service and HTTPS
  endpoints as separate identities and rejecting private JWK material.
- Add the individual-member `License/_claim` action. It activates one uniquely
  matching issued seat using the exact authorized subject and
  upstream-verified email/telephone, then removes the reusable code.
- Add the v2 scanned-physical-identity access guide with explicit implemented,
  compatibility and target workflow boundaries.

### Fixed
- Stop treating a physical card DID from `Organization.sameAs` as the
  individual's `authorizedSubjectDid` in the deprecated embedded registration
  flow. The card remains an exact lookup alias, not an authorization grant.
- Persist FHIR Communication category and topic in subject-scoped channel
  projections so typed access-request inbox searches work after write.

## [1.21.12] - 2026-07-23

### Added
- Accept a verified `SubjectIdentityBindingCredential` for individual
  self-read when the authenticated portal DID and the indexed individual DID
  differ.
- Require the binding issuer to be configured in
  `SUBJECT_IDENTITY_BINDING_TRUSTED_ISSUERS`, with matching sector and active
  validity.

### Fixed
- Transform the published ESM-only task runtime in Jest so integration tests
  execute from a clean npm install.
- Import UNID reminder permissions from their concrete SDK module instead of
  the aggregate UHC barrel, avoiding duplicate transitive re-exports in Jest.

### Security
- Keep UNID/UHC card DIDs as physical lookup identifiers. Authorization uses
  the card DID Document `subject`; arbitrary `alsoKnownAs` values remain
  insufficient.
- Keep professional/family Consent and research FHIR `Contract` authorization
  separate from individual self-read.

## [1.21.11] - 2026-07-23

### Fixed
- Preserve an explicit public `organization.did` through the legal
  organization `_transaction` and `Order/_batch` flow.
- Keep `did:` and `urn:` aliases intact in DID binding while normalizing
  domains and HTTP aliases to HTTPS.

## [1.21.10] - 2026-07-23

### Fixed
- Keep the SMART inter-tenant `Contract` VC gate on digital-twin research
  capabilities. Individual self-read remains subject-scoped and no longer
  fails when its public DID root differs from the operator DID.

## [1.21.9] - 2026-07-22

### Fixed
- Keep the sector first in research channel families:
  `health-research-<jurisdiction>` and
  `animal-research-<jurisdiction>`.

## [1.21.8] - 2026-07-22

### Documentation
- Correct Fabric authorization so channel grants belong to an ICA-accredited
  organization accepted by host governance, while professional role/licence
  is a second internal action boundary. Define multi-species veterinary,
  emergency, One Health research, IT, government, insurance and global travel
  channel families with a minimal staging subset instead of requiring every
  target channel for the MVP.

### Changed
- Route multi-species veterinary professional and professional-device key
  purposes to `identity-<jurisdiction>` in the animal trust domain, while pet
  identity, ownership, provider-index, PETD and clinical purposes remain in
  `animal-pet-<jurisdiction>`.

## [1.21.7] - 2026-07-22

### Added
- Add typed region-final Fabric channel construction and separate human and
  animal subject-target adapters under `src/subjects/human` and
  `src/subjects/animal`.
- Add the normative GDC Human Health versus VetChain Pets network/channel and
  resource-chaincode matrix, with PETD explicitly marked as a target contract.

### Documentation
- Define the identity-ledger bootstrap order: governance-executor organization
  first, then its Root CA controller employee/person and canonical
  `hasCredential.material` commitment.
- Document the implemented GW role of `subjectkeybinding-sc`: write-only
  derived audit/lifecycle state today, with reverse lookup and authorization
  enforcement explicitly not implemented.
- Define the future split boundary: human adapters remain with GDC GW and
  animal adapters move to the dedicated VetChain GW without changing Core.

## [1.21.6] - 2026-07-22

### Documentation
- Keep the host PDF free of Fabric channels, permissions, block-zero hashes and
  chaincode policy. Root governance configures channel read/write membership
  separately and Fabric provisioning injects technical fingerprints.
- Correct the Root CA controller trust chain: the employee/person
  `hasCredential.material` RFC 9278 URN is the canonical subject-to-key binding;
  auxiliary subject-key/key registries are derived lifecycle indexes. Document
  the missing one-time Fabric bootstrap transaction and keep Fabric-CA X.509
  credentials separate from the controller's public post-quantum JWK.

### Added
- Synchronize GW Core scoped-v2 storage and Fabric ledger binding into GW UNID,
  preserving the UNID package identity and extension routes.

### Fixed
- Let new `staging/test-network/scoped-v2` MVP deployments start without
  genesis hashes or a per-host chaincode allowlist. `prod` or `network` still
  require live block-zero verification.
- Make scoped-v2 startup verify all live Fabric genesis fingerprints before
  infrastructure bootstrap, validate every persisted binding before one
  combined binding write, and initialize host KMS keys only after ledger
  protection succeeds.
- When genesis verification is enabled, enforce its bound host channel ceiling
  without introducing a per-host chaincode allowlist. MVP chaincode operations
  remain governed by GW licensing/actor policy and Fabric policy.

## [1.21.3] - 2026-07-21

### Fixed
- Store the Gaia-X ServiceOffering terms evidence as the SHA-256 hexadecimal
  digest of the uploaded document bytes. LegalPerson no longer depends on
  terms or synthesizes a hash from a URL.
- Keep a public encryption-kid owner index so bounded key-cache eviction does
  not prevent legacy polling from decrypting host- or tenant-addressed JWE
  responses.
- Align family lifecycle and gateway crypto tests with route jurisdiction,
  operational-tenant checks and the current per-recipient CEK-wrap profile.
- Consume `gdc-common-utils-ts` 2.3.3 for ISO 3166-1 Gaia-X addresses and
  strict ServiceOffering terms evidence. UHC-only extensions remain confined
  to GW UNID.

## [1.21.2] - 2026-07-21

### Added
- Added `subjectidentifier-sc`, a global-channel contract mapping an opaque
  `urn:multibase` alias only to the stable 5+4 UHC provider code and bare DNS
  domain. The asset contains no raw identifier, DID or tenant id.
- Added bundle/CSV expansion in the GW ledger adapter and independent
  `Organization.sameAs` index attributes, so one individual can be resolved by
  any indexed alias instead of treating the complete CSV as one value.

### Security
- Production now rejects in-memory and raw `KEK_SECRET` envelope custody,
  validates a rotatable Cloud KMS CryptoKey and unwraps one encrypted service
  runtime KEK per pod/process during `buildInfrastructure()`.
- Tenant key records now use the runtime KEK locally with AES-GCM context AAD;
  provisioning, rehydration and business operations no longer call Cloud KMS.
- Added runtime-KEK provisioning and executable one-KMS-decrypt bootstrap tests.
- Documented that GW UNID inherits tenant KMS/ML-KEM custody but does not own
  portal profile PINs, ImagingStudy encryption or product marketplaces.

### Fixed
- Replaced both accepted-Offer placeholders during local tenant bootstrap and
  wait for terminal Organization/Order polling results before checking errors,
  preventing pending or failed jobs from reporting a false successful startup.

### Changed
- Replaced the legacy Gaia-X `v2206` LegalParticipant projection with the
  shared ICAM 25.11 LegalPerson contract. LegalPerson is the participating
  legal organization; the natural LegalRepresentative remains a separate VC.
- Service-offering well-known artifacts are now independently signed Gaia-X
  ServiceOffering Enveloped VCs using VC-JWT and reference the provider's
  LegalPerson credential and service terms.
- Compact-JWS signing accepts protected `typ`/`cty` headers while retaining
  KMS-owned `alg` and `kid` values.

## [1.21.1] - 2026-07-17

### Changed
- Synchronized GW Core `1.20.1` into the UNID gateway while preserving the
  `gdc-unid-node-ts` package identity and UNID-specific FHIR R5 extensions.
- Updated `gdc-common-utils-ts` to `^2.3.1` and regenerated the OpenAPI
  profiles from the merged runtime.
- Removed the duplicate `PlanOfTreatment` digital-twin projection; canonical
  `PlanOfCare` maps once to the care-plan collection.

### Fixed
- Individual Offer identifiers now use the route jurisdiction/network and
  reject missing routing inputs before persistence, so no
  `urn:cds:undefined:...` identifier can enter the Order lifecycle.
- Preserved accepted Family Offer claims and made canonical/contextual Order
  lookup consistent across claim storage modes.
- Derived claims-first clinical resource versioning from the complete claims,
  preventing distinct sparse resource shells from collapsing into one index
  projection.

### Testing
- Imported the expanded GW Core unit and integration coverage for individual
  Offer/Order lifecycle, tenant activation, multi-contact lookup and Consent
  projection isolation.
- Declared the previously implicit `tasks-core-node-ts`, `uhc-sdk-core-ts` and
  `twilio` runtime dependencies so a clean install exercises the complete UNID
  source tree instead of relying on manually linked workspace modules.
- Isolated ICA and host URL fixtures from developer `.env.local-demo` values
  and serialized integration suites that share process-wide runtime state.

## [1.21.0] - 2026-07-16

- UNID ingestion now recognizes `org.hl7.fhir.r5` and dispatches registered R5
  validators, while `org.hl7.fhir.api` remains the canonical claims-first mode.

- RelatedPerson now documents and preserves the separate comma-separated
  `RelatedPerson.role` functional claim while `relationship` remains kinship
  or legal relationship. GW rejects the obsolete `PERMITTED` access decision
  in either field. POWATT remains an explicit legal assertion. CAREGIVER,
  ECON and DEPEN are active v3-RoleClass functions (DEPEN is retired only in
  the different v3-RoleCode system), while BILL/POWATT use v3-RoleCode.
### Changed
- Added subject-scoped Appointment create/edit/search and Task search/edit
  managers used by both web care forms and the voice-compatible flat FHIR
  contract. Empty-subject searches are rejected and executable flow tests
  prove create, edit and readback for one synthetic exact subject.
- Accepted individual-member seats now retain the authorized subject DID.
  License acceptance can be bound to verified email/telephone without asking
  the recipient to know the owner organization, and exact indexed
  `Organization.sameAs` lookup resolves the accepted card without a global
  individual search.
- Implemented the individual-organization member-seat lifecycle: two default
  zero-cost seats on new onboarding, owner-scoped search/add/issue, verified
  invitation acceptance, deactivation and release/reuse. Only FHIR
  v3-RoleCode members consume these seats; ISCO professionals are rejected
  because their professional organization owns their license.
- Removed the duplicate `PlanOfTreatment` digital-twin projection entry; the
  canonical `PlanOfCare` LOINC section maps once to the care-plan collection.
- Added subject-scoped `RelatedPerson/_search` for portal related-entity lists.
  Requests without an explicit subject or patient are rejected to avoid
  collection-wide discovery.
- Consent projections retain `Consent.actor-reference` beside
  `Consent.actor-identifier`: the reference supports dependency lifecycle,
  while the original public value remains available for reproducible
  blockchain rule asset-id calculation.
- Consent ingestion now writes the sanitized rule to the subject-scoped
  `individual/consents` read projection as well as rules/attachments, so a
  canonical `Consent/_batch` write is visible to `Subject/_search` without a
  second synthetic Communication write.
- Consent actor roles are persisted in canonical comparison form, including
  `org.ilo.isco-08|<code>` and `v3-RoleCode|<code>` for comma-separated roles.
- Communication-carried Consent projections delegate to the same consent
  storage path, preventing duplicate viewer records.
- Individual subject registrations now preserve the public UHC card
  `org.schema.Organization.sameAs` DID in protected indexed attributes when
  supplied. This permits an authorized card-resolution lookup without
  decrypting every individual registration; empty values are not indexed.
- Synced this UNID extension branch with GW CORE 1.20.0 while retaining the
  UNID package identity and its explicit deployment, controller, and
  organization-extension wiring.
- Preserved the canonical individual/family commercial onboarding contract:
  `individual/org.schema/Organization/_transaction` creates or resumes the
  organization flow and `Order/_batch` consumes its returned Offer.

## [1.20.0] - 2026-07-14

### Changed
- Made Jest environment-file resolution use the process working directory so
  unit, integration and E2E runners consistently load their selected local
  environment file.
- Clarified confidential-storage persistence documentation so it describes
  generic operational data rather than a channel-specific payload type.
- Expanded contributor guidance for the required TDD and executable-101 test
  structure.

### Testing
- Replaced the obsolete Firestore vault repository E2E specification with the
  current vault blood-pressure daily-batch integration coverage.

### Changed
- Added explicit `docs-v2` terminology so GW docs no longer mix:
  - `ProfileRuntime` as the unlocked end-user profile runtime
  - `TenantServiceRuntime` as the technical service/tenant wallet/runtime
  - `ChannelBackendPort` as the product/channel API above those runtimes
  in:
  - `docs-v2/101-README.md`
  - `docs-v2/09-api-integrators-guide.md`
  - `docs-v2/19-key-custody-and-audit-readiness.md`
- Added one centralized integration map so
  front/BFF/backend contributors now have one high-level entry point for:
  - inter-tenant research access choreography
  - `digitaltwin` SMART scope and `Composition/_search` semantics
  - DCR vs human-profile identity boundaries
  - current-vs-deferred status for researcher overlays, `urn:twin`, and
    reusable wallet/profile modules
- Replaced the repository-local SMART `client_assertion` test fixture with the
  published shared helper from `gdc-common-utils-ts` so GW manager/integration
  coverage now exercises the same JWT construction path consumed by the SDK
  layers:
  - `src/__tests__/managers/OpenIdAuthManager.test.ts`
  - `src/__tests__/integration/identity/smart-token.test.ts`
- Extended `digitaltwin/.../Composition/_search` so one request can match
  directly against researcher-branch `Composition` records stored in the
  digital-twin composition collection, instead of only fanning out through
  leaf resource families first. The first direct `Composition.*` capability
  now covered is `Composition.meta-tag`, matched as a tokenized
  `system|code` filter against stored `meta.tag[]` / `tag[]` values.
  TDD coverage now proves:
  - one unit-level digital twin `Composition` branch tagged with
    `urn:research:tag:score|10` is returned by
    `Composition/_search(section + Composition.meta-tag)`
  - one integration-level `digitaltwin` search returns a branch composition
    persisted in the tenant vault with the same `meta.tag[]` payload
  Files:
  - `src/managers/TwinCompositionManager.ts`
  - `src/__tests__/unit/managers/CompositionManager.test.ts`
  - `src/__tests__/integration/composition.bundle-search.api.test.ts`
- Extended the local Fabric/local-network audit chain so the canonical demo
  now exercises live consent-to-SMART-token flows for both:
  - clinical `individual` access rooted at `organization/Composition.rs`
  - research `digitaltwin` access rooted at `organization/ResearchSubject.rs`
  The new smoke proves:
  - one individual-professional SMART token can read the IPS bundle through
    `individual/.../Bundle/_search`
  - one research permit anchored from consent rules can issue a SMART token
    that reads `digitaltwin/.../Composition/_search`
  - research employees are allowed or denied both by matching role and by
    direct-email targeting
  - `scripts/project-audit-demo.sh` now chains the SMART access smoke together
    with the existing consent-asset and consent-lifecycle live checks
  Files:
  - `scripts/smoke-smart-access-local-network.sh`
  - `scripts/project-audit-demo.sh`
  - `scripts/payload-helpers.sh`
  - `scripts/render-demo-smart-access-payload.mts`
  - `src/__tests__/data/demo-smart-access-local-network.data.ts`
  - `src/__tests__/unit/data/demo-smart-access-local-network.data.test.ts`
  - `src/__tests__/integration/helpers/research-access-sdk.ts`
  - `src/__tests__/integration/identity/research-access.conversation.test.ts`
- Aligned the architecture and closeout/docs-v2 narrative with the now-proven
  SMART split and local-network audit chain:
  - clarified that Node/Jest TDD and live shell/Fabric smokes are complementary
    layers, not replacements for each other
  - documented that `digitaltwin/.../Composition/_search` is gated by
    `organization/ResearchSubject.rs...`, while `individual` remains gated by
    `organization/Composition.rs...`
  - recorded the current executable proof status for employee allow/deny by
    role and by direct email
  Files:
  - `ARCHITECTURE.md`
  - `docs-v2/23-digital-twin-composition-search-contract.md`
  - `docs-end/03-identity-ledger-contract-plan.md`
  - `docs-end/05-project-closure-use-cases-and-lifecycles-summary.md`
- Repackaged the closeout document set under `docs-end/` and added index files
  for both closeout and `docs-v2` so the repository now exposes one explicit
  reading order instead of the previous `docs-internal/` ad-hoc set.
  Files:
  - `docs-end/README.md`
  - `docs-end/01-newbie-audit-runbook.md`
  - `docs-end/02-current-state-traceability.md`
  - `docs-end/03-identity-ledger-contract-plan.md`
  - `docs-end/04-trust-bundle-operator-roles.md`
  - `docs-end/05-project-closure-use-cases-and-lifecycles-summary.md`
  - `docs-end/06-project-closure-executive-summary.md`
  - `docs-v2/README.md`
  - removed `docs-internal/*`
- Refreshed the chaincode/deep-dive/docs-v2 references so public docs no longer
  depend on workstation-local absolute paths and now point to stable GitHub or
  workspace-relative references.
  Files:
  - `chaincode/docs/101-CONSENTACCESS-SC-CCAAS.md`
  - `docs-v2/21-research-digital-twin-technical-backlog.md`
  - `docs/04-DEEP-DIVES/04.K-FABRIC-ADAPTER-INVENTORY-AND-DUAL-NETWORK-TARGET.md`
  - `docs/04-DEEP-DIVES/04.L-TEST-LOCAL-TOPOLOGY-AND-FABRIC-ENV-LOADER.md`
  - `docs/04-DEEP-DIVES/04.M-CONSENTACCESS-NETWORK-DEPLOY.md`
- Expanded gateway-facing example payload fixtures to show the canonical SMART
  proof layering and to mirror claims into `resource.meta.claims` where shared
  readers now expect canonical bundle payloads.
  Files:
  - `src/__tests__/data/example-payloads.ts`
- Added host onboarding route coverage proving that host `Order/_batch` must
  use the host registry network selector in the URL path rather than the tenant
  business sector, returning `404` when the wrong path shape is used.
  Files:
  - `src/__tests__/integration/host.activate-offer-order.api.test.ts`
- Updated the portal/BFF/GW mapping reference and regenerated OpenAPI profile
  timestamps so the route table, examples, and generated profile metadata stay
  synchronized with the current branch content.
  Files:
  - `v1.5-tabla-portal-api-gw.md`
  - `docs/openapi-profiles/openapi-core.json`
  - `docs/openapi-profiles/openapi-compat.json`
  - `docs/openapi-profiles/openapi-extension.json`
  - `CONTRIBUTING.md`

## [1.19.2] - 2026-06-30

### Changed
- Completed the current SMART token hardening pass for both clinical
  `Composition` access and research `ResearchSubject` access:
  - canonical behavior still accepts `body.vp_token` plus Clearing House
    verification
  - the gateway also accepts one signed `client_assertion` plus
    `client_assertion_type` on `identity/openid/smart/token`
  - compatibility labels accepted for `client_assertion_type` include the
    standard JWT-bearer URN, `private_key_jwt`, and `client_assertion`
  - inter-tenant `RESEARCH` flows may also use one already-validated external
    `Bearer data access token` instead of `body.vp_token` when:
    - `purpose=RESEARCH`
    - requester organization is foreign to the issuer tenant
    - external issuer is listed in `EXTERNAL_RESEARCH_TOKEN_TRUSTED_ISSUERS`
    - provider tenant, consumer organization, purpose, and requested
      capability match
  Files:
  - `src/managers/OpenIdAuthManager.ts`
  - `src/routes/api.ts`
  - `docs/90.A-API_INTEGRATORS_GUIDE.md`
  - `docs/openapi-examples/core-flow-examples.json`
  - `docs/openapi-profiles/openapi-core.json`
  - `docs/openapi-profiles/openapi-compat.json`
  - `docs/openapi-profiles/openapi-extension.json`
- Extended consent-rule evaluation for SMART token issuance so stored
  `Consent.action` values may be interpreted as either:
  - legacy section-only clinical actions such as
    `LOINC|48765-2,LOINC|10160-0`
  - canonical stored capability expressions such as
    `Composition.rs?section=...` and `ResearchSubject.rs`
  This preserves backward compatibility for current clinical rules while
  adding canonical rule matching for digital-twin research access.
  Files:
  - `src/managers/OpenIdAuthManager.ts`
- Tightened SMART root capability and endpoint compatibility enforcement so:
  - token issuance accepts only `organization/Composition...` and
    `organization/ResearchSubject...` root capabilities
  - `patient/Composition...` and `patient/ResearchSubject...` are rejected at
    token issuance time
  - `individual` endpoints require one `organization/Composition...` root scope
  - `digitaltwin` endpoints require one
    `organization/ResearchSubject...` root scope
  Files:
  - `src/managers/OpenIdAuthManager.ts`
  - `src/routes/api.ts`
  - `src/utils/smart-scope-route-authorization.ts`

### Tests
- Expanded unit coverage for `OpenIdAuthManager` so the manager now proves:
  - canonical stored `Composition.rs?section=...` rules match one clinical
    `organization/Composition...` request
  - `patient/Composition...` and `patient/ResearchSubject...` root scopes are
    rejected
  - inter-tenant research access can be authorized from one trusted external
    bearer
  - canonical stored `ResearchSubject.rs` rules match one research
    `organization/ResearchSubject...` request
  - research employees can be included or excluded by:
    - matching role
    - mismatching role
    - direct email target
    - direct email target for another employee
  - professional SMART requests with `vp_token` plus `client_assertion`
    continue to issue tokens
  Files:
  - `src/__tests__/managers/OpenIdAuthManager.test.ts`
- Expanded integration coverage for `identity/openid/smart/token` so the route
  now proves:
  - clinical `Composition` token issuance still works
  - foreign-tenant research token issuance still works from one matching
    inter-tenant contract VC
  - research token issuance also works from one trusted external bearer
  - research token issuance also works when the stored action is canonical
    `ResearchSubject.rs`
  Files:
  - `src/__tests__/integration/identity/smart-token.test.ts`
- Added dedicated scope-route authorization tests so the project now proves:
  - unit-level route compatibility for `individual` vs `digitaltwin`
  - integration-level route rejection when a `ResearchSubject` token is used on
    `individual`
  - integration-level route rejection when a `Composition` token is used on
    `digitaltwin`
  Files:
  - `src/__tests__/unit/utils/smart-scope-route-authorization.test.ts`
  - `src/__tests__/integration/identity/smart-scope-route-gates.test.ts`

## [1.19.1] - 2026-06-29

### Changed
- Tightened SMART inter-tenant authorization so a foreign organization actor
  can obtain a token from a tenant only when the presented `vp_token`
  contains one active inter-tenant access contract VC whose FHIR `Contract`
  subject matches:
  - provider organization DID = token-issuing tenant
  - consumer organization DID = requesting actor organization
  - requested capability scope(s)
  - requested purpose when the contract declares one
  Files:
  - `src/managers/OpenIdAuthManager.ts`
  - `src/__tests__/managers/OpenIdAuthManager.test.ts`
  - `src/__tests__/integration/identity/smart-token.test.ts`
- Added one didactic inter-tenant research-access integration flow that
  packages the current GW behavior as the future high-level
  `OrganizationControllerSdk` + `DigitalTwinSdk` choreography:
  - provider tenant `acme-id`
  - consumer tenant `lab-id`
  - subject `Doraemon` with one IPS import
  - subject `Novita` with demo `ibuprofen` and `paracetamol` medication flows
  - SMART token issuance from contract VC proof
  - `digitaltwin/.../Composition/_search` returning one digital twin for
    `ibuprofen` and one for `paracetamol`
  Files:
  - `src/__tests__/integration/helpers/research-access-sdk.ts`
  - `src/__tests__/integration/identity/research-access.conversation.test.ts`
- Closed the internal closeout naming/documentation rule so research-access 101
  material consistently uses `OrganizationControllerSdk` + `DigitalTwinSdk`
  rather than `DigitalTwinControllerSdk`, and explicitly documents that GW
  retains smart-contract, queue, and storage plumbing:
  - `docs-internal/05-project-closure-use-cases-and-lifecycles-summary.md`
  - `docs-internal/06-project-closure-executive-summary.md`

## [1.19.0] - 2026-06-29

### Added
- Added a focused route-level regression for professional device replacement so
  `Device/_dcr` keeps the current seat-reuse and identity-ledger expectations
  executable through the public GW API:
  - `src/__tests__/integration/device.dcr-replacement.api.test.ts`
- Added a dedicated unit slice for the extracted individual/family onboarding
  flow helper:
  - `src/__tests__/unit/managers/hosting/process-individual-organization.test.ts`
- Added internal closeout summaries for the current project state and the
  consolidated use-case/lifecycle narrative:
  - `docs-internal/05-project-closure-use-cases-and-lifecycles-summary.md`
  - `docs-internal/06-project-closure-executive-summary.md`

### Changed
- Completed the current `HostingManager` modularization pass so the host
  onboarding/commercial lifecycle no longer depends on one monolithic manager
  file for verification, activation, DID registration, order processing, host
  config persistence, controller identity recovery, and service/resource
  extraction:
  - `src/managers/hosting/activation-helpers.ts`
  - `src/managers/hosting/controller-entity-config.ts`
  - `src/managers/hosting/create-pending-tenant-registration.ts`
  - `src/managers/hosting/ensure-authority-tenant.ts`
  - `src/managers/hosting/finalize-tenant-config.ts`
  - `src/managers/hosting/hosting-claim-contracts.ts`
  - `src/managers/hosting/ica-did-registration.ts`
  - `src/managers/hosting/ica-enrollment.ts`
  - `src/managers/hosting/ica-verification.ts`
  - `src/managers/hosting/organization-issue-controller-identity.ts`
  - `src/managers/hosting/persist-host-config.ts`
  - `src/managers/hosting/process-individual-organization.ts`
  - `src/managers/hosting/process-offer-order-search.ts`
  - `src/managers/hosting/process-order-entry.ts`
  - `src/managers/hosting/process-organization-activation.ts`
  - `src/managers/hosting/process-organization-verification.ts`
  - `src/managers/hosting/process-registration-entry.ts`
  - `src/managers/hosting/process-tenant-did-document-binding.ts`
  - `src/managers/hosting/reconcile-host-runtime-config.ts`
  - `src/managers/hosting/registration-keys.ts`
  - `src/managers/hosting/resource-extraction.ts`
  - `src/managers/hosting/service-attachment.ts`
  - `src/managers/HostingManager.ts`
- Hardened the host commercial onboarding contract so `_transaction`,
  `_activate`, `Offer/_search`, and `Order/_batch` coverage now fails fast when
  canonical commercial claims or required service-category/order-acceptance
  claims disappear:
  - `src/__tests__/integration/host.transaction-offer-order.api.test.ts`
  - `src/__tests__/integration/host.activate-offer-order.api.test.ts`
  - `src/__tests__/unit/managers/HostingManager.OfferOrder.test.ts`
  - `src/__tests__/unit/managers/HostingManager.verification-transaction.test.ts`
  - `src/__tests__/unit/managers/HostingManager.activation.test.ts`
  - `src/__tests__/unit/managers/HostingManager.ica.test.ts`
  - `src/__tests__/integration/host.activate-offer-order.api.test.ts` now also
    proves that host `Order/_batch` rejects `health-care`-style tenant business
    sectors in the path with `404`; host onboarding must use the registry
    network selector (`test`, `test-network`, `network`) instead.
- Aligned the individual/family compatibility flows with the real commercial
  host bootstrap order so multi-phone and multi-email owner matching is tested
  only after the tenant has gone through registration plus `Order/_batch`, and
  all readback now uses shared bundle-claim readers instead of ad hoc
  `body.data[0]` drilling:
  - `src/__tests__/integration/individual/family.test.ts`
  - `src/__tests__/integration/individual/family.multiphone.test.ts`
  - `src/__tests__/integration/individual/family.multimail.test.ts`
  - `src/__tests__/unit/examples/shared-flow-examples.test.ts`
  - `src/managers/FamilyManager.ts`
- Tightened device-registration behavior and coverage so professional device
  replacement keeps the seat/license continuity and local ledger write path
  consistent with the current controller recovery lifecycle:
  - `src/managers/DeviceRegistrationManager.ts`
  - `src/__tests__/managers/DeviceRegistrationManager.test.ts`
- Linked the new shared SDK lifecycle note for controller/device recovery from
  GW CORE documentation entry points:
  - `README.md`
  - `docs/README.md`
- The canonical cross-repository reference for:
  - legal organization controller recovery via `_issue`
  - professional device replacement via `_exchange` + `Device/_dcr`
  - individual controller recovery
  now lives in `gdc-sdk-core-ts/docs/ARCHITECTURE_CONTROLLER_DEVICE_LIFECYCLES.md`.
- Updated the shared dependency target to `gdc-common-utils-ts@^2.0.17` so GW
  tests and manager flows consume the published bundle-claim readers instead of
  hand-parsing first-entry claim payloads.
- Refreshed the generated OpenAPI profile documents and swagger wiring so the
  published API examples stay aligned with the current host onboarding and
  lifecycle behavior:
  - `docs/openapi-profiles/openapi-compat.json`
  - `docs/openapi-profiles/openapi-core.json`
  - `docs/openapi-profiles/openapi-extension.json`
  - `swagger.config.cjs`

### Validation
- `npm install`
- `gdc-common-utils-ts@2.0.17`, `gdc-sdk-core-ts@2.0.10`, `gdc-sdk-node-ts@2.0.11` published and consumed locally
- `npm run build`

## [1.18.0] - 2026-06-28

### Added
- Added employee device-replacement lifecycle handling to `Device/_dcr` so a
  reissued activation code can reuse the same professional license seat while:
  - revoking the previous local device profile bound to that seat
  - replacing the employee `didDocument` verification methods with the newly
    registered device keys
  - syncing employee device keys and subject-key bindings to the identity
    ledger when Fabric/local-network identity writes are enabled
- Added manager coverage for the employee device replacement flow, including
  local identity-ledger revocation/registration calls:
  - `src/__tests__/managers/DeviceRegistrationManager.test.ts`
- Added `docs-v2/24-local-audit-fabric-runtime.md` to define the current
  local ICA + GW CORE + Fabric baseline for auditors/integrators, including:
  - the supported deterministic local Fabric devnet path
  - the current local channel scope (`health-care-local` and `identity-local`,
    with research later)
  - the recommended responsibility split where GW CORE, not ICA, performs the
    current business/audit Fabric writes
  - the next implementation step for generic FHIR CID/version anchoring
- Added unit coverage for local-vs-regional identity ledger channel
  resolution in `src/__tests__/unit/utils/ledger.test.ts`.
- Added `npm run local:fabric:stack`, a Node orchestrator that can bootstrap
  the local Fabric devnet, prepare `.env.local-fabric`, deploy the local
  consent-access chaincode, start GW CORE in background, and bootstrap tenant
  `acme-id`.
- Added `npm run project:audit:demo`, a wrapper command that packages the
  current validated local closeout path in this repo:
  - local Fabric bootstrap
  - GW CORE startup
  - canonical demo individual creation
  - consent lifecycle smoke against `health-care-local`
- Added `docs-internal/` as the semi-internal project traceability layer,
  separate from `docs-v2`, including:
  - closeout TODO/status
  - newbie/auditor runbook
  - current-state traceability note
  - identity/artifact ledger contract plan for the next branch
- Added audited local deployment support for the identity-ledger contracts on
  `identity-local`, including:
  - `organization-sc`
  - `cryptographickey-sc`
  - `employee-sc`
  - `evidence-sc`
  - `credential-sc`
  - `artifact-sc`
  - `artifactevent-sc`
  - `subjectkeybinding-sc`
- Added initial GW CORE identity-ledger onboarding wiring for organization
  registration:
  - organization writes to `organization-sc`
  - public-key writes to `cryptographickey-sc`
  - subject-to-key writes to `subjectkeybinding-sc`
  - onboarding PDF/hash artifact writes to `artifact-sc` / `artifactevent-sc`
- Added unit coverage for the new `HostingManager` identity-ledger wiring,
  including the fallback path when a JWK thumbprint is unavailable.
- Added `consentaccess`-style modular `lib/` layouts plus exhaustive JS test
  coverage for the active identity/artifact ledger chaincodes:
  - `organization-sc-javascript`
  - `cryptographickey-sc-javascript`
  - `artifact-sc-javascript`
  - `artifactevent-sc-javascript`
  - `subjectkeybinding-sc-javascript`
  Each now ships with separated `constants`, `utils`, `exists`, `read`,
  `write`, `history`, asset builder, contract tests, and helper/lib tests at
  `100%` statements/branches/functions/lines.

### Changed
- Local Fabric defaults now use explicit local channel names for
  `NETWORK_MODE=local-network`:
  - consent-access and local healthcare writes default to `health-care-local`
  - identity ledger fallback now defaults to `identity-local`
  - `test-network` remains on the existing regional channel naming
- `ConsentManager` now resolves consent-access writes from the explicit local
  Fabric data-channel env when present, so `local-network` writes go to
  `health-care-local` instead of the regional jurisdiction fallback.
- `scripts/demo-create-individual-organization.sh` now defaults to the KYC /
  OTP-style onboarding path for local demo flows:
  - it no longer depends on a fake signed PDF
  - it generates the canonical reusable individual alias `Doraemon` by default
  - certificate-signed PDF onboarding remains available as an explicit opt-in
- Updated the shared dependency target to `gdc-common-utils-ts@^2.0.16` and
  aligned the research/digital-twin shared layer with the latest published
  common-utils package boundary:
  - `package.json`
  - `package-lock.json`
  - `src/shared/healthcare-constants.ts`
  - `src/shared/fhir-constants.ts`
  - `src/shared/data-collections.ts`
  The gateway still keeps a small local fallback layer for IPS summary
  sections and GW-specific response/index taxonomies that are not yet
  published upstream.
- `scripts/bootstrap-local-fabric-stack.mjs` now deploys the identity
  chaincodes before `consentaccess-sc` and `--restart-gw` now always closes any
  process listening on `:3000`, not just the tracked PID file.
- `scripts/prepare-consentaccess-local-fabric-env.sh` now enables the generic
  identity ledger path in `.env.local-fabric` and exports the explicit
  chaincode names used by `HostingManager`.
- The Fabric devnet deploy helpers now support staging chaincode sources from
  the sibling `gwtemplate-node-ts` repo into the devnet workspace, which makes
  the audited local multi-repo lifecycle reproducible from a clean clone.
- `organization-sc` now stores the canonical ICA-issued organization VC plus
  `meta.audit`, and no longer persists parallel `governanceVc`,
  `selfDescriptionVc`, `evidence`, `metadata`, or hosted-DID routing noise in
  the organization asset itself.
- `artifact-sc`, `artifactevent-sc`, and `subjectkeybinding-sc` now write
  free-form payload extensions under `meta.attributes` instead of a parallel
  top-level `metadata` bag, while keeping legacy-read compatibility for older
  stored assets.
- GW identity-ledger writes now derive the organization ledger id from the
  canonical legal-id claims as `identifier.additionalType|identifier.value`
  instead of using the opaque organization URN as the primary ledger key.
- `src/blockchain/fabric/v3/manageAsset*.ts` wrappers now carry JSDoc that
  clarifies their role as semantic aliases over generic Fabric `submit(...)`
  calls instead of hidden special execution paths.

## [1.17.0] - 2026-06-27

### Added
- Added the digital twin research search and materialization contract to the
  v2 docs set, including the technical backlog, environment variable
  reference, and the dedicated `Composition/_search` contract:
  - `docs-v2/21-research-digital-twin-technical-backlog.md`
  - `docs-v2/22-environment-variables-reference.md`
  - `docs-v2/23-digital-twin-composition-search-contract.md`
- Added the official HL7 IPS all-sections fixture plus TDD coverage for
  section-first twin search and `ResearchSubject/$summary` materialization:
  - `src/__tests__/data/fhir-ips-bundle-all-sections.json`
  - `src/__tests__/unit/managers/CompositionManager.test.ts`
  - `src/__tests__/integration/composition.bundle-search.api.test.ts`

### Changed
- Separated `individual` and `digitaltwin` orchestration more explicitly:
  `TwinCompositionManager` now owns digital twin `Composition` routing while
  `CompositionManager` remains focused on individual/compatibility summary and
  bundle retrieval paths.
- Completed the research twin sharing flow so
  `digitaltwin/.../Composition/_search` discovers matching twin indexes by IPS
  section plus textual resource claims, and selected twins can now be
  materialized through `digitaltwin/<format>/Communication/_batch` targeting
  `ResearchSubject/$summary`.
- `org.hl7.fhir.r4` twin materialization now returns a document-style
  `Bundle`, while `org.hl7.fhir.api` returns claims-first resources with
  canonical `meta.claims` and stable `urn:uuid:` bundle entry `fullUrl`
  values.
- Refactored search parsing, composition filtering, FHIR data helpers, and
  indexed-claim resource rehydration out of `CompositionManager` into reusable
  utilities so the manager no longer carries most of the request-shape and
  reconstruction plumbing.
- Extended runtime capabilities, routing, shared section/catalog constants,
  JSDoc, environment templates, and generated OpenAPI profile documents to
  match the implemented digital twin search and materialization behavior.

## [1.16.0] - 2026-06-26

### Added
- Added a dedicated `docs-v2/18-organization-controller-lifecycle.md` guide
  that explains the narrow controller recovery/rebind lifecycle, the direct GW
  route order, and the relationship to the canonical `gdc-sdk-node-ts`
  executable proof.
- Added `docs-v2/19-key-custody-and-audit-readiness.md` so the current KMS
  persistence model, the residual `KEK_SECRET` weakness, and the production
  migration target toward external KMS/HSM custody are documented in the v2
  docs set.
- Added `docs-v2/21-research-digital-twin-technical-backlog.md` so the
  separate research-store plan now has a code-targeted backlog for
  `server-config.ts`, research-store adapters, and the initial explicit
  `digitaltwin` search contract.
- Added `docs-v2/23-digital-twin-composition-search-contract.md` so the
  now-implemented `digitaltwin/.../Composition/_search` contract has one
  concise source of truth for accepted parameters, section/resource support,
  and step-by-step test flow.
- Added `npm run kms:audit` to report tenants/host missing persisted
  `wrapped_keys` and flag whether confidential-data decryption or HMAC-backed
  search is at risk.
- Added explicit envelope-root provider selection for wrapped key custody:
  `memory`, `local`, `gcp-kms`, and `hashicorp-transit`. The HashiCorp option
  is named after the Transit engine on purpose so it is not confused with the
  GW confidential storage vault.

### Changed
- Extended the generated Swagger/OpenAPI examples so the organization
  controller lifecycle now exposes explicit request, poll-request, and
  completed poll-response examples for:
  - `Organization/_issue`
  - `Organization/_activate`
  - `Token/_exchange-response`
  - `Device/_dcr-response`
- Aligned both Swagger generation paths
  (`src/utils/swagger-spec.ts` and `scripts/generate-swagger-spec.mts`) so
  tests and generated profile documents consume the same organization
  controller example set.
- Moved generated core flow examples out of `artifacts/` and into
  `docs/openapi-examples/core-flow-examples.json` so versioned example
  documents live alongside the rest of the published API contract.
- Updated controller-facing bearer authentication so host registry and other
  bearer-protected API routes can accept either a verified `id_token` or one
  signed controller proof bearer (`vp_token` compact JWT with embedded public
  JWK). `Token/_exchange` remains `id_token`-specific.
- Tightened host tenant lifecycle authorization so controller proof bearers
  must carry a legal representative VC whose `memberOf.taxID` matches the
  target `Organization.identifier.value`. Representative-role and
  subject-to-signer binding checks remain future tightening work until the
  example VC/VP contract is finalized.
- Bootstrapping now resolves wrapped-key envelope custody through an explicit
  provider factory instead of implicitly falling back from `KEK_SECRET` to
  in-memory behavior.
- Operational `MedicationStatement` updates now mirror into the tenant
  `digitaltwin` scope, and GW exposes
  `digitaltwin/org.hl7.fhir.api/MedicationStatement/_search` for
  tenant-scoped twin discovery by canonical medication claims.
- `Communication`-driven IPS ingestion now mirrors projected clinical
  resources and per-section `Composition` indexes into `digitaltwin`, and
  GW exposes `digitaltwin/org.hl7.fhir.r4/Composition/_search` plus
  `digitaltwin/org.hl7.fhir.api/Composition/_search` for section-first twin
  discovery by IPS section token and resource-scoped textual claims such as
  `MedicationStatement.code-display`, `MedicationStatement.code-text`,
  `Observation.code-display`, and `Observation.code-text`.

### Fixed
- Restored legacy host `Organization/_activate` commercial continuity so the
  completed activation response again includes `org.schema.Offer.identifier`
  and the follow-up `Order/_batch` step can confirm the generated Offer for
  employee-seat licensing and activation-code issuance.
- Employee `DELETE` disable and `Employee/_purge` now resolve the target actor
  from explicit `Bundle.entry.resource.id` before deriving fallback IDs from
  claims, so SDK callers that send the canonical employee `resource.id` no
  longer hit random UUID lookups and false `404 Employee with ID ... not
  found` responses.
- Persisted tenant and host KMS key material as wrapped records in the host
  vault so plaintext async flows keep encrypting responses to the tenant after
  process restarts or pod hops instead of failing when `_managedKeys` memory is
  empty. `KmsService.init()` now reuses persisted host keys instead of silently
  reprovisioning a new host keyset on each restart.
- Restored the documented tenant `didDocument` fallback for public encryption
  key resolution so legacy tenants can still receive plaintext async responses
  when their published ML-KEM key exists even if wrapped private material is
  missing in the current process.
- Medication digital twin search now supports deterministic medication
  text/code lookup over mirrored `MedicationStatement` claims, so updating an
  individual's medication can update the mirrored twin and make it searchable
  by medication text or code.
- Full IPS document ingestion no longer fails when an embedded `Consent`
  lacks the rule-specific `Consent.decision` claim; the resource is still
  projected, while consent-rule persistence now runs only when the minimal
  rule claim set is present.

### Testing
- `npm test -- --runTestsByPath src/__tests__/integration/server.robustness.test.ts`
- `npm test -- --runTestsByPath src/__tests__/integration/security-mode-gates.test.ts src/__tests__/managers/AuthorizationManager.test.ts`
- `npm test -- --runTestsByPath src/__tests__/unit/services/KmsService.test.ts src/__tests__/integration/tenant-kms-rehydration.api.test.ts`
- `npm test -- --runTestsByPath src/__tests__/unit/managers/MedicationStatementManager.test.ts src/__tests__/unit/utils/services.test.ts`
- `npm test -- --runTestsByPath src/__tests__/unit/managers/CompositionManager.test.ts src/__tests__/unit/managers/CommunicationManager.unit.test.ts src/__tests__/unit/utils/services.test.ts`
- `npm test -- --runTestsByPath src/__tests__/integration/medication-statement.api.test.ts`
- `npm test -- --runTestsByPath src/__tests__/integration/composition.bundle-search.api.test.ts`
- `npm test -- --runTestsByPath src/__tests__/unit/utils/swagger-spec.test.ts`
- `npm run build:swagger`
- `npm run build`

## [1.15.0] - 2026-06-25

### Added
- Added a dedicated `docs-v2/18-organization-controller-lifecycle.md` guide
  that explains the narrow controller recovery/rebind lifecycle, the direct GW
  route order, and the relationship to the canonical `gdc-sdk-node-ts`
  executable proof.
- Added optional `STORAGE_PROVIDER=ipfs` support through a Kubo-backed
  `IpfsStorageAdapter`, plus local IPFS compose/runtime templates for the
  supported `DB_PROVIDER=postgres` + `STORAGE_PROVIDER=ipfs` profile.

### Changed
- Extended the generated Swagger/OpenAPI examples so the organization
  controller lifecycle now exposes explicit request, poll-request, and
  completed poll-response examples for:
  - `Organization/_issue`
  - `Organization/_activate`
  - `Token/_exchange-response`
  - `Device/_dcr-response`
- Aligned both Swagger generation paths
  (`src/utils/swagger-spec.ts` and `scripts/generate-swagger-spec.mts`) so
  tests and generated profile documents consume the same organization
  controller example set.
- Moved generated core flow examples out of `artifacts/` and into
  `docs/openapi-examples/core-flow-examples.json` so versioned example
  documents live alongside the rest of the published API contract.
- Updated controller-facing bearer authentication so host registry and other
  bearer-protected API routes can accept either a verified `id_token` or one
  signed controller proof bearer (`vp_token` compact JWT with embedded public
  JWK). `Token/_exchange` remains `id_token`-specific.
- Tightened host tenant lifecycle authorization so controller proof bearers
  must carry a legal representative VC whose `memberOf.taxID` matches the
  target `Organization.identifier.value`. Representative-role and
  subject-to-signer binding checks remain future tightening work until the
  example VC/VP contract is finalized.
- Documented and tested the open-source persistence profile that stores vault
  metadata in PostgreSQL and confidential blobs in IPFS/Kubo.

### Testing
- `npm test -- --runTestsByPath src/__tests__/integration/server.robustness.test.ts`
- `npm test -- --runTestsByPath src/__tests__/integration/security-mode-gates.test.ts src/__tests__/managers/AuthorizationManager.test.ts`
- `npm test -- --runTestsByPath src/__tests__/unit/config/server-config.test.ts src/__tests__/unit/database/storage/ipfs.storage.adapter.test.ts src/__tests__/integration/repositories/postgres.vault.repository.it.spec.ts`
- `npm run build`

## [1.14.9] - 2026-06-24

### Changed
- Updated the shared dependency target to `gdc-common-utils-ts@^2.0.12`.

### Fixed
- Regenerated Swagger/OpenAPI examples and profile documents against the
  corrected shared consent claim key so generated GW docs no longer expose the
  camelCase form `Consent.attachment-contentType`.

## [1.14.8] - 2026-06-24

### Changed
- Updated the shared dependency target to `gdc-common-utils-ts@^2.0.11`.
- Moved the versioned generated OpenAPI profile documents out of
  `artifacts/openapi-profiles` and into `docs/openapi-profiles` so `artifacts/`
  can remain reserved for ephemeral logs, traces, and local test output while
  Swagger UI still serves the profile selector at runtime.
- Added deterministic demo token test fixtures that reuse the shared
  `gdc-common-utils-ts` JWT/JWK helpers so GW tests regenerate stable `id_token`
  and `vp_token` signers from fixed seeds instead of embedding ad hoc literal
  keys.

### Fixed
- Reused already assigned controller/employee seats during
  `Organization/_issue` before consuming an `available` pool license, allowing
  reinstalls/rebinds to reissue activation codes for the same actor instead of
  failing on exhausted free stock.
- Fixed host legal-organization onboarding so GW no longer derives the ICA
  verification route jurisdiction from `HOST_JURISDICTION`. `_transaction`
  now resolves the ICA route scope from the configured trusted ICA and returns
  a functional `400 OperationOutcome` when that jurisdiction cannot be
  resolved in demo/local environments instead of drifting into downstream
  `500` failures.
- Added controller identity resolution for `Organization/_issue` so demo mode
  can accept payload fallbacks while strict mode reuses the verified bearer
  payload and persisted controller role when available.

## [1.14.7] - 2026-06-23

### Changed
- Clarified docs, Swagger/OpenAPI descriptions, and host-flow comments so
  `Organization/_transaction` is treated as the canonical legal-organization
  onboarding step and `Organization/_activate` is documented as legacy
  compatibility, not a required follow-up after `_transaction`.
- Documented the current GW/ICA trust model as one trusted operational ICA per
  host/deployment, configured explicitly via `ICA_URL_*`,
  `ICA_JURISDICTION`, and optionally `ICA_DID_WEB`, rather than a dynamic list
  of trusted ICAs selected from CA/issuer metadata.
- Added host `Organization/_issue` as the existing-tenant reverify/rebind path:
  it reuses ICA `_verify`, does not create a new Offer, and reissues one
  controller activation code from the already contracted seat pool so the
  frontend can continue with `Token/_exchange` + `Device/_dcr`.
- Added controller identity resolution for `Organization/_issue` so demo mode
  can accept payload fallbacks while strict mode reuses the verified bearer
  payload and persisted controller role when available.
- Added deterministic demo-token test fixtures for `id_token` and `vp_token`
  so security-sensitive GW tests can regenerate stable EC signing keys from a
  fixed seed, verify real JOSE signatures locally, and expose the exact
  `header.payload` bytes that KMS-backed BFF/controller signers would sign in
  production.

### Fixed
- Fixed host legal-organization onboarding so GW no longer derives the ICA
  verification route jurisdiction from `HOST_JURISDICTION`. `_transaction`
  now resolves the ICA route scope from the configured trusted ICA and returns
  a functional `400 OperationOutcome` when that jurisdiction cannot be
  resolved in demo/local environments instead of drifting into downstream
  `500` failures.
- Reused already assigned controller/employee seats during `Organization/_issue`
  before consuming an `available` pool license, allowing reinstalls/rebinds to
  reissue activation codes for the same actor instead of failing on exhausted
  free stock.

## [1.14.6] - 2026-06-23

### Fixed
- Normalized legacy `Organization/_activate` claims before tenant vault
  creation so missing `org.schema.Organization.address.addressCountry` no
  longer crashes with an internal `500` before returning an
  `OperationOutcome`.
- Wrapped Gaia-X legal participant option generation in the activation
  finalization path so demo/compat onboarding no longer leaks unexpected
  exceptions during tenant provisioning.
- Added regression coverage for the legacy activation path that previously
  crashed while building the tenant collection name from incomplete claims.

## [1.14.5] - 2026-06-19

### Changed
- Removed the legacy in-repo `devnet/` copy so local Fabric development now
  uses only the sibling repo `../fabric-multicloud/devnet/fabric-v3`.

## [1.14.4] - 2026-06-19

### Changed
- Documented the workspace layout cleanup that removes the in-repo
  `fabric-multicloud/` copy and standardizes operational references on the
  sibling repo `../fabric-multicloud`.
- Updated the shared dependency target to `gdc-common-utils-ts@^2.0.6`.
- Switched host/runtime and docs to the canonical
  `application/didcomm-plain+json` media type.
- Added temporary startup compatibility for legacy
  `application/didcomm-plaintext+json` while dependent packages and clients
  finish migrating.

## [1.14.0] - 2026-06-14

### Added
- Added persistent Firestore/GCS storage tracing so local and live runs can
  emit JSONL timing records for repository and blob-store operations in:
  - `src/utils/storage-trace.ts`
- Added lightweight section listing semantics to the vault repository contract
  so search/index paths can iterate persisted records without hydrating JWE
  blobs:
  - `src/database/repositories/vault/vault.repository.ts`
  - `src/database/repositories/vault/vault.mem.repository.ts`
  - `src/database/repositories/postgres/postgres.vault.repository.ts`
  - `src/database/repositories/firestore/firestore.vault.repository.ts`
- Added cache-aware tenant existence checks to the tenant cache contract so
  managers that already depend on `TenantsCacheManager` can reuse hydrated
  host/tenant registrations instead of re-querying storage:
  - `src/managers/ITenantsManager.ts`
  - `src/managers/TenantsCacheManager.ts`
- Added explicit capability-bounded tenant-registry interfaces so runtime,
  routing, discovery, ledger, and hosting flows no longer all depend on the
  same concrete tenant cache type:
  - `src/managers/IApiTenantRegistry.ts`
  - `src/managers/IDiscoveryTenantRegistry.ts`
  - `src/managers/IHostRuntime.ts`
  - `src/managers/IHostingTenantRegistry.ts`
  - `src/managers/ILedgerTenantRegistry.ts`
  - `src/managers/IPrivilegedTenantRegistry.ts`
  - `src/managers/ITenantDidRegistryMutator.ts`
- Added dedicated hosting sub-services so `HostingManager` no longer keeps all
  offer/order search and lifecycle logic inline:
  - `src/managers/hosting/HostingLifecycleService.ts`
  - `src/managers/hosting/HostingOfferOrderService.ts`
- Added explicit lightweight public projection support to the confidential
  storage model so copied/generated consultation data can live outside
  encrypted payloads when required for runtime lookup or gating:
  - `gdc-common-utils-ts@^1.24.1`

### Changed
- Split heavy read semantics from index-only search semantics in Firestore and
  PostgreSQL vault repositories:
  - `getContainersInSection(...)` remains the hydrated/full-read path
  - `listContainersInSection(...)` is now the lightweight/index-only path
  - `query(..., { hydrate: false })` skips confidential blob hydration for
    search flows that only need indexed claims
- Updated the following managers to use lightweight listing/query paths for
  search and composition projection flows, reducing unnecessary GCS blob
  downloads during Firestore-backed live runs:
  - `src/managers/CompositionManager.ts`
  - `src/managers/CommunicationManager.ts`
  - `src/managers/IndividualManager.ts`
  - `src/managers/MedicationStatementManager.ts`
- Changed Firestore `vaultExists(...)` so existence checks no longer hydrate the
  host tenant-registration JWE from GCS just to answer a boolean existence test.
- Updated managers that already receive `TenantsCacheManager` so tenant
  existence checks reuse the in-memory tenant cache where possible instead of
  going back to the repository:
  - `src/managers/CommunicationManager.ts`
  - `src/managers/IndividualManager.ts`
  - `src/managers/OpenIdAuthManager.ts`
- Renamed the ambiguous commercial read-model helper to an offer/order-specific
  name and aligned tests/utilities with that terminology:
  - `src/utils/offer-order-read-model.ts`
  - `src/__tests__/unit/utils/offer-order-read-model.test.ts`
- Moved offer/order search handling out of `HostingManager` and `FamilyManager`
  onto lightweight indexed queries instead of reopening encrypted vault
  records for readback screens.
- Narrowed runtime managers away from the concrete `TenantsCacheManager`
  implementation. Ordinary managers now consume minimal interfaces or host
  scalars instead of a broad tenant-registry capability surface.
- Updated tenant runtime caching so:
  - general metadata lookups use a sanitized runtime projection
  - explicit full reads remain privileged
  - host lifecycle and tenant lifecycle refreshes invalidate/reload cache after
    storage writes
- Tightened lifecycle gating so hosted tenant/host disable and purge flows
  respect real descendants while ignoring known auxiliary records that should
  not block lifecycle transitions:
  - bootstrap technical controller records
  - auxiliary `Occupation` records stored in `employees`
- Corrected host lifecycle resolution so host disable/purge no longer tries to
  resolve the host through hosted-tenant reverse lookup by `identifier.value`.
- Added submit-time hosted individual gating in the family/individual flow so a
  disabled tenant cannot create new hosted individual registrations.
- Reduced several route/service full-tenant reads to narrower metadata lookups:
  - `src/routes/api.ts`
  - `src/routes/discovery.ts`
  - `src/routes/ledger.ts`
  - `src/services/DiscoveryService.ts`
- Updated the shared dependency target to `gdc-common-utils-ts@^1.24.1`.
- Refreshed generated OpenAPI profile artifacts after the latest local build.

### Performance Notes
- Live `Firestore + GCS` tracing identified the primary latency source as
  repeated hydration of the host/tenant registration JWE during existence
  checks and search/list flows.
- The storage optimizations above materially reduced live-suite overhead during
  local Firestore+GCS runs by:
  - replacing repeated blob hydration with lightweight index-only reads where
    full JWE payloads were not needed
  - avoiding GCS downloads for Firestore `vaultExists(...)`
  - shifting some tenant existence checks onto the tenant cache
- Lifecycle descendant scans now use `listContainersInSection(...)` rather than
  hydrated reads, which materially reduced GCS traffic during host/tenant
  lifecycle validation.

### Security And Boundaries
- Documented capability boundaries with JSDoc so future changes do not quietly
  widen tenant-registry access again.
- Split general runtime tenant lookup from privileged control-plane reads so
  everyday managers no longer depend on a type that can decrypt full tenant
  registrations by default.

### Validation
- `npm run type-check`
- `npm run api:local-demo` + `HOST_ID_VALUE=... npm run test:e2e:live-gw`
- `npm run api:local-firestore-demo` + `HOST_ID_VALUE=... npm run test:e2e:live-gw`

## [1.14.3] - 2026-06-18

### Added
- Added the host-side legal-organization verification transaction contract as a
  first-class onboarding step so GW can forward PDF evidence to ICA `_verify`
  and return the next commercial step for `Order/_batch`:
  - `src/managers/HostingManager.ts`
  - `src/routes/api.ts`
  - `src/__tests__/unit/managers/HostingManager.verification-transaction.test.ts`
  - `src/__tests__/data/example-payloads.ts`
- Added explicit operational testing guidance for the real verification order:
  local process TTY, local Docker, staging, then production:
  - `TESTING.md`
- Added `v1.5-tabla-portal-api-gw.md` and refreshed the portal/BFF mapping docs
  so organization onboarding and public DID resolution are documented from the
  external integration perspective:
  - `v1.5-tabla-portal-api-gw.md`
  - `docs/PORTAL_API_TO_GW_CORE.md`
  - `docs/API_CORE_INTEGRATION.md`
  - `docs/OPENAPI_PROFILE_MATRIX.md`

### Changed
- Updated GW to consume `gdc-common-utils-ts@^2.0.5` and reuse shared
  DIDComm submit constants plus shared legal-organization bundle helpers
  instead of local string literals/path drilling:
  - `src/managers/HostingManager.ts`
  - `src/__tests__/unit/managers/HostingManager.test.ts`
  - `src/__tests__/unit/utils/swagger-spec.test.ts`
- Clarified the OpenAPI/Swagger contract for `Organization/_transaction`,
  including the response bundle, examples, and profile exports:
  - `swagger.config.cjs`
  - `src/utils/swagger-spec.ts`
  - `artifacts/openapi-profiles/openapi-core.json`
  - `artifacts/openapi-profiles/openapi-compat.json`
  - `artifacts/openapi-profiles/openapi-extension.json`
- Fixed deploy/runtime configuration so Cloud Run and local-demo can receive
  explicit ICA routing and security/network variables for host-side
  `_transaction` verification:
  - `cloud_deploy.sh`
  - `env.local-demo.example`
  - `src/server.ts`
- Refreshed repository docs and examples to point integrators at the canonical
  live verification flow and contract surface:
  - `README.md`
  - `docs/90.A-API_INTEGRATORS_GUIDE.md`

### Testing
- `npm test -- --runInBand src/__tests__/unit/managers/HostingManager.verification-transaction.test.ts src/__tests__/unit/utils/swagger-spec.test.ts`

### Changed
- Updated `v1.5-tabla-portal-api-gw.md` so the portal-facing organization
  onboarding contract is documented as `organization-registrations` instead of
  exposing GW-internal `verification-transaction` / activation / order steps as
  frontend-first routes.
- Extended `v1.5-tabla-portal-api-gw.md` with a dedicated public `did:web`
  resolution block so portal `GET .../.well-known/did.json` facades are
  documented as projections of the real GW-hosted DID documents rather than as
  a separate identity plane.
- Added `v1.5-tabla-portal-api-gw.md` and refreshed the canonical portal/BFF
  mapping docs so legal-organization `Organization/_transaction` is treated as
  a first-class portal-facing operation and tenant-side `Organization/_binding`
  is explicitly tracked as a pending GW/OpenAPI publication rather than being
  silently implied:
  - `v1.5-tabla-portal-api-gw.md`
  - `docs/PORTAL_API_TO_GW_CORE.md`
  - `docs/API_CORE_INTEGRATION.md`
  - `docs/OPENAPI_PROFILE_MATRIX.md`
- Bumped the GW package patch version from `1.14.1` to `1.14.2` to publish the
  `gdc-common-utils-ts@^2.0.2` adoption alongside the corresponding image/deploy
  tag lineage.
- Updated the shared dependency target to `gdc-common-utils-ts@^2.0.2`.
- Updated demo `_activate` representative binding fallback so GW now consumes
  the canonical shared RFC 9278 JWK-thumbprint helper from
  `gdc-common-utils-ts` instead of maintaining a local derivation path:
  - `src/managers/HostingManager.ts`
- Normalized demo/plaintext representative fallback material to the canonical
  `urn:ietf:params:oauth:jwk-thumbprint:sha-256:<base64url>` form when ICA
  omits `credentialSubject.hasCredential.material`, using controller JWK data
  first and only preserving an already-prefixed fallback `kid` value when no
  JWK is available.
- Updated activation route/unit coverage so GW assertions compare against the
  same shared thumbprint helper used by SDK/common-utils:
  - `src/__tests__/unit/managers/HostingManager.activation.test.ts`
  - `src/__tests__/integration/organizationApi.test.ts`
- Updated the shared dependency target to `gdc-common-utils-ts@^2.0.1`.
- Refreshed generated core-flow and OpenAPI profile artifacts so activation
  examples now show the canonical hashed controller `sameAs` form rather than
  `mailto:` fallback examples:
  - `artifacts/core-flow-examples.json`
  - `artifacts/openapi-profiles/openapi-compat.json`
  - `artifacts/openapi-profiles/openapi-core.json`
  - `artifacts/openapi-profiles/openapi-extension.json`
- Added an explicit GW CORE architecture baseline so backend contract ownership
  and layering against shared SDK packages is documented in-repo:
  - `ARCHITECTURE.md`
- Refreshed the Docker build dependency checksum after the current dependency
  graph changes:
  - `.docker-build-deps.sha256`

## [1.14.1] - 2026-06-16

### Changed
- Activation onboarding now fills missing
  `org.schema.Organization.identifierValue` from ICA
  `organizationCredential.credentialSubject.taxID` and defaults
  `org.schema.Organization.identifierType` to `UUID` when the identifier value
  is a UUID, otherwise to `TAX`, before generating the canonical organization
  URN. When `alternateName` is also missing for a legal organization, GW now
  derives it from the final canonical `identifierValue`, so tax-id-only
  onboarding becomes `taxID -> identifierValue -> alternateName`, while an
  explicit legal identifier still wins over `taxID` for path-facing tenant ids
  and vault ids. This avoids activation failures when ICA-first payloads omit
  the flat identifier claims:
  - `src/managers/HostingManager.ts`
- Documented the conservative communication-retention lifecycle boundary so
  individual, tenant, and host purge flows can skip retained `Communication`
  records by default while `COMMUNICATION_RETENTION_DISABLED=false`, and added
  explicit audit/compliance references in:
  - `docs-v2/16-deactivation-and-purge-lifecycle.md`
- Relaxed ICA activation representative validation so `Organization/_activate`
  no longer requires the representative VC `credentialSubject.id` to be a
  `did:web`; non-DID subject ids such as `urn:person:...` now pass while GW
  still enforces representative role and key-binding policy through:
  - `src/adapters/activation-trust.adapter.ts`
  - `src/__tests__/unit/managers/HostingManager.activation.test.ts`
  - `src/__tests__/integration/organizationApi.test.ts`
- In `SECURITY_MODE=demo`, `Organization/_activate` now backfills a missing
  representative `credentialSubject.hasCredential.material` from explicit
  `controller.publicKeyJwk.kid` or DIDComm `meta.jws.protected.kid` before
  running shared activation policy validation. Production/strict modes remain
  unchanged; this is a demo bootstrap fallback for ICA payloads that still do
  not emit representative binding data:
  - `src/managers/HostingManager.ts`
  - `src/__tests__/unit/managers/HostingManager.activation.test.ts`
  - `src/__tests__/integration/organizationApi.test.ts`
- Added/updated portal/backend-facing operational docs for the new v1.3
  lifecycle and deploy flow:
  - `v1.3-tabla-portal-api-gw.md`
  - `DEPLOY.md`
  - `demo-deploy.config.example`
  - `cloud_deploy.sh`
  - `.docker-build-deps.sha256`
- Clarified the release scope to include the VC verification fix in
  `_activate`, along with the communication-search and lifecycle hardening work
  already in flight across:
  - `src/__tests__/unit/adapters/activation-trust.adapter.test.ts`
  - `src/utils/services.ts`
  - `src/managers/CommunicationManager.ts`
  - `src/__tests__/unit/managers/CommunicationManager.unit.test.ts`
- Added indexed `Communication/_search` support for communication channel
  records, including normalized participant matching, claim-based search
  filters, shared pagination semantics, and canonical `search-response`
  envelopes in:
  - `src/managers/CommunicationManager.ts`
  - `src/utils/services.ts`
  - `src/__tests__/unit/managers/CommunicationManager.unit.test.ts`
- Updated the root deployment entrypoint so GKE deployments can now be selected
  by profile via `./cloud_deploy.sh gke <profile> [config-file]`, which loads
  `.env.gke.<profile>` before the infra-specific GKE config file.
- Kept `./cloud_deploy.sh gke-demo [config-file]` as a backward-compatible
  alias for the current `gdc` GKE profile.
- Updated `demo-deploy.config.example` so runtime GW settings are expected to
  come from `.env.gke.<profile>` instead of hardwiring `.env.local-demo`.
- Added `DEPLOY.md` at the repo root to document the practical split between
  local demo, Cloud Run deployment envs, and GKE profile-based deployment.

## [1.13.0] - 2026-06-13

### Added
- Added confidential blob persistence abstractions so encrypted vault metadata
  can keep large/private payloads in the configured storage backend instead of
  forcing every repository implementation to inline the same storage logic:
  - `src/database/storage/IConfidentialBlobStore.ts`
  - `src/database/storage/storage-adapter-confidential-blob.store.ts`
  - `src/database/repositories/vault/confidential-storage-persistence.ts`
- Added explicit lifecycle and audit documentation for deactivation and purge
  flows in:
  - `docs-v2/16-deactivation-and-purge-lifecycle.md`
- Added host/tenant discovery publication guards so dataspace discovery
  endpoints stop advertising disabled participants while keeping DID material
  resolvable for audit/readback scenarios.
- Added `_purge` support to the host registry organization service contract and
  corresponding lifecycle tests for host/tenant gating and destructive cleanup.

### Changed
- Updated the shared dependency target to `gdc-common-utils-ts@^1.24.0`.
- Refactored infrastructure bootstrap so Firestore/PostgreSQL vault repositories
  receive a confidential blob store backed by the configured storage adapter.
- Updated Firestore/PostgreSQL vault repositories and storage adapters to
  persist blob-backed confidential payloads consistently across `mem`, GCS, and
  Supabase storage modes.
- Hardened host startup so a fresh `HOST_ID_VALUE` bootstraps first and only
  then warms the in-memory tenant cache, avoiding stale host cache state across
  local/live executions.
- Standardized local test/runtime profile documentation and loaders around
  `.env.local-demo`:
  - `jest.setup.ts`
  - `scripts/verify-auth.ts`
  - `TESTING.md`
  - `TESTING-GUIDE.md`
  - `README.md`
  - `demo-deploy.config.example`
- Simplified local stop behavior so `api:close` reuses the canonical
  `local:close` path.
- Updated Firebase initialization to resolve the project id explicitly from the
  active environment before calling `firebase-admin`.

### Lifecycle And Contract Changes
- Extended host registry lifecycle routes so `Organization/_purge` is exposed as
  a first-class contract alongside `_enable` and `_disable`.
- Tightened tenant lifecycle authorization rules:
  - a tenant cannot be disabled while active employees remain
  - a tenant cannot be disabled while active individuals/family members remain
  - a tenant cannot be purged until it is already disabled
  - a tenant cannot be purged while non-purged descendants remain
  - the host cannot be disabled or purged while hosted tenant registrations
    still exist
- Marked the bootstrap controller employee record with a dedicated lifecycle
  role so host lifecycle enforcement can ignore that synthetic record when
  counting real descendants.
- Replaced duplicated local activation service parsing with shared policy
  validation from `gdc-common-utils-ts`, enforcing required sector/service-type
  authorization during hosted activation.
- Updated discovery routes so disabled or purged hosts/tenants return
  non-published responses instead of continuing to surface dataspace metadata.

### Individual/Family Purge Semantics
- Changed family/individual purge from a soft status update to destructive
  cleanup of:
  - the stored family registration record
  - hashed subject-scoped individual sections
  - best-effort referenced confidential blobs
- Added subject identifier collection and hashed section scanning so purge
  removes all related individual/member fragments derived from the registration.
- Added best-effort blob reference traversal for `blobRef` fields and
  `*#hash`-style references before deleting the underlying vault record.

### Testing
- Expanded lifecycle/unit/integration coverage for:
  - host lifecycle gating and activation policy enforcement
  - family purge behavior
  - Firestore/PostgreSQL confidential persistence flows
  - discovery publication behavior
  - storage adapter blob persistence semantics
- Updated OpenAPI profile artifacts to reflect the current published contract.

## [1.12.1] - 2026-06-13

### Changed
- Updated the shared dependency target to `gdc-common-utils-ts@^1.23.0`.
- Pulled the newly published shared invoice/charge-item claims surface into GW
  CORE so the hosted commercial/order flows added in `1.12.0` now consume the
  same published package version that exposes:
  - canonical `Invoice.*` claims
  - canonical `ChargeItem.*` claims
  - charge-item repeated-row builders
  - contextualized `org.hl7.fhir.api.*` invoice/charge-item projections
  - embedded `resource.meta.claims` invoice projection support
- Refreshed the lockfile so GW CORE resolves the published `1.23.0` tarball
  rather than the previous `1.22.0` line for all environments that install
  from npm.
- Kept the release intentionally code-stable inside GW CORE itself:
  - no manager/controller source logic changed in this patch
  - no OpenAPI contract files were intentionally regenerated for this patch
  - the purpose of this release is to move the runtime onto the published
    shared claims surface that backs invoice and charge-item readback

### Dependency Surface Now Available Through GW CORE
- Invoice-level claims available through the shared dependency include:
  - `Invoice.identifier`
  - `Invoice.date`
  - `Invoice.status`
  - `Invoice.subject`
  - `Invoice.recipient`
  - `Invoice.issuer`
  - `Invoice.issuer-display`
  - `Invoice.payment-terms`
  - `Invoice.payment-url`
  - `Invoice.totalnet-value`
  - `Invoice.totalnet-currency`
  - `Invoice.totalgross-value`
  - `Invoice.totalgross-currency`
- Charge-item-level claims available through the shared dependency include:
  - `ChargeItem.identifier`
  - `ChargeItem.status`
  - `ChargeItem.part-of`
  - `ChargeItem.code`
  - `ChargeItem.code-text`
  - `ChargeItem.category`
  - `ChargeItem.supplier-productcode`
  - `ChargeItem.quantity`
  - `ChargeItem.quantity-number`
  - `ChargeItem.quantity-unit`
  - `ChargeItem.items-per-unit`
  - `ChargeItem.items-quantity`
  - `ChargeItem.items-quantity-number`
  - `ChargeItem.items-quantity-unit`
- High-level shared builders/readers now available through the published
  dependency include:
  - invoice claim-row construction from `createInvoiceBundleEditor()`
  - repeated invoice + charge-item row generation
  - contextualized claim generation for query/readback paths
  - invoice `meta.claims` embedding in generated FHIR `Invoice` resources

### Testing
- `npm install gdc-common-utils-ts@^1.23.0`

## [1.12.0] - 2026-06-13

### Added
- Added portal-managed payment confirmation utilities in:
  - `src/utils/payment-confirmation.ts`
- Added embedded invoice bundle generation for commercial order responses in:
  - `src/utils/invoice-bundle.ts`
  - `docs/PORTAL_API_TO_GW_CORE.md`
- Added focused unit coverage for payment confirmation and commercial order
  invoice readback in:
  - `src/__tests__/unit/utils/payment-confirmation.test.ts`
  - `src/__tests__/unit/managers/HostingManager.OfferOrder.test.ts`
  - `src/__tests__/unit/managers/FamilyManager.OfferOrder.test.ts`

### Changed
- Updated hosted organization and family/individual commercial order flows so
  persisted offer/order state can be reopened and the accepted order response
  now includes:
  - FHIR `Invoice`
  - `DocumentReference` PDF
  - `DocumentReference` structured JSON/XML
- Persisted commercial offer state for both employee and individual/member
  seat activation follow-up flows.
- Fixed `api:local-firestore-demo` so the local firestore profile starts with
  the same `ts-node` compiler option escaping used by the demo profile.
- Updated the shared dependency target to `gdc-common-utils-ts@^1.22.0`.

### Testing
- `npm run type-check`
- `npm test -- --runInBand src/__tests__/unit/utils/payment-confirmation.test.ts src/__tests__/unit/managers/HostingManager.OfferOrder.test.ts src/__tests__/unit/managers/FamilyManager.OfferOrder.test.ts src/__tests__/unit/managers/IndividualManager.test.ts src/__tests__/unit/managers/EmployeeManager.test.ts`

## [1.11.1] - 2026-06-13

### Changed
- Added explicit `RelatedPerson/_purge` lifecycle handling in the individual
  surface, requiring the stored record to already be inactive and preserving
  the record with purge metadata instead of hard-deleting it.
- Aligned `RelatedPerson` processing with the canonical claims envelope by
  reading `resource.meta.claims` first while keeping legacy `entry.meta.claims`
  compatibility during migration.
- Extended `RelatedPerson` lifecycle writes to preserve canonical per-entry
  status from `resource.meta.status`, enabling inactive-state lifecycle updates
  to flow through the stored record shape.
- Hardened stored `RelatedPerson` normalization so purge/update flows can
  operate consistently whether the vault returns raw content or wrapped
  records.
- Published new DID service definitions for `RelatedPerson/_purge` on both
  `org.hl7.fhir.r4` and `org.hl7.fhir.api` individual endpoints.
- Added modular commercial/license read-model helpers in:
  - `src/utils/commercial-read-model.ts`
  - `src/utils/license-search.ts`
- Added `License/_search` support plus hosted/family `Offer/_search` and
  `Order/_search` readback so portal-facing flows can reopen persisted
  commercial state without inventing a separate service contract.
- Made the request body size limit explicit and configurable through
  `GW_REQUEST_BODY_LIMIT`, returning a clear `413` lifecycle-safe early error
  when large `Communication/_batch` payloads exceed the configured limit.
- Updated the shared dependency target to `gdc-common-utils-ts@^1.21.0`.

### Testing
- `npm test -- RelatedPersonManager.test.ts request-validator.test.ts`

## [1.10.2] - 2026-06-11

### Changed
- Updated the shared dependency target to `gdc-common-utils-ts@^1.20.2`.
- Updated `cloud_deploy.sh` so Cloud Run deployments can resolve versioned
  Artifact Registry image tags from `package.json` plus the current git SHA,
  and reuse a prebuilt local Docker image when `SKIP_BUILD=true`.

## [1.10.1] - 2026-06-11

### Changed
- Simplified the Docker image build so GW CORE no longer copies the deprecated
  local `gdc-sdk-client-ts` source tree into the builder/runtime image.
- Narrowed `EXTRA_TS_PATCH_DIRS` in the Docker build to the remaining shared
  local dependency (`gdc-common-utils-ts`), keeping local image creation aligned
  with the current dependency graph.

### Testing
- `./docker_build_local.sh`

## [1.10.0] - 2026-06-10

### Added
- Added an individual onboarding PDF draft flow in GW CORE so a controller can
  submit template bytes/reference plus KYC/form data and receive a filled PDF
  draft back as `DocumentReference` claims.
- Added shared onboarding draft generation helpers in:
  - `src/utils/individual-onboarding-pdf-draft.ts`
  - `src/utils/individual-organization-kyc.ts`
  - `src/utils/service-capability-claims.ts`
- Added focused coverage for:
  - onboarding PDF draft generation in `FamilyManager`
  - worker routing for `individual/pdf/DocumentReference/_create`

### Changed
- Integrated KYC normalization into the individual/family onboarding flow so
  GW CORE now merges claims with precedence:
  - raw claims
  - KYC-derived claims
  - PDF/form-derived claims
- Completed the GW CORE PDF field mapping for the pending onboarding fields,
  including subject birth/gender fields, consent date, and service-provider
  domain.
- Switched the onboarding draft route contract from `Action/_create` to the
  more accurate `DocumentReference/_create`, while keeping `Action` accepted
  temporarily inside the family manager for compatibility.
- Fixed worker routing so `DocumentReference/_create` requests under
  `individual/pdf` actually reach the family onboarding manager instead of the
  generic document manager.
- Updated tenant/host discovery capability publication and filtering so GW
  CORE accepts capabilities from both:
  - `Service.serviceType`
  - `Service.additionalType`
  during the discovery migration.
- Clarified `Service.additionalType` handling so compact HL7
  `ActReason` values such as
  `http://terminology.hl7.org/CodeSystem/v3-ActReason|METAMGT,HRESCH`
  are treated as purposes and no longer misread as provider discovery
  capabilities.
- Expanded the API/family integrator guides to document the onboarding PDF
  draft endpoint and the transitional discovery-capability semantics.

### Testing
- `npm test -- --watchman=false src/__tests__/unit/worker.test.ts src/__tests__/managers/FamilyManager.test.ts src/__tests__/unit/utils/services.test.ts`
- `npm run build`

## [1.9.0] - 2026-06-07

### Added
- Added consent-access blockchain registration support so consent ingestion can
  project one sanitized atomic rule per on-chain asset through a dedicated
  `registerConsentAccessBundle(...)` adapter path.
- Added Fabric write-capable blockchain adapters and local-memory/multi-adapter
  composition for progressive consent-access ledger integration:
  - `src/adapters/BlockchainAdapterFabric.ts`
  - `src/adapters/BlockchainAdapterMulti.ts`
- Added local Fabric bootstrap and smoke/demo support for GW CORE:
  - `npm run prepare:local-fabric-env`
  - `npm run api:local-fabric`
  - `npm run api:local-fabric-devnet`
- Added `local-network` as an explicit runtime network mode distinct from the
  shared `test-network` integration environment.

### Changed
- Normalized legacy plaintext API requests so managers always receive business
  payloads through `job.content.body`, matching the DIDComm path contract.
- Updated consent processing to derive canonical consent blockchain entries,
  persist FHIR CID mappings, and then register consent-access rules on Fabric
  using jurisdiction-group channel resolution.
- Regenerated Swagger/OpenAPI profile artifacts and updated bootstrap,
  discovery, and hosting/operator documentation around the Fabric/local-network
  flow.
- Updated the shared dependency target to `gdc-common-utils-ts@^1.19.0`.

### Testing
- `npm test -- --watchman=false src/__tests__/managers/ConsentManager.test.ts`
- `npm run build`

## [1.8.5] - 2026-06-05

### Changed
- Fixed the GKE demo deployment probes to use `/host/ping` instead of the
  removed root host discovery alias `/host/.well-known/ping`, so new GW CORE
  revisions can become `Ready` after rollout.

### Testing
- GKE demo rollout inspection against the public deployment, including
  verification that the previous `1.8.4` pod was blocked by `404` on the old
  readiness probe path.

## [1.8.4] - 2026-06-05

### Changed
- Fixed GW CORE runtime public-origin resolution so deployed host and tenant
  discovery artifacts now use `HOST_PUBLIC_URL` when that is the public edge
  URL injected by GKE/configmap, instead of falling back to `localhost`.
- Fixed hosted DID service publication so tenant operational URLs do not
  duplicate `/{tenantId}/cds-{jurisdiction}/{version}/{sector}` when the
  existing runtime base URL already includes that contextual path with
  different casing.

### Testing
- `npm test -- --watchman=false src/__tests__/unit/config/server-config.test.ts src/__tests__/unit/utils/did-document.test.ts src/__tests__/integration/wellKnownApi.test.ts src/__tests__/integration/hostDemoWellKnown.test.ts`

## [1.8.3] - 2026-06-05

### Changed
- Removed root host `/.well-known` discovery aliases from GW CORE.
- Host discovery artifacts now publish only under the scoped path:
  `/host/cds-{hostCoverageScope}/{version}/{hostNetwork}/.well-known/...`
- Reserved `/host/ping` as the only root-level host liveness endpoint.
- Fixed hosted DID/DCAT publication so the public discovery surface no longer
  falls back to `localhost` when the deployment provides a public URL.
- Fixed hosted tenant service endpoint generation so operational URLs that
  already include `/{tenantId}/cds-{jurisdiction}/{version}/{sector}` do not
  duplicate that path in published DID services.
- Updated the demo GKE deploy config to export `HOST_DEPLOY_URL` from the
  static public edge URL, so host and tenant discovery artifacts publish the
  real public origin after deployment.

### Testing
- `npm test -- --watchman=false src/__tests__/integration/wellKnownApi.test.ts src/__tests__/integration/hostDemoWellKnown.test.ts src/__tests__/unit/utils/swagger-spec.test.ts`
- `npm test -- --watchman=false src/__tests__/unit/utils/did-document.test.ts src/__tests__/unit/managers/TenantsCacheManager.url.test.ts src/__tests__/integration/wellKnownApi.test.ts`

## [1.8.2] - 2026-06-05

### Changed
- Updated the shared dependency target to `gdc-common-utils-ts@^1.18.1`.
- Aligned FHIR resource versioning with the clinical replay contract:
  - resource canonicalization for `versionId` now excludes top-level `id`,
    `meta`, and narrative `text`
  - the hash now uses multibase58btc SHA3-384 multihash bytes
  - `Communication` IPS projections now skip duplicate clinical section
    entries by resource `meta.versionId`, even when the replayed IPS changes
    document/container ids or dates
- Added explicit host coverage-scope configuration with `HOST_COVERAGE_SCOPE`,
  defaulting to `EU` when unset.
- Switched the host-scoped DSP discovery and ping surface from legal
  `jurisdiction` semantics to `hostCoverageScope` semantics:
  - `/host/cds-{hostCoverageScope}/{version}/{hostNetwork}/.well-known/ping`
  - `/host/cds-{hostCoverageScope}/{version}/{hostNetwork}/.well-known/dspace-version`
  - `/host/cds-{hostCoverageScope}/{version}/{hostNetwork}/dsp/catalog/...`
- Aligned the host DID service publication and backend discovery DTOs with the
  same host coverage-scope contract while keeping tenant/provider discovery
  tenant-jurisdiction scoped.
- Updated all shipped env templates so deployments that previously used
  `HOST_JURISDICTION=EU` as a discovery scope now publish that meaning through
  `HOST_COVERAGE_SCOPE=EU`, while keeping `HOST_JURISDICTION` available for the
  host legal jurisdiction.
- Regenerated the local core-flow and Swagger/OpenAPI profile artifacts after
  the host coverage-scope configuration alignment.

### Testing
- `npm test -- --watchman=false src/__tests__/unit/utils/fhir-versioning.test.ts src/__tests__/unit/managers/CommunicationManager.unit.test.ts src/__tests__/integration/medication-statement.api.test.ts`
- `npm test -- --watchman=false src/__tests__/integration/wellKnownApi.test.ts src/__tests__/unit/utils/swagger-spec.test.ts src/__tests__/unit/utils/dataspace.did-services.compliance.test.ts`
- `npm run build`

## [1.8.0] - 2026-06-04

### Added
- Added frontend-style `Communication` embedded consent readback coverage via
  `individual/org.hl7.fhir.api/Subject/_search` with attached FHIR `Parameters`,
  so one `Communication` can retrieve the subject-scoped `Consent` projections
  previously persisted from bundled consent attachments.
- Added reproducible local consent flow artifacts for:
  - bundled consent creation
  - consent readback through embedded `Subject/_search`

### Changed
- Updated the shared dependency target to `gdc-common-utils-ts@^1.17.0`.
- Extended the local consent live artifacts to cover both:
  - bundled consent creation via `Communication/_batch`
  - consent readback via `Communication/_batch` forwarding to `Subject/_search`
- Aligned the canonical consent communication example with
  `resource.meta.claims` instead of legacy `entry.meta.claims`.

### Testing
- `npm test -- --watchman=false src/__tests__/unit/managers/CommunicationManager.unit.test.ts src/__tests__/unit/managers/IndividualManager.test.ts src/__tests__/unit/utils/services.test.ts src/__tests__/integration/consent.communication.api.test.ts`
- live/local `api:local-demo` + `demo:bootstrap-single-tenant` consent write/read verification via `Communication/_batch`

## [1.7.5] - 2026-06-04

### Changed
- Updated the shared dependency target to `gdc-common-utils-ts@^1.16.0`.
- Clarified activation/OpenAPI guidance around key-binding semantics for:
  - `Organization.hasCredential.material`
  - `Person.hasCredential.material`
  - `SoftwareApplication.material`
- Clarified RFC 7638 JWK thumbprints and RFC 9278 URN representation in the
  activation-proof and integrator-guide text.
- Regenerated Swagger/OpenAPI profile artifacts after the documentation
  alignment.

## [1.7.3] - 2026-06-01

### Added
- Added a dedicated two-host autodiscovery smoke runbook and scripts for local
  `Alice` / `Bob` GW instances, including:
  - versioned env templates `env.alice.example` and `env.bob.example`
  - `scripts/run-alice-bob-local.sh`
  - `scripts/bootstrap-alice-bob-discovery.sh`
  - `scripts/smoke-alice-bob-autodiscovery.sh`

### Changed
- Migrated the local two-host autodiscovery smoke from legacy `/.well-known/dcat3/catalog`
  to the host-scoped DSP contract:
  - `GET /host/cds-{jurisdiction}/{version}/{hostNetwork}/.well-known/dspace-version`
  - `GET /host/cds-{jurisdiction}/{version}/{hostNetwork}/dsp/catalog/dcat.json`
- Clarified host ping semantics so GW CORE now documents two distinct checks:
  - `GET /host/.well-known/ping` for global host runtime liveness/readiness
  - `GET /host/cds-{jurisdiction}/{version}/{hostNetwork}/.well-known/ping`
    for the host-scoped hosting/autodiscovery surface
- Extended the host discovery/runtime surface to accept the host-scoped ping
  path while keeping `/host/.well-known/ping` as a compatibility alias.
- Updated host autodiscovery publication to read `org.schema.Service.*` claims
  from the persisted tenant provider-service shape as well as top-level claims,
  so bootstrapped provider tenants are published correctly in live host catalogs.
- Extended `scripts/bootstrap-single-tenant.sh` so local smoke/bootstrap flows
  can explicitly set:
  - `org.schema.Service.url`
  - `org.schema.Service.areaServed`
  - `org.schema.Service.serviceType`
- Clarified the GW-to-ICA lifecycle documentation for:
  - hosting operator / tenant onboarding
  - `Token/_exchange`
  - `Device/_dcr`
  - CSR enrollment with ICA
  - tenant publication via host autodiscovery
- Removed the transitional tenant demo ICA CSR enrollment call so the current
  runtime model stays host-only for Fabric/X.509 enrollment.

## [1.7.1] - 2026-05-27

### Changed
- Updated the shared dependency target to `gdc-common-utils-ts@^1.10.0`.
- Aligned tenant service-capability fixtures and discovery tests with the
  clearer shared `IndexReader` / `IndexProvider` naming while preserving the
  persisted token contract.

## [1.6.1] - 2026-05-26

### Fixed
- Docker runtime image now includes `artifacts/openapi-profiles`, so the published Swagger UI can fetch `openapi-core.json`, `openapi-compat.json`, and `openapi-extension.json` instead of failing with `Not Found`.

### Changed
- Added a root-level `gke-demo` deployment path for the current GW standalone demo, including IP-only `LoadBalancer` exposure, reusable local-image push with `SKIP_BUILD=true`, and minimal GKE manifests under `fabric-multicloud/k8s/gdc/`.

## [1.6.0] - 2026-05-26

### Changed
- Added `STORAGE_PROVIDER=supabase` support so GW can keep confidential indexed storage in PostgreSQL while storing uploaded files in Supabase Storage via `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_STORAGE_BUCKET`.
- Standardized env template naming around visible `env.*.example` files, leaving `.env.*` names for private local copies only, with local runtime variants using `local-*` (`.env.local-demo`, `.env.local-postgres`) and the Supabase runtime using `cloud-*` (`.env.cloud-supabase`) to match the `npm run api:*` commands.
- Switched local and cloud runtime scripts from layered dotenv overlays to single full-profile `.env.*` files so each `npm run api:*` command now maps to one complete environment file.
- `docker_run_local.sh` now accepts `HOST_PORT`, `ENV_FILE`, `CONTAINER_NAME`, `IMAGE_NAME`, and `FORCE_RECREATE`, so local Docker runs no longer require hardcoded `8080` / `.env.local` edits.
- Added a first GKE deployment skeleton for the GW host/connector under `fabric-multicloud/k8s/gdc/`, explicitly separated from Fabric components and from `dataspace-ica-ts`, with a render/apply script driven by `K8S_NAMESPACE_GDC`, `GDC_IMAGE`, and `ICA_URL_*`.
- Extended the GKE GW skeleton to support the ICA-style public edge pattern: reserved static IP, GKE ingress, and Google-managed certificate.
- Added `demo-deploy.config.example` plus env-driven GKE GW rendering so demo deployments can reuse `.env.local` and stay on `mem` providers instead of forcing Firestore/GCS.
- Simplified the demo GKE GW deployment model so `dataspace-ica-ts` is no longer assumed to be co-deployed or reachable internally; only an optional external ICA URL remains.
- Extended the root `cloud_deploy.sh` entrypoint with a `gke-demo` mode so the current demo GKE deployment can be launched from the repo root instead of going through `fabric-multicloud` manually.
- Added `SKIP_BUILD=true` support to the root `cloud_deploy.sh` GKE demo path so an already-built local Docker image can be retagged and pushed without rebuilding.
- Simplified the GKE demo path to IP-only HTTP for the current phase: `LoadBalancer` Service with a reserved static IP, no domain, no managed certificate, and no ingress dependency.
- Core Swagger family-registration request bodies now expose two named examples in the selector: online PDF link and inline base64 PDF, so integrators can compare the two transport forms directly.
- Family registration signed-PDF onboarding now accepts HTTPS attachment links via `attachments[].data.links[0]` in addition to embedded base64, and the canonical Swagger/example fixture defaults to the online-link form.
- Demo/smoke shell scripts no longer define copied business payload JSON inline when a canonical TypeScript fixture/helper exists; portal route smoke and medication/IPS demo flows now render their payloads from shared TS sources and only apply runtime overrides in Bash.
- Portal web go/no-go automation/docs now explicitly describe the command as a route smoke check backed by canonical example fixtures, instead of ad-hoc handwritten payload snippets or local `dummy-*` values.
- Updated SMART token authorization to evaluate the full active consent set for the subject instead of the previous single-rule MVP match.
- Added explicit deny precedence over broader organization/jurisdiction coverage in the live SMART path.
- Extended subject-scoped `Bundle/_search` handling so `Communication` permission requests can be recovered by:
  - `Communication.identifier`
  - `thid`
  - linked `DocumentReference.contenthash`
- Updated SMART compatibility and docs index notes to reflect the current live consent-evaluation behavior.
- Clarified Swagger family-registration examples so `Service.termsOfService` defaults to an HTTPS URL and `org.schema` claims are documented in the default contextualized form, with `CLAIMS_IDENTITY_STORAGE_MODE=canonical` called out as the strict fully-qualified alternative.
- Added markdown sync markers plus a conformance test so canonical GW guide payloads stay aligned with `src/__tests__/data/example-payloads.ts` instead of drifting as copied markdown.
- Legal-organization registration compatibility now derives internal `alternateName` from `Organization.identifier.value` when omitted, keeping `v1.x` flows working while public examples teach `taxId`/`identifier.value` as the canonical external input.
- Canonical legal-organization examples now use `acme-id` and omit `Organization.alternateName`; local bootstrap follows the same convention.
- Swagger Global Flow Context now re-migrates legacy `tenantId` / `taxId` values back to canonical `taxTenantId=acme-id`, rebuilds stale panels, and re-derives `physicianOrg` / `individualDid` from the canonical context instead of preserving legacy `TaxNumber-acme` or old `api.acme.org` individual DID placeholders.
- Swagger Global Flow Context now also derives a hashed professional member DID (`physicianDid`) from `physicianEmail` + `physicianRole` under the canonical organization DID, instead of treating the organization DID as the professional actor DID.
- Swagger Global Flow Context now also derives an individual controller DID (`individualControllerDid`) from `individualControllerEmail` + `individualControllerRole`, keeping the subject DID (`individualDid`) separate from the family/controller actor DID.
- Canonical individual/family Swagger examples now use homogeneous `{{individualDid}}`, `{{physicianOrg}}`, and `{{physicianDid}}` placeholders across SMART, Consent, Communication, Composition, Observation, and RelatedPerson payloads.
- Canonical family/controller examples now separate the subject DID from the controller DID, with `RelatedPerson` and related onboarding payloads using `{{individualControllerDid}}` where the human controller signs as the family actor.
- Added a dedicated `v2.0` TODO document for the future tenant-identifier/vault-id migration instead of mixing that breaking redesign into current core behavior.
- Added `scripts/render-example-payload.mts` so demo/incremental scripts can render request payloads from the same canonical fixtures used by tests and Swagger, with only explicit parameter overrides.
- Employee onboarding now behaves as canonical upsert/reactivation by `Organization.owner.email + Organization.owner.hasOccupation.identifier.value`, returning an already-existing active member directly and reactivating an inactive matching member instead of creating duplicates.
- Family onboarding now accepts and normalizes the signed individual-registration PDF attachment into canonical claims before building the stored registration artifacts.
- Added a canonical `_transaction` alias for `individual/org.schema/Organization` service discovery and Swagger so individual organization flows can be exercised with the same onboarding semantics as the existing batch route.
- Legal-organization activation/discovery now treats `org.schema.Service.serviceType` as the canonical capability source for tenant DID publication and DCAT3 service offerings, with the docs and examples aligned around mandatory activation capabilities.
- Regenerated Swagger/OpenAPI profile artifacts and aligned route descriptions, bootstrap scripts, env defaults, and curl examples around canonical `acme-id`, contextualized `org.schema` claims, and the synchronized local example fixtures.
- Reorganized legacy top-level guides under `docs/`, expanded reading-order/README guidance, and documented the local example-sync workflow so the repo reflects the current source-of-truth layout.
- Updated the shared dependency target to `gdc-common-utils-ts@^1.7.0`.
- Added local GW lifecycle documentation for SDK alignment:
  - `docs/01-OVERVIEW-AND-GUIDES/101-01.I-LIFECYCLE.md`
  - `docs/90.L-LIFECYCLE_CURRENT_VS_TARGET.md`
- Clarified current GW CORE lifecycle semantics:
  - `individual/org.schema/Organization/_disable` disables the hosted individual/family record without releasing licenses
  - `individual/org.schema/Organization/_purge` requires prior inactive status, releases or disassociates licenses, and preserves the record for traceability
  - `entity/org.schema/Employee/_purge` requires prior inactive status, releases or disassociates licenses, and preserves the employee record for traceability
- Clarified target lifecycle normalization for future shared-package / SDK migration:
  - `_batch + POST` create
  - `_batch + PUT` resource update
  - `_batch + PATCH` lifecycle or partial operational update
  - `/_purge + POST` explicit purge command
- Clarified that `ConfidentialStorageDoc.status` is the canonical current lifecycle state and that blockchain lifecycle anchoring should use a derived status-change event instead of the raw confidential storage document.
- Centralized key domain lifecycle and license literals under `src/constants/domain.ts` to reduce hardcoded action, section, and licensing strings in managers and routing helpers.
- Added a deploy-path split in `cloud_deploy.sh` so the same entrypoint now supports both Cloud Run environments and a demo GKE deployment mode.
- Added a minimal GW GKE deployment skeleton under `fabric-multicloud/k8s/gdc/`, plus templated rendering/apply support in `fabric-multicloud/scripts/05-k8s-deploy-gdc.sh`.
- Added `demo-deploy.config.example` and updated local Docker/GKE helper scripts to support reproducible demo deployment inputs without hardcoding secrets into the repo.
- Updated the runtime image packaging so generated OpenAPI profile artifacts are copied into the final container image for Swagger UI profile selection.

### Testing
- Added/updated focused tests for:
  - Supabase storage adapter hashing, upload wiring, and configuration parsing
  - family signed-PDF onboarding via remote HTTPS attachment link download
  - shell-script payload contract conformance (`dummy-*` regression guard + fixture-renderer usage)
  - SMART consent evaluation precedence
  - related-person SMART access
  - `Communication` lookup by identifier, thread id, and linked CID
  - legal-organization registration without explicit `alternateName`
  - Swagger Global Flow Context canonical helper fields and legacy migration hooks
  - employee create/reactivation upsert behavior
  - family registration signed-PDF claim extraction
  - individual organization transaction route exposure
  - synchronized markdown/shared-example conformance checks

## 1.5.1 - 2026-05-23

### Changed
- Aligned GW CORE activation, DID publication, discovery, and shared examples with the new shared package minor line.
- Updated the shared dependency target to `gdc-common-utils-ts@^1.5.0`.
- Clarified canonical `_activate` semantics around `vp_token`, `controller.*`, and deprecated legacy credential side-fields.

### Testing
- Targeted activation/discovery/shared-example suites pass against the packaged shared dependency.

## 1.3.14 - 2026-05-21

### Tests
- Added TDD coverage for the core lifecycle split:
  - `Employee/_batch` create, deactivate, and not-found handling
  - `MedicationStatement/_batch` not-found route semantics
  - `CommunicationManager` tenant-resolution not-found handling
- Kept coverage focused on canonical core flow resources without introducing extension behavior.

## 1.3.13 - 2026-05-20

### Added
- Local process helpers:
  - `npm run local:close` (port `3000`)
  - `npm run docker:close` (port `8000`)
- Canonical occupation claim helper:
  - `src/utils/occupation.ts`

### Changed
- Demo tenant bootstrap now uses canonical representative-role claims:
  - `org.schema.Person.hasOccupation.identifier.additionalType = "v3-RoleCode"`
  - `org.schema.Person.hasOccupation.identifier.value = "RESPRSN"`
- Role-code parsing migrated to canonical occupation helper in:
  - `HostingManager`
  - `EmployeeManager`
  - `FamilyManager`

### Tests
- `npm run type-check`: pass.
- `npm run test:e2e`: pass (no failing suites; specs remain conditionally skipped when live E2E credentials are not configured).

## 1.3.12 - 2026-05-18

### Added
- `CommunicationManager` now persists a subject-scoped auditable communication channel record as `CommMsgExtended` under `individual_communications_*` sections.

### Changed
- GW now treats `CommMsgExtended` as the atomic confidential-channel event and `FHIR Communication` as its interoperable health projection.
- `DocumentReference` extraction from `Communication.payload.contentAttachment` is now an explicit one-attachment-per-record atomic projection for retrieval and secure-storage indexing.
- Subject-scoped communication channel records now expose canonical `Communication.content-reference` values pointing to referenced business resources and atomized `DocumentReference/<id>` records.

## 1.3.11 - 2026-05-18

### Changed
- Updated dependency to `gdc-common-utils-ts@^1.4.20`.
- Refreshed generated OpenAPI profile artifacts after the canonical representative-role alignment release.

## 1.3.10 - 2026-05-18

### Changed
- Adopted `gdc-common-utils-ts@^1.4.18` shared role normalization for activation representative validation.
- Canonical legal-representative occupation format is now `credentialSubject.hasOccupation.identifier.value = "RESPRSN"` (legacy tokens still accepted by normalizer).

## 1.3.9 - 2026-05-18

### Changed
- Activation representative validation now consumes shared `gdc-common-utils-ts` policy helpers instead of local duplicated parsing logic.
- Core integration doc now states canonical member DID composition: owner DID prefix + `:member:<member-id>:<role>`.

## 1.3.8 - 2026-05-18

### Changed
- Enforced legal-representative VC security linkage in `_activate` trust validation:
  - `credentialSubject.memberOf.taxID` must match organization credential tax ID.
  - `credentialSubject.hasOccupation` must include `RESPRSN` (Responsible Party).
  - `credentialSubject.hasCredential.material` is now required.
- Core API examples are now VP-JSON-first for activation (`body.data[].vp`) to keep proofs readable/auditable; tests can derive `vp_token` JWT from that canonical VP object.

## 1.3.7 - 2026-05-06

### Changed
- Documented `_activate` trust validation contract aligned with ICA credentials:
  - representative VC must be trusted from ICA signature chain,
  - `org.schema.Person.memberOf.taxID` must match the organization tenant canonical identifier (`Organization.identifier.value`),
  - `org.schema.Person.hasCredential.material` is the source of representative signing-key binding for VP signature checks.
- Clarified authentication semantics for onboarding:
  - `vp_token` is a proof payload inside the activation message body,
  - HTTP `Authorization: Bearer` remains a transport/auth header concern and is not the VP itself.

## 1.3.6 - 2026-05-05

### Added
- Added strict license-gating mode for employee creation with `MANDATORY_LICENSE_CREATING_MEMBERS=true`.
- In strict mode, `Employee/_batch` now processes entries sequentially and returns per-entry `409 + OperationOutcome` when seats are exhausted, while keeping prior successful entries.

### Changed
- Kept backward compatibility when strict mode is disabled: legacy `Employee-license-offer-v1.0` behavior remains unchanged.
- Updated controller/practitioner step-by-step docs and endpoint/path clarifications for onboarding vs runtime identity/token flows.

### Tests
- Added unit coverage for partial batch behavior under mandatory license mode (success prefix, failure suffix).

## 1.3.5 - 2026-05-04

### Changed
- Activation trust now accepts organization credential resolved from `vp_token` (Verifiable Presentation) without requiring representative credential as mandatory input.
- Hosting activation parsing now resolves `OrganizationCredential` / `LegalOrganizationCredential` (and optional representative credential) from `vp_token.verifiableCredential[]`.
- Host onboarding/integration contract aligned to `/host/...` routes with `auth` security model for current gateway flows (OIDC pre-DCR and SMART post-DCR).
- Documentation alignment clarified for cross-service namespace consistency:
  - Gateway: `/host/...`
  - ICA: `/ica/...`
  - DataConv: `/publisher/...`

### Tests
- Added unit coverage for VP-based organization credential extraction in hosting activation flow.
- Updated activation trust adapter tests to validate activation without representative credential.

## 1.3.4 - 2026-04-30

### Changed

- Included sector/business routing consistency, docs updates, and alignment utilities/tests from upstream evolution scope.

### Fixed

- 2026-04-11 12:10: Fixed Stripe webhook endpoint mounting so the public route is `/webhooks/stripe` (previously double-prefixed as `/webhooks/webhooks/stripe`), and added integration coverage for route resolution.

## [1.3.0] - 2026-04-11

### Added

- 2026-04-11: Added PostgreSQL-backed vault repository support with schema bootstrap, runtime wiring for `DB_PROVIDER=postgres`, and integration coverage using `pg-mem` for secure indexed confidential storage queries.
- 2026-04-11: Added `.env.local.postgres` overrides and `npm run api:local-postgres` for running the API locally against PostgreSQL without duplicating the full local environment file.
- 2026-04-11: Added `docker-compose.postgres.yml` plus local helper scripts to start, stop, and inspect a dedicated PostgreSQL container for the new vault provider.
- 2026-04-11: Added `db:local-postgres:reset`; the PostgreSQL vault schema is auto-created by the API at startup, so no manual init SQL is required for this initial adapter rollout.

## [1.2.0] - 2026-03-14

### Added

- OneHealth sector model based on `MAINSECTOR` + `SUBSECTORSALLOWED`, with synthetic sectors for `animal-*` and `health-*`.
- OneHealth FHIR and research routing for care, index, tech, and digital twin ingestion use cases.
- Research digital twin ingestion endpoints for `Composition/_batch` in `digitaltwin/org.hl7.fhir.api` and `digitaltwin/org.hl7.fhir.r4`.
- Host onboarding contract for `Organization/_activate` and `_activate-response` in API docs, swagger, and service discovery.
- Error helpers to keep early 4xx/5xx responses compatible with DIDComm/FHIR clients.

### Changed

- Host and tenant service generation now derives capabilities from sector semantics instead of a fixed legacy FHIR sector list.
- OneHealth docs and examples now cover animal and human health channels, research ingestion, and the ICA-first activation target flow.
- OIDC/SMART discovery and legacy signing defaults remain aligned on ES384 / P-384 for compatibility with the current backend.

### Fixed

- FHIR ingestion and polling behavior for legacy raw FHIR mode now stays asynchronous while preserving raw FHIR poll responses.
- Request validation, swagger generation, and manager coverage were extended for the new OneHealth routes and sectors.

### Known limitations

- `Organization/_activate` is published as an exposed contract, but worker-side activation is still a placeholder and returns `NotSupported`.

### Added

- Secure Key Resolution for Standard Crypto Flow: When a protected request arrives without an embedded `jwk` in the JWE and JWS protected header, KmsService now follows a secure query pattern:

  It derives the tenant's vaultId from the issuer's (iss) DID (e.g., an employee or customer DID).
  
  It uses its internal HMAC capabilities to protect the query parameters (i.e., the key identifier `kid` as attribute name).
  
  It queries the VaultRepository using these protected parameters to find the corresponding encrypted document.
  
  It decrypts the employee/customer configuration document just-in-time to retrieve the public key required (jwk) to encrypt the future response.

-   **New Person Discovery Feature:** Implemented a new asynchronous `_discovery` action to find a Person's `did:web` using private identifiers.
    -   The new endpoint is `POST /{tenantId}/cds-{jurisdiction}/v1/{sector}/test-network/org.schema/Person/_discovery`.
    -   The backend handles URN construction, hashing, and dynamic routing to the appropriate blockchain channel (`<sector>-eu` or `<sector>-global`) and smart contract (`discovery-person`) based on "convention over configuration".
    -   Introduced `NetworkActionsController` and a dedicated `networkRouter` to manage this new API section.
    -   Added new utility modules to support the discovery logic: `identifier-parser.ts`, `jurisdiction.ts`, and identifier-channel helpers.
-   **Contextualized Claims Normalization:** Added claim normalization + deterministic ordering for contextualized schema.org claims (see `src/utils/claims.ts`) to support future canonical hashing.
-   **Family Onboarding (Offer/Order):** Added `FamilyManager` and data fixtures to support family (household) registration with the same Offer/Order pattern used for tenant onboarding.
-   **Sandbox-Safe Integration Test Harness:** Added `invokeExpress` helper to run integration tests without binding a TCP port (required in sandboxed environments).
-   **SMART Token Issuance (Async):** Added `POST /{tenantId}/cds-{jurisdiction}/v1/{sector}/identity/openid/smart/token` job flow with polling via `.../identity/openid/smart/_batch-response`, including consent-rule matching by actor (jurisdiction URN / did:web / email), role, purpose, and requested LOINC sections.
-   **Consent Rule Fixtures:** Added `src/__tests__/data/consent-rules.data.ts` and unit/integration coverage for consent-based SMART token gating.

### Changed

-   **Refactored `CustomerManager`:** The manager now handles the new `_discovery` action alongside the existing `_batch` action.
    -   The discovery logic is optimized to group multiple identifier hashes (e.g., from `NNES` and alternate identifiers for the same person) and query the blockchain in a single, efficient batch call per channel target.
    -   The smart contract is expected to implement a "first match wins" optimization for these batch queries.
-   **Updated `IBlockchainAdapter`:** The interface was changed from `discoverDidByHash` to the batch-aware `discoverDidsByHashes` to support the performance optimization.
-   **Updated Service Definitions (`services.ts`):**
-   **DID Service ID Convention (SDK parity):** DID Document service IDs now follow `#<section>:<format>:<resourceType>:<action>` via `generateServiceId()` (and request validation supports both config selectors and DID fragments).
-   **Backend Crypto Adapter (Node):** `CryptographyService` is now instantiated with a Node `ICryptoHelper` adapter (random UUIDs/bytes + SHA/SHA3 digests) to match the SDK’s platform-adapter approach.
-   **Customer → Individual:** Renamed the worker registry key from `customerManager` to `individualManager` and renamed the unit test file to `IndividualManager.test.ts`.
-   **Secure API Routing:** Path params are now authoritative when building the async `jobRequest` (prevents decoded payload fields from overriding `tenantId/sector/section/resourceType`).
-   **OIDC Service Definitions:** Split OIDC service templates so `Device/_dcr` and `smart/token` don’t cross-combine (no accidental `Smart/_dcr` or `Device/token` in DID service multiplexing).
-   **Test Environment Isolation:** `src/server.ts` no longer loads `.env.local` (or initializes Firebase) under Jest, and Jest now sets safe default host env vars for `startServer()`-based integration tests.

### Fixed

-   **Architectural Flaw in Asynchronous Job Processing:** Corrected a major flaw in how the system handles plaintext (`application/json`) asynchronous requests. The new, secure flow is as follows:
    -   **Problem:** Plaintext requests were generating plaintext responses, which were stored directly in the response store, breaking the polling handler which expects all artifacts to be encrypted JWEs.
    -   **Solution:** All job results are now **always** stored as encrypted JWEs. For plaintext requests where the client does not provide a public key, the system uses an **"encrypt-to-self"** pattern: the `Worker` encrypts the response using the public key of the tenant processing the job (or for the new tenant in the case of onboarding).
    -   The `pollingHandler` is now responsible for inspecting the original request's `Content-Type`. If it was a JSON-based type, the handler **decrypts** the stored JWE just-in-time before sending the final plaintext JSON payload back to the client. This ensures clients that send JSON receive JSON, abstracting the internal security measures.

-   **Corrected Onboarding Tests:** Fixed all failing unit tests for `CustomerManager` by aligning the test data's job action with the manager's expectation.
-   **Resolved `tsc` Compilation Errors**
-   **BYOK End-to-End Flow:** Fixed `byok-dcr` integration test by making the flow complete Offer→Order and making polling robust.
-   **CORS + In-Memory Express Invocation:** Fixed crashes in integration tests caused by `cors/vary` expecting Node `ServerResponse` header APIs.
-   **Hosting Offer/Order:** Fixed Offer identifier handling, ensured tenant config retains required claims, and persisted an indexable admin employee record so secure key resolution can find `kid/skid`.
-   **KMS Key Metadata:** Ensured managed JWKs are marked with `use: 'sig'|'enc'` so downstream key selection works reliably.
-   **DCR Example Data:** Updated test fixtures so the DCR `code` is a valid UUID, aligning with `DeviceRegistrationManager` activation-code validation.

### Internal

-   **Unit Tests:** Added a comprehensive suite of unit tests for the new batch discovery logic in `CustomerManager.test.ts`.
-   **End-to-End Test:** Added a new test case (`Part 8`) to the main integration test suite (`end-to-end-flow.test.ts`). This test verifies the full, asynchronous submit-and-poll flow for the `_discovery` endpoint using a real, encrypted JWE payload.
-   **Documentation:** Created a new, detailed architecture document for the discovery feature at `docs/03-IDENTITY-AND-TRUST/03.E-PERSON-DISCOVERY-ACTION-ARCHITECTURE.md`, which includes a Mermaid sequence diagram illustrating the entire flow, and ``.
-   **Code Cleanup:** Removed the obsolete `CustomerDiscoveryManager` and its test file, as its logic was consolidated into `CustomerManager`. Disabled verbose cryptographic logs to improve test readability.
-   **Integration Suite Hardening:** Updated Jest config and integration tests to avoid sandbox-incompatible e2e/firestore runs and to use in-memory Express invocation.
-   **Docs:** Updated `docs/API_INTEGRATORS_GUIDE.md` with contextualized claims normalization rules and license gating notes.

## [Unreleased]

### Added
- Integration coverage for `Bundle/_search` DocumentReference retrieval by canonical hash claim:
  - `DocumentReference?subject=<did>&contenthash=<cid>`
  - response contract validated via `DocumentReference-search-response-v1.0`.

### Changed
- Communication attachment projection now separates:
  - `DocumentReference.identifier` as logical UUID/URN identifier,
  - `DocumentReference.contenthash` as content hash/CID for retrieval/integrity.
- Bundle search parser now prioritizes `contenthash` query/filter names and keeps legacy hash aliases for temporary compatibility.
- API integrator guide updated with canonical `DocumentReference.contenthash` field contract.

### Added
- **End-to-End Test for Person Onboarding**: A comprehensive E2E test (`Part 3`) now verifies the entire asynchronous flow for creating a `Person` resource, including job submission (`202 Accepted`), secure polling with `POST` (`200 OK`), and final response validation (`201 Created`).
- **TDD Roadmap for Future Features**: Added tests (`Part 4` for `Composition` and `Part 5` for `Communication`) in the E2E flow. These tests act as an executable specification and clear roadmap for the next development steps.
- **`CustomerManager` Integration**: Fully integrated the `CustomerManager` into the server initialization, connecting it to the `Worker` via the `ManagerRegistry`.

### Changed
- **Corrected Tenant Service Configuration**: Updated `utils/services.ts` to correctly define the service endpoint for the `individual` section (previously `index`), enabling the `Person`, `Composition`, `Communication`, and `Subscription` resource types.
- **Refactored `CredentialManager` Dependencies**: The `CredentialManager` constructor now correctly receives only the `hostExternalDomain` string instead of the entire `IServerConfig` object, adhering to dependency injection best practices.
- **Standardized Manager Logic**: Refactored `CustomerManager` to correctly derive the `vaultId` from the `job.sector` and `job.tenantId` properties, following the established architectural pattern where managers (not the router) are responsible for this logic.

### Fixed
- **Critical Bug in Job Context**: Fixed a critical bug where `CustomerManager` was incorrectly interpreting `job.tenantId` as the `vaultId`, leading to "Tenant not found" errors. The manager now correctly reconstructs the `vaultId`..
- **Module Interoperability Issues**: Standardized the import and usage of CommonJS modules like `express` across the application (`server.ts`, `discovery.ts`) to use the `import * as name` and `name.default()` pattern, resolving persistent compilation and runtime errors.
- **E2E Test Polling Logic**: Corrected the E2E test to use the secure `POST` method with the `thid` in the `body` for polling, aligning with the server's implementation.

## [Unreleased]

### Added
- Added `npm run pki:bundle` plus `scripts/generate-trust-bundle.ts` and
  `scripts/examples/trust-bundle.local.example.json` to orchestrate
  reproducible Root CA -> ICA -> host -> member trust material generation from
  one config file.
- Added SHA-256 `manifest.json` publication for generated PKI artifact
  directories so local trust bundles can be inspected and audited offline.
- Added `docs-v2/25-trust-bundle-and-local-network-runbook.md` and
  `docs-internal/04-trust-bundle-operator-roles.md` to document the
  reproducible trust bundle, operator roles, and the ownership split between
  `gwtemplate-node-ts`, `dataspace-ica-ts`, and `gdc-sdk-node-ts`.

## Unreleased

- Document the neutral BFF mapping for subject-card directories and the sole
  species-bound VetChain DID resolver. Controller portals expose no subject or
  scheduling routes, and the removed split animal-card path has no alias.

- Resolve signed host-registry tenant lifecycle requests against the exact tenant DCR vault encoded by the controller DID, while preserving host-scoped job routing and fail-closed fallback.

- Reuse the DCR-protected verified email and telephone bindings when an individual controller requests SMART access to a second licensed animal, so portal and telephone device sessions authorize the same stable actor even when a freshly minted identity token omits contact arrays.

- Preserve the complete route jurisdiction as the Organization address region
  during single-tenant bootstrap, so regional routes such as `CA-BC` resolve
  the same tenant jurisdiction in scheduling and other guarded managers.
- Bind an accepted individual-member seat to the stable verified actor so the
  same personal DCR profile can authorize each separately owned animal.
- Backfill that stable actor binding on the controller seat during initial DCR
  when an older Order-issued seat does not yet contain it.
- Read already-materialized controller seats and subject alias records directly
  during SMART authorization, while retaining decryption for protected results.
- Persist each governed public Card alias on its controller seat so multi-animal
  SMART authorization does not depend on a second subject-record lookup.
- Resolve exported `sos-data-utils-ts` subpaths explicitly in Jest so the
  scheduling integration contract compiles under the repository test config.

- Remove `HOST_REGISTRY_SECTOR`, `HOST_NETWORK`, and `hostRegistrySector`
  compatibility inputs from the supported bootstrap and portal-check scripts.
  They now consume only the canonical `HOST_REGISTRY_NETWORK` or
  `hostRegistryNetwork` name.
- Remove the `entry.meta.claims` migration path. Worker ingress and managers
  now accept business claims only from `entry.resource.meta.claims`; obsolete
  envelope-level claims fail closed instead of being copied or merged.

- Preserve the animal `ONESELF` subject and its human `RESPRSN` controller as
  distinct identities during individual-controller DCR. The activated licence
  binds their relationship; GW no longer requires the controller DID to equal
  the animal DID.
- Allow one DCR-bound personal controller device to select another exact animal
  only when that animal has its own active RESPRSN seat bound to an email or
  telephone alias verified by the same current account token.

- Repair an authenticated active Individual Organization Order that predates
  its `RESPRSN` controller seat by reusing the normal individual-license and
  RelatedPerson materialization path. Existing seats with a different contact
  still fail closed instead of being replaced.
- Make deployed persistence an inviolable release gate: staging/production is
  detected from `NODE_ENV` or `DEPLOYMENT_ENV`, memory providers fail closed,
  and the release skill requires real GCS roundtrips before and after pod
  replacement instead of accepting configuration or health checks as proof.

- Make the claims-first persistence gate invoke the shared canonical FHIR API
  claim-key validator explicitly before resource allowlist, HMAC index and
  encrypted-content processing; malformed claim syntax now fails closed even
  if a manager accidentally adds it to its local allowlist.
- Consume `gdc-common-utils-ts@2.9.4`, `vet-data-utils-ts@0.5.3` and the
  test-only `vet-sdk-core-ts@0.4.17` from their verified npm releases.
- Trust the exact SOSChain Personal staging Firebase issuer and audience for
  verified-contact animal-card discovery without granting relationship,
  Consent, professional role or SMART authority.

- Added synchronized VetChain deployment overlays: staging and production now
  adapt one shared Canadian host contract instead of copying UNID profiles.
  The runtime binds human controllers to `identity-global`, regional
  professional identity to `identity-na`, and ordinary animal writes to
  `animal-pet-na` under `CONNECTHEALTHMSP`.

- Make clean GW VET container builds reproducible by copying immutable
  vendored packages before `npm ci` in both builder and production stages.
- Separate the staging host identity from the GW VET software profile and from
  future production: `beta-gw.vetchain.app`, the Canadian staging namespace
  and `connecthealth-vet-host-staging` are explicitly non-production resources.
- Record ConnectHealth operator DNS boundaries: `host-vet[-st]` for veterinary
  production/staging and `host-uhc[-st]` for the separate human-health hosts;
  product domains remain aliases/frontends and FUNDACION UNID EMEA is distinct.

- Reindex every signing and encryption key added to a licensed controller DID
  during DCR, so protected resource routes can resolve and verify the new
  device immediately by its HMAC-protected `kid`.
- Verify non-employee individual controllers through their active DCR device
  profile when the signed `client_id` and encrypted-message `iss` match the
  already-verified SMART bearer subject; employee DID lookup remains unchanged.

- Publish the organization-controller `License/_search` capability for new
  tenants and retain that exact read-only inventory operation for historical
  tenants that already exposed `Employee/_search`. This prevents failed seat
  discovery from being presented as an authoritative zero without widening
  licence mutations.
- In compatibility/demo deployments, delegate standards-based compact JWE
  requests and responses to the real KMS implementation. The simulated
  ciphertext-as-JSON path now applies only to explicit
  `alg=none`/`enc=none` envelopes, preventing real encrypted controller
  operations from failing with UTF-8 decoding errors.

  route/runtime, verify its active human signer through DID governance or the
  revocable MVP signer registry, and carry the protected postal-code binding
  into Order so the exact delivered code becomes the exchange/DCR licence.

- Accept UNID organization-registration authorization credentials only on the
  authoritative Test Network route and runtime, verify their detached PQC
  proof, and keep `verification.resourceType` as `contract`.

- Existing-tenant `Organization/_issue` now promotes an ICA-approved stable
  controller `did:web` and its complete public JWKS into the tenant registry,
  provided the verified request signer belongs to that submitted keyring. In
  Fabric-backed modes it also records each public key and its active
  `legal-organization-controller-signing` binding; external key use remains
  separate.

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2025-10-15-0126]

### SECURITY

-   **Formalized the Inbound Request Security Model:** A clear, two-phase security model has been implemented and documented, strictly separating **Authentication** from **Authorization**.
    -   **Phase 1 (Authentication):** The API Controller (`api.ts`) is now solely responsible for authenticating requests. It uses a `try...catch` block to call the `KmsService`. If signature verification fails, the KMS throws an error, and the API immediately returns a **`401 Unauthorized`**.
    -   **Phase 2 (Authorization):** Business-level authorization (e.g., checking if a signer is a permitted "controller" via `assertionMethod` for a specific action like Fabric onboarding) is now the responsibility of the asynchronous **Worker** and its respective **Manager**. The API controller no longer handles this logic.
-   Added a critical security integration test (`should return 401 Unauthorized...`) to ensure the API correctly handles cryptographic signature failures from the KMS.

### CHANGED

-   **Improved Job Name Uniqueness:** The `createJobName` function now uses the unique `vaultId` (e.g., "health-care_acme") to generate the job name, preventing potential collisions between tenants with the same `alternateName` in different sectors.
-   **Clarified Naming Convention:** Refactored `createJobName` and `parseJobName` in `src/utils/naming.ts` to use the parameter `jobContextId` instead of the ambiguous `tenantId`, and updated documentation to clarify that this ID must be the `vaultId`.
-   **Refined Test Suite Logic:** Integration tests for API endpoints (`employeeApi.test.ts`, `networkEnrollmentApi.test.ts`) have been simplified to follow the DRY principle. They now focus on verifying their specific endpoint integration, while the detailed mechanics of job creation are exhaustively tested in `pingApi.test.ts`.

### FIXED

-   **Fixed the `tenantId` in the `JobRequest` to preserve the original path parameter:** A critical bug was fixed in the API controller where the `jobRequest.tenantId` (which should be the tenant's `alternateName` from the URL) was being incorrectly overwritten with the internal `vaultId`. The `JobRequest` now correctly preserves the raw path parameters for the worker to process.
-   **Corrected Job Name Creation:** Fixed a bug in `createJobName` that was incorrectly stripping the leading underscore from actions (e.g., `_batch` became `batch`).
-   **Repaired All Integration Tests:** Aligned `pingApi.test.ts`, `employeeApi.test.ts`, and the original `networkEnrollmentApi.test.ts` with the corrected architecture, ensuring the entire test suite passes.

### Added

-   **Enhanced Architectural Documentation:** Updated `ARCHITECTURE-OVERVIEW.md` and `DEVELOPER_GUIDE.md` to reflect the new security model, the separation of AuthN/AuthZ, and the correct data flow from the API controller to the worker.

## [20251014-1710]

### Added
- **TDD-Driven URL Utilities**:
  - Created a new unit-tested `getBaseUrlFromDidWeb` utility in `did.ts` to correctly parse `did:web` identifiers, including those with percent-encoded ports (e.g., `localhost%3A3000`).
  - Implemented a new, fully unit-tested `getTenantDomainUrl` method in `TenantsCacheManager` using a TDD approach. This method provides the canonical service URL for a tenant, prioritizing their external domain and falling back to the gateway's hosted URL.

### Changed
- **Major Architectural Refactoring of Discovery Service**:
  - The system now correctly derives a tenant's hosted URL from the host's own `did:web` identifier, making the `TenantsCacheManager` self-reliant and architecturally sound.
  - The `discovery.ts` router and its `resolveTenant` middleware were completely refactored to remove dependencies on internal configuration objects, improving encapsulation and security. The router now correctly handles the `/:tenantId/cds.../.well-known/did.json` path.
- **`TenantsCacheManager` Naming**: Renamed `getTenantUrn` to the more descriptive `getTenantIdentifierUrn` across the entire codebase for clarity.

### Fixed
- **Critical Security Fix in Ping Handler**:
  - Refactored the `ping.handler.ts` to derive the JWT `iss` (issuer) claim from the request's `Host` header.
  - This corrects a major architectural flaw and ensures that the identity in a discovery response matches the domain the client is interacting with, adhering to `did:web` security principles.
- **Test Suite Failures**:
  - Correctly implemented the updated `IKmsService` interface in `DemoKmsService`, `KmsService`, and `kms.mock.ts`.
  - Added the `type` property to the `IndexedAttribute` model to preserve data semantics during HMAC protection.
  - Fixed dependency injection in `PingManager.test.ts`.
  - Replaced the obsolete `DidDocumentBuilder.test.ts` with `did-document.test.ts` and created a new, correct integration test for the Well-Known API endpoint (`wellKnownApi.test.ts`).



### Added
- **Batch Processing & Identifier Generation in `CustomerManager`**:
  - Re-architected `CustomerManager` to correctly process `_batch` requests by handling each entry as a discrete customer creation.
  - Implemented logic to automatically generate a new `urn:uuid:...` identifier if an entry is submitted without one (User Story 1: Self-Onboarding).
  - Implemented logic to aggregate claims from multiple batch entries that share the same anchor `identifier` into a single, unified customer record (User Story 2: Professional Onboarding).
- **Canonical Customer Public ID**:
  - `CustomerManager` now enforces the creation of a canonical public identifier for customers based on the pattern: `urn:...:individual:multibase:z<base58btc(uuid)>`.
  - Added a new `uuidToBytes` utility to correctly convert UUID strings into 16-byte arrays for encoding.

### Fixed
- **`uuid` Library Mocking**: Corrected the Jest mock for the `uuid` library in `CustomerManager.test.ts` to include the `validate` function.
- **Corrected `vc.id` Generation**:
  - Refactored the `vc-id` utility to correctly implement the "Versioned Credential ID" pattern: `z(multibase(multihash(SHA3-256(<URN>:timestamp:epoch:<value>))))`.
  - Removed all problematic `multiformats` dependencies and replaced them with a self-contained `base-x` implementation to resolve persistent module resolution failures.
- **Enforced `credentialSubject.identifier` Usage**:
  - Updated `CredentialManager` to use `credentialSubject.identifier` for the subject's stable URN, adhering to the documented "Golden Rule" and W3C best practices.
  - Corrected the `CredentialManager.test.ts` suite to validate the `identifier` field, not the `id` field, in the `credentialSubject`.

### Added
- **Created Structured Documentation Hub**:
  - Consolidated all architectural and guide markdown files into a new, organized `/docs` directory with a numbered, thematic structure.
  - Created a new `docs/01-OVERVIEW-AND-GUIDES/01.B-CREDENTIAL-ARCHITECTURE.md` to formally document the mandatory patterns for VC ID generation, subject identification, and issuance formats.


### Changed
- **Re-architected `CredentialManager`:**
  - Refactored `CredentialManager` to be a generic, low-level credential issuance engine with a core `createAndSignVc` private method. It is no longer a public-facing manager that handles jobs directly, but an internal service invoked by other managers.
  - Aligned the manager's architecture with modern project patterns, ensuring it throws `ManagerError` on failure, to be caught by the calling business-logic manager.
- **Unified Indexed Attribute Types:**
  - Corrected the type signature for `IKmsService.protectAttributesNameAndValue` to return `Promise<IndexedAttribute[]>` instead of `ParamAttribute[]`, reflecting the transformation that occurs.
  - Refactored `CustomerManager` and `CredentialManager` to use the correct `ParameterData` type when preparing indexed attributes, eliminating type mismatches and manual mapping.

### Fixed
- **Fixed Critical Security Vulnerability:** Removed logic in `CredentialManager` that incorrectly decrypted a tenant's entire sensitive `EntityConfig`, preventing a major data exposure vulnerability. The manager now only works with pre-validated public claims.
- **Fixed `CredentialManager.test.ts`:**
  - Completely rewrote the test suite to align with the new, secure architecture.
  - Added test cases for `issueOrganizationSelfDescription` (signed by host) and `issueEmployeeCredential` (signed by tenant).
  - Added tests for secure storage (`storeCredential`) and retrieval (`searchCredential`), including mocking the repository's `query` method.
  - Corrected all `tsc` and `jest` errors.

### Added
- **Added `parseValidityPeriod` Utility:** Created and tested a new time utility at `src/utils/time.ts` to parse human-readable period strings (e.g., "1y", "5m") into `Date` objects, ensuring all operations are UTC-safe.


### Added

-   **Sovereign Identity Architecture:** Introduced a new identity model based on semantic URNs and Verifiable Credentials (VCs) to align with SSI, Gaia-X, and IDS principles.
-   **`ARCHITECTURE_PATTERNS.md`:** Created a canonical document for architectural patterns, including a detailed section on the new Sovereign Identity model.
-   **`TenantsCacheManager.getTenantUrn()`:** Added a new, efficient method to resolve a tenant's internal ID to their sovereign URN.
-   **`TenantsCacheManager.getDidServiceConfig()`:** Added a new, efficient method to retrieve only the DID service configuration for a tenant.

### Changed

-   **`EmployeeManager`:** Refactored to use the new URN-based identity model. It now constructs hierarchical URNs for employees based on the parent organization's URN.
-   **`EmployeeManager`:** Now retrieves the tenant's URN via `TenantsCacheManager` instead of requiring access to the full tenant configuration.
-   The issuer (`iss`) in API responses generated by `EmployeeManager` is now the tenant's sovereign URN.

### Deprecated

-   **`TenantsCacheManager.getConfig()`:** This method has been deprecated and will be removed. It exposed the entire `TenantConfig` object, violating the principle of least privilege. Use `getTenantUrn()` or `getDidServiceConfig()` instead.

### Removed

-   Removed direct dependency on `IServerConfig` from `EmployeeManager`. The required data is now provided by `TenantsCacheManager`.
