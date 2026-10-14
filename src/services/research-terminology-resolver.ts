import { getClaimValue } from '../utils/claims';

export type ResolvedResearchTerminology = Readonly<{
  codeClaim: string;
  textClaim: string;
  displayClaim: string;
  system: string;
  code: string;
  text?: string;
  display?: string;
  textLanguage?: string;
  displayLanguage?: string;
}>;

type TerminologyProjection = Readonly<{
  codeClaim: string;
  textClaim: string;
  displayClaim: string;
}>;

// These are the canonical flat claims exposed by the terminology service's
// governed capability document. Unsupported resource families remain
// searchable by their exact system|code token and never receive invented text.
const TERMINOLOGY_PROJECTIONS: Readonly<Record<string, TerminologyProjection>> = Object.freeze({
  AllergyIntolerance: {
    codeClaim: 'AllergyIntolerance.code',
    textClaim: 'AllergyIntolerance.code-text',
    displayClaim: 'AllergyIntolerance.code-display',
  },
  Condition: {
    codeClaim: 'Condition.code',
    textClaim: 'Condition.code-text',
    displayClaim: 'Condition.code-display',
  },
  DiagnosticReport: {
    codeClaim: 'DiagnosticReport.code',
    textClaim: 'DiagnosticReport.code-text',
    displayClaim: 'DiagnosticReport.code-display',
  },
  Immunization: {
    codeClaim: 'Immunization.vaccine-code',
    textClaim: 'Immunization.vaccine-code-text',
    displayClaim: 'Immunization.vaccine-code-display',
  },
  MedicationStatement: {
    codeClaim: 'MedicationStatement.code',
    textClaim: 'MedicationStatement.code-text',
    displayClaim: 'MedicationStatement.code-display',
  },
  Observation: {
    codeClaim: 'Observation.code',
    textClaim: 'Observation.code-text',
    displayClaim: 'Observation.code-display',
  },
  Procedure: {
    codeClaim: 'Procedure.code',
    textClaim: 'Procedure.code-text',
    displayClaim: 'Procedure.code-display',
  },
});

/** Returns the canonical code claim governed by the exact-label service. */
export function getResearchTerminologyCodeClaim(resourceType: string): string | undefined {
  return TERMINOLOGY_PROJECTIONS[String(resourceType || '').trim()]?.codeClaim;
}

function parseFhirToken(value: unknown): { system: string; code: string } | undefined {
  const token = String(value || '').trim();
  const separator = token.indexOf('|');
  if (separator < 1) return undefined;
  const system = token.slice(0, separator).trim();
  const code = token.slice(separator + 1).trim();
  if (!system || !code || !URL.canParse(system)) return undefined;
  return { system, code };
}

/**
 * Resolves labels from the trusted terminology boundary. Absence of service
 * configuration or of a canonical system|code token deliberately produces no
 * labels; transport and policy errors fail the projection instead of silently
 * treating caller text as normalized terminology.
 */
export async function resolveResearchTerminologyLabels(input: Readonly<{
  sector: string;
  jurisdiction: string;
  resourceType: string;
  claims: Record<string, unknown>;
}>): Promise<ResolvedResearchTerminology | undefined> {
  const baseUrl = String(process.env.RESEARCH_TERMINOLOGY_BASE_URL || '').trim().replace(/\/+$/, '');
  const projection = TERMINOLOGY_PROJECTIONS[String(input.resourceType || '').trim()];
  if (!baseUrl || !projection) return undefined;
  const token = parseFhirToken(getClaimValue(input.claims, projection.codeClaim));
  if (!token) return undefined;

  const language = String(getClaimValue(input.claims, `${input.resourceType}.language`) || 'en').trim() || 'en';
  const url = new URL(`${baseUrl}/v1/terminology/labels`);
  url.search = new URLSearchParams({
    sector: String(input.sector || '').trim(),
    jurisdiction: String(input.jurisdiction || '').trim().toUpperCase(),
    fhirVersion: 'R4',
    resourceType: input.resourceType,
    claim: projection.codeClaim,
    system: token.system,
    code: token.code,
    language,
  }).toString();
  const serviceToken = String(process.env.RESEARCH_TERMINOLOGY_SERVICE_TOKEN || '').trim();
  const response = await fetch(url, {
    headers: {
      accept: 'application/vnd.api+json',
      ...(serviceToken ? { authorization: `Bearer ${serviceToken}` } : {}),
    },
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) {
    throw new Error(`Research terminology lookup failed with HTTP ${response.status}.`);
  }
  const document = await response.json() as any;
  const labels = document?.data?.attributes;
  if (!labels?.text && !labels?.display) return undefined;
  if (labels.system !== token.system || labels.code !== token.code) {
    throw new Error('Research terminology response does not match the requested system|code.');
  }
  return {
    ...projection,
    system: token.system,
    code: token.code,
    ...(labels.text ? { text: String(labels.text) } : {}),
    ...(labels.display ? { display: String(labels.display) } : {}),
    ...(labels.textLanguage ? { textLanguage: String(labels.textLanguage) } : {}),
    ...(labels.displayLanguage ? { displayLanguage: String(labels.displayLanguage) } : {}),
  };
}
