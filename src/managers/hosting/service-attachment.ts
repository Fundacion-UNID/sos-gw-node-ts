import { createHash } from 'crypto';
import type { IncludedResource } from 'gdc-common-utils-ts/models/jsonapi';
import { ClaimsServiceSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { IssueType } from 'gdc-common-utils-ts/models/issue';
import { ManagerError } from 'gdc-common-utils-ts/utils/manager-error';
import { buildPdfSignatureEvidence } from '../../utils/pdf-evidence';

type HandleServiceAttachmentDeps = Readonly<{
  service?: IncludedResource;
  logger?: { warn?: (...args: any[]) => void };
  storageAdapter: {
    upload: (content: Buffer, contentType: string) => Promise<
      | { publicUrl: string; encodedMultiHash: string }
      | undefined
    >;
  };
}>;

/**
 * Normalizes an attached service terms document into hosted storage URLs and
 * extracts best-effort PDF signature evidence when possible.
 *
 * Why this lives outside `HostingManager`:
 * - upload/evidence enrichment is reusable from multiple host onboarding flows
 * - the manager should orchestrate, not parse `data:` payloads or inspect PDF
 *   byte ranges directly
 */
export async function handleServiceAttachment(
  deps: HandleServiceAttachmentDeps,
): Promise<IncludedResource | undefined> {
  const { service } = deps;
  if (!service) return undefined;
  const claims = service.meta?.claims as Record<string, unknown> | undefined;
  if (!claims) return service;
  const termsRaw = claims[ClaimsServiceSchemaorg.termsOfService];
  if (typeof termsRaw !== 'string') return service;
  let termsOfService = termsRaw as string | undefined;

  if (termsOfService && !termsOfService.startsWith('http')) {
    try {
      if (termsOfService.startsWith('data:')) {
        const parts = termsOfService.split(',');
        if (parts.length !== 2) throw new Error('Malformed data URL.');
        termsOfService = parts[1];
      }
      const pdfBytes = Buffer.from(termsOfService, 'base64');
      const serviceMeta = service.meta as any;
      const verification = serviceMeta.verification || {};
      const evidenceList = Array.isArray(verification.evidence) ? verification.evidence : [];

      try {
        if (pdfBytes.includes(Buffer.from('/ByteRange'))) {
          const { evidence } = buildPdfSignatureEvidence(pdfBytes, 'sha256');
          evidenceList.push(evidence);
        }
      } catch (error) {
        deps.logger?.warn?.(`[HostingManager] Skipping PDF signature evidence: ${(error as Error).message}`);
      }

      serviceMeta.verification = { ...verification, evidence: evidenceList };
      const uploadResult = await deps.storageAdapter.upload(pdfBytes, 'application/pdf');
      if (!uploadResult) throw new Error('Storage adapter returned undefined result.');
      const { publicUrl } = uploadResult;
      service.meta!.claims[ClaimsServiceSchemaorg.termsOfService] = publicUrl;
      (service.meta!.claims as any)[`${ClaimsServiceSchemaorg.termsOfService}#hash`] = createHash('sha256')
        .update(pdfBytes)
        .digest('hex');
    } catch (error) {
      throw new ManagerError(`Error processing service attachment: ${(error as Error).message}`, IssueType.Invalid);
    }
  }
  return service;
}
