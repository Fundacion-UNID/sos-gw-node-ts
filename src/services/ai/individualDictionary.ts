// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

export type DictionaryEntityKind = 'RelatedPerson' | 'Place' | 'Organization' | 'Practitioner';

export type IndividualDictionaryEntry = {
  id: string;
  kind: DictionaryEntityKind;
  /**
   * Stable pseudonymous identifier (NOT a name). Examples:
   * - "neighbor-1"
   * - "primary-care-clinic-1"
   * - "reference-doctor-1"
   */
  alias: string;
  /**
   * Terms that may appear in private text and should be replaced when anonymizing.
   * Keep these private: they can contain names, addresses, etc.
   */
  matchTerms: string[];
  /** Optional preferred label (private). */
  displayName?: string;
};

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function kindPrefix(kind: DictionaryEntityKind): string {
  switch (kind) {
    case 'RelatedPerson':
      return 'RP';
    case 'Place':
      return 'PLACE';
    case 'Organization':
      return 'ORG';
    case 'Practitioner':
      return 'PRAC';
  }
}

export function placeholderFor(entry: Pick<IndividualDictionaryEntry, 'kind' | 'alias'>): string {
  return `[[${kindPrefix(entry.kind)}:${entry.alias}]]`;
}

export type ReplacementRule = {
  /** Case-insensitive regex built from a term. */
  pattern: RegExp;
  replacement: string;
  entryId: string;
};

export type AnonymizeResult = {
  anonymizedText: string;
  usedEntryIds: string[];
};

export function buildReplacementRules(entries: IndividualDictionaryEntry[]): ReplacementRule[] {
  const rules: ReplacementRule[] = [];

  for (const entry of entries) {
    const replacement = placeholderFor(entry);
    const terms = (entry.matchTerms || []).filter((t) => typeof t === 'string' && t.trim().length > 0);

    for (const term of terms) {
      rules.push({
        pattern: new RegExp(`\\b${escapeRegExp(term.trim())}\\b`, 'gi'),
        replacement,
        entryId: entry.id,
      });
    }
  }

  // Prefer longer terms first to avoid partial matches (e.g., "Juan" inside "Juan Perez").
  return rules.sort((a, b) => b.pattern.source.length - a.pattern.source.length);
}

export function anonymizeTextWithDictionary(
  text: string,
  entries: IndividualDictionaryEntry[]
): AnonymizeResult {
  let anonymizedText = String(text ?? '');
  const usedEntryIds = new Set<string>();

  const rules = buildReplacementRules(entries);
  for (const rule of rules) {
    const before = anonymizedText;
    anonymizedText = anonymizedText.replace(rule.pattern, rule.replacement);
    if (anonymizedText !== before) usedEntryIds.add(rule.entryId);
  }

  return { anonymizedText, usedEntryIds: Array.from(usedEntryIds) };
}

export function reidentifyTextWithDictionary(text: string, entries: IndividualDictionaryEntry[]): string {
  let out = String(text ?? '');
  for (const entry of entries) {
    const placeholder = placeholderFor(entry);
    const label = entry.displayName || entry.matchTerms?.[0] || entry.alias;
    out = out.split(placeholder).join(label);
  }
  return out;
}

