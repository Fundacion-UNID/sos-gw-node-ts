import type { JobRequest } from 'gdc-common-utils-ts/models/confidential-job';
import type { IDecodedDidcommPayload } from 'gdc-common-utils-ts/models/confidential-message';
import { CommunicationManager } from '../../managers/CommunicationManager';
import type { IJobProcessor } from '../../managers/registry';
import { getAuthenticatedJobActorDid } from '../../utils/authenticated-job-actor';
import { getTenantVaultId } from '../../utils/tenant';
import {
  buildUhcRepresentedClinicalRepository,
  readUhcRepresentedClinicalProvenance,
} from './represented-clinical-provenance';

type CommunicationManagerOptions = ConstructorParameters<typeof CommunicationManager>[0];

/**
 * Builds the UHC Communication adapter without changing the frozen manager.
 * A represented write receives a request-local creator-binding view derived
 * from its signed flat claims and the target binding issued during OpenID.
 */
export function buildUhcCommunicationManager(
  options: CommunicationManagerOptions,
): IJobProcessor {
  const defaultManager = new CommunicationManager(options);
  return {
    async process(job: JobRequest): Promise<IDecodedDidcommPayload> {
      const provenance = readUhcRepresentedClinicalProvenance(job);
      const registeredActorDid = getAuthenticatedJobActorDid(job);
      if (!provenance || !registeredActorDid || !job.sector || !job.tenantId) {
        return defaultManager.process(job);
      }
      const tenantVaultId = getTenantVaultId(job.sector, job.tenantId);
      const scopedRepository = await buildUhcRepresentedClinicalRepository({
        repository: options.vaultRepository,
        tenantVaultId,
        registeredActorDid,
        provenance,
      });
      if (scopedRepository === options.vaultRepository) return defaultManager.process(job);
      return new CommunicationManager({
        ...options,
        vaultRepository: scopedRepository,
      }).process(job);
    },
  };
}
