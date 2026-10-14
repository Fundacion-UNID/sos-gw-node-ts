// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/utils/pdf-evidence.ts

import crypto from 'crypto';
import forge from 'node-forge';
import { Buffer } from 'buffer';
import { VerifyPdf } from './verifyPdf.class.js';

type PdfEvidenceHashes = {
  hashAlg: string;
  unsignedPdfHashB64Url: string;
  signedPdfHashB64Url: string;
};

export type PdfSignatureEvidence = {
  type: 'DocumentSignature';
  signature: {
    type: string;
    signatureValue: string;
  };
  digest: {
    type: 'DocumentHash' | 'SignedDocumentHash';
    hashAlg: string;
    hashValue: string;
  }[];
  document: {
    type: 'DigitalDocument';
    hashAlg: string;
    hashValue: string;
  }[];
  x5c?: string[];
};

function toBase64Url(input: Buffer): string {
  return input.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function hashBytes(input: Buffer, alg: string): string {
  const digest = crypto.createHash(alg).update(input).digest();
  return toBase64Url(digest);
}

function extractX5c(certificates: any[] = []): string[] | undefined {
  if (!certificates.length) return undefined;
  const chain = certificates.map((cert) => {
    const der = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
    return Buffer.from(der, 'binary').toString('base64');
  });
  return chain.length ? chain : undefined;
}

export function buildPdfSignatureEvidence(pdfBytes: Buffer, hashAlg: 'sha256' | 'sha384' | 'sha512' = 'sha256'):
  { evidence: PdfSignatureEvidence; hashes: PdfEvidenceHashes } {
  const verifier = new VerifyPdf();
  const { signature, signedData } = verifier.getSignature(pdfBytes);

  const signedPdfHashB64Url = hashBytes(pdfBytes, hashAlg);
  const unsignedPdfHashB64Url = hashBytes(signedData, hashAlg);

  const p7Asn1 = forge.asn1.fromDer(signature);
  const message = forge.pkcs7.messageFromAsn1(p7Asn1);
  const signatureBytes = Buffer.from(message.rawCapture.signature, 'binary');
  const signatureValue = toBase64Url(signatureBytes);
  const x5c = extractX5c(message.certificates);

  const evidence: PdfSignatureEvidence = {
    type: 'DocumentSignature',
    signature: {
      type: 'PAdES',
      signatureValue,
    },
    digest: [
      {
        type: 'DocumentHash',
        hashAlg: hashAlg.toUpperCase(),
        hashValue: unsignedPdfHashB64Url,
      },
      {
        type: 'SignedDocumentHash',
        hashAlg: hashAlg.toUpperCase(),
        hashValue: signedPdfHashB64Url,
      },
    ],
    document: [
      {
        type: 'DigitalDocument',
        hashAlg: hashAlg.toUpperCase(),
        hashValue: unsignedPdfHashB64Url,
      },
      {
        type: 'DigitalDocument',
        hashAlg: hashAlg.toUpperCase(),
        hashValue: signedPdfHashB64Url,
      },
    ],
    ...(x5c ? { x5c } : {}),
  };

  return {
    evidence,
    hashes: { hashAlg: hashAlg.toUpperCase(), unsignedPdfHashB64Url, signedPdfHashB64Url },
  };
}
