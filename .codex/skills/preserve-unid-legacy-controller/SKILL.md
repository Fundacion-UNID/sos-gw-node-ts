---
name: preserve-unid-legacy-controller
description: Preserve or audit the UNID historical legal-representative first controller during legacy tenant creation, while keeping later ServiceControllerCredential onboarding independent. Use for legacy _activate, _transaction plus Order, tenant DID controller arrays, activation-code or DCR failures, or GlobalDataCare and UNID portal channel separation where personal data must not enter technical artifacts.
---

# Preserve UNID legacy controller

## Mandatory TDD

Use red-green-refactor TDD for every behavior or flow change. Write and run the smallest executable contract test first; it must fail for the intended reason before implementation begins. Then implement the minimum change and make focused, integration and affected end-to-end tests green. Begin every new or modified test suite with a flow-contract comment. Begin every Playwright or other E2E file with the complete numbered journey and its authorization and persistence invariants. Mocks may isolate units but never replace real boundary proof. Never make a test green by accepting an error, placeholder, pending setup or other incomplete terminal state.

## Read first

Read repository `AGENTS.md` and
`docs/03-IDENTITY-AND-TRUST/03.K-UNID-LEGACY-CONTROLLER-COMPATIBILITY.md`.
Inspect the live tenant DID and controller DID endpoints before changing code or
claiming that a binding exists.

## Keep the identity boundaries explicit

- Keep transport roles separate: DIDComm `from` is the sender DID, JWT `iss`
  is the signer, `kid` is the concrete signing-key DID URL and SMART `sub` is
  the authorized individual controller or professional. One actor may fill
  several roles, but the roles never collapse.
- Native FHIR adapters receive Communication or Bundle, never DIDComm identity
  fields. HTTP Authorization proves the caller while `Communication.sender`
  remains the FHIR business participant.
- Legal organizations enter through `Organization/_transaction`, never
  `Organization/_batch`. Local bootstrap consumes the verified transaction
  produced by the portal/test delivery adapter and never fabricates a
  controller, DID document or ICA preauthorization. Continue with
  `Order/_batch` only when a new-host Offer is actually returned; no Offer is
  the valid existing-tenant/controller-binding branch.
- Treat the historical `LegalRepresentativeCredential` as legal evidence, not
  global `RESPRSN` authority.
- In legacy portal registration, bind the submitted JWK only to the legal
  representative who performs that registration. A different controller named
  by signed evidence is a pending designation, not the owner of that JWK.
- Do not require or synthesize a technical-controller JWK during legacy tenant
  creation. That actor later supplies its own key through sector `_issue`,
  activation, token exchange and DCR.
- For historical `_activate` credentials without `RESPRSN` or embedded key
  material, require deployment-wide
  `HOST_LEGACY_REPRESENTATIVE_CONTROLLER=true` compatibility.
- Use this switch only for a deployment whose legacy portal registers every
  organization through its legal representative. The deployment wrapper must
  propagate it to the runtime Deployment after applying shared manifests.
- Never pin a credential id, issuer or `kid` in this compatibility switch. The
  normal VP, credential and trust-registry checks authenticate the submission;
  this permits credential renewal and controller-key rotation.
- Preserve modern `ServiceControllerCredential` validation unchanged.
- Append controller DIDs; never replace another active controller implicitly.
- Build the bootstrap controller before tenant finalization and put its DID in
  the organization DID from the first active version.
- Treat the same exact `_activate` or `_transaction` submission for an existing
  tenant as an idempotent re-registration: upsert the controller, append its DID
  and recreate a missing tenant collection without creating another Offer.
- Keep later service-controller `_issue`, activation code, `Token/_exchange`
  and `Device/_dcr` as distinct steps.
- Treat the historical representative JWK submitted in legacy `_activate` as
  the completed bootstrap binding. Do not require that same representative to
  run `Token/_exchange` or `Device/_dcr` afterwards. Those steps belong to a
  separately designated service controller, an employee device, or an explicit
  later device replacement/recovery.
- Do not interpret the legacy DCR exception as “no communication wallet”.
  Keep the professional-role signing JWK in `controller.publicKeyJwk` and the
  runtime wallet's separate DIDComm signing/encryption public keys in
  `controller.jwks`. Only that public JWKS reaches ICA/GW; the portal retains
  the matching private keys and protected wallet seed.
- Node/BFF 101 integrations use
  `NodeManagedWallet.initializeCommunicationJsonWebKeySet(...)` (or
  `getCommunicationJsonWebKeySet(...)` for an initialized wallet) and pass the
  result through `buildControllerBindingInput({ publicKeys })`. PIN, seed,
  private JWKs and manual JOSE/DCR payload construction stay outside the
  activation request.
- Keep device-exchange proofs distinct: the OIDC `id_token` proves the trusted
  account/email binding and the controller `vp_token` proves role authority.
  A VP never substitutes for the email proof at `Token/_exchange`.
- DCR must rebuild the protected employee `kid` indexes from every active DID
  verification method. Historical stale-index fallback may inspect only
  resolved tenant scopes and must match stored controller DID, signing `kid`
  and encryption `skid`; caller-supplied JWK material grants no authority.
- Canonical `Token/_exchange` uses the validated request-route tenant.
  Firebase proves actor/contact identity and does not need a custom tenant
  claim; if present, that claim must match and can never reroute the exchange.
  Preserve a failed submit or poll `OperationOutcome` instead of replacing it
  with a later secondary error.
- Use `/.well-known/tenant-status.json` as the operational readback. Do not
  infer DCR completion from the organization DID alone: `credential_issued`
  still requires exchange/DCR and only `dcr_active` unlocks controller work.
- Keep status output public-safe: controller DIDs plus public `kid`, algorithm,
  use and purpose are allowed; names, emails, activation codes, tokens, wallet
  seeds and private JWK members are forbidden.

## Preserve employee-seat and device boundaries

- New professional organizations start with at least two non-free assignments:
  the verified representative seat and a contact-free technical-controller
  reservation. Bind the latter only when that controller proves its own
  identity/key at `_issue`; promotional seats above two remain available.
- Never apply that second-seat reservation retroactively. If an old inventory
  already contains the representative plus a professional, preserve both,
  create no implicit third seat and require a newly added or purchased licence
  before the technical controller can bind.
- Existing-tenant legacy re-registration issues or reuses the verified
  representative seat without replacing any technical controller or member.
  A startup repair may add only a missing mandatory representative seat from
  protected verified claims; it never derives a person from portal state.
- `License/_add` does not exist in any network mode. Create professional and
  individual inventory through organization onboarding or the governed
  Offer -> Order lifecycle; a zero price never creates a direct mutation
  shortcut.
- Employee creation persists the employee only. The following explicit
  licence-issue operation reserves the seat and returns the activation
  credential; never consume the same seat in both operations.
- Employee records use the resolved physical tenant collection while
  device-licence records remain in the logical tenant vault.
- One actor seat supports five active channel/device bindings by default.
  Revoking one binding requires explicit portal confirmation and never releases
  the employee seat; only purging an already suspended employee releases it.

## Protect personal data

Never add a clear email, portal username, full name or contact-derived hash to
source, tests, documentation, comments, logs, skill files or checked-in
deployment configuration. Use neutral actor labels such as
`historical representative` in technical artifacts.

Runtime contact claims remain confidential tenant data and must not be
projected into public policy.

## Implementation workflow

1. Add the failing activation and Order finalization tests first.
2. Ensure `process-organization-activation.ts` passes the generated controller
   DID into tenant finalization.
3. Ensure `process-order-entry.ts` builds the pending representative controller
   before finalizing the tenant and passes its DID into tenant finalization.
4. Keep the historical activation exception fail-closed when the deployment
   compatibility switch is absent, false or malformed.
5. Do not add legacy representative handling to existing-tenant `_issue`.
6. Update route JSDoc, generated OpenAPI, identity/trust docs and changelog.
7. Run targeted unit and integration tests, typecheck, skill validation and a
   changed-file scan for personal data.
8. Verify the live pod environment contains the compatibility switch after rollout;
   documentation or a local `.env` file alone does not activate it.
9. After the GW UNID change is merged to `main`, compare GW UNID and GW Core in
   both directions. Port generic controller lifecycle fixes separately from
   product-specific configuration. Validate the later GW VetChain derivative from GW UNID
   before copying proven generic behavior to other gateway products.

## Required verification

- Deployment-authorized legacy activation succeeds and creates the first controller reference
  even when the historical credential lacks `RESPRSN`.
- `_transaction` plus Order finalization creates the same reference.
- Existing-tenant `_activate` and `_transaction` re-registration return success
  with one unchanged controller reference and no new Offer.
- Re-verification that omits a previously signed technical-controller field
  preserves its hashed pending designation and never copies the representative
  JWK to that actor.
- With compatibility disabled, the legacy shape fails before activation;
  credential and signer failures remain governed by normal trust validation.
- Canonical service-controller tests remain green.
- Generated OpenAPI keeps legacy creation separate from service-controller
  `_issue`.
- No final report claims employee lifecycle is ready until the tenant route,
  organization controller reference and controller public key all resolve and
  tenant status reports that exact controller as `dcr_active`.

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
