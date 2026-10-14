// src/utils/firestore.ts

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const replaceDotsWithUnderscores = (obj: any): any => {
  return Object.keys(obj).reduce((acc, key) => {
    const newKey = key.replace(/\./g, '_'); // Reemplaza '.' por '_'
    const value = obj[key];

    // Si el valor es un objeto, aplica la función recursivamente
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      acc[newKey] = replaceDotsWithUnderscores(value);
    } else {
      acc[newKey] = value;
    }

    return acc;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }, {} as any);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const replaceUnderscoresWithDots = (obj: Record<string, any>): Record<string, any> => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const newObj: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    const newKey = key.replace(/_/g, '.');
    newObj[newKey] = value;
  }
  return newObj;
}

/**
 * Generates a deterministic Firestore collection name based on tenant claims and a data section.
 * The pattern is `[countryCode]_[idType]_[idValue]_[sector]_[section]`.
 *
 * @param claims - An object containing the tenant's claims.
 * @param section - The specific data partition (e.g., 'registry', 'employees').
 * @returns The formatted collection name.
 * @throws {Error} If any of the required claims are missing.
 */
export const generateCollectionName = (claims: Record<string, string>, section: string): string => {
  const countryCode = claims['org.schema.Organization.address.addressCountry'];
  const idType = claims['org.schema.Organization.identifier.additionalType'];
  const idValue = claims['org.schema.Organization.identifier.value'];
  const sector = claims['org.schema.Service.category'];

  if (!countryCode || !idType || !idValue || !sector || !section) {
    throw new Error('Missing required claims to generate collection name.');
  }

  return `${countryCode}_${idType}_${idValue}_${sector}_${section}`;
};
