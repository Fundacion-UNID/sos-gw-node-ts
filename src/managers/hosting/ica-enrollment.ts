import { v4 as uuidv4 } from 'uuid';
import { EntityLifecycleStatus } from '../../gdc-backend-utils-node/models/enums';
import { ConfidentialStorageDoc } from 'gdc-common-utils-ts/models/confidential-storage';
import { ClaimsRecord } from 'gdc-common-utils-ts/models/resource-document';
import { IssueType } from 'gdc-common-utils-ts/models/issue';
import { ManagerError } from 'gdc-common-utils-ts/utils/manager-error';
import { PdfSignatureEvidence } from '../../utils/pdf-evidence';
import { getEnvSectionId } from '../../utils/section-env';
import { slugFromDomain } from '../../utils/slug';

type RequestIcaEnrollmentDeps = Readonly<{
  organizationClaims: ClaimsRecord;
  evidence?: PdfSignatureEvidence[];
  tenantVaultId: string;
  config: any;
  logger: any;
  vaultRepository: any;
  kmsService: any;
  fetchImpl?: typeof fetch;
}>;

type PollIcaResultDeps = Readonly<{
  url: string;
  fetchImpl?: typeof fetch;
  delayMs?: number;
  attempts?: number;
}>;

/**
 * Executes the transitional ICA enrollment placeholder used by host bootstrap.
 *
 * Contract notes:
 * - this is not the final authority for accreditation
 * - successful async results are persisted as `IcaEnrollResponse-v1.0`
 * - callers should treat failures as warnings, not bootstrap blockers
 */
export async function requestIcaEnrollment(deps: RequestIcaEnrollmentDeps): Promise<void> {
  const icaDomain = process.env.ICA_EXTERNAL_DOMAIN;
  const icaSlug = slugFromDomain(icaDomain);
  if (!icaSlug) {
    return;
  }

  const fetchImpl = deps.fetchImpl || fetch;
  const jurisdiction = String(deps.config.host.jurisdiction || '').trim().toLowerCase();
  if (!jurisdiction) {
    throw new ManagerError('Host jurisdiction is missing from server configuration.', IssueType.Required);
  }
  const baseUrl = icaDomain ? `https://${icaDomain}` : deps.config.apiBaseUrl;
  const url = `${baseUrl}/${icaSlug}/cds-${jurisdiction}/v1/system/test-network/ica/csr/_enroll`;

  const payload = {
    csr: 'DEMO-CSR',
    organization: deps.organizationClaims,
    evidence: deps.evidence,
    metadata: { environment: 'test-network' },
  };

  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer demo' },
      body: JSON.stringify(payload),
    });
    const location = res.headers.get('location') || res.headers.get('Location') || '';
    let resultResource: any | undefined;

    if (res.ok) {
      const data = await res.json().catch(() => undefined);
      resultResource = data?.data?.[0]?.resource;
    } else if (res.status === 202 && location) {
      resultResource = await pollIcaResult({ url: location, fetchImpl });
    } else {
      const text = await res.text();
      deps.logger.warn?.(`[HostingManager] ICA enroll request failed: ${res.status} ${text}`);
    }

    if (resultResource) {
      await storeIcaMessage({
        tenantVaultId: deps.tenantVaultId,
        resultResource,
        kmsService: deps.kmsService,
        vaultRepository: deps.vaultRepository,
      });
    }
  } catch (error: any) {
    deps.logger.warn?.(`[HostingManager] ICA enroll request failed: ${String(error?.message || error)}`);
  }
}

/**
 * Polls the async ICA placeholder endpoint until it returns the final resource
 * or the bounded retry window is exhausted.
 */
export async function pollIcaResult(deps: PollIcaResultDeps): Promise<any | undefined> {
  const attempts = deps.attempts ?? 5;
  const delayMs = deps.delayMs ?? 2000;
  const fetchImpl = deps.fetchImpl || fetch;
  for (let i = 0; i < attempts; i++) {
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    const res = await fetchImpl(deps.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer demo' },
    });
    if (res.status === 202) {
      continue;
    }
    if (!res.ok) {
      return undefined;
    }
    const data = await res.json().catch(() => undefined);
    return data?.data?.[0]?.resource;
  }
  return undefined;
}

/**
 * Stores the ICA enrollment response in the tenant messaging section so later
 * diagnostics can reconstruct the placeholder bootstrap exchange.
 */
export async function storeIcaMessage(input: {
  tenantVaultId: string;
  resultResource: any;
  kmsService: any;
  vaultRepository: any;
}): Promise<void> {
  const message = {
    type: 'IcaEnrollResponse-v1.0',
    id: input.resultResource?.id || `urn:uuid:${uuidv4()}`,
    resource: input.resultResource,
  };

  const doc: ConfidentialStorageDoc = {
    id: message.id,
    status: EntityLifecycleStatus.Active,
    sequence: 0,
    content: message,
  };
  const secureDoc = await input.kmsService.protectConfidentialData(doc, input.tenantVaultId);
  await input.vaultRepository.put(input.tenantVaultId, [secureDoc], getEnvSectionId('messaging'));
}
