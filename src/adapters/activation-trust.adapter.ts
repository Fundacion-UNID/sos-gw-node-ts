import { IssueType } from 'gdc-common-utils-ts/models/issue';
import { ManagerError } from 'gdc-common-utils-ts/utils/manager-error';
import {
  extractDidWebFromCredential,
  extractRepresentativeSubjectId,
  validateActivationRepresentativePolicy,
} from 'gdc-common-utils-ts/utils/activation-policy';
import { ClearingHouseVerificationResult, IClearingHouseService } from '../services/ClearingHouseService';
import { compactVerify, decodeProtectedHeader, importJWK, JWK } from 'jose';
import {
  DefaultTrustRegistryAdapter,
  ITrustRegistryAdapter,
} from './trust-registry.adapter';

export type ActivationNetworkMode = 'test' | 'local-network' | 'test-network' | 'network';

export type ActivationTrustEvaluationInput = {
  networkMode: ActivationNetworkMode;
  vpToken: string;
  presentationSubmission?: any;
  organizationCredential?: any;
  representativeCredential?: any;
  controllerCredential?: any;
  primaryDid?: string;
  jurisdiction?: string;
  sector?: string;
  /** Tenant/sector-scoped historical first-controller compatibility only. */
  allowLegacyRepresentativeBootstrap?: boolean;
};

export type ActivationTrustEvaluationResult = {
  organizationDid: string;
  representativeDid?: string;
  clearingHouse: ClearingHouseVerificationResult;
  trustPolicy: {
    networkMode: ActivationNetworkMode;
    revocationChecked: boolean;
    issuerKeyStatusChecked: boolean;
    subjectKeyStatusChecked: boolean;
    onChainChecked: boolean;
  };
};

export interface IActivationTrustAdapter {
  evaluate(input: ActivationTrustEvaluationInput): Promise<ActivationTrustEvaluationResult>;
}

function isDemoSecurityMode(): boolean {
  const securityMode = String(process.env.SECURITY_MODE || '').trim().toLowerCase();
  const nodeEnv = String(process.env.NODE_ENV || '').trim().toLowerCase();
  return securityMode === 'demo' || nodeEnv === 'demo';
}

async function verifyVpTokenProof(vpToken: string): Promise<void> {
  const compact = String(vpToken || '').trim();
  const parts = compact.split('.');
  if (parts.length !== 3) {
    throw new ManagerError('vp_token must be a compact JWT (JWS).', IssueType.Security);
  }
  const header = decodeProtectedHeader(compact);
  const alg = String(header.alg || '').trim();
  if (!alg || alg.toLowerCase() === 'none') {
    throw new ManagerError('vp_token must be signed with a supported algorithm.', IssueType.Security);
  }
  const allowed = new Set(['ES256K', 'ES384', 'ML-DSA-44', 'ML-DSA-65', 'ML-DSA-87']);
  if (!allowed.has(alg)) {
    throw new ManagerError(`Unsupported vp_token algorithm '${alg}'.`, IssueType.Security);
  }

  // For classical JOSE algorithms, verify immediately when JWK is embedded.
  if ((alg === 'ES256K' || alg === 'ES384') && header.jwk && typeof header.jwk === 'object') {
    const keyLike = await importJWK(header.jwk as JWK, alg);
    await compactVerify(compact, keyLike);
  }
}

function assertActivationCredentialConsistency(params: {
  primaryDid?: string;
  organizationCredential?: any;
  representativeCredential?: any;
  controllerCredential?: any;
  allowLegacyRepresentativeBootstrap?: boolean;
}): { organizationDid: string; representativeDid?: string } {
  /**
   * Representative proof is intentionally split into two dimensions:
   * - `credentialSubject.sameAs` for public identity continuity
   * - `credentialSubject.hasCredential.material` for controller signing-key continuity
   *
   * GW activation enforces the key-binding dimension through shared activation
   * policy validation. The public-identity dimension remains complementary and
   * is expected to be present in production-grade ICA-issued credentials, but
   * demo/local flows may still need higher-level fallbacks when signed PDF
   * evidence did not carry `person.email`.
   */
  const {
    primaryDid,
    organizationCredential,
    representativeCredential,
    controllerCredential,
    allowLegacyRepresentativeBootstrap,
  } = params;
  if (!organizationCredential) {
    throw new ManagerError('Missing ICA-issued organization credential.', IssueType.Required);
  }

  const organizationDidFromCredential = extractDidWebFromCredential(organizationCredential);
  if (!organizationDidFromCredential) {
    throw new ManagerError('ICA-issued organization credential is missing credentialSubject.id did:web.', IssueType.Required);
  }
  if (primaryDid && organizationDidFromCredential !== primaryDid) {
    throw new ManagerError('Submitted organization DID does not match ICA-issued organization credential DID.', IssueType.Conflict);
  }

  const representativeSubjectId = representativeCredential
    ? extractRepresentativeSubjectId(representativeCredential)
    : undefined;
  const policyErrors = validateActivationRepresentativePolicy({
    organizationCredential,
    representativeCredential,
    controllerCredential,
  }).filter(error => !allowLegacyRepresentativeBootstrap || ![
    'MISSING_REPRESENTATIVE_ROLE_RESPRSN',
    'MISSING_REPRESENTATIVE_CREDENTIAL_BINDING',
  ].includes(error.code));
  if (policyErrors.length > 0) {
    const first = policyErrors[0];
    const issue = first.code === 'REPRESENTATIVE_TAXID_MISMATCH' || first.code === 'CONTROLLER_TAXID_MISMATCH'
      ? IssueType.Conflict
      : IssueType.Required;
    throw new ManagerError(first.message, issue);
  }

  return {
    organizationDid: organizationDidFromCredential,
    representativeDid: representativeSubjectId?.startsWith('did:web:')
      ? representativeSubjectId
      : undefined,
  };
}

export class DefaultActivationTrustAdapter implements IActivationTrustAdapter {
  private readonly clearingHouseService: IClearingHouseService;
  private readonly trustRegistryAdapter: ITrustRegistryAdapter;

  constructor(
    clearingHouseService: IClearingHouseService,
    trustRegistryAdapter: ITrustRegistryAdapter = new DefaultTrustRegistryAdapter(),
  ) {
    this.clearingHouseService = clearingHouseService;
    this.trustRegistryAdapter = trustRegistryAdapter;
  }

  async evaluate(input: ActivationTrustEvaluationInput): Promise<ActivationTrustEvaluationResult> {
    if (!isDemoSecurityMode()) {
      await verifyVpTokenProof(input.vpToken);
    }

    const consistency = assertActivationCredentialConsistency({
      primaryDid: input.primaryDid,
      organizationCredential: input.organizationCredential,
      representativeCredential: input.representativeCredential,
      controllerCredential: input.controllerCredential,
      allowLegacyRepresentativeBootstrap: input.allowLegacyRepresentativeBootstrap,
    });

    const clearingHouse = await this.clearingHouseService.verifyVpToken({
      vpToken: input.vpToken,
      presentationSubmission: input.presentationSubmission,
      acrValues: [
        'urn:antifraud:acr:openid4vp:employee',
        'urn:antifraud:acr:openid4vp:individual',
      ],
    });

    const trustPolicy = await this.trustRegistryAdapter.verifyActivationTrust({
      networkMode: input.networkMode,
      jurisdiction: input.jurisdiction,
      sector: input.sector,
      organizationDid: consistency.organizationDid,
      representativeDid: consistency.representativeDid,
      organizationCredential: input.organizationCredential,
      representativeCredential: input.representativeCredential,
      controllerCredential: input.controllerCredential,
    });

    return {
      organizationDid: consistency.organizationDid,
      representativeDid: consistency.representativeDid,
      clearingHouse,
      trustPolicy: {
        networkMode: input.networkMode,
        ...trustPolicy,
      },
    };
  }
}
