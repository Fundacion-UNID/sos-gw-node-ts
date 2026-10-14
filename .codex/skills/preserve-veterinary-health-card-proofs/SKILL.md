---
name: preserve-veterinary-health-card-proofs
description: Preserve veterinary Immunization provenance, SMART Health Cards ES256 transport, and RFC 7797 detached ML-DSA companion proofs. Use for health-card or microchip lookup, veterinarian OTP confirmation, FHIR Bundle credential projection, offline verification, QR printing, credential-key publication, or migration from Composition-compatible claims to Provenance.
---

# Preserve Veterinary Health Card Proofs

## Keep the current write model stable

- Continue writing Composition-compatible flat claims. Do not introduce Provenance persistence or indexing as part of an SHC change.
- Keep `subject`, `author`, `attester`, and `sender` independent.
- For a veterinarian, resolve the authenticated professional `PractitionerRole` as performer and attester. Never accept a browser-supplied reference as authoritative.
- A personal member or controller has no `PractitionerRole`; use its governed personal attester representation.
- Treat health-card or microchip lookup as identification only. It never authorizes access.
- Treat OTP as fresh user-presence confirmation only. Profile, licence, SMART scope, Consent, and tenant policy authorize the operation.
- Support tattoo lookup only after its identifier system and backend index are governed and implemented.

## Issue from authoritative state

1. Authorize and confirm user presence.
2. Build and validate the FHIR R4 Immunization with governed coding and the animal as subject.
3. Persist through the existing subject-section path.
4. Read back the exact authoritative version.
5. Project that readback into a minimized FHIR Bundle and issue portable proofs.

Do not sign browser input or a pre-write draft.

## Preserve proof boundaries

- A standard SMART Health Card uses `shc:/`, ES256 on P-256, JWS compact serialization, and raw DEFLATE. Never label an ES384/P-384 token as SHC.
- Keep the tenant SHC credential key separate from SMART authorization keys and communication keys.
- Publish credential verification keys through DID `assertionMethod` and/or the issuer JWKS. Keep communication keys under `keyAgreement`.
- A `pqc:/` artifact is a custom post-quantum companion proof, not a standard SHC and not a standalone credential.
- Create one companion proof per attester as an RFC 7797 detached JWS over the exact decompressed SHC payload bytes. Require `b64:false` and `crit:["b64"]`; do not use `typ` to signal detachment.
- Chunk large ML-DSA proofs across explicitly numbered QR labels and require the SHC payload QR set during verification.
- Offline verification requires cached issuer keys and trust/status material. Current trust or revocation state may require an online refresh.

## Reuse repository ownership

- `gdc-common-utils-ts`: generic canonicalization, byte/content helpers, and cryptographic primitives.
- `vet-data-utils-ts`: veterinary FHIR builders, SHC preparation/transport, companion-proof encoding, decoding, and validation.
- `vet-sdk-core-ts`: issuance and verification orchestration over injected signers.
- `vet-gw-node-ts`: authorization, authoritative readback, key custody, indexing, and credential endpoints.
- Product portals: UI/BFF interaction, OTP journey, QR rendering, and printing.
- Synchronize generic fixes to GW CORE and other product gateways only after veterinary gates pass and the boundary is reviewed explicitly.

## Release gates

Follow red-green-refactor TDD. Prove focused tests, affected integration tests, local no-blockchain E2E and Playwright before publication. Build and smoke a local GW VET image before publishing this feature. Never commit `file:`, Git, workspace, or tarball dependencies, and never describe an internal manager as an available end-to-end feature.

Run unit and integration tests with `networkKind=test`, then the real local UI
-> BFF -> SDK -> GW/DataConv Playwright journey without blockchain. An `npm pack`
tarball is a temporary `--no-save` input only; restore the dependency and
lockfile. Publish only after the full affected local matrix is green, install
the exact registry version, run its minimal artifact smoke, then run
`local-network` and staging. Resume at the smallest failed gate; rerun
predecessor gates only for required state, an earlier-boundary change, or
untrustworthy state.

For any release chain that requires npm authorization, make at most three
attempts and keep each command session and browser window alive for up to five
minutes. After all three attempts fail, keep the release unpublished and
continue the local `test` stage with an immutable `npm pack` tarball. Never
commit a `file:`, Git, workspace or vendored tarball dependency.

Follow the canonical contract in
[`docs/LOCAL_FIRST_RELEASE_CONTRACT.md`](../../../docs/LOCAL_FIRST_RELEASE_CONTRACT.md):

- Do not attempt `npm publish` until every affected local `test` gate is green,
  including unit, integration, local services, real UI and Playwright.
- An npm publish or authorization failure must never stop the `test` stage.
- Continue the local gates with the immutable tarball installed `--no-save` on
  pushed but unmerged branches.
- The `npm pack` tarball is temporary: install it `--no-save`, then restore the
  registry dependency and lockfile.
- Resume only the smallest failed gate; do not repeat a green gate unless its
  boundary changed, it creates required state, or state is untrustworthy.
- After publication, install the exact registry version and run its minimal
  install/export smoke; do not repeat the green local matrix unless the
  published artifact differs from the tested tarball.
- Missing exact registry publication blocks only consumer merge, image build,
  `local-network`, `test-network`/staging and `network` promotion.
- A gateway installs the exact registry version before image build and
  `local-network`; a portal may retain the tarball through `local-network`, then
  installs the exact registry version before staging.
- Registry order is dependency publish and verification, consumer pin,
  consumer merge, image build and deploy.
- Every test file's first line must be a `Flow contract:` comment. Reuse fixtures
  from the versioned domain data package or `common-utils`; no duplicated literals are allowed.
- Reuse types from HL7/FHIR, LOINC, SNOMED CT, ICD-10, WHO ATC and Schema.org
  before inventing local vocabulary.
- Put missing reusable types in the versioned domain data package or
  `common-utils`, with tests in that owning shared package.
