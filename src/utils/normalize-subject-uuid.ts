// Normalizes a subject identifier to a canonical UUID (hexadecimal, lowercase, no dashes)
// Accepts: urn:uuid:<uuid>, <ResourceType>/<uuid>, <uuid> (with or without dashes), base58 (optional)
// Returns: canonical hex string (no dashes, lowercase) or undefined if not valid
export function normalizeSubjectUuid(input: string | undefined): string | undefined {
  if (!input) return undefined;
  let s = String(input).trim();
  // urn:uuid:<uuid>
  if (s.startsWith('urn:uuid:')) s = s.slice(9);
  // <ResourceType>/<uuid>
  const slashIdx = s.indexOf('/');
  if (slashIdx >= 0) s = s.slice(slashIdx + 1);
  // Remove dashes
  s = s.replace(/-/g, '');
  // Lowercase
  s = s.toLowerCase();
  // Validate: must be 32 hex chars
  if (/^[0-9a-f]{32}$/.test(s)) return s;
  // Optionally: add base58 or other formats here
  return undefined;
}
