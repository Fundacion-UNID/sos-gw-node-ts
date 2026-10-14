/**
 * Flow contract:
 * 1. ConnectHealth's BN identifies its own hosted tenant and research sector.
 * 2. Antifraud admission uses a separate technical controller and tenant.
 * 3. Paying for animal-care never grants onehealth-research or Digital Twin access.
 * 4. Veterinary software vendors may distribute the same authorized index for emergency and care continuity.
 * 5. Test Network integration never becomes production admission automatically.
 */
import {
  VETCHAIN_PRODUCT_BOUNDARY,
  resolveVetChainProfessionalLicenseTerms,
} from '../../../config/vetchain-product-boundary';

describe('VetChain product, operator and governance boundary', () => {
  it('keeps host operation, admission and sector purposes separate', () => {
    expect(VETCHAIN_PRODUCT_BOUNDARY).toMatchObject({
      hostTenantId: '704457076',
      hostOperatorEmail: 'cto@connecthealth.info',
      governanceTechnicalControllerEmail: 'cto@antifraud.online',
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
    });
    expect(VETCHAIN_PRODUCT_BOUNDARY.hostResearchSector)
      .not.toBe(VETCHAIN_PRODUCT_BOUNDARY.professionalSector);
  });

  it('keeps the launch price deterministic without assigning a billing merchant', () => {
    expect(resolveVetChainProfessionalLicenseTerms(new Date('2026-12-31T23:59:59.999Z')))
      .toMatchObject({ currency: 'USD', unitPrice: '0.00', minimumQuantity: 2 });
  });
});
