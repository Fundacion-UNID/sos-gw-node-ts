// pdf-signature-verification.ts
// Reusable PDF signature verification manager and types (inspired by dataspace-ica-ts)

export interface PdfVerifySubmission {
  pdfBytes: Buffer;
  contentType: string;
  // Optionally: metadata, patientId, etc.
}

export interface PdfVerifyResult {
  ok: boolean;
  signer?: string;
  signingTime?: string;
  notes?: string[];
  // Optionally: extracted claims, credential, etc.
}

export interface PdfSignatureVerifierAdapter {
  id: string;
  supports(submission: PdfVerifySubmission): boolean | Promise<boolean>;
  verify(submission: PdfVerifySubmission): Promise<PdfVerifyResult>;
}

export interface PdfSignatureVerificationManagerOptions {
  preferredAdapterId?: string;
  strictPreferredAdapter?: boolean;
}

export class PdfSignatureVerificationManager {
  private readonly adapters: readonly PdfSignatureVerifierAdapter[];
  private readonly preferredAdapterId?: string;
  private readonly strictPreferredAdapter: boolean;

  constructor(
    adapters: readonly PdfSignatureVerifierAdapter[],
    options: PdfSignatureVerificationManagerOptions = {},
  ) {
    this.adapters = adapters;
    this.preferredAdapterId = options.preferredAdapterId?.trim().toLowerCase() || undefined;
    this.strictPreferredAdapter = options.strictPreferredAdapter ?? false;
  }

  private findById(id: string): PdfSignatureVerifierAdapter | undefined {
    return this.adapters.find((adapter) => adapter.id.trim().toLowerCase() === id.trim().toLowerCase());
  }

  async verify(submission: PdfVerifySubmission): Promise<PdfVerifyResult> {
    if (!this.adapters.length) {
      throw new Error('No PDF signature verification adapters are registered.');
    }
    if (this.preferredAdapterId) {
      const preferred = this.findById(this.preferredAdapterId);
      if (!preferred) {
        throw new Error(`Preferred PDF signature verifier adapter "${this.preferredAdapterId}" is not registered.`);
      }
      if (await preferred.supports(submission)) {
        return preferred.verify(submission);
      }
      if (this.strictPreferredAdapter) {
        throw new Error(
          `Preferred PDF signature verifier adapter "${this.preferredAdapterId}" does not support this submission.`,
        );
      }
    }
    for (const adapter of this.adapters) {
      if (await adapter.supports(submission)) {
        return adapter.verify(submission);
      }
    }
    throw new Error('No PDF signature verifier adapter supports this submission.');
  }
}

// Example: Basic adapter for demo/testing (replace with real logic or external service)
export class BasicPdfSignatureVerifierAdapter implements PdfSignatureVerifierAdapter {
  public readonly id = 'basic-demo';
  supports(_submission: PdfVerifySubmission): boolean {
    return true;
  }
  async verify(submission: PdfVerifySubmission): Promise<PdfVerifyResult> {
    // Simulate: always returns ok, with dummy signer and time
    return {
      ok: true,
      signer: 'did:example:person123',
      signingTime: new Date().toISOString(),
      notes: ['Demo adapter: signature not actually verified'],
    };
  }
}
