# Neutral portal BFF contract: beginner guide

This contract is shared by data-space portals. It is not a Vet, UHC, SOSChain
or sector-specific route catalogue. A product may expose only the capabilities
implemented by its BFF and gateway profile.

`101` means that this is the starting guide for an integrator. It is not a
protocol version and does not imply a `102` API.

## Ownership and alignment

The SOS gateway family keeps the same separation already proved by GW CORE and its
controlled GDC Node test harness. The table states the target shared ownership;
it does not claim that every GDC runtime has already been ported to SOS:

| Layer | Owns | Does not own |
| --- | --- | --- |
| SOS GW and these docs | supported HTTP operations, submit/poll semantics, BFF functional mapping and portal-composition boundary | product branding or browser sessions |
| `sos-sdk-core-ts` | runtime-neutral orchestrators and APIs it actually exports | portal composition, Node credentials, cookies or Next.js handlers |
| `sos-sdk-node-ts` | Node adapters it actually exports; later ports add their own runtime tests and virtual harness | the product BFF, its routes or navigation |
| product BFF | authentication, active profile, policy, route handlers and response projection | authority inferred from browser routes |
| `uhc-portal-components-react` | reusable React shells/components with injected branding and copy | authorization or gateway calls |

The existing reference is the virtual API in `gdc-sdk-node-ts`: it is
deliberately not a deployed product BFF. Its SOS equivalent must execute this
contract against the gateway so the lifecycle can be proved without making
`sos-sdk-node-ts` the owner of portal routes.

## Separate portal surfaces

One deployment may reuse the same shell and SDK, but these are independent
authorization surfaces:

| Surface | Actor | Scope |
| --- | --- | --- |
| Host administration | host controller or reviewer | tenant admission, host lifecycle and observability |
| Organization administration | tenant controller | organization lifecycle, licences, employees, services and local policy |
| Workforce portal | authorized employee/professional role | operational work over explicitly authorized subjects |
| Personal portal | individual or personal controller | the person's cards, consents, relationships and data |

A host may operate a different product or brand without changing this split.
The host application identity is not a tenant sector. Likewise PetChain,
SOSChain and UHC are product/channel identities, not a personal user's sector.

Host and organization administration form an independent administration web
portal. Professional/workforce and personal/customer use cases are separate
applications. They may share SDKs and React components, but they do not share
navigation or API clients merely because one existing portal currently renders
several of those workspaces together.

## Authorized context

The BFF resolves one server-owned context before rendering a protected screen
or calling a gateway:

```ts
type PortalAuthorizationContext = Readonly<{
  profileId: string            // opaque wallet/DCR record id; never a URL segment
  actorKind: string
  authorityKind: 'host-controller' | 'tenant-controller' | 'employee' | 'personal'
  organizationId?: string
  sector?: string
  roles: readonly string[]
  capabilities: readonly string[]
  allowedScreens: readonly string[]
}>
```

`profileId` is meaningful internally because each profile selects a distinct
wallet/DCR. It does not belong in a visible page route. The BFF binds it to an
authenticated, short-lived profile session and rechecks ownership and
capabilities for every API operation.

Sector, role, organization and capability values never become authoritative
because they appear in a URL, form, local storage or browser-selected card.

## Page routes

New portals may use these semantic namespaces:

```text
/{locale}/host/{screen}
/{locale}/organization/{screen}
/{locale}/professional/{screen}
/{locale}/personal/{screen}
```

They describe navigation only. They do not grant authorization. If the active
profile does not include the requested screen, the server returns 403 or 404.

Existing `/{locale}/{accessPath}`, `/{locale}/portal`, `/onboarding/*` and
product routes remain compatible aliases during migration. Adding a mandatory
`/portal`, `/{sector}` or `/{role}` segment would break current links and would
incorrectly make editable routing data look authoritative.

The neutral screen ids and their product routes are deployment configuration.
VetChain and UHC can keep existing URLs during extraction. The new standalone
administration portal is not mounted inside `soschain-professional-next`.

## BFF capability families

A conforming product advertises which families it implements:

- session and active wallet/profile;
- host and tenant lifecycle;
- organization, licence and workforce lifecycle;
- subject/card directory and subject-scoped operations;
- terminology candidates, ValueSet options and exact labels;
- product extensions such as emergency, research or insurance flows.

Clients must not expose a method merely because another portal implements it.
Unsupported capability families fail closed and are absent from the capability
manifest.

## Organization lifecycle boundary

The reusable controller flow is orchestration, not a wildcard gateway action:

1. resolve the active controller wallet and signed authority;
2. read the exact organization and its current lifecycle state;
3. enumerate affected employees, members, licences and services with bounded
   pagination;
4. submit explicit per-resource batch entries;
5. retain partial failures and retry only unresolved entries;
6. confirm the final state through authoritative readback.

Host controllers administer tenant admission and host services. Tenant
controllers administer only their organization. An employee role and a
personal user never inherit controller authority from the screen they opened.

The reusable standalone administration template and compatibility mapping are
defined in [Host and tenant administration](HOST_AND_TENANT_ADMINISTRATION.md).

## Scheduling and care boundary

Scheduling is split by operation, not profession title:

- an organization controller manages the `org.schema.*` organization
  directory/lifecycle and owned Locations, then delegates narrow actions with
  FHIR Group membership and Consent;
- an authorized employee manages HealthcareService, Schedule, Slot, Appointment and
  AppointmentResponse, including rescheduling and notifications;
- an authorized care professional starts or participates in an Encounter when
  the authoritative Appointment reaches the governed transition;
- an assistant may prepare or coordinate only the operations explicitly
  delegated to that role and never acquires clinical attestation authority by
  managing an agenda.

Veterinarian, physician, nurse, dentist, dental assistant, medical secretary,
pharmacist and pharmacy assistant remain localized role labels backed by
governed role codes and capability assignments. Code must authorize narrow
capabilities such as schedule management or Encounter participation, not a
hardcoded list of job-name strings.

Group membership and Consent are necessary governance inputs, not sufficient
authorization in isolation. Every BFF operation also verifies the active
wallet/DCR, routed tenant, current membership, requested purpose/action and any
subject scope. Changing a portal route never changes those facts.

## Terminology boundary

Portal terminology is server-only and uses `terminology-sdk-node-ts`:

- `searchCodeCandidatesFromText` for a reviewed text-to-code choice;
- `getCodeOptionsForParameter` for complete, multi-system dropdown options;
- `resolveCodeLabels` for exact `system|code` labels.

`param` is the preferred FHIR SearchParameter name; `claim` remains a
compatible alias. `source` is optional provider/policy provenance and is not a
replacement for `Coding.system`.
