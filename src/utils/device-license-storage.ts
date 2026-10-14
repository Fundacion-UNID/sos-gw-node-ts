import type { DeviceLicense } from 'gdc-common-utils-ts/models/device-license';
import type { ConfidentialStorageDoc } from 'gdc-common-utils-ts/models/confidential-storage';
import type { IKmsService } from '../gdc-backend-utils-node/models/IKmsService';
import type { IVaultRepository } from '../database/repositories/vault/vault.repository';

export type OpenedDeviceLicenseDocument = Readonly<{
  document: ConfidentialStorageDoc;
  license: DeviceLicense & Record<string, any>;
}>;

export async function openDeviceLicenseDocument(
  document: ConfidentialStorageDoc,
  vaultId: string,
  kmsService?: IKmsService,
): Promise<OpenedDeviceLicenseDocument> {
  const inline = document?.content;
  if (inline && typeof inline === 'object') {
    return { document, license: inline as DeviceLicense & Record<string, any> };
  }
  if (!document?.jwe || !kmsService?.unprotectConfidentialData) {
    throw new Error('Device license record has no readable content.');
  }
  const license = await kmsService.unprotectConfidentialData<DeviceLicense & Record<string, any>>(
    document,
    vaultId,
  );
  if (!license || typeof license !== 'object') {
    throw new Error('Device license protected content is invalid.');
  }
  return { document, license };
}

/** Resolves an indexed activation credential and opens protected seat content before manager validation. */
export async function findDeviceLicensesByActivationCode(input: Readonly<{
  activationCode: string;
  vaultId: string;
  sectionId: string;
  vaultRepository: IVaultRepository;
  kmsService?: IKmsService;
}>): Promise<OpenedDeviceLicenseDocument[]> {
  let indexedMatches: ConfidentialStorageDoc[] = [];
  if (input.kmsService?.getHmacBase64Url) {
    const protectedName = await input.kmsService.getHmacBase64Url('activationCode', input.vaultId);
    const protectedValue = await input.kmsService.getHmacBase64Url(input.activationCode, input.vaultId);
    if (protectedName && protectedValue) {
      try {
        indexedMatches = await input.vaultRepository.query(input.vaultId, {
          sectionId: input.sectionId,
          where: [{ name: protectedName, value: protectedValue }],
        }) as ConfidentialStorageDoc[];
      } catch {
        indexedMatches = [];
      }
    }
  }
  if (indexedMatches.length > 0) {
    return Promise.all(indexedMatches.map(document => openDeviceLicenseDocument(
      document,
      input.vaultId,
      input.kmsService,
    )));
  }

  const all = await input.vaultRepository.getContainersInSection<ConfidentialStorageDoc>(
    input.vaultId,
    input.sectionId,
  );
  const matches: OpenedDeviceLicenseDocument[] = [];
  for (const document of all) {
    try {
      const opened = await openDeviceLicenseDocument(document, input.vaultId, input.kmsService);
      if (opened.license.activationCode === input.activationCode) matches.push(opened);
    } catch {
      // A malformed unrelated record must not prevent the fallback scan from
      // finding the exact indexed credential in another document.
    }
  }
  return matches;
}

/** Preserves the original at-rest boundary when writing a mutated device licence. */
export async function prepareDeviceLicenseDocumentForWrite(input: Readonly<{
  document: ConfidentialStorageDoc;
  license: DeviceLicense & Record<string, any>;
  vaultId: string;
  kmsService?: IKmsService;
}>): Promise<ConfidentialStorageDoc> {
  const wasProtected = Boolean(input.document.jwe || input.document.blob);
  const { content: _content, jwe: _jwe, blob: _blob, ...metadata } = input.document;
  const updated = { ...metadata, content: input.license } as ConfidentialStorageDoc;
  if (!wasProtected) return updated;
  if (!input.kmsService?.protectConfidentialData) {
    throw new Error('Device license KMS protection is required for this record.');
  }
  return input.kmsService.protectConfidentialData(updated, input.vaultId);
}
