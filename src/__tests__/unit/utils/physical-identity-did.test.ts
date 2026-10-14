import { describe, expect, it } from '@jest/globals';
import {
  buildPhysicalIdentityDidDocument,
  getDidWebDocumentUrl,
} from '../../../utils/physical-identity-did';

const cardDid = 'did:web:unid.online:card:uhc:personal:000-000-000-001';
const individualDid = 'did:web:internal.unid.example:individual:subject-example';
const controllerDid = 'did:web:wallet.unid.example:controller:subject-example';
const indexServiceDid = 'did:web:index.unid.example:service:subject-example';

describe('physical identity DID Web contract', () => {
  it('maps a path-based DID Web to its public did.json URL', () => {
    expect(getDidWebDocumentUrl(cardDid)).toBe(
      'https://unid.online/card/uhc/personal/000-000-000-001/did.json',
    );
    expect(getDidWebDocumentUrl('did:web:localhost%3A3000:card:test')).toBe(
      'https://localhost:3000/card/test/did.json',
    );
  });

  it('publishes separate support, subject, controller, index and endpoint identities', () => {
    const document = buildPhysicalIdentityDidDocument({
      supportDid: cardDid,
      supportKind: 'uhc-card',
      subjectDid: individualDid,
      controllerDid,
      indexServiceDid,
      verificationMethods: [{
        id: `${controllerDid}#signing-key-1`,
        type: 'JsonWebKey2020',
        controller: controllerDid,
        publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'public-x', y: 'public-y' } as any,
      }],
      services: [{
        fragment: 'fhir-r4-communication',
        type: 'FHIRR4CommunicationService',
        serviceEndpoint: 'https://api.unid.example/fhir/r4/Communication',
      }],
    });

    expect(document).toMatchObject({
      id: cardDid,
      controller: controllerDid,
      subject: individualDid,
      alsoKnownAs: [indexServiceDid],
      physicalDocumentType: 'uhc-card',
      verificationMethod: [{ controller: controllerDid }],
      assertionMethod: [`${controllerDid}#signing-key-1`],
      authentication: [`${controllerDid}#signing-key-1`],
      service: [{
        id: `${cardDid}#fhir-r4-communication`,
        type: 'FHIRR4CommunicationService',
        serviceEndpoint: 'https://api.unid.example/fhir/r4/Communication',
      }],
    });
    expect(new Set([
      document.id,
      document.subject,
      document.controller,
      document.alsoKnownAs[0],
      document.service[0].serviceEndpoint,
    ]).size).toBe(5);
  });

  it('rejects identity collapse, private JWK material and non-HTTPS services', () => {
    const base = {
      supportDid: cardDid,
      supportKind: 'petd' as const,
      subjectDid: individualDid,
      controllerDid,
      indexServiceDid,
      verificationMethods: [{
        id: `${controllerDid}#key-1`,
        type: 'JsonWebKey2020',
        controller: controllerDid,
        publicKeyJwk: { kty: 'OKP', crv: 'X25519', x: 'public-x' } as any,
      }],
      services: [{
        fragment: 'fhir-r4-communication',
        type: 'FHIRR4CommunicationService',
        serviceEndpoint: 'https://api.vetchain.example/fhir/r4/Communication',
      }],
    };

    expect(() => buildPhysicalIdentityDidDocument({ ...base, subjectDid: cardDid }))
      .toThrow('must be different');
    expect(() => buildPhysicalIdentityDidDocument({
      ...base,
      verificationMethods: [{
        ...base.verificationMethods[0],
        publicKeyJwk: { ...base.verificationMethods[0].publicKeyJwk, d: 'private' } as any,
      }],
    })).toThrow('private JWK');
    expect(() => buildPhysicalIdentityDidDocument({
      ...base,
      services: [{ ...base.services[0], serviceEndpoint: 'http://internal/fhir/r4/Communication' }],
    })).toThrow('HTTPS');
  });
});
