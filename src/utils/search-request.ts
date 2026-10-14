import { ResourceTypesFhirR4 } from 'gdc-common-utils-ts/constants/fhir-resource-types';
import { ManagerError } from 'gdc-common-utils-ts/utils/manager-error';
import { IssueType } from 'gdc-common-utils-ts/models/issue';

export type SearchFilters = Record<string, string[]>;
export type DocumentReferenceSearchFilters = {
  identifier?: string;
  attachmentHash?: string;
};
export type CommunicationSearchFilters = {
  identifier?: string;
  thid?: string;
  pthid?: string;
  attachmentHash?: string;
};

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)));
}

function splitValues(rawValue: string): string[] {
  return String(rawValue || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function getRequestTarget(requestUrl: unknown): string {
  return String(requestUrl || '').trim().split('?')[0].replace(/^\/+|\/+$/g, '');
}

function collectParameterValue(parameter: any): string[] {
  if (typeof parameter?.valueBoolean === 'boolean') {
    return [String(parameter.valueBoolean)];
  }
  if (typeof parameter?.valueInteger === 'number') {
    return [String(parameter.valueInteger)];
  }
  if (typeof parameter?.valueDecimal === 'number') {
    return [String(parameter.valueDecimal)];
  }
  if (parameter?.valueReference?.reference) {
    return splitValues(String(parameter.valueReference.reference));
  }
  if (parameter?.valueCoding?.code) {
    const code = String(parameter.valueCoding.code).trim();
    const system = String(parameter.valueCoding.system || '').trim();
    return [system ? `${system}|${code}` : code].filter(Boolean);
  }

  return splitValues(
    String(
      parameter?.valueString
      || parameter?.valueCode
      || parameter?.valueUri
      || parameter?.valueDate
      || parameter?.valueDateTime
      || '',
    ),
  );
}

export function extractSearchFiltersFromParametersResource(resource: any): SearchFilters {
  const parameters = Array.isArray(resource?.parameter) ? resource.parameter : [];
  const filters: SearchFilters = {};
  for (const parameter of parameters) {
    const name = String(parameter?.name || '').trim();
    if (!name) continue;
    const values = collectParameterValue(parameter);
    if (values.length === 0) continue;
    filters[name] = [...(filters[name] || []), ...values];
  }
  return filters;
}

export function extractSearchFiltersFromRequestUrl(requestUrl: unknown): SearchFilters {
  const rawUrl = String(requestUrl || '').trim();
  const queryIndex = rawUrl.indexOf('?');
  const params = new URLSearchParams(queryIndex >= 0 ? rawUrl.slice(queryIndex + 1) : '');
  const filters: SearchFilters = {};
  for (const [key, value] of params.entries()) {
    const values = splitValues(value);
    if (values.length > 0) {
      filters[key] = values;
    }
  }
  return filters;
}

export function collectSearchFiltersFromBody(body: any): SearchFilters {
  const filters: SearchFilters = {};
  const merge = (source: SearchFilters) => {
    for (const [key, values] of Object.entries(source || {})) {
      if (!filters[key]) {
        filters[key] = [];
      }
      filters[key].push(...values);
    }
  };

  if (Array.isArray(body?.parameter)) {
    merge(extractSearchFiltersFromParametersResource({ resourceType: ResourceTypesFhirR4.Parameters, parameter: body.parameter }));
  }

  const wrappers = [
    ...(Array.isArray(body?.entry) ? body.entry : []),
    ...(Array.isArray(body?.data) ? body.data : []),
  ];

  for (const wrapper of wrappers) {
    merge(extractSearchFiltersFromRequestUrl(wrapper?.request?.url));
    if (wrapper?.resource?.resourceType === 'Parameters') {
      merge(extractSearchFiltersFromParametersResource(wrapper.resource));
    }
  }

  return filters;
}

export function getSearchFilterValues(body: any, names: string[]): string[] {
  const filters = collectSearchFiltersFromBody(body);
  const values: string[] = [];
  const acceptedNames = new Set(names.map((name) => name.toLowerCase()));
  for (const [name, filterValues] of Object.entries(filters)) {
    if (acceptedNames.has(name.toLowerCase())) values.push(...filterValues);
  }
  return dedupe(values);
}

export function getFirstSearchFilter(body: any, names: string[]): string {
  return getSearchFilterValues(body, names)[0] || '';
}

export function extractDocumentReferenceSearchFilters(body: any): DocumentReferenceSearchFilters {
  const identifier = getFirstSearchFilter(body, ['identifier', 'documentreference.identifier']);
  const attachmentHash = getFirstSearchFilter(body, [
    'contenthash',
    'documentreference.contenthash',
    'attachment.hash',
  ]);
  return {
    identifier: identifier || undefined,
    attachmentHash: attachmentHash || undefined,
  };
}

export function extractCommunicationSearchFilters(body: any): CommunicationSearchFilters {
  const identifier = getFirstSearchFilter(body, ['identifier', 'communication.identifier']);
  const thid = getFirstSearchFilter(body, ['thid']);
  const pthid = getFirstSearchFilter(body, ['pthid']);
  const attachmentHash = getFirstSearchFilter(body, [
    'contenthash',
    'documentreference.contenthash',
    'attachment.hash',
  ]);
  return {
    identifier: identifier || undefined,
    thid: thid || undefined,
    pthid: pthid || undefined,
    attachmentHash: attachmentHash || undefined,
  };
}

export function extractCompositionSearchSubject(body: any): string {
  return getFirstSearchFilter(body, ['subject', 'composition.subject']);
}

export function extractCompositionSearchSections(body: any): string[] {
  return getSearchFilterValues(body, ['section', 'composition.section']);
}

export function extractCompositionExcludedSearchSections(body: any): string[] {
  return getSearchFilterValues(body, [
    'section:not',
    'composition.section:not',
    'exclude-section',
    'exclude-sections',
  ]);
}

export function extractCompositionSearchTypes(body: any): string[] {
  return getSearchFilterValues(body, ['composition.type', 'document-type']);
}

export function extractRequestedBundleType(body: any): string {
  return getFirstSearchFilter(body, ['type']);
}

export function extractSearchResourceTarget(requestUrl: unknown): string {
  const target = getRequestTarget(requestUrl);
  if (!target) return '';
  const withoutAction = target.endsWith('/_search') ? target.slice(0, -'/_search'.length) : target;
  const segments = withoutAction.split('/').filter(Boolean);
  return segments.length > 0 ? String(segments[segments.length - 1] || '').trim() : '';
}

export function extractSearchResourceType(body: any, fallbackResourceType = 'composition'): string {
  const wrappers = [
    ...(Array.isArray(body?.entry) ? body.entry : []),
    ...(Array.isArray(body?.data) ? body.data : []),
  ];
  for (const wrapper of wrappers) {
    const requestUrl = String(wrapper?.request?.url || '').trim();
    if (!requestUrl) continue;
    const target = extractSearchResourceTarget(requestUrl);
    if (!target) continue;
    return target.toLowerCase();
  }
  return String(fallbackResourceType || 'composition').trim().toLowerCase() || 'composition';
}

export function assertSearchRequestTarget(
  requestUrl: unknown,
  expectedResourceType: string,
): void {
  const target = extractSearchResourceTarget(requestUrl);
  if (!target) {
    throw new ManagerError('Search request requires request.url.', IssueType.Required);
  }

  if (target !== expectedResourceType) {
    throw new ManagerError(
      `Search request expects request.url to target '${expectedResourceType}', got '${getRequestTarget(requestUrl)}'.`,
      IssueType.Invalid,
    );
  }
}

export function extractSearchFiltersFromEntry(
  entry: any,
  expectedResourceType: string,
): SearchFilters {
  const request = entry?.request;
  if (!request) {
    throw new ManagerError('Search entry requires a request object.', IssueType.Required);
  }

  const method = String(request.method || '').toUpperCase();
  assertSearchRequestTarget(request.url, expectedResourceType);

  if (method === 'GET') {
    return extractSearchFiltersFromRequestUrl(request.url);
  }

  if (method === 'POST') {
    const resource = entry?.resource;
    if (resource?.resourceType !== 'Parameters') {
      throw new ManagerError(
        "POST search entry requires resource.resourceType = 'Parameters'.",
        IssueType.Required,
      );
    }
    return extractSearchFiltersFromParametersResource(resource);
  }

  throw new ManagerError(
    `Search entry only supports GET or POST request methods, got '${method || '(empty)'}'.`,
    IssueType.NotSupported,
  );
}
