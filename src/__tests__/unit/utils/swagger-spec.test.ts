// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
import { generateSwaggerSpec } from '../../../utils/swagger-spec';
import { testClaimsRegisterTenantExpanded } from '../../data/organization.data';

describe('Swagger Spec Generation', () => {
  it('publishes explicit-id employee/member lifecycle and omits descendant-wide actions', async () => {
    const spec = await generateSwaggerSpec();
    const employeePurgePath = '/{tenantId}/cds-{jurisdiction}/v1/{sector}/entity/org.schema/Employee/_purge';
    const relatedPersonPurgePath = '/{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.hl7.fhir.api/RelatedPerson/_purge';

    expect(spec.paths[employeePurgePath]).toBeDefined();
    expect(spec.paths[relatedPersonPurgePath]).toBeDefined();
    for (const path of [
      '/host/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Organization/_status',
      '/host/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Organization/_search',
      '/host/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Organization/_disable',
      '/host/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Organization/_enable',
      '/host/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Organization/_purge',
      '/host/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Organization/_status-response',
      '/host/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Organization/_search-response',
      '/host/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Organization/_disable-response',
      '/host/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Organization/_enable-response',
      '/host/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Organization/_purge-response',
      '/{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.schema/Organization/_disable',
      '/{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.schema/Organization/_purge',
      '/{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.schema/Organization/_disable-response',
      '/{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.schema/Organization/_purge-response',
      '/{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.hl7.fhir.api/RelatedPerson/_search',
    ]) {
      expect(spec.paths[path]).toBeDefined();
    }
    expect(Object.keys(spec.paths).some((path) => path.includes('_disable-descendants'))).toBe(false);
    expect(Object.keys(spec.paths).some((path) => path.includes('_purge-descendants'))).toBe(false);

    const employeeDisable = spec.components.examples.EmployeeDisablePlaintextMessage.value;
    const employeePurge = spec.components.examples.EmployeePurgePlaintextMessage.value;
    const memberPurge = spec.components.examples.RelatedPersonPurgePlaintextMessage.value;
    expect(employeeDisable.body.data[0].request.method).toBe('DELETE');
    expect(employeeDisable.body.data[0].resource.id).toBeTruthy();
    expect(employeeDisable.body.data[0].resource.id).not.toBe('*');
    expect(employeePurge.body.data[0].request.method).toBe('POST');
    expect(employeePurge.body.data[0].resource.id).toBeTruthy();
    expect(memberPurge.body.entry[0].resource.id).toBeTruthy();
  });

  it('includes onboarding endpoints in the same journey order as API_INTEGRATORS_GUIDE', async () => {
    const spec = await generateSwaggerSpec();

    expect(spec.paths).toBeDefined();
    expect(spec.paths['/{tenantId}/cds-{jurisdiction}/v1/{sector}/identity/openid/Token/_exchange']).toBeDefined();
    expect(spec.paths['/{tenantId}/cds-{jurisdiction}/v1/{sector}/identity/openid/Token/_exchange-response']).toBeDefined();
    expect(spec.paths['/{tenantId}/cds-{jurisdiction}/v1/{sector}/identity/firebase/Token/_custom']).toBeDefined();
    expect(spec.paths['/{tenantId}/cds-{jurisdiction}/v1/{sector}/identity/firebase/Token/_custom-response']).toBeDefined();
    expect(spec.paths['/host/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Organization/_batch']).toBeDefined();
    expect(spec.paths['/host/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Organization/_batch-response']).toBeDefined();
    expect(spec.paths['/host/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Organization/_issue']).toBeDefined();
    expect(spec.paths['/host/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Organization/_issue-response']).toBeDefined();
    expect(spec.paths['/host/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Organization/_transaction']).toBeDefined();
    expect(spec.paths['/host/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Organization/_transaction-response']).toBeDefined();
    expect(spec.paths['/host/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Organization/_activate']).toBeDefined();
    expect(spec.paths['/host/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Organization/_activate-response']).toBeDefined();
    expect(spec.paths['/host/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Order/_batch']).toBeDefined();
    expect(spec.paths['/host/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Order/_batch-response']).toBeDefined();
    expect(spec.paths['/{tenantId}/cds-{jurisdiction}/v1/{sector}/did/document/_binding']).toBeDefined();
    expect(spec.paths['/{tenantId}/cds-{jurisdiction}/v1/{sector}/did/document/_binding-response']).toBeDefined();
    expect(spec.paths['/{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.schema/Organization/_batch']).toBeDefined();
    expect(spec.paths['/{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.schema/Organization/_batch-response']).toBeDefined();
    expect(spec.paths['/{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.schema/Organization/_transaction']).toBeDefined();
    expect(spec.paths['/{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.schema/Organization/_transaction-response']).toBeDefined();
    expect(spec.paths['/{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.schema/Order/_batch']).toBeDefined();
    expect(spec.paths['/{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.schema/Order/_batch-response']).toBeDefined();
    for (const path of [
      '/{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.hl7.fhir.r4/Composition/_batch',
      '/{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.hl7.fhir.r4/Composition/_batch-response',
    ]) {
      expect(spec.paths[path]?.post?.deprecated).toBe(true);
      expect(spec.paths[path]?.post?.['x-contract-level']).toBe('compatibility-deprecated');
    }
    expect(spec.paths['/{tenantId}/cds-{jurisdiction}/v1/{sector}/digitaltwin/org.hl7.fhir.api/Composition/_batch']).toBeDefined();
    expect(spec.paths['/{tenantId}/cds-{jurisdiction}/v1/{sector}/digitaltwin/org.hl7.fhir.api/Composition/_batch-response']).toBeDefined();
    expect(spec.paths['/{tenantId}/cds-{jurisdiction}/v1/{sector}/digitaltwin/org.hl7.fhir.api/ResearchSubject/_search']).toBeDefined();
    expect(spec.paths['/{tenantId}/cds-{jurisdiction}/v1/{sector}/digitaltwin/org.hl7.fhir.r4/Composition/_batch']).toBeDefined();
    expect(spec.paths['/{tenantId}/cds-{jurisdiction}/v1/{sector}/digitaltwin/org.hl7.fhir.r4/Composition/_batch-response']).toBeDefined();
    expect(spec.paths['/{tenantId}/cds-{jurisdiction}/v1/{sector}/digitaltwin/org.hl7.fhir.api/Composition/_batch']?.post?.deprecated).not.toBe(true);
    expect(spec.paths['/{tenantId}/cds-{jurisdiction}/v1/{sector}/digitaltwin/org.hl7.fhir.api/Composition/_batch-response']?.post?.deprecated).not.toBe(true);
    expect(spec.paths['/{tenantId}/cds-{jurisdiction}/v1/{sector}/digitaltwin/org.hl7.fhir.r4/Composition/_batch']?.post?.deprecated).not.toBe(true);
    expect(spec.paths['/{tenantId}/cds-{jurisdiction}/v1/{sector}/digitaltwin/org.hl7.fhir.r4/Composition/_batch-response']?.post?.deprecated).not.toBe(true);
    expect(spec.paths['/{tenantId}/cds-{jurisdiction}/v1/{sector}/digitaltwin/org.hl7.fhir.r4/ResearchSubject/_search']).toBeDefined();
    expect(spec.paths['/{tenantId}/cds-{jurisdiction}/v1/{sector}/organization/org.hl7.fhir.r5/ResearchStudy/_batch']).toBeDefined();
    expect(spec.paths['/{tenantId}/cds-{jurisdiction}/v1/{sector}/organization/org.hl7.fhir.r5/ResearchStudy/_batch-response']).toBeDefined();
    expect(spec.paths['/{tenantId}/cds-{jurisdiction}/v1/{sector}/organization/org.hl7.fhir.r5/Provenance/_batch']).toBeDefined();
    expect(spec.paths['/{tenantId}/cds-{jurisdiction}/v1/{sector}/organization/org.hl7.fhir.r5/Provenance/_search']).toBeDefined();
    expect(spec.paths['/{tenantId}/cds-{jurisdiction}/v1/{sector}/organization/org.hl7.fhir.r5/ResearchStudy/_search']).toBeDefined();
    expect(spec.paths['/{tenantId}/cds-{jurisdiction}/v1/{sector}/organization/org.hl7.fhir.r5/ResearchStudy/_search-response']).toBeDefined();
    expect(spec.paths['/{tenantId}/cds-{jurisdiction}/v1/{sector}/organization/org.hl7.fhir.r5/Consent/_batch']).toBeDefined();
    expect(spec.paths['/{tenantId}/cds-{jurisdiction}/v1/{sector}/organization/org.hl7.fhir.r5/Consent/_batch-response']).toBeDefined();
    expect(spec.paths['/{tenantId}/cds-{jurisdiction}/v1/{sector}/organization/org.hl7.fhir.r5/Consent/_search']).toBeDefined();
    expect(spec.paths['/{tenantId}/cds-{jurisdiction}/v1/{sector}/organization/org.hl7.fhir.r5/Consent/_search-response']).toBeDefined();
    expect(spec.paths['/{tenantId}/cds-{jurisdiction}/v1/{sector}/organization/org.hl7.fhir.r5/Group/_batch']).toBeDefined();
    expect(spec.paths['/{tenantId}/cds-{jurisdiction}/v1/{sector}/organization/org.hl7.fhir.r5/Group/_batch-response']).toBeDefined();
    expect(spec.paths['/{tenantId}/cds-{jurisdiction}/v1/{sector}/organization/org.hl7.fhir.r5/Group/_search']).toBeDefined();
    expect(spec.paths['/{tenantId}/cds-{jurisdiction}/v1/{sector}/organization/org.hl7.fhir.r5/Group/_search-response']).toBeDefined();
    expect(spec.paths['/{tenantId}/cds-{jurisdiction}/v1/{sector}/identity/openid/smart/token']).toBeDefined();
    expect(spec.paths['/{tenantId}/cds-{jurisdiction}/v1/{sector}/identity/openid/smart/token-response']).toBeDefined();
    expect(spec.paths['/{tenantId}/cds-{jurisdiction}/v1/{sector}/identity/openid/Device/_dcr-response']).toBeDefined();
    expect(spec.paths['/{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.hl7.fhir.api/Subject/$summary']).toBeDefined();
    expect(spec.paths['/{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.hl7.fhir.api/Patient/$summary']).toBeDefined();
    expect(spec.paths['/{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.hl7.fhir.api/Patient/$match']).toBeDefined();
    expect(spec.paths['/{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.hl7.fhir.api/Patient/$match-response']).toBeDefined();
    expect(
      spec.paths['/{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.hl7.fhir.api/Patient/$match']
        ?.post?.description,
    ).toContain('must not send the derived alias');
    expect(
      spec.paths['/{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.hl7.fhir.api/Subject/$summary']
        ?.post?.description,
    ).toContain('internal operation reference');
    expect(
      spec.paths['/{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.hl7.fhir.api/Subject/$summary']
        ?.post?.description,
    ).toContain('requestClinicalSummary');
    expect(
      spec.paths['/{tenantId}/cds-{jurisdiction}/v1/{sector}/individual/org.hl7.fhir.api/Subject/$summary']
        ?.post?.['x-contract-level'],
    ).toBe('internal-compatibility');
    expect(spec.paths['/host/ping']).toBeDefined();
    expect(spec.paths['/host/cds-{hostCoverageScope}/{version}/{hostNetwork}/.well-known/ping']).toBeDefined();
    expect(spec.paths['/{tenantId}/cds-{jurisdiction}/{version}/{sector}/.well-known/ping']).toBeDefined();
    expect(spec.paths['/{tenantId}/cds-{jurisdiction}/{version}/{sector}/did.json']).toBeDefined();
    expect(spec.paths['/{tenantId}/cds-{jurisdiction}/{version}/{sector}/.well-known/did.json']).toBeDefined();
    expect(spec.paths['/{tenantId}/cds-{jurisdiction}/{version}/{sector}/.well-known/jwks.json']).toBeDefined();
    expect(spec.paths['/{tenantId}/cds-{jurisdiction}/{version}/{sector}/.well-known/openid-configuration']).toBeDefined();
    expect(spec.paths['/{tenantId}/cds-{jurisdiction}/{version}/{sector}/.well-known/smart-configuration']).toBeDefined();
    expect(spec.paths['/{tenantId}/cds-{jurisdiction}/{version}/{sector}/.well-known/service-offering-index.json']).toBeDefined();
    expect(spec.paths['/{tenantId}/cds-{jurisdiction}/{version}/{sector}/.well-known/service-offering-research.json']).toBeDefined();
    expect(spec.paths['/host/cds-{hostCoverageScope}/{version}/{hostNetwork}/.well-known/dspace-version']).toBeDefined();
    expect(spec.paths['/api/dataspace-discovery/providers']).toBeDefined();
    expect(spec.paths['/host/cds-{hostCoverageScope}/{version}/{hostNetwork}/dsp/catalog/dcat.json']).toBeDefined();
    expect(spec.paths['/{tenantId}/cds-{jurisdiction}/{version}/{sector}/.well-known/dspace-version']).toBeDefined();
    expect(spec.paths['/{tenantId}/cds-{jurisdiction}/{version}/{sector}/dsp/catalog/dcat.json']).toBeDefined();
    expect(spec.paths['/{tenantId}/cds-{jurisdiction}/{version}/{sector}/{section}/{format}/metadata']).toBeDefined();
    expect(spec.paths['/{tenantId}/cds-{jurisdiction}/{version}/{sector}/{section}/{format}/.well-known/smart-configuration']).toBeDefined();

    // Swagger tags are intentionally numbered progressively (1..N) for readability in Swagger UI,
    // even though API_INTEGRATORS_GUIDE uses its own section numbering (6..9).
    expect(Array.isArray(spec.tags)).toBe(true);
    const tagNames = (spec.tags || []).map((t: any) => t.name);
    expect(tagNames).toEqual(
      expect.arrayContaining([
        '1.1 Organization Registration',
        '1.2 Organization Order',
        '2.1.1 Frontend Identity Federation (Optional)',
        '2.1.4 License Issuance (Invite)',
        '2.1.2 Initial Access Token Exchange',
        '2.1.3 Device Registration (DCR)',
        '2.2 OIDC4VCI',
        '2.2 SMART Token',
        '3.1 Employee Role',
        '4.1 Family Registration',
        '4.2 Family Order',
        '5. Consent',
        '6. Communication',
        '7. Composition',
        '4.3 Family Member Relationship',
        '8.8 Research Study Administration',
        '9. Research Digital Twin',
      ]),
    );
    expect(spec['x-tagGroups']).toBeDefined();

    // Host onboarding uses a dedicated "network environment" sector enum.
    expect(spec.components?.parameters?.HostRegistrySector).toBeDefined();
    expect(spec.components?.parameters?.HostCoverageScope).toBeDefined();
    expect(spec.components?.parameters?.AppId).toBeDefined();
    expect(spec.components?.parameters?.AppVersion).toBeDefined();

    // Required examples for the onboarding journey. We treat example-payloads.ts as source of truth,
    // and Swagger generation must include them to stay aligned with API_INTEGRATORS_GUIDE.
    const exampleKeys = Object.keys(spec.components?.examples || {});
    expect(exampleKeys).toEqual(
      expect.arrayContaining([
        'OrganizationRegistrationPlaintextMessage',
        'OrganizationActivationPlaintextMessage',
        'OrganizationActivationResponseBundle',
        'OrganizationIssuePlaintextMessage',
        'OrganizationIssueResponseBundle',
        'OrganizationVerificationTransactionPlaintextMessage',
        'OrganizationVerificationTransactionResponseBundle',
        'OrganizationOrderPlaintextMessage',
        'InitialAccessTokenExchangePlaintextMessage',
        'InitialAccessTokenExchangeResponse',
        'FirebaseCustomTokenPlaintextMessage',
        'DeviceRegistrationPlaintextMessage',
        'DeviceRegistrationResponse',
        'SmartTokenRequestPlaintextMessage',
        'EmployeeRegistrationPlaintextMessage',
        'FamilyRegistrationPlaintextMessage',
        'FamilyOrderPlaintextMessage',
        'ConsentCreationPlaintextMessage',
        'CommunicationCreationPlaintextMessage',
        'CompositionUpdatePlaintextMessage',
        'ResearchCompositionIngestionPlaintextMessage',
        'FamilyMemberRelationshipPlaintextMessage',
        'AsyncPollRequest',
        'AsyncPollPending',
        'AsyncPollSecureResponse',
      ]),
    );
    for (const key of [
      'OrganizationRegistrationPlaintextMessage',
      'OrganizationActivationPlaintextMessage',
      'OrganizationActivationResponseBundle',
      'OrganizationIssuePlaintextMessage',
      'OrganizationIssueResponseBundle',
      'OrganizationVerificationTransactionPlaintextMessage',
      'OrganizationVerificationTransactionResponseBundle',
      'OrganizationOrderPlaintextMessage',
      'InitialAccessTokenExchangePlaintextMessage',
      'InitialAccessTokenExchangeResponse',
      'FirebaseCustomTokenPlaintextMessage',
      'DeviceRegistrationPlaintextMessage',
      'DeviceRegistrationResponse',
      'SmartTokenRequestPlaintextMessage',
      'EmployeeRegistrationPlaintextMessage',
      'FamilyRegistrationPlaintextMessage',
      'FamilyOrderPlaintextMessage',
      'ConsentCreationPlaintextMessage',
      'CommunicationCreationPlaintextMessage',
      'CompositionUpdatePlaintextMessage',
      'ResearchCompositionIngestionPlaintextMessage',
      'FamilyMemberRelationshipPlaintextMessage',
      'AsyncPollRequest',
      'AsyncPollPending',
      'AsyncPollSecureResponse',
    ]) {
      expect(spec.components.examples[key]?.value).toBeDefined();
      expect(Object.keys(spec.components.examples[key].value || {}).length).toBeGreaterThan(0);
    }

    expect(
      spec.paths['/host/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Organization/_activate']
        ?.post?.requestBody?.content?.['application/didcomm-plain+json']?.examples?.message?.$ref,
    ).toBe('#/components/examples/OrganizationActivationPlaintextMessage');
    expect(
      spec.paths['/host/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Organization/_issue']
        ?.post?.requestBody?.content?.['application/didcomm-plain+json']?.examples?.message?.$ref,
    ).toBe('#/components/examples/OrganizationIssuePlaintextMessage');
    expect(
      spec.paths['/host/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Organization/_issue-response']
        ?.post?.responses?.['200']?.content?.['application/json']?.examples?.message?.$ref,
    ).toBe('#/components/examples/OrganizationIssueResponseBundle');
    expect(
      spec.paths['/host/cds-{jurisdiction}/v1/{sector}/registry/org.schema/Organization/_activate-response']
        ?.post?.responses?.['200']?.content?.['application/json']?.examples?.message?.$ref,
    ).toBe('#/components/examples/OrganizationActivationResponseBundle');
    expect(
      spec.paths['/{tenantId}/cds-{jurisdiction}/v1/{sector}/identity/openid/Token/_exchange-response']
        ?.post?.responses?.['200']?.content?.['application/json']?.examples?.message?.$ref,
    ).toBe('#/components/examples/InitialAccessTokenExchangeResponse');
    expect(
      spec.paths['/{tenantId}/cds-{jurisdiction}/v1/{sector}/identity/openid/Device/_dcr-response']
        ?.post?.responses?.['200']?.content?.['application/json']?.examples?.message?.$ref,
    ).toBe('#/components/examples/DeviceRegistrationResponse');

    const familyClaims =
      spec.components.examples.FamilyRegistrationPlaintextMessage?.value?.body?.data?.[0]?.resource?.meta?.claims;
    const familyAttachmentData =
      spec.components.examples.FamilyRegistrationPlaintextMessage?.value?.attachments?.[0]?.data;
    const familyInlineAttachmentData =
      spec.components.examples.FamilyRegistrationPlaintextMessageInlineBase64?.value?.attachments?.[0]?.data;
    const organizationClaims =
      spec.components.examples.OrganizationRegistrationPlaintextMessage?.value?.body?.data?.[0]?.resource?.meta?.claims;
    const verificationTransactionClaims =
      spec.components.examples.OrganizationVerificationTransactionPlaintextMessage?.value?.body?.data?.[0]?.resource?.meta?.claims;
    expect(organizationClaims).toBeDefined();
    expect(organizationClaims['org.schema.Organization.identifier.value']).toBe('acme-id');
    expect(organizationClaims['org.schema.Organization.alternateName']).toBeUndefined();
    expect(verificationTransactionClaims).toBeDefined();
    expect(verificationTransactionClaims['org.schema.Service.serviceType']).toBe(
      testClaimsRegisterTenantExpanded['org.schema.Service.serviceType'],
    );

    expect(familyClaims).toBeDefined();
    expect(familyClaims['Service.termsOfService']).toBe('https://provider.example.com/terms.pdf');
    expect(familyAttachmentData).toEqual({ links: ['{{signedIndividualFormPdfUrl}}'] });
    expect(familyInlineAttachmentData).toEqual({ base64: '{{signedIndividualFormPdfBase64}}' });
    expect(familyClaims['org.schema.Service.termsOfService']).toBeUndefined();
    expect(familyClaims['Organization.identifier.value']).toBeDefined();
    expect(familyClaims['org.schema.Organization.identifier.value']).toBeUndefined();
    expect(familyClaims['Organization.owner.identifier.value']).toBe('<cert-serialnumber>');
    expect(familyClaims['Organization.owner.identifier.value']).not.toBe('adult1@example.com');

    const communicationAttachment =
      spec.components.examples.CommunicationCreationPlaintextMessage?.value?.body?.entry?.[0]?.resource?.payload?.[0]?.contentAttachment;
    const communicationBundle = communicationAttachment
      ? JSON.parse(Buffer.from(communicationAttachment.data, 'base64').toString('utf8'))
      : undefined;
    expect(communicationBundle?.resourceType).toBe('Bundle');
    expect(communicationBundle?.type).toBe('document');
    expect(communicationBundle?.entry?.[0]?.resource?.resourceType).toBe('Composition');
  });
});
