---
name: preserve-human-individual-drafts
description: Preserve human Individual Organization drafts without weakening veterinary draft rules. Use for name or birth-date capture, card issuance, ONESELF membership, owner authority, resume/delete behavior, or FamilyManager.
---

# Preserve Human Individual Drafts

- Keep the private Organization UUID distinct from public card aliases,
  contacts, DIDComm senders, wallet keys and DCR clients.
- Default an omitted first member role to HL7 `ONESELF` for a nameless
  self-subject draft. Preserve an explicit governed relationship for a
  represented dependant. The authenticated creator remains the distinct
  Organization owner/controller.
- Permit a nameless human draft only when `Person.birthDate` contains a valid
  year or date. Reject a record with neither a name nor valid birth data.
- Persist it as `Pending` through `IVaultRepository`; Organization lifecycle is
  not `Composition.status`.
- Omit `Organization.sameAs` and card HMAC material while the name is absent.
  Never expose the private UUID, telephone or a generated alias as a card.
- Return `draft_saved`, reuse the private UUID on resume, and allow only the
  verified owner/controller to resume or directly delete the draft.
- Reject Order activation until the profile readiness check passes.
- Keep human and veterinary readiness separate behind one shared lifecycle.
  Human tests use person data; veterinary tests use `Animal` references,
  species and animal-controller data.
- Add red-green-refactor tests for save, invalid empty input, owner-only
  resume, activation rejection and owner-only deletion.

## Vet-first differential synchronization

- Read [`SYNC.md`](../../../SYNC.md) whenever a VetChain correction may apply
  to the human profile.
- Review the complete counterpart set: GW, personal portal, professional
  portal and telephone assistant, including YAML/JSON Schema and E2E adapters.
- Port shared security and lifecycle invariants with human differential tests;
  do not repeat the generic veterinary matrix when its boundary is unchanged.
- Never copy species, veterinary policy or animal demographics into a human
  profile.

## Frozen shared-v1 boundary

- Implement new behavior in `sos-*`; keep GW CORE v1 and `gdc-*` frozen except
  for narrow security or compatibility fixes.
- Reuse shared types and data builders; do not duplicate domain literals.
- Follow [`docs/LOCAL_FIRST_RELEASE_CONTRACT.md`](../../../docs/LOCAL_FIRST_RELEASE_CONTRACT.md).
- Every test file begins with a `Flow contract:` comment.

## Release continuity

- Follow `docs/LOCAL_FIRST_RELEASE_CONTRACT.md`. Run unit and integration with
  `networkKind=test`, followed by the real UI -> BFF -> SDK -> GW/DataConv
  Playwright journey; mocks do not replace that boundary.
- Do not attempt `npm publish` until every affected local unit, integration,
  local services, real UI and Playwright gate is green.
- An authorization failure must never stop the test stage.
- Make at most three authorization attempts and keep each session alive for up
  to five minutes. Then continue locally with an immutable `npm pack` tarball
  installed `--no-save` on pushed but unmerged branches.
- The tarball is temporary: restore the registry dependency and lockfile. Never
  commit a `file:`, Git, workspace or vendored tarball dependency.
- An `npm pack` tarball is temporary: install it `--no-save`, then restore the
  registry dependency and lockfile.
- Resume only the smallest failed gate; do not repeat a green gate unless a
  predecessor creates required state, the fix changed that boundary, or the
  environment is untrustworthy.
- After publication, install the exact registry version and run the minimal
  install/export smoke; do not repeat the green local matrix unless the
  published artifact differs from the tested tarball.
- Missing publication blocks only consumer merge, image build,
  `local-network`, `test-network`/staging and `network` promotion.
- A gateway installs the exact registry version before image build and
  `local-network`; a portal may use the tarball for local-network, then installs
  the exact registry version before staging.
- Registry order is dependency publish and verification, consumer install and
  lockfile pin, package merge, consumer merge, image build and deploy.
- Every test file's first line is a `Flow contract:` comment; reuse fixtures
  from the versioned domain data package or `common-utils`; no duplicated literals
  are allowed. Reuse types from
  the versioned domain data package, `common-utils` or another shared package.
  Reuse HL7/FHIR, LOINC, SNOMED CT, ICD-10, WHO ATC and Schema.org vocabulary
  before inventing any local literal.
