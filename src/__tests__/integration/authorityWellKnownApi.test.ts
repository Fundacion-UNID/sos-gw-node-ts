import express from 'express';
import { createAuthorityRouter } from '../../routes/authority';
import { AsyncResponseStoreMem } from '../../adapters/async-response-store.mem';
import { invokeExpress } from './helpers/invokeExpress';
import { AuthorityArtifacts } from '../../utils/authority-artifacts';

describe('Authority Well-Known API', () => {
  const app = express();
  app.use(express.json());

  const asyncStore = new AsyncResponseStoreMem();
  const authorities: Record<string, AuthorityArtifacts> = {
    CA: {
      role: 'CA',
      didDocument: { id: 'did:web:root-ca.example.com', verificationMethod: [{ id: 'did:web:root-ca.example.com#key-1' }] },
      jwks: { keys: [{ kid: 'key-1', alg: 'ES384' }] },
      legalParticipantVc: { id: 'urn:uuid:root-ca' },
      legacySignAlg: 'ES384',
      legacyPrivateJwk: { kty: 'EC', crv: 'P-384', d: 'AA', kid: 'key-1' },
      legacyX509ChainBase64: [Buffer.from('root-der').toString('base64')],
    },
    ICA: {
      role: 'ICA',
      didDocument: { id: 'did:web:ica.example.com', verificationMethod: [{ id: 'did:web:ica.example.com#key-1' }] },
      jwks: { keys: [{ kid: 'key-1', alg: 'ES384' }] },
      legalParticipantVc: { id: 'urn:uuid:ica' },
      legacySignAlg: 'ES384',
      legacyPrivateJwk: { kty: 'EC', crv: 'P-384', d: 'AA', kid: 'key-1' },
      legacyX509ChainBase64: [Buffer.from('ica-der').toString('base64'), Buffer.from('root-der').toString('base64')],
    },
  };

  app.use('/', createAuthorityRouter(authorities, asyncStore));

  it('serves CA did and jwks', async () => {
    const didResp = await invokeExpress(app, { method: 'GET', url: '/ca/.well-known/did.json' });
    expect(didResp.status).toBe(200);
    const jwksResp = await invokeExpress(app, { method: 'GET', url: '/ca/.well-known/jwks.json' });
    expect(jwksResp.status).toBe(200);
  });
});
