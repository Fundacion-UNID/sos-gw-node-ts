// src/managers/ConsentManager.ts
import { HttpStatusCodes } from 'gdc-common-utils-ts/constants/http';

import { randomUUID } from 'crypto';
import { IVaultRepository } from '../database/repositories/vault/vault.repository';
import { BundleEntryRequest, BundleJsonApi, BundleEntryResponse, ErrorEntry } from 'gdc-common-utils-ts/models/bundle';
import { ConsentRule, ClaimConsent, ConsentStatuses } from 'gdc-common-utils-ts/models/consent-rule';
import { IDecodedDidcommPayload } from 'gdc-common-utils-ts/models/confidential-message';
import { JobRequest } from 'gdc-common-utils-ts/models/confidential-job';
import { createOperationOutcome } from '../utils/outcome';
import { IssueLevel, IssueType } from 'gdc-common-utils-ts/models/issue';
import { RecordBase } from 'gdc-common-utils-ts/models/resource-document';
import { buildConsentRuleKey, expandConsentActorRoles, hashConsentRuleId } from '../utils/consent';
import { getClaimValue, normalizeContextualizedClaims } from '../utils/claims';
import { ResourceTypesFhirR4 } from 'gdc-common-utils-ts/constants/fhir-resource-types';
import { getTenantVaultId } from '../utils/tenant';
import {
  extractLedgerSafeResearchTags,
  normalizeFhirIngestionFormat,
  validateFhirPayloadByVersion,
} from '../utils/fhir-ingestion';
import { IJobProcessor } from './registry';
import { determineResourceId } from '../utils/resource';
import { applyFhirCidVersioningToEntry, FhirCidVersionMapping, registerFhirCidMappings } from '../utils/fhir-versioning';
import type { IBlockchainAdapter } from '../adapters/IBlockchainAdapter';
import {
  ensureDigitalTwinSecondaryUseConsentIdentifier,
  deleteConsentRule,
  persistConsentRuleAndAttachment,
  requiredConsentClaimsFor,
} from '../utils/consent-storage';
import {
  buildConsentRulePrimaryDocument,
  deriveConsentRuleBlockchainStatus as deriveConsentAccessBlockchainStatus,
} from '../utils/consent-access-blockchain';
import { getJurisdictionGroup } from '../utils/jurisdiction';
import type { ITenantsManager } from './ITenantsManager';

export interface ConsentManagerDeps {
  vaultRepository: IVaultRepository;
  blockchainAdapter?: IBlockchainAdapter;
  tenantsCacheManager?: ITenantsManager;
}

function setConsentStatus(claims: Record<string, any>, status: string): void {
  const context = String(claims['@context'] || '').trim().replace(/\.$/, '');
  const contextualizedKey = context ? `${context}.${ClaimConsent.status}` : ClaimConsent.status;
  if (claims[contextualizedKey] !== undefined) claims[contextualizedKey] = status;
  else claims[ClaimConsent.status] = status;
}

export class ConsentManager implements IJobProcessor {
  private readonly vaultRepository: IVaultRepository;
  private readonly blockchainAdapter?: IBlockchainAdapter;
  private readonly tenantsCacheManager?: ITenantsManager;

  constructor(deps: ConsentManagerDeps) {
    this.vaultRepository = deps.vaultRepository;
    this.blockchainAdapter = deps.blockchainAdapter;
    this.tenantsCacheManager = deps.tenantsCacheManager;
  }

  private async tenantExists(tenantVaultId: string): Promise<boolean> {
    if (this.tenantsCacheManager) {
      return this.tenantsCacheManager.tenantExists(tenantVaultId);
    }
    return this.vaultRepository.vaultExists(tenantVaultId);
  }

  public async process(job: JobRequest): Promise<IDecodedDidcommPayload> {
    const normalizedSection = String(job.section || '').trim().toLowerCase();
    const normalizedFormatRaw = String(job.format || '').trim();
    const normalizedAction = String(job.action || '').trim();
    const jurisdiction = String(job.jurisdiction || '').trim();
    if (!job.tenantId || !job.sector) {
      throw new Error('Missing tenantId or sector.');
    }
    if (!jurisdiction || !normalizedSection || !normalizedFormatRaw || !normalizedAction) {
      throw new Error('Missing jurisdiction, section, format, or action.');
    }
    const normalizedFormat = normalizeFhirIngestionFormat(normalizedFormatRaw);

    const body = job.content?.body as any;
    const bundle = body as BundleJsonApi<BundleEntryRequest>;
    const responseEntries: (BundleEntryResponse | ErrorEntry)[] = [];

    const entries: any[] =
      (bundle && Array.isArray((bundle as any).data) && (bundle as any).data) ||
      (body && Array.isArray(body.entry) && body.entry) ||
      [];
    const cidMappings: FhirCidVersionMapping[] = [];
    const blockchainEligibleEntries: BundleEntryRequest[] = [];

    for (const entry of entries) {
        const rawClaims = (entry as any)?.resource?.meta?.claims as Record<string, any> | undefined;

        try {
            if (!rawClaims) {
                throw new Error('Missing claims object in resource meta');
            }
            validateFhirPayloadByVersion(normalizedFormat, 'Consent', entry);

            // Normalize contextualized claims:
            // - If `@context` is set (e.g. `org.hl7.fhir.r4`) and keys are sent without that prefix,
            //   prepend `${@context}.` and sort keys alphabetically (canonical form).
            const claims = normalizeContextualizedClaims(rawClaims) as Record<string, any>;
            const requestMethod = String((entry as any)?.request?.method || 'POST').trim().toUpperCase();
            const requestedStatus = getClaimValue<string>(claims, ClaimConsent.status);
            if (requestMethod === 'POST' && requestedStatus !== ConsentStatuses.Active) {
              throw new Error('Consent.status must be active before the rule can be materialized.');
            }
            if (requestMethod === 'PUT'
              && requestedStatus !== ConsentStatuses.Active
              && requestedStatus !== ConsentStatuses.Inactive) {
              throw new Error('Consent update status must be active or inactive.');
            }
            if (!['POST', 'PUT', 'DELETE'].includes(requestMethod)) {
              throw new Error(`Unsupported Consent request method '${requestMethod}'.`);
            }
            if (requestMethod === 'DELETE') setConsentStatus(claims, ConsentStatuses.Inactive);
            const tenantVaultId = getTenantVaultId(job.sector as string, job.tenantId as string);
            const tenantExists = await this.tenantExists(tenantVaultId);
            if (!tenantExists) throw new Error(`Tenant vault not found: ${tenantVaultId}`);

            ensureDigitalTwinSecondaryUseConsentIdentifier({
              tenantVaultId,
              sector: job.sector as string,
              claims,
            });
            for (const claimKey of requiredConsentClaimsFor(claims)) {
              if (!getClaimValue(claims, claimKey)) {
                throw new Error(`Missing required claim: ${claimKey}`);
              }
            }
            const researchTags = extractLedgerSafeResearchTags(entry);
            const identifierClaim =
              getClaimValue<string>(claims, 'Consent.identifier') ||
              getClaimValue<string>(claims, 'Consent.identifier.value');
            const fallbackId = determineResourceId(identifierClaim, process.env.NODE_ENV);
            const versioning = requestMethod === 'DELETE' ? undefined : applyFhirCidVersioningToEntry({
              entry,
              claims,
              resourceType: ResourceTypesFhirR4.Consent,
              resourceId: fallbackId,
            });

            const persistenceInput = {
              vaultRepository: this.vaultRepository,
              tenantVaultId,
              sector: job.sector as string,
              jurisdiction,
              claims,
              researchTags,
              blockchainAdapter: this.blockchainAdapter,
            };
            if (requestMethod === 'DELETE') await deleteConsentRule(persistenceInput);
            const persistedConsent = requestMethod === 'DELETE'
              ? undefined
              : await persistConsentRuleAndAttachment(persistenceInput);
            if (versioning?.mapping) cidMappings.push(versioning.mapping);
            blockchainEligibleEntries.push(buildConsentBlockchainEntry(entry, claims));

            const responseAction = `${normalizedAction}-response`;
            responseEntries.push({
                response: {
                    status: requestMethod === 'DELETE' ? '204' : requestMethod === 'PUT' ? '200' : String(HttpStatusCodes.Created),
                    location: `/${job.tenantId}/cds-${jurisdiction}/v1/${job.sector}/${normalizedSection}/${normalizedFormat}/Consent/${responseAction}`,
                    ...(persistedConsent?.warnings?.length ? {
                      outcome: {
                        resourceType: ResourceTypesFhirR4.OperationOutcome,
                        issue: persistedConsent.warnings.flatMap((warning) => warning.issue || []),
                      },
                    } : {}),
                },
                ...(researchTags && researchTags.length > 0 ? { meta: { tag: researchTags } } : {}),
                type: ResourceTypesFhirR4.Consent
            } as any);

        } catch (e: any) {
            const status = e.message.includes('not found') ? '404' : '400';
            const issueType = status === '404' ? IssueType.NotFound : IssueType.Invalid;
            responseEntries.push({
                response: {
                    status: status,
                    outcome: createOperationOutcome(IssueLevel.Error, issueType, e.message),
                },
                resource: { resourceType: ResourceTypesFhirR4.OperationOutcome, meta: { claims: rawClaims || {} } },
                type: ResourceTypesFhirR4.Consent
            });
        }
    }

    await registerFhirCidMappings({
      blockchainAdapter: this.blockchainAdapter,
      sector: job.sector as string,
      jurisdiction,
      mappings: cidMappings,
    });
    await registerConsentAccessRules({
      blockchainAdapter: this.blockchainAdapter,
      entries: blockchainEligibleEntries,
      sector: job.sector as string,
      jurisdiction,
    });

    const responseBundle: BundleJsonApi = {
      resourceType: ResourceTypesFhirR4.Bundle,
      type: `${normalizedAction}-response`,
      data: responseEntries,
    };

    const result: IDecodedDidcommPayload = {
      jti: randomUUID(),
      type: 'transaction-response',
      thid: job.content?.thid as string,
      iss: job.content?.aud as string,
      aud: job.content?.iss as string,
      body: responseBundle,
    };
    return result;
  }
}

/**
 * Creates a normalized bundle entry that always carries the canonical claims under
 * `resource.meta.claims`, which is the shared contract expected by the consent-access
 * blockchain projection helpers.
 */
function buildConsentBlockchainEntry(
  entry: BundleEntryRequest,
  claims: Record<string, unknown>,
): BundleEntryRequest {
  const blockchainClaims = { ...claims };
  const actorRoles = getClaimValue<string>(blockchainClaims, ClaimConsent.actorRole);
  if (actorRoles) {
    const context = String(blockchainClaims['@context'] || '').replace(/\.$/, '');
    const contextualizedKey = context ? `${context}.${ClaimConsent.actorRole}` : ClaimConsent.actorRole;
    const targetKey = blockchainClaims[contextualizedKey] !== undefined
      ? contextualizedKey
      : ClaimConsent.actorRole;
    blockchainClaims[targetKey] = expandConsentActorRoles(actorRoles, 'auto').join(',');
  }

  const normalizedResource = {
    ...((entry.resource as Record<string, unknown> | undefined) || {}),
    meta: {
      ...((((entry.resource as Record<string, unknown> | undefined)?.meta as Record<string, unknown> | undefined) || {})),
      claims: blockchainClaims,
    },
  };

  return {
    ...entry,
    resource: normalizedResource as unknown as RecordBase,
  };
}

/**
 * Registers one sanitized consent-access rule per on-chain asset when a
 * blockchain adapter exposes a dedicated consent-access write path.
 *
 * The blockchain payload still keeps the shared primary-document contract with
 * mandatory `data[]`, but every submit contains exactly one atomic rule:
 * - `assetId = data[0].id = CIDv1(SHA3-384(canonicalRuleId))`
 * - `payload.data.length = 1`
 *
 * This makes every rule independently verifiable and independently updatable on
 * chain even when several rules were derived from one input consent bundle.
 */
async function registerConsentAccessRules(params: {
  blockchainAdapter?: IBlockchainAdapter;
  entries: BundleEntryRequest[];
  sector: string;
  jurisdiction: string;
}): Promise<void> {
  const { blockchainAdapter, entries, sector, jurisdiction } = params;
  if (!blockchainAdapter?.registerConsentAccessBundle) return;
  if (entries.length === 0) return;

  const channel = resolveConsentAccessChannelName(sector, jurisdiction);
  const chaincode = process.env.CONSENT_ACCESS_LEDGER_CHAINCODE || 'consentaccess-sc';
  for (const sourceEntry of entries) {
    const entryClaims = ((sourceEntry.resource as Record<string, unknown> | undefined)?.meta as { claims?: Record<string, unknown> } | undefined)?.claims || {};
    const payload = buildConsentRulePrimaryDocument([sourceEntry]);
    const status = deriveConsentAccessBlockchainStatus(entryClaims);
    if (!Array.isArray(payload.data) || payload.data.length === 0) continue;

    for (const ruleEntry of payload.data) {
      const assetId = String(ruleEntry.id || '').trim();
      if (!assetId) {
        throw new Error('Cannot register consent access rule without ruleId');
      }

      await blockchainAdapter.registerConsentAccessBundle({
        assetId,
        payload: { status, data: [ruleEntry] },
        channel,
        chaincode,
      });
    }
  }
}

/**
 * Maps the request jurisdiction to the Fabric channel suffix used by
 * `consentaccess-sc`.
 *
 * The legal jurisdiction carried by the request can be a country code such as
 * `ES`, while the local or shared Fabric topology is organized by broader
 * jurisdiction groups such as `eu`. Reusing the same mapping helper as the rest
 * of GW CORE keeps consent-access writes aligned with the channels that actually
 * exist in the network.
 */
function resolveConsentAccessChannelJurisdiction(jurisdiction: string): string {
  return getJurisdictionGroup(String(jurisdiction || '').trim());
}

function resolveConsentAccessChannelName(sector: string, jurisdiction: string): string {
  const explicitChannel = String(
    process.env.LEDGER_DATA_CHANNEL_DEFAULT
    || process.env.HLF_DATA_CHANNEL_NAME
    || process.env.HLF_CHANNEL_NAME
    || '',
  ).trim();
  if (explicitChannel) return explicitChannel;

  const networkMode = String(process.env.NETWORK_MODE || '').trim().toLowerCase();
  if (networkMode === 'local-network') return `${sector}-local`;

  return `${sector}-${resolveConsentAccessChannelJurisdiction(jurisdiction)}`;
}
