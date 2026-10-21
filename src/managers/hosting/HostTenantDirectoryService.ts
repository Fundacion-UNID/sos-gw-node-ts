import { v4 as uuidv4 } from 'uuid';
import { ClaimsOrganizationSchemaorg, ClaimsServiceSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { ResourceTypesFhirR4 } from 'gdc-common-utils-ts/constants/fhir-resource-types';
import { ManagerError } from 'gdc-common-utils-ts/utils/manager-error';
import { IssueType } from 'gdc-common-utils-ts/models/issue';
import type { JobRequest } from 'gdc-common-utils-ts/models/confidential-job';
import type { IHostingTenantRegistry } from '../IHostingTenantRegistry';
import { GatewayClaim } from '../../shared/gateway-claim-contract';
import { getTenantAuthorizationStatus } from '../../utils/tenant-lifecycle';
import { resolveOrganizationRouteJurisdiction } from '../../utils/tenant';

type DirectoryOptions = Readonly<{
  hostAdminUid?: string;
  hostDid: string;
  defaultPageSize?: number;
  maximumPageSize?: number;
}>;

type TenantSummary = Readonly<{
  sortKey: string;
  id: string;
  claims: Readonly<Record<string, unknown>>;
}>;

const DEFAULT_PAGE_SIZE = 25;
const MAXIMUM_PAGE_SIZE = 100;

function normalized(value: unknown): string {
  return String(value || '').trim();
}

function encodeCursor(sortKey: string): string {
  return Buffer.from(JSON.stringify({ after: sortKey }), 'utf8').toString('base64url');
}

function decodeCursor(value: unknown): string | undefined {
  const cursor = normalized(value);
  if (!cursor) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as Record<string, unknown>;
    const after = normalized(parsed.after);
    if (!after || Object.keys(parsed).length !== 1) throw new Error('invalid cursor');
    return after;
  } catch {
    throw new ManagerError('Host organization directory cursor is invalid.', IssueType.Invalid);
  }
}

/**
 * Host-only, read-only projection of the protected tenant registry.
 *
 * The verified bearer is propagated into the DIDComm job by the API boundary.
 * This manager compares its subject with the configured host bootstrap
 * administrator and never accepts host authority from request claims.
 */
export class HostTenantDirectoryService {
  private readonly defaultPageSize: number;
  private readonly maximumPageSize: number;

  constructor(
    private readonly registry: Pick<IHostingTenantRegistry, 'listRegisteredTenants'>,
    private readonly options: DirectoryOptions,
  ) {
    this.defaultPageSize = options.defaultPageSize ?? DEFAULT_PAGE_SIZE;
    this.maximumPageSize = options.maximumPageSize ?? MAXIMUM_PAGE_SIZE;
  }

  async search(job: JobRequest): Promise<any> {
    this.assertHostOperator(job);
    const body = job.content?.body as any;
    const requestEntry = Array.isArray(body?.data) ? body.data[0] : undefined;
    const filters = requestEntry?.resource?.meta?.claims as Record<string, unknown> | undefined;
    const pagination = body?.meta?.pagination as Record<string, unknown> | undefined;
    const pageSize = this.readPageSize(pagination?.pageSize);
    const after = decodeCursor(pagination?.cursor);

    const summaries = (await this.registry.listRegisteredTenants())
      .map(tenant => this.toSummary(tenant))
      .filter((summary): summary is TenantSummary => Boolean(summary))
      .filter(summary => this.matches(summary, filters || {}))
      .sort((left, right) => left.sortKey.localeCompare(right.sortKey));

    let start = 0;
    if (after) {
      const cursorIndex = summaries.findIndex(summary => summary.sortKey === after);
      if (cursorIndex < 0) throw new ManagerError('Host organization directory cursor is no longer valid.', IssueType.Invalid);
      start = cursorIndex + 1;
    }
    const page = summaries.slice(start, start + pageSize);
    const hasNext = start + page.length < summaries.length;
    const nextCursor = hasNext && page.length > 0 ? encodeCursor(page[page.length - 1].sortKey) : undefined;

    return {
      jti: uuidv4(),
      type: 'hosting-response',
      thid: job.content?.thid,
      iss: this.options.hostDid,
      aud: job.content?.iss,
      exp: Math.floor(Date.now() / 1000) + 300,
      body: {
        resourceType: ResourceTypesFhirR4.Bundle,
        type: 'searchset',
        total: summaries.length,
        data: page.map(summary => ({
          id: summary.id,
          type: 'Organization-search-response-v1.0',
          resource: {
            resourceType: ResourceTypesFhirR4.Organization,
            id: summary.id,
            meta: { claims: summary.claims },
          },
          response: { status: '200' },
        })),
        meta: {
          pagination: {
            pageSize,
            returned: page.length,
            hasNext,
            ...(nextCursor ? { nextCursor } : {}),
          },
        },
      },
    };
  }

  private assertHostOperator(job: JobRequest): void {
    const configuredUid = normalized(this.options.hostAdminUid);
    const bearerPayload = (job.content as any)?.meta?.bearer?.jwt?.payload as Record<string, unknown> | undefined;
    const bearerSubject = normalized(bearerPayload?.sub);
    if (!configuredUid || !bearerSubject || bearerSubject !== configuredUid) {
      throw new ManagerError('Host organization directory requires the configured host operator.', IssueType.Forbidden);
    }
  }

  private readPageSize(value: unknown): number {
    if (value === undefined || value === null || value === '') return this.defaultPageSize;
    const pageSize = Number(value);
    if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > this.maximumPageSize) {
      throw new ManagerError(`Host organization directory page size must be between 1 and ${this.maximumPageSize}.`, IssueType.Invalid);
    }
    return pageSize;
  }

  private toSummary(tenant: any): TenantSummary | undefined {
    const claims = tenant?.claims as Record<string, unknown> | undefined;
    if (!claims) return undefined;
    if (normalized(claims[ClaimsOrganizationSchemaorg.alternateName]).toLowerCase() === 'host') return undefined;
    const identifierType = normalized(claims[ClaimsOrganizationSchemaorg.identifierType]);
    const identifierValue = normalized(claims[ClaimsOrganizationSchemaorg.identifierValue]);
    if (!identifierValue) return undefined;
    const legalName = normalized(claims[ClaimsOrganizationSchemaorg.legalName]);
    const name = normalized(claims[ClaimsOrganizationSchemaorg.name]);
    const jurisdiction = resolveOrganizationRouteJurisdiction(claims);
    const sector = normalized(
      tenant?.provider?.service?.sectorCategory
      || claims[ClaimsServiceSchemaorg.category],
    );
    const authorizationStatus = getTenantAuthorizationStatus(tenant);
    const did = normalized(tenant?.didDocument?.id);
    const id = normalized(tenant?.id) || identifierValue;
    const projectedClaims: Record<string, unknown> = {
      [ClaimsOrganizationSchemaorg.identifierType]: identifierType,
      [ClaimsOrganizationSchemaorg.identifierValue]: identifierValue,
      [ClaimsOrganizationSchemaorg.legalName]: legalName,
      [ClaimsOrganizationSchemaorg.name]: name || legalName,
      [ClaimsOrganizationSchemaorg.addressCountry]: jurisdiction,
      [ClaimsServiceSchemaorg.category]: sector,
      [GatewayClaim.TenantAuthorizationStatus]: authorizationStatus,
    };
    if (did) projectedClaims[ClaimsOrganizationSchemaorg.sameAs] = did;
    return {
      id,
      sortKey: [identifierValue.toLowerCase(), sector.toLowerCase(), did.toLowerCase()].join('\u0000'),
      claims: Object.freeze(projectedClaims),
    };
  }

  private matches(summary: TenantSummary, filters: Record<string, unknown>): boolean {
    const supportedFilters = [
      ClaimsOrganizationSchemaorg.addressCountry,
      ClaimsServiceSchemaorg.category,
      GatewayClaim.TenantAuthorizationStatus,
      ClaimsOrganizationSchemaorg.identifierType,
      ClaimsOrganizationSchemaorg.identifierValue,
    ];
    return supportedFilters.every(name => {
      const expected = normalized(filters[name]).toLowerCase();
      if (!expected) return true;
      return normalized(summary.claims[name]).toLowerCase() === expected;
    });
  }
}
