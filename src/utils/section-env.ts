import { resolveStorageScope } from '../config/storage-layout';

export type EnvPrefix = 'test' | 'prod';

export function getEnvPrefix(): EnvPrefix {
  return process.env.NODE_ENV === 'production' ? 'prod' : 'test';
}

export function getEnvSectionId(sectionId: string): string {
  const trimmed = String(sectionId || '').trim();
  if (!trimmed) {
    throw new Error('sectionId is required');
  }
  const storageScope = resolveStorageScope();
  if (storageScope.prefix) {
    return trimmed.toLowerCase().startsWith(`${storageScope.prefix}_`)
      ? trimmed
      : `${storageScope.prefix}_${trimmed}`;
  }

  const lower = trimmed.toLowerCase();
  if (lower.startsWith('test_') || lower.startsWith('prod_')) {
    return trimmed;
  }
  return `${getEnvPrefix()}_${trimmed}`;
}
