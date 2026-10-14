// src/utils/identifier-parser.ts

/**
 * A list of known, non-country-specific identifier types.
 * This helps the parser differentiate between a type and a country code.
 * @see @link https://terminology.hl7.org/ValueSet-v2-0203.html
 */
const KNOWN_ID_TYPES = ['JHN', 'NN', 'PPN', 'DL', 'MRN', 'SSN', 'TAX', 'PI', 'WP', 'SP', 'VISA'];

export interface ParsedIdentifier {
  type: string;
  countryCode?: string;
  subdivision?: string;
}

/**
 * Parses a composite identifier type string (e.g., 'JHNES-CL') into its constituent parts.
 * The logic is designed to extract a country code for the purpose of routing to the
 * correct jurisdictional blockchain channel.
 *
 * @param rawType The composite identifier string from a claim.
 * @returns An object containing the base type, country code, and subdivision.
 */
export function parseIdentifierType(rawType: string): ParsedIdentifier {
  if (!rawType) {
    return { type: '', countryCode: undefined, subdivision: undefined };
  }

  const parts = rawType.split('-');
  const rootType = parts[0];
  const subdivision = parts.length > 1 ? parts[1] : undefined;

  // Iterate through known types to find the longest matching prefix.
  // This correctly handles types like 'JHN' before 'NN'.
  let bestMatch = { type: rawType, countryCode: undefined, subdivision: undefined };

  for (const knownType of KNOWN_ID_TYPES) {
    if (rootType.startsWith(knownType)) {
      const countryCode = rootType.substring(knownType.length);
      
      // A valid country code must be exactly 2 letters.
      if (countryCode.length === 2 && /^[A-Z]{2}$/.test(countryCode)) {
        return { type: knownType, countryCode, subdivision };
      }
    }
  }

  // If no pattern with a country code matches, return the original type.
  return bestMatch;
}
