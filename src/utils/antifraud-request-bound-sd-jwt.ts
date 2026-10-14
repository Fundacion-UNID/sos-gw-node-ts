import { createHash, hkdfSync, randomBytes } from 'node:crypto';

export type AntifraudIdentitySubjectKind = 'personal' | 'animal';
export type AntifraudIdentityContext = 'org.schema' | 'org.hl7.fhir.api';
export type AntifraudAttributeValue = string | number | boolean | null;

export type AntifraudAttributeNameInput = Readonly<{
  jurisdiction: string;
  subjectKind: AntifraudIdentitySubjectKind;
  context: AntifraudIdentityContext;
  attributeName: string;
}>;

type AntifraudAttributeContextInput = Omit<AntifraudAttributeNameInput, 'attributeName'>;

export type AntifraudRequestBoundClaim = Readonly<{
  attributeName: string;
  attributeValue: AntifraudAttributeValue;
}>;

export type AntifraudSdJwtPayload = Readonly<{
  _sd_alg: 'sha-384';
  _sd: string[];
  [attributeNameUrn: string]: string | string[];
}>;

const JURISDICTION_PATTERN = /^[A-Z]{2}(?:-[A-Z0-9]{1,3})?$/;
const ATTRIBUTE_NAME_PATTERN = /^[A-Z][A-Za-z0-9]*(?:\.[A-Za-z0-9_-]+)+$/;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MINIMUM_SEED_BYTES = 16;
const DERIVED_SALT_BYTES = 48;

/**
 * Builds the canonical Antifraud identity attribute-name URN.
 *
 * The context and ResourceType-first attribute name are kept separate. The
 * attribute value is deliberately absent because this URN identifies the
 * attribute whose value is committed by the SD-JWT disclosure digest.
 */
export function buildAntifraudAttributeNameUrn(input: AntifraudAttributeNameInput): string {
  const jurisdiction = String(input.jurisdiction || '').trim().toUpperCase();
  if (!JURISDICTION_PATTERN.test(jurisdiction)) {
    throw new TypeError('Antifraud identity jurisdiction must be an ISO 3166 country or subdivision code.');
  }
  if (!ATTRIBUTE_NAME_PATTERN.test(input.attributeName)) {
    throw new TypeError('Antifraud identity attribute name must start with ResourceType and exclude the context.');
  }
  return `urn:cds-${jurisdiction}:v1:identity:${input.subjectKind}:${input.context}:${input.attributeName}`;
}

/**
 * Derives the per-claim final salt known only to the issuer during issuance
 * and to the requester that retains the DIDComm `thid`.
 *
 * HKDF-SHA-384 uses the requester secret as input key material, the public
 * per-claim seed as extract salt, and the canonical attribute-name URN as
 * domain-separated expansion information. The returned final salt is never
 * included in the Antifraud response.
 */
export function deriveAntifraudFinalClaimSalt(input: AntifraudAttributeNameInput & Readonly<{
  thid: string;
  claimSaltSeed: string;
}>): string {
  if (!UUID_V4_PATTERN.test(input.thid)) {
    throw new TypeError('Antifraud request thid must be an unpredictable UUID v4.');
  }
  const seed = decodeSeed(input.claimSaltSeed);
  const attributeNameUrn = buildAntifraudAttributeNameUrn(input);
  const derived = hkdfSync(
    'sha384',
    Buffer.from(input.thid, 'utf8'),
    seed,
    Buffer.from(attributeNameUrn, 'utf8'),
    DERIVED_SALT_BYTES,
  );
  return Buffer.from(derived).toString('base64url');
}

/**
 * Reconstructs the RFC 9901 disclosure that was committed by the issuer.
 *
 * This function is run by the requester with its retained `thid`, the seed
 * returned by the issuer, and the original attribute value already in the
 * requester's possession.
 */
export function reconstructAntifraudDisclosure(
  input: AntifraudAttributeNameInput & AntifraudRequestBoundClaim & Readonly<{
    thid: string;
    claimSaltSeed: string;
  }>,
): Readonly<{
  contents: [string, string, AntifraudAttributeValue];
  disclosure: string;
  digest: string;
}> {
  assertAttributeValue(input.attributeValue);
  const finalSalt = deriveAntifraudFinalClaimSalt(input);
  const contents: [string, string, AntifraudAttributeValue] = [
    finalSalt,
    input.attributeName,
    input.attributeValue,
  ];
  const disclosure = Buffer.from(JSON.stringify(contents), 'utf8').toString('base64url');
  const digest = createHash('sha384').update(disclosure, 'ascii').digest('base64url');
  return { contents, disclosure, digest };
}

/**
 * Builds the unsigned request-bound SD-JWT payload. Each canonical
 * attribute-name URN is an always-disclosed claim whose value is its seed.
 * Final salts and attribute values are absent. The caller signs the payload
 * with the tenant issuer key.
 */
export function buildAntifraudRequestBoundCommitments(input: AntifraudAttributeContextInput & Readonly<{
  thid: string;
  claims: readonly AntifraudRequestBoundClaim[];
  claimSaltSeedFactory?: () => string;
}>): Readonly<{
  sdJwtPayload: AntifraudSdJwtPayload;
}> {
  if (input.claims.length === 0) {
    throw new TypeError('Antifraud request must contain at least one claim.');
  }
  const seedFactory = input.claimSaltSeedFactory
    || (() => randomBytes(MINIMUM_SEED_BYTES).toString('base64url'));
  const seenNames = new Set<string>();
  const seenSeeds = new Set<string>();
  const commitments = input.claims.map((claim) => {
    if (seenNames.has(claim.attributeName)) {
      throw new TypeError(`Duplicate Antifraud identity attribute name: ${claim.attributeName}`);
    }
    seenNames.add(claim.attributeName);
    const claimSaltSeed = seedFactory();
    decodeSeed(claimSaltSeed);
    if (seenSeeds.has(claimSaltSeed)) {
      throw new TypeError('Every Antifraud claim requires a unique claim salt seed.');
    }
    seenSeeds.add(claimSaltSeed);
    const reconstructed = reconstructAntifraudDisclosure({
      ...input,
      ...claim,
      claimSaltSeed,
    });
    return {
      attributeName: claim.attributeName,
      claimSaltSeed,
      digest: reconstructed.digest,
    };
  });
  const seedClaims = Object.fromEntries(commitments
    .map(({ attributeName, claimSaltSeed }) => [
      buildAntifraudAttributeNameUrn({ ...input, attributeName }),
      claimSaltSeed,
    ] as const)
    .sort(([left], [right]) => left.localeCompare(right)));
  return {
    sdJwtPayload: {
      _sd_alg: 'sha-384',
      _sd: commitments.map(item => item.digest).sort(),
      ...seedClaims,
    },
  };
}

function decodeSeed(value: string): Buffer {
  const normalized = String(value || '').trim();
  if (!/^[A-Za-z0-9_-]+$/.test(normalized)) {
    throw new TypeError('Antifraud claim salt seed must use unpadded base64url.');
  }
  const decoded = Buffer.from(normalized, 'base64url');
  if (decoded.length < MINIMUM_SEED_BYTES
    || decoded.toString('base64url') !== normalized.replace(/=+$/u, '')) {
    throw new TypeError('Antifraud claim salt seed must contain at least 128 bits.');
  }
  return decoded;
}

function assertAttributeValue(value: unknown): asserts value is AntifraudAttributeValue {
  if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) return;
  throw new TypeError('Antifraud flat claim value must be a JSON scalar.');
}
