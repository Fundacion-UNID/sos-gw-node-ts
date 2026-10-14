// src/utils/jurisdiction.ts

/**
 * Maps a 2-letter country code to a jurisdictional group for blockchain channel routing.
 * @param countryCode The ISO 3166-1 alpha-2 country code.
 * @returns The corresponding jurisdiction group ('eu' or 'global').
 */
export function getJurisdictionGroup(countryCode: string): 'eu' | 'global' {
  const euCountries = [
    'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 
    'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE'
  ];

  if (euCountries.includes(countryCode.toUpperCase())) {
    return 'eu';
  }

  // For the MVP, all other jurisdictions are routed to the global channel.
  // This can be expanded in the future with 'na' (North America), 'apac', etc.
  return 'global';
}
