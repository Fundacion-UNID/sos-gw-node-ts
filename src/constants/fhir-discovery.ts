// Copyright 2026 Antifraud Services Inc. under the Apache License, Version 2.0.

/** Native FHIR wire formats that may expose a standards-compliant metadata endpoint. */
export const NativeFhirFormats = Object.freeze({
  R4: 'org.hl7.fhir.r4',
  R5: 'org.hl7.fhir.r5',
} as const);

export type NativeFhirFormat = typeof NativeFhirFormats[keyof typeof NativeFhirFormats];

/** FHIR release advertised for each native wire format. */
export const FhirVersionsByFormat: Readonly<Record<NativeFhirFormat, string>> = Object.freeze({
  [NativeFhirFormats.R4]: '4.0.1',
  [NativeFhirFormats.R5]: '5.0.0',
});

/** Returns whether a URL format segment denotes a native FHIR server base. */
export function isNativeFhirFormat(format: string): format is NativeFhirFormat {
  return Object.values(NativeFhirFormats).includes(format as NativeFhirFormat);
}
