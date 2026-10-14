import { IncludedResource } from 'gdc-common-utils-ts/models/jsonapi';
import { ClaimsRecord } from 'gdc-common-utils-ts/models/resource-document';
import { IssueType } from 'gdc-common-utils-ts/models/issue';
import { ManagerError } from 'gdc-common-utils-ts/utils/manager-error';
import { determineResourceId } from '../../utils/resource';
import { PdfSignatureEvidence } from '../../utils/pdf-evidence';

type ExtractedHostResources = Readonly<{
  organization: IncludedResource;
  person?: IncludedResource;
  service: IncludedResource;
}>;

/**
 * Extracts the minimal onboarding resources projected from claim bundles.
 *
 * Required contract:
 * - legal organizations must provide `Organization`, `Person`, and `Service`
 * - individual organizations may omit `Person` when either owner email or
 *   owner telephone identifies the authenticated controller
 * - every returned resource keeps its own type-scoped `meta.claims`
 *
 * Why this lives outside `HostingManager`:
 * - `_transaction`, `_activate`, bootstrap, and lifecycle helpers all need the
 *   same deterministic projection from flat claims into JSON:API resources
 * - tests must be able to hit this plumbing without dragging the whole manager
 */
export function extractResourcesFromClaims(
  claims: ClaimsRecord,
  environment?: string,
): ExtractedHostResources {
  const resourceTypes = ['Organization', 'Person', 'Service'] as const;
  const resources: Record<string, IncludedResource> = {};

  for (const type of resourceTypes) {
    const resourceClaims: Record<string, any> = { '@type': type };
    let claimFound = false;
    for (const key in claims) {
      if (key.startsWith(`org.schema.${type}.`)) {
        resourceClaims[key] = claims[key];
        claimFound = true;
      }
    }
    if (!claimFound) {
      continue;
    }

    const identifierClaim = resourceClaims[`org.schema.${type}.identifier`];
    const resourceId = determineResourceId(identifierClaim, environment);
    resources[type.toLowerCase()] = {
      id: resourceId,
      type,
      meta: { claims: resourceClaims },
    } as IncludedResource;
  }

  const isIndividualOrg = !!(
    claims['org.schema.Organization.owner.telephone']
    || claims['org.schema.Organization.owner.email']
  );
  if (!resources.organization || !resources.service || (!resources.person && !isIndividualOrg)) {
    throw new ManagerError(
      'Incomplete claims: Organization and Service are required. Person is required for legal orgs, but not for individual orgs.',
      IssueType.Required,
    );
  }

  return {
    organization: resources.organization,
    ...(resources.person ? { person: resources.person } : {}),
    service: resources.service,
  };
}

/**
 * Reads the first embedded `Service` resource from a contained array.
 *
 * This helper stays intentionally dumb so multiple onboarding flows can reuse
 * the same extraction without re-implementing resource scanning.
 */
export function extractContainedServiceResource(
  contained?: Array<IncludedResource | undefined> | undefined,
): IncludedResource | undefined {
  if (!contained || !Array.isArray(contained)) {
    return undefined;
  }
  return contained.find((resource) => resource?.type === 'Service');
}

/**
 * Normalizes service verification evidence to an array so downstream ledger/ICA
 * plumbing can treat single and repeated evidence uniformly.
 */
export function extractServiceEvidenceList(
  service?: IncludedResource,
): PdfSignatureEvidence[] | undefined {
  if (!service) {
    return undefined;
  }
  const verification = (service.meta as any)?.verification;
  const evidence = verification?.evidence;
  if (!evidence) {
    return undefined;
  }
  return Array.isArray(evidence) ? evidence : [evidence];
}
