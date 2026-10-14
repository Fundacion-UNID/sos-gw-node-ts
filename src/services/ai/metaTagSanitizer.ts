export type LedgerSafeMetaTag = {
  id: string;
  system?: string;
  code?: string;
  version?: string;
  userSelected?: boolean;
};

export function toLedgerSafeMetaTags(tags: unknown): LedgerSafeMetaTag[] | undefined {
  if (!Array.isArray(tags)) return undefined;
  const result: LedgerSafeMetaTag[] = [];
  for (const tag of tags) {
    if (!tag || typeof tag !== 'object') continue;
    const anyTag = tag as Record<string, any>;
    if (typeof anyTag.id !== 'string' || anyTag.id.length === 0) continue;

    const safe: LedgerSafeMetaTag = { id: anyTag.id };
    if (typeof anyTag.system === 'string') safe.system = anyTag.system;
    if (typeof anyTag.code === 'string') safe.code = anyTag.code;
    if (typeof anyTag.version === 'string') safe.version = anyTag.version;
    if (typeof anyTag.userSelected === 'boolean') safe.userSelected = anyTag.userSelected;
    result.push(safe);
  }
  return result.length ? result : undefined;
}

