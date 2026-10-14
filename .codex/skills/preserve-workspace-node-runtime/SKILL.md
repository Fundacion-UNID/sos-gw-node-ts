---
name: preserve-workspace-node-runtime
description: Preserve the active Node.js 24 workspace runtime for installs, builds, tests, local services, E2E, Playwright, releases and deployments. Use before running any Node or npm command, interpreting package.json engines, selecting a Node executable, or diagnosing a runtime-version failure in any workspace repository.
---

# Preserve Workspace Node Runtime

## Keep Node 24 active

1. Run `node --version` before the first install, build, test, service, E2E,
   Playwright, release or deployment command and record it with the evidence.
2. Use the workspace's active Node 24 runtime. The current approved runtime is
   Node `24.15.0`.
3. Keep the same Node executable and version for every retry and every process
   spawned by that gate.

## Never switch implicitly

- Never prepend another Node installation to `PATH`, run `nvm use`, use
  `npx node`, or otherwise select another Node version merely because
  `package.json#engines` lists a compatible range.
- Treat `engines` as compatibility metadata, not authorization to change the
  active workspace runtime.
- Do not add compatibility flags, modify `engines`, regenerate a lockfile or
  change dependencies to compensate for an unapproved runtime switch.

## Handle a genuine incompatibility

If a repository-owned, authoritative runtime pin rejects Node 24, or a command
fails specifically because Node 24 is unsupported:

1. Stop before changing the runtime or repository.
2. Report the active version, the repository pin and the exact failure.
3. Obtain explicit user authorization for any runtime change.
4. After authorization, apply the selected runtime consistently to the whole
   gate and record it in the resulting evidence.

A previous successful run under Node 24 is evidence to reproduce that same
environment first; do not manufacture a new failure by choosing another
runtime.

## Synchronize the installed dependency tree

1. Treat the committed `package-lock.json` as authoritative and run `npm ci`
   before builds, tests, E2E, Playwright, release or deployment gates.
2. A clean Git worktree does not prove that `node_modules` matches the lock.
   An older installed internal package is operationally dirty even when
   `git status` is empty.
3. Record effective internal versions with `npm ls` after `npm ci`; never infer
   them only from `package.json` or the lockfile.

## Isolate and clean local test runtimes

1. Before starting services, inventory the required TCP listeners, local
   processes and Docker containers. Never attach to, stop or reuse an unknown
   process merely because its health endpoint responds.
2. Lease one product-specific and run-specific port block atomically. UHC,
   VetChain and every assistant or portal run must use disjoint blocks, with a
   per-run offset for concurrent executions. Pass every derived URL and port to
   all children; fixed shared ports are not valid concurrent-test isolation.
3. Record ownership for every PID, process group, temporary file and container.
   Use unique container names and terminate the complete owned process group in
   `finally` and on `SIGINT` or `SIGTERM`. A failed startup must run the
   same cleanup path as a completed test.
4. After every gate, prove that no listener, child process or container owned by
   that execution remains. Keep services alive only for an explicitly stated
   immediate continuation; record the owner and leased ports, and clean them
   before ending the turn.
5. Do not run redundant full matrices concurrently. Bound builds, browsers,
   emulators and containers to the machine capacity; on resource pressure,
   stop launching work, clean owned runtimes and resume the smallest gate.
6. A cross-repository E2E has exactly one orchestrator that owns the complete
   GW, ICA, DataConv, portal and assistant runtime. A healthcheck without the
   expected run ownership, configuration and source revision is not evidence
   that the correct service is under test.

## Fail fast across browser and E2E matrices

Run the smallest failing journey and the first browser/project first. Configure
Playwright with `maxFailures: 1`, or stop the orchestration immediately after
the first failed project. Do not continue with mobile, sibling browsers or
later journeys after desktop has already failed. Correct the first failure,
rerun that focused project, and only then expand to the complete matrix. A
stopped sibling project is pending, never passing or skipped evidence.

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
