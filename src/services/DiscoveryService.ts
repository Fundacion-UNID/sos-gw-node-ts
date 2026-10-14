// src/services/DiscoveryService.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { EntityConfig } from '../gdc-backend-utils-node/models/entity';
import { DidDocument, type DidService } from '../gdc-backend-utils-node/models/did';
import { JwkSet } from '../gdc-backend-utils-node/models/jwk';
import type { IDiscoveryTenantRegistry } from '../managers/IDiscoveryTenantRegistry';
import { FhirVersionsByFormat, isNativeFhirFormat, type NativeFhirFormat } from '../constants/fhir-discovery';
import { buildFhirCapabilityStatement, type FhirEndpointCapability } from './fhir-capability-statement';

function ensureTrailingSlash(url: string): string {
  return url.endsWith('/') ? url : `${url}/`;
}

function resolveDidServiceEndpoint(didDoc: DidDocument, suffix: string): string | undefined {
  return didDoc.service?.find((service) => service.id === `${didDoc.id}${suffix}`)?.serviceEndpoint as string | undefined;
}

export type FhirServerBaseSelector = Readonly<{ section: string; format: string }>;

function resolveFhirEndpointCapabilities(
  services: readonly DidService[],
  selector: Readonly<{ section: string; format: NativeFhirFormat }>,
): FhirEndpointCapability[] {
  const actionsByResource = new Map<string, Set<string>>();
  for (const service of services) {
    if (service.selector?.section !== selector.section || service.selector?.format !== selector.format) continue;
    const actions = Array.isArray(service.actions) ? service.actions.map(String) : [];
    for (const resourceType of String(service.serviceEndpoint || '').split(',').map((value) => value.trim()).filter(Boolean)) {
      const resourceActions = actionsByResource.get(resourceType) || new Set<string>();
      actions.forEach((action) => resourceActions.add(action));
      actionsByResource.set(resourceType, resourceActions);
    }
  }
  return [...actionsByResource.entries()].map(([resourceType, actions]) => ({ resourceType, actions: [...actions] }));
}

/**
 * Handles the stateless, synchronous logic for generating public discovery documents
 * like DID Documents and JWKS based on a provided tenant configuration.
 */
export class DiscoveryService {
  private tenantsCacheManager: IDiscoveryTenantRegistry;

  constructor(tenantsCacheManager: IDiscoveryTenantRegistry) {
    this.tenantsCacheManager = tenantsCacheManager;
  }

  /**
   * Retrieves the static DID Document for a given tenant.
   * @param vaultId The unique vault identifier of the tenant.
   * @returns The DID Document, or undefined if not found.
   */
  public async getDidDocument(vaultId: string): Promise<DidDocument | undefined> {
    return this.tenantsCacheManager.getDidDocument(vaultId);
  }

  /**
   * Retrieves the JSON Web Key Set (JWKS) for a given entity.
   * @param vaultId The unique vault identifier of the tenant.
   * @returns The JWKS.
   */
  getJwks(vaultId: string): JwkSet {
    // This is a placeholder. A real implementation would fetch public keys 
    // from the KMS, which would require injecting the IKmsService.
    console.warn(`[DiscoveryService] getJwks is returning a placeholder for vaultId: ${vaultId}`);
    return { keys: [] };
  }

  /**
   * Generates a placeholder OpenID Connect configuration.
   * @param vaultId The unique vault identifier of the tenant.
   * @returns A partial OIDC configuration object, or undefined if not found.
   */
  public async getOpenIdConfiguration(vaultId: string): Promise<object | undefined> {
    const didDoc = await this.tenantsCacheManager.getDidDocument(vaultId);
    const tenantUrl = await this.tenantsCacheManager.getTenantDomainUrl(vaultId);
    const operationalUrl = await this.tenantsCacheManager.getTenantOperationalUrl(vaultId);

    if (!didDoc || !tenantUrl || !operationalUrl) return undefined;
    
    const jwks_uri = resolveDidServiceEndpoint(didDoc, '#jwks');
    const didDocumentUrl = resolveDidServiceEndpoint(didDoc, '#did-document');
    if (!jwks_uri || !didDocumentUrl) return undefined;
    
    const credentialIssuer = new URL('.well-known/openid-credential-issuer', ensureTrailingSlash(tenantUrl)).toString();
    return {
      issuer: tenantUrl,
      jwks_uri,
      did_document: didDocumentUrl,
      credential_issuer: credentialIssuer,
      authorization_endpoint: new URL('identity/oidc/authorize', ensureTrailingSlash(operationalUrl)).toString(),
      token_endpoint: new URL('identity/oidc/token', ensureTrailingSlash(operationalUrl)).toString(),
      response_types_supported: ['code', 'vp_token'],
      grant_types_supported: ['authorization_code'],
      request_object_signing_alg_values_supported: ['ES256', 'ES384', 'ML-DSA-44'],
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['ES256', 'ES384', 'ML-DSA-44'],
    };
  }

  /**
   * Generates OIDC4VCI metadata for issuance.
   * @param vaultId The unique vault identifier of the tenant.
   * @returns The OpenID Credential Issuer metadata, or undefined if not found.
   */
  public async getOpenIdCredentialIssuerMetadata(vaultId: string): Promise<object | undefined> {
    const tenantUrl = await this.tenantsCacheManager.getTenantDomainUrl(vaultId);
    const operationalUrl = await this.tenantsCacheManager.getTenantOperationalUrl(vaultId);
    if (!tenantUrl || !operationalUrl) return undefined;

    const legacyAlg = await this.tenantsCacheManager.getLegacySignAlg(vaultId) || process.env.LEGACY_SIGN_ALG;
    const algValues = ['ML-DSA-44', ...(legacyAlg ? [legacyAlg] : [])];

    return {
      credential_issuer: tenantUrl,
      credential_endpoint: new URL('identity/oidc/credential', ensureTrailingSlash(operationalUrl)).toString(),
      deferred_credential_endpoint: new URL('identity/oidc/credential/deferred', ensureTrailingSlash(operationalUrl)).toString(),
      credential_signing_alg_values_supported: algValues,
      credentials_supported: [
        {
          format: 'jwt_vc_json',
          types: ['VerifiableCredential', 'gx:LegalParticipant'],
        },
      ],
    };
  }

  /**
   * Generates a placeholder SMART on FHIR configuration.
   * @param vaultId The unique vault identifier of the tenant.
   * @returns A partial SMART configuration object, or undefined if not found.
   */
  public async getSmartConfiguration(vaultId: string, fhirBase?: FhirServerBaseSelector): Promise<object | undefined> {
    const tenantUrl = await this.tenantsCacheManager.getTenantDomainUrl(vaultId);
    const operationalUrl = await this.tenantsCacheManager.getTenantOperationalUrl(vaultId);
    if (!tenantUrl || !operationalUrl) return undefined;
    if (fhirBase) {
      if (!isNativeFhirFormat(fhirBase.format)) return undefined;
      const services = await this.tenantsCacheManager.getDidServiceConfig(vaultId) || [];
      if (resolveFhirEndpointCapabilities(services, { section: fhirBase.section, format: fhirBase.format }).length === 0) return undefined;
    }

    return {
      issuer: tenantUrl,
      token_endpoint: new URL('identity/openid/smart/token', ensureTrailingSlash(operationalUrl)).toString(),
      // Additional SMART on FHIR metadata would be populated here.
    };
  }

  /**
   * Generates the CapabilityStatement for one exact tenant `section/format`
   * server base from that tenant's matching DID service capabilities.
   * @param vaultId The unique vault identifier of the tenant.
   * @returns The instance CapabilityStatement, or undefined when that base is unsupported.
   */
  async getCapabilityStatement(vaultId: string, fhirBase: FhirServerBaseSelector): Promise<object | undefined> {
    if (!isNativeFhirFormat(fhirBase.format)) return undefined;
    const [operationalUrl, services] = await Promise.all([
      this.tenantsCacheManager.getTenantOperationalUrl(vaultId),
      this.tenantsCacheManager.getDidServiceConfig(vaultId),
    ]);
    if (!operationalUrl || !services) return undefined;
    const resources = resolveFhirEndpointCapabilities(services, { section: fhirBase.section, format: fhirBase.format });
    if (resources.length === 0) return undefined;
    return buildFhirCapabilityStatement({
      implementationUrl: new URL(`${encodeURIComponent(fhirBase.section)}/${encodeURIComponent(fhirBase.format)}`, ensureTrailingSlash(operationalUrl)).toString(),
      implementationDescription: `Tenant FHIR ${fhirBase.section} endpoint for ${vaultId}`,
      implementationVersion: process.env.FHIR_GOVERNANCE_IMPLEMENTATION_VERSION || '1.0.0',
      fhirVersion: FhirVersionsByFormat[fhirBase.format],
      resources,
    });
  }
}
