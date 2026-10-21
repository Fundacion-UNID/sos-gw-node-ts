# Complete portal API reference

Status: canonical functional map for browser-facing Backend for Frontend (BFF)
capabilities over SOS Gateway and the inherited GW CORE model.

The `101` document is the beginner guide. This document is the complete
capability map; it is not a numbered successor and does not create a `102`
convention.

This map consolidates the neutral GDC foundation and later human, animal and
emergency requirements. It defines stable business capabilities, not one
application's route-file layout. Every deployed portal keeps an exhaustive
route inventory beside its handlers and maps each handler to this reference.

## How to read the tables

| Status | Meaning |
| --- | --- |
| **Implemented shared rule** | shared code or a Gateway rule exists and has executable tests; a portal still needs its own authenticated handler and journey proof |
| **Portal adapter** | the capability is common, but authentication, persistence or policy is supplied by each deploying portal |
| **Planned** | required by the functional model but unavailable until route, SDK, Gateway and readback tests exist |

The browser sends business intent only. The BFF resolves the authenticated
account, active profile, organization, employee or personal relationship,
role, sector, jurisdiction, service, subject, Consent and requested action. It
then calls a high-level software development kit (SDK). The browser never
authors wallet keys, activation credentials, DCR requests, DIDComm envelopes,
SMART audiences, Fabric channels or Gateway dispatch names.

Every write follows the same evidence rule:

```text
browser intent -> authenticated BFF -> high-level SDK -> Gateway acceptance
               -> authoritative readback -> browser-safe result
```

An HTTP success, queued job, local cache or optimistic screen is not
authoritative readback.

## Shared public route families

The executable shared route-root rule defines these capability-first families:

| Route family | Purpose | Status |
| --- | --- | --- |
| `/api/profile` | active personal or professional profile and bounded session | Implemented shared rule |
| `/api/subjects` | subject directory and subject-scoped actions | Implemented shared rule |
| `/api/cards` | card discovery and presentation | Implemented shared rule |
| `/api/notifications` | addressed communications, public information and delivery preferences | Implemented shared rule |
| `/api/assistant` | channel-neutral assistant entry points | Implemented shared rule |
| `/api/internal` | authenticated service-to-service adapters only | Implemented shared rule |

Organization, employee, licence, scheduling and care handlers may retain
existing semantic paths while adapters converge. A product or sector name in a
path is a compatibility alias, never authority. The owning portal must list
and test every concrete alias.

## Profile, session and technical identity

| Operation | Stable behavior | Status |
| --- | --- | --- |
| profile status, create and unlock | create or unlock one owned PIN/passkey-protected profile before protected navigation | Portal adapter |
| profile or employee activation | consume a server-held activation grant and register the approved device and role | Portal adapter |
| active session read/close | revalidate or end the short-lived unlocked session | Portal adapter |
| profile and PIN recovery | recover only an authenticated owned profile after fresh evidence | Portal adapter |
| personas | list only profiles assigned by authoritative state to the authenticated account | Portal adapter |

Activation-code exchange, device activation or Dynamic Client Registration
(DCR), signed client assertions and SMART tokens are internal BFF operations.
They are not public form fields or browser APIs.

## Organizations, employees, licences, offers and orders

| Operation | Stable behavior | Status |
| --- | --- | --- |
| organization application/review | submit evidence and expose its exact reviewed state | Portal adapter |
| organization activation | complete Organization transaction, Offer, Order, activation and DCR | Portal adapter over implemented Gateway lifecycle |
| organization resolution | resolve an exact hosted organization without granting authority | Portal adapter |
| organization lifecycle | read status; explicitly disable, enable or purge one organization | Implemented shared rule; never cascade or use wildcard ids |
| DID binding | read or update governed public aliases after legal onboarding | Portal adapter |
| licence offer | request and read an Offer before new seats exist | Portal adapter |
| licence order/payment | confirm the exact Offer and materialize seats only after verified evidence | Portal adapter |
| licence inventory | list authoritative available, assigned and device state | Implemented shared rule; direct inventory mutation is forbidden |
| employee invitation | reserve an existing seat, create the employee and issue its invitation | Implemented shared rule |
| employee inventory/lifecycle | list, disable, enable or purge one exact employee with readback | Implemented shared rule |
| locations, departments and services | administer owned Locations and HealthcareServices without treating a department as a service | Portal adapter |
| professional groups | manage workforce membership separately from subject groups and Consent | Portal adapter |

Offer and Order are always distinct. `License/_issue` assigns an existing seat;
it does not buy or create one. A test payment adapter may confirm a zero-value
Order, but it preserves the same Offer-to-Order lifecycle.

## Subjects, cards and personal controllers

| Operation | Stable behavior | Status |
| --- | --- | --- |
| subject directory | list every subject authorized for the actor across reloads | Implemented shared rule; an error is not an empty directory |
| explicit subject creation | create a human or animal individual only after the user selects create | Portal adapter |
| subject detail | return one exact authorized subject and actor relationship | Portal adapter |
| card discovery | search provider-issued card identifiers without granting access | Implemented shared rule |
| card presentation | display only authoritative card data and provenance | Portal adapter |
| controller relationships | represent each controller with distinct relationship evidence | Portal adapter |
| linked identifiers | update the selected subject's protected identifiers with complete readback | Portal adapter |
| subject lifecycle | explicitly disable, reactivate or purge through an authorized controller | Portal adapter |

Sign-in discovery is read-only. It never creates a card, guesses a subject id
or turns a directory failure into “no card”. Human and animal adapters reuse
the lifecycle without treating demographics, species, breed, race or ethnicity
as interchangeable fields.

## Clinical data, documents and IPS

| Operation | Stable behavior | Status |
| --- | --- | --- |
| clinical summary request/latest IPS | request and reload a full or section-limited International Patient Summary | Implemented Gateway rule; portal handler required |
| clinical create/update | submit permitted claims-first resources for one subject and service | Implemented Gateway rule; professional adapter required |
| clinical correction/delete | change only the explicitly authorized resource and preserve provenance | Portal adapter |
| specialized search | perform bounded server-authorized queries when the IPS is insufficient | Portal adapter |
| document list/detail | retrieve governed `DocumentReference` projections and content | Portal adapter |
| clinical document import | submit a document Bundle with `Composition` first and exact section entries | Implemented shared rule |
| immunization/follow-up | add Immunization, ImmunizationRecommendation and Task only with author authority | Portal adapter |

Clinical subject-index traffic crosses the Gateway as auditable
`Communication`. Internal operations such as `Subject/$summary` are dispatch
references resolved by the Gateway; browser code does not construct them.

## Consent, contacts, members and invitations

| Operation | Stable behavior | Status |
| --- | --- | --- |
| related person/contact | manage caregivers, guardians and emergency contacts as relationships | Portal adapter |
| access Consent | grant or deny an exact recipient, purpose and data scope | Portal adapter over shared Consent rules |
| access request | request scoped access when no current permission exists | Portal adapter |
| invitation | send a draft request to one verified relationship or member | Portal adapter; invitation alone grants nothing |
| personal member seats | list and assign seats for actors invited into an individual index | Portal adapter |
| restricted emergency request | submit separately justified, time-limited and audited access | Portal adapter; fail closed unless enabled |
| secondary-use Consent | enable or deny research synchronization independently of ordinary access | Implemented shared rule |
| digital-twin provider removal | remove the private provider link without claiming anonymous-data deletion | Implemented shared rule |

`RelatedPerson`, membership and `Consent` are different. A contact can exist
without access; an invitation can carry draft Consent without granting access;
membership alone issues no SMART token.

## Scheduling, Encounters and care journeys

| Operation | Stable behavior | Status |
| --- | --- | --- |
| service catalog | list the exact active HealthcareService and Location choices | Portal adapter |
| Schedule and Slot | manage availability only for delegated services | Portal adapter over shared data rules |
| Appointment/response | request, accept, decline, cancel or reschedule with readback | Portal adapter |
| urgent ServiceRequest | request an emergency or urgent service before an Appointment exists | Portal adapter |
| Encounter create/retrieve | create or retrieve one Encounter for the verified current service | Portal adapter over shared care rules |
| previous Encounter decision | require an explicit finish-or-keep choice and prevent duplicates | Portal adapter |
| admission/transfer/discharge | preserve the ordered journey and receiving-service boundary | Portal adapter |
| personal journey readback | show the saved journey after reload without professional authority | Portal adapter |

A scanned code identifies a subject. It grants neither service membership nor
clinical or emergency access. A receiving organization creates its own linked
Encounter instead of silently reusing the responder's Encounter.

## Communications, attachments and calls

Concrete handlers are children of `/api/notifications` when implemented.

| Operation | Stable behavior | Status |
| --- | --- | --- |
| channel list | separate conversations by organization, service, subject and Encounter | Planned complete cross-portal journey |
| timeline | reload text, audio, files, call results and system events | Planned complete cross-portal journey |
| send text | create an addressed message only for permitted participants | Portal adapter over shared Communication rules |
| attach audio/image/PDF | validate media and conversation authority before binding a server reference | Portal adapter |
| audio/video call | establish a permitted call without exposing contact coordinates | Portal adapter |
| call result | persist answered, missed, declined, failed or completed state in the timeline | Planned complete cross-portal journey |
| delivery/read state | display only states the transport can prove | Planned |

Permission to contact does not grant clinical-data access. An ordinary message
attachment does not become clinical data merely because it is a PDF or image.

## Public information and alerts

Public publication and personal delivery are separate operations under
`/api/notifications`.

| Operation | Stable behavior | Status |
| --- | --- | --- |
| publisher topic choices | return only datasets allowed for the organization, sector, jurisdiction and service | Portal adapter over shared topic validation |
| public notice draft | validate topic, title, Markdown, priority, expiry and attachments | Implemented shared rule |
| public attachment | accept bounded image/PDF content before publication | Portal adapter |
| public publication | persist `CommunicationRequest` plus referenced `DocumentReference` content | Implemented Gateway rule; adapter required |
| active public read | return only active notices for requested public datasets | Implemented Gateway rule; personal projection required |
| subscriptions/exclusions | privately store topics, jurisdictions, mutes and delivery preferences | Portal adapter |
| push/email/SMS delivery | select configured channels without exposing subscribers | Planned until provider delivery is proven |

First examples include blood donation, plasmapheresis, plateletpheresis,
animal blood donation and simple public-health hazards. Dataset names remain
readable and code-free for the MVP. Publishers never receive subscriber
identity, distance, donation interval or device destinations.

## Terminology and schema-driven forms

| Operation | Stable behavior | Status |
| --- | --- | --- |
| capabilities | return sources and fields allowed by server policy | Portal adapter |
| candidate search | search reviewed text-to-code candidates server-side | Implemented shared rule |
| exact labels | resolve `system|code` to localized text and English display | Implemented shared rule |
| ValueSet options | return complete allowed options for a governed parameter | Implemented shared rule |
| form definition | render the same versioned JSON Schema rules across channels | Implemented shared rule |
| validated submission | normalize values before mapping them to claims-first resources | Implemented shared rule |

The browser never receives terminology credentials. Selecting a code is a user
decision; free text or machine candidates do not silently become authoritative
coding.

## Assistant and channel adapters

| Operation | Stable behavior | Status |
| --- | --- | --- |
| assistant intent | accept authenticated text and return a proposal or bounded navigation | Portal adapter under `/api/assistant` |
| transcription | transform bounded audio to editable text without clinical authority | Portal adapter |
| telephone/chat forms | use the same governed definitions and validation as the portal | Implemented shared rule; adapter proof required |
| task execution | execute only an explicitly confirmed authorized operation | Planned for production adapters |
| internal workers/webhooks | receive authenticated callbacks under `/api/internal` | Portal adapter; never a browser route |

An assistant may propose or prepare work. It does not silently send a public
alert, create clinical data, grant Consent or elevate the active role.

## Concrete portal inventory rule

Every portal keeps a generated or reviewed inventory beside its route handlers.
Each row records:

1. concrete method and path;
2. functional operation in this document;
3. authenticated actor and active-profile requirement;
4. high-level SDK call or explicitly local portal storage;
5. authoritative readback;
6. implemented, adapter-owned or planned state; and
7. focused route test plus end-to-end evidence where a real boundary is crossed.

This common map is not proof that every portal implements every capability.
Conversely, a product-specific handler does not become shared merely because
it calls the Gateway. Shared behavior belongs in neutral data and SDK layers;
sector terminology, screens and policies remain adapter configuration.
