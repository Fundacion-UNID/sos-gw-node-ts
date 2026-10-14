import { describe, expect, it } from '@jest/globals';
import { isSameOrganizationCredentialIdentity } from '../../../utils/ledger-organization-registration';

describe('organization ledger credential retry identity', () => {
  // Detached JWS authenticates both payloads; envelope renewal is not a new
  // veterinary organization when the signed legal identity is unchanged.
  it('accepts envelope renewal but rejects a changed subject', () => {
    const stable = {
      type: ['VerifiableCredential', 'LegalPerson'],
      issuer: 'did:web:gw-vet.connecthealth.ca',
      credentialSubject: { id: 'did:web:clinic.example', legalName: 'Example Veterinary Clinic' },
    };
    expect(isSameOrganizationCredentialIdentity(
      { ...stable, id: 'urn:uuid:first', validFrom: '2026-01-01', proof: { jws: 'first' } },
      { ...stable, id: 'urn:uuid:retry', validFrom: '2026-01-02', proof: { jws: 'retry' } },
    )).toBe(true);
    expect(isSameOrganizationCredentialIdentity(stable, {
      ...stable,
      credentialSubject: { ...stable.credentialSubject, legalName: 'Different Clinic' },
    })).toBe(false);
  });
});
