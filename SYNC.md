# GDC Core to SOSChain GW synchronization

SOSChain GW is derived from GDC Core. Synchronization is selective and
one-way: downstream products and deprecated gateways do not define this
repository's architecture.

## Procedure

1. Start from current SOSChain GW `main` and identify the exact GDC Core source
   commit or contract.
2. Review the semantic diff; never merge or cherry-pick a complete upstream
   release.
3. Record the disposition as `adopted`, `already-equivalent`,
   `profile-specific` or `blocked`.
4. Write the smallest failing SOSChain contract first and reproduce only the
   applicable behavior in its neutral owner.
5. Keep human and animal policy separate, and never copy a product tenant,
   hostname, controller or deployment identity into neutral source.
6. Complete the gates in
   [`docs/LOCAL_FIRST_RELEASE_CONTRACT.md`](docs/LOCAL_FIRST_RELEASE_CONTRACT.md).

## Current baseline

The baseline is current SOSChain GW `main` plus only the GDC Core contracts
explicitly reproduced and proven here. New entries record source commit,
disposition, owning files and test evidence; they do not inventory downstream
consumers.
