import { IssueType } from 'gdc-common-utils-ts/models/issue';
import { ManagerError } from 'gdc-common-utils-ts/utils/manager-error';

function readScopeTokens(scope: unknown): string[] {
  return String(scope || '')
    .split(/\s+/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function hasRootCapability(tokens: string[], expected: string): boolean {
  const normalizedExpected = expected.toLowerCase();
  return tokens.some((token) => token.toLowerCase().startsWith(normalizedExpected));
}

type SmartCompositionReadScope = {
  subject?: string;
  sections?: string[];
};

function parseCompositionReadScopes(scope: unknown): SmartCompositionReadScope[] {
  return readScopeTokens(scope).flatMap((token) => {
    const [capability, rawQuery = ''] = token.split('?', 2);
    const match = capability.match(/^organization\/Composition\.([a-z]+)$/i);
    if (!match || (!match[1].toLowerCase().includes('r') && !match[1].toLowerCase().includes('s'))) {
      return [];
    }
    const params = new URLSearchParams(rawQuery);
    const subject = String(params.get('subject') || '').trim();
    const sectionValues = params.getAll('section')
      .flatMap((value) => String(value || '').split(','))
      .map((value) => value.trim())
      .filter(Boolean);
    return [{
      ...(subject ? { subject } : {}),
      ...(sectionValues.length > 0 ? { sections: sectionValues } : {}),
    }];
  });
}

function normalizeSectionSystem(value: string): string {
  const normalized = String(value || '').trim().toLowerCase().replace(/\/$/, '');
  if (normalized === 'loinc' || normalized === 'http://loinc.org') return 'http://loinc.org';
  if (['snomed', 'snomedct', 'http://snomed.info/sct'].includes(normalized)) {
    return 'http://snomed.info/sct';
  }
  return normalized;
}

function sectionTokenParts(value: string): { system: string; code: string } {
  const normalized = String(value || '').trim();
  const delimiter = normalized.lastIndexOf('|');
  return {
    system: delimiter >= 0 ? normalizeSectionSystem(normalized.slice(0, delimiter)) : '',
    code: (delimiter >= 0 ? normalized.slice(delimiter + 1) : normalized).toLowerCase(),
  };
}

function sectionsMatch(left: string, right: string): boolean {
  const actual = sectionTokenParts(left);
  const expected = sectionTokenParts(right);
  return actual.code === expected.code
    && (!actual.system || !expected.system || actual.system === expected.system);
}

/**
 * Applies the authenticated SMART token's subject and section constraints to
 * an individual Composition read. An omitted request section inherits the
 * token's allowed set; an explicit request is narrowed to their intersection.
 *
 * The returned array is the only section set that summary materialization may
 * disclose. Callers must not treat an application/BFF filter as authorization.
 */
export function constrainSmartCompositionReadSections(input: {
  bearerPayload?: Record<string, unknown>;
  subject: string;
  requestedSections: string[];
}): string[] {
  const rawScope = String(input.bearerPayload?.scope || '').trim();
  if (!rawScope) return input.requestedSections;

  const compositionScopes = parseCompositionReadScopes(rawScope);
  if (compositionScopes.length === 0) {
    throw new ManagerError(
      'Individual summary requires a readable organization/Composition SMART scope.',
      IssueType.Forbidden,
    );
  }

  const subject = String(input.subject || '').trim();
  const subjectScopes = compositionScopes.filter((scope) => scope.subject === '*' || scope.subject === subject);
  if (subjectScopes.length === 0) {
    throw new ManagerError(
      'SMART scope subject does not authorize the requested individual summary.',
      IssueType.Forbidden,
    );
  }

  if (subjectScopes.some((scope) => !scope.sections || scope.sections.includes('*'))) {
    return input.requestedSections;
  }

  const allowedSections = Array.from(new Set(subjectScopes.flatMap((scope) => scope.sections || [])));
  if (input.requestedSections.length === 0) return allowedSections;

  const intersection = input.requestedSections.filter((section) =>
    allowedSections.some((allowed) => sectionsMatch(section, allowed)));
  if (intersection.length === 0) {
    throw new ManagerError(
      'SMART scope sections do not authorize the requested individual summary.',
      IssueType.Forbidden,
    );
  }
  return intersection;
}

export function enforceSmartScopeRouteCompatibility(input: {
  section: string;
  bearerPayload?: Record<string, unknown>;
}): void {
  const section = String(input.section || '').trim().toLowerCase();
  if (section !== 'individual' && section !== 'digitaltwin') return;

  const scopeTokens = readScopeTokens(input.bearerPayload?.scope);
  if (scopeTokens.length === 0) return;

  if (section === 'individual' && !hasRootCapability(scopeTokens, 'organization/composition.')) {
    throw new ManagerError(
      'Individual endpoints require one SMART scope rooted at organization/Composition.',
      IssueType.Forbidden,
    );
  }

  if (section === 'digitaltwin' && !hasRootCapability(scopeTokens, 'organization/researchsubject.')) {
    throw new ManagerError(
      'digitaltwin endpoints require one SMART scope rooted at organization/ResearchSubject.',
      IssueType.Forbidden,
    );
  }
}
