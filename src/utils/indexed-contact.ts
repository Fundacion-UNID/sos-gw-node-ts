import { normalizePhoneNumber } from './phone-number';

/**
 * Canonicalizes an email value for indexed storage and blind-search queries.
 *
 * Rules:
 * - trims surrounding whitespace
 * - removes any `mailto:` prefix
 * - removes stray whitespace inside the token
 * - lowercases the final value
 *
 * Indexed email attributes intentionally do not keep the `mailto:` prefix.
 * The URI form remains valid for public aliases such as `controller.sameAs`.
 */
export function normalizeIndexedEmail(value: unknown): string | undefined {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return undefined;
  const withoutPrefix = raw.replace(/^mailto:/i, '');
  const normalized = withoutPrefix.replace(/\s+/g, '').toLowerCase();
  return normalized || undefined;
}

/**
 * Canonicalizes a phone value for indexed storage and blind-search queries.
 *
 * Rules:
 * - trims surrounding whitespace
 * - accepts values with or without `tel:`
 * - removes formatting characters from the number
 * - stores the final value as `tel:<normalized-number>`
 *
 * When the source number already follows E.164, the stored value becomes
 * `tel:+<digits>`.
 */
export function normalizeIndexedPhone(value: unknown): string | undefined {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return undefined;
  const withoutPrefix = raw.replace(/^tel:/i, '');
  const normalizedNumber = normalizePhoneNumber(withoutPrefix);
  if (!normalizedNumber) return undefined;
  return `tel:${normalizedNumber}`;
}

/**
 * Splits a comma-separated list of emails and canonicalizes each token for
 * indexed storage and search. Empty results are removed.
 */
export function splitIndexedEmails(value: unknown): string[] {
  const raw = typeof value === 'string' ? value : '';
  return raw
    .split(',')
    .map((part) => normalizeIndexedEmail(part))
    .filter((part): part is string => Boolean(part));
}

/**
 * Splits a comma-separated list of phone values and canonicalizes each token
 * for indexed storage and search. Empty results are removed.
 */
export function splitIndexedPhones(value: unknown): string[] {
  const raw = typeof value === 'string' ? value : '';
  return raw
    .split(',')
    .map((part) => normalizeIndexedPhone(part))
    .filter((part): part is string => Boolean(part));
}
