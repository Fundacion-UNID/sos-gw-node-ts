import { createHash, randomUUID } from 'node:crypto';
import { HealthcareConsentPurposes } from 'gdc-common-utils-ts/constants/healthcare';
import { ClaimConsent, ConsentDecisions } from 'gdc-common-utils-ts/models/consent-rule';
import type { RecordBase } from 'gdc-common-utils-ts/models/resource-document';
import {
  isVetChainAnimalCardDid,
  VeterinaryBreakGlassMaxLifetimeSeconds,
  VeterinaryEmergencyReasonCodes,
  VeterinaryOccupationCodes,
} from 'vet-data-utils-ts';
import type { IBlockchainAdapter } from '../adapters/IBlockchainAdapter';
import type { IVaultRepository } from '../database/repositories/vault/vault.repository';
import { getIndividualSectionId } from '../utils/individual-sections';
import { getTenantVaultId } from '../utils/tenant';
import { canonicalize } from '../utils/json-canon';
import { resolveDataChannel } from '../utils/ledger';

export type BreakGlassSubjectKind = 'human' | 'animal';
export type BreakGlassReasonCode =
  | 'life-threatening'
  | 'serious-imminent-harm'
  | 'unconscious-or-incapacitated'
  | 'animal-emergency';

export type BreakGlassRequest = Readonly<{
  incidentId: string;
  subjectKind: BreakGlassSubjectKind;
  reasonCode: BreakGlassReasonCode;
  justification: string;
}>;

export type BreakGlassPolicyInput = Readonly<{
  routeSector: string;
  subjectKind: BreakGlassSubjectKind;
  professionalRole: string;
  requestedScope: string;
  reasonCode: BreakGlassReasonCode;
}>;

export type BreakGlassPolicyDecision =
  | Readonly<{ allowed: true; maxLifetimeSeconds: number }>
  | Readonly<{ allowed: false; reason: string }>;

const HUMAN_EMERGENCY_ROLES = /^221(?:\d)?$/;
const RESEARCH_SECTORS = new Set(['health-research', 'animal-research', 'onehealth-research']);

function occupationCode(value: string): string {
  const normalized = String(value || '').trim();
  return (normalized.includes('|') ? normalized.slice(normalized.lastIndexOf('|') + 1) : normalized)
    .replace(/[^0-9]/g, '');
}

function isReadOnlyScope(scope: string): boolean {
  const tokens = String(scope || '').split(/\s+/).filter(Boolean);
  return tokens.length > 0 && tokens.every((token) => {
    const head = token.split('?', 1)[0] || '';
    const permission = head.slice(head.lastIndexOf('.') + 1).toLowerCase();
    return permission === 'r' || permission === 'rs';
  });
}

function subjectDidMatchesKind(subjectDid: string, subjectKind: BreakGlassSubjectKind): boolean {
  const normalized = String(subjectDid || '').trim().toLowerCase();
  return subjectKind === 'human'
    ? normalized.includes(':individual:')
    : isVetChainAnimalCardDid(subjectDid);
}

/**
 * Product-neutral, sector-first emergency policy. Organization membership,
 * employment and research authority never imply exceptional access.
 */
export function evaluateBreakGlassPolicy(input: BreakGlassPolicyInput): BreakGlassPolicyDecision {
  const routeSector = String(input.routeSector || '').trim().toLowerCase();
  if (RESEARCH_SECTORS.has(routeSector)) return { allowed: false, reason: 'research_sector_forbidden' };
  if (!isReadOnlyScope(input.requestedScope)) return { allowed: false, reason: 'read_only_scope_required' };

  const role = occupationCode(input.professionalRole);
  if (input.subjectKind === 'human') {
    if (routeSector !== 'health-care') return { allowed: false, reason: 'human_sector_mismatch' };
    if (!HUMAN_EMERGENCY_ROLES.test(role)) return { allowed: false, reason: 'professional_role_not_authorized' };
    if (input.reasonCode === 'animal-emergency') return { allowed: false, reason: 'reason_subject_mismatch' };
    return { allowed: true, maxLifetimeSeconds: 900 };
  }

  if (routeSector !== 'animal-care') return { allowed: false, reason: 'animal_sector_mismatch' };
  if (role !== VeterinaryOccupationCodes.Veterinarian) return { allowed: false, reason: 'professional_role_not_authorized' };
  if (input.reasonCode !== VeterinaryEmergencyReasonCodes.AnimalEmergency) return { allowed: false, reason: 'reason_subject_mismatch' };
  return { allowed: true, maxLifetimeSeconds: VeterinaryBreakGlassMaxLifetimeSeconds };
}

export type BreakGlassAuthorizationInput = Readonly<{
  tenantId: string;
  jurisdiction: string;
  routeSector: string;
  actorDid: string;
  actorOrganizationDid: string;
  requestingClientId: string;
  tokenAudience: string;
  professionalRole: string;
  subjectDid: string;
  requestedScope: string;
  request: BreakGlassRequest;
  professionalCredentialVerified: boolean;
  ledgerVerified: boolean;
  requestedLifetimeSeconds: number;
}>;

export type BreakGlassAuthorization = Readonly<{
  emergencyConsentId: string;
  consentExpiresAt: string;
  authorizationId: string;
  issuedAt: string;
  expiresAt: string;
  lifetimeSeconds: number;
  auditAssetId: string;
  notificationId?: string;
}>;

type EmergencyConsentRecord = RecordBase & Record<string, unknown> & { notificationIdHash: string };
type BreakGlassServiceOptions = Readonly<{ consentLifetimeSeconds?: number }>;

export interface BreakGlassAuthorizer {
  authorize(input: BreakGlassAuthorizationInput): Promise<BreakGlassAuthorization>;
}

export interface BreakGlassControllerNotifier {
  notify(input: Readonly<{
    authorizationId: string;
    incidentId: string;
    requesterOrganizationDid: string;
    jurisdiction: string;
    professionalActorHash: string;
    professionalRole: string;
    subjectDid: string;
    routeSector: string;
    reasonCode: BreakGlassReasonCode;
    issuedAt: string;
    expiresAt: string;
    consentLedgerAssetId: string;
    communication: Readonly<{
      resourceType: 'Communication'; status: 'in-progress';
      identifier: ReadonlyArray<Readonly<{ value: string }>>;
      subject: Readonly<{ reference: string }>;
      sender: Readonly<{ reference: string }>;
      sent: string;
      reasonCode: ReadonlyArray<Readonly<{ coding: ReadonlyArray<Readonly<{ code: string }>> }>>;
      payload: ReadonlyArray<Readonly<{ contentString: string }>>;
    }>;
  }>): Promise<{ notificationId: string }>;
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function buildArtifactLedgerPayload(assetId: string, payload: Record<string, unknown>): Record<string, unknown> {
  return {
    ...payload,
    artifactId: assetId,
    hash: digest(canonicalize(payload)),
    hashAlg: 'sha256',
  };
}

function emergencyConsentClaimsHash(consent: Record<string, unknown>): string {
  return digest(canonicalize(Object.fromEntries(Object.entries(consent)
    .filter(([key]) => key === '@context' || key.startsWith('Consent.')))));
}

function resolveConsentLifetimeSeconds(configured: number | string | undefined): number {
  const parsed = Number(configured ?? 86_400);
  if (!Number.isFinite(parsed)) return 86_400;
  return Math.max(VeterinaryBreakGlassMaxLifetimeSeconds, Math.min(86_400, Math.floor(parsed)));
}

export class BreakGlassService implements BreakGlassAuthorizer {
  constructor(
    private readonly blockchainAdapter: IBlockchainAdapter,
    private readonly vaultRepository: IVaultRepository,
    private readonly notifier: BreakGlassControllerNotifier,
    private readonly clock: () => Date = () => new Date(),
    private readonly options: BreakGlassServiceOptions = {},
  ) {}

  async authorize(input: BreakGlassAuthorizationInput): Promise<BreakGlassAuthorization> {
    if (!input.professionalCredentialVerified || !input.ledgerVerified) throw new Error('verified_professional_credential_required');
    if (!String(input.actorOrganizationDid || '').trim()) throw new Error('requester_organization_required');
    if (!subjectDidMatchesKind(input.subjectDid, input.request.subjectKind)) throw new Error('subject_kind_mismatch');
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(input.request.incidentId)) throw new Error('invalid_incident_id');
    const justification = input.request.justification.trim();
    if (justification.length < 10 || justification.length > 500) throw new Error('invalid_emergency_justification');
    const decision = evaluateBreakGlassPolicy({
      routeSector: input.routeSector,
      subjectKind: input.request.subjectKind,
      professionalRole: input.professionalRole,
      requestedScope: input.requestedScope,
      reasonCode: input.request.reasonCode,
    });
    if (!decision.allowed) throw new Error(decision.reason);
    if (!this.blockchainAdapter.registerArtifactBundle) throw new Error('break_glass_ledger_not_configured');

    const issuedAtDate = this.clock();
    const lifetimeSeconds = Math.max(1, Math.min(decision.maxLifetimeSeconds, input.requestedLifetimeSeconds));
    const issuedAt = issuedAtDate.toISOString();
    const channel = resolveDataChannel();

    const tenantVaultId = getTenantVaultId(input.routeSector, input.tenantId);
    const consentSectionId = getIndividualSectionId(input.subjectDid, 'emergency_consents');
    const consentStorageId = digest([input.tenantId, input.routeSector, input.actorDid, input.subjectDid, input.request.incidentId].join('|'));
    let consent = await this.vaultRepository.get<EmergencyConsentRecord>(tenantVaultId, consentStorageId, consentSectionId);
    let notificationId: string | undefined;

    if (consent) {
      if (String(consent[ClaimConsent.status]) !== 'active' || String(consent[ClaimConsent.decision]) !== ConsentDecisions.Permit) {
        throw new Error('emergency_consent_not_active');
      }
      if (String(consent[ClaimConsent.actorIdentifier]) !== input.actorDid
        || String(consent[ClaimConsent.actorRole]) !== input.professionalRole
        || String(consent[ClaimConsent.subject]) !== input.subjectDid) throw new Error('emergency_consent_actor_mismatch');
      if (String(consent[ClaimConsent.action]) !== input.requestedScope) throw new Error('emergency_consent_scope_mismatch');
      if (Date.parse(String(consent[ClaimConsent.periodEnd] || '')) <= issuedAtDate.getTime()) throw new Error('emergency_consent_expired');
    } else {
      const consentLifetimeSeconds = resolveConsentLifetimeSeconds(this.options.consentLifetimeSeconds ?? process.env.BREAK_GLASS_CONSENT_TTL_SECONDS);
      const emergencyConsentId = randomUUID();
      const consentExpiresAt = new Date(issuedAtDate.getTime() + consentLifetimeSeconds * 1000).toISOString();
      consent = {
        id: consentStorageId, '@context': 'org.hl7.fhir.api',
        [ClaimConsent.identifier]: `urn:uuid:${emergencyConsentId}`,
        [ClaimConsent.status]: 'active', [ClaimConsent.decision]: ConsentDecisions.Permit,
        [ClaimConsent.subject]: input.subjectDid,
        [ClaimConsent.actorIdentifier]: input.actorDid,
        [ClaimConsent.actorRole]: input.professionalRole,
        [ClaimConsent.purpose]: HealthcareConsentPurposes.EmergencyTreatment,
        [ClaimConsent.action]: input.requestedScope,
        [ClaimConsent.date]: issuedAt, [ClaimConsent.periodStart]: issuedAt, [ClaimConsent.periodEnd]: consentExpiresAt,
        [ClaimConsent.eventBasedOn]: `urn:sha256:${digest(input.request.incidentId)}`,
        [ClaimConsent.provisionCode]: input.request.reasonCode,
        notificationIdHash: '',
      };

      const consentLedgerAssetId = `break-glass-consent:${emergencyConsentId}`;
      const consentAuditPayload = {
        type: 'BreakGlassEmergencyConsent', emergencyConsentId,
        consentClaimsHash: emergencyConsentClaimsHash(consent),
        incidentIdHash: digest(input.request.incidentId), actorDidHash: digest(input.actorDid), subjectDidHash: digest(input.subjectDid),
        requesterOrganizationDid: input.actorOrganizationDid, jurisdiction: input.jurisdiction,
        professionalRole: input.professionalRole, routeSector: input.routeSector, subjectKind: input.request.subjectKind,
        reasonCode: input.request.reasonCode, authorizedScopeHash: digest(input.requestedScope),
        issuedAt, expiresAt: consentExpiresAt, controllerNotification: 'pending',
      };
      await this.blockchainAdapter.registerArtifactBundle({
        assetId: consentLedgerAssetId,
        channel,
        payload: buildArtifactLedgerPayload(consentLedgerAssetId, consentAuditPayload),
      });

      const notification = await this.notifier.notify({
        authorizationId: emergencyConsentId, incidentId: input.request.incidentId,
        requesterOrganizationDid: input.actorOrganizationDid, jurisdiction: input.jurisdiction,
        professionalActorHash: digest(input.actorDid), professionalRole: input.professionalRole,
        subjectDid: input.subjectDid, routeSector: input.routeSector, reasonCode: input.request.reasonCode,
        issuedAt, expiresAt: consentExpiresAt,
        consentLedgerAssetId: `break-glass-consent:${emergencyConsentId}`,
        communication: {
          resourceType: 'Communication', status: 'in-progress', identifier: [{ value: `urn:uuid:${emergencyConsentId}` }],
          subject: { reference: input.subjectDid }, sender: { reference: input.actorOrganizationDid }, sent: issuedAt,
          reasonCode: [{ coding: [{ code: input.request.reasonCode }] }],
          payload: [{ contentString: JSON.stringify({ emergencyConsentId, consentLedgerAssetId: `break-glass-consent:${emergencyConsentId}`, requesterOrganizationDid: input.actorOrganizationDid, jurisdiction: input.jurisdiction, professionalActorHash: digest(input.actorDid), professionalRole: input.professionalRole, validFrom: issuedAt, validUntil: consentExpiresAt }) }],
        },
      });
      notificationId = notification.notificationId;
      consent.notificationIdHash = digest(notification.notificationId);
      const notificationLedgerAssetId = `break-glass-consent:${emergencyConsentId}:notification:${digest(notification.notificationId).slice(0, 24)}`;
      const notificationAuditPayload = {
        type: 'BreakGlassControllerNotification', emergencyConsentId, requesterOrganizationDid: input.actorOrganizationDid,
        jurisdiction: input.jurisdiction, notificationIdHash: digest(notification.notificationId), acknowledgedAt: this.clock().toISOString(),
      };
      await this.blockchainAdapter.registerArtifactBundle({
        assetId: notificationLedgerAssetId,
        channel,
        payload: buildArtifactLedgerPayload(notificationLedgerAssetId, notificationAuditPayload),
      });
      await this.vaultRepository.put(tenantVaultId, [consent], consentSectionId);
    }

    const emergencyConsentId = String(consent[ClaimConsent.identifier]).replace(/^urn:uuid:/, '');
    const consentExpiresAt = String(consent[ClaimConsent.periodEnd]);
    const authorizationId = randomUUID();
    const auditAssetId = `break-glass:${authorizationId}`;
    const expiresAt = new Date(Math.min(issuedAtDate.getTime() + lifetimeSeconds * 1000, Date.parse(consentExpiresAt))).toISOString();

    await this.blockchainAdapter.registerArtifactBundle({
      assetId: auditAssetId,
      channel,
      payload: buildArtifactLedgerPayload(auditAssetId, {
        type: 'BreakGlassTokenAuthorization',
        emergencyConsentId,
        consentClaimsHash: emergencyConsentClaimsHash(consent),
        authorizationId,
        incidentIdHash: digest(input.request.incidentId),
        actorDidHash: digest(input.actorDid),
        requesterOrganizationDid: input.actorOrganizationDid,
        jurisdiction: input.jurisdiction,
        subjectDidHash: digest(input.subjectDid),
        professionalRole: input.professionalRole,
        routeSector: input.routeSector,
        subjectKind: input.request.subjectKind,
        reasonCode: input.request.reasonCode,
        requestedScopeHash: digest(input.requestedScope),
        requestingClientIdHash: digest(input.requestingClientId),
        tokenAudienceHash: digest(input.tokenAudience),
        issuedAt,
        expiresAt,
        controllerNotification: 'acknowledged',
      }),
    });
    return { emergencyConsentId, consentExpiresAt, authorizationId, issuedAt, expiresAt,
      lifetimeSeconds: Math.max(1, Math.floor((Date.parse(expiresAt) - issuedAtDate.getTime()) / 1000)), auditAssetId, notificationId };
  }
}

class BreakGlassControllerNotifierHttp implements BreakGlassControllerNotifier {
  constructor(private readonly endpoint: string, private readonly bearerToken: string) {}

  async notify(input: Parameters<BreakGlassControllerNotifier['notify']>[0]): Promise<{ notificationId: string }> {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.bearerToken}` },
      body: JSON.stringify(input),
    });
    if (!response.ok) throw new Error(`break_glass_notification_http_${response.status}`);
    const value = await response.json() as Record<string, unknown>;
    const notificationId = String(value.notificationId || '').trim();
    if (!notificationId) throw new Error('break_glass_notification_invalid');
    return { notificationId };
  }
}

export function buildBreakGlassAuthorizer(blockchainAdapter: IBlockchainAdapter, vaultRepository: IVaultRepository): BreakGlassAuthorizer | undefined {
  if (String(process.env.BREAK_GLASS_ENABLED || '').trim().toLowerCase() !== 'true') return undefined;
  const endpoint = String(process.env.BREAK_GLASS_NOTIFICATION_URL || '').trim();
  const bearerToken = String(process.env.BREAK_GLASS_NOTIFICATION_TOKEN || '').trim();
  if (!endpoint || !bearerToken) throw new Error('break_glass_notification_not_configured');
  return new BreakGlassService(blockchainAdapter, vaultRepository, new BreakGlassControllerNotifierHttp(endpoint, bearerToken));
}
