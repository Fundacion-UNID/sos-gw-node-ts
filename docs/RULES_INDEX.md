# Repository rules index

This is the navigation entry point for the rules that govern this repository.
It does not replace the linked contracts. When two rules appear to conflict,
stop and reconcile the owning documents instead of selecting the convenient
one.

## Repository governance

- [`AGENTS.md`](../AGENTS.md) defines scope, hard rules, TDD, quality gates and
  release discipline.
- [`SYNC.md`](../SYNC.md) defines selective synchronization from GDC Core into
  this neutral SOS gateway.
- [Local-first release contract](LOCAL_FIRST_RELEASE_CONTRACT.md) defines the
  cumulative test and release sequence.
- [Persistence release red lines](PERSISTENCE_RELEASE_RED_LINES.md) defines
  mandatory custody and restart evidence for deployed profiles.
- [Identity-provider boundaries](03-IDENTITY-AND-TRUST/03.J-FIREBASE-PROJECT-AND-TOKEN-AUDIENCE-BOUNDARIES.md)
  separates authentication from subject and tenant authorization.
- [Federated EHR continuity boundary](04-DEEP-DIVES/04.L-FEDERATED-EHR-CONTINUITY-STORAGE.md)
  records extension scope without claiming unimplemented behavior.

## Repository skills

- [Configure trusted identity providers](../.codex/skills/configure-trusted-identity-providers/SKILL.md)
- [Enforce release and test discipline](../.codex/skills/enforce-release-test-discipline/SKILL.md)
- [Govern digital-twin consent](../.codex/skills/govern-digital-twin-consent/SKILL.md)
- [Release the UNID deployment profile](../.codex/skills/gw-unid-local-image-release/SKILL.md)
- [Release the veterinary deployment profile](../.codex/skills/gw-vetchain-local-image-release/SKILL.md)
- [Preserve human individual drafts](../.codex/skills/preserve-human-individual-drafts/SKILL.md)
- [Preserve the legacy UNID controller](../.codex/skills/preserve-unid-legacy-controller/SKILL.md)
- [Preserve veterinary health-card proofs](../.codex/skills/preserve-veterinary-health-card-proofs/SKILL.md)
- [Preserve the workspace Node runtime](../.codex/skills/preserve-workspace-node-runtime/SKILL.md)
- [Preserve veterinary gateway boundaries](../.codex/skills/vetchain-gw/SKILL.md)

The skills add task-specific procedure. They cannot weaken `AGENTS.md`, the
local-first gates or the environment-specific authority boundaries.
