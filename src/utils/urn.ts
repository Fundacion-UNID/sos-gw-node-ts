// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/utils/urn.ts
import { buildStableActorIdentifier } from 'gdc-common-utils-ts/utils/actor-identifier';
export const EMPLOYEE_URN_SEGMENT = ':employee:';
export const EMPLOYEE_ROLE_URN_SEGMENT = ':role:';

export interface EntityUrnBaseParams {
  namespace: string;
  network: string;
  jurisdiction: string;
  version?: string;
  sector: string;
}

export interface OrganizationUrnParams extends EntityUrnBaseParams {
  idType: string;
  idValue: string;
}

export interface EmployeeUrnParams extends OrganizationUrnParams {
  email: string;
  role: string;
  instanceId?: string;
}

export interface StableEmployeeUrnParams {
  organizationUrn: string;
  stableActorIdentifier: string;
  role: string;
}

function hashEmployeeEmail(email: string): string {
  return buildStableActorIdentifier({ contactKind: 'email', contact: email })
    .replace(/^urn:multibase:/, '');
}

export function normalizeEmployeeRole(role: string): string {
  const normalized = String(role || '').trim().toLowerCase();
  if (!normalized) return 'v3-rolecode|resprsn';
  if (normalized.includes('|')) {
    const [system, code] = normalized.split('|', 2);
    return `${system.trim()}|${(code || '').trim()}`;
  }
  if (normalized.includes(':')) {
    const [system, code] = normalized.split(':', 2);
    return `${system.trim()}|${(code || '').trim()}`;
  }
  return normalized;
}

/** Returns the normalized role carried by a canonical employee URN. */
export function getEmployeeRoleFromUrn(employeeUrn: string): string | undefined {
  const roleIndex = String(employeeUrn || '').lastIndexOf(EMPLOYEE_ROLE_URN_SEGMENT);
  if (roleIndex < 0) return undefined;
  const roleAndInstance = employeeUrn.slice(roleIndex + EMPLOYEE_ROLE_URN_SEGMENT.length);
  return roleAndInstance.split(':instance:', 1)[0] || undefined;
}

/**
 * Creates a canonical URN string from a given UUID.
 * @param uuid The UUID to format.
 * @returns The canonical URN string, e.g., 'urn:uuid:xxxxxxxx-xxxx...'.
 */
export function createUrnUuid(uuid: string): string {
    return `urn:uuid:${uuid}`;
}


/**
 * Creates the canonical URN for an organization based on its public, verifiable attributes.
 * All components of the URN are normalized to lowercase for consistency, except for the idValue.
 *
 * @param params An object containing the components of the URN.
 * @returns The canonical, normalized URN string for the organization.
 */
export function createOrganizationUrn(params: OrganizationUrnParams): string {
  const { namespace, network, jurisdiction, version = 'v1', sector, idType, idValue } = params;
  
  // Normalize all components to lowercase for canonical representation, EXCEPT for the idValue,
  // which may be case-sensitive.
  return `urn:${namespace.toLowerCase()}:${network.toLowerCase()}:${jurisdiction.toLowerCase()}:${version.toLowerCase()}:${sector.toLowerCase()}:entity:${idType.toLowerCase()}:${idValue}`;
}

/**
 * Crea el URN canónico para un empleado, heredando la base de la organización.
 *
 * - Todos los componentes se normalizan a minúsculas, excepto el idValue de la organización.
 * - El email se normaliza a minúsculas.
 * - El parámetro `role` puede ser solo el código (ej: '1120') o incluir esquema (ej: 'ISCO-08:1120').
 *   - Si no se especifica esquema, se asume 'isco-08' por defecto.
 *   - El esquema y el código se normalizan a minúsculas.
 *
 * Formato resultante:
 *   urn:<namespace>:<network>:<jurisdiction>:<version>:<sector>:entity:<idType>:<idValue>:employee:<email>:role:<roleScheme>:<roleCode>
 *
 * Ejemplo con role simple:
 *   urn:unid:test-network:es:v1:health-care:entity:vat:B12345678:employee:john.doe@example.com:role:isco-08:1120
 *
 * Ejemplo con role con esquema:
 *   urn:unid:test-network:es:v1:health-care:entity:vat:B12345678:employee:john.doe@example.com:role:isco-08:1120
 *
 * @param params Objeto con los componentes del URN para la organización y el empleado.
 * @param params.namespace Namespace del sistema (ej: 'unid').
 * @param params.network Red lógica (debe ser 'test-network').
 * @param params.jurisdiction Jurisdicción (ej: 'ES').
 * @param params.version Versión (por defecto 'v1').
 * @param params.sector Sector de negocio (ej: 'health-care').
 * @param params.idType Tipo de identificador de la organización (ej: 'vat').
 * @param params.idValue Valor del identificador de la organización (ej: 'B12345678').
 * @param params.email Email del empleado (se normaliza a minúsculas).
 * @param params.role Rol del empleado, puede ser solo código o esquema:código.
 * @returns URN canónico, jerárquico y normalizado del empleado.
 */
export function createEmployeeUrn(params: EmployeeUrnParams): string {
  const orgUrn = createOrganizationUrn(params);
  const { email, role, instanceId } = params;
  const normalizedInstanceId = String(instanceId || '').trim().toLowerCase();
  const instanceSuffix = normalizedInstanceId ? `:instance:${normalizedInstanceId}` : '';
  return `${orgUrn}:employee:${hashEmployeeEmail(email)}:role:${normalizeEmployeeRole(role)}${instanceSuffix}`;
}

/** Builds the employee URN when the privacy-safe stable actor hash already exists. */
export function createEmployeeUrnFromStableActorIdentifier(params: StableEmployeeUrnParams): string {
  const organizationUrn = String(params.organizationUrn || '').trim();
  const match = /^urn:multibase:(z[^:]+)$/.exec(String(params.stableActorIdentifier || '').trim());
  if (!organizationUrn.startsWith('urn:') || !organizationUrn.includes(':entity:')) {
    throw new Error('Employee URN requires its canonical organization URN.');
  }
  if (!match) throw new Error('Employee URN requires its stable actor identifier.');
  return `${organizationUrn}${EMPLOYEE_URN_SEGMENT}${match[1]}${EMPLOYEE_ROLE_URN_SEGMENT}${normalizeEmployeeRole(params.role)}`;
}

/** Resolves the privacy-safe role-bearing employee URN from its DID document. */
export function resolveRoleBearingEmployeeUrn(input: Readonly<{
  id?: string;
  alsoKnownAs?: readonly string[];
}>): string | undefined {
  return [input.id, ...(input.alsoKnownAs || [])]
    .map((candidate) => String(candidate || '').trim())
    .find((candidate) => candidate.startsWith('urn:')
      && candidate.includes(EMPLOYEE_URN_SEGMENT)
      && candidate.includes(EMPLOYEE_ROLE_URN_SEGMENT));
}

/**
 * Extracts the tenant's base URN from a longer, hierarchical URN.
 * The tenant URN is considered to be the part of the string up to and including the entity identifier.
 * @param fullUrn The complete, hierarchical URN (e.g., for an employee or connection).
 * @returns The base URN of the tenant, or the original string if the pattern is not found.
 */
export function getTenantIdentifierUrnPrefix(fullUrn: string): string {
  const parts = fullUrn.split(':');
  const entityIndex = parts.indexOf('entity');

  if (entityIndex === -1 || entityIndex + 2 >= parts.length) {
    // If 'entity' isn't found or there aren't enough parts for a full entity identifier,
    // we can't determine the prefix, so we might return the original URN or handle as an error.
    // For now, let's assume it might be a base URN already.
    return fullUrn;
  }

  // The prefix includes the entity identifier (3 parts: 'entity', type, value)
  const tenantParts = parts.slice(0, entityIndex + 3);
  return tenantParts.join(':');
}

/**
 * Represents the structured components of a canonical URN.
 */
export interface ParsedUrn {
  namespace: string;
  network: string;
  jurisdiction: string;
  version: string;
  sector: string;
  entityType: string; // e.g., 'entity'
  idType: string;
  idValue: string;
}

// URN format: urn:<namespace>:<network>:<jurisdiction>:<version>:<sector>:entity:<idType>:<idValue>
const URN_REGEX = /^urn:([^:]+):([^:]+):([^:]+):([^:]+):([^:]+):([^:]+):([^:]+):([^:]+)$/;

/**
 * Parses a canonical URN string into its structured components.
 *
 * @param urn The URN string to parse.
 * @returns A ParsedUrn object, or null if the URN format is invalid.
 */
export function parseTenantUrn(urn: string): ParsedUrn | null {
  if (!urn) {
    return null;
  }

  const matches = urn.match(URN_REGEX);
  if (!matches || matches.length !== 9) {
    return null;
  }

  return {
    namespace: matches[1],
    network: matches[2],
    jurisdiction: matches[3],
    version: matches[4],
    sector: matches[5],
    entityType: matches[6],
    idType: matches[7],
    idValue: matches[8],
  };
}
