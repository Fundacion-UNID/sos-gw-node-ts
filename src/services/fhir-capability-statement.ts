// Copyright 2026 Antifraud Services Inc. under the Apache License, Version 2.0.

export type FhirEndpointCapability = Readonly<{
  resourceType: string;
  actions: readonly string[];
}>;

export type FhirCapabilityStatementOptions = Readonly<{
  implementationUrl: string;
  implementationDescription: string;
  implementationVersion: string;
  fhirVersion: string;
  resources: readonly FhirEndpointCapability[];
}>;

/** Builds an instance CapabilityStatement for one exact tenant FHIR server base. */
export function buildFhirCapabilityStatement(options: FhirCapabilityStatementOptions): object {
  const implementationUrl = new URL(options.implementationUrl);
  if (implementationUrl.protocol !== 'https:') throw new Error('FHIR implementation URL must use HTTPS.');
  return {
    resourceType: 'CapabilityStatement',
    id: 'metadata',
    version: options.implementationVersion,
    name: 'TenantFhirCapabilityStatement',
    title: 'Tenant FHIR endpoint capabilities',
    status: 'active',
    experimental: false,
    kind: 'instance',
    implementation: {
      description: options.implementationDescription,
      url: implementationUrl.toString().replace(/\/$/, ''),
    },
    fhirVersion: options.fhirVersion,
    format: ['application/fhir+json'],
    rest: [{
      mode: 'server',
      resource: options.resources.map(({ resourceType, actions }) => ({
        type: resourceType,
        ...(actions.length > 0 ? {
          documentation: `Implementation-specific endpoint actions: ${[...new Set(actions)].sort().join(', ')}.`,
        } : {}),
      })),
    }],
  };
}
