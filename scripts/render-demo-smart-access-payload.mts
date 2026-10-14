import {
  DEMO_SMART_ACCESS_LOCAL_DIDS,
  buildDemoDigitalTwinResearchSubjectSearchRequest,
  buildDemoIndividualAllSectionsIngestionRequest,
  buildDemoIndividualIpsPermitConsent,
  buildDemoIndividualIpsSearchRequest,
  buildDemoIndividualSmartTokenRequest,
  buildDemoIndividualScopedSummaryRequest,
  buildDemoResearchPermitByEmailConsent,
  buildDemoResearchDenyByEmailConsent,
  buildDemoResearchPermitByRoleConsent,
  buildDemoResearchRequesterMatrix,
  buildDemoResearchSmartTokenRequest,
} from '../src/__tests__/data/demo-smart-access-local-network.data.ts';
import { buildConsentRulePrimaryDocument } from '../src/utils/consent-access-blockchain.ts';
import { getClaimValue, normalizeContextualizedClaims } from '../src/utils/claims.ts';
import { expandConsentActorRoles } from '../src/utils/consent.ts';
import { ClaimConsent } from 'gdc-common-utils-ts/models/consent-rule';
import type { BundleEntry } from 'gdc-common-utils-ts/models/bundle';
import { ensureDigitalTwinSecondaryUseConsentIdentifier } from '../src/utils/consent-storage.ts';
import { getTenantVaultId } from '../src/utils/tenant.ts';

type PayloadName =
  | 'INDIVIDUAL_CONSENT_BATCH_REQUEST'
  | 'INDIVIDUAL_RULE_ID_LIST'
  | 'INDIVIDUAL_SMART_TOKEN_REQUEST'
  | 'INDIVIDUAL_IPS_SEARCH_REQUEST'
  | 'INDIVIDUAL_ALL_SECTIONS_INGESTION_REQUEST'
  | 'INDIVIDUAL_SCOPED_SUMMARY_REQUEST'
  | 'RESEARCH_CONSENT_BATCH_REQUEST_ROLE'
  | 'RESEARCH_RULE_ID_LIST_ROLE'
  | 'RESEARCH_CONSENT_BATCH_REQUEST_EMAIL'
  | 'RESEARCH_RULE_ID_LIST_EMAIL'
  | 'RESEARCH_SMART_TOKEN_REQUEST_ROLE_ALLOW'
  | 'RESEARCH_SMART_TOKEN_REQUEST_ROLE_DENY'
  | 'RESEARCH_SMART_TOKEN_REQUEST_EMAIL_ALLOW'
  | 'RESEARCH_SMART_TOKEN_REQUEST_EMAIL_DENY'
  | 'DIGITAL_TWIN_RESEARCH_SUBJECT_SEARCH_REQUEST'
  | 'RESEARCH_CONSUMER_ORGANIZATION_DID';

const payloadName = process.argv[2] as PayloadName | undefined;

if (!payloadName) {
  throw new Error(
    'Usage: render-demo-smart-access-payload.mts <INDIVIDUAL_CONSENT_BATCH_REQUEST|INDIVIDUAL_RULE_ID_LIST|INDIVIDUAL_SMART_TOKEN_REQUEST|INDIVIDUAL_IPS_SEARCH_REQUEST|RESEARCH_CONSENT_BATCH_REQUEST_ROLE|RESEARCH_RULE_ID_LIST_ROLE|RESEARCH_CONSENT_BATCH_REQUEST_EMAIL|RESEARCH_RULE_ID_LIST_EMAIL|RESEARCH_SMART_TOKEN_REQUEST_ROLE_ALLOW|RESEARCH_SMART_TOKEN_REQUEST_ROLE_DENY|RESEARCH_SMART_TOKEN_REQUEST_EMAIL_ALLOW|RESEARCH_SMART_TOKEN_REQUEST_EMAIL_DENY|DIGITAL_TWIN_RESEARCH_SUBJECT_SEARCH_REQUEST|RESEARCH_CONSUMER_ORGANIZATION_DID>',
  );
}

const tenantId = process.env.TENANT_ID || 'acme-id';
const subjectDid = process.env.SUBJECT_ID || `did:web:api.${tenantId}.org:individual:subject-001`;
const clientAssertionAudience = process.env.SMART_TOKEN_AUDIENCE;
const providerOrganizationDid = process.env.PROVIDER_ORGANIZATION_DID;

function buildConsentEntry(resourceClaims: Record<string, unknown>): BundleEntry {
  return {
    id: String(resourceClaims['Consent.identifier'] || ''),
    type: 'Consent',
    resource: {
      resourceType: 'Consent',
      status: 'active',
      meta: {
        claims: resourceClaims,
      },
    },
  } as BundleEntry;
}

function buildProjectedConsentEntry(resourceClaims: Record<string, unknown>): BundleEntry {
  const claims = normalizeContextualizedClaims(resourceClaims);
  ensureDigitalTwinSecondaryUseConsentIdentifier({
    tenantVaultId: getTenantVaultId(process.env.SECTOR || 'animal-care', tenantId),
    sector: process.env.SECTOR || 'animal-care',
    claims,
  });
  const actorRoles = getClaimValue<string>(claims, ClaimConsent.actorRole);
  if (actorRoles) {
    const context = String(claims['@context'] || '').replace(/\.$/, '');
    const contextualizedKey = context ? `${context}.${ClaimConsent.actorRole}` : ClaimConsent.actorRole;
    const targetKey = claims[contextualizedKey] !== undefined
      ? contextualizedKey
      : ClaimConsent.actorRole;
    claims[targetKey] = expandConsentActorRoles(actorRoles, 'auto').join(',');
  }
  return buildConsentEntry(claims);
}

function buildConsentBatch(resourceClaims: Record<string, unknown>): { thid: string; data: BundleEntry[] } {
  const entry = buildConsentEntry(resourceClaims);
  return {
    thid: process.env.THID || `smart-access-${String(entry.id || 'consent').replace(/[^a-zA-Z0-9-]+/g, '-')}`,
    data: [entry],
  };
}

function buildConsentEntriesBatch(resourceClaims: readonly Record<string, unknown>[]): { thid: string; data: BundleEntry[] } {
  const entries = resourceClaims.map(buildConsentEntry);
  return {
    thid: process.env.THID || 'smart-access-research-email-consent-matrix',
    data: entries,
  };
}

const matrix = buildDemoResearchRequesterMatrix();

const rendered = await (async () => {
  switch (payloadName) {
    case 'INDIVIDUAL_CONSENT_BATCH_REQUEST':
      return buildConsentBatch(buildDemoIndividualIpsPermitConsent({ tenantId, subjectDid }) as Record<string, unknown>);
    case 'INDIVIDUAL_RULE_ID_LIST': {
      const entry = buildProjectedConsentEntry(
        buildDemoIndividualIpsPermitConsent({ tenantId, subjectDid }) as Record<string, unknown>,
      );
      return buildConsentRulePrimaryDocument([entry]).data.map((item) => item.id);
    }
    case 'INDIVIDUAL_SMART_TOKEN_REQUEST':
      return buildDemoIndividualSmartTokenRequest({ tenantId, subjectDid, clientAssertionAudience });
    case 'INDIVIDUAL_IPS_SEARCH_REQUEST':
      return buildDemoIndividualIpsSearchRequest({ subjectDid });
    case 'INDIVIDUAL_ALL_SECTIONS_INGESTION_REQUEST':
      return buildDemoIndividualAllSectionsIngestionRequest({ subjectDid });
    case 'INDIVIDUAL_SCOPED_SUMMARY_REQUEST':
      return buildDemoIndividualScopedSummaryRequest({ tenantId, subjectDid });
    case 'RESEARCH_CONSENT_BATCH_REQUEST_ROLE': {
      return buildConsentBatch(buildDemoResearchPermitByRoleConsent({ subjectDid }) as Record<string, unknown>);
    }
    case 'RESEARCH_RULE_ID_LIST_ROLE': {
      const entry = buildProjectedConsentEntry(
        buildDemoResearchPermitByRoleConsent({ subjectDid }) as Record<string, unknown>,
      );
      return buildConsentRulePrimaryDocument([entry]).data.map((item) => item.id);
    }
    case 'RESEARCH_CONSENT_BATCH_REQUEST_EMAIL': {
      return buildConsentEntriesBatch([
        buildDemoResearchPermitByEmailConsent({ subjectDid }) as Record<string, unknown>,
        buildDemoResearchDenyByEmailConsent({ subjectDid }) as Record<string, unknown>,
      ]);
    }
    case 'RESEARCH_RULE_ID_LIST_EMAIL': {
      const entries = [
        buildDemoResearchPermitByEmailConsent({ subjectDid }) as Record<string, unknown>,
        buildDemoResearchDenyByEmailConsent({ subjectDid }) as Record<string, unknown>,
      ].map(buildProjectedConsentEntry);
      return buildConsentRulePrimaryDocument(entries).data.map((item) => item.id);
    }
    case 'RESEARCH_SMART_TOKEN_REQUEST_ROLE_ALLOW':
      return buildDemoResearchSmartTokenRequest({
        tenantId, subjectDid, providerOrganizationDid, clientAssertionAudience, ...matrix.allowByRole,
      });
    case 'RESEARCH_SMART_TOKEN_REQUEST_ROLE_DENY':
      return buildDemoResearchSmartTokenRequest({
        tenantId, subjectDid, providerOrganizationDid, clientAssertionAudience, ...matrix.denyByRole,
      });
    case 'RESEARCH_SMART_TOKEN_REQUEST_EMAIL_ALLOW':
      return buildDemoResearchSmartTokenRequest({
        tenantId, subjectDid, providerOrganizationDid, clientAssertionAudience, ...matrix.allowByEmail,
      });
    case 'RESEARCH_SMART_TOKEN_REQUEST_EMAIL_DENY':
      return buildDemoResearchSmartTokenRequest({
        tenantId, subjectDid, providerOrganizationDid, clientAssertionAudience, ...matrix.denyByEmail,
      });
    case 'DIGITAL_TWIN_RESEARCH_SUBJECT_SEARCH_REQUEST':
      return buildDemoDigitalTwinResearchSubjectSearchRequest();
    case 'RESEARCH_CONSUMER_ORGANIZATION_DID':
      return DEMO_SMART_ACCESS_LOCAL_DIDS.consumerOrganizationDid;
    default:
      throw new Error(`Unknown payload '${payloadName}'.`);
  }
})();

process.stdout.write(JSON.stringify(rendered));
