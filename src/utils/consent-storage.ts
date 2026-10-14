import { createHash } from 'crypto';
import { ConsentRule, ClaimConsent } from 'gdc-common-utils-ts/models/consent-rule';
import { RecordBase } from 'gdc-common-utils-ts/models/resource-document';
import { IVaultRepository } from '../database/repositories/vault/vault.repository';
import { getClaimValue } from './claims';
import { buildConsentRuleStorageKey, expandConsentActorRoles, hashConsentRuleId } from './consent';
import { getIndividualSectionId, getSubjectScopedSectionId } from './individual-sections';
import { applyDigitalTwinSecondaryUseDecision } from './digital-twin-secondary-use';
import type { IBlockchainAdapter } from '../adapters/IBlockchainAdapter';
import type { OperationOutcome } from 'gdc-common-utils-ts/models/operation-outcome';
import { HealthcareConsentPurposes } from 'gdc-common-utils-ts/constants/healthcare';
import { ServiceCapability } from 'gdc-common-utils-ts/constants/service-capabilities';
import { DataspaceSectors } from 'gdc-common-utils-ts/constants/sectors';
import {
  ClaimsFirstAnimalInsuranceConsent,
  validateAnimalInsuranceConsentOdrlParity,
} from 'vet-data-utils-ts/insurance-consent';

export const requiredConsentClaims = [
  ClaimConsent.decision,
  ClaimConsent.subject,
  ClaimConsent.identifier,
  ClaimConsent.date,
  ClaimConsent.purpose,
  ClaimConsent.action,
  ClaimConsent.actorRole,
  ClaimConsent.attachmentContentType,
  ClaimConsent.attachmentData,
];

const requiredConsentRuleClaims = requiredConsentClaims.filter((claim) => (
  claim !== ClaimConsent.identifier
  && claim !== ClaimConsent.attachmentContentType
  && claim !== ClaimConsent.attachmentData
));

export function isDigitalTwinSecondaryUseConsent(claims: Record<string, any>): boolean {
  const purpose = String(getClaimValue(claims, ClaimConsent.purpose) || '').trim().toUpperCase();
  const actions = String(getClaimValue(claims, ClaimConsent.action) || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return (
    purpose === HealthcareConsentPurposes.Research || purpose === 'RESEARCH'
  ) && actions.some((action) => (
    action === ServiceCapability.DigitalTwinReader || action === ServiceCapability.DigitalTwinProvider
  ));
}

export function requiredConsentClaimsFor(claims: Record<string, any>): readonly ClaimConsent[] {
  return isDigitalTwinSecondaryUseConsent(claims)
    ? [...requiredConsentRuleClaims, ClaimConsent.sourceReference]
    : requiredConsentClaims;
}

function setClaimValue(claims: Record<string, any>, key: ClaimConsent, value: string): void {
  const context = String(claims['@context'] || '').trim();
  if (context) {
    const prefix = context.endsWith('.') ? context : `${context}.`;
    claims[`${prefix}${key}`] = value;
    delete claims[key];
    return;
  }
  claims[key] = value;
}

function uuidFromHash(seed: string): string {
  const bytes = createHash('sha256').update(seed, 'utf8').digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Assigns and reuses GW's private identifier for one portal/software/study
 * consent. The caller owns only the stable `Consent.source-reference`.
 */
export function ensureDigitalTwinSecondaryUseConsentIdentifier(input: {
  tenantVaultId: string;
  sector: string;
  claims: Record<string, any>;
}): string | undefined {
  if (!isDigitalTwinSecondaryUseConsent(input.claims)) return undefined;
  const subjectId = String(getClaimValue(input.claims, ClaimConsent.subject) || '').trim();
  const actorIdentifier = String(
    getClaimValue(input.claims, ClaimConsent.actorIdentifier)
    || getClaimValue(input.claims, 'Consent.actor-reference')
    || '',
  ).trim();
  const purpose = String(getClaimValue(input.claims, ClaimConsent.purpose) || '').trim().toUpperCase();
  const sourceReference = String(getClaimValue(input.claims, ClaimConsent.sourceReference) || '').trim();
  if (!sourceReference) throw new Error(`Missing required claim: ${ClaimConsent.sourceReference}`);
  if (!subjectId) throw new Error(`Missing required claim: ${ClaimConsent.subject}`);
  if (!actorIdentifier) throw new Error(`Missing required claim: ${ClaimConsent.actorIdentifier}`);

  const semanticKey = [
    input.tenantVaultId.trim(), input.sector.trim(), subjectId, actorIdentifier,
    purpose, ServiceCapability.DigitalTwinReader, sourceReference,
  ].join('|');
  const identifier = `urn:uuid:${uuidFromHash(semanticKey)}`;
  setClaimValue(input.claims, ClaimConsent.identifier, identifier);
  return identifier;
}

export type PersistConsentRuleInput = {
  vaultRepository: IVaultRepository;
  tenantVaultId: string;
  sector: string;
  jurisdiction?: string;
  claims: Record<string, any>;
  researchTags?: string[];
  blockchainAdapter?: IBlockchainAdapter;
};

export function resolveConsentRuleStorageIdentity(input: PersistConsentRuleInput): {
  subjectId: string;
  ruleId: string;
} {
  const { tenantVaultId, sector, claims } = input;
  const subjectId = getClaimValue<string>(claims, ClaimConsent.subject);
  if (!subjectId) throw new Error(`Missing required claim: ${ClaimConsent.subject}`);
  const actorIdentifier = getClaimValue<string>(claims, ClaimConsent.actorIdentifier)
    ?? getClaimValue<string>(claims, 'Consent.actor-reference');
  if (!actorIdentifier) throw new Error(`Missing required claim: ${ClaimConsent.actorIdentifier}`);
  const baseRuleKey = buildConsentRuleStorageKey({
    subjectId,
    sector,
    target: actorIdentifier,
    decision: getClaimValue<string>(claims, ClaimConsent.decision) as string,
    purpose: getClaimValue<string>(claims, ClaimConsent.purpose) as string,
  });
  const sourceReference = String(getClaimValue(claims, ClaimConsent.sourceReference) || '').trim();
  const ruleKey = isDigitalTwinSecondaryUseConsent(claims)
    ? `${baseRuleKey}|${sourceReference}`
    : baseRuleKey;
  return { subjectId, ruleId: hashConsentRuleId(ruleKey) };
}

/** Removes both local projections; callers must publish a revoked ledger state separately. */
export async function deleteConsentRule(input: PersistConsentRuleInput): Promise<void> {
  const { subjectId, ruleId } = resolveConsentRuleStorageIdentity(input);
  await input.vaultRepository.delete(
    input.tenantVaultId, ruleId, getIndividualSectionId(subjectId, 'rules'),
  );
  await input.vaultRepository.delete(
    input.tenantVaultId, ruleId, getSubjectScopedSectionId(subjectId, 'individual', 'consents'),
  );
}

export async function persistConsentRuleAndAttachment(
  input: PersistConsentRuleInput,
): Promise<{ subjectId: string; attachmentHash?: string; ruleId: string; warnings?: OperationOutcome[] }> {
  const { vaultRepository, tenantVaultId, sector, claims, researchTags } = input;

  if (sector === DataspaceSectors.AnimalInsurance) {
    const scalarClaims = Object.fromEntries([
      ['@context', String(claims['@context'] || 'org.hl7.fhir.api')],
      ...Object.values(ClaimConsent).map((claimName) => [
        claimName,
        String(getClaimValue(claims, claimName) || ''),
      ]),
    ]);
    validateAnimalInsuranceConsentOdrlParity({
      resourceType: 'Consent',
      id: String(getClaimValue(claims, ClaimConsent.identifier) || ''),
      meta: { claims: scalarClaims },
    } as ClaimsFirstAnimalInsuranceConsent);
  }

  const actorRoles = getClaimValue<string>(claims, ClaimConsent.actorRole);
  if (actorRoles) {
    const normalizedActorRoles = expandConsentActorRoles(actorRoles, 'auto').join(',');
    const context = claims['@context'];
    const contextualizedKey = typeof context === 'string' && context.length > 0
      ? `${context.replace(/\.$/, '')}.${ClaimConsent.actorRole}`
      : ClaimConsent.actorRole;
    if (claims[contextualizedKey] !== undefined) {
      claims[contextualizedKey] = normalizedActorRoles;
    } else {
      claims[ClaimConsent.actorRole] = normalizedActorRoles;
    }
  }

  const actorIdentifier =
    getClaimValue<string>(claims, ClaimConsent.actorIdentifier) ??
    getClaimValue<string>(claims, 'Consent.actor-reference');

  if (actorIdentifier) {
    const context = claims['@context'];
    if (typeof context === 'string' && context.length > 0) {
      const prefixedKey = context.endsWith('.')
        ? `${context}${ClaimConsent.actorIdentifier}`
        : `${context}.${ClaimConsent.actorIdentifier}`;
      if (claims[prefixedKey] === undefined) claims[prefixedKey] = actorIdentifier;
    } else if (claims[ClaimConsent.actorIdentifier] === undefined) {
      claims[ClaimConsent.actorIdentifier] = actorIdentifier;
    }
  }

  for (const claimKey of requiredConsentClaimsFor(claims)) {
    if (!getClaimValue(claims, claimKey)) {
      throw new Error(`Missing required claim: ${claimKey}`);
    }
  }
  if (!actorIdentifier) {
    throw new Error(`Missing required claim: ${ClaimConsent.actorIdentifier}`);
  }

  const { subjectId, ruleId } = resolveConsentRuleStorageIdentity(input);

  const attachmentDataBase64 = getClaimValue<string>(claims, ClaimConsent.attachmentData);
  const attachmentContentType = getClaimValue<string>(claims, ClaimConsent.attachmentContentType);
  let attachmentHash: string | undefined;
  if (attachmentDataBase64 || attachmentContentType) {
    if (!attachmentDataBase64 || !attachmentContentType) {
      throw new Error('Consent attachment content type and data must be provided together.');
    }
    const decodedData = Buffer.from(attachmentDataBase64, 'base64');
    attachmentHash = createHash('sha3-384').update(decodedData).digest('hex');
    const attachmentRecord: RecordBase & { data: string; contentType: string } = {
      id: attachmentHash, data: attachmentDataBase64, contentType: attachmentContentType,
    };
    await vaultRepository.put(
      tenantVaultId, [attachmentRecord], getIndividualSectionId(subjectId, 'attachments'),
    );
  }

  const isDigitalTwinResearchConsent = isDigitalTwinSecondaryUseConsent(claims);

  const ruleToStore: Record<string, any> = { ...claims };
  const context = ruleToStore['@context'];
  // Ordinary care permissions retain their stable address-book reference so
  // contact lifecycle checks can find them. Pseudonymous research projection
  // instead keeps only the external actor identifier and source reference.
  if (typeof context === 'string' && context.length > 0) {
    const prefix = context.endsWith('.') ? context : `${context}.`;
    delete ruleToStore[`${prefix}${ClaimConsent.attachmentData}`];
    if (isDigitalTwinResearchConsent) delete ruleToStore[`${prefix}Consent.actor-reference`];
    if (attachmentHash) ruleToStore[`${prefix}${ClaimConsent.attachmentId}`] = attachmentHash;
  }
  delete ruleToStore[ClaimConsent.attachmentData];
  if (isDigitalTwinResearchConsent) delete ruleToStore['Consent.actor-reference'];
  if (attachmentHash) ruleToStore[ClaimConsent.attachmentId] = attachmentHash;

  const consentRule: ConsentRule & RecordBase = {
    ...(ruleToStore as any),
    id: ruleId,
  };
  if (researchTags && researchTags.length > 0) {
    (consentRule as any).meta = { tag: researchTags };
    (consentRule as any).tag = researchTags;
  }

  await vaultRepository.put(tenantVaultId, [consentRule], getIndividualSectionId(subjectId, 'rules'));
  await vaultRepository.put(
    tenantVaultId,
    [consentRule],
    getSubjectScopedSectionId(subjectId, 'individual', 'consents'),
  );
  const warnings: OperationOutcome[] = [];
  await applyDigitalTwinSecondaryUseDecision({
    vaultRepository,
    tenantVaultId,
    claims,
    sector,
    jurisdiction: input.jurisdiction,
    blockchainAdapter: input.blockchainAdapter,
    warnings,
  });
  return { subjectId, attachmentHash, ruleId, ...(warnings.length ? { warnings } : {}) };
}
