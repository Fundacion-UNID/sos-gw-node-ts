// swagger.config.cjs (CommonJS so tooling can `require()` it regardless of package type)

const swaggerDefinition = {
  openapi: '3.0.0',
  info: {
    title: 'Gateway API',
    version: '1.0.3',
    description:
      'API documentation for the secure gateway, covering both legacy (JSON) and secure (JWE) flows.',
  },
  servers: [],
  security: [{ BearerAuth: [] }],
  tags: [
    {
      name: '1.1 Organization Registration',
      description: 'Step 1 (Offer): register a new tenant (organization) on the host.',
    },
    {
      name: '1.2 Organization Order',
      description: 'Step 2 (Order): accept the registration offer and obtain payment/checkout.',
    },
    {
      name: '2.1.4 License Issuance (Invite)',
      description: 'Issue an invite for license activation (host or tenant licensing flow).',
    },
    {
      name: '2.1.2 Initial Access Token Exchange',
      description: 'Exchange activation code + Firebase id_token for initial_access_token (DCR).',
    },
    {
      name: '2.1.3 Device Registration (DCR)',
      description: 'Register device keys / client_id using OpenID Dynamic Client Registration.',
    },
    {
      name: '2.2 OIDC4VCI',
      description: 'Issue Gaia-X compliance credentials via OIDC4VCI.',
    },
    {
      name: '2.2 SMART Token',
      description: 'Step 4: request SMART access tokens (scoped) for a single subject context.',
    },
    {
      name: '3.1 Employee Role',
      description: 'Step 5: create employee/role resources under a tenant.',
    },
    {
      name: '4.1 Family Registration',
      description: 'Step 6 (Offer): register a family organization/household under a tenant.',
    },
    {
      name: '4.2 Family Order',
      description: 'Step 6a (Order): accept the family registration offer.',
    },
    {
      name: '4.3 Family Member Relationship',
      description: 'Step 6b: register family members / emergency contacts (RelatedPerson).',
    },
    {
      name: '5. Consent',
      description: 'Step 7: create consent rules (FHIR Consent).',
    },
    {
      name: '6. Communication',
      description: 'Step 8: send secure communications (FHIR Communication).',
    },
    {
      name: '7. Composition',
      description: 'Step 9: update the Unified Health Index (FHIR Composition).',
    },
    {
      name: '8.1 Subject Profile',
      description: 'Create/update One Health subject profiles (claims-first) for Person, Animal, or Thing.',
    },
    {
      name: '8.7 Care Continuity and SOS Work',
      description: 'Persist and search claims-first Encounter, ServiceRequest, triage Task, CommunicationRequest and organization DocumentReference work records.',
    },
    {
      name: '8.8 Research Study Administration',
      description: 'Create and search FHIR R5 ResearchStudy records, maintain correlated associated parties, and manage descriptive research Groups.',
    },
    {
      name: '9. Research Digital Twin',
      description: 'Ingest pre-converted research claims as digital twin Composition batches.',
    },
    {
      name: 'Discovery',
      description: 'Well-known and discovery endpoints.',
    },
    {
      name: 'Data Catalog Discovery',
      description: 'DCAT-3 catalog discovery endpoints (`/dcat3/catalog/...`) for operator/provider dataset lookup.',
    },
    {
      name: 'Async Polling',
      description:
        'Polling endpoints (`_batch-response`) used to retrieve the final result of asynchronous jobs.',
    },
    {
      name: '2.1.1 Frontend Identity Federation (Optional)',
      description:
        'Optional pre-step: federate an external OIDC id_token (e.g. eIDAS) into Firebase when the frontend does not already have a Firebase id_token.',
    },
    {
      name: '99. Legacy / Internal',
      description: 'Deprecated or internal endpoints kept for backward compatibility.',
    },
  ],
  'x-tagGroups': [
    {
      name: '1. Onboarding a New Organization',
      tags: ['1.1 Organization Registration', '1.2 Organization Order'],
    },
    {
      name: '2. Device and Identity Registration',
      tags: [
        '2.1.4 License Issuance (Invite)',
        '2.1.2 Initial Access Token Exchange',
        '2.1.3 Device Registration (DCR)',
        '2.2 OIDC4VCI',
        '2.2 SMART Token',
      ],
    },
    {
      name: '3. Tenant Operations',
      tags: [
        '3.1 Employee Role',
      ],
    },
    {
      name: '4. Family Onboarding',
      tags: ['4.1 Family Registration', '4.2 Family Order', '4.3 Family Member Relationship'],
    },
    {
      name: '5–7. Individual Data Flows',
      tags: ['5. Consent', '6. Communication', '7. Composition'],
    },
    {
      name: '8. Personal Data',
      tags: ['8.1 Subject Profile', '8.7 Care Continuity and SOS Work'],
    },
    {
      name: '9. Research Data',
      tags: ['8.8 Research Study Administration', '9. Research Digital Twin'],
    },
    {
      name: 'Other',
      tags: [
        'Discovery',
        'Data Catalog Discovery',
        '2.1.1 Frontend Identity Federation (Optional)',
        '99. Legacy / Internal',
      ],
    },
  ],
  components: {
    securitySchemes: {
      BearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description:
          [
            'Bearer token used by legacy (JSON) flows and some onboarding steps.',
            '',
            'Demo/Test-Network note: in non-production environments signature checks may be bypassed, but token format must still be JWT-like (`header.payload.signature`).',
            'Example token you can paste in Swagger "Authorize": `eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiJkZW1vLXVzZXIiLCJlbWFpbCI6ImRlbW9AZXhhbXBsZS5vcmcifQ.demo`.',
            '',
            'Production note: token validation is environment-dependent and accepts an end-user `id_token`, a controller proof bearer (`vp_token` compact JWT) where controller wallet proof is allowed, or a tenant-signed SMART access token on individual and digital-twin FHIR data routes. SMART scopes remain mandatory and SMART does not authorize lifecycle or DCR routes.',
          ].join('\n'),
      },
    },
    parameters: {
      AppId: {
        name: 'App-ID',
        in: 'header',
        required: true,
        schema: { type: 'string', example: 'com.acme.myapp' },
        description:
          "Reverse-DNS application identifier (similar to Apple Bundle ID). For web apps, use a stable reverse-DNS identifier (e.g. 'org.example.webapp').",
      },
      AppVersion: {
        name: 'App-Version',
        in: 'header',
        required: true,
        schema: { type: 'string', example: '1.0.0' },
        description: 'User-facing application version (semver recommended).',
      },
      TenantId: {
        name: 'tenantId',
        in: 'path',
        required: true,
        schema: { type: 'string', example: 'acme-id' },
        description: "Canonical tenant identifier (`Organization.identifier.value`). For legal organizations this is typically TAX/VATES; for individual organizations use UUID.",
      },
      Jurisdiction: {
        name: 'jurisdiction',
        in: 'path',
        required: true,
        schema: { type: 'string', example: 'ES' },
        description:
          "The provider/tenant jurisdiction code within the host-operated infrastructure (e.g., country code like 'ES' or a subdivision like 'ES-CT').",
      },
      HostCoverageScope: {
        name: 'hostCoverageScope',
        in: 'path',
        required: true,
        schema: { type: 'string', example: 'EU' },
        description:
          "Host discovery coverage scope published by the hosting operator (for example 'EU' or 'ES'). This is not the host legal jurisdiction.",
      },
      Version: {
        name: 'version',
        in: 'path',
        required: true,
        schema: { type: 'string', example: 'v1' },
        description: 'API version segment (e.g., v1).',
      },
      Sector: {
        name: 'sector',
        in: 'path',
        required: true,
        schema: { type: 'string', example: 'health-care' },
        description: 'The business sector.',
      },
      HostRegistrySector: {
        name: 'sector',
        in: 'path',
        required: true,
        schema: { type: 'string', enum: ['test', 'test-network', 'network'], example: 'test', default: 'test' },
        description:
          'Legacy path parameter name for the host runtime/network segment. This value is not the tenant business sector. Use test/test-network/network according to the host deployment profile: demo or local test -> test, development or staging -> test-network, production -> network.',
      },
    },
    examples: {
      OrganizationRegistrationPlaintextMessage: {
        summary: 'Plaintext Message for Organization Registration',
        description:
          'Transport-wrapper example for `application/didcomm-plain+json`. It shows the outer compatibility envelope accepted by GW CORE on the wire; app-facing onboarding docs should teach actor SDK flows first, not this wrapper.',
        value: {},
      },
      OrganizationActivationPlaintextMessage: {
        summary: 'Plaintext Message for Organization Activation',
        description:
          'A DIDComm-like message wrapper for legacy compatibility `Organization/_activate`. Canonical proof is `body.vp_token`, `controller.*` carries explicit controller key binding material, `SoftwareApplication.material` denotes the public cryptographic material of the software application when ICA issues that VC, and `organizationCredential` / `representativeCredential` are deprecated legacy compatibility fields. This route is not required after a successful `Organization/_transaction`.',
        value: {},
      },
      OrganizationActivationResponseBundle: {
        summary: 'Organization Activation Response Bundle',
        description:
          'Async `_activate-response` bundle. It returns the generated host Offer claims required by the following `Order/_batch` step.',
        value: {},
      },
      OrganizationVerificationTransactionPlaintextMessage: {
        summary: 'Plaintext Message for Organization Verification Transaction',
        description:
          'Transport-wrapper example for host `Organization/_transaction`. GW CORE forwards the signed PDF evidence, controller business binding key, optional organization credential-signing key, and legal-representative payload to ICA `_verify`. This is the canonical legal-organization onboarding route and does not require `_activate` as a follow-up step.',
        value: {},
      },
      OrganizationIssuePlaintextMessage: {
        summary: 'Plaintext Message for Organization Reissue / Recovery',
        description:
          'A DIDComm-like message wrapper for host `Organization/_issue`. It resubmits legal evidence for an existing tenant and reissues one controller activation code without creating a new Offer.',
        value: {},
      },
      OrganizationIssueResponseBundle: {
        summary: 'Organization Issue Response Bundle',
        description:
          'Async `_issue-response` bundle. It preserves the ICA verification output and returns one reissued controller activation code in `meta.claims`.',
        value: {},
      },
      OrganizationVerificationTransactionResponseBundle: {
        summary: 'Organization Verification Transaction Response Bundle',
        description:
          'Async `_transaction-response` bundle. It preserves the ICA verification bundle in `resource.icaResponse`, returns the generated host Offer claims in `meta.claims`, and makes the next host step explicit in `resource.next` so the caller can continue with `Order/_batch` without requiring legacy `_activate`.',
        value: {},
      },
      OrganizationOrderPlaintextMessage: {
        summary: 'Plaintext Message for Organization Order',
        description:
          'Transport-wrapper example accepting an Offer via an Order. Order.acceptedOffer.identifier is required and must match the full Offer identifier URN returned by the Organization registration _batch-response (use {{offerId}} placeholder in Swagger UI).',
        value: {},
      },
      OrganizationOrderResponseBundle: {
        summary: 'Organization Order Response Bundle',
        description:
          'Async Order response bundle with Organization-order-response-v1.0, org.schema.Order.* invoice/payment claims and org.schema.IndividualProduct.* activation claims.',
        value: {},
      },
      InitialAccessTokenExchangePlaintextMessage: {
        summary: 'Plaintext Message for Initial Access Token Exchange',
        description:
          'A DIDComm-like message wrapper containing `subject_token` (activation code). `subject_token` must be a JSON string (quoted); use {{activationCode}} placeholder in Swagger UI.',
        value: {},
      },
      InitialAccessTokenExchangeResponse: {
        summary: 'Initial Access Token Exchange Response',
        description:
          'Completed `_exchange-response` payload returning the `initial_access_token` required by the following DCR request.',
        value: {},
      },
      LicenseIssuePlaintextMessage: {
        summary: 'Plaintext Message for License Issue',
        description:
          'A DIDComm-like message wrapper reserving a seat and issuing an activation code. User licenses can issue multiple device-profile codes; device licenses only issue one.',
        value: {},
      },
      LicenseIssueExistingEmployeePlaintextMessage: {
        summary: 'Plaintext Message for License Issue (Existing Employee)',
        description:
          'Reserves a seat and issues an activation code for an employee already registered in the tenant (e.g., admin/legal representative adding another device).',
        value: {},
      },
      FirebaseCustomTokenPlaintextMessage: {
        summary: 'Plaintext Message for Firebase Custom Token Federation',
        description: 'A DIDComm-like message wrapper containing `provider` + `id_token`.',
        value: {},
      },
      DeviceRegistrationPlaintextMessage: {
        summary: 'Plaintext Message for Device Registration (DCR)',
        description: 'A DIDComm-like message wrapper containing the OpenID DCR request body.',
        value: {},
      },
      DeviceRegistrationResponse: {
        summary: 'Device Registration Response',
        description:
          'Completed `_dcr-response` payload returning the registered `client_id` for the current device/app.',
        value: {},
      },
      SmartTokenRequestPlaintextMessage: {
        summary: 'Plaintext Message for SMART Token Request',
        description: 'A DIDComm-like message wrapper containing the SMART token request (scope, sub, optional section pinning, etc.).',
        value: {},
      },
      EmployeeRegistrationPlaintextMessage: {
        summary: 'Plaintext Message for Employee Registration',
        description: 'A DIDComm-like message wrapper containing the employee claims.',
        value: {},
      },
      EmployeeDisablePlaintextMessage: {
        summary: 'Bounded Employee soft-disable Bundle with explicit resource ids',
        description: 'Current GW v1 compatibility profile: Bundle entry DELETE sets Employee inactive and keeps the licence seat.',
        value: {},
      },
      EmployeePurgePlaintextMessage: {
        summary: 'Bounded Employee purge Bundle with explicit resource ids',
        description: 'Purges already inactive employees and releases or disassociates their licence seats.',
        value: {},
      },
      RelatedPersonDisablePlaintextMessage: {
        summary: 'Bounded RelatedPerson disable Bundle with explicit resource ids',
        value: {},
      },
      RelatedPersonPurgePlaintextMessage: {
        summary: 'Bounded RelatedPerson purge Bundle with explicit resource ids',
        value: {},
      },
      TenantDisablePlaintextMessage: { summary: 'Disable one hosted tenant after explicit child cleanup', value: {} },
      TenantEnablePlaintextMessage: { summary: 'Enable one suspended hosted tenant', value: {} },
      TenantPurgePlaintextMessage: { summary: 'Purge one suspended hosted tenant after explicit child purge', value: {} },
      IndividualOrganizationDisablePlaintextMessage: { summary: 'Disable one individual organization', value: {} },
      IndividualOrganizationPurgePlaintextMessage: { summary: 'Purge one inactive individual organization', value: {} },
      FamilyRegistrationPlaintextMessage: {
        summary: 'Plaintext Message for Family Registration with online PDF link',
        description:
          [
            'Transport-wrapper example containing the family organization claims.',
            'Default examples use contextualized `org.schema` claim keys such as `Organization.identifier.value` and `Service.category` because the gateway default claim-storage mode accepts omitted `org.schema.` prefixes when `@context` is `org.schema`.',
            'If the service is configured with `CLAIMS_IDENTITY_STORAGE_MODE=canonical`, the same logical claims may also be sent fully qualified as `org.schema.*`.',
            'For signed-PDF onboarding, `Organization.owner.identifier.value` is expected to come from the signer certificate `serialNumber` (for example `IDCES-...`), not from the controller email.',
            'The signed individual PDF attachment accepts either `attachments[].data.links[0]` (preferred online URL form) or `attachments[].data.base64` (embedded legacy form).',
            '`Service.termsOfService` accepts either an HTTPS URL or an embedded `data:application/pdf;base64,...` payload; Swagger shows the URL form by default.',
          ].join(' '),
        value: {},
      },
      FamilyRegistrationPlaintextMessageInlineBase64: {
        summary: 'Plaintext Message for Family Registration with inline base64 PDF',
        description:
          'Same family registration payload, but the signed PDF travels inline in attachments[].data.base64 instead of attachments[].data.links[0]. Use this only when you really need embedded transport.',
        value: {},
      },
      FamilyOrderPlaintextMessage: {
        summary: 'Plaintext Message for Family Order',
        description:
          'A DIDComm-like message wrapper accepting the family registration Offer. Order.acceptedOffer.identifier is required and must match the Offer ID returned by the family registration _batch-response.',
        value: {},
      },
      ConsentCreationPlaintextMessage: {
        summary: 'Plaintext Message for FHIR Consent Creation',
        description:
          'A DIDComm-like message wrapper containing a FHIR Consent resource in the `body`.',
        value: {},
      },
      CommunicationCreationPlaintextMessage: {
        summary: 'Plaintext Message for FHIR Communication',
        description:
          'A DIDComm-like message wrapper containing a FHIR Communication resource in the `body`. For current individual document cases, the payload should carry a `Bundle` `type="document"` with `Composition` first, and the bundle should be the main teaching shape rather than DocumentReference plumbing.',
        value: {},
      },
      CompositionUpdatePlaintextMessage: {
        summary: 'Plaintext Message for FHIR Composition Update',
        description:
          'A DIDComm-like message wrapper containing a FHIR Composition bundle entry in the `body`. This is the lower-level update route; the canonical story starts with `Bundle` `type="document"` and teaches `Communication` as the transport/read wrapper.',
        value: {},
      },
      ResearchCompositionIngestionPlaintextMessage: {
        summary: 'Plaintext Message for Research Digital Twin Composition Ingestion',
        description:
          'Transport-wrapper example containing a `body.data[]` array of Composition resource objects generated by a pre-conversion adapter. Search stays separate from the individual document story and remains FHIR-parameter driven.',
        value: {},
      },
      ResearchCompositionSearchPlaintextMessage: {
        summary: 'Plaintext Message for Research Digital Twin Composition Search',
        description:
          'Transport-wrapper example containing a FHIR `Parameters` resource for section-first digital twin search. This is part of the GW CORE demo search story after anonymization/projection.',
        value: {},
      },
      FamilyMemberRelationshipPlaintextMessage: {
        summary: 'Plaintext Message for Family Member Relationship',
        description:
          'A DIDComm-like message wrapper registering an emergency contact / family relationship (RelatedPerson) using `org.hl7.fhir.api` claims.',
        value: {},
      },
      CustomerOnboardingPlaintextMessage: {
        summary: '(Legacy) Plaintext Message for Person/Customer Onboarding',
        description: 'Legacy flow: DIDComm-like message wrapper containing Person onboarding claims.',
        value: {},
      },
      AsyncPollRequest: {
        summary: 'Async Poll Request',
        description: 'HTTP polling request body (JSON) containing the `thid` from the original submission.',
        value: { thid: 'request-thid' },
      },
      OrganizationRegistrationPollRequest: {
        summary: 'Organization Registration Poll Request',
        description: 'Polls the Organization registration job using the same `thid` from the Organization _batch request.',
        value: { thid: 'org-registration-thread-<test-id>' },
      },
      OrganizationOrderPollRequest: {
        summary: 'Organization Order Poll Request',
        description: 'Polls the Order job using the same `thid` from the Order _batch request.',
        value: { thid: 'org-order-thread-<test-id>' },
      },
      EmployeePollRequest: {
        summary: 'Employee Poll Request',
        description: 'Polls the Employee job using the same `thid` from the Employee _batch request.',
        value: { thid: 'employee-thread-<test-id>' },
      },
      PersonPollRequest: {
        summary: 'Person Poll Request',
        description: 'Polls the Person job using the same `thid` from the Person _batch request.',
        value: { thid: 'person-thread-<test-id>' },
      },
      ConsentPollRequest: {
        summary: 'Consent Poll Request',
        description: 'Polls the Consent job using the same `thid` from the Consent _batch request.',
        value: { thid: 'consent-thread-<test-id>' },
      },
      CommunicationPollRequest: {
        summary: 'Communication Poll Request',
        description: 'Polls the Communication job using the same `thid` from the Communication _batch request.',
        value: { thid: 'communication-thread-<test-id>' },
      },
      TokenExchangePollRequest: {
        summary: 'Token Exchange Poll Request',
        description: 'Polls the initial access token exchange job using the same `thid` from Token/_exchange.',
        value: { thid: 'token-exchange-thread-<test-id>' },
      },
      CompositionPollRequest: {
        summary: 'Composition Poll Request',
        description: 'Polls the Composition job using the same `thid` from the Composition _batch request.',
        value: { thid: 'composition-thread-<test-id>' },
      },
      RelatedPersonPollRequest: {
        summary: 'RelatedPerson Poll Request',
        description: 'Polls the RelatedPerson job using the same `thid` from the RelatedPerson _batch request.',
        value: { thid: 'relatedperson-thread-<test-id>' },
      },
      TenantOrganizationPollRequest: {
        summary: 'Tenant Organization Poll Request',
        description: 'Polls the tenant Organization job using the same `thid` from the Organization _batch request.',
        value: { thid: 'tenant-organization-thread-<test-id>' },
      },
      TenantOrderPollRequest: {
        summary: 'Tenant Order Poll Request',
        description: 'Polls the tenant Order job using the same `thid` from the Order _batch request.',
        value: { thid: 'tenant-order-thread-<test-id>' },
      },
      AsyncPollPending: {
        summary: 'Async Poll Pending Response',
        description: 'HTTP polling response while the job is still running (`202 Accepted`).',
        value: { thid: 'request-thid', status: 'PENDING' },
      },
      AsyncPollSecureResponse: {
        summary: 'Async Poll Secure Response',
        description:
          'Polling response format for secure flows (`application/x-www-form-urlencoded`), returning `response=<jwe>`.',
        value: {},
      },
      DidcommEarlyErrorBundleApiExample: {
        summary: 'Early Error (DIDComm bundle-api envelope)',
        value: {
          type: 'application/bundle-api+json',
          body: {
            resourceType: 'Bundle',
            data: [],
            total: 0,
            issues: {
              issue: [
                {
                  severity: 'error',
                  code: 'required',
                  diagnostics: 'Missing or invalid "thid" parameter.',
                },
              ],
            },
          },
        },
      },
      DidcommEarlyErrorFhirEnvelopeExample: {
        summary: 'Early Error (DIDComm FHIR envelope)',
        value: {
          type: 'application/fhir+json',
          body: {
            resourceType: 'Bundle',
            entry: [],
            total: 0,
            issues: {
              issue: [
                {
                  severity: 'error',
                  code: 'required',
                  diagnostics: 'Missing or invalid "thid" parameter.',
                },
              ],
            },
          },
        },
      },
      LegacyFhirEarlyErrorExample: {
        summary: 'Early Error (LEGACY_FHIR raw body)',
        value: {
          resourceType: 'Bundle',
          entry: [],
          total: 0,
          issues: {
            issue: [
              {
                severity: 'error',
                code: 'required',
                diagnostics: 'Missing or invalid "thid" parameter.',
              },
            ],
          },
        },
      },
    },
    schemas: {
      DidcommPlaintextMessage: {
        type: 'object',
        required: ['jti', 'thid', 'iss', 'aud', 'type', 'body'],
        properties: {
          jti: { type: 'string' },
          thid: { type: 'string' },
          iss: { type: 'string' },
          aud: { type: 'string' },
          type: { type: 'string' },
          body: { type: 'object' },
          meta: { type: 'object' },
        },
      },
      IssueDetail: {
        type: 'object',
        required: ['severity', 'code'],
        properties: {
          severity: { type: 'string', enum: ['fatal', 'error', 'warning', 'information'], example: 'error' },
          code: { type: 'string', example: 'not-found' },
          diagnostics: { type: 'string' },
        },
      },
      DidcommEarlyErrorEnvelopeBundleApi: {
        type: 'object',
        required: ['type', 'body'],
        properties: {
          type: { type: 'string', enum: ['application/bundle-api+json'] },
          body: {
            type: 'object',
            required: ['resourceType', 'data', 'total', 'issues'],
            properties: {
              resourceType: { type: 'string', enum: ['Bundle'] },
              data: { type: 'array', items: {}, example: [] },
              total: { type: 'integer', enum: [0], example: 0 },
              issues: {
                type: 'object',
                required: ['issue'],
                properties: {
                  issue: {
                    type: 'array',
                    items: { $ref: '#/components/schemas/IssueDetail' },
                  },
                },
              },
            },
          },
        },
      },
      DidcommEarlyErrorEnvelopeFhir: {
        type: 'object',
        required: ['type', 'body'],
        properties: {
          type: { type: 'string', enum: ['application/fhir+json'] },
          body: {
            type: 'object',
            required: ['resourceType', 'entry', 'total', 'issues'],
            properties: {
              resourceType: { type: 'string', enum: ['Bundle'] },
              entry: { type: 'array', items: {}, example: [] },
              total: { type: 'integer', enum: [0], example: 0 },
              issues: {
                type: 'object',
                required: ['issue'],
                properties: {
                  issue: {
                    type: 'array',
                    items: { $ref: '#/components/schemas/IssueDetail' },
                  },
                },
              },
            },
          },
        },
      },
      LegacyFhirEarlyError: {
        type: 'object',
        required: ['resourceType', 'entry', 'total', 'issues'],
        properties: {
          resourceType: { type: 'string', enum: ['Bundle'] },
          entry: { type: 'array', items: {}, example: [] },
          total: { type: 'integer', enum: [0], example: 0 },
          issues: {
            type: 'object',
            required: ['issue'],
            properties: {
              issue: {
                type: 'array',
                items: { $ref: '#/components/schemas/IssueDetail' },
              },
            },
          },
        },
      },
      Error: {
        description:
          'Early error contract. DIDComm/JARM flows return a `{type, body}` envelope. LEGACY_FHIR (`application/fhir+json`) returns the raw FHIR Bundle body.',
        oneOf: [
          { $ref: '#/components/schemas/DidcommEarlyErrorEnvelopeBundleApi' },
          { $ref: '#/components/schemas/DidcommEarlyErrorEnvelopeFhir' },
          { $ref: '#/components/schemas/LegacyFhirEarlyError' },
        ],
      },
      OrganizationRegistrationLegacy: {
        type: 'object',
        properties: {
          thid: { type: 'string' },
          iss: { type: 'string' },
          aud: { type: 'string' },
          body: { type: 'object' },
        },
        example: {},
      },
      EmployeeCreationLegacy: {
        type: 'object',
        properties: {
          thid: { type: 'string' },
          iss: { type: 'string' },
          aud: { type: 'string' },
          body: { type: 'object' },
        },
        example: {},
      },
      CustomerCreationLegacy: {
        type: 'object',
        properties: {
          thid: { type: 'string' },
          iss: { type: 'string' },
          aud: { type: 'string' },
          body: { type: 'object' },
        },
        example: {},
      },
      SecureRequest: {
        type: 'object',
        description: 'A JWE-encrypted payload, sent as a form parameter.',
        properties: {
          request: {
            type: 'string',
            format: 'jwe',
            example: 'ey...',
          },
        },
      },
      AsyncPollRequest: {
        type: 'object',
        required: ['thid'],
        description:
          'Polling request body for asynchronous jobs. The `thid` must match the thread id from the corresponding request (e.g., registration vs order).',
        properties: {
          thid: { type: 'string', example: 'request-thid' },
        },
        example: { thid: 'request-thid' },
      },
      AsyncPollPending: {
        type: 'object',
        required: ['thid', 'status'],
        properties: {
          thid: { type: 'string', example: 'request-thid' },
          status: { type: 'string', enum: ['PENDING'], example: 'PENDING' },
        },
      },
      AsyncPollSecureResponse: {
        type: 'object',
        description:
          'Polling response format for secure (FAPI/JARM-style) flows. The encrypted payload is returned in the `response` form parameter.',
        properties: {
          response: {
            type: 'string',
            format: 'jwe',
            example: 'ey...',
          },
        },
      },
      ConsentCreation: {
        type: 'object',
        properties: {
          thid: { type: 'string' },
          iss: { type: 'string' },
          aud: { type: 'string' },
          body: { type: 'object' },
        },
        example: {},
      },
      CommunicationCreation: {
        type: 'object',
        properties: {
          thid: { type: 'string' },
          iss: { type: 'string' },
          aud: { type: 'string' },
          body: { type: 'object' },
        },
        example: {},
      },
      RelatedPersonCreation: {
        type: 'object',
        properties: {
          thid: { type: 'string' },
          iss: { type: 'string' },
          aud: { type: 'string' },
          body: { type: 'object' },
        },
        example: {},
      },
    },
  },
};

const options = {
  swaggerDefinition,
  apis: ['./src/routes/**/*.ts'],
};

module.exports = {
  options,
  swaggerDefinition,
  ...swaggerDefinition,
};
