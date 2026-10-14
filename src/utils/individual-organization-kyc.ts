import { ClaimsOrganizationSchemaorg, ClaimsPersonSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';

export type IndividualOrganizationKycProfile = Readonly<{
  uuid?: string | null;
  user_uuid?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  nationality?: string | null;
  country?: string | null;
  ip_country?: string | null;
  city?: string | null;
  address?: string | null;
  id_number?: string | null;
  postal_code?: string | null;
  phone_number?: string | null;
  birthdate?: string | null;
  kyc_verified_at?: string | null;
  gender?: string | null;
  language?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  primary_wallet_address?: string | null;
  primary_wallet?: string | null;
}>;

export type IndividualOrganizationKycClaimsOptions = Readonly<{
  profile: IndividualOrganizationKycProfile;
  individualAlternateName: string;
  individualBirthDate?: string | null;
  controllerEmail?: string | null;
}>;

export type IndividualOrganizationKycClaimsResult = Readonly<{
  claims: Record<string, string>;
  resolved: Readonly<{
    organizationAlternateName: string;
    controllerGivenName?: string;
    controllerFamilyName?: string;
    controllerIdentifier?: string;
    controllerEmail?: string;
    controllerTelephone?: string;
    birthYear?: string;
  }>;
}>;

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeLowerText(value: unknown): string | undefined {
  const normalized = normalizeText(value).toLowerCase();
  return normalized || undefined;
}

function normalizeDisplayText(value: unknown): string | undefined {
  const normalized = normalizeText(value);
  return normalized || undefined;
}

function normalizeUpperText(value: unknown): string | undefined {
  const normalized = normalizeText(value).toUpperCase();
  return normalized || undefined;
}

function normalizeEmail(value: unknown): string | undefined {
  return normalizeLowerText(value);
}

function normalizeBirthYear(value: unknown): string | undefined {
  const raw = normalizeText(value);
  if (!raw) return undefined;
  const match = raw.match(/^(\d{4})/);
  return match?.[1];
}

export function normalizeKycGender(value: unknown): string | undefined {
  const raw = normalizeText(value);
  if (!raw) return undefined;
  const normalized = raw.toLowerCase();

  if (normalized === 'f' || normalized === 'female' || normalized === 'woman' || normalized === 'mujer') {
    return 'F';
  }
  if (normalized === 'm' || normalized === 'male' || normalized === 'man' || normalized === 'hombre') {
    return 'M';
  }

  return raw.toUpperCase();
}

export function buildClaimsFromIndividualOrganizationKyc(
  options: IndividualOrganizationKycClaimsOptions,
): IndividualOrganizationKycClaimsResult {
  const profile = options.profile || {};
  const organizationAlternateName = normalizeDisplayText(options.individualAlternateName);
  if (!organizationAlternateName) {
    throw new Error('KYC individual onboarding requires individualAlternateName.');
  }

  const givenName = normalizeUpperText(profile.first_name);
  const familyName = normalizeUpperText(profile.last_name);
  const controllerName = [givenName, familyName].filter(Boolean).join(' ').trim() || undefined;
  const controllerIdentifier = normalizeText(profile.id_number) || undefined;
  const controllerEmail = normalizeEmail(options.controllerEmail);
  const controllerTelephone = normalizeText(profile.phone_number) || undefined;
  const controllerBirthYear = normalizeBirthYear(profile.birthdate);
  const subjectBirthYear = normalizeBirthYear(options.individualBirthDate);
  const gender = normalizeKycGender(profile.gender);

  const claims: Record<string, string> = {
    '@context': 'org.schema',
    [ClaimsOrganizationSchemaorg.alternateName]: organizationAlternateName,
  };

  if (controllerIdentifier) {
    claims[ClaimsOrganizationSchemaorg.ownerIdentifierValue] = controllerIdentifier;
    claims[ClaimsPersonSchemaorg.identifierValue] = controllerIdentifier;
    claims[ClaimsPersonSchemaorg.identifier] = `urn:person:identifier:${controllerIdentifier}`;
  }
  claims[ClaimsOrganizationSchemaorg.ownerAlternateName] = organizationAlternateName;
  if (controllerEmail) {
    claims[ClaimsOrganizationSchemaorg.ownerEmail] = controllerEmail;
  }
  if (controllerTelephone) {
    claims[ClaimsOrganizationSchemaorg.ownerTelephone] = controllerTelephone;
  }
  if (givenName) claims[ClaimsPersonSchemaorg.givenName] = givenName;
  if (familyName) claims[ClaimsPersonSchemaorg.familyName] = familyName;
  if (controllerName) claims[ClaimsPersonSchemaorg.name] = controllerName;
  claims[ClaimsOrganizationSchemaorg.memberRole] = 'ONESELF';
  if (normalizeUpperText(profile.country)) claims[ClaimsOrganizationSchemaorg.addressCountry] = normalizeUpperText(profile.country) as string;
  if (normalizeText(profile.city)) claims[ClaimsOrganizationSchemaorg.addressLocality] = normalizeText(profile.city);
  if (normalizeText(profile.address)) claims[ClaimsOrganizationSchemaorg.streetAddress] = normalizeText(profile.address);
  if (normalizeText(profile.postal_code)) claims[ClaimsOrganizationSchemaorg.postalCode] = normalizeText(profile.postal_code);
  if (gender) claims[ClaimsPersonSchemaorg.gender] = gender;
  if (controllerBirthYear) claims[ClaimsPersonSchemaorg.birthDate] = controllerBirthYear;
  if (subjectBirthYear) claims[ClaimsOrganizationSchemaorg.memberBirthDate] = subjectBirthYear;

  return {
    claims,
    resolved: {
      organizationAlternateName,
      ...(givenName ? { controllerGivenName: givenName } : {}),
      ...(familyName ? { controllerFamilyName: familyName } : {}),
      ...(controllerIdentifier ? { controllerIdentifier } : {}),
      ...(controllerEmail ? { controllerEmail } : {}),
      ...(controllerTelephone ? { controllerTelephone } : {}),
      ...(controllerBirthYear ? { birthYear: controllerBirthYear } : {}),
    },
  };
}
