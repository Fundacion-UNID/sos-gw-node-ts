// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/__tests__/unit/utils/dataspace.did-services.compliance.test.ts

import { Sector } from 'gdc-common-utils-ts/models/urlPath';
import { DidServiceIds, DidServiceTypes } from 'gdc-common-utils-ts/constants/did-services';
import {
  buildGwCatalogRequestPath,
  buildGwDspaceVersionWellKnownPath,
} from 'gdc-common-utils-ts/utils/dataspace-protocol';
import { populateDidDocumentServices } from '../../../utils/did-document';
import { initializeHostServicesConfig, initializeTenantServicesConfig } from '../../../utils/services';

describe('Dataspace DID Service Compliance (DSP/DCP)', () => {
  it('publishes DSP and DCP discovery services in tenant DID document', () => {
    const did = 'did:web:gateway.example.com:acme:cds-es:v1:health-care';
    const baseUrl = 'https://gateway.example.com';
    const businessConfig = initializeTenantServicesConfig(Sector.HEALTH_CARE);
    const tenantContext = { alternateName: 'acme', jurisdiction: 'es', version: 'v1', sector: Sector.HEALTH_CARE };

    const services = populateDidDocumentServices(did, baseUrl, businessConfig, true, tenantContext);

    const dataService = services.find((s) => s.id === `${did}#dsp-data-service`);
    expect(dataService).toBeDefined();
    expect(dataService?.type).toBe('DataService');
    expect(dataService?.serviceEndpoint).toBe(`https://gateway.example.com${buildGwDspaceVersionWellKnownPath({
      tenantId: 'acme',
      jurisdiction: 'es',
      version: 'v1',
      sector: 'health-care',
    })}`);

    const catalogService = services.find((s) => s.id === `${did}#dsp-catalog-service`);
    expect(catalogService).toBeDefined();
    expect(catalogService?.type).toBe('CatalogService');
    expect(catalogService?.serviceEndpoint).toBe(`https://gateway.example.com${buildGwCatalogRequestPath({
      tenantId: 'acme',
      jurisdiction: 'es',
      version: 'v1',
      sector: 'health-care',
    })}`);

    const issuerService = services.find((s) => s.id === `${did}#dcp-issuer-service`);
    expect(issuerService).toBeDefined();
    expect(issuerService?.type).toBe('IssuerService');
    expect(issuerService?.serviceEndpoint).toBe('https://gateway.example.com/acme/cds-es/v1/health-care/presentations/query');
  });

  it('publishes the host catalog service as the operational DSP catalog endpoint', () => {
    const did = 'did:web:gateway.example.com';
    const baseUrl = 'https://gateway.example.com';
    const businessConfig = initializeHostServicesConfig([Sector.HEALTH_CARE], 'test');

    const services = populateDidDocumentServices(
      did,
      baseUrl,
      businessConfig,
      false,
      { alternateName: 'host', jurisdiction: 'es', version: 'v1', sector: Sector.HEALTH_CARE },
    );

    const catalogService = services.find((service) => service.id === `${did}${DidServiceIds.Catalog}`);
    expect(catalogService).toBeDefined();
    expect(catalogService?.type).toBe(DidServiceTypes.CatalogService);
    expect(catalogService?.serviceEndpoint).toBe(`https://gateway.example.com${buildGwCatalogRequestPath({
      participantId: 'host',
      jurisdiction: '{hostCoverageScope}',
      version: 'v1',
      hostNetwork: '{hostNetwork}',
    })}`);
  });
});
