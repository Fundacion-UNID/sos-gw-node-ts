// src/utils/phone-number.ts

/**
 * Normalizes a phone number string into a format suitable for the E.164 URN.
 * It preserves the leading '+' and removes all other non-digit characters.
 *
 * @example
 * normalizePhoneNumber('+1 (202) 555-0104') // returns '+12025550104'
 *
 * @param phone The raw phone number string.
 * @returns The normalized phone number string.
 */
export function normalizePhoneNumber(phone: string): string {
  // Keep the plus sign if it exists at the start
  const prefix = phone.trim().startsWith('+') ? '+' : '';
  
  // Remove all non-digit characters from the string
  const digits = phone.replace(/\D/g, '');

  return `${prefix}${digits}`;
}
