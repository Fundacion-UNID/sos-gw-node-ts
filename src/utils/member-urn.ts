// Copyright 2026 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/utils/member-urn.ts

export interface IndividualOrgUrnParams {
  namespace: string;
  network: 'test-network';
  jurisdiction: string;
  version?: string;
  sector: string;
  idType: string;
  idValue: string;
}

export interface MemberUrnParams extends IndividualOrgUrnParams {
  memberId: string;
  memberType: string; // e.g. 'person', 'device', etc.
}

/**
 * Crea el URN canónico para un miembro (member) de una organización individual.
 *
 * - Todos los componentes se normalizan a minúsculas, excepto el idValue de la organización y el memberId.
 * - El parámetro `memberType` se normaliza a minúsculas.
 *
 * Formato resultante:
 *   urn:<namespace>:<network>:<jurisdiction>:<version>:<sector>:entity:<idType>:<idValue>:member:<memberType>:<memberId>
 *
 * Ejemplo:
 *   urn:unid:test-network:es:v1:health-care:entity:nif:12345678z:member:person:987654321
 *
 * @param params Objeto con los componentes del URN para la organización y el miembro.
 * @param params.namespace Namespace del sistema (ej: 'unid').
 * @param params.network Red lógica (debe ser 'test-network').
 * @param params.jurisdiction Jurisdicción (ej: 'ES').
 * @param params.version Versión (por defecto 'v1').
 * @param params.sector Sector de negocio (ej: 'health-care').
 * @param params.idType Tipo de identificador de la organización (ej: 'nif').
 * @param params.idValue Valor del identificador de la organización (ej: '12345678z').
 * @param params.memberType Tipo de miembro (ej: 'person', 'device').
 * @param params.memberId Identificador único del miembro.
 * @returns URN canónico, jerárquico y normalizado del miembro.
 */
export function createMemberUrn(params: MemberUrnParams): string {
  const { namespace, network, jurisdiction, version = 'v1', sector, idType, idValue, memberType, memberId } = params;
  return `urn:${namespace.toLowerCase()}:${network.toLowerCase()}:${jurisdiction.toLowerCase()}:${version.toLowerCase()}:${sector.toLowerCase()}:entity:${idType.toLowerCase()}:${idValue}:member:${memberType.toLowerCase()}:${memberId}`;
}
