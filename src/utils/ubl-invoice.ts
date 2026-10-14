import { createHash } from 'crypto';

export type InvoiceHashResult = {
  hashHex: string;
  hashAlgo: 'sha256';
};

export function hashUblInvoiceXml(xml: string): InvoiceHashResult {
  // TODO: Use XML canonicalization (C14N) before hashing for signing/anchoring.
  const hashHex = createHash('sha256').update(xml, 'utf8').digest('hex');
  return { hashHex, hashAlgo: 'sha256' };
}
