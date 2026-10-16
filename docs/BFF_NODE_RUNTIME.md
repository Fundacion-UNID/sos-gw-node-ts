# BFF Node runtime integration

This document applies this repository's BFF contract to a Node/Next.js BFF.
The BFF calls the reusable APIs actually exported by the SDK packages; those
packages do not own portal composition, branding, route aliases or product
policy. The runtime must not infer authorization from presentation choices.

This is an SOS GW integration guide, not an API version. There is no separate
`102` gateway or Node API.

## Request sequence

```text
browser session
  -> authenticated BFF route
  -> active profile session
  -> server-owned wallet/DCR record
  -> capability and subject checks
  -> high-level SDK
  -> configured gateway
  -> authoritative readback
```

The browser may request a screen or operation. It may not assert the effective
sector, tenant, controller kind, employee role or subject scope. Resolve those
values from the active profile and its signed evidence before every protected
operation.

Prefer an HttpOnly active-profile session. During compatible migration, an
opaque `profileId` header or body field is acceptable only when the BFF checks
that the profile belongs to the authenticated account. Never put `profileId`
in the page URL.

## Reusable adapter shape

Each portal supplies a small deployment adapter:

```ts
type PortalDeploymentAdapter = Readonly<{
  applicationId: string
  productId: string
  resolveAuthenticatedAccount(request: Request): Promise<{ ownerId: string }>
  resolveActiveProfile(ownerId: string, request: Request): Promise<{
    profileId: string
    sector?: string
    jurisdiction?: string
    authorityKind: string
    roles: readonly string[]
    capabilities: readonly string[]
    allowedScreens: readonly string[]
  }>
  gatewayForProfile(profileId: string): Promise<{ baseUrl: string }>
}>
```

The generic handlers consume this adapter within their owning application.
Administration, workforce/professional and personal/customer portal families
remain separate deployments or route groups with separate API clients; sharing
the adapter shape does not combine their authority surfaces.

In SDK tests, a controlled virtual API may play the BFF role to exercise the
same lifecycle against GW. That harness proves runtime integration; it is not
the deployed portal BFF and owns no public product routes.

## Provider-issued animal cards

Every BFF that accepts an animal card validates the single canonical form
`did:web:<provider-host>:card:vetchain:<speciesId7>:<cardNumber21>` through the
shared data contract. The complete card number is never split into route
parameters. The split 5+16 path is invalid.

Only the issuing provider BFF implements
`GET /card/vetchain/{speciesId7}/{cardNumber21}/did.json`. SOS GW stores and
routes the validated subject locator but does not proxy that public DID route.
Personal and professional BFFs retrieve cards through their authenticated
subject-directory operation; controller BFFs expose no subject-card operation.

## Terminology client

Create one module-level `TerminologyClient`. Its bounded cache stores candidate
queries briefly and exact labels/ValueSet expansions longer. Language is part
of every cache key, so English and each supported user language are independent.
Use a shared `TerminologyCache` adapter when server replicas need a common cache.

The BFF passes sector and jurisdiction from the active profile, not from query
parameters. It may accept both `param` and the compatible `claim` alias. Return
dropdown entries as arrays containing `system`, `code`, localized `text` and
English `display`; never collapse a multi-system ValueSet to `code -> display`.

See the copyable route examples shipped by `terminology-sdk-node-ts` in its
`docs/NEXTJS_BFF_INTEGRATION.md`.

## Compatibility migration

1. Add the neutral capability manifest and server-owned authorization context.
2. Keep current product routes as aliases.
3. Move shared deterministic contracts from product SDKs into `sos-sdk-core-ts`.
4. Move Node session/transport orchestration into `sos-sdk-node-ts`.
5. Keep deprecated product reexports for one compatible release.
6. Remove an alias only after every consumer uses the neutral export and route.

This sequence does not require changing Vet/UHC page URLs and does not add a
mandatory `/portal` segment.
