// src/__tests__/unit/utils/attributes.test.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { normalizeCodeSystemAndValue } from "../../../utils/normalize-codeAndSystem";

describe('normalizeCodeSystemAndValue', () => {

  // --- URL-based Code Systems ---

  it('should normalize a simple http URL-based code system', () => {
    const input = 'http://loinc.org|LP12345-6';
    const expected = 'loinc:lp12345-6';
    expect(normalizeCodeSystemAndValue(input)).toBe(expected);
  });

  it('should normalize a complex https URL with subdomains and paths', () => {
    const input = 'https://terminology.hl7.org/CodeSystem/v2-0136|Y';
    const expected = 'terminology:y';
    expect(normalizeCodeSystemAndValue(input)).toBe(expected);
  });

  it('should handle a URL system with a different separator', () => {
    const input = 'https://snomed.info/sct:123456789';
    const expected = 'snomed:123456789';
    expect(normalizeCodeSystemAndValue(input)).toBe(expected);
  });


  // --- Non-URL Code Systems ---

  it('should normalize a non-URL code system with a pipe separator', () => {
    const input = 'ISCO-08|4226';
    const expected = 'isco-08:4226';
    expect(normalizeCodeSystemAndValue(input)).toBe(expected);
  });

  it('should keep a non-URL code system that already uses a colon', () => {
    const input = 'sct:12345';
    const expected = 'sct:12345';
    expect(normalizeCodeSystemAndValue(input)).toBe(expected);
  });

  it('should handle inconsistent casing in non-URL system', () => {
    const input = 'SCT|12345';
    const expected = 'sct:12345';
    expect(normalizeCodeSystemAndValue(input)).toBe(expected);
  });

  // --- Simple Codes (no system) ---

  it('should return a simple code as-is (already lowercase)', () => {
    const input = '4226';
    expect(normalizeCodeSystemAndValue(input)).toBe('4226');
  });

  it('should normalize a simple code to lowercase', () => {
    const input = 'ABC-123';
    const expected = 'abc-123';
    expect(normalizeCodeSystemAndValue(input)).toBe(expected);
  });


  // --- Edge Cases ---

  it('should return an empty string for undefined input', () => {
    expect(normalizeCodeSystemAndValue(undefined)).toBe('');
  });

  it('should return an empty string for null input', () => {
    // @ts-ignore
    expect(normalizeCodeSystemAndValue(null)).toBe('');
  });

  it('should return an empty string for an empty string input', () => {
    expect(normalizeCodeSystemAndValue('')).toBe('');
  });

  it('should handle a code system with no value', () => {
    const input = 'http://loinc.org|';
    const expected = 'loinc:';
    expect(normalizeCodeSystemAndValue(input)).toBe(expected);
  });

  it('should handle a code with no system', () => {
    const input = '|LP12345-6';
    const expected = ':lp12345-6';
    expect(normalizeCodeSystemAndValue(input)).toBe(expected);
  });
});
