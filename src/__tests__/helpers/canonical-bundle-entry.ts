// Flow contract: tests author canonical resource metadata while legacy fixtures remain readable during migration.

export function withCanonicalEntryClaims<T extends Record<string, any>>(
  entry: T,
  patch: Readonly<Record<string, unknown>>,
): T {
  const { meta: legacyMeta, resource, ...entryFields } = entry;
  return {
    ...entryFields,
    resource: {
      ...(resource || {}),
      meta: {
        ...(resource?.meta || {}),
        claims: {
          ...(resource?.meta?.claims ?? legacyMeta?.claims ?? {}),
          ...patch,
        },
      },
    },
  } as unknown as T;
}
