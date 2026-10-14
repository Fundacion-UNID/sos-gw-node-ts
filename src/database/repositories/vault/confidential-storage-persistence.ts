import { createHash } from 'node:crypto';
import type {
  ConfidentialBlobInfo,
  ConfidentialStorageDoc,
} from 'gdc-common-utils-ts/models/confidential-storage';
import {
  CONFIDENTIAL_JWE_BLOB_CONTENT_TYPE,
  hydrateConfidentialStorageDocFromPersistence,
  isConfidentialStorageDocRecord,
} from 'gdc-common-utils-ts';
import { stripUndefinedDeep } from 'gdc-common-utils-ts';
import type { IConfidentialBlobStore } from '../../storage/IConfidentialBlobStore';

const textEncoder = new TextEncoder();

/**
 * Default global inline threshold for serialized JWE payloads.
 *
 * Why this exists:
 * - keep small operational records inline in PostgreSQL/Firestore
 * - avoid unnecessary round-trips to external blob storage for lightweight
 *   data
 * - still externalize large encrypted payloads such as clinical bundles or
 *   attachment-heavy records
 */
export const DEFAULT_CONFIDENTIAL_JWE_INLINE_MAX_BYTES = 500 * 1024;

/**
 * Firestore-specific guardrail applied to the whole persisted document size.
 *
 * Why this is separate from the JWE threshold:
 * - Firestore has a hard 1 MiB document limit
 * - even a sub-threshold JWE can become risky when the record also carries
 *   large indexed attributes or metadata
 * - keeping a lower guardrail leaves safety margin under the Firestore limit
 */
export const DEFAULT_FIRESTORE_INLINE_DOCUMENT_MAX_BYTES = 768 * 1024;

export const CONFIDENTIAL_JWE_INLINE_MAX_BYTES_ENV = 'CONFIDENTIAL_JWE_INLINE_MAX_BYTES';
export const FIRESTORE_CONFIDENTIAL_DOC_INLINE_MAX_BYTES_ENV = 'FIRESTORE_CONFIDENTIAL_DOC_INLINE_MAX_BYTES';

/**
 * Extra blob metadata persisted locally by GW.
 *
 * The shared `ConfidentialBlobInfo` model currently does not carry size/hash
 * fields, but GW benefits from storing those values for diagnostics, integrity
 * checks, and future migrations. The runtime shape remains backward compatible
 * because existing readers only require `blobRef`.
 */
export type PersistedConfidentialBlobInfo = ConfidentialBlobInfo & {
  sizeBytes: number;
  sha256: string;
};

export type ExternalizeConfidentialStorageOptions = {
  /**
   * Maximum serialized JWE size that may remain inline in the persisted
   * document. If the JWE exceeds this size and blob storage is available, the
   * JWE is externalized.
   */
  inlineJweMaxBytes?: number;

  /**
   * Optional whole-document size guardrail. Intended mainly for Firestore,
   * where the final persisted record should stay comfortably below the 1 MiB
   * document limit even when the JWE itself is below the generic threshold.
   */
  inlineDocumentMaxBytes?: number;
};

function parsePositiveIntegerEnv(rawValue: string | undefined, fallback: number): number {
  const normalized = String(rawValue || '').trim();
  if (!normalized) return fallback;
  const parsed = Number.parseInt(normalized, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Resolves the global JWE inline threshold used across blob-capable
 * repositories.
 */
export function resolveConfidentialJweInlineMaxBytes(): number {
  return parsePositiveIntegerEnv(
    process.env[CONFIDENTIAL_JWE_INLINE_MAX_BYTES_ENV],
    DEFAULT_CONFIDENTIAL_JWE_INLINE_MAX_BYTES,
  );
}

/**
 * Resolves the Firestore-specific persisted document inline threshold.
 */
export function resolveFirestoreInlineDocumentMaxBytes(): number {
  return parsePositiveIntegerEnv(
    process.env[FIRESTORE_CONFIDENTIAL_DOC_INLINE_MAX_BYTES_ENV],
    DEFAULT_FIRESTORE_INLINE_DOCUMENT_MAX_BYTES,
  );
}

/**
 * Estimates the persisted JSON byte size of a record after undefined values are
 * stripped.
 */
export function estimatePersistedRecordSizeBytes(document: unknown): number {
  return textEncoder.encode(JSON.stringify(stripUndefinedDeep(document))).byteLength;
}

/**
 * Decides whether a confidential JWE should be externalized when blob storage
 * is available.
 *
 * Rules:
 * - no blob store or no JWE: keep inline
 * - JWE size above the global inline threshold: externalize
 * - persisted record size above the optional whole-document threshold:
 *   externalize
 */
export async function externalizeConfidentialStorageDocForPersistence<T>(
  document: T,
  blobWriter?: IConfidentialBlobStore,
  options?: ExternalizeConfidentialStorageOptions,
): Promise<T> {
  if (!blobWriter || !isConfidentialStorageDocRecord(document) || !document.jwe) {
    return stripUndefinedDeep(document);
  }

  const sanitizedInlineDocument = stripUndefinedDeep(document) as T;
  const jweBytes = textEncoder.encode(JSON.stringify(document.jwe));
  const inlineJweMaxBytes = options?.inlineJweMaxBytes ?? resolveConfidentialJweInlineMaxBytes();
  const inlineDocumentMaxBytes = options?.inlineDocumentMaxBytes;
  const inlineDocumentSizeBytes = estimatePersistedRecordSizeBytes(sanitizedInlineDocument);

  if (jweBytes.byteLength <= inlineJweMaxBytes
    && (inlineDocumentMaxBytes === undefined || inlineDocumentSizeBytes <= inlineDocumentMaxBytes)) {
    return sanitizedInlineDocument;
  }

  const blob = await blobWriter.put(jweBytes, CONFIDENTIAL_JWE_BLOB_CONTENT_TYPE);
  const persistedBlob: PersistedConfidentialBlobInfo = {
    provider: blobWriter.provider,
    blobRef: blob.blobRef,
    locator: blob.locator,
    contentType: blob.contentType || CONFIDENTIAL_JWE_BLOB_CONTENT_TYPE,
    sizeBytes: jweBytes.byteLength,
    sha256: createHash('sha256').update(jweBytes).digest('hex'),
  };
  const persistedDocument: ConfidentialStorageDoc = {
    ...(document as ConfidentialStorageDoc),
    blob: persistedBlob as ConfidentialBlobInfo,
  };
  delete persistedDocument.jwe;
  return stripUndefinedDeep(persistedDocument) as T;
}

export {
  CONFIDENTIAL_JWE_BLOB_CONTENT_TYPE,
  hydrateConfidentialStorageDocFromPersistence,
  isConfidentialStorageDocRecord,
};
