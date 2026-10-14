export type ActivationNetworkMode = 'test' | 'local-network' | 'test-network' | 'network';

export type TrustRegistryVerificationInput = {
  networkMode: ActivationNetworkMode;
  jurisdiction?: string;
  sector?: string;
  organizationDid: string;
  representativeDid?: string;
  organizationCredential?: any;
  representativeCredential?: any;
  controllerCredential?: any;
  now?: Date;
};

export type TrustRegistryVerificationResult = {
  revocationChecked: boolean;
  issuerKeyStatusChecked: boolean;
  subjectKeyStatusChecked: boolean;
  onChainChecked: boolean;
};

export interface ITrustRegistryAdapter {
  verifyActivationTrust(input: TrustRegistryVerificationInput): Promise<TrustRegistryVerificationResult>;
}

/**
 * Default trust policy evaluator.
 *
 * This adapter is intentionally side-effect free and network-agnostic for now.
 * It exposes explicit policy outputs that can later be backed by:
 * - dataspace network trust registries (issuer/subject key status)
 * - blockchain smart contracts by network/jurisdiction/sector (on-chain checks)
 * - revocation infrastructure (OCSP/CRL/status list) for ICA/tenant credentials.
 */
export class DefaultTrustRegistryAdapter implements ITrustRegistryAdapter {
  async verifyActivationTrust(input: TrustRegistryVerificationInput): Promise<TrustRegistryVerificationResult> {
    const strictNetwork =
      input.networkMode === 'local-network'
      || input.networkMode === 'test-network'
      || input.networkMode === 'network';
    return {
      revocationChecked: strictNetwork,
      issuerKeyStatusChecked: strictNetwork,
      subjectKeyStatusChecked: strictNetwork,
      onChainChecked: input.networkMode === 'network',
    };
  }
}
