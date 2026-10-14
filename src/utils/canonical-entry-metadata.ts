// Copyright 2026 Antifraud Services Inc. under the Apache License, Version 2.0.

import { ResourceTypesFhirR4 } from 'gdc-common-utils-ts/constants/fhir-resource-types';

/** Moves legacy claims to resource metadata while preserving other entry metadata. */
export function canonicalizeBundleEntryMetadata(
  meta: Record<string, unknown> | undefined,
): Readonly<Record<string, unknown>> {
  if (!meta || typeof meta !== 'object') return {};
  const { claims, ...entryMeta } = meta;
  return {
    ...(Object.keys(entryMeta).length > 0 ? { meta: entryMeta } : {}),
    ...(claims && typeof claims === 'object'
      ? { resource: { resourceType: ResourceTypesFhirR4.OperationOutcome, meta: { claims } } }
      : {}),
  };
}
