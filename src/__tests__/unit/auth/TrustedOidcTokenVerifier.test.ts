// Flow contract: route only by the unverified iss hint, then accept a token only after its configured verifier validates exact issuer and audience.
// src/__tests__/unit/auth/TrustedOidcTokenVerifier.test.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { ITokenVerifier } from '../../../auth/ITokenVerifier';
import { TrustedOidcTokenVerifier } from '../../../auth/TrustedOidcTokenVerifier';

function unsignedToken(payload: Record<string, unknown>): string {
  return `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`;
}

describe('TrustedOidcTokenVerifier', () => {
  it('delegates only to the verifier bound to the token issuer', async () => {
    const selected: ITokenVerifier = { verify: jest.fn().mockResolvedValue({ valid: true, payload: { iss: 'globaldatacare.es' } }) };
    const other: ITokenVerifier = { verify: jest.fn() };
    const verifier = new TrustedOidcTokenVerifier([
      { issuer: 'globaldatacare.es', audience: 'globaldatacare.es', verifier: selected },
      { issuer: 'https://securetoken.google.com/other', audience: 'other', verifier: other },
    ]);

    await expect(verifier.verify(unsignedToken({ iss: 'globaldatacare.es' }))).resolves.toEqual(
      expect.objectContaining({ valid: true }),
    );
    expect(selected.verify).toHaveBeenCalledTimes(1);
    expect(other.verify).not.toHaveBeenCalled();
  });

  it('rejects an issuer that is not configured', async () => {
    const verifier = new TrustedOidcTokenVerifier([
      { issuer: 'globaldatacare.es', audience: 'globaldatacare.es', verifier: { verify: jest.fn() } },
    ]);
    await expect(verifier.verify(unsignedToken({ iss: 'https://attacker.example' }))).resolves.toEqual({
      valid: false,
      error: 'Untrusted id_token issuer.',
    });
  });
});

