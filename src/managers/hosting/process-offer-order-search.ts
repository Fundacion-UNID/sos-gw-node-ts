import { ResourceTypesFhirR4 } from 'gdc-common-utils-ts/constants/fhir-resource-types';
import { v4 as uuidv4 } from 'uuid';
import type { BundleEntry, ErrorEntry } from 'gdc-common-utils-ts/models/bundle';
import type { JobRequest } from 'gdc-common-utils-ts/models/confidential-job';
import type { IDecodedDidcommPayload } from 'gdc-common-utils-ts/models/confidential-message';
import { getBundleResponseTypeForAction } from '../../utils/bundle';

type ProcessOfferOrderSearchDeps = Readonly<{
  job: JobRequest;
  issuerDid: string;
  handleError: (error: any, entryType?: string, meta?: any) => ErrorEntry;
  processOfferSearchEntry: (job: JobRequest, entry: BundleEntry) => Promise<BundleEntry[]>;
  processOrderSearchEntry: (job: JobRequest, entry: BundleEntry) => Promise<BundleEntry[]>;
}>;

export async function processOfferOrderSearch(
  deps: ProcessOfferOrderSearchDeps,
): Promise<IDecodedDidcommPayload> {
  const jobEntries = deps.job?.content?.body?.data || [];
  const responseEntries: (BundleEntry | ErrorEntry)[] = [];

  for (const entry of jobEntries) {
    try {
      const entries = deps.job.resourceType === 'Offer'
        ? await deps.processOfferSearchEntry(deps.job, entry)
        : await deps.processOrderSearchEntry(deps.job, entry);
      responseEntries.push(...entries);
    } catch (error) {
      responseEntries.push(deps.handleError(error, entry?.type || `${deps.job.resourceType}-search`, entry?.meta));
    }
  }

  return {
    jti: uuidv4(),
    type: 'hosting-response',
    thid: deps.job.content?.thid as string,
    iss: deps.issuerDid,
    aud: deps.job.content?.iss as string,
    exp: Math.floor(Date.now() / 1000) + 300,
    body: {
      data: responseEntries,
      resourceType: ResourceTypesFhirR4.Bundle,
      type: getBundleResponseTypeForAction(deps.job.action),
      total: responseEntries.length,
    },
  };
}
