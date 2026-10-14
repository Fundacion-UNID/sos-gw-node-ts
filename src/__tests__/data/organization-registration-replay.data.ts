import type { PublicJwk } from 'gdc-common-utils-ts/interfaces/Cryptography.types';
import { ClaimsOrganizationSchemaorg, ClaimsServiceSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { DataspaceSectors } from 'gdc-common-utils-ts/constants/sectors';
import type { Sector } from 'gdc-common-utils-ts/models/urlPath';
import { testClaimsRegisterTenantExpanded } from './organization.data';

export const testRegistrationControllerDid = 'did:web:controller.example.test:organization:representative';

export const testRegistrationSignerJwk = {
  kid: 'registration-signing-key',
  kty: 'AKP',
  alg: 'ML-DSA-44',
  pub: 'registration-signing-public-material',
  use: 'sig',
} as PublicJwk;

export const testRegistrationEncrypterJwk = {
  kid: 'registration-encryption-key',
  kty: 'OKP',
  crv: 'ML-KEM-768',
  x: 'registration-encryption-public-material',
  use: 'enc',
} as PublicJwk;

export const testAnimalResearchSector = DataspaceSectors.AnimalResearch as Sector;

export const testAnimalResearchRegistrationClaims = {
  ...testClaimsRegisterTenantExpanded,
  [ClaimsOrganizationSchemaorg.addressCountry]: 'CA',
  [ClaimsOrganizationSchemaorg.addressRegion]: 'CA-BC',
  [ClaimsOrganizationSchemaorg.identifierType]: 'BN',
  [ClaimsOrganizationSchemaorg.identifierValue]: '7654321',
  [ClaimsOrganizationSchemaorg.alternateName]: '7654321',
  [ClaimsOrganizationSchemaorg.legalName]: 'Animal Research Organization',
  [ClaimsServiceSchemaorg.category]: testAnimalResearchSector,
};
