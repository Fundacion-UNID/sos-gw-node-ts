// Flow contract: internal hosted and public VetChain professional DIDs yield the same tenant, email hash and role without using the hostname as authority.
import { buildHostedProviderDidWeb, buildProfessionalDidWeb } from 'gdc-common-utils-ts/utils/did';
import { parseProfessionalDidIdentity } from '../../../utils/professional-did-identity';

describe('professional DID identity extraction', () => {
  const tenantId = '704457076';
  const role = 'ISCO-08|2250';
  const email = 'veterinarian@example.org';

  it.each([
    'did:web:beta-gw.vetchain.app:704457076:cds-CA-BC:v1:animal-care',
    buildHostedProviderDidWeb({
      hostDomain: 'vetchain.app',
      sector: 'animal-care',
      providerTaxId: tenantId,
    }),
  ])('extracts tenant membership from %s', (organizationDidWeb) => {
    const employeeDid = buildProfessionalDidWeb({ organizationDidWeb, email, role });
    expect(parseProfessionalDidIdentity(employeeDid)).toMatchObject({
      organizationIdentifier: tenantId,
      organizationDid: organizationDidWeb,
      membershipMarker: 'employee',
      role,
    });
    expect(parseProfessionalDidIdentity(employeeDid)?.stableActorIdentifier).toMatch(/^urn:multibase:z/);
  });

  it('accepts member but rejects a root DID with no tenant identifier', () => {
    const employeeDid = buildProfessionalDidWeb({
      organizationDidWeb: buildHostedProviderDidWeb({
        hostDomain: 'vetchain.app', sector: 'animal-care', providerTaxId: tenantId,
      }),
      email,
      role,
    }).replace(':employee:', ':member:');
    expect(parseProfessionalDidIdentity(employeeDid)?.organizationIdentifier).toBe(tenantId);
    expect(parseProfessionalDidIdentity('did:web:vetchain.app:employee:z123:ISCO-08|2250')).toBeUndefined();
  });
});
