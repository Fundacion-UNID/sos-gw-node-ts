import { randomUUID } from 'node:crypto';
import type { BundleEntry } from 'gdc-common-utils-ts/models/bundle';
import type { JobRequest } from 'gdc-common-utils-ts/models/confidential-job';
import type { IDecodedDidcommPayload } from 'gdc-common-utils-ts/models/confidential-message';
import type { ConfidentialStorageDoc } from 'gdc-common-utils-ts/models/confidential-storage';
import {
  buildSubjectIdentifierAssetId,
  readSubjectIdentityBundleEntry,
} from 'gdc-common-utils-ts/utils/subject-identity';
import { ClaimsOrganizationSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { IssueType } from 'gdc-common-utils-ts/models/issue';
import { ManagerError } from 'gdc-common-utils-ts/utils/manager-error';
import type { IVaultRepository } from '../database/repositories/vault/vault.repository';
import type { IKmsService } from '../gdc-backend-utils-node/models/IKmsService';
import type { ITenantsManager } from './ITenantsManager';
import type { IJobProcessor } from './registry';
import { getTenantVaultId } from '../utils/tenant';
import { getIndividualSectionId } from '../utils/individual-sections';
import { getEnvSectionId } from '../utils/section-env';
import { SUBJECT_SECTION_INDIVIDUAL } from '../constants/domain';
import { normalizeIndexedEmail, normalizeIndexedPhone } from '../utils/indexed-contact';
import {
  type AntifraudAttributeValue,
  buildAntifraudRequestBoundCommitments,
} from '../utils/antifraud-request-bound-sd-jwt';

const SUBJECT_IDENTITIES_SECTION = 'subject-identities';
const SUBJECT_MATCH_INDEX_SECTION = getEnvSectionId('subject-identity-match-index');
const INDIVIDUAL_DIRECTORY_SECTION = getEnvSectionId(SUBJECT_SECTION_INDIVIDUAL);
const URI_IDENTIFIER_SYSTEM = 'urn:ietf:rfc:3986';

export type SubjectIdentityLedgerPort = Readonly<{
  upsert(input: Readonly<{
    assetId: string;
  }>): Promise<void>;
  delete(input: Readonly<{ assetId: string }>): Promise<void>;
}>;

/**
 * Encrypted collection manager for identities associated with public cards.
 *
 * `Subject` is only the operation/collection name. Bundle entries remain
 * semantic `Person`, `Animal` or future `Place` resources. Complete claims are
 * encrypted in the tenant vault; only the derived asset id and public
 * card/provider pointer may cross the optional Fabric port.
 */
export class SubjectIdentityManager implements IJobProcessor {
  constructor(
    private readonly vaultRepository: IVaultRepository,
    private readonly kmsService: IKmsService,
    private readonly tenantsManager: Pick<ITenantsManager, 'getCollectionName' | 'getTenantDid'>,
    private readonly ledger?: SubjectIdentityLedgerPort,
  ) {}

  async process(job: JobRequest): Promise<IDecodedDidcommPayload> {
    const thid = String(job.content?.thid || '').trim();
    if (!thid || !job.tenantId || !job.sector) {
      throw new ManagerError('Missing Subject collection routing data.', IssueType.Required);
    }
    const tenantVaultId = getTenantVaultId(job.sector, job.tenantId);
    const collectionName = await this.tenantsManager.getCollectionName(tenantVaultId);
    if (!collectionName) throw new ManagerError(`Tenant not found: ${tenantVaultId}`, IssueType.NotFound);
    const body = (job.content?.body || {}) as any;

    if (job.action === '$hashed-claims-issue') {
      return this.issueHashedClaims(job, collectionName, tenantVaultId, body);
    }

    if (job.action === '$match') {
      return this.matchPatient(job, collectionName, tenantVaultId, body);
    }

    let entries: BundleEntry[];
    let responseStatus = '200';
    if (job.action === '_batch') {
      const submitted = this.readEntries(body);
      if (submitted.length === 0) throw new ManagerError('Subject _batch requires at least one Person, Animal or Place entry.', IssueType.Required);
      entries = [];
      for (const entry of submitted) {
        const association = readSubjectIdentityBundleEntry(entry);
        await this.assertControllerAccess(job, collectionName, association.cardId);
        const now = new Date().toISOString();
        const storedEntry: BundleEntry = {
          ...entry,
          id: association.assetId,
          fullUrl: association.assetId,
          resource: {
            ...entry.resource,
            id: association.assetId,
            meta: { ...(entry.resource?.meta || {}), lastUpdated: now },
          },
        };
        const confidential: ConfidentialStorageDoc = {
          id: association.assetId,
          sequence: 0,
          status: 'active',
          content: storedEntry as any,
        };
        const protectedDoc = await this.kmsService.protectConfidentialData(confidential, tenantVaultId);
        await this.vaultRepository.put(
          collectionName,
          [protectedDoc],
          getIndividualSectionId(association.cardId, SUBJECT_IDENTITIES_SECTION),
        );
        const protectedMatchPointer = await this.kmsService.protectConfidentialData({
          id: association.assetId,
          sequence: 0,
          status: 'active',
          content: { cardId: association.cardId },
        }, tenantVaultId);
        await this.vaultRepository.put(collectionName, [protectedMatchPointer], SUBJECT_MATCH_INDEX_SECTION);
        await this.ledger?.upsert({ assetId: association.assetId });
        entries.push({ ...storedEntry, response: { status: '201' } });
      }
      responseStatus = '201';
    } else if (job.action === '_search') {
      const cardId = this.readParameter(body, 'card');
      if (!cardId) throw new ManagerError('Subject _search requires the public card parameter.', IssueType.Required);
      await this.assertControllerAccess(job, collectionName, cardId);
      entries = await this.readCardEntries(collectionName, tenantVaultId, cardId);
    } else if (job.action === '_delete') {
      const cardId = this.readParameter(body, 'card');
      const codingSystem = this.readParameter(body, 'coding-system');
      const jurisdiction = this.readParameter(body, 'jurisdiction');
      const codeValue = this.readParameter(body, 'code-value');
      if (!cardId || !codingSystem || !this.hasParameter(body, 'jurisdiction') || !codeValue) {
        throw new ManagerError(
          'Subject _delete requires card, coding-system, jurisdiction (possibly empty) and code-value.',
          IssueType.Required,
        );
      }
      await this.assertControllerAccess(job, collectionName, cardId);
      const assetId = buildSubjectIdentifierAssetId({ codingSystem, jurisdiction, codeValue });
      await this.vaultRepository.delete(
        collectionName,
        assetId,
        getIndividualSectionId(cardId, SUBJECT_IDENTITIES_SECTION),
      );
      await this.vaultRepository.delete(collectionName, assetId, SUBJECT_MATCH_INDEX_SECTION);
      await this.ledger?.delete({ assetId });
      entries = [{
        id: assetId,
        type: 'Subject-identity-delete-response-v1.0',
        response: { status: '204' },
      }];
      responseStatus = '204';
    } else {
      throw new ManagerError(`Unsupported Subject collection action: ${job.action}`, IssueType.NotSupported);
    }

    return {
      jti: randomUUID(),
      type: 'subject-identity-response',
      thid,
      iss: String(job.content?.aud || ''),
      aud: String(job.content?.iss || ''),
      exp: Math.floor(Date.now() / 1000) + 300,
      body: {
        resourceType: 'Bundle',
        type: `${job.action}-response`,
        total: entries.length,
        data: entries,
        response: { status: responseStatus },
      } as any,
    };
  }

  private readEntries(body: any): BundleEntry[] {
    const candidates = body?.data || body?.entry || [];
    return Array.isArray(candidates) ? candidates as BundleEntry[] : [];
  }

  /**
   * Issues the VetChain pilot of the Antifraud request-bound SD-JWT profile.
   *
   * The operation accepts ResourceType-first flat claims in a Parameters body.
   * `Parameters.id` must be the encrypted DIDComm request `thid`. Supplied
   * values are compared with encrypted issuer evidence and never returned.
   * Each canonical attribute-name URN in the signed JWT contains only the seed
   * needed by the requester to reconstruct the undisclosed final salt.
   */
  private async issueHashedClaims(
    job: JobRequest,
    collectionName: string,
    tenantVaultId: string,
    body: any,
  ): Promise<IDecodedDidcommPayload> {
    const thid = String(job.content?.thid || '').trim();
    if (body?.resourceType !== 'Parameters' || String(body.id || '').trim() !== thid) {
      throw new ManagerError('Antifraud Parameters.id must equal the DIDComm thid.', IssueType.Value);
    }
    const resourceType = String(job.resourceType || '').trim();
    const subjectKind = resourceType === 'Animal'
      ? 'animal'
      : resourceType === 'Person'
        ? 'personal'
        : undefined;
    if (!subjectKind) {
      throw new ManagerError('Antifraud hashed claims currently require Person or Animal.', IssueType.NotSupported);
    }
    const context = job.format === 'org.schema' || job.format === 'org.hl7.fhir.api'
      ? job.format
      : undefined;
    if (!context) {
      throw new ManagerError('Antifraud hashed claims require org.schema or org.hl7.fhir.api format.', IssueType.NotSupported);
    }
    const requestedClaims = this.readAntifraudParameters(body, resourceType);
    const byName = new Map(requestedClaims.map(claim => [claim.attributeName, claim.attributeValue]));
    const codingSystem = this.requiredStringClaim(byName, `${resourceType}.identifier.additionalType`);
    const jurisdiction = this.requiredPresentStringClaim(byName, `${resourceType}.identifier.jurisdiction`);
    const codeValue = this.requiredStringClaim(byName, `${resourceType}.identifier.value`);
    const assetId = buildSubjectIdentifierAssetId({ codingSystem, jurisdiction, codeValue });
    const pointerDoc = await this.vaultRepository.get<ConfidentialStorageDoc>(
      collectionName,
      assetId,
      SUBJECT_MATCH_INDEX_SECTION,
    );
    if (!pointerDoc) {
      throw new ManagerError('The requested claims do not match issuer evidence.', IssueType.Forbidden);
    }
    const pointer = pointerDoc.content
      ? pointerDoc.content as any
      : await this.kmsService.unprotectConfidentialData<{ cardId: string }>(pointerDoc, tenantVaultId);
    const cardId = String(pointer?.cardId || '').trim();
    if (!cardId) {
      throw new ManagerError('The requested claims do not match issuer evidence.', IssueType.Forbidden);
    }
    await this.assertControllerAccess(job, collectionName, cardId);
    const entries = await this.readCardEntries(collectionName, tenantVaultId, cardId);
    const evidence = entries.find(candidate => (
      candidate.resource?.resourceType === resourceType
      && String(candidate.resource?.id || candidate.id || '') === assetId
    ));
    const evidenceClaims = evidence?.resource?.meta?.claims || {};
    const matches = requestedClaims.every(({ attributeName, attributeValue }) => (
      Object.is(evidenceClaims[`${context}.${attributeName}`], attributeValue)
    ));
    if (!matches) {
      throw new ManagerError('The requested claims do not match issuer evidence.', IssueType.Forbidden);
    }

    const commitments = buildAntifraudRequestBoundCommitments({
      thid,
      jurisdiction: String(job.jurisdiction || '').trim(),
      subjectKind,
      context,
      claims: requestedClaims,
    });
    const issuerDid = await this.tenantsManager.getTenantDid(tenantVaultId);
    const signingKey = await this.kmsService.getPublicVerificationKey(tenantVaultId, undefined, 'vc_sign');
    if (!issuerDid || !signingKey?.kid) {
      throw new ManagerError('Antifraud issuer signing identity is unavailable.', IssueType.Exception);
    }
    const now = Math.floor(Date.now() / 1000);
    const issuerSignedJwt = await this.kmsService.createCompactJws({
      iss: issuerDid,
      aud: String(job.content?.iss || ''),
      iat: now,
      nbf: now,
      exp: now + 300,
      ...commitments.sdJwtPayload,
    }, signingKey.kid, tenantVaultId, 'vc_sign', { typ: 'sd+jwt' });

    return {
      jti: randomUUID(),
      type: 'antifraud-hashed-claims-issue-response',
      thid,
      iss: issuerDid,
      aud: String(job.content?.iss || ''),
      exp: now + 300,
      body: {
        resourceType: 'Parameters',
        id: thid,
        parameter: [{ name: 'verifiableCredential', valueString: `${issuerSignedJwt}~` }],
      } as any,
    };
  }

  private readAntifraudParameters(body: any, resourceType: string): Array<{
    attributeName: string;
    attributeValue: AntifraudAttributeValue;
  }> {
    if (!Array.isArray(body.parameter) || body.parameter.length === 0) {
      throw new ManagerError('Antifraud Parameters requires at least one flat claim.', IssueType.Required);
    }
    return body.parameter.map((parameter: any) => {
      const attributeName = String(parameter?.name || '').trim();
      if (!attributeName.startsWith(`${resourceType}.`)) {
        throw new ManagerError('Antifraud parameter names must be ResourceType-first flat claims.', IssueType.Value);
      }
      const valueKeys = Object.keys(parameter || {}).filter(key => /^value[A-Z]/.test(key));
      if (valueKeys.length !== 1) {
        throw new ManagerError(`Antifraud flat claim '${attributeName}' requires exactly one value[x].`, IssueType.Structure);
      }
      const attributeValue = parameter[valueKeys[0]];
      if (attributeValue !== null && !['string', 'number', 'boolean'].includes(typeof attributeValue)) {
        throw new ManagerError(`Antifraud flat claim '${attributeName}' must have a scalar value.`, IssueType.Value);
      }
      return { attributeName, attributeValue };
    });
  }

  private requiredStringClaim(
    claims: ReadonlyMap<string, AntifraudAttributeValue>,
    name: string,
  ): string {
    const value = claims.get(name);
    if (typeof value !== 'string' || !value.trim()) {
      throw new ManagerError(`Antifraud Parameters requires '${name}'.`, IssueType.Required);
    }
    return value;
  }

  private requiredPresentStringClaim(
    claims: ReadonlyMap<string, AntifraudAttributeValue>,
    name: string,
  ): string {
    const value = claims.get(name);
    if (typeof value !== 'string') {
      throw new ManagerError(`Antifraud Parameters requires '${name}'.`, IssueType.Required);
    }
    return value;
  }

  private async matchPatient(
    job: JobRequest,
    collectionName: string,
    tenantVaultId: string,
    rawBody: any,
  ): Promise<IDecodedDidcommPayload> {
    const bearer = (job.content as any)?.meta?.bearer?.jwt?.payload;
    if (!bearer || typeof bearer !== 'object') {
      throw new ManagerError('Patient $match requires an authenticated caller.', IssueType.Forbidden);
    }
    const body = this.unwrapMatchParameters(rawBody);
    const resourceParameter = body.parameter?.find?.((item: any) => item?.name === 'resource');
    const patient = resourceParameter?.resource;
    const identifiers = Array.isArray(patient?.identifier) ? patient.identifier : [];
    if (patient?.resourceType !== 'Patient' || identifiers.length !== 1) {
      throw new ManagerError('Patient $match requires exactly one Patient identifier.', IssueType.Required);
    }
    const identifier = identifiers[0];
    const system = String(identifier?.system || '').trim();
    const value = String(identifier?.value || '').trim();
    if (!system || !value) {
      throw new ManagerError('Patient $match identifier requires system and value.', IssueType.Required);
    }
    const onlyCertain = body.parameter?.find?.((item: any) => item?.name === 'onlyCertainMatches')?.valueBoolean;
    if (onlyCertain !== true) {
      throw new ManagerError('Patient $match requires onlyCertainMatches=true.', IssueType.Value);
    }
    let cardId = '';
    if (system === URI_IDENTIFIER_SYSTEM && /^(?:did|urn|https):\S+$/i.test(value)) {
      cardId = value;
    } else {
      const assetId = buildSubjectIdentifierAssetId({ codingSystem: system, jurisdiction: '', codeValue: value });
      const pointerDoc = await this.vaultRepository.get<ConfidentialStorageDoc>(
        collectionName,
        assetId,
        SUBJECT_MATCH_INDEX_SECTION,
      );
      if (pointerDoc) {
        const pointer = pointerDoc.content
          ? pointerDoc.content as any
          : await this.kmsService.unprotectConfidentialData<{ cardId: string }>(pointerDoc, tenantVaultId);
        cardId = String(pointer?.cardId || '').trim();
      }
    }

    const matches = cardId
      ? await this.readCardEntries(collectionName, tenantVaultId, cardId)
      : [];
    const entry = matches.length > 0 ? [{
      resource: {
        resourceType: 'Patient',
        identifier: [{ system: URI_IDENTIFIER_SYSTEM, value: cardId }],
      },
      search: {
        mode: 'match',
        score: 1,
        extension: [{
          url: 'http://hl7.org/fhir/StructureDefinition/match-grade',
          valueCode: 'certain',
        }],
      },
    }] : [];
    const now = Math.floor(Date.now() / 1000);
    return {
      jti: randomUUID(),
      type: 'patient-match-response',
      thid: String(job.content?.thid || ''),
      iss: String(job.content?.aud || ''),
      aud: String(job.content?.iss || ''),
      exp: now + 300,
      body: { resourceType: 'Bundle', type: 'searchset', total: entry.length, entry } as any,
    };
  }

  private unwrapMatchParameters(body: any): any {
    if (body?.resourceType === 'Parameters') return body;
    const entries = Array.isArray(body?.data) ? body.data : [];
    if (entries.length !== 1
      || String(entries[0]?.request?.method || '').toUpperCase() !== 'POST'
      || String(entries[0]?.request?.url || '').replace(/^\//, '') !== 'Patient/$match'
      || entries[0]?.resource?.resourceType !== 'Parameters') {
      throw new ManagerError(
        'DIDComm Patient $match requires one POST Patient/$match entry containing Parameters.',
        IssueType.Structure,
      );
    }
    return entries[0].resource;
  }

  private readParameter(body: any, name: string): string {
    if (body?.resourceType !== 'Parameters') return '';
    return String(body.parameter?.find?.((entry: any) => entry?.name === name)?.valueString || '').trim();
  }

  private hasParameter(body: any, name: string): boolean {
    return body?.resourceType === 'Parameters'
      && Array.isArray(body.parameter)
      && body.parameter.some((entry: any) => entry?.name === name);
  }

  private async readCardEntries(
    collectionName: string,
    tenantVaultId: string,
    cardId: string,
  ): Promise<BundleEntry[]> {
    const docs = await this.vaultRepository.getContainersInSection<ConfidentialStorageDoc>(
      collectionName,
      getIndividualSectionId(cardId, SUBJECT_IDENTITIES_SECTION),
    );
    const entries = await Promise.all((docs || []).map(async (doc) => {
      if (doc.content) return doc.content as unknown as BundleEntry;
      return this.kmsService.unprotectConfidentialData<BundleEntry>(doc, tenantVaultId);
    }));
    return entries.sort((left, right) => String(left.id || '').localeCompare(String(right.id || '')));
  }

  private async assertControllerAccess(job: JobRequest, collectionName: string, cardId: string): Promise<void> {
    const bearer = (job.content as any)?.meta?.bearer?.jwt?.payload || {};
    const scope = String(bearer.scope || '');
    const scopedCards = scope.split(/\s+/).flatMap((token) => {
      const query = token.includes('?') ? token.slice(token.indexOf('?') + 1) : '';
      const params = new URLSearchParams(query);
      return [...params.getAll('subject'), ...params.getAll('patient')];
    });
    if (String(bearer.sub || '').trim() === cardId || scopedCards.includes(cardId)) return;

    const email = normalizeIndexedEmail(bearer.email);
    const phone = normalizeIndexedPhone(bearer.phone_number || bearer.phone);
    const contacts = [
      ...(email ? [{ name: ClaimsOrganizationSchemaorg.ownerEmail, value: email }] : []),
      ...(phone ? [{ name: ClaimsOrganizationSchemaorg.ownerTelephone, value: phone }] : []),
    ];
    for (const contact of contacts) {
      const matches = await this.vaultRepository.query(collectionName, {
        sectionId: INDIVIDUAL_DIRECTORY_SECTION,
        where: [
          { name: ClaimsOrganizationSchemaorg.sameAs, value: cardId },
          contact,
        ],
      }, { hydrate: false });
      if (matches.length > 0) return;
    }
    throw new ManagerError('The authenticated actor cannot manage this Subject collection.', IssueType.Forbidden);
  }
}
