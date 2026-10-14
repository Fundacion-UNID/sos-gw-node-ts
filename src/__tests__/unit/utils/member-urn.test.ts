// Copyright 2026 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/__tests__/unit/utils/member-urn.test.ts

import { createMemberUrn, MemberUrnParams } from '../../../utils/member-urn';

describe('createMemberUrn', () => {
  const baseParams: Omit<MemberUrnParams, 'memberType' | 'memberId'> = {
    namespace: 'unid',
    network: 'test-network',
    jurisdiction: 'ES',
    version: 'v1',
    sector: 'health-care',
    idType: 'nif',
    idValue: '12345678z',
  };

  it('debería crear un URN de member tipo person', () => {
    const params: MemberUrnParams = { ...baseParams, memberType: 'person', memberId: '987654321' };
    const urn = createMemberUrn(params);
    expect(urn).toBe('urn:unid:test-network:es:v1:health-care:entity:nif:12345678z:member:person:987654321');
  });

  it('debería normalizar memberType a minúsculas', () => {
    const params: MemberUrnParams = { ...baseParams, memberType: 'DEVICE', memberId: 'DEV-001' };
    const urn = createMemberUrn(params);
    expect(urn).toBe('urn:unid:test-network:es:v1:health-care:entity:nif:12345678z:member:device:DEV-001');
  });

  it('debería aceptar cualquier valor de memberId', () => {
    const params: MemberUrnParams = { ...baseParams, memberType: 'person', memberId: 'A-1_2.3' };
    const urn = createMemberUrn(params);
    expect(urn.endsWith(':member:person:A-1_2.3')).toBe(true);
  });
});

/**
 * TDD: El formato esperado de URN para un miembro es:
 * urn:<namespace>:<network>:<jurisdiction>:<version>:<sector>:entity:<idType>:<idValue>:member:<memberType>:<memberId>
 *
 * Ejemplo:
 * urn:unid:test-network:es:v1:health-care:entity:nif:12345678z:member:person:987654321
 */
