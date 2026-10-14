/**
 * High-level VetChain operating boundary.
 *
 * ConnectHealth's Canadian Business Number identifies its own hosted tenant;
 * it does not make ConnectHealth the authority that admits veterinary
 * organizations. Antifraud Foundation governs admission through its separate
 * tenant and controller evidence. Product portals and the hosted GW also keep
 * distinct public roles even when they share the VetChain brand.
 * Veterinary software products may integrate and distribute the authorized
 * international Animal Index for SOSChain emergencies and clinical-care
 * continuity; integration never makes the vendor the admission authority.
 * Partners first receive bounded Test Network integration access. Production
 * participation requires a later Antifraud Foundation admission decision;
 * ConnectHealth remains the technology partner operating the host.
 */
export const VETCHAIN_PRODUCT_BOUNDARY = Object.freeze({
  hostTenantId: '704457076',
  hostOperatorEmail: 'cto@connecthealth.info',
  governanceTechnicalControllerEmail: 'cto@antifraud.online',
  personalPortalDomain: 'petchain.app',
  professionalPortalDomain: 'vetchain.app',
  stagingGwDomain: 'beta-gw.vetchain.app',
  productionGwDomain: 'host-vet.connecthealth.info',
  hostResearchSector: 'onehealth-research',
  professionalSector: 'animal-care',
  maximumDevicesPerProfessional: 5,
  integrationUseCases: ['soschain-emergency', 'clinical-care-continuity'],
  veterinarySoftwareIntegrationEnabled: true,
  integratorOwnsAdmissionAuthority: false,
  technologyPartner: 'ConnectHealth',
  dataSpaceGovernor: 'Antifraud Foundation',
  integrationPartnerLifecycle: ['test-network-integration', 'production-admission'],
  testNetworkGrantsProductionAdmission: false,
} as const);

export interface VetChainProfessionalLicenseTerms {
  readonly currency: 'USD';
  readonly unitPrice: string;
  readonly minimumQuantity: 2;
  readonly promotionEndsAt: string;
}

/**
 * Resolves the public VetChain professional-licence terms.
 *
 * The price applies only to `animal-care` professional seats. It never grants
 * ConnectHealth's `onehealth-research` sector; research access requires a
 * separate sector decision and subject-specific Digital Twin Consent. Paid
 * offers fail closed until the eventual billing merchant is configured.
 */
export function resolveVetChainProfessionalLicenseTerms(
  at: Date = new Date(),
  billingMerchantId: string = String(process.env.VETCHAIN_BILLING_MERCHANT_ID || '').trim(),
): VetChainProfessionalLicenseTerms {
  const promotionEndsAt = '2026-12-31T23:59:59.999Z';
  const isLocalTestStage = String(process.env.DEPLOYMENT_ENV || '').trim().toLowerCase() === 'dev'
    && String(process.env.NETWORK_MODE || '').trim().toLowerCase() === 'test';
  if (isLocalTestStage) {
    const localTestUnitPrice = String(process.env.VETCHAIN_LOCAL_TEST_LICENSE_UNIT_PRICE || '').trim();
    if (localTestUnitPrice) {
      if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,6})?$/.test(localTestUnitPrice) || Number(localTestUnitPrice) <= 0) {
        throw new Error('VETCHAIN_LOCAL_TEST_LICENSE_UNIT_PRICE must be a positive USD amount with at most six decimals.');
      }
      return { currency: 'USD', unitPrice: localTestUnitPrice, minimumQuantity: 2, promotionEndsAt };
    }
  }
  if (at.getTime() <= Date.parse(promotionEndsAt)) {
    return { currency: 'USD', unitPrice: '0.00', minimumQuantity: 2, promotionEndsAt };
  }
  if (!billingMerchantId) {
    throw new Error('VetChain paid licensing requires VETCHAIN_BILLING_MERCHANT_ID.');
  }
  return { currency: 'USD', unitPrice: '20.00', minimumQuantity: 2, promotionEndsAt };
}
