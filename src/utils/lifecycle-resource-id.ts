import { IssueType } from 'gdc-common-utils-ts/models/issue';
import { ManagerError } from 'gdc-common-utils-ts/utils/manager-error';

/**
 * Requires one concrete lifecycle target and rejects collection-wide selectors.
 *
 * Bulk management is expressed as a bounded Bundle containing multiple
 * explicit entries. Search pagination, chunking and retry belong to the
 * caller; a GW manager never expands `*` or another glob into stored records.
 */
export function requireExplicitLifecycleResourceId(value: unknown, operation: string): string {
  const resourceId = String(value || '').trim();
  if (!resourceId || resourceId.includes('*') || resourceId.includes('?')) {
    throw new ManagerError(
      `${operation} requires an explicit resource.id; wildcard identifiers are not allowed.`,
      IssueType.Required,
    );
  }
  return resourceId;
}
