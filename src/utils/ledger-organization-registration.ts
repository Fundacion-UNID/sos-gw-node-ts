import { ManagerError } from 'gdc-common-utils-ts/utils/manager-error';
import { IssueType } from 'gdc-common-utils-ts/models/issue';
import { IncludedResource } from 'gdc-common-utils-ts/models/jsonapi';
import { ClaimsOrganizationSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { PublicJwk } from 'gdc-common-utils-ts/interfaces/Cryptography.types';
import { OrganizationConfig } from '../gdc-backend-utils-node/models/entity';
import { Sector } from 'gdc-common-utils-ts/models/urlPath';
import { PdfSignatureEvidence } from './pdf-evidence';
import { ILogger } from '../loggers/ILogger';
import { resolveOrganizationIdentityChannel } from './ledger';
import { ManageAssetOrganization } from '../blockchain/fabric/v3/manageAssetOrganization';
import { ManageAssetArtifact } from '../blockchain/fabric/v3/manageAssetArtifact';
import { ManageAssetArtifactEvent } from '../blockchain/fabric/v3/manageAssetArtifactEvent';
import { ManageAssetCryptographicKey } from '../blockchain/fabric/v3/manageAssetCryptographicKey';
import { ManageAssetSubjectKeyBinding } from '../blockchain/fabric/v3/manageAssetSubjectKeyBinding';
import type { CryptographicKeyLedgerPayload } from '../blockchain/fabric/v3/manageAssetCryptographicKey';
import { canonicalize } from './json-canon';
import {
  buildLegalSectorOrganizationAssetId,
  buildLegalSectorOrganizationUrn,
} from 'gdc-common-utils-ts/utils/legal-sector-organization-urn';
import { buildPublicAliasLedgerAssetId } from 'gdc-common-utils-ts/utils/same-as';
import {
  resolveLedgerOrganizationId,
  hashLedgerString,
  inferLedgerJwkUse,
  tryGetJwkThumbprint,
} from './ledger-organization-registration-helpers';

type LedgerConfig = {
  enabled?: boolean;
  mspId?: string;
  channelName?: string;
  chaincodeName?: string;
  schemaUrl?: string;
};

function getFabricErrorMessages(error: any): string[] {
  const details = Array.isArray(error?.details) ? error.details : [];
  return [
    String(error?.message || error || ''),
    ...details.map((detail: any) => String(detail?.message || '')),
  ].filter(Boolean);
}

function fabricErrorContains(error: any, token: string): boolean {
  return getFabricErrorMessages(error).some((message) => message.includes(token));
}

type VerifiableCredential = Record<string, unknown>;

/** Builds the stable signed meaning of an organization VC for retry checks. */
export function projectOrganizationCredentialIdentity(vc: VerifiableCredential): object {
  return {
    '@context': vc['@context'],
    type: Array.isArray(vc.type) ? [...vc.type].map(String).sort() : vc.type,
    issuer: vc.issuer,
    credentialSchema: vc.credentialSchema,
    credentialSubject: vc.credentialSubject,
    evidence: vc.evidence,
  };
}

export function isSameOrganizationCredentialIdentity(
  existingVc: VerifiableCredential,
  requestedVc: VerifiableCredential,
): boolean {
  return canonicalize(projectOrganizationCredentialIdentity(existingVc))
    === canonicalize(projectOrganizationCredentialIdentity(requestedVc));
}

async function ensureOrganizationRegistration(params: {
  manager: ManageAssetOrganization;
  logger: ILogger;
  mspId: string;
  ledgerOrgId: string;
  payload: { orgId: string; vc: VerifiableCredential };
}): Promise<void> {
  try {
    await params.manager.ensureOrganization(params.mspId, params.ledgerOrgId, params.payload);
  } catch (error: any) {
    if (!fabricErrorContains(error, 'ORGANIZATION_CONFLICT:')) throw error;
    let existing: any;
    try {
      existing = await params.manager.read(params.mspId, params.ledgerOrgId);
    } catch (readError: any) {
      params.logger.warn('[HostingManager] unable to inspect conflicting organization retry', {
        component: 'HostingManager.ensureOrganizationRegistration',
        orgId: params.ledgerOrgId,
        error: String(readError?.message || readError),
      });
      throw error;
    }
    if (!existing?.vc || !isSameOrganizationCredentialIdentity(existing.vc, params.payload.vc)) throw error;
    params.logger.warn('[HostingManager] resumed semantically identical organization ledger registration', {
      component: 'HostingManager.ensureOrganizationRegistration',
      orgId: params.ledgerOrgId,
      existingCredentialId: existing.vc?.id,
      requestedCredentialId: params.payload.vc?.id,
    });
  }
}

export async function registerOrganizationOnLedger(params: {
  ledgerConfig?: LedgerConfig;
  hostJurisdiction?: string;
  namespace: string;
  hostExternalDomain: string;
  logger: ILogger;
  orgId: string;
  organization: IncludedResource;
  config: OrganizationConfig;
  evidence?: PdfSignatureEvidence[];
  role: 'host' | 'tenant';
  sector: Sector;
  jurisdiction?: string;
}): Promise<void> {
  const mspId = params.ledgerConfig?.mspId || process.env.LEDGER_MSP_ID || process.env.HLF_MSP_ID_ORG1;
  if (!mspId) {
    throw new ManagerError('Ledger MSP ID is missing. Set LEDGER_MSP_ID.', IssueType.Exception);
  }

  const chaincodeName = params.ledgerConfig?.chaincodeName || process.env.LEDGER_ORG_CHAINCODE;
  const channelName = params.ledgerConfig?.channelName
    || resolveOrganizationIdentityChannel(params.jurisdiction || params.hostJurisdiction);
  const manager = new ManageAssetOrganization({ chaincodeName, channelName });
  const organizationClaims = (params.organization?.meta as any)?.claims || (params.config as any)?.claims;
  const ledgerOrgId = resolveLedgerOrganizationId(organizationClaims, params.orgId);

  const organizationVc = params.config.governanceVc || params.config.selfDescriptionVc;
  if (!organizationVc) {
    throw new ManagerError('Organization VC is missing for ledger registration.', IssueType.Exception);
  }
  const payload: { orgId: string; vc: VerifiableCredential } = {
    orgId: ledgerOrgId,
    vc: organizationVc as unknown as VerifiableCredential,
  };

  try {
    await ensureOrganizationRegistration({
      manager,
      logger: params.logger,
      mspId,
      ledgerOrgId,
      payload,
    });
    await registerOrganizationKeysOnLedger({
      logger: params.logger,
      mspId,
      channelName,
      orgId: ledgerOrgId,
      didDocumentId: params.config.didDocument?.id,
      verificationMethods: params.config.didDocument?.verificationMethod,
    });
    if (params.role === 'tenant') {
      await upsertOrganizationSectorHostingBindingOnLedger({
        mspId,
        channelName,
        organizationId: ledgerOrgId,
        organizationClaims,
        tenantDid: params.config.didDocument?.id,
        providerDomain: params.hostExternalDomain,
        sector: params.sector,
        jurisdiction: params.jurisdiction || params.hostJurisdiction,
        status: 'validated',
      });
    }
    await registerOrganizationArtifactsOnLedger({
      mspId,
      channelName,
      orgId: ledgerOrgId,
      role: params.role,
      evidence: params.evidence,
    });
  } catch (error: any) {
    const message = String(error?.message || error);
    if (fabricErrorContains(error, 'EvidenceAlreadyRegistered')) {
      throw new ManagerError('Evidence already registered for another organization.', IssueType.Conflict);
    }
    if (fabricErrorContains(error, 'ORGANIZATION_CONFLICT:')) {
      throw new ManagerError('Organization already exists on ledger with incompatible credential material.', IssueType.Conflict);
    }
    if (fabricErrorContains(error, 'CRYPTOGRAPHIC_KEY_CONFLICT:')) {
      throw new ManagerError('Cryptographic key already exists on ledger with incompatible ownership or material.', IssueType.Conflict);
    }
    if (fabricErrorContains(error, 'already exists')) {
      throw new ManagerError('Organization already registered on ledger.', IssueType.Conflict);
    }
    throw new ManagerError(`Ledger registration failed: ${message}`, IssueType.Exception);
  }
}

/**
 * Persists the current hosting provider for one legal organization and sector.
 * The stable asset id survives provider/DID rotation; artifact-sc history keeps
 * prior values. This is a GW payload change, not a chaincode or CCAAS change.
 */
export async function upsertOrganizationSectorHostingBindingOnLedger(params: {
  mspId: string;
  channelName: string;
  organizationId: string;
  organizationClaims: Record<string, unknown>;
  tenantDid?: string;
  providerDomain?: string;
  sector: Sector | string;
  jurisdiction?: string;
  status: 'validated' | 'revoked';
}): Promise<void> {
  const identifierType = String(
    params.organizationClaims[ClaimsOrganizationSchemaorg.identifierType] || '',
  ).trim();
  const identifierValue = String(
    params.organizationClaims[ClaimsOrganizationSchemaorg.identifierValue] || '',
  ).trim();
  const country = String(
    params.organizationClaims[ClaimsOrganizationSchemaorg.addressCountry]
      || params.jurisdiction
      || '',
  ).trim();
  const administrativeSublevel1 = String(
    params.organizationClaims[ClaimsOrganizationSchemaorg.addressRegion] || '',
  ).trim() || undefined;
  const tenantDid = String(params.tenantDid || '').trim();
  if (!identifierType || !identifierValue || !country || !tenantDid) {
    throw new ManagerError(
      'Organization sector hosting binding requires identifier type/value, country and tenant DID.',
      IssueType.Required,
    );
  }

  const legalSectorOrganizationUrn = buildLegalSectorOrganizationUrn({
    sector: String(params.sector),
    country,
    administrativeSublevel1,
    identifierType,
    identifierValue,
  });
  const artifactId = buildLegalSectorOrganizationAssetId(legalSectorOrganizationUrn);
  const manager = new ManageAssetArtifact({
    chaincodeName: process.env.LEDGER_ARTIFACT_CHAINCODE || 'artifact-sc',
    channelName: params.channelName,
  });
  const payload = {
    artifactId,
    hash: buildPublicAliasLedgerAssetId(tenantDid),
    hashAlg: 'sha3-384-multihash',
    artifactType: 'organization-sector-hosting-binding',
    declaredBy: params.organizationId,
    declaredByType: 'tenant',
    status: params.status,
    meta: {
      attributes: {
        organizationId: params.organizationId,
        legalSectorOrganizationUrn,
        sector: String(params.sector),
        tenantDid,
        providerDomain: String(params.providerDomain || '').trim() || undefined,
      },
    },
  };
  try {
    const existing = await manager.read(params.mspId, artifactId) as any;
    const existingMeaning = {
      artifactId: existing?.artifactId,
      hash: existing?.hash,
      hashAlg: existing?.hashAlg,
      artifactType: existing?.artifactType,
      declaredBy: existing?.declaredBy,
      declaredByType: existing?.declaredByType,
      status: existing?.status,
      meta: { attributes: existing?.meta?.attributes || {} },
    };
    if (canonicalize(existingMeaning) === canonicalize(payload)) return;
  } catch {
    // Read only avoids duplicate history. The authoritative upsert below still
    // surfaces real Fabric connectivity or endorsement failures.
  }
  await manager.upsertArtifact(params.mspId, artifactId, payload);
}

async function registerOrganizationKeysOnLedger(params: {
  logger: ILogger;
  mspId: string;
  channelName: string;
  orgId: string;
  didDocumentId?: string;
  verificationMethods?: Array<{ id?: string; publicKeyJwk?: PublicJwk }>;
}): Promise<void> {
  const methods = Array.isArray(params.verificationMethods) ? params.verificationMethods : [];
  const keyGroups = new Map<string, {
    keyId: string;
    publicKeyJwk: PublicJwk;
    verificationMethodIds: string[];
    thumbprint?: string;
  }>();
  for (const method of methods) {
    const publicKeyJwk = method?.publicKeyJwk as PublicJwk | undefined;
    if (!publicKeyJwk) continue;
    const thumbprint = tryGetJwkThumbprint(publicKeyJwk);
    const keyId = thumbprint
      || String(method?.id || '').trim()
      || String(publicKeyJwk.kid || '').trim()
      || `key_${hashLedgerString(JSON.stringify(publicKeyJwk)).slice(0, 32)}`;
    const methodId = String(method?.id || '').trim();
    const existing = keyGroups.get(keyId);
    if (existing) {
      if (canonicalize(existing.publicKeyJwk) !== canonicalize(publicKeyJwk)) {
        throw new ManagerError(
          `Verification methods resolve to the same ledger key id '${keyId}' with different public material.`,
          IssueType.Conflict,
        );
      }
      if (methodId && !existing.verificationMethodIds.includes(methodId)) {
        existing.verificationMethodIds.push(methodId);
      }
      continue;
    }
    keyGroups.set(keyId, {
      keyId,
      publicKeyJwk,
      verificationMethodIds: methodId ? [methodId] : [],
      ...(thumbprint ? { thumbprint } : {}),
    });
  }
  params.logger.debug('[HostingManager] ledger key registration start', {
    component: 'HostingManager.registerOrganizationKeysOnLedger',
    orgId: params.orgId,
    channelName: params.channelName,
    didDocumentId: params.didDocumentId,
    verificationMethodCount: methods.length,
    uniqueKeyCount: keyGroups.size,
  });
  if (keyGroups.size === 0) return;

  const keyManager = new ManageAssetCryptographicKey({
    chaincodeName: process.env.LEDGER_CRYPTOGRAPHIC_KEY_CHAINCODE || 'cryptographickey-sc',
    channelName: params.channelName,
  });
  const bindingManager = new ManageAssetSubjectKeyBinding({
    chaincodeName: process.env.LEDGER_SUBJECT_KEY_BINDING_CHAINCODE || 'subjectkeybinding-sc',
    channelName: params.channelName,
  });

  for (const group of keyGroups.values()) {
    const { publicKeyJwk, keyId, thumbprint, verificationMethodIds } = group;
    const use = String((publicKeyJwk as any)?.use || '').trim() || inferLedgerJwkUse(publicKeyJwk);
    const relationship = use === 'enc' ? 'organization-encryption' : 'organization-signing';

    const keyPayload: CryptographicKeyLedgerPayload = {
      keyId,
      orgId: params.orgId,
      kid: publicKeyJwk.kid,
      thumbprint: thumbprint || undefined,
      kty: publicKeyJwk.kty,
      crv: (publicKeyJwk as any).crv,
      alg: (publicKeyJwk as any).alg,
      use: use as CryptographicKeyLedgerPayload['use'],
      purpose: relationship,
      status: 'active',
      origin: 'did:web',
    };

    const ensuredKey = await keyManager.ensureKey(params.mspId, keyId, keyPayload);
    params.logger.debug('[HostingManager] ledger key ensured', {
      component: 'HostingManager.registerOrganizationKeysOnLedger',
      orgId: params.orgId,
      keyId,
      kid: publicKeyJwk.kid,
      created: ensuredKey.created,
      thumbprintMissing: !thumbprint,
      verificationMethodCount: verificationMethodIds.length,
    });

    const bindingId = `organization_${params.orgId}__${keyId}`;
    await bindingManager.upsertSubjectKeyBinding(params.mspId, bindingId, {
      bindingId,
      subjectType: 'organization',
      subjectId: params.orgId,
      parentOrgId: params.orgId,
      keyId,
      relationship,
      status: 'active',
      meta: {
        attributes: {
          did: params.didDocumentId,
          verificationMethodId: verificationMethodIds[0],
          verificationMethodIds,
          kid: publicKeyJwk.kid,
          thumbprintMissing: !thumbprint,
        },
      },
    });
    params.logger.debug('[HostingManager] ledger subject-key binding upserted', {
      component: 'HostingManager.registerOrganizationKeysOnLedger',
      orgId: params.orgId,
      bindingId,
      keyId,
    });
  }
}

async function registerOrganizationArtifactsOnLedger(params: {
  mspId: string;
  channelName: string;
  orgId: string;
  role: 'host' | 'tenant';
  evidence?: PdfSignatureEvidence[];
}): Promise<void> {
  const evidenceList = Array.isArray(params.evidence) ? params.evidence : [];
  if (evidenceList.length === 0) return;

  const artifactManager = new ManageAssetArtifact({
    chaincodeName: process.env.LEDGER_ARTIFACT_CHAINCODE || 'artifact-sc',
    channelName: params.channelName,
  });
  const eventManager = new ManageAssetArtifactEvent({
    chaincodeName: process.env.LEDGER_ARTIFACT_EVENT_CHAINCODE || 'artifactevent-sc',
    channelName: params.channelName,
  });

  for (const evidence of evidenceList) {
    const signedDigest = evidence?.digest?.find((item) => item?.type === 'SignedDocumentHash');
    const unsignedDigest = evidence?.digest?.find((item) => item?.type === 'DocumentHash');
    const signedHash = signedDigest?.hashValue;
    const signedAlg = String(signedDigest?.hashAlg || 'SHA256').toLowerCase();
    if (!signedHash) continue;

    const artifactId = `artifact_${signedAlg}_${signedHash}`;
    await artifactManager.upsertArtifact(params.mspId, artifactId, {
      artifactId,
      hash: signedHash,
      hashAlg: signedAlg,
      artifactType: 'pdf',
      declaredBy: params.orgId,
      declaredByType: params.role,
      status: 'declared',
      meta: {
        attributes: {
          unsignedDocumentHash: unsignedDigest?.hashValue,
          unsignedDocumentHashAlg: unsignedDigest?.hashAlg,
          signatureType: evidence?.signature?.type,
        },
      },
    });

    const eventHashSource = JSON.stringify(evidence);
    const eventId = `${artifactId}__signature-observed-${hashLedgerString(eventHashSource).slice(0, 24)}`;
    try {
      await eventManager.createArtifactEvent(params.mspId, eventId, {
        eventId,
        artifactId,
        eventType: 'declaration',
        eventSubType: 'pdf-signature-observed',
        actor: params.orgId,
        actorType: params.role,
        status: 'active',
        artifactHash: signedHash,
        artifactHashAlg: signedAlg,
        evidenceHash: hashLedgerString(eventHashSource),
        evidenceHashAlg: 'sha256',
        meta: {
          attributes: {
            x5cLength: Array.isArray(evidence?.x5c) ? evidence.x5c.length : 0,
            signatureType: evidence?.signature?.type,
          },
        },
      });
    } catch (error: any) {
      if (!fabricErrorContains(error, 'already exists')) throw error;
    }
  }
}
