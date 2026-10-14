// src/utils/status-list.ts

import { gzipSync } from 'zlib';

export type StatusPurpose = 'revocation' | 'suspension';

export function createStatusListEncodedList(bitLength: number, setBits: number[] = []): string {
  const byteLength = Math.ceil(bitLength / 8);
  const bitstring = new Uint8Array(byteLength);

  for (const index of setBits) {
    if (index < 0 || index >= bitLength) {
      continue;
    }
    const byteIndex = Math.floor(index / 8);
    const bitIndex = index % 8;
    bitstring[byteIndex] |= 1 << (7 - bitIndex);
  }

  const compressed = gzipSync(Buffer.from(bitstring));
  return Buffer.from(compressed).toString('base64url');
}

export function buildStatusListCredential(options: {
  issuerDid: string;
  listUrl: string;
  statusPurpose: StatusPurpose;
  encodedList: string;
  validFrom?: string;
}) {
  const now = new Date().toISOString();
  return {
    '@context': [
      'https://www.w3.org/ns/credentials/v2',
      'https://w3id.org/vc/status-list/2021/v1',
    ],
    id: options.listUrl,
    type: ['VerifiableCredential', 'StatusList2021Credential'],
    issuer: options.issuerDid,
    validFrom: options.validFrom || now,
    credentialSubject: {
      id: `${options.listUrl}#list`,
      type: 'StatusList2021',
      statusPurpose: options.statusPurpose,
      encodedList: options.encodedList,
    },
  };
}

export function buildStatusListEntry(options: {
  listUrl: string;
  index: number;
  statusPurpose: StatusPurpose;
}) {
  return {
    id: `${options.listUrl}#${options.index}`,
    type: 'StatusList2021Entry',
    statusPurpose: options.statusPurpose,
    statusListIndex: String(options.index),
    statusListCredential: options.listUrl,
  };
}
