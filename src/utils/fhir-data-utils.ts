import { randomUUID } from 'crypto';
import { determineResourceId } from './resource';

export function normalizeReference(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized || undefined;
}

export function extractTokenCode(value: string): string {
  const normalized = String(value || '').trim();
  if (!normalized) return '';
  const parts = normalized.split('|');
  return parts.length > 1 ? parts[parts.length - 1] : normalized;
}

export function tokenToCoding(value: string): { system?: string; code: string } {
  const normalized = String(value || '').trim();
  const [left, right] = normalized.split('|');
  if (!right) {
    return { code: left };
  }
  if (/^https?:\/\//i.test(left)) {
    return { system: left, code: right };
  }
  if (left.toUpperCase() === 'LOINC') {
    return { system: 'http://loinc.org', code: right };
  }
  return { system: left, code: right };
}

export function pickLatestIsoDate(values: string[]): string {
  const sorted = values
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .sort();
  return sorted[sorted.length - 1] || new Date().toISOString();
}

export function resolveBundleEntryKey(
  reference: string | undefined,
  resource: Record<string, any>,
): string {
  return normalizeReference(reference)
    || normalizeReference(resource?.identifier?.[0]?.value)
    || normalizeReference(resource?.resourceType && resource?.id ? `${resource.resourceType}/${resource.id}` : '')
    || `${String(resource?.resourceType || 'Resource')}/${determineResourceId(String(resource?.id || randomUUID()), process.env.NODE_ENV)}`;
}

export function resolveBundleEntryFullUrl(
  reference: string | undefined,
  entry: { fullUrl?: string; resource?: Record<string, any> },
): string | undefined {
  return normalizeReference(entry?.fullUrl)
    || normalizeReference(reference)
    || normalizeReference(entry?.resource?.identifier?.[0]?.value)
    || normalizeReference(
      entry?.resource?.resourceType && entry?.resource?.id
        ? `${entry.resource.resourceType}/${entry.resource.id}`
        : '',
    )
    || undefined;
}
