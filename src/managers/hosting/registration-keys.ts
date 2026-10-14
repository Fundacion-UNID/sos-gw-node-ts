import { DidCommDecodedMetadata } from 'gdc-common-utils-ts/models/confidential-message';
import { IssueType } from 'gdc-common-utils-ts/models/issue';
import { ManagerError } from 'gdc-common-utils-ts/utils/manager-error';
import { PublicJwk } from 'gdc-common-utils-ts/interfaces/Cryptography.types';
import { JwkSet } from 'gdc-common-utils-ts/models/jwk';
import { normalizeTenantPublicUrl } from './activation-helpers';

export function normalizeBindingAliasList(value: unknown): string[] {
  const rawItems = Array.isArray(value) ? value : [value];
  const aliases = rawItems
    .map((item) => typeof item === 'string' ? item.trim() : '')
    .filter(Boolean)
    .map((item) => item.startsWith('did:') || item.startsWith('urn:')
      ? item
      : normalizeTenantPublicUrl(item) || item);
  return Array.from(new Set(aliases));
}

export function extractRegistrationKeys(jobMeta?: DidCommDecodedMetadata) {
  const signerKid = jobMeta?.jws?.protected?.kid as string | undefined;
  const signerAlg = jobMeta?.jws?.protected?.alg as string | undefined;
  const signerJwkThumbprintMaterial = jobMeta?.jws?.protected?.jwk as PublicJwk | undefined;
  const signerJwk: PublicJwk | undefined =
    signerJwkThumbprintMaterial && signerKid
      ? ({ ...signerJwkThumbprintMaterial, kid: signerKid, use: 'sig', ...(signerAlg ? { alg: signerAlg } : {}) } as any)
      : undefined;

  const encrypterKid = (jobMeta?.jwe?.header as any)?.skid as string | undefined;
  const encrypterJwkThumbprintMaterial = jobMeta?.jwe?.header?.jwk as PublicJwk | undefined;
  const encrypterJwk: PublicJwk | undefined =
    encrypterJwkThumbprintMaterial && encrypterKid
      ? ({ ...encrypterJwkThumbprintMaterial, kid: encrypterKid, use: 'enc' } as any)
      : undefined;

  return { signerJwk, encrypterJwk };
}

export function isSignatureJwk(key: any): boolean {
  if (!key || typeof key !== 'object') {
    return false;
  }
  const purposes = Array.isArray(key.purposes) ? key.purposes : [];
  return key.use === 'sig'
    || purposes.includes('vc-sign')
    || purposes.includes('didcomm-sign')
    || (Array.isArray(key.key_ops) && key.key_ops.includes('verify'))
    || (typeof key.alg === 'string' && (key.alg.startsWith('ML-DSA') || key.alg.startsWith('ES') || key.alg.startsWith('RS') || key.alg.startsWith('PS')));
}

export function isEncryptionJwk(key: any): boolean {
  if (!key || typeof key !== 'object') {
    return false;
  }
  const purposes = Array.isArray(key.purposes) ? key.purposes : [];
  return key.use === 'enc'
    || purposes.includes('didcomm-enc')
    || (Array.isArray(key.key_ops) && key.key_ops.includes('encrypt'))
    || (typeof key.crv === 'string' && (key.crv.startsWith('ML-KEM') || key.crv.startsWith('P-')));
}

export function findJwkByUse(jwks: JwkSet | undefined, use: 'sig' | 'enc'): PublicJwk | undefined {
  if (!jwks?.keys?.length) {
    return undefined;
  }
  return jwks.keys.find((key: any) => use === 'sig' ? isSignatureJwk(key) : isEncryptionJwk(key)) as PublicJwk | undefined;
}

export function mergeActivationJwks(keys: Array<PublicJwk | undefined>, jwks?: JwkSet): JwkSet {
  const merged = new Map<string, PublicJwk>();
  const extraKeys = (jwks?.keys || []) as PublicJwk[];
  for (const key of [...keys, ...extraKeys]) {
    if (!key || typeof key !== 'object') {
      continue;
    }
    const kid = typeof key.kid === 'string' && key.kid.trim().length > 0
      ? key.kid
      : undefined;
    if (!kid) {
      throw new ManagerError('Activation public keys must include "kid" properties.', IssueType.Required);
    }
    merged.set(kid, key);
  }
  return { keys: Array.from(merged.values()) as any[] };
}
