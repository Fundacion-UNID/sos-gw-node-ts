export type ProfessionalDidIdentity = Readonly<{
  organizationDid: string;
  organizationIdentifier: string;
  membershipMarker: 'employee' | 'member';
  stableActorIdentifier: string;
  role: string;
}>;

function decodeDidPart(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Extracts tenant membership from supported professional did:web forms.
 *
 * Internal hosted DIDs carry `<tenantId>:cds-<J>:v1:<sector>`; public provider
 * DIDs carry `<sector>:organization:(taxid|vatid):<identifier>`. The hostname
 * is never treated as organizational authority. Employment is checked later
 * against the extracted tenant using the stable email hash and role.
 */
export function parseProfessionalDidIdentity(did: string): ProfessionalDidIdentity | undefined {
  const normalized = String(did || '').trim();
  if (!normalized.startsWith('did:web:')) return undefined;
  const parts = normalized.slice('did:web:'.length).split(':');
  const membershipIndex = parts.findIndex((part) => {
    const marker = part.toLowerCase();
    return marker === 'employee' || marker === 'member';
  });
  if (membershipIndex < 2 || membershipIndex + 2 >= parts.length) return undefined;

  const membershipMarker = parts[membershipIndex].toLowerCase() as 'employee' | 'member';
  const stableDidValue = decodeDidPart(parts[membershipIndex + 1]);
  const role = decodeDidPart(parts[membershipIndex + 2]);
  if (!/^z[1-9A-HJ-NP-Za-km-z]+$/.test(stableDidValue) || !role) return undefined;

  const organizationParts = parts.slice(0, membershipIndex);
  const organizationMarkerIndex = organizationParts.findIndex((part) => part.toLowerCase() === 'organization');
  let organizationIdentifier: string | undefined;
  if (organizationMarkerIndex >= 0) {
    const identifierType = String(organizationParts[organizationMarkerIndex + 1] || '').toLowerCase();
    if (identifierType !== 'taxid' && identifierType !== 'vatid') return undefined;
    organizationIdentifier = decodeDidPart(String(organizationParts[organizationMarkerIndex + 2] || '')).trim();
  } else if (/^cds-/i.test(String(organizationParts[2] || ''))) {
    organizationIdentifier = decodeDidPart(String(organizationParts[1] || '')).trim();
  }
  if (!organizationIdentifier) return undefined;

  return {
    organizationDid: `did:web:${organizationParts.join(':')}`,
    organizationIdentifier,
    membershipMarker,
    stableActorIdentifier: `urn:multibase:${stableDidValue}`,
    role,
  };
}
