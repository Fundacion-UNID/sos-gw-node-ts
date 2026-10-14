// src/utils/consent.ts

import { createHash } from 'crypto';
import { ISCO08_CODING_SYSTEM } from 'gdc-common-utils-ts/constants/healthcare';

export type ConsentRuleKeyParts = {
  subjectId: string;
  sector: string;
  target: string;
  decision: string;
  purpose: string;
};

const ISO_3166_FHIR_SYSTEM = 'urn:iso:std:iso:3166';
const V3_ROLE_CODE_CANONICAL_SYSTEM = 'v3-RoleCode';

export type ConsentRoleContext = 'professional' | 'family' | 'auto';

function splitCommaSeparated(value: string): string[] {
  return String(value || '')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function normalizeTarget(target: string): string {
  const trimmed = target.trim();
  const telMatch = trimmed.match(/^(?:tel:)?\+([0-9]+)$/i);
  if (telMatch) return `tel:+${telMatch[1]}`;

  const countryUrnMatch = trimmed.match(/^urn:iso:std:iso:3166\|([a-z]{2})$/i);
  if (countryUrnMatch) return `${ISO_3166_FHIR_SYSTEM}|${countryUrnMatch[1].toUpperCase()}`;

  if (/^[A-Z]{2}$/i.test(trimmed)) return `${ISO_3166_FHIR_SYSTEM}|${trimmed.toUpperCase()}`;
  if (trimmed.includes('@') && !/\s/.test(trimmed)) return trimmed.toLowerCase();
  return trimmed;
}

function normalizeRoleSystem(inputSystem: string): string {
  const normalized = inputSystem.trim().toLowerCase();
  if (normalized.includes('isco-08') || normalized === ISCO08_CODING_SYSTEM) return ISCO08_CODING_SYSTEM;
  if (normalized.endsWith('v3-rolecode') || normalized.includes('/v3-rolecode')) return V3_ROLE_CODE_CANONICAL_SYSTEM;
  return inputSystem.trim();
}

function inferRoleSystemFromCode(code: string, context: ConsentRoleContext): string {
  if (/^[0-9]+$/.test(code)) return ISCO08_CODING_SYSTEM;
  if (context === 'professional') return ISCO08_CODING_SYSTEM;
  if (context === 'family') return V3_ROLE_CODE_CANONICAL_SYSTEM;
  return V3_ROLE_CODE_CANONICAL_SYSTEM;
}

export function isValidIsco08RoleCode(rawRole: string): boolean {
  const value = String(rawRole || '').trim();
  if (!value || value === '*') return false;
  const normalized = normalizeConsentActorRole(value, 'professional');
  const [system, code] = normalized.split('|', 2);
  return system === ISCO08_CODING_SYSTEM && /^[0-9]+$/.test(code || '');
}

export function isValidFhirRoleCode(rawRole: string): boolean {
  const value = String(rawRole || '').trim();
  if (!value || value === '*') return false;
  if (/^[0-9]+$/.test(value)) return false;
  const normalized = normalizeConsentActorRole(value, 'family');
  const [system, code] = normalized.split('|', 2);
  return system === V3_ROLE_CODE_CANONICAL_SYSTEM && Boolean(code);
}

export function normalizeConsentActorRole(rawRole: string, context: ConsentRoleContext = 'auto'): string {
  const value = rawRole.trim();
  if (!value) return value;
  if (value === '*') return value;

  const sep = value.indexOf('|');
  if (sep > 0) {
    const system = normalizeRoleSystem(value.slice(0, sep));
    const rawCode = value.slice(sep + 1).trim();
    const code = system === ISCO08_CODING_SYSTEM ? rawCode : rawCode.toUpperCase();
    return `${system}|${code}`;
  }

  const inferredSystem = inferRoleSystemFromCode(value, context);
  const code = inferredSystem === ISCO08_CODING_SYSTEM ? value : value.toUpperCase();
  return `${inferredSystem}|${code}`;
}

export function expandConsentActorRoles(rawRoles: string, context: ConsentRoleContext = 'auto'): string[] {
  return splitCommaSeparated(rawRoles)
    .map((role) => normalizeConsentActorRole(role, context))
    .filter(Boolean);
}

export function buildConsentRuleKey(parts: ConsentRuleKeyParts): string {
  const subjectId = parts.subjectId.trim();
  const sector = parts.sector.trim();
  const target = normalizeTarget(parts.target);
  const decision = parts.decision.trim().toLowerCase();
  const purpose = parts.purpose.trim();
  return `${subjectId}|${sector}|${target}|${decision}|${purpose}`;
}

/** Stable vault key for the current mutable decision of one actor and purpose. */
export function buildConsentRuleStorageKey(parts: ConsentRuleKeyParts): string {
  return `${parts.subjectId.trim()}|${parts.sector.trim()}|${normalizeTarget(parts.target)}|${parts.purpose.trim()}`;
}

export function hashConsentRuleId(ruleKey: string): string {
  return createHash('sha3-384').update(ruleKey, 'utf8').digest('hex');
}
