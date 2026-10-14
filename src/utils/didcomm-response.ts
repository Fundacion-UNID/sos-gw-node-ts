import { randomUUID } from 'crypto';
import type { JobRequest } from 'gdc-common-utils-ts/models/confidential-job';
import type { IDecodedDidcommPayload } from 'gdc-common-utils-ts/models/confidential-message';
import type { BundleEntryResponse, BundleJsonApi } from 'gdc-common-utils-ts/models/bundle';
import { ResourceTypesFhirR4 } from 'gdc-common-utils-ts/constants/index';
import { ExampleHttpStatusText } from 'gdc-common-utils-ts';
import { GatewayEnvelopeTypes } from '../shared/gateway-response-types';
import { BundleType } from './bundle';

/** Deployment profiles for the rolling search-response migration. */
export const SearchResponseProfiles = Object.freeze({
  /** @deprecated Nested aggregate retained only for older SDK readers. */
  LegacyResourceData: 'legacy-resource-data',
  PrimaryResource: 'primary-resource',
} as const);

export type SearchResponseProfile =
  typeof SearchResponseProfiles[keyof typeof SearchResponseProfiles];

/** Governed environment variable that selects search-result serialization. */
export const SearchResponseProfileEnvironment = Object.freeze({
  Variable: 'GW_SEARCH_RESPONSE_PROFILE',
} as const);

/** Resolves the profile; absence preserves deprecated output during rollout. */
export function resolveSearchResponseProfile(
  env: Readonly<Record<string, string | undefined>> = process.env,
): SearchResponseProfile {
  return env[SearchResponseProfileEnvironment.Variable] === SearchResponseProfiles.PrimaryResource
    ? SearchResponseProfiles.PrimaryResource
    : SearchResponseProfiles.LegacyResourceData;
}

/** Builds one primary Bundle entry per match or the deprecated aggregate. */
export function buildSearchResponseEntries(
  responseType: string,
  matches: ReadonlyArray<Record<string, any>>,
  profile: SearchResponseProfile = resolveSearchResponseProfile(),
  legacyResourceMetadata: Readonly<Record<string, unknown>> = {},
): BundleEntryResponse[] {
  if (profile === SearchResponseProfiles.PrimaryResource) {
    return matches.map(resource => ({
      type: responseType,
      resource,
      response: { status: ExampleHttpStatusText.Ok },
    }));
  }
  return [{
    type: responseType,
    // Deprecated response-only compatibility. Never use as a FHIR resource.
    resource: { ...legacyResourceMetadata, total: matches.length, data: matches } as any,
    response: { status: ExampleHttpStatusText.Ok },
  }];
}

export function buildTransactionResponse(job: JobRequest, body: BundleJsonApi): IDecodedDidcommPayload {
  return {
    jti: randomUUID(),
    type: GatewayEnvelopeTypes.TransactionResponse,
    thid: job.content?.thid as string,
    iss: job.content?.aud as string,
    aud: job.content?.iss as string,
    body,
  };
}

export function buildSearchMatchesResponse(
  job: JobRequest,
  responseType: string,
  matches: any[],
): IDecodedDidcommPayload {
  const data = buildSearchResponseEntries(responseType, matches);
  return buildTransactionResponse(job, {
    resourceType: ResourceTypesFhirR4.Bundle,
    type: BundleType.BatchResponse,
    data,
    total: data.length,
  });
}
