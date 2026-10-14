/**
 * Result of storing an opaque confidential payload in a blob backend.
 */
export interface PutConfidentialBlobResult {
  /**
   * Canonical identifier that the application will later use to read the blob back.
   */
  blobRef: string;

  /**
   * Optional provider-specific locator kept for diagnostics and migrations.
   */
  locator?: string;

  /**
   * MIME type associated with the stored blob.
   */
  contentType?: string;
}

/**
 * Raw payload read from a confidential blob backend.
 */
export interface ConfidentialBlobPayload {
  dataBytes: Uint8Array;
  contentType?: string;
}

/**
 * Minimal contract required to externalize serialized JWE payloads.
 *
 * The vault repositories use this interface to keep encrypted payloads out of
 * index-oriented databases such as Firestore and PostgreSQL.
 */
export interface IConfidentialBlobStore {
  /**
   * Human-readable provider label persisted in `ConfidentialStorageDoc.blob.provider`.
   */
  readonly provider: string;

  /**
   * Stores an opaque payload and returns the canonical pointer needed to read it back.
   */
  put(dataBytes: Uint8Array, contentType: string): Promise<PutConfidentialBlobResult>;

  /**
   * Reads a previously stored payload using the canonical blob reference.
   */
  get(blobRef: string): Promise<ConfidentialBlobPayload>;

  /**
   * Removes a previously stored payload during destructive purge flows.
   */
  delete?(blobRef: string): Promise<void>;
}
