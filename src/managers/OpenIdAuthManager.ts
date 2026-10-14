// src/managers/OpenIdAuthManager.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
import { ResourceTypesFhirR4 } from 'gdc-common-utils-ts/constants/fhir-resource-types';

import { IJobProcessor } from './registry';
import { JobRequest } from 'gdc-common-utils-ts/models/confidential-job';
import { IDecodedDidcommPayload } from 'gdc-common-utils-ts/models/confidential-message';
import { IKmsService } from '../gdc-backend-utils-node/models/IKmsService';
import type { ITenantsManager } from './ITenantsManager';
import { ManagerError } from 'gdc-common-utils-ts/utils/manager-error';
import { IssueType } from 'gdc-common-utils-ts/models/issue';
import { Content } from 'gdc-common-utils-ts/utils/content';
import { getTenantVaultId } from '../utils/tenant';
import { IVaultRepository } from '../database/repositories/vault/vault.repository';
import { getClaimValue } from '../utils/claims';
import { parseActorFromSub } from 'gdc-common-utils-ts/utils/actor';
import { getServiceControllerCredentialFromVpToken } from 'gdc-common-utils-ts/utils/vp-token';
import { getIndividualSectionId } from '../utils/individual-sections';
import { IClearingHouseService } from '../services/ClearingHouseService';
import { normalizeCodeSystemAndValue } from '../utils/normalize-codeAndSystem';
import { expandConsentActorRoles, normalizeConsentActorRole } from '../utils/consent';
import { getMatchingInterTenantAccessContractFromVpToken } from 'gdc-common-utils-ts/utils/inter-tenant-access-contract';
import { getMatchingSubjectIdentityBindingFromVpToken } from 'gdc-common-utils-ts/utils/subject-identity-binding';
import { calculateJwkThumbprint, compactVerify, decodeProtectedHeader, importJWK, type JWK } from 'jose';
import { getEnvSectionId } from '../utils/section-env';
import { ServiceCapability } from 'gdc-common-utils-ts/constants/service-capabilities';
import {
  HealthcareActorRoleCodes,
  HealthcareConsentPurposes,
} from 'gdc-common-utils-ts/constants/healthcare';
import { deriveGrantedSmartScopes } from 'gdc-common-utils-ts/utils/smart-scope';
import { ClaimConsent, ConsentDecisions, ConsentStatuses, type ConsentRule } from 'gdc-common-utils-ts/models/consent-rule';
import { getMatchingIndividualMemberCredentialFromVpToken } from 'gdc-common-utils-ts/utils/individual-smart';
import { getMatchingProfessionalCredentialFromVpToken } from 'gdc-common-utils-ts/utils/professional-smart';
import type { DeviceLicense } from 'gdc-common-utils-ts/models/device-license';
import { getOrCreateDigitalTwinSubjectId } from '../utils/digital-twin-research-projection';
import { getMatchingIndividualControllerCredentialFromVpToken } from '../utils/individual-controller-smart';
import { parseTenantUrn } from '../utils/urn';
import { parseProfessionalDidIdentity } from '../utils/professional-did-identity';
import { hasActiveProfessionalIdentityAndLicense } from '../utils/professional-license';
import type {
  BreakGlassAuthorization,
  BreakGlassAuthorizer,
  BreakGlassRequest,
} from '../security/break-glass';
import {
  RESEARCH_STUDY_CONSENT_SECTION,
  RESEARCH_STUDY_SECTION,
  buildResearchStudyControllerImportScope,
  buildResearchStudyAccessScope,
  canonicalPractitionerRoleFromAuthor,
  type ResearchStudyConsentRecord,
} from './ResearchStudyConsentManager';
import { getClinicalCreatorBindingsSectionId } from '../utils/clinical-creator-binding';
import type { ClinicalCreatorBinding } from 'gdc-common-utils-ts/utils/fhir-ips-creator-identity';
import { readClaimsOnlyContent, type FlatClaims } from '../utils/fhir-flat-claims';
import {
  LICENSE_STATUS_ACTIVE,
  LICENSE_USER_CLASS_INDIVIDUAL,
  SUBJECT_SECTION_INDIVIDUAL,
} from '../constants/domain';
import { isIso3166CountryCode, isIso3166SubdivisionForCountry } from 'vet-data-utils-ts/iso-jurisdictions';
import { jurisdictionGrantCovers } from 'sos-data-utils-ts/professional-access-policy';
import { ClaimsOrganizationSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { normalizePublicAliasList } from 'gdc-common-utils-ts/utils/same-as';
import { getAuthenticatedJobActorIdentifiers } from '../utils/authenticated-job-actor';
import { normalizeIndexedEmail, normalizeIndexedPhone } from '../utils/indexed-contact';
import { buildStableActorIdentifier } from 'gdc-common-utils-ts/utils/actor-identifier';

type TokenRequestBody = {
  client_id?: string;
  client_assertion?: string;
  client_assertion_type?: string;
  scope?: string;
  sub?: string;
  expires_in?: number;
  token_type?: string;
  purpose?: string;
  vp_token?: string;
  presentation_submission?: any;
  acr_values?: string | string[];
  break_glass?: BreakGlassRequest;
};

type AccessProofResult = {
  mode: 'vp_token' | 'external_research_bearer' | 'registered_individual_controller';
  acr: string;
  amr: string[];
  vpHash?: string;
  ledgerVerified: boolean;
};

type ParsedPermission = {
  raw: string;
  capability: string;
  resourceType: string;
  operations: string[];
  filters: Record<string, string[]>;
};

export class OpenIdAuthManager implements IJobProcessor {
  constructor(
    private readonly kmsService: IKmsService,
    private readonly tenantsCacheManager: ITenantsManager,
    private readonly vaultRepository: IVaultRepository,
    private readonly clearingHouseService: IClearingHouseService,
    private readonly breakGlassAuthorizer?: BreakGlassAuthorizer,
  ) {}

  public async process(job: JobRequest): Promise<IDecodedDidcommPayload> {
    const thid = job.content?.thid;
    if (!thid) {
      throw new ManagerError('Missing thid in token request.', IssueType.Required);
    }
    if (!job.tenantId || !job.sector) {
      throw new ManagerError('Missing tenantId or sector in token request.', IssueType.Required);
    }
    if (!job.jurisdiction) {
      throw new ManagerError('Missing jurisdiction in token request.', IssueType.Required);
    }

    const body = (job.content?.body || {}) as TokenRequestBody;
    const clientId = body.client_id?.trim();
    const scope = body.scope?.trim();
    if (!scope) {
      throw new ManagerError("Missing 'scope' in token request body.", IssueType.Required);
    }

    const sub = body.sub?.trim();
    if (!sub) {
      throw new ManagerError("Missing 'sub' in token request body.", IssueType.Required);
    }

    const acrValues = this.normalizeAcrValues(body.acr_values);
    if (acrValues.length === 0) {
      throw new ManagerError("Missing 'acr_values' in token request body.", IssueType.Required);
    }

    // --- Gateway SMART Scope Extension: Context Pinning ---
    // Require a root scope item of the form:
    //   organization/Composition.<cruds>?subject=<did:web:...:individual:<id>>[&section=*|<code>[,<code>...]]
    // An omitted section means the backend's default permitted set for that subject.
    const requestedPermissions = this.parseRequestedScopePermissions(scope);
    const { subject, study } = this.extractPinnedSubjectAndSections(scope);
    const tenantVaultId = getTenantVaultId(job.sector, job.tenantId);
    const tenantExists = await this.tenantsCacheManager.tenantExists(tenantVaultId);
    if (!tenantExists) throw new ManagerError(`Tenant vault not found: ${tenantVaultId}`, IssueType.NotFound);
    const issuerDidDoc = await this.tenantsCacheManager.getDidDocument(tenantVaultId);
    const issuerDid = issuerDidDoc?.id || job.content?.aud;
    if (!issuerDid) {
      throw new ManagerError('Could not resolve token issuer DID.', IssueType.Exception);
    }

    const registeredDeviceProfile = await this.validateClientAssertion({
      body,
      clientId,
      issuerDid,
      tenantVaultId,
    });
    if (study) {
      const tenantJurisdiction = String(await this.tenantsCacheManager.getTenantJurisdiction?.(tenantVaultId) || '').trim();
      if (!tenantJurisdiction || tenantJurisdiction.toUpperCase() !== String(job.jurisdiction).trim().toUpperCase()) {
        throw new ManagerError('ResearchStudy SMART route jurisdiction does not match the tenant jurisdiction.', IssueType.Forbidden);
      }
    }

    // --- Consent Rule Check (MVP) ---
    // This is a minimal permission gate to support unit/integration tests.
    // A stricter implementation should:
    // - verify the request signature and bind `sub` to a registered employee/practitioner identity,
    // - parse all scope items and map to rule semantics (resource-level + section-level),
    // - apply deny-overrides and purpose logic.
    const actor = parseActorFromSub(sub);
    const tenantControllerDids = Array.isArray(issuerDidDoc?.controller)
      ? issuerDidDoc.controller
      : issuerDidDoc?.controller ? [issuerDidDoc.controller] : [];
    const isCurrentTenantController = tenantControllerDids
      .map((value) => String(value || '').trim())
      .includes(actor.sub);
    if (study
      && scope === buildResearchStudyControllerImportScope(study)
      && !isCurrentTenantController) {
      throw new ManagerError('ResearchStudy create scope requires a current tenant controller.', IssueType.Forbidden);
    }
    const professionalDidIdentity = parseProfessionalDidIdentity(actor.sub);
    const tenantIdentifierUrn = await this.tenantsCacheManager.getTenantIdentifierUrn?.(tenantVaultId);
    const routeTenantIdentifiers = new Set([
      job.tenantId,
      parseTenantUrn(String(tenantIdentifierUrn || ''))?.idValue,
    ].map((value) => String(value || '').trim().toUpperCase()).filter(Boolean));
    const isSameTenantProfessional = actor.memberKind !== 'individual'
      && Boolean(professionalDidIdentity)
      && routeTenantIdentifiers.has(String(professionalDidIdentity?.organizationIdentifier || '').toUpperCase());
    const purpose = body.purpose?.trim();
    if (study && purpose !== HealthcareConsentPurposes.Research) {
      throw new ManagerError('ResearchStudy SMART requires the HRESCH purpose.', IssueType.Forbidden);
    }
    const requestedCapabilities = this.extractRequestedCapabilities(scope);
    const isInterTenantResearchAccess = requestedCapabilities.some((capability) =>
      capability === ServiceCapability.DigitalTwinReader
      || capability === ServiceCapability.DigitalTwinProvider
    );
    const vpToken = body.vp_token?.trim();
    const accessProof = await this.resolveAccessProof({
      acrValues,
      actorOrganizationDid: actor.organization,
      issuerDid,
      purpose,
      requestedCapabilities,
      vpToken,
      presentationSubmission: body.presentation_submission,
      bearerPayload: (job.content as any)?.meta?.bearer?.jwt?.payload,
      registeredDeviceProfile,
      tenantVaultId,
      actorDid: actor.sub,
      subjectDid: subject,
      authenticatedSubject: String((job.content as any)?.meta?.bearer?.jwt?.payload?.sub || '').trim(),
      authenticatedActorIdentifiers: getAuthenticatedJobActorIdentifiers(job),
    });

    // Inter-tenant research contract gate:
    // - issuerDid = tenant that is about to issue the SMART token
    // - extract the tenant identifier from the professional DID; neither the
    //   hostname nor whole-DID alias equality proves membership
    // - only DigitalTwin/ResearchSubject capabilities represent the research
    //   contract boundary; individual Composition self-read remains governed
    //   by its subject-scoped consent rules
    // - when research actor and issuer differ, the VP must carry one contract
    //   VC proving:
    //   1. provider organization = issuer tenant (`acme`)
    //   2. consumer organization = foreign requester tenant (`lab`)
    //   3. capability allows the requested scope
    //      example: `organization/ResearchSubject.rs`
    //   4. purpose allows the requested business reason
    //      example: `HRESCH` (HL7 v3 ActReason)
    if (isInterTenantResearchAccess && actor.organization && !isSameTenantProfessional) {
      if (accessProof.mode === 'vp_token') {
        const matchingContract = getMatchingInterTenantAccessContractFromVpToken(vpToken!, {
          providerOrganizationDid: issuerDid,
          consumerOrganizationDid: actor.organization,
          requiredCapabilities: requestedCapabilities,
          purpose,
        });
        if (!matchingContract) {
          throw new ManagerError(
            `No active inter-tenant access contract found for consumer '${actor.organization}'.`,
            IssueType.Forbidden,
          );
        }
      }
    }
    const actorSubjectAliases = new Set<string>([actor.sub]);
    let controllerCredential: ReturnType<typeof getMatchingIndividualControllerCredentialFromVpToken>;
    let memberCredential: ReturnType<typeof getMatchingIndividualMemberCredentialFromVpToken>;
    let memberLicense: DeviceLicense | undefined;
    const isIndividualAccessProof = String(accessProof.acr || '').toLowerCase().includes('individual');
    if (!isInterTenantResearchAccess && isIndividualAccessProof && actor.sub !== subject) {
      const trustedIssuerDids = this.readTrustedSubjectIdentityBindingIssuers();
      controllerCredential = accessProof.mode === 'vp_token'
        ? getMatchingIndividualControllerCredentialFromVpToken(vpToken!, {
            actorDid: actor.sub,
            subjectDid: subject,
            relationship: actor.role,
            issuerDid,
          })
        : undefined;
      memberCredential = accessProof.mode === 'vp_token'
        ? getMatchingIndividualMemberCredentialFromVpToken(vpToken!, {
            actorDid: actor.sub,
            subjectDid: subject,
            relationship: actor.role,
          })
        : undefined;
      const binding = accessProof.mode === 'vp_token'
        ? getMatchingSubjectIdentityBindingFromVpToken(vpToken!, {
            trustedIssuerDids,
            requiredSubjectDids: [actor.sub, subject],
            sector: job.sector,
          })
        : undefined;
      if (!binding && !controllerCredential && !memberCredential
        && accessProof.mode !== 'registered_individual_controller') {
        throw new ManagerError(
          `No trusted subject identity binding found between actor '${actor.sub}' and subject '${subject}'.`,
          IssueType.Forbidden,
        );
      }
      if (memberCredential) {
        memberLicense = await this.getActiveMemberLicense({
          tenantVaultId,
          subject,
          actorIdentifier: actor.identifier,
          actorRole: actor.role,
        });
        if (!memberLicense) {
          throw new ManagerError('No active individual-member license binds this actor to the requested subject.', IssueType.Forbidden);
        }
      }
      if (binding) {
        actorSubjectAliases.add(binding.subjectDid);
        binding.aliasDids.forEach((did) => actorSubjectAliases.add(did));
      }
      memberCredential?.sameAs.forEach((alias) => actorSubjectAliases.add(alias));
    }
    const rules = study
      ? []
      : subject === '*' && isInterTenantResearchAccess && isSameTenantProfessional
        ? await this.getSubjectSpecificResearchRules(tenantVaultId)
        : await this.vaultRepository.getContainersInSection<any>(tenantVaultId, getIndividualSectionId(subject, 'rules'));
    const professionalCredential = accessProof.mode === 'vp_token' && vpToken && actor.role
      ? getMatchingProfessionalCredentialFromVpToken(vpToken, {
          actorDid: actor.sub,
          role: actor.role,
        })
      : undefined;
    if (isInterTenantResearchAccess && isSameTenantProfessional) {
      const credentialBindsEmployee = Boolean(
        professionalCredential
        && professionalDidIdentity
        && professionalCredential.sameAs.includes(professionalDidIdentity.stableActorIdentifier),
      );
      const hasActiveEmploymentAndLicense = credentialBindsEmployee
        && await this.hasActiveEmployeeIdentityAndLicense({
          tenantVaultId,
          identity: professionalDidIdentity!,
        });
      if (!hasActiveEmploymentAndLicense) {
        throw new ManagerError(
          'No active employee identity and applicable licence found for same-tenant research access.',
          IssueType.Forbidden,
        );
      }
    }
    const activeRules = (rules || []).filter((rule) => this.isRuleTimeActive(rule));
    let grantedScope = scope;
    const requestedScopeTokens = scope.split(/\s+/).map((value) => value.trim()).filter(Boolean);
    const compositionReadOnlyRequest = requestedScopeTokens.length > 0
      && requestedScopeTokens.every((value) =>
        /^organization\/Composition\.(?:r|rs)\?/i.test(value));
    const sharedProjection = compositionReadOnlyRequest
      ? deriveGrantedSmartScopes(activeRules as ConsentRule[], {
          requestedScopes: requestedScopeTokens,
          actor: {
            actorKind: actor.sub.includes(':family:') ? 'related-person' : 'professional',
            did: actor.sub,
            aliases: Array.from(actorSubjectAliases),
            email: memberLicense?.issuedToEmail
              || (actor.identifier?.includes('@') ? actor.identifier : undefined),
            phone: memberLicense?.issuedToPhone,
            organizationDid: actor.organization,
            jurisdiction: job.jurisdiction,
          },
          actorRole: actor.role,
          purpose,
        })
      : undefined;
    const sharedApplicableRules = sharedProjection
      ? sharedProjection.evaluations.flatMap((consentEvaluation) => consentEvaluation.allowed
          ? consentEvaluation.winningRules
            .filter((match) => match.decision === 'permit')
            .map((match) => match.rule)
          : [])
      : [];
    const studyAuthorization = study
      ? isCurrentTenantController
        ? await this.authorizeControllerResearchStudyImport({
          tenantVaultId,
          tenantId: job.tenantId,
          actorDid: actor.sub,
          scope,
          studyReference: study,
          vpToken,
          accessProofMode: accessProof.mode,
        })
        : await this.authorizeResearchStudyAccess({
          tenantVaultId,
          actorDid: actor.sub,
          scope,
          studyReference: study,
          registeredDeviceProfile,
        })
      : undefined;
    const evaluation = studyAuthorization
      ? {
          allowed: true,
          missingSections: [] as string[],
          missingResourceTypes: [] as string[],
          applicableRules: [studyAuthorization],
        }
      : controllerCredential || accessProof.mode === 'registered_individual_controller'
      ? {
          // A verified controller VC is first-party authority for this exact
          // subject. It does not create authority for any other animal because
          // actor, subject, relationship and issuer were matched above and all
          // requested root scopes are already pinned to that single subject.
          allowed: true,
          missingSections: [] as string[],
          missingResourceTypes: [] as string[],
          applicableRules: [] as ConsentRule[],
        }
      : sharedProjection
      ? {
          allowed: sharedProjection.grantedScopes.length > 0,
          missingSections: sharedProjection.deniedSections,
          missingResourceTypes: [] as string[],
          applicableRules: sharedApplicableRules,
        }
      : this.evaluateRequestedConsent({
          rules: activeRules,
          subject,
          actor,
          purpose,
          requestedPermissions,
          jurisdiction: job.jurisdiction,
          actorSubjectAliases,
        });

    let breakGlassAuthorization: BreakGlassAuthorization | undefined;
    if (body.break_glass) {
      if (!this.breakGlassAuthorizer) {
        throw new ManagerError('Break-glass is not enabled.', IssueType.Forbidden);
      }
      if (accessProof.mode !== 'vp_token' || !professionalCredential || !actor.role) {
        throw new ManagerError('A verified professional credential is required for break-glass.', IssueType.Forbidden);
      }
      try {
        breakGlassAuthorization = await this.breakGlassAuthorizer.authorize({
          tenantId: job.tenantId,
          jurisdiction: job.jurisdiction,
          routeSector: job.sector,
          actorDid: actor.sub,
          actorOrganizationDid: actor.organization || '',
          requestingClientId: clientId || String(job.content?.iss || ''),
          tokenAudience: issuerDid,
          professionalRole: actor.role,
          subjectDid: subject,
          requestedScope: scope,
          request: body.break_glass,
          professionalCredentialVerified: true,
          ledgerVerified: accessProof.ledgerVerified,
          requestedLifetimeSeconds: Math.max(1, Math.min(900, body.expires_in || 300)),
        });
      } catch (error) {
        throw new ManagerError(
          `Break-glass authorization denied: ${error instanceof Error ? error.message : 'unknown_error'}`,
          IssueType.Forbidden,
        );
      }
    }

    if (!evaluation.allowed && !breakGlassAuthorization) {
      const missingSections = evaluation.missingSections.map((value) => normalizeCodeSystemAndValue(value)).filter(Boolean);
      const detail = [
        missingSections.length ? `missing sections=${missingSections.join(',')}` : '',
        evaluation.missingResourceTypes.length ? `missing resourceTypes=${evaluation.missingResourceTypes.join(',')}` : '',
      ].filter(Boolean).join('; ');
      throw new ManagerError(
        detail
          ? `No matching consent rule found for requested scope. ${detail}`
          : 'No matching consent rule found for requested scope.',
        IssueType.Forbidden,
      );
    }
    if (sharedProjection && !controllerCredential && !breakGlassAuthorization) {
      grantedScope = sharedProjection.grantedScopes.join(' ');
    }
    let accessSubject = study || subject;
    if (isInterTenantResearchAccess && subject.includes(':individual:')) {
      accessSubject = await getOrCreateDigitalTwinSubjectId({
        vaultRepository: this.vaultRepository,
        tenantVaultId,
        sourceSubject: subject,
      });
      grantedScope = grantedScope.split(/\s+/).map((scopeToken) => {
        const [head, query = ''] = scopeToken.split('?');
        const params = new URLSearchParams(query);
        if (params.get('subject') === subject) params.set('subject', accessSubject);
        return params.size > 0 ? `${head}?${params.toString()}` : head;
      }).join(' ');
    }

    const requestedLifetimeSeconds = breakGlassAuthorization?.lifetimeSeconds
      ?? Math.max(1, Math.min(3600, body.expires_in || 300));
    const tokenType = body.token_type || 'Bearer';

    const issuerVaultId = job.tenantId === 'host' ? 'host' : getTenantVaultId(job.sector, job.tenantId);

    const legacyEnabled = process.env.SMART_TOKEN_LEGACY !== 'false';
    const legacyAlgCandidate = (process.env.LEGACY_SIGN_ALG === 'ES256' || process.env.LEGACY_SIGN_ALG === 'ES384')
      ? process.env.LEGACY_SIGN_ALG
      : 'ES384';
    let signingKey = await this.kmsService.getPublicVerificationKey(issuerVaultId, undefined, 'comm_sig');
    if (legacyEnabled) {
      const legacyKey = await this.kmsService.getPublicVerificationKey(issuerVaultId, legacyAlgCandidate, 'comm_sig');
      if (legacyKey?.kid) {
        signingKey = legacyKey;
      }
    }
    if (!signingKey?.kid) {
      throw new ManagerError('Could not resolve issuer signing key.', IssueType.Exception);
    }

    const now = Math.floor(Date.now() / 1000);
    const consentPeriodEnd = this.resolveEarliestPeriodEnd(evaluation.applicableRules);
    const ordinaryTokenExpiration = consentPeriodEnd === undefined
      ? now + requestedLifetimeSeconds
      : Math.min(now + requestedLifetimeSeconds, Math.floor(consentPeriodEnd / 1000));
    const tokenExpiration = breakGlassAuthorization
      ? Math.min(ordinaryTokenExpiration, Math.floor(Date.parse(breakGlassAuthorization.expiresAt) / 1000))
      : ordinaryTokenExpiration;
    if (tokenExpiration <= now) {
      throw new ManagerError('The matching consent rule expired before the access token could be issued.', IssueType.Forbidden);
    }
    const lifetimeSeconds = tokenExpiration - now;
    const jwtPayload = {
      iss: issuerDid,
      sub,
      aud: issuerDid,
      scope: grantedScope,
      // RFC 8693 consumers such as DataConv must be able to validate the
      // study authorization offline from the signed token. These claims are
      // deliberately absent from ordinary subject-scoped SMART tokens.
      purpose: study ? HealthcareConsentPurposes.Research : undefined,
      study: study || undefined,
      iat: now,
      nbf: now,
      exp: tokenExpiration,
      acr: accessProof.acr,
      amr: accessProof.amr,
      vp_hash: accessProof.vpHash,
      ledger_verified: accessProof.ledgerVerified,
      emergency: breakGlassAuthorization ? true : undefined,
      emergency_consent_id: breakGlassAuthorization?.emergencyConsentId,
      emergency_consent_expires_at: breakGlassAuthorization?.consentExpiresAt,
      break_glass_authorization_id: breakGlassAuthorization?.authorizationId,
      break_glass_incident_id: breakGlassAuthorization ? body.break_glass?.incidentId : undefined,
    };

    // The KMS must sign the exact compact-JWS header and JWT claims returned to
    // the caller. Signing an internal byte wrapper and reusing only its
    // signature would produce a token whose visible payload cannot verify.
    const accessToken = await this.kmsService.createCompactJws(
      jwtPayload,
      signingKey.kid,
      issuerVaultId,
      'comm_sig',
      { typ: 'JWT' },
    );

    return {
      jti: job.content?.jti || thid,
      thid,
      iss: issuerDid,
      aud: job.content?.iss as string,
      exp: tokenExpiration,
      type: 'application/json',
      body: {
        access_token: accessToken,
        token_type: tokenType,
        expires_in: lifetimeSeconds,
        scope: grantedScope,
        subject: accessSubject,
        ledger_verified: accessProof.ledgerVerified,
        emergency: breakGlassAuthorization ? true : undefined,
        emergency_consent_id: breakGlassAuthorization?.emergencyConsentId,
        emergency_consent_expires_at: breakGlassAuthorization?.consentExpiresAt,
        break_glass_authorization_id: breakGlassAuthorization?.authorizationId,
      },
    };
  }

  private async resolveAccessProof(params: {
    acrValues: string[];
    actorOrganizationDid?: string;
    issuerDid: string;
    purpose?: string;
    requestedCapabilities: string[];
    vpToken?: string;
    presentationSubmission?: any;
    bearerPayload?: Record<string, any>;
    registeredDeviceProfile?: Record<string, any>;
    tenantVaultId: string;
    actorDid: string;
    subjectDid: string;
    authenticatedSubject?: string;
    authenticatedActorIdentifiers: string[];
  }): Promise<AccessProofResult> {
    if (params.vpToken) {
      const clearingResult = await this.clearingHouseService.verifyVpToken({
        vpToken: params.vpToken,
        presentationSubmission: params.presentationSubmission,
        acrValues: params.acrValues,
      });

      if (!params.acrValues.includes(clearingResult.acr)) {
        throw new ManagerError('Clearing House returned an unexpected acr value.', IssueType.Forbidden);
      }

      return {
        mode: 'vp_token',
        acr: clearingResult.acr,
        amr: Array.isArray(clearingResult.amr) ? clearingResult.amr : [],
        vpHash: clearingResult.vpHash,
        ledgerVerified: clearingResult.ledgerVerified,
      };
    }

    const individualAcr = params.acrValues.find((value) => value.toLowerCase().includes('individual'));
    const profile = params.registeredDeviceProfile;
    if (individualAcr && profile) {
      const registeredControllerMatches = String(profile.status || 'active') === 'active'
        && String(profile.actorDid || '') === params.actorDid
        && String(profile.profileDid || '') === params.actorDid
        && Boolean(String(profile.authenticatedSubject || ''))
        && (!params.authenticatedSubject
          || String(profile.authenticatedSubject || '') === params.authenticatedSubject)
        && Boolean(String(profile.licenseId || ''));
      if (registeredControllerMatches && await this.isRegisteredControllerSubjectAuthorized({
        tenantVaultId: params.tenantVaultId,
        profile,
        requestedSubjectDid: params.subjectDid,
        authenticatedActorIdentifiers: params.authenticatedActorIdentifiers,
      })) {
        return {
          mode: 'registered_individual_controller',
          acr: individualAcr,
          amr: ['dcr', 'private_key_jwt', 'individual_controller'],
          ledgerVerified: false,
        };
      }
      throw new ManagerError(
        'DCR-bound individual controller is not authorized for the requested subject.',
        IssueType.Forbidden,
      );
    }

    return this.resolveExternalResearchBearerProof(params);
  }

  /**
   * Resolves a controller profile's exact private subject, another exact
   * subject controlled by the same registered actor, or the public card alias
   * persisted on the originally licensed individual Organization.
   *
   * A second subject is never inferred from a directory result or `sameAs`.
   * It requires its own active individual-controller seat with bare RESPRSN,
   * the exact requested subject DID and the same stable `activatedBy` binding
   * as the active seat which authorized DCR. This keeps one personal device
   * profile usable across that actor's animals without manufacturing a VP or
   * allowing a contact collision to become controller authority. Historical
   * controller seats created before `activatedBy` existed are accepted only
   * when both the original DCR seat and the requested subject seat carry the
   * same exact email or telephone already verified into the device profile.
   * This is a bounded migration path, not the canonical authorization model.
   */
  private async isRegisteredControllerSubjectAuthorized(input: {
    tenantVaultId: string;
    profile: Record<string, any>;
    requestedSubjectDid: string;
    authenticatedActorIdentifiers: string[];
  }): Promise<boolean> {
    const authorizedSubjectDid = String(input.profile.authorizedSubjectDid || '').trim();
    const requestedSubjectDid = String(input.requestedSubjectDid || '').trim();
    if (!authorizedSubjectDid || !requestedSubjectDid) return false;
    if (authorizedSubjectDid === requestedSubjectDid) return true;

    const licenseId = String(input.profile.licenseId || '').trim();
    if (!licenseId) return false;
    const licenseDocument = await this.vaultRepository.get<any>(
      input.tenantVaultId,
      licenseId,
      getEnvSectionId('device-licenses'),
    );
    if (!licenseDocument) return false;
    const license = await this.kmsService.unprotectConfidentialData<DeviceLicense & Record<string, unknown>>(
      licenseDocument,
      input.tenantVaultId,
    ).catch(() => undefined);
    const subjectId = String(license?.subjectId || '').trim();
    if (!license
      || String(license.status || '').trim() !== LICENSE_STATUS_ACTIVE
      || String(license.authorizedSubjectDid || '').trim() !== authorizedSubjectDid
      || !subjectId) return false;

    const stableActorIdentifier = String(license.activatedBy || '').trim();
    const verifiedEmail = normalizeIndexedEmail(input.profile.authenticatedEmail);
    const verifiedPhone = normalizeIndexedPhone(input.profile.authenticatedTelephone);
    const authenticatedActorIdentifiers = new Set([
      stableActorIdentifier,
      ...(verifiedEmail ? [buildStableActorIdentifier({ contactKind: 'email', contact: verifiedEmail })] : []),
      ...(verifiedPhone ? [buildStableActorIdentifier({ contactKind: 'phone', contact: verifiedPhone })] : []),
      ...input.authenticatedActorIdentifiers.map((value) => String(value || '').trim()),
    ].filter(Boolean));
    const controllerRole = normalizeCodeSystemAndValue(String(license.issuedToRole || ''));
    const controllerRoleCode = HealthcareActorRoleCodes.Controller.toLowerCase();
    const isControllerRole = (role: unknown): boolean => {
      const normalizedRole = normalizeCodeSystemAndValue(String(role || ''));
      return normalizedRole === controllerRoleCode || normalizedRole.endsWith(`:${controllerRoleCode}`);
    };
    const tenantCollectionName = await this.tenantsCacheManager.getCollectionName(input.tenantVaultId)
      || input.tenantVaultId;
    const seatOwnsRequestedSubject = async (
      candidate: DeviceLicense & Record<string, unknown>,
    ): Promise<boolean> => {
      if (String(candidate.authorizedSubjectDid || '').trim() === requestedSubjectDid) return true;
      if (normalizePublicAliasList(candidate.authorizedSubjectAliases as string | string[] | undefined)
        .includes(requestedSubjectDid)) return true;
      const candidateSubjectId = String(candidate.subjectId || '').trim();
      if (!candidateSubjectId) return false;
      const candidateSubjectDocument = await this.vaultRepository.get<any>(
        tenantCollectionName,
        candidateSubjectId,
        getEnvSectionId(SUBJECT_SECTION_INDIVIDUAL),
      );
      if (!candidateSubjectDocument) return false;
      const candidateSubjectContent = candidateSubjectDocument.content
        ? candidateSubjectDocument.content as Record<string, any>
        : await this.kmsService.unprotectConfidentialData<Record<string, any>>(
            candidateSubjectDocument,
            input.tenantVaultId,
          ).catch(() => undefined);
      const candidateClaims = candidateSubjectContent?.claims;
      const aliases = candidateClaims
        && typeof candidateClaims === 'object'
        && !Array.isArray(candidateClaims)
        ? normalizePublicAliasList(candidateClaims[ClaimsOrganizationSchemaorg.sameAs])
        : [];
      return aliases.includes(requestedSubjectDid);
    };
    let licenseDocuments: any[] | undefined;
    const getLicenseDocuments = async (): Promise<any[]> => {
      licenseDocuments ??= await this.vaultRepository.getContainersInSection<any>(
        input.tenantVaultId,
        getEnvSectionId('device-licenses'),
      ) || [];
      return licenseDocuments;
    };
    if (String(license.userClass || '').trim() === LICENSE_USER_CLASS_INDIVIDUAL
      && stableActorIdentifier
      && isControllerRole(controllerRole)) {
      for (const candidateDocument of await getLicenseDocuments()) {
        const candidate = candidateDocument.content
          ? candidateDocument.content as DeviceLicense & Record<string, unknown>
          : await this.kmsService.unprotectConfidentialData<DeviceLicense & Record<string, unknown>>(
              candidateDocument,
              input.tenantVaultId,
            ).catch(() => undefined);
        if (candidate
          && String(candidate.status || '').trim() === LICENSE_STATUS_ACTIVE
          && String(candidate.userClass || '').trim() === LICENSE_USER_CLASS_INDIVIDUAL
          && authenticatedActorIdentifiers.has(String(candidate.activatedBy || '').trim())
          && isControllerRole(candidate.issuedToRole)
          && await seatOwnsRequestedSubject(candidate)) {
          return true;
        }
      }
    }

    const originalSeatMatchesVerifiedContact = Boolean(
      (verifiedEmail && normalizeIndexedEmail(license.issuedToEmail) === verifiedEmail)
      || (verifiedPhone && normalizeIndexedPhone(license.issuedToPhone) === verifiedPhone),
    );
    if (String(license.userClass || '').trim() === LICENSE_USER_CLASS_INDIVIDUAL
      && !stableActorIdentifier
      && isControllerRole(controllerRole)
      && originalSeatMatchesVerifiedContact) {
      for (const candidateDocument of await getLicenseDocuments()) {
        const candidate = candidateDocument.content
          ? candidateDocument.content as DeviceLicense & Record<string, unknown>
          : await this.kmsService.unprotectConfidentialData<DeviceLicense & Record<string, unknown>>(
              candidateDocument,
              input.tenantVaultId,
            ).catch(() => undefined);
        if (!candidate
          || String(candidate.status || '').trim() !== LICENSE_STATUS_ACTIVE
          || String(candidate.userClass || '').trim() !== LICENSE_USER_CLASS_INDIVIDUAL
          || String(candidate.activatedBy || '').trim()
          || !isControllerRole(candidate.issuedToRole)) {
          continue;
        }
        const candidateMatchesVerifiedContact = Boolean(
          (verifiedEmail && normalizeIndexedEmail(candidate.issuedToEmail) === verifiedEmail)
          || (verifiedPhone && normalizeIndexedPhone(candidate.issuedToPhone) === verifiedPhone),
        );
        if (candidateMatchesVerifiedContact && await seatOwnsRequestedSubject(candidate)) return true;
      }
    }

    return seatOwnsRequestedSubject(license);
  }

  /**
   * Requires both the current tenant Employee record and its applicable active
   * professional seat. This proves current employment; the matching active
   * Consent is evaluated independently and can never be replaced by it.
   */
  private async hasActiveEmployeeIdentityAndLicense(input: {
    tenantVaultId: string;
    identity: Readonly<{ stableActorIdentifier: string; role: string }>;
  }): Promise<boolean> {
    const employeeCollectionName = await this.tenantsCacheManager.getCollectionName?.(input.tenantVaultId)
      || input.tenantVaultId;
    return hasActiveProfessionalIdentityAndLicense({
      tenantVaultId: input.tenantVaultId,
      employeeCollectionName,
      identity: input.identity,
      vaultRepository: this.vaultRepository,
      kmsService: this.kmsService,
    });
  }

  /**
   * Resolves the accepted member license that binds the authenticated Firebase
   * actor, subject and relationship. Its verified email/telephone may then be
   * used for Consent matching; the privacy-preserving VP aliases stay hashed.
   */
  private async getActiveMemberLicense(input: {
    tenantVaultId: string;
    subject: string;
    actorIdentifier?: string;
    actorRole?: string;
  }): Promise<DeviceLicense | undefined> {
    const actorIdentifier = String(input.actorIdentifier || '').trim();
    const actorRole = String(input.actorRole || '').trim().toLowerCase();
    if (!actorIdentifier || !actorRole) return undefined;
    const documents = await this.vaultRepository.getContainersInSection<any>(
      input.tenantVaultId,
      getEnvSectionId('device-licenses'),
    );
    return (documents || []).map((document: any) =>
      document?.content as DeviceLicense & Record<string, unknown> | undefined
    ).find((license) => {
      return license?.status === 'active'
        && String(license.subjectId || '').replace(/^firebase:/, '') === actorIdentifier.replace(/^firebase:/, '')
        && String(license.authorizedSubjectDid || '').trim() === input.subject
        && String(license.issuedToRole || '').trim().toLowerCase() === actorRole;
    });
  }

  private async validateClientAssertion(params: {
    body: TokenRequestBody;
    clientId?: string;
    issuerDid: string;
    tenantVaultId: string;
  }): Promise<Record<string, any> | undefined> {
    const clientAssertion = params.body.client_assertion?.trim();
    const clientAssertionType = params.body.client_assertion_type?.trim();
    if (!clientAssertion && !clientAssertionType) {
      return undefined;
    }

    if (!clientAssertion) {
      throw new ManagerError("Missing 'client_assertion' in token request body.", IssueType.Required);
    }
    if (!clientAssertionType) {
      throw new ManagerError("Missing 'client_assertion_type' in token request body.", IssueType.Required);
    }
    if (!this.isSupportedClientAssertionType(clientAssertionType)) {
      throw new ManagerError(`Unsupported client_assertion_type '${clientAssertionType}'.`, IssueType.NotSupported);
    }

    const payload = await this.verifyClientAssertionSignature(clientAssertion, params.clientId, params.tenantVaultId);
    const assertionClientId = String(payload?.iss || '').trim();
    if (!assertionClientId) {
      throw new ManagerError('client_assertion must include iss.', IssueType.Required);
    }
    if (params.clientId && assertionClientId !== params.clientId) {
      throw new ManagerError('client_assertion iss must match body.client_id.', IssueType.Forbidden);
    }

    const assertionSub = String(payload?.sub || '').trim();
    if (assertionSub && assertionSub !== assertionClientId) {
      throw new ManagerError('client_assertion sub must match client identity.', IssueType.Forbidden);
    }

    const audience = this.readAudienceString(payload?.aud);
    if (!audience) {
      throw new ManagerError('client_assertion must include aud.', IssueType.Required);
    }
    if (audience !== params.issuerDid && !audience.includes('/identity/openid/smart/token')) {
      throw new ManagerError('client_assertion aud does not target this SMART token endpoint.', IssueType.Forbidden);
    }
    if (!params.clientId) return undefined;
    const deviceProfileDoc = await this.vaultRepository.get<any>(
      params.tenantVaultId,
      params.clientId,
      getEnvSectionId('device-profiles'),
    );
    if (!deviceProfileDoc || String(deviceProfileDoc.status || 'active') !== 'active') return undefined;
    const profile = this.kmsService.unprotectConfidentialData
      ? await this.kmsService.unprotectConfidentialData<any>(deviceProfileDoc, params.tenantVaultId).catch(() => undefined)
      : deviceProfileDoc?.content;
    if (!profile || typeof profile !== 'object') return undefined;
    await this.assertClientAssertionUsesRegisteredKey(clientAssertion, profile);
    return profile;
  }

  /**
   * Re-verifies an assertion with the DCR-stored public key. A header JWK is
   * only a matching hint and can never replace registered key authority.
   */
  private async assertClientAssertionUsesRegisteredKey(compact: string, profile: Record<string, any>): Promise<void> {
    const header = decodeProtectedHeader(compact);
    const alg = String(header.alg || '').trim();
    const keys = Array.isArray(profile?.jwks?.keys) ? profile.jwks.keys as JWK[] : [];
    const kid = String(header.kid || '').trim();
    let candidates = kid
      ? keys.filter((key) => String(key.kid || '').trim() === kid)
      : keys;
    if (header.jwk && typeof header.jwk === 'object') {
      const embeddedThumbprint = await calculateJwkThumbprint(header.jwk as JWK);
      const matches: JWK[] = [];
      for (const key of candidates) {
        if (await calculateJwkThumbprint(key) === embeddedThumbprint) matches.push(key);
      }
      candidates = matches;
    }
    for (const key of candidates) {
      try {
        await compactVerify(compact, await importJWK(key, alg));
        return;
      } catch {
        // Try the next registered public key.
      }
    }
    throw new ManagerError('client_assertion is not signed by the registered DCR device key.', IssueType.Security);
  }

  private isSupportedClientAssertionType(value: string): boolean {
    const normalized = value.trim().toLowerCase();
    return normalized === 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer'
      || normalized === 'private_key_jwt'
      || normalized === 'client_assertion';
  }

  private async verifyClientAssertionSignature(
    compact: string,
    clientId: string | undefined,
    tenantVaultId: string,
  ): Promise<Record<string, any>> {
    const header = decodeProtectedHeader(compact);
    const alg = String(header.alg || '').trim();
    if (!alg || alg.toLowerCase() === 'none') {
      throw new ManagerError('client_assertion must be signed with a supported algorithm.', IssueType.Security);
    }

    const jwks = await this.resolveClientAssertionJwks(compact, header, clientId, tenantVaultId, alg);
    let lastError = '';
    for (const jwk of jwks) {
      try {
        const keyLike = await importJWK(jwk as JWK, alg);
        const { payload } = await compactVerify(compact, keyLike);
        return JSON.parse(Content.bytesToStringUTF8(payload));
      } catch (error: any) {
        lastError = error instanceof Error ? error.message : String(error);
      }
    }

    throw new ManagerError(
      `Invalid client_assertion signature${lastError ? `: ${lastError}` : ''}`,
      IssueType.Security,
    );
  }

  private async resolveClientAssertionJwks(
    compact: string,
    header: Record<string, any>,
    clientId: string | undefined,
    tenantVaultId: string,
    alg: string,
  ): Promise<Record<string, any>[]> {
    const resolved: Record<string, any>[] = [];
    const embedded = header.jwk;
    if (embedded && typeof embedded === 'object') {
      resolved.push(embedded as Record<string, any>);
    }

    if (clientId) {
      const deviceProfileDoc = await this.vaultRepository.get<any>(
        tenantVaultId,
        clientId,
        getEnvSectionId('device-profiles'),
      );
      if (deviceProfileDoc) {
        const profile = this.kmsService.unprotectConfidentialData
          ? await this.kmsService.unprotectConfidentialData<any>(deviceProfileDoc, tenantVaultId).catch(() => undefined)
          : deviceProfileDoc?.content;
        const keys = Array.isArray(profile?.jwks?.keys) ? profile.jwks.keys : [];
        const kid = String(header.kid || '').trim();
        for (const key of keys) {
          if (!key || typeof key !== 'object') continue;
          if (kid && String((key as any).kid || '').trim() && String((key as any).kid).trim() !== kid) continue;
          if (String((key as any).alg || '').trim() && String((key as any).alg).trim() !== alg) continue;
          resolved.push(key as Record<string, any>);
        }
      }
    }

    if (resolved.length === 0) {
      throw new ManagerError(
        `Could not resolve verification key material for client_assertion${clientId ? ` client_id='${clientId}'` : ''}.`,
        IssueType.NotFound,
      );
    }
    return resolved;
  }

  private resolveExternalResearchBearerProof(params: {
    acrValues: string[];
    actorOrganizationDid?: string;
    issuerDid: string;
    purpose?: string;
    requestedCapabilities: string[];
    bearerPayload?: Record<string, any>;
  }): AccessProofResult {
    const purpose = String(params.purpose || '').trim().toUpperCase();
    if (purpose !== HealthcareConsentPurposes.Research) {
      throw new ManagerError("Missing 'vp_token' in token request body.", IssueType.Required);
    }

    if (!params.actorOrganizationDid || params.actorOrganizationDid === params.issuerDid) {
      throw new ManagerError("Missing 'vp_token' in token request body.", IssueType.Required);
    }

    const payload = params.bearerPayload;
    if (!payload || typeof payload !== 'object') {
      throw new ManagerError(
        'Missing validated external research Bearer token metadata for SMART token request.',
        IssueType.Required,
      );
    }

    const trustedIssuers = this.readTrustedExternalResearchIssuers();
    const externalIssuer = this.readFirstString(payload, ['iss', 'issuer']);
    if (!externalIssuer || !trustedIssuers.has(externalIssuer)) {
      throw new ManagerError('External research Bearer token issuer is not trusted.', IssueType.Forbidden);
    }

    const consumerOrganizationDid = this.readFirstString(payload, [
      'consumer_organization',
      'consumerOrganizationDid',
      'organization',
      'organizationDid',
      'org',
    ]);
    if (!consumerOrganizationDid || consumerOrganizationDid !== params.actorOrganizationDid) {
      throw new ManagerError('External research Bearer token consumer organization does not match requester.', IssueType.Forbidden);
    }

    const providerOrganizationDid = this.readFirstString(payload, [
      'provider_organization',
      'providerOrganizationDid',
    ]) || this.readAudienceString(payload.aud);
    if (!providerOrganizationDid || providerOrganizationDid !== params.issuerDid) {
      throw new ManagerError('External research Bearer token provider does not match issuer tenant.', IssueType.Forbidden);
    }

    const purposes = this.readStringValues(payload, ['purpose', 'purposes']);
    if (!purposes.some((value) => value.toUpperCase() === purpose)) {
      throw new ManagerError('External research Bearer token purpose does not match request.', IssueType.Forbidden);
    }

    const grantedCapabilities = this.readGrantedCapabilities(payload);
    if (!params.requestedCapabilities.every((capability) => grantedCapabilities.includes(capability))) {
      throw new ManagerError('External research Bearer token capabilities do not cover requested scope.', IssueType.Forbidden);
    }

    const externalAcr = this.readFirstString(payload, ['acr']);
    const acr = externalAcr && params.acrValues.includes(externalAcr)
      ? externalAcr
      : params.acrValues[0];

    return {
      mode: 'external_research_bearer',
      acr,
      amr: this.readStringValues(payload, ['amr']).length
        ? this.readStringValues(payload, ['amr'])
        : ['external_bearer', 'data_access_token'],
      ledgerVerified: typeof payload.ledger_verified === 'boolean'
        ? payload.ledger_verified
        : true,
    };
  }

  private readTrustedExternalResearchIssuers(): Set<string> {
    const configured = String(process.env.EXTERNAL_RESEARCH_TOKEN_TRUSTED_ISSUERS || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    return new Set(configured);
  }

  /**
   * Reads the fail-closed allowlist of authorities that may bind two public
   * DIDs belonging to the same individual.
   *
   * This is an issuer policy after VP/VC proof verification. It never turns a
   * DID Document `alsoKnownAs` value or a physical support/card DID into an
   * authorization identity. In UNID, callers first resolve the card DID
   * Document and use its canonical `subject` DID.
   */
  private readTrustedSubjectIdentityBindingIssuers(): string[] {
    return Array.from(new Set(
      String(process.env.SUBJECT_IDENTITY_BINDING_TRUSTED_ISSUERS || '')
        .split(',')
        .map((value) => value.trim())
        .filter((value) => value.startsWith('did:web:')),
    ));
  }

  private readFirstString(source: Record<string, any>, keys: string[]): string | undefined {
    for (const key of keys) {
      const value = source[key];
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return undefined;
  }

  private readAudienceString(value: unknown): string | undefined {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (Array.isArray(value)) {
      const first = value.find((item) => typeof item === 'string' && item.trim());
      if (typeof first === 'string') return first.trim();
    }
    return undefined;
  }

  private readStringValues(source: Record<string, any>, keys: string[]): string[] {
    const values: string[] = [];
    for (const key of keys) {
      const value = source[key];
      if (typeof value === 'string') {
        values.push(
          ...value.split(/\s+/).map((entry) => entry.trim()).filter(Boolean),
        );
        continue;
      }
      if (Array.isArray(value)) {
        values.push(
          ...value
            .filter((entry) => typeof entry === 'string')
            .map((entry) => String(entry).trim())
            .filter(Boolean),
        );
      }
    }
    return Array.from(new Set(values));
  }

  private readGrantedCapabilities(source: Record<string, any>): string[] {
    const rawValues = this.readStringValues(source, ['scope', 'scopes', 'capability', 'capabilities']);
    const expanded = new Set<string>();
    for (const value of rawValues) {
      expanded.add(value);
      const queryIndex = value.indexOf('?');
      if (queryIndex > 0) {
        expanded.add(value.slice(0, queryIndex));
      }
    }
    return Array.from(expanded);
  }

  private extractPinnedSubjectAndSections(scope: string): { subject: string; sections: string[]; study?: string } {
    const scopes = scope.split(/\s+/).map((s) => s.trim()).filter(Boolean);
    const forbiddenPatientScopes = scopes.filter((s) => {
      const normalized = s.toLowerCase();
      return normalized.startsWith('patient/composition.')
        || normalized.startsWith('patient/researchsubject.');
    });
    if (forbiddenPatientScopes.length > 0) {
      throw new ManagerError(
        'SMART token requests must use organization-scoped root capabilities. patient/* scopes are not accepted.',
        IssueType.NotSupported,
      );
    }

    const rootScopes = scopes.filter((s) => {
      const normalized = s.toLowerCase();
      return normalized.startsWith('organization/composition.')
        || normalized.startsWith('organization/researchsubject.');
    });
    if (rootScopes.length === 0) {
      throw new ManagerError('Missing required root scope: organization/Composition.<cruds>?subject=... or organization/ResearchSubject.<cruds>?subject=...', IssueType.Required);
    }

    const parsed = rootScopes.map((root) => {
      const [head, queryString] = root.split('?', 2);
      if (!queryString) {
        throw new ManagerError(`Invalid root scope (missing query): ${head}`, IssueType.Value);
      }
      const params = new URLSearchParams(queryString);
      const subject = params.get('subject')?.trim();
      const study = params.get('study')?.trim();
      const resourceType = head.replace(/^organization\//i, '').split('.', 1)[0];
      if (study) {
        if (resourceType !== 'ResearchSubject' || subject || rootScopes.length !== 1 || scopes.length !== 1) {
          throw new ManagerError('ResearchStudy SMART accepts only one ResearchSubject scope pinned by study.', IssueType.Forbidden);
        }
        const allowed = new Set([
          buildResearchStudyAccessScope(study),
          buildResearchStudyControllerImportScope(study),
        ]);
        if (!allowed.has(root)) {
          const reason = /ResearchSubject\.[a-z]*d[a-z]*\?/i.test(root)
            ? 'ResearchStudy SMART scope must not include delete.'
            : 'ResearchStudy SMART scope must grant the exact professional operations or controller create operation.';
          throw new ManagerError(reason, IssueType.Forbidden);
        }
        return { subject: study, sections: [] as string[], study };
      }
      if (!subject) {
        throw new ManagerError(`Invalid root scope (missing subject or study): ${head}`, IssueType.Required);
      }
      const sectionParam = params.get('section')?.trim() || '';
      const sections = sectionParam.includes('*')
        ? []
        : sectionParam
            .split(',')
            .map((s) => normalizeCodeSystemAndValue(s.trim()))
            .filter(Boolean);
      return { subject, sections, study: undefined };
    });

    const subject = parsed[0].subject;
    if (!parsed.every((p) => p.subject === subject)) {
      throw new ManagerError('Token request must be single-subject: all root scopes must have the same subject.', IssueType.Forbidden);
    }

    const mergedSections = Array.from(new Set(parsed.flatMap((p) => p.sections)));
    return { subject, sections: mergedSections, study: parsed[0].study };
  }

  private parseRequestedScopePermissions(scope: string): ParsedPermission[] {
    const requested: ParsedPermission[] = [];
    for (const token of scope.split(/\s+/).map((value) => value.trim()).filter(Boolean)) {
      if (!token.toLowerCase().startsWith('organization/') && !token.toLowerCase().startsWith('patient/')) continue;
      const parsed = this.parsePermissionExpression(token, { allowLegacySectionList: false });
      const subject = parsed.filters.subject;
      if (subject) delete parsed.filters.subject;
      requested.push(parsed);
    }
    return requested;
  }

  /**
   * Resolves one study permission through the same clinical-creator binding
   * that DCR enriched with the registered client and operational actor DID.
   * The active claims-only Consent is encrypted in the tenant collection;
   * neither Group membership nor ResearchStudy party description grants it.
   */
  private async authorizeResearchStudyAccess(input: {
    tenantVaultId: string;
    actorDid: string;
    scope: string;
    studyReference: string;
    registeredDeviceProfile?: Record<string, any>;
  }): Promise<ResearchStudyConsentRecord> {
    const clientId = String(input.registeredDeviceProfile?.clientId || '').trim();
    if (!clientId) {
      throw new ManagerError('ResearchStudy SMART requires a DCR-registered client assertion.', IssueType.Forbidden);
    }
    const bindings = await this.vaultRepository.listContainersInSection<any>(
      input.tenantVaultId,
      getClinicalCreatorBindingsSectionId(),
    );
    const binding = (bindings || []).find((candidate: any): candidate is ClinicalCreatorBinding => (
      candidate?.kind === 'professional'
      && Array.isArray(candidate.dcrClientIds)
      && candidate.dcrClientIds.includes(clientId)
      && Array.isArray(candidate.actorDids)
      && candidate.actorDids.includes(input.actorDid)
      && Boolean(canonicalPractitionerRoleFromAuthor(String(candidate.authorIdentifier || '')))
    ));
    if (!binding) {
      throw new ManagerError('ResearchStudy SMART client is not DCR-bound to the requesting PractitionerRole.', IssueType.Forbidden);
    }
    const practitionerRoleReference = canonicalPractitionerRoleFromAuthor(binding.authorIdentifier);
    const collectionName = String(
      await this.tenantsCacheManager.getCollectionName?.(input.tenantVaultId) || '',
    ).trim();
    if (!collectionName) {
      throw new ManagerError('ResearchStudy SMART tenant storage is unavailable.', IssueType.NotFound);
    }
    const professionalIdentity = parseProfessionalDidIdentity(input.actorDid);
    if (!professionalIdentity
      || normalizeCodeSystemAndValue(professionalIdentity.role) !== normalizeCodeSystemAndValue(binding.role)
      || !(await hasActiveProfessionalIdentityAndLicense({
        tenantVaultId: input.tenantVaultId,
        employeeCollectionName: collectionName,
        identity: professionalIdentity,
        vaultRepository: this.vaultRepository,
        kmsService: this.kmsService,
      }))) {
      throw new ManagerError('ResearchStudy SMART requires the current Employee role and active applicable licence.', IssueType.Forbidden);
    }
    const documents = await this.vaultRepository.listContainersInSection<any>(
      collectionName,
      RESEARCH_STUDY_CONSENT_SECTION,
    );
    for (const document of documents || []) {
      try {
        const content = await this.kmsService.unprotectConfidentialData<unknown>(
          document,
          input.tenantVaultId,
        );
        const claims = readClaimsOnlyContent(content);
        if (!claims) continue;
        if (storedClaim(claims, ClaimConsent.status) !== ConsentStatuses.Active) continue;
        if (storedClaim(claims, ClaimConsent.decision) !== ConsentDecisions.Permit) continue;
        if (storedClaim(claims, ClaimConsent.sourceReference) !== input.studyReference) continue;
        if (storedClaim(claims, ClaimConsent.actorIdentifier) !== practitionerRoleReference) continue;
        if (normalizeCodeSystemAndValue(storedClaim(claims, ClaimConsent.actorRole))
          !== normalizeCodeSystemAndValue(binding.role)) continue;
        if (storedClaim(claims, ClaimConsent.purpose) !== HealthcareConsentPurposes.Research) continue;
        const action = storedClaim(claims, ClaimConsent.action);
        if (action !== input.scope || action !== buildResearchStudyAccessScope(input.studyReference)) continue;
        return { claims };
      } catch {
        continue;
      }
    }
    throw new ManagerError('No active ResearchStudy Consent matches this DCR-bound PractitionerRole.', IssueType.Forbidden);
  }

  /**
   * Authorizes one controller-owned import without pretending that the
   * controller is a PractitionerRole. The verified ICA VP proves the
   * ServiceControllerCredential, the tenant DID lists the same actor as a
   * current controller, and the requested scope grants only creation of
   * ResearchSubjects correlated to one existing ResearchStudy. Canonical ICA
   * credentials bind the tenant through schema.org `provider.identifier.value`
   * and bind the person through the stable `urn:multibase` carried by the
   * controller DID; historical `provider.taxID` and full-DID `sameAs` remain
   * accepted without weakening either equality check.
   */
  private async authorizeControllerResearchStudyImport(input: {
    tenantVaultId: string;
    tenantId: string;
    actorDid: string;
    scope: string;
    studyReference: string;
    vpToken?: string;
    accessProofMode: AccessProofResult['mode'];
  }): Promise<ResearchStudyConsentRecord> {
    if (input.accessProofMode !== 'vp_token' || !input.vpToken) {
      throw new ManagerError('ResearchStudy controller import requires a verified controller VP.', IssueType.Forbidden);
    }
    if (input.scope !== buildResearchStudyControllerImportScope(input.studyReference)) {
      throw new ManagerError('ResearchStudy controller import requires exact ResearchSubject create scope.', IssueType.Forbidden);
    }
    const credential = getServiceControllerCredentialFromVpToken(input.vpToken);
    const subject = credential?.credentialSubject as Record<string, any> | undefined;
    const owner = subject?.owner as Record<string, any> | undefined;
    const provider = subject?.provider as Record<string, any> | undefined;
    const providerIdentifier = provider?.identifier as Record<string, any> | undefined;
    const tenantCandidates = [subject?.id, provider?.taxID, providerIdentifier?.value]
      .map((value) => String(value || '').trim().toUpperCase())
      .filter(Boolean);
    const controllerIdentity = parseProfessionalDidIdentity(input.actorDid);
    const controllerReferences = new Set([
      input.actorDid,
      controllerIdentity?.stableActorIdentifier,
    ].map((value) => String(value || '').trim()).filter(Boolean));
    if (!credential
      || String(owner?.additionalType || '').trim() !== 'RESPRSN'
      || !controllerReferences.has(String(owner?.sameAs || '').trim())
      || !tenantCandidates.includes(String(input.tenantId).trim().toUpperCase())) {
      throw new ManagerError('ResearchStudy controller VP does not bind the current tenant controller.', IssueType.Forbidden);
    }
    const collectionName = String(
      await this.tenantsCacheManager.getCollectionName?.(input.tenantVaultId) || '',
    ).trim();
    const studyId = input.studyReference.slice('ResearchStudy/'.length);
    const document = collectionName
      ? await this.vaultRepository.get<any>(collectionName, studyId, RESEARCH_STUDY_SECTION)
      : undefined;
    const claims = document
      ? readClaimsOnlyContent(await this.kmsService.unprotectConfidentialData<unknown>(document, input.tenantVaultId))
      : undefined;
    if (!claims) {
      throw new ManagerError(`ResearchStudy not found or not claims-first: ${studyId}.`, IssueType.NotFound);
    }
    return { claims };
  }

  private normalizeAcrValues(acrValues?: string | string[]): string[] {
    if (!acrValues) return [];
    if (Array.isArray(acrValues)) {
      return acrValues.map((value) => value.trim()).filter(Boolean);
    }
    return acrValues
      .split(/\s+/)
      .map((value) => value.trim())
      .filter(Boolean);
  }

  private extractRequestedResourceTypes(scope: string): string[] {
    const resourceTypes = new Set<string>();
    for (const token of scope.split(/\s+/).map((value) => value.trim()).filter(Boolean)) {
      const [head] = token.split('?', 1);
      const target = head.split('/')[1] || '';
      const resourceType = target.split('.')[0]?.trim();
      if (resourceType) resourceTypes.add(resourceType);
    }
    return Array.from(resourceTypes);
  }

  private extractRequestedCapabilities(scope: string): string[] {
    return Array.from(new Set(
      scope
        .split(/\s+/)
        .map((value) => value.trim())
        .filter(Boolean)
        .map((value) => value.split('?', 1)[0]?.trim())
        .filter((value): value is string => Boolean(value))
        .filter((value) => value.toLowerCase().startsWith('organization/')),
    ));
  }

  private evaluateRequestedConsent(input: {
    rules: any[];
    subject: string;
    actor: ReturnType<typeof parseActorFromSub>;
    purpose?: string;
    requestedPermissions: ParsedPermission[];
    jurisdiction: string;
    actorSubjectAliases?: ReadonlySet<string>;
  }): {
    allowed: boolean;
    missingSections: string[];
    missingResourceTypes: string[];
    applicableRules: any[];
  } {
    const missingSections: string[] = [];
    const missingResourceTypes: string[] = [];
    const applicableRules: any[] = [];
    const normalizedActorRole = input.actor.role?.trim()
      ? normalizeConsentActorRole(input.actor.role.trim(), input.actor.sub.includes(':family:') ? 'family' : 'professional')
      : undefined;
    const normalizedJurisdiction = String(input.jurisdiction || '').trim().toUpperCase();
    const actorEmail = input.actor.identifier && input.actor.identifier.includes('@')
      ? input.actor.identifier.toLowerCase()
      : undefined;

    const requestedPermissions = input.requestedPermissions.length > 0
      ? input.requestedPermissions
      : [this.parsePermissionExpression('organization/Composition.rs?section=*', { allowLegacySectionList: false })];

    for (const requestedPermission of requestedPermissions) {
      const candidates = (input.rules || [])
        .filter((rule) => {
          const ruleSubject = String(getClaimValue<string>(rule, ClaimConsent.subject) || '').trim();
          return input.subject === '*' ? Boolean(ruleSubject && ruleSubject !== '*') : ruleSubject === input.subject;
        })
        .filter((rule) => this.isRuleTimeActive(rule))
        .filter((rule) => this.matchesRulePurpose(rule, input.purpose))
        .filter((rule) => this.matchesRuleRole(rule, normalizedActorRole, actorEmail))
        .filter((rule) => this.matchesRulePermission(rule, requestedPermission))
        .map((rule) => {
          const match = this.resolveRuleMatchKind(
            rule,
            input.actor,
            actorEmail,
            normalizedJurisdiction,
            input.actorSubjectAliases,
          );
          if (!match) return undefined;
          return {
            rule,
            precedence: this.resolvePrecedence(rule, match),
          };
        })
        .filter((value): value is { rule: any; precedence: number } => Boolean(value))
        .sort((a, b) => a.precedence - b.precedence);

      const winner = candidates[0];
      if (!winner || String(getClaimValue<string>(winner.rule, 'Consent.decision') || '').trim() !== 'permit') {
        const requestedSections = requestedPermission.filters.section || [];
        if (requestedPermission.resourceType === 'Composition' && requestedSections.length > 0 && !requestedSections.includes('*')) {
          missingSections.push(...requestedSections);
        } else {
          missingResourceTypes.push(requestedPermission.resourceType);
        }
      } else {
        applicableRules.push(winner.rule);
      }
    }

    return {
      allowed: missingSections.length === 0 && missingResourceTypes.length === 0,
      missingSections: Array.from(new Set(missingSections)),
      missingResourceTypes: Array.from(new Set(missingResourceTypes)),
      applicableRules,
    };
  }

  private async getSubjectSpecificResearchRules(tenantVaultId: string): Promise<any[]> {
    const sectionPrefix = `${getEnvSectionId(`${SUBJECT_SECTION_INDIVIDUAL}_rules`)}_`;
    const sectionIds = (await this.vaultRepository.getAllSections(tenantVaultId))
      .filter((sectionId) => String(sectionId || '').startsWith(sectionPrefix));
    const rulesBySection = await Promise.all(sectionIds.map((sectionId) =>
      this.vaultRepository.getContainersInSection<any>(tenantVaultId, sectionId)));
    return rulesBySection.flat();
  }

  private resolveEarliestPeriodEnd(rules: any[]): number | undefined {
    const periodEnds = rules
      .map((rule) => String(getClaimValue<string>(rule, 'Consent.period-end') || '').trim())
      .filter(Boolean)
      .map((value) => Date.parse(value))
      .filter((value) => !Number.isNaN(value));
    return periodEnds.length > 0 ? Math.min(...periodEnds) : undefined;
  }

  private isRuleTimeActive(rule: any): boolean {
    if (String(getClaimValue<string>(rule, ClaimConsent.status) || '').trim() !== ConsentStatuses.Active) {
      return false;
    }
    const now = Date.now();
    const start = String(getClaimValue<string>(rule, 'Consent.period-start') || '').trim();
    const end = String(getClaimValue<string>(rule, 'Consent.period-end') || '').trim();
    if (start && (Number.isNaN(Date.parse(start)) || Date.parse(start) > now)) return false;
    if (end && (Number.isNaN(Date.parse(end)) || Date.parse(end) <= now)) return false;
    return true;
  }

  private matchesRulePurpose(rule: any, purpose?: string): boolean {
    const rulePurpose = String(getClaimValue<string>(rule, 'Consent.purpose') || '').trim();
    if (!purpose || !rulePurpose) return true;
    return rulePurpose === purpose;
  }

  private matchesRuleRole(rule: any, normalizedActorRole?: string, actorEmail?: string): boolean {
    const ruleRole = String(getClaimValue<string>(rule, 'Consent.actor-role') || '').trim();
    if (!ruleRole) return !normalizedActorRole || !!actorEmail;
    const normalizedRuleRoles = expandConsentActorRoles(ruleRole, normalizedActorRole?.startsWith('v3-rolecode|') ? 'family' : 'professional');
    if (normalizedRuleRoles.includes('*')) return Boolean(normalizedActorRole || actorEmail);
    if (!normalizedActorRole) return false;
    return normalizedRuleRoles.includes(normalizedActorRole);
  }

  private matchesRulePermission(rule: any, requestedPermission: ParsedPermission): boolean {
    const rawAction = String(getClaimValue<string>(rule, 'Consent.action') || '').trim();
    const parsedRulePermissions = this.parseStoredRulePermissions(rawAction);
    if (parsedRulePermissions.length === 0) {
      return requestedPermission.resourceType === 'Composition'
        && (!requestedPermission.filters.section || requestedPermission.filters.section.includes('*'));
    }

    return parsedRulePermissions.some((rulePermission) => this.rulePermissionCoversRequest(rulePermission, requestedPermission));
  }

  private parseStoredRulePermissions(rawAction: string): ParsedPermission[] {
    const value = rawAction.trim();
    if (!value) return [];

    const tokens = this.isCanonicalPermissionExpression(value)
      ? value.split(/\s+/).map((part) => part.trim()).filter(Boolean)
      : [value];

    return tokens.map((token) => this.parsePermissionExpression(token, { allowLegacySectionList: true }));
  }

  private isCanonicalPermissionExpression(value: string): boolean {
    return /^(?:organization\/|patient\/)?[A-Za-z][A-Za-z0-9]*(?:\.[A-Za-z]+)(?:\?|$)/.test(value);
  }

  private parsePermissionExpression(
    value: string,
    options: Readonly<{ allowLegacySectionList: boolean }>,
  ): ParsedPermission {
    const raw = String(value || '').trim();
    if (!raw) {
      return {
        raw,
        capability: 'Composition.rs',
        resourceType: ResourceTypesFhirR4.Composition,
        operations: ['r', 's'],
        filters: {},
      };
    }

    if (options.allowLegacySectionList && !this.isCanonicalPermissionExpression(raw)) {
      const sections = raw
        .split(',')
        .map((item) => normalizeCodeSystemAndValue(item.trim()))
        .filter(Boolean);
      return {
        raw,
        capability: 'Composition.rs',
        resourceType: ResourceTypesFhirR4.Composition,
        operations: ['r', 's'],
        filters: sections.length > 0 ? { section: sections } : {},
      };
    }

    const withoutPrefix = raw.replace(/^(organization|patient)\//i, '');
    const [head, queryString = ''] = withoutPrefix.split('?', 2);
    const capability = head.trim();
    const resourceType = capability.split('.', 1)[0]?.trim() || capability;
    const operationToken = capability.includes('.') ? capability.split('.').at(-1) || '' : '';
    const operations = /^[cruds]+$/i.test(operationToken)
      ? Array.from(new Set(operationToken.toLowerCase().split('')))
      : [];
    const params = new URLSearchParams(queryString);
    const filters: Record<string, string[]> = {};
    for (const [key, rawValue] of params.entries()) {
      const values = String(rawValue || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
        .map((item) => key === 'section' ? normalizeCodeSystemAndValue(item) : item);
      if (values.length > 0) filters[key] = values;
    }

    return {
      raw,
      capability,
      resourceType,
      operations,
      filters,
    };
  }

  private rulePermissionCoversRequest(rulePermission: ParsedPermission, requestedPermission: ParsedPermission): boolean {
    if (rulePermission.resourceType !== requestedPermission.resourceType) return false;
    if (rulePermission.operations.length === 0 || requestedPermission.operations.length === 0) return false;
    if (!requestedPermission.operations.every((operation) => rulePermission.operations.includes(operation))) return false;

    const requestedFilterKeys = Object.keys(requestedPermission.filters);
    for (const key of requestedFilterKeys) {
      const requestedValues = requestedPermission.filters[key] || [];
      if (requestedValues.length === 0) continue;
      if (requestedValues.includes('*')) continue;

      const normalizedRequestedValues = requestedValues.map((value) => key === 'section' ? normalizeCodeSystemAndValue(value) : value);
      const ruleValues = (rulePermission.filters[key] || []).map((value) => key === 'section' ? normalizeCodeSystemAndValue(value) : value);
      if (ruleValues.length === 0) return false;
      if (ruleValues.includes('*')) continue;
      if (!normalizedRequestedValues.every((value) => ruleValues.includes(value))) return false;
    }

    return true;
  }

  private resolveRuleMatchKind(
    rule: any,
    actor: ReturnType<typeof parseActorFromSub>,
    actorEmail: string | undefined,
    jurisdiction: string,
    actorSubjectAliases?: ReadonlySet<string>,
  ): 'direct' | 'organization' | 'jurisdiction' | undefined {
    const ruleActor = String(getClaimValue<string>(rule, 'Consent.actor-identifier') || '').trim();
    if (!ruleActor) return undefined;

    if (actorEmail && ruleActor.toLowerCase() === actorEmail) return 'direct';
    if (ruleActor === actor.sub) return 'direct';
    if (actorSubjectAliases?.has(ruleActor)) return 'direct';

    if (ruleActor.startsWith('did:web:')) {
      if (actor.organization && (ruleActor === actor.organization || ruleActor.startsWith(`${actor.organization}:`))) {
        return ruleActor === actor.sub ? 'direct' : 'organization';
      }
      if (ruleActor === actor.sub) return 'direct';
    }

    const normalizedRuleJurisdiction = this.normalizeJurisdictionRuleActor(ruleActor);
    if (normalizedRuleJurisdiction && jurisdictionGrantCovers(normalizedRuleJurisdiction, jurisdiction)) {
      return 'jurisdiction';
    }

    return undefined;
  }

  private normalizeJurisdictionRuleActor(ruleActor: string): string | undefined {
    const direct = String(ruleActor || '').trim().toUpperCase();
    if (/^[A-Z]{2}$/.test(direct) && isIso3166CountryCode(direct)) return direct;
    if (/^[A-Z]{2}-[A-Z0-9]{1,3}$/.test(direct)
      && isIso3166SubdivisionForCountry(direct, direct.slice(0, 2))) return direct;
    const isoStd = direct.match(/^URN:ISO:STD:ISO:3166\|([A-Z]{2})$/);
    if (isoStd && isIso3166CountryCode(isoStd[1])) return isoStd[1];
    const country = direct.match(/^URN:ISO:3166:([A-Z]{2})$/);
    if (country && isIso3166CountryCode(country[1])) return country[1];
    const subdivision = direct.match(/^URN:ISO:3166-2:([A-Z]{2}-[A-Z0-9]{1,3})$/);
    if (subdivision && isIso3166SubdivisionForCountry(subdivision[1], subdivision[1].slice(0, 2))) {
      return subdivision[1];
    }
    return undefined;
  }

  private resolvePrecedence(rule: any, matchKind: 'direct' | 'organization' | 'jurisdiction'): number {
    const decision = String(getClaimValue<string>(rule, 'Consent.decision') || '').trim();
    if (matchKind === 'direct') return decision === 'deny' ? 10 : 11;
    if (matchKind === 'organization') return decision === 'deny' ? 20 : 21;
    return decision === 'deny' ? 30 : 31;
  }
}

function storedClaim(claims: FlatClaims, name: string): string | undefined {
  const values = claims[name];
  return values?.length === 1 ? values[0] : undefined;
}
