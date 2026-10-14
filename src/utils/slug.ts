// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/utils/slug.ts

export function normalizeSegment(input: string): string {
  return input.trim().toLowerCase();
}

export function slugFromDomain(domain?: string): string | undefined {
  if (!domain) return undefined;
  return domain
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)+/g, '');
}
