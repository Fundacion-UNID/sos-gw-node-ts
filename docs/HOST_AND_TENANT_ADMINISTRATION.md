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
| Organization administration | tenant controller | organization lifecycle, Locations, licences, workforce, Groups, Consents and delegated operational policy | sector roles and local policy |
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
organization.licenses
organization.workforce
organization.delegations
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

## Controller and workforce resource boundary

Tenant administration uses `org.schema.*` flat claims for the organization
directory and lifecycle, including Organization, Place/Location, Service,
licence and workforce records. The two deliberate FHIR flat-claim exceptions
inside that administration boundary are Group, for governed membership, and
Consent, for delegated purposes and actions.

Operational HL7 FHIR resources belong to the workforce portal. They include
HealthcareService, Schedule, Slot, Appointment, AppointmentResponse, Task,
Encounter, ChargeItem, Invoice and PaymentReconciliation. A tenant controller
selects who may operate them through Group and Consent; controller authority by
itself does not grant those operational mutations.

| Capability | Typical authorized actor | FHIR responsibility |
| --- | --- | --- |
| `organization.location.manage` | tenant controller | create/update the owned organization Location boundary |
| `operations.service.manage` | employee in an authorized Group | configure HealthcareService offerings at an allowed Location |
| `operations.schedule.manage` | scheduler, medical/veterinary secretary or another employee in an authorized Group | Schedule and Slot changes |
| `operations.appointment.manage` | delegated administrative/clinical employee | Appointment and AppointmentResponse, rescheduling and notification |
| `care.encounter.start` | clinician or another care role explicitly authorized by policy | idempotent fulfilled Appointment to Encounter transition |
| `care.encounter.participate` | authorized clinical participant | Encounter participation and permitted clinical actions |

The labels above are capability ids, not FHIR role codes or browser claims.
The BFF derives effective capabilities from the opened wallet/DCR, routed
tenant, current Group membership, applicable Consent purpose/action and any
required subject authorization. Consent records policy; it is never a
standalone access token.

For example, blood donation and plasma donation are two distinct
HealthcareService offerings at the same Location. Each has its own Schedule
and Slot series. Only employees whose current Group and Consent grant the
corresponding service and scheduling actions may manage them.

A veterinarian, physician, nurse, dentist or pharmacist may hold clinical and
scheduling capabilities. An assistant or secretary may hold scheduling without
Encounter authority. A controller can also be an employee, but must exercise
an independently delegated employee capability to perform operational work.
The controller role does not implicitly include scheduling, billing or
Encounter authority.

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

The historical UNID legal-representative path is narrower than a general DCR
exception. Its `Organization/_activate` JWK is the completed first-controller
bootstrap binding; that same controller does not repeat `Token/_exchange` or
`Device/_dcr`. When the deployment compatibility switch is enabled, a
tenant-scoped proof may resolve only an employee stored as
`host-bootstrap-controller`, only through its primary DID or one exact stored
`did:web` alias, and only with the stored public JWK selected by `kid`. Later
service controllers, employees and replacement devices still complete their
own exchange and DCR. Request-supplied key material never grants authority.

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

## Independent verification matrices

Do not make every portal change execute every actor journey. Keep these local
Playwright gates independently runnable, with one worker per run:

| Matrix | Required lifecycle |
| --- | --- |
| host controller | application review, tenant admission/rejection and host service health |
| tenant controller | application, activation, authoritative status, suspend, re-enable, suspend and final revoke/purge without descendant-wide actions |
| professional/employee | wallet/DCR activation plus only the capability families exercised by that role, such as service delivery, scheduling, care, research or billing |
| personal/customer | own-card, relationship and consent journeys without workforce or tenant authority |

The complete release gate invokes those matrices sequentially after their
focused gates pass. A professional fixture may provision its tenant through a
server helper, but that setup does not replace the controller UI lifecycle
matrix. While VetChain still combines administration and professional screens,
its tests remain an executable extraction reference; the standalone
administration portal and the professional portals must own separate
Playwright configurations after extraction.
