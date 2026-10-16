# BFF integration profile

SOS GW implements a gateway profile; it is not the owner of a product portal's
navigation or branding. Integrators should use the neutral portal contracts in
this repository's `docs/101-PORTAL_BFF_CONTRACT.md`, the standalone
administration reference in `docs/HOST_AND_TENANT_ADMINISTRATION.md`, and the
execution guide in `docs/BFF_NODE_RUNTIME.md`.

The `101` documents are beginner entry points. There is no `102` gateway or
SDK layer: SOS GW documentation owns the BFF composition and supported wire
operations, SDK core owns runtime-neutral APIs, Node owns server execution and
the standalone product repository owns its deployed administration routes.

Use this repository's generated OpenAPI as the endpoint inventory. This page
does not duplicate it. A portal must advertise only the capability families
that its deployed GW profile and BFF actually implement.

## Terminology

Use `terminology-sdk-node-ts` in the BFF for candidate search, complete
ValueSet options and exact labels. The terminology bearer remains server-side.
Derive sector and jurisdiction from the authenticated wallet/DCR context.

SOS GW uses the same SDK for exact research label enrichment. Structured
research persists/searches the canonical `system|code`, indexes English
`code-display`, and may index localized `code-text` under the resource language.
A terminology outage keeps the code and defers enrichment; it never promotes
an untrusted source label into a terminology-verified research field.

`param` is the preferred high-level name and `claim` remains compatible. FHIR
version is not portal input in the high-level terminology API.

## Authorization

Routes and selected screens are presentation. Host controller, tenant
controller, workforce and personal authority always comes from verified
credentials, wallet/DCR state and narrow backend capabilities. Editing a URL
must never change the effective actor, tenant, sector or subject scope.
