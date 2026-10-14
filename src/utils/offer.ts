// src/utils/offer.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { v4 as uuidv4 } from 'uuid';
import { ClaimsOfferSchemaorg, ClaimsOrganizationSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { LICENSE_USER_CLASS_EMPLOYEE, LICENSE_USER_CLASS_INDIVIDUAL } from '../constants/domain';
import {
  resolveVetChainProfessionalLicenseTerms,
  VETCHAIN_PRODUCT_BOUNDARY,
} from '../config/vetchain-product-boundary';

// Simple tier calculation for demonstration purposes.
// In a real scenario, this would come from a more complex pricing engine or configuration.
function determineLicenseTier(employeeCount: number): { name: string; price: string; } {
  if (employeeCount <= 5) {
    return { name: 'License Tier XS', price: '0.00' };
  }
  if (employeeCount <= 20) {
    return { name: 'License Tier S', price: '49.99' };
  }
  return { name: 'License Tier M', price: '99.99' };
}

/**
 * Generates the Schema.org Offer claims for a new organization based on its size.
 *
 * @param {number} employeeCount The value from the 'org.schema.Organization.numberOfEmployees.value' claim.
 * @param {string} hostDid The DID of the host issuing the offer.
 * @param {string} jurisdiction The legal jurisdiction of the host issuing the Offer.
 * @param {string} sector The sector for the offer URN.
 * @returns {Record<string, any>} A record of claims compliant with `ClaimsOfferSchemaorg`.
 */
export function generateLicenseOffer(
  employeeCount: number,
  hostDid: string,
  jurisdiction: string,
  sector: string,
  allowedPaymentMethods: string[],
  eligibleCustomerType: typeof LICENSE_USER_CLASS_EMPLOYEE | typeof LICENSE_USER_CLASS_INDIVIDUAL = LICENSE_USER_CLASS_EMPLOYEE,
  pricingDate: Date = new Date(),
): Record<string, any> {
  const normalizedHostDid = String(hostDid || '').trim();
  const normalizedJurisdiction = String(jurisdiction || '').trim().toUpperCase();
  const normalizedSector = String(sector || '').trim();
  if (!normalizedHostDid) throw new Error('generateLicenseOffer requires hostDid.');
  if (!normalizedJurisdiction) throw new Error('generateLicenseOffer requires jurisdiction.');
  if (!normalizedSector) throw new Error('generateLicenseOffer requires sector.');

  const professionalTerms = normalizedSector === VETCHAIN_PRODUCT_BOUNDARY.professionalSector && eligibleCustomerType === LICENSE_USER_CLASS_EMPLOYEE
    ? resolveVetChainProfessionalLicenseTerms(pricingDate)
    : undefined;
  const quantity = professionalTerms ? Math.max(employeeCount, professionalTerms.minimumQuantity) : employeeCount;
  const tier = professionalTerms
    ? { name: 'VetChain professional licence', price: professionalTerms.unitPrice }
    : determineLicenseTier(employeeCount);
  const offerId = uuidv4();

  // In a real implementation, serial numbers would be generated and reserved.
  const serialNumbers = Array.from({ length: quantity }, () => `lic-${uuidv4().substring(0, 8)}`).join(',');

  const offerClaims: Record<string, any> = {
    [ClaimsOfferSchemaorg.acceptedPaymentMethod]: allowedPaymentMethods.join(','),
    [ClaimsOfferSchemaorg.category]: normalizedSector,
    [ClaimsOfferSchemaorg.checkoutPageURLTemplate]: '<payment-url>', // Placeholder to be replaced by the order process
    [ClaimsOfferSchemaorg.eligibleCustomerType]: eligibleCustomerType,
    [ClaimsOfferSchemaorg.eligibleQuantityValue]: quantity,
    [ClaimsOfferSchemaorg.identifier]: `urn:cds:${normalizedJurisdiction}:v1:${normalizedSector}:product:org.schema:Offer:${offerId}`,
    [ClaimsOfferSchemaorg.itemOfferedName]: tier.name,
    [ClaimsOfferSchemaorg.itemOfferedSku]: 'web-or-app-identifier',
    [ClaimsOfferSchemaorg.offeredBy]: normalizedHostDid,
    [ClaimsOfferSchemaorg.price]: tier.price,
    [ClaimsOfferSchemaorg.priceCurrency]: professionalTerms?.currency || 'EUR',
    [ClaimsOfferSchemaorg.serialNumber]: serialNumbers,
  };

  return offerClaims;
}
