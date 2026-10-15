# Host and tenant administration

This is a thematic SOS GW integration reference, not a second-level `102`
tutorial. It defines a
sector-neutral, standalone administration portal shared by VetChain, UHC and
SOSChain while current portal routes remain compatible.

## Independent portal families

The web applications are split by authority:

| Portal family | Effective actor | Reusable scope | Product extension |
| --- | --- | --- | --- |
| Host and tenant administration | host controller/reviewer | applications, tenant admission, host lifecycle, service health and minimized observability | reviewer policy, legal evidence and host service configuration |
| Organization administration | tenant controller | organization lifecycle, Locations, HealthcareServices, licences, workforce and delegated operational policy | sector roles, payment adapter and local policy |
| Workforce/professional | employee or professional role | authorized subject directory and capability-gated operations | veterinary, healthcare, emergency, insurance or research workflows |
| Personal/customer | individual or personal controller | own cards, consents, relationships and data | PetChain, SOSChain or UHC channel experience |

The first two rows compose the standalone administration product. They do not
live in `soschain-professional-next`. VetChain's combined portal is an existing
functional reference from which the administration UI can be extracted, not a
layout to copy wholesale into SOSChain Professional.

A host can expose several products in one data space. Product/application
identity selects branding and enabled modules; it is not a clinical sector and
does not grant authority.

## Reusable administration template

The React template belongs in `uhc-portal-components-react`. It composes slots
and never talks directly to GW:

```ts
type AdministrationPortalAdapter = Readonly<{
  brand: PortalBrand
  copy: AdministrationPortalCopy
  routes: Readonly<Record<AdministrationScreenId, string>>
  enabledScreens: readonly AdministrationScreenId[]
}>
```

`PortalBrand` supplies the official logo, application and organization names,
home route and CSS variables. VetChain, UHC and SOSChain therefore reuse the
same layout and behavior while retaining their own name, artwork, colors and
localized copy.

The BFF, not the component, returns the effective screen manifest. The browser
may use it to hide navigation, but every route and mutation repeats the
server-side authority check.

## Neutral administration screens

```text
host.applications
host.tenants
host.services
host.observability
organization.overview
organization.locations
organization.services
organization.licenses
organization.workforce
organization.scheduling-policy
organization.lifecycle
```

Professional and personal screens do not enter this administration client.

## Current route compatibility

The template maps neutral operations to routes already implemented by a
product. No URL rewrite is required for adoption:

| Neutral operation | Current compatible BFF route |
| --- | --- |
| applications | `/api/test-network/applications` or UHC `/api/onboarding/applications` |
| application review | `/api/test-network/applications/review` or UHC `/api/onboarding/applications/review` |
| organization activation | `/api/profiles/activation` |
| licences/seats | `/api/licenses` |
| employee invitation | `/api/employees/invitations` |
| employee lifecycle | `/api/employees/lifecycle` |
| organization lifecycle | `/api/organizations/lifecycle` |
| host observability | `/api/host/observability/errors`, with historical aliases retained temporarily |

VetChain and UHC already implement most of this inventory. The standalone
administration BFF must reuse those high-level operations and add only the host
or product adapters it enables. SOSChain Professional does not acquire these
routes as a side effect.

## Scheduling, Locations and Encounter

The organization controller owns configuration and delegation, not every
booking action:

| Capability | Typical authorized actor | FHIR responsibility |
| --- | --- | --- |
| `organization.location.manage` | tenant controller or explicitly delegated administrator | create/update owned Location and its service relationship |
| `organization.service.manage` | tenant controller or delegated service administrator | configure HealthcareService and capacity policy |
| `organization.schedule.manage` | delegated scheduler, medical/veterinary secretary or another authorized worker | Schedule and Slot changes |
| `organization.appointment.manage` | delegated administrative/clinical worker | Appointment and AppointmentResponse, rescheduling and notification |
| `care.encounter.start` | clinician or another care role explicitly authorized by policy | idempotent fulfilled Appointment to Encounter transition |
| `care.encounter.participate` | authorized clinical participant | Encounter participation and permitted clinical actions |

The labels above are capability ids, not FHIR role codes or browser claims.
The BFF derives effective capabilities from the opened wallet/DCR, governed
role/Group assignment, organization and subject authorization.

A veterinarian, physician, nurse, dentist or pharmacist may hold clinical and
scheduling capabilities. An assistant or secretary may hold scheduling without
Encounter authority. A controller can delegate operational work without giving
the delegate tenant lifecycle, licence or host-review authority.

Changing availability reconciles affected Appointments and creates durable
notifications; it must not silently cancel them. Starting care resolves the
authoritative Appointment, subject, Organization, service and Location on the
server. Browser-supplied coordinates never become Encounter authority.

## Profile and route enforcement

Each stored profile identifies one wallet/DCR context. `profileId` remains an
opaque server-side/session selector and does not become a page-route segment.
The BFF resolves ownership and returns authority, organization, sector, roles,
capabilities and allowed screens from verified state.

Manually changing a path never changes that state. If a requested screen is
not allowed, the page fails with 403 or 404; the associated BFF operation also
fails closed independently.

## Compatible extraction sequence

1. Keep existing VetChain and UHC routes and behavior as executable references.
2. Extract administration presentation into `uhc-portal-components-react`,
   parameterized by brand, localized copy and screen slots.
3. Mount it in a standalone administration Next.js application with its own
   BFF; do not mount it under SOSChain Professional.
4. Move the runtime-neutral BFF facade out of `vet-sdk-core-ts` into
   `sos-sdk-core-ts`; retain a deprecated Vet re-export for one compatible
   release.
5. Keep Node session, wallet/DCR transport and virtual-BFF tests in
   `sos-sdk-node-ts`.
6. Exercise each enabled product adapter against its gateway profile before
   enabling its screen.
7. Remove an alias only after every consumer uses the neutral export and an
   authenticated end-to-end journey proves the replacement.

This sequence keeps deployed routes working and does not turn product ids,
sectors, roles or screen names into authorization claims.
