import { ClaimsServiceSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import {
  parseServiceCapabilityTokens,
  ServiceCapability,
  ServiceCapabilityToken,
} from 'gdc-common-utils-ts/constants/service-capabilities';
import { ContinuityServiceCapability } from 'sos-data-utils-ts/continuity-service-capabilities';

export const SERVICE_ADDITIONAL_TYPE_CLAIM = 'org.schema.Service.additionalType' as const;
export const HL7_ACT_REASON_CODE_SYSTEM = 'http://terminology.hl7.org/CodeSystem/v3-ActReason' as const;

const KNOWN_SERVICE_CAPABILITIES: ReadonlySet<string> = new Set(
  [
    ...Object.values(ServiceCapabilityToken),
    ...Object.values(ServiceCapability),
    ...Object.values(ContinuityServiceCapability),
  ],
);

function readNonEmptyClaim(source: Record<string, unknown> | undefined, claimName: string): string | undefined {
  const value = source?.[claimName];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export function mergeServiceCapabilityClaims(...values: unknown[]): string | undefined {
  const merged = Array.from(new Set(
    values.flatMap((value) => parseServiceCapabilityTokens(value))
      .filter((value) => KNOWN_SERVICE_CAPABILITIES.has(value)),
  ));
  return merged.length ? merged.join(',') : undefined;
}

function parseServiceActReasonCodes(value: unknown): string[] {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return [];

  let currentSystem = '';
  const result: string[] = [];

  for (const token of raw.split(',')) {
    const normalized = token.trim();
    if (!normalized) continue;

    const pipeIndex = normalized.indexOf('|');
    if (pipeIndex >= 0) {
      currentSystem = normalized.slice(0, pipeIndex).trim();
      if (currentSystem === HL7_ACT_REASON_CODE_SYSTEM) {
        result.push(normalized.slice(pipeIndex + 1).trim().toUpperCase());
      }
      continue;
    }

    if (currentSystem === HL7_ACT_REASON_CODE_SYSTEM) {
      result.push(normalized.toUpperCase());
    }
  }

  return Array.from(new Set(result.filter(Boolean)));
}

function serializeServiceActReasonCodes(codes: ReadonlyArray<string>): string | undefined {
  const normalized = Array.from(new Set(
    codes
      .map((code) => String(code || '').trim().toUpperCase())
      .filter(Boolean),
  ));
  return normalized.length
    ? `${HL7_ACT_REASON_CODE_SYSTEM}|${normalized.join(',')}`
    : undefined;
}

export function getServiceActReasonClaimFromClaims(
  claims: Record<string, unknown> | undefined,
): string | undefined {
  return serializeServiceActReasonCodes(
    parseServiceActReasonCodes(readNonEmptyClaim(claims, SERVICE_ADDITIONAL_TYPE_CLAIM)),
  );
}

export function getServiceCapabilityClaimFromClaims(
  claims: Record<string, unknown> | undefined,
): string | undefined {
  return mergeServiceCapabilityClaims(
    readNonEmptyClaim(claims, ClaimsServiceSchemaorg.serviceType),
    readNonEmptyClaim(claims, SERVICE_ADDITIONAL_TYPE_CLAIM),
  );
}

export function getTenantServiceCapabilityClaim(tenantConfig: any): string | undefined {
  return mergeServiceCapabilityClaims(
    tenantConfig?.claims?.[ClaimsServiceSchemaorg.serviceType],
    tenantConfig?.claims?.[SERVICE_ADDITIONAL_TYPE_CLAIM],
    tenantConfig?.provider?.service?.[ClaimsServiceSchemaorg.serviceType],
    tenantConfig?.provider?.service?.[SERVICE_ADDITIONAL_TYPE_CLAIM],
  );
}
