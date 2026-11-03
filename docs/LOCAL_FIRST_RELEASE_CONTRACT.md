# Local-first TDD and release contract

This contract applies to every behavior, flow, documentation-contract,
deployment-profile and shared-dependency change in this repository. Read it
with [`AGENTS.md`](../AGENTS.md) and the applicable skill in the
[rules index](RULES_INDEX.md).

## Required sequence

1. Start from current `main` on a named branch and preserve unrelated work.
2. Write and run the smallest executable contract first. It must fail because
   the required behavior is absent or wrong.
3. Make focused unit and integration gates green, then prove any affected real
   local UI -> BFF -> high-level SDK -> GW journey without mocks replacing a
   boundary.
4. Promote cumulatively: `test -> local-network -> test-network -> network`.
   No later environment substitutes for an earlier gate.
5. Update the changelog and linked rule/API documentation in the same branch.
6. Commit and push the branch, merge with an explicit merge commit, push
   `main`, verify matching refs and finish clean.

A skip, accepted error, placeholder, HTTP 200 alone or unverified manual step
is not passing evidence. After a failure, resume at the smallest failed gate
unless an earlier boundary changed or its state is no longer trustworthy.

## Dependency and artifact boundary

This repository is a deployable service and must never be published to npm.
Changed reusable packages are released lowest-owner first. A temporary
immutable `npm pack` tarball may be installed only with `--no-save` for local
proof; no `file:`, Git, workspace or vendored dependency may be committed.

Build an immutable service image only from the exact pushed `main` commit after
all affected local gates pass. Deploy by digest and keep source, image,
deployment and authenticated live evidence separate.

## Canonical data and privacy

Reuse standards and exports from their owning shared package. Do not invent or
duplicate governed identifiers, claims, roles, sectors, terminology or test
identities. Public source, tests and documentation must not contain private
deployment topology, credentials, tenant evidence or production data.
