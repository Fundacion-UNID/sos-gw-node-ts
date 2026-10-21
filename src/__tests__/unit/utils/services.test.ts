// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
// Tenant DID services advertise only the canonical resource/action surfaces enabled for their sector and capability claims.
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// Always create JSDoc, do not use strings inline in keys nor values, use types instead, and reuse the data test examples.

import { hasProviderServiceCapabilityClaim, initializeHostServicesConfig, initializeTenantServicesConfig } from '../../../utils/services';
import { OrganizationConfig } from '../../../gdc-backend-utils-node/models/entity';
import { Sector } from 'gdc-common-utils-ts/models/urlPath';
import { IServerConfig } from '../../../config';
import { DidService } from 'gdc-common-utils-ts/models/did';
import { DidServiceIds, DidServiceTypes } from 'gdc-common-utils-ts/constants/did-services';
import { buildGwCatalogRequestPath } from 'gdc-common-utils-ts/utils/dataspace-protocol';
import {
  ServiceCapability,
  serializeServiceCapabilityTokens,
} from 'gdc-common-utils-ts/constants/service-capabilities';
import { EntityLifecycleStatus, EntityType } from '../../../gdc-backend-utils-node/models/enums';
import { SERVICE_ADDITIONAL_TYPE_CLAIM } from '../../../utils/service-capability-claims';
import { ContinuityServiceCapability } from 'sos-data-utils-ts/continuity-service-capabilities';
import { SUBJECT_SECTION_INDIVIDUAL } from '../../../constants/domain';

// Create a mock config object for the tests.
const mockConfig: IServerConfig = {
  hostExternalDomain: 'host.example.com',
} as IServerConfig; // Cast to avoid filling out all properties

// Helper factory function to create tenant configurations for tests, reducing repetition.
const createTestTenantConfig = (
  sector: Sector,
  didId: string,
  sectorsAllowed: Sector[] = []
): OrganizationConfig => {
  const result: OrganizationConfig = {
    id: 'urn:uuid:tenant-uuid',
    type: EntityType.Organization,
    status: EntityLifecycleStatus.Active,
    networkStatus: [],
    meta: { lastUpdated: '' },
    claims: {
      alternateName: 'acme',
      legalName: 'ACME Inc.',
      addressCountry: 'ES',
      url: 'https://acme.com',
    },
    didConfig: { service: [] },
    didDocument: {
      '@context': 'https://www.w3.org/ns/did/v1',
      id: didId,
      service: [],
    },
    provider: {
      service: {
        sectorCategory: sector,
        sectorsAllowed: sectorsAllowed,
      }
    }
  };
  return result;
};

describe('Service Initialization Utilities', () => {

  describe('initializeTenantServicesConfig', () => {
    it('advertises organization Communication batches for veterinary appointment messaging', () => {
      const services = initializeTenantServicesConfig('animal-care' as Sector);

      const communicationService = services.find((service: DidService) =>
        service.selector?.section === 'organization'
        && service.selector?.format === 'org.hl7.fhir.api'
        && service.serviceEndpoint.split(',').includes('Communication')
        && service.actions?.includes('_batch'));

      expect(communicationService).toBeDefined();
    });
    
    it('should create default entity and individual services for a non-FHIR tenant', () => {
      // ARRANGE
      const tenantConfig = createTestTenantConfig(Sector.RESEARCH, `did:web:${mockConfig.hostExternalDomain}:acme`);

      // ACT
      const services = initializeTenantServicesConfig(tenantConfig.provider!.service.sectorCategory as Sector);

      // ASSERT
      expect(services.length).toBeGreaterThanOrEqual(16);

      const entityService = services.find((s: DidService) => s.id.includes('entity'));
      expect(entityService).toBeDefined();
      expect(entityService!.serviceEndpoint).toContain('Employee');
      expect(entityService!.serviceEndpoint).not.toContain('Practitioner');

      const professionalSeatOfferService = services.find(
        (service: DidService) =>
          (service as any).selector?.section === 'entity'
          && (service as any).selector?.format === 'org.schema'
          && service.serviceEndpoint === 'Offer'
          && service.actions?.includes('_create'),
      );
      expect(professionalSeatOfferService).toBeDefined();

      const individualService = services.find((s: DidService) => s.id.includes('individual'));
      expect(individualService).toBeDefined();
      expect(individualService!.serviceEndpoint).toContain('Person');
      expect(individualService!.serviceEndpoint).not.toContain('Patient');

      const digitalTwinService = services.find(
        (s: DidService) =>
          (s as any).selector?.section === 'digitaltwin' &&
          (s as any).selector?.format === 'org.hl7.fhir.api' &&
          s.serviceEndpoint === 'Communication' &&
          s.actions?.includes('_batch'),
      );
      expect(digitalTwinService).toBeDefined();
      expect(digitalTwinService!.serviceEndpoint).toBe('Communication');

      // Communication ingests; ResearchSubject is the public aggregate and its
      // embedded canonical Composition joins the projected resources.
      const digitalTwinResearchSubjectSearch = services.find(
        (s: DidService) =>
          (s as any).selector?.section === 'digitaltwin' &&
          (s as any).selector?.format === 'org.hl7.fhir.api' &&
          s.serviceEndpoint === 'ResearchSubject' &&
          s.actions?.includes('_search'),
      );
      expect(digitalTwinResearchSubjectSearch).toBeDefined();

      const digitalTwinR4Service = services.find(
        (s: DidService) =>
          (s as any).selector?.section === 'digitaltwin' &&
          (s as any).selector?.format === 'org.hl7.fhir.r4',
      );
      expect(digitalTwinR4Service).toBeDefined();
      expect(digitalTwinR4Service!.serviceEndpoint).toContain('ResearchSubject');

      const messagingService = services.find(
        (s: DidService) =>
          (s as any).selector?.section === 'messaging' &&
          (s as any).selector?.format === 'post-quantum',
      );
      expect(messagingService).toBeDefined();
      expect(messagingService!.serviceEndpoint).toContain('didcomm-plaintext');

      const dataService = services.find((s: DidService) => s.type === 'DataService');
      const catalogService = services.find((s: DidService) => s.type === 'CatalogService');
      const issuerService = services.find((s: DidService) => s.type === 'IssuerService');
      expect(dataService).toBeDefined();
      expect(catalogService).toBeDefined();
      expect(issuerService).toBeDefined();
    });

    it('should ADD FHIR resources for a FHIR-enabled tenant', () => {
      // ARRANGE
      const tenantConfig = createTestTenantConfig(Sector.HEALTH_CARE, `did:web:${mockConfig.hostExternalDomain}:acme`);

      // ACT
      const services = initializeTenantServicesConfig(tenantConfig.provider!.service.sectorCategory as Sector);
      
      // ASSERT
      expect(services.length).toBeGreaterThanOrEqual(16);

      const entityService = services.find((s: DidService) => s.id.includes('entity'));
      expect(entityService).toBeDefined();
      expect(entityService!.serviceEndpoint).toContain('Employee');
      expect(entityService!.serviceEndpoint).toContain('Practitioner');

      const individualService = services.find((s: DidService) => s.id.includes('individual'));
      expect(individualService).toBeDefined();
      expect(individualService!.serviceEndpoint).toContain('Person');
      expect(individualService!.serviceEndpoint).toContain('Patient');

      const antifraudHashedClaimsService = services.find(
        (service: DidService) =>
          service.selector?.section === 'individual'
          && service.selector?.format === 'org.schema'
          && service.actions?.includes('$hashed-claims-issue'),
      );
      expect(antifraudHashedClaimsService?.serviceEndpoint.split(',')).toEqual(['Person', 'Animal']);

      const individualTransactionService = services.find(
        (s: DidService) =>
          (s as any).selector?.section === 'individual' &&
          (s as any).selector?.format === 'org.schema' &&
          s.serviceEndpoint === 'Organization' &&
          (s.actions || []).includes('_transaction'),
      );
      expect(individualTransactionService).toBeDefined();
      expect(individualTransactionService?.actions).toContain('_disable');
      expect(individualTransactionService?.actions).toContain('_purge');

      // Scanned-card activation is a separate, explicit License action. It
      // does not broaden Organization or clinical Communication capabilities.
      const individualLicenseService = services.find(
        (s: DidService) =>
          (s as any).selector?.section === 'individual' &&
          (s as any).selector?.format === 'org.schema' &&
          s.serviceEndpoint === 'License',
      );
      expect(individualLicenseService?.actions).toContain('_claim');

      const employeePurgeService = services.find(
        (s: DidService) =>
          (s as any).selector?.section === 'entity' &&
          (s as any).selector?.format === 'org.schema' &&
          s.serviceEndpoint === 'Employee' &&
          (s.actions || []).includes('_purge'),
      );
      expect(employeePurgeService).toBeDefined();

      const employeeSearchService = services.find(
        (s: DidService) =>
          (s as any).selector?.section === 'entity' &&
          (s as any).selector?.format === 'org.schema' &&
          s.serviceEndpoint === 'Employee' &&
          (s.actions || []).includes('_search'),
      );
      expect(employeeSearchService).toBeDefined();

      const employeeLicenseSearchService = services.find(
        (s: DidService) =>
          (s as any).selector?.section === 'entity' &&
          (s as any).selector?.format === 'org.schema' &&
          s.serviceEndpoint === 'License' &&
          (s.actions || []).includes('_search'),
      );
      expect(employeeLicenseSearchService).toBeDefined();

      const organizationCommercialSearchService = services.find(
        (s: DidService) =>
          (s as any).selector?.section === 'entity' &&
          (s as any).selector?.format === 'org.schema' &&
          s.serviceEndpoint === 'Offer,Order' &&
          (s.actions || []).includes('_search'),
      );
      expect(organizationCommercialSearchService).toBeDefined();

      const fhirR4Service = services.find(
        (s: DidService) =>
          (s as any).selector?.section === 'individual' &&
          (s as any).selector?.format === 'org.hl7.fhir.r4',
      );
      expect(fhirR4Service).toBeDefined();
      expect(fhirR4Service!.serviceEndpoint).toContain('DocumentReference');
      expect(fhirR4Service!.serviceEndpoint).toContain('Observation');

      const fhirApiService = services.find(
        (s: DidService) =>
          (s as any).selector?.section === 'individual' &&
          (s as any).selector?.format === 'org.hl7.fhir.api',
      );
      expect(fhirApiService).toBeDefined();
      expect(fhirApiService!.serviceEndpoint).toContain('Consent');
      expect(fhirApiService!.serviceEndpoint).toContain('DocumentReference');

      const organizationHealthcareService = services.find(
        (service: DidService) =>
          service.selector?.section === 'organization' &&
          service.selector?.format === 'org.hl7.fhir.r5' &&
          service.serviceEndpoint.split(',').includes('HealthcareService') &&
          (service.actions || []).includes('_batch') &&
          (service.actions || []).includes('_search'),
      );
      expect(organizationHealthcareService).toBeDefined();

      const subjectSearchService = services.find(
        (s: DidService) =>
          (s as any).selector?.section === 'individual' &&
          (s as any).selector?.format === 'org.hl7.fhir.api' &&
          s.serviceEndpoint === 'Subject' &&
          (s.actions || []).includes('_search'),
      );
      expect(subjectSearchService).toBeDefined();

      const patientMatchService = services.find(
        (s: DidService) =>
          (s as any).selector?.section === 'individual' &&
          (s as any).selector?.format === 'org.hl7.fhir.api' &&
          s.serviceEndpoint === 'Patient' &&
          (s.actions || []).includes('$match'),
      );
      expect(patientMatchService).toBeDefined();

      const digitalTwinResearchSubjectSearchService = services.find(
        (s: DidService) =>
          (s as any).selector?.section === 'digitaltwin' &&
          (s as any).selector?.format === 'org.hl7.fhir.r4' &&
          s.serviceEndpoint === 'ResearchSubject' &&
          (s.actions || []).includes('_search'),
      );
      expect(digitalTwinResearchSubjectSearchService).toBeDefined();

      const individualPdfDraftService = services.find(
        (s: DidService) =>
          (s as any).selector?.section === 'individual' &&
          (s as any).selector?.format === 'pdf' &&
          s.serviceEndpoint === 'DocumentReference' &&
          (s.actions || []).includes('_create'),
      );
      expect(individualPdfDraftService).toBeDefined();

      const individualCommercialSearchService = services.find(
        (s: DidService) =>
          (s as any).selector?.section === 'individual' &&
          (s as any).selector?.format === 'org.schema' &&
          s.serviceEndpoint === 'Offer,Order' &&
          (s.actions || []).includes('_search'),
      );
      expect(individualCommercialSearchService).toBeDefined();

      const digitalTwinWorkingSelectionService = services.find(
        (s: DidService) =>
          (s as any).selector?.section === 'digitaltwin' &&
          (s as any).selector?.format === 'org.hl7.fhir.r4' &&
          s.serviceEndpoint === 'Composition' &&
          (s.actions || []).includes('_batch'),
      );
      expect(digitalTwinWorkingSelectionService).toBeDefined();
    });

    it('should treat synthetic animal-tech as FHIR-enabled', () => {
      const services = initializeTenantServicesConfig('animal-tech' as Sector);

      expect(services.length).toBeGreaterThanOrEqual(16);

      const individualService = services.find((s: DidService) => s.id.includes('individual'));
      expect(individualService).toBeDefined();
      expect(individualService!.serviceEndpoint).toContain('Patient');

      const fhirR4Service = services.find(
        (s: DidService) =>
          (s as any).selector?.section === 'individual' &&
          (s as any).selector?.format === 'org.hl7.fhir.r4',
      );
      expect(fhirR4Service).toBeDefined();
    });

    it('should expose digital twin ingestion for synthetic animal-research', () => {
      const services = initializeTenantServicesConfig('animal-research' as Sector);

      const researchStudyService = services.find(
        (service: DidService) =>
          service.selector?.section === 'organization'
          && service.selector?.format === 'org.hl7.fhir.r5'
          && service.serviceEndpoint === 'ResearchStudy',
      );
      expect(researchStudyService?.actions).toEqual(['_batch', '_search']);

      const provenanceService = services.find(
        (service: DidService) =>
          service.selector?.section === 'organization'
          && service.selector?.format === 'org.hl7.fhir.r5'
          && service.serviceEndpoint === 'Provenance',
      );
      expect(provenanceService?.actions).toEqual(['_batch', '_search']);

      const researchConsentService = services.find(
        (service: DidService) =>
          service.selector?.section === 'organization'
          && service.selector?.format === 'org.hl7.fhir.r5'
          && service.serviceEndpoint === 'Consent',
      );
      expect(researchConsentService?.actions).toEqual(['_batch', '_search']);

      const researchGroupService = services.find(
        (service: DidService) =>
          service.selector?.section === 'organization'
          && service.selector?.format === 'org.hl7.fhir.r5'
          && service.serviceEndpoint === 'Group',
      );
      expect(researchGroupService?.actions).toEqual(['_batch', '_search']);

      const digitalTwinService = services.find(
        (s: DidService) =>
          (s as any).selector?.section === 'digitaltwin' &&
          (s as any).selector?.format === 'org.hl7.fhir.api' &&
          s.serviceEndpoint === 'Communication' &&
          s.actions?.includes('_batch'),
      );

      expect(digitalTwinService).toBeDefined();
      expect(digitalTwinService!.serviceEndpoint).toBe('Communication');
      expect(digitalTwinService!.actions).toEqual(['_batch']);

      const legacyCompositionBatch = services.find(
        (s: DidService) =>
          (s as any).selector?.section === 'digitaltwin' &&
          (s as any).selector?.format === 'org.hl7.fhir.api' &&
          s.serviceEndpoint === 'Composition' &&
          s.actions?.includes('_batch'),
      );
      expect(legacyCompositionBatch).toBeDefined();

      const digitalTwinR4Service = services.find(
        (s: DidService) =>
          (s as any).selector?.section === 'digitaltwin' &&
          (s as any).selector?.format === 'org.hl7.fhir.r4' &&
          s.serviceEndpoint === 'Communication' &&
          s.actions?.includes('_batch'),
      );
      expect(digitalTwinR4Service).toBeDefined();
      expect(digitalTwinR4Service!.serviceEndpoint).toBe('Communication');
      expect(digitalTwinR4Service!.actions).toEqual(['_batch']);

      const legacyCompositionR4Batch = services.find(
        (s: DidService) =>
          (s as any).selector?.section === 'digitaltwin' &&
          (s as any).selector?.format === 'org.hl7.fhir.r4' &&
          s.serviceEndpoint === 'Composition' &&
          s.actions?.includes('_batch'),
      );
      expect(legacyCompositionR4Batch).toBeDefined();

      const digitalTwinMedicationSearchService = services.find(
        (s: DidService) =>
          (s as any).selector?.section === 'digitaltwin' &&
          (s as any).selector?.format === 'org.hl7.fhir.api' &&
          s.actions?.includes('_search') &&
          String(s.serviceEndpoint || '').includes('MedicationStatement'),
      );
      expect(digitalTwinMedicationSearchService).toBeUndefined();

      const digitalTwinResearchSubjectSearchService = services.find(
        (s: DidService) =>
          (s as any).selector?.section === 'digitaltwin' &&
          (s as any).selector?.format === 'org.hl7.fhir.api' &&
          s.actions?.includes('_search') &&
          String(s.serviceEndpoint || '') === 'ResearchSubject',
      );
      expect(digitalTwinResearchSubjectSearchService).toBeDefined();

      const digitalTwinResearchSubjectR4SearchService = services.find(
        (s: DidService) =>
          (s as any).selector?.section === 'digitaltwin' &&
          (s as any).selector?.format === 'org.hl7.fhir.r4' &&
          s.actions?.includes('_search') &&
          String(s.serviceEndpoint || '') === 'ResearchSubject',
      );
      expect(digitalTwinResearchSubjectR4SearchService).toBeDefined();
    });

    it('should filter tenant discovery endpoints to indexing-only capabilities when serviceType excludes digital twin', () => {
      const services = initializeTenantServicesConfig(
        Sector.RESEARCH,
        [],
        serializeServiceCapabilityTokens([ServiceCapability.IndexReader]),
      );

      expect(services.some(
        (s: DidService) => (s as any).selector?.section === 'entity',
      )).toBe(true);
      expect(services.some(
        (s: DidService) => (s as any).selector?.section === 'individual',
      )).toBe(true);
      expect(services.some(
        (s: DidService) => (s as any).selector?.section === 'digitaltwin',
      )).toBe(false);
    });

    it('should filter tenant discovery endpoints to digital twin-only capabilities when serviceType excludes indexing', () => {
      const services = initializeTenantServicesConfig(
        Sector.RESEARCH,
        [],
        serializeServiceCapabilityTokens([ServiceCapability.DigitalTwinReader]),
      );

      expect(services.some(
        (s: DidService) => (s as any).selector?.section === 'entity',
      )).toBe(false);
      expect(services.some(
        (s: DidService) => (s as any).selector?.section === 'individual',
      )).toBe(false);
      expect(services.some(
        (s: DidService) => (s as any).selector?.section === 'digitaltwin',
      )).toBe(true);
    });

    it('should read tenant discovery capabilities from additionalType during migration', () => {
      const services = initializeTenantServicesConfig(
        Sector.RESEARCH,
        [],
        undefined,
        serializeServiceCapabilityTokens([ServiceCapability.IndexReader]),
      );

      expect(SERVICE_ADDITIONAL_TYPE_CLAIM).toBeDefined();
      expect(services.some(
        (s: DidService) => (s as any).selector?.section === 'entity',
      )).toBe(true);
      expect(services.some(
        (s: DidService) => (s as any).selector?.section === 'individual',
      )).toBe(true);
      expect(services.some(
        (s: DidService) => (s as any).selector?.section === 'digitaltwin',
      )).toBe(false);
    });

    it('should ignore ActReason values stored in Service.additionalType when resolving provider capability flags', () => {
      expect(hasProviderServiceCapabilityClaim(
        undefined,
        'http://terminology.hl7.org/CodeSystem/v3-ActReason|METAMGT,HRESCH',
      )).toBe(false);
    });

    it('should expose only personal-backup resources for a personal-backup provider', () => {
      const services = initializeTenantServicesConfig(
        Sector.HEALTH_CARE,
        [],
        ContinuityServiceCapability.DocumentBackupProvider,
      );

      expect(hasProviderServiceCapabilityClaim(
        ContinuityServiceCapability.DocumentBackupProvider,
      )).toBe(true);
      expect(services.some(
        (service: DidService) => service.serviceEndpoint.split(',').includes('DocumentReference'),
      )).toBe(true);
      expect(services.some(
        (service: DidService) => service.serviceEndpoint.split(',').includes('Composition'),
      )).toBe(false);
      expect(services.some(
        (service: DidService) => service.serviceEndpoint.split(',').includes('ResearchSubject'),
      )).toBe(false);
      expect(services
        .filter((service: DidService) => service.selector?.section === SUBJECT_SECTION_INDIVIDUAL)
        .flatMap((service: DidService) => service.serviceEndpoint.split(',')))
        .toEqual(expect.arrayContaining(['DocumentReference']));
    });

    it('should not include standard discovery endpoints', () => {
      // ARRANGE
      const tenantConfig = createTestTenantConfig(Sector.RESEARCH, 'did:web:acme.com');

      // ACT
      const services = initializeTenantServicesConfig(tenantConfig.provider!.service.sectorCategory as Sector);

      // ASSERT
      const didDocService = services.find((s: DidService) => s.id.endsWith('#did-document'));
      expect(didDocService).toBeUndefined();

      const jwksService = services.find((s: DidService) => s.id.endsWith('#jwks'));
      expect(jwksService).toBeUndefined();
    });
  });

  describe('initializeHostServicesConfig', () => {
    it('should create a single registry service for the host (network env sector) and identity services per business sector', () => {
      // ARRANGE
      const hostConfig = createTestTenantConfig(Sector.SYSTEM, `did:web:${mockConfig.hostExternalDomain}`, [Sector.RESEARCH, Sector.HEALTH_CARE]);
      if (hostConfig.claims) {
        (hostConfig.claims as any).alternateName = 'host'; // Override for host specific test
      }

      // ACT
      const services = initializeHostServicesConfig(hostConfig.provider!.service.sectorsAllowed as Sector[], 'test');

      // ASSERT
      const registryServices = services.filter((s: DidService) => (s as any).selector?.section === 'registry');
      expect(registryServices).toHaveLength(3);
      const organizationRegistry = registryServices.find((s: DidService) => s.serviceEndpoint === 'Organization');
      const orderRegistry = registryServices.find((s: DidService) => s.serviceEndpoint === 'Order');
      const offerRegistry = registryServices.find((s: DidService) => s.serviceEndpoint === 'Offer');
      expect((organizationRegistry as any)?.selector?.sector).toBe('test');
      expect(organizationRegistry?.actions).toEqual(['_batch', '_transaction', '_issue', '_activate', '_search', '_status', '_disable', '_enable', '_purge']);
      expect(orderRegistry?.actions).toEqual(['_batch', '_search']);
      expect(offerRegistry?.actions).toEqual(['_search']);

      const identityServices = services.filter((s: DidService) => (s as any).selector?.section === 'identity');
      expect(identityServices).toHaveLength(4); // (research + health-care) × (firebase + openid)
    });

    it('should allow explicit NETWORK_MODE override independently of NODE_ENV', () => {
      const hostConfig = createTestTenantConfig(Sector.SYSTEM, 'did:web:host.example.com', [Sector.RESEARCH]);
      const services = initializeHostServicesConfig(
        hostConfig.provider!.service.sectorsAllowed as Sector[],
        'production',
        'test-network',
      );

      const registryServices = services.filter((s: DidService) => (s as any).selector?.section === 'registry');
      expect(registryServices).toHaveLength(3);
      expect((registryServices[0] as any).selector?.sector).toBe('test-network');
      expect((registryServices[1] as any).selector?.sector).toBe('test-network');
      expect((registryServices[2] as any).selector?.sector).toBe('test-network');
    });

    it('should publish the host catalog service at the host DSP catalog endpoint template', () => {
      const services = initializeHostServicesConfig([Sector.RESEARCH], 'test');

      const catalogService = services.find((service: DidService) => service.id === DidServiceIds.Catalog);

      expect(catalogService).toBeDefined();
      expect(catalogService?.type).toBe(DidServiceTypes.CatalogService);
      expect(catalogService?.serviceEndpoint).toBe(buildGwCatalogRequestPath({
        participantId: 'host',
        jurisdiction: '{hostCoverageScope}',
        version: 'v1',
        hostNetwork: '{hostNetwork}',
      }));
    });
  });
});
