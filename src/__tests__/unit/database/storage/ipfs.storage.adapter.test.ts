import { jest } from '@jest/globals';
import { sha3_384 } from '@noble/hashes/sha3.js';
import { encodeMultibase58btc } from 'gdc-common-utils-ts/utils/multibase58';
import { computeEncodedMultiHash, IpfsStorageAdapter } from '../../../../database/storage/ipfs.storage.adapter';

describe('IpfsStorageAdapter', () => {
  const apiUrl = 'http://127.0.0.1:5001';
  const gatewayUrl = 'http://127.0.0.1:8080';
  const testPdfBytes = new Uint8Array(Buffer.from('dummy pdf content'));
  const testContentType = 'application/pdf';
  const contentCid = 'bafybeigdyrzt4examplecid';

  function expectedHash(dataBytes: Uint8Array): string {
    const digest = sha3_384(dataBytes);
    const prefix = new Uint8Array([0x15, 0x30]);
    const multihashBytes = new Uint8Array(prefix.length + digest.length);
    multihashBytes.set(prefix);
    multihashBytes.set(digest, prefix.length);
    return encodeMultibase58btc(multihashBytes);
  }

  it('should compute the canonical encodedMultiHash', () => {
    expect(computeEncodedMultiHash(testPdfBytes)).toBe(expectedHash(testPdfBytes));
  });

  it('should throw when required options are missing', () => {
    expect(() => new IpfsStorageAdapter({ apiUrl: '', gatewayUrl })).toThrow('IPFS API URL must be provided.');
    expect(() => new IpfsStorageAdapter({ apiUrl, gatewayUrl: '' })).toThrow('IPFS gateway URL must be provided.');
  });

  it('should upload via Kubo MFS and return encodedMultiHash + gateway URL', async () => {
    const encodedMultiHash = expectedHash(testPdfBytes);
    const mfsPath = `/gwtemplate/blobs/${encodedMultiHash}`;
    const fetchImpl = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/api/v0/files/write')) {
        expect(url).toContain(encodeURIComponent(mfsPath));
        expect(init?.method).toBe('POST');
        return new Response('{}', { status: 200 });
      }
      if (url.includes('/api/v0/files/stat')) {
        return new Response(JSON.stringify({ Hash: contentCid, Size: testPdfBytes.byteLength }), { status: 200 });
      }
      throw new Error(`Unexpected fetch call: ${url}`);
    }) as typeof fetch;

    const adapter = new IpfsStorageAdapter({ apiUrl, gatewayUrl, fetchImpl });
    const result = await adapter.upload(testPdfBytes, testContentType);

    expect(result.encodedMultiHash).toBe(encodedMultiHash);
    expect(result.publicUrl).toBe(`${gatewayUrl}/ipfs/${contentCid}`);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('should download a stored object by multihash via Kubo MFS', async () => {
    const encodedMultiHash = 'zQmDownloadTarget';
    const mfsPath = `/gwtemplate/blobs/${encodedMultiHash}`;
    const fetchImpl = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/v0/files/read')) {
        expect(url).toContain(encodeURIComponent(mfsPath));
        return new Response(testPdfBytes, { status: 200 });
      }
      if (url.includes('/api/v0/files/stat')) {
        return new Response(JSON.stringify({ Hash: contentCid }), { status: 200 });
      }
      throw new Error(`Unexpected fetch call: ${url}`);
    }) as typeof fetch;

    const adapter = new IpfsStorageAdapter({ apiUrl, gatewayUrl, fetchImpl });
    const result = await adapter.download(encodedMultiHash);

    expect(result.dataBytes).toEqual(testPdfBytes);
    expect(result.contentType).toBe('application/octet-stream');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('should delete a stored object via Kubo MFS', async () => {
    const encodedMultiHash = 'zQmDeleteTarget';
    const mfsPath = `/gwtemplate/blobs/${encodedMultiHash}`;
    const fetchImpl = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      expect(url).toContain('/api/v0/files/rm');
      expect(url).toContain(encodeURIComponent(mfsPath));
      return new Response('{}', { status: 200 });
    }) as typeof fetch;

    const adapter = new IpfsStorageAdapter({ apiUrl, gatewayUrl, fetchImpl });
    await adapter.delete(encodedMultiHash);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('should re-throw a specific error if IPFS upload fails', async () => {
    const fetchImpl = jest.fn(async () => new Response('boom', { status: 500, statusText: 'Internal Server Error' })) as typeof fetch;
    const adapter = new IpfsStorageAdapter({ apiUrl, gatewayUrl, fetchImpl });

    await expect(adapter.upload(testPdfBytes, testContentType))
      .rejects
      .toThrow('IPFS upload failed: 500 Internal Server Error: boom');
  });
});
