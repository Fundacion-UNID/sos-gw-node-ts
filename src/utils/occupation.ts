export function getPersonOccupationClaim(claims: Record<string, any> | undefined): string | undefined {
  if (!claims || typeof claims !== 'object') return undefined;

  const direct =
    (claims['org.schema.Person.hasOccupation'] as string | undefined)
    || (claims['Person.hasOccupation'] as string | undefined);
  if (typeof direct === 'string' && direct.trim()) return direct.trim();

  const value =
    (claims['org.schema.Person.hasOccupation.identifier.value'] as string | undefined)
    || (claims['Person.hasOccupation.identifier.value'] as string | undefined);
  if (!value || !String(value).trim()) return undefined;

  const system =
    (claims['org.schema.Person.hasOccupation.identifier.additionalType'] as string | undefined)
    || (claims['Person.hasOccupation.identifier.additionalType'] as string | undefined);

  const cleanValue = String(value).trim();
  const cleanSystem = String(system || '').trim();
  return cleanSystem ? `${cleanSystem}|${cleanValue}` : cleanValue;
}
