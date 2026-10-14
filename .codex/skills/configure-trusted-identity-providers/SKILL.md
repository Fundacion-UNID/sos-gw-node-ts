---
name: configure-trusted-identity-providers
description: Configure or audit several trusted OIDC id_token providers inside one deployed GW network. Use for AUTH_TOKEN_VERIFIER, OIDC_TRUSTED_PROVIDERS_JSON, exact iss and aud validation, OpenID discovery, Firebase portal trust, or identity-provider rollout tests.
---

# Configure trusted identity providers

## Contract

- Treat one deployed GW as belonging to one network; configure only providers
  intentionally accepted by that workload.
- Set `AUTH_TOKEN_VERIFIER=trusted-oidc` and use exact `iss` and `aud`
  entries in `OIDC_TRUSTED_PROVIDERS_JSON`.
- Accept `issuer` and `audience` only as compatibility aliases. Fail startup
  if canonical and alias values conflict.
- Discover `jwks_uri` from
  `issuer/.well-known/openid-configuration`; use `jwksUri` only as an
  explicit compatibility override.
- Use decoded `iss` only to select an allowlisted verifier. Then validate
  signature, exact issuer, exact audience and temporal claims.
- Keep Firebase data-project configuration separate from token trust.
- Never infer employee, tenant or clinical authorization from a valid token.
- Normalize top-level verified contacts and provider-linked Firebase identities
  only after cryptographic token verification. Different token JSON shapes do
  not create different users or authorization paths.
- Preserve identity separation: OIDC/SMART `sub` is the requester, DCR
  `client_id` is the registered device/BFF wallet, and the selected human or
  animal remains the distinct subject named by SMART scope and clinical data.

## Federated EHR sessions

Read
[`docs/04-DEEP-DIVES/04.L-FEDERATED-EHR-CONTINUITY-STORAGE.md`](../../../docs/04-DEEP-DIVES/04.L-FEDERATED-EHR-CONTINUITY-STORAGE.md)
before adding Oracle Health, Epic or another EHR issuer or storage adapter.

- Bind durable professional identity to exact `(iss, sub)` plus verified
  `fhirUser`. Accept PractitionerRole directly, or resolve Practitioner through
  `PractitionerRole?practitioner=` and retain only current active roles with a
  resolvable Organization. Email and a browser-selected organization are never
  authority.
- Treat the resolved organization as an EHR-attested SOSChain participant, not
  a hosted tenant. Federated login creates no UHC, VetChain or SOS GW tenant,
  controller, licence or DCR; hosted organization creation remains independent
  ICA-governed tenant admission.
- Keep the source EHR SMART token, SOSChain subject-scoped SMART grant and
  break-glass decision independent. SMART launch context is not SOSChain
  authorization, and no one token is valid for all three decisions.
- Preserve source author and attester provenance through an authorized
  projection, Communication or write-back.
- Treat cloud CMEK as infrastructure-at-rest protection, not the SOSChain
  member/device application envelope. Human continuity uses AES-256-GCM
  content encryption and governed ML-KEM recipient envelopes.
- Keep metadata, encrypted objects and imaging behind replaceable adapters.
  Multi-recipient backup, DICOM restore and offline continuity remain target
  behavior until real local and environment E2E is green.
- Keep Demo fixture-only. EHR Sandbox access is a distinct
  `local-network`/Test Network journey; production requires new client
  registration and customer-tenant approval. Never promote sandbox secrets.

## TDD workflow

1. Start with the registry contract test and make canonical `iss`/`aud`
   fail for the intended reason.
2. Test issuer routing and OpenID discovery.
3. Add each target's exact list to its deployment profile and assert the
   rendered runtime receives the JSON unchanged.
4. Run focused auth/config tests, typecheck and deployment dry-run.
5. Synchronize examples, JSDoc, changelog and this skill.

## Example

```dotenv
AUTH_TOKEN_VERIFIER=trusted-oidc
OIDC_TRUSTED_PROVIDERS_JSON=[{"iss":"https://idp.example","aud":"gateway-example"},{"iss":"https://securetoken.google.com/portal-example","aud":"portal-example"}]
```

A decode-only development GW stays explicitly on
`AUTH_TOKEN_VERIFIER=demo`; do not add a trusted-provider list that it ignores.

## Staging workload matrix

- Keep demo-only development explicitly on `demo`; it intentionally does not
  provide staging identity assurance.
- Configure each product staging gateway from its product-owned environment,
  including its own Personal and Professional Firebase projects.
- Add SOSChain Personal/Professional only when those channels are explicitly
  supported by that product gateway.
- Never copy UHC portal projects into VET or VET portal projects into UHC.
- Keep exact operational IDs and domains in deployment environment/config
  files, not public prose, tests or reusable examples.
- Re-evaluate each list independently; never infer token trust from a browser
  origin or copy a staging list into production.

The high-level channel contract is documented in
[`03.J-FIREBASE-PROJECT-AND-TOKEN-AUDIENCE-BOUNDARIES.md`](../../../docs/03-IDENTITY-AND-TRUST/03.J-FIREBASE-PROJECT-AND-TOKEN-AUDIENCE-BOUNDARIES.md).

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
