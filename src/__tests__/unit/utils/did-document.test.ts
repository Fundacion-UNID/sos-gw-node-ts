// src/__tests__/unit/utils/did-document.test.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { populateDidDocumentServices } from '../../../utils/did-document';
import { Sector } from 'gdc-common-utils-ts/models/urlPath';
import { initializeTenantServicesConfig } from '../../../utils/services';

describe('populateDidDocumentServices', () => {

  it('should correctly multiplex services for a HOSTED tenant', () => {
    // --- Arrange ---
    const did = 'did:web:gateway.com:acme:cds-es:v1:health-care';
    const baseUrl = 'https://gateway.com';
    const businessConfig = initializeTenantServicesConfig(Sector.HEALTH_CARE);
    const tenantContext = { alternateName: 'acme', jurisdiction: 'es', version: 'v1', sector: Sector.HEALTH_CARE };

    // --- Act ---
    const allServices = populateDidDocumentServices(did, baseUrl, businessConfig, true, tenantContext);

    // --- Assert ---
    // Multiplexing check: ensure core endpoints exist (service count evolves as new endpoints are added).
    expect(allServices.length).toBeGreaterThanOrEqual(26);

    const wellKnownService = allServices.find(s => s.id === `${did}#jwks`);
    expect(wellKnownService).toBeDefined();
    expect(wellKnownService!.serviceEndpoint).toBe('https://gateway.com/acme/cds-es/v1/health-care/jwks.json');

    const employeeService = allServices.find(s => s.id.endsWith('#entity:org.schema:employee:_batch'));
    expect(employeeService).toBeDefined();
    expect(employeeService!.serviceEndpoint).toBe('https://gateway.com/acme/cds-es/v1/health-care/entity/org.schema/Employee/_batch');

    const licenseIssueService = allServices.find(s => s.id.endsWith('#identity:openid:license:_issue'));
    expect(licenseIssueService).toBeDefined();
  });

  it('should correctly multiplex services for an OWN-DOMAIN tenant', () => {
    // --- Arrange ---
    const did = 'did:web:api.acme-health.com';
    const baseUrl = 'https://api.acme-health.com';
    const businessConfig = initializeTenantServicesConfig(Sector.HEALTH_CARE);
    const tenantContext = {} as any;

    // --- Act ---
    const allServices = populateDidDocumentServices(did, baseUrl, businessConfig, false, tenantContext);

    // --- Assert ---
    expect(allServices.length).toBeGreaterThanOrEqual(26);

    const wellKnownService = allServices.find(s => s.id === `${did}#jwks`);
    expect(wellKnownService).toBeDefined();
    expect(wellKnownService!.serviceEndpoint).toBe('https://api.acme-health.com/jwks.json');

    const employeeService = allServices.find(s => s.id.endsWith('#entity:org.schema:employee:_batch'));
    expect(employeeService).toBeDefined();
    expect(employeeService!.serviceEndpoint).toBe('https://api.acme-health.com/entity/org.schema/Employee/_batch');

    const licenseIssueService = allServices.find(s => s.id.endsWith('#identity:openid:license:_issue'));
    expect(licenseIssueService).toBeDefined();
  });

  it('should keep public well-known urls separate from operational service endpoints', () => {
    const did = 'did:web:public.acme-health.com';
    const publicBaseUrl = 'https://public.acme-health.com';
    const operationalBaseUrl = 'https://operator.gateway.net';
    const businessConfig = initializeTenantServicesConfig(Sector.HEALTH_CARE);
    const tenantContext = { alternateName: 'acme', jurisdiction: 'es', version: 'v1', sector: Sector.HEALTH_CARE };

    const allServices = populateDidDocumentServices(
      did,
      publicBaseUrl,
      businessConfig,
      true,
      tenantContext,
      operationalBaseUrl,
    );

    const jwksService = allServices.find(s => s.id === `${did}#jwks`);
    expect(jwksService?.serviceEndpoint).toBe('https://public.acme-health.com/acme/cds-es/v1/health-care/jwks.json');

    const smartTokenService = allServices.find(s => s.id.endsWith('#identity:openid:smart:token'));
    expect(smartTokenService?.serviceEndpoint).toBe(
      'https://operator.gateway.net/acme/cds-es/v1/health-care/identity/openid/smart/token',
    );
  });

  it('should not duplicate the hosted tenant context when operationalBaseUrl already includes it', () => {
    const did = 'did:web:gateway.com:acme:cds-es:v1:health-care';
    const publicBaseUrl = 'https://gateway.com';
    const operationalBaseUrl = 'https://34.175.78.233/acme/cds-es/v1/health-care';
    const businessConfig = initializeTenantServicesConfig(Sector.HEALTH_CARE);
    const tenantContext = { alternateName: 'acme', jurisdiction: 'es', version: 'v1', sector: Sector.HEALTH_CARE };

    const allServices = populateDidDocumentServices(
      did,
      publicBaseUrl,
      businessConfig,
      true,
      tenantContext,
      operationalBaseUrl,
    );

    const smartTokenService = allServices.find(s => s.id.endsWith('#identity:openid:smart:token'));
    expect(smartTokenService?.serviceEndpoint).toBe(
      'https://34.175.78.233/acme/cds-es/v1/health-care/identity/openid/smart/token',
    );
  });

  it('should not duplicate the hosted tenant context when the existing path casing differs', () => {
    const did = 'did:web:34.175.78.233:acme-id:cds-ES:v1:health-care';
    const publicBaseUrl = 'http://34.175.78.233';
    const operationalBaseUrl = 'https://34.175.78.233/acme-id/cds-es/v1/health-care';
    const businessConfig = initializeTenantServicesConfig(Sector.HEALTH_CARE);
    const tenantContext = { alternateName: 'acme-id', jurisdiction: 'ES', version: 'v1', sector: Sector.HEALTH_CARE };

    const allServices = populateDidDocumentServices(
      did,
      publicBaseUrl,
      businessConfig,
      true,
      tenantContext,
      operationalBaseUrl,
    );

    const smartTokenService = allServices.find(s => s.id.endsWith('#identity:openid:smart:token'));
    expect(smartTokenService?.serviceEndpoint).toBe(
      'https://34.175.78.233/acme-id/cds-es/v1/health-care/identity/openid/smart/token',
    );
  });
});
