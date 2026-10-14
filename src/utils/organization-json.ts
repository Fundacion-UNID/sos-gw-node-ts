import fs from 'fs';

import { AuthorityConfig } from './pki';

type OrganizationAddress = {
  '@type'?: string;
  addressCountry?: string;
  addressLocality?: string;
  streetAddress?: string;
  postalCode?: string;
};

type OrganizationJson = {
  '@context'?: string | string[];
  '@type'?: string | string[];
  legalName?: string;
  alternateName?: string | string[];
  name?: string;
  taxID?: string;
  url?: string;
  address?: OrganizationAddress;
  '@graph'?: OrganizationJson[];
};

export type OrganizationIdentity = {
  authority: AuthorityConfig;
  countryCode: string;
  taxId: string;
  legalName: string;
  alternateName?: string;
  transliteratedName: string;
  domain: string;
};

function pickFirst<T>(value?: T | T[]): T | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function requireField(value: string | undefined, field: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error(`Missing required field: ${field}`);
  }
  return trimmed;
}

function normalizeCountry(country: string): string {
  const normalized = country.trim().toUpperCase();
  if (normalized.length !== 2) {
    throw new Error(`address.addressCountry must be ISO-2 country code, got: ${country}`);
  }
  return normalized;
}

function resolveDomain(rawUrl: string): string {
  const url = rawUrl.includes('://') ? rawUrl : `https://${rawUrl}`;
  return new URL(url).host.toLowerCase();
}

export function buildLegalRegistrationNumber(countryCode: string, taxId: string): string {
  return `TAX${countryCode}-${taxId}`;
}

export function buildLeafCertificateName(prefix: string, countryCode: string, taxId: string): string {
  const safeTaxId = taxId
    .trim()
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `${prefix}${countryCode}_TAX_${safeTaxId}`;
}

export function loadOrganizationIdentity(filePath: string, seed?: string): OrganizationIdentity {
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8')) as OrganizationJson;
  const org = Array.isArray(raw['@graph']) ? raw['@graph'][0] : raw;

  const legalName = requireField(org.legalName, 'legalName');
  const transliteratedName = requireField(org.name, 'name');
  const alternateName = pickFirst(org.alternateName);
  const taxId = requireField(org.taxID, 'taxID');
  const address = org.address ?? {};
  const countryCode = normalizeCountry(requireField(address.addressCountry, 'address.addressCountry'));
  const city = (address.addressLocality || countryCode).trim();
  const domain = resolveDomain(requireField(org.url, 'url'));

  const authority: AuthorityConfig = {
    seed,
    legalRegistrationNumber: buildLegalRegistrationNumber(countryCode, taxId),
    domain,
    subjectCN: (alternateName || transliteratedName).trim(),
    officialName: legalName,
    countryCode,
    location: {
      city,
      street: address.streetAddress,
      postalCode: address.postalCode,
    },
  };

  return {
    authority,
    countryCode,
    taxId,
    legalName,
    alternateName,
    transliteratedName,
    domain,
  };
}
