// src/routes/authority.ts

import * as express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { AuthorityArtifacts } from '../utils/authority-artifacts';
import { buildStatusListCredential, buildStatusListEntry, createStatusListEncodedList } from '../utils/status-list';
import { signVerifiableCredentialWithJwk } from '../utils/vc-signer';
import { IAsyncResponseStore } from '../adapters/async-response-store.mem';

const STATUS_LIST_BITS = 16384;
const STATUS_LIST_PURPOSE = 'revocation' as const;
const STATUS_LIST_INDEX = 0;

type AuthorityMap = Record<string, AuthorityArtifacts>;

export function createAuthorityRouter(authorities: AuthorityMap, asyncResponseStore: IAsyncResponseStore): express.Router {
  const router = express.Router();

  router.get('/:role/.well-known/did.json', (req, res) => {
    const role = req.params.role.toUpperCase();
    const authority = authorities[role];
    if (!authority) return res.status(404).type('text').send('Not Found');
    res.json(authority.didDocument);
  });

  router.get('/:role/.well-known/jwks.json', (req, res) => {
    const role = req.params.role.toUpperCase();
    const authority = authorities[role];
    if (!authority) return res.status(404).type('text').send('Not Found');
    const jwks = authority.jwks;
    if (jwks?.keys?.length) {
      const x5u = `${req.protocol}://${req.get('host')}/${req.params.role}/.well-known/x509.der`;
      for (const key of jwks.keys) {
        if ((key as any).alg === authority.legacySignAlg) {
          (key as any).x5u = x5u;
          if (authority.legacyX509ChainBase64.length) {
            (key as any).x5c = authority.legacyX509ChainBase64;
          }
        }
      }
    }
    res.json(jwks);
  });

  router.get('/:role/.well-known/x509.der', (req, res) => {
    const role = req.params.role.toUpperCase();
    const authority = authorities[role];
    if (!authority || !authority.legacyX509ChainBase64.length) {
      return res.status(404).type('text').send('Not Found');
    }
    const chainBytes = Buffer.concat(authority.legacyX509ChainBase64.map((entry) => Buffer.from(entry, 'base64')));
    res.type('application/pkix-cert').send(chainBytes);
  });

  router.get('/:role/.well-known/legal-participant.vc.json', (req, res) => {
    const role = req.params.role.toUpperCase();
    const authority = authorities[role];
    if (!authority?.legalParticipantVc) return res.status(404).type('text').send('Not Found');
    res.json(authority.legalParticipantVc);
  });

  router.get('/:role/.well-known/status-list.json', async (req, res) => {
    const role = req.params.role.toUpperCase();
    const authority = authorities[role];
    if (!authority || !authority.legacyPrivateJwk) return res.status(404).type('text').send('Not Found');

    const listUrl = `${req.protocol}://${req.get('host')}/${req.params.role}/.well-known/status-list.json`;
    const encodedList = createStatusListEncodedList(STATUS_LIST_BITS);
    const unsignedStatusListVc = buildStatusListCredential({
      issuerDid: authority.didDocument.id,
      listUrl,
      statusPurpose: STATUS_LIST_PURPOSE,
      encodedList,
    });
    const verificationMethodId = authority.didDocument.verificationMethod?.[0]?.id as string | undefined;
    if (!verificationMethodId) return res.status(500).type('text').send('Missing verification method');

    const signedStatusListVc = await signVerifiableCredentialWithJwk(
      unsignedStatusListVc,
      verificationMethodId,
      authority.legacyPrivateJwk,
    );

    res.json(signedStatusListVc);
  });

  router.post('/:role/identity/gaia-x/credential/_sign', async (req, res) => {
    const role = req.params.role.toUpperCase();
    const authority = authorities[role];
    if (!authority || !authority.legacyPrivateJwk) {
      return res.status(404).type('text').send('Not Found');
    }

    const { thid, vc } = req.body || {};
    if (thid) {
      const job = await asyncResponseStore.get(thid);
      if (!job) return res.status(404).json({ error: 'Thread ID not found or expired.' });
      if (job.status === 'PENDING') return res.status(202).send();
      if (job.status === 'COMPLETED' && job.result) {
        res.json(job.result);
        await asyncResponseStore.delete(thid);
        return;
      }
      return res.status(500).json({ error: 'Job failed to process.' });
    }

    if (!vc) {
      return res.status(400).json({ error: 'Bad Request', message: 'Missing vc payload.' });
    }

    const verificationMethodId = authority.didDocument.verificationMethod?.[0]?.id as string | undefined;
    if (!verificationMethodId) {
      return res.status(500).json({ error: 'Missing verification method for signer.' });
    }

    const thidNew = uuidv4();
    const signedVc = await signVerifiableCredentialWithJwk(vc, verificationMethodId, authority.legacyPrivateJwk);
    await asyncResponseStore.set(thidNew, { status: 'COMPLETED', result: signedVc });
    res.status(202).json({ thid: thidNew });
  });

  return router;
}
