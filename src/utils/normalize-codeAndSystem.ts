// src/utils/normalize-codeAndSystem.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

// TODO: old format was "system:code" but now is "System|Code" following FHIR / OpenEHR formats (Camel Case must be preserved)
// TODO: URLs must be converted to reverse-DNS format. In case it is neither an URL nor a reversed DNS, then convert the single word to the reverse-DNS format for canonicalization (when known)

/**
 * Normalizes a code that may contain a code system (like 'SYSTEM|VALUE' or 'SYSTEM:VALUE')
 * into a canonical, lowercase format ('system:value'). This is crucial for creating
 * consistent, searchable HMAC indexes in the vault.
 *
 * It specifically handles cases where the code system is a URL, extracting the
 * most significant part of the domain name.
 *
 * @param input The raw code string to normalize. Can be undefined.
 * @returns The normalized string, or an empty string if the input is empty or invalid.
 *
 * @example
 * URL-based system
 * normalizeCodeSystemAndValue('http://loinc.org|LP12345-6')
 * => 'loinc:lp12345-6'
 *
 * @example
 * Non-URL system
 * normalizeCodeSystemAndValue('ISCO-08|4226')
 *  => 'isco-08|4226'
 *
 * @example
 * Simple code
 * normalizeCodeSystemAndValue('ABC-123')
 * => 'abc-123'
 */
export function normalizeCodeSystemAndValue(input: string | undefined): string {
  if (!input) {
    return '';
  }

  // Find the last occurrence of either ':' or '|' to correctly split system and value.
  const pipeIndex = input.lastIndexOf('|');
  const colonIndex = input.lastIndexOf(':');
  const separatorIndex = Math.max(pipeIndex, colonIndex);

  // If no separator is found, it's a simple code.
  if (separatorIndex === -1) {
    return input.toLowerCase();
  }

  let system = input.substring(0, separatorIndex);
  let value = input.substring(separatorIndex + 1);

  // Check if the system part looks like a URL.
  if (system.startsWith('http://') || system.startsWith('https://')) {
    try {
      const url = new URL(system);
      // 'terminology.hl7.org' -> 'terminology'
      const domainParts = url.hostname.split('.');
      system = domainParts[0];
    } catch (e) {
      // If parsing fails, treat it as a non-URL system but remove the protocol.
      system = system.replace(/^https?:\/\//, '');
    }
  }

  // Normalize to lowercase and join with a colon (canonical internal format).
  return `${system.toLowerCase()}:${value.toLowerCase()}`;
}
