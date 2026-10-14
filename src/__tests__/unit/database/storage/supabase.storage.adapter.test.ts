import { jest } from '@jest/globals';
import { sha3_384 } from '@noble/hashes/sha3.js';
import { encodeMultibase58btc } from 'gdc-common-utils-ts/utils/multibase58';
import { SupabaseStorageAdapter } from '../../../../database/storage/supabase.storage.adapter';

describe('SupabaseStorageAdapter', () => {
  const testBytes = new Uint8Array(Buffer.from('dummy pdf content'));
  const testContentType = 'application/pdf';
  const baseUrl = 'https://example.supabase.co';
  const serviceRoleKey = 'service-role-key';
  const bucketName = 'gw-files';

  it('should require mandatory configuration', () => {
    expect(() => new SupabaseStorageAdapter({ url: '', serviceRoleKey, bucketName })).toThrow('Supabase URL must be provided.');
    expect(() => new SupabaseStorageAdapter({ url: baseUrl, serviceRoleKey: '', bucketName })).toThrow('Supabase service role key must be provided.');
    expect(() => new SupabaseStorageAdapter({ url: baseUrl, serviceRoleKey, bucketName: '' })).toThrow('Supabase storage bucket name must be provided.');
  });

  it('should calculate the multihash and upload through the Supabase REST API', async () => {
    const fetchMock = jest.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ Key: 'ignored' }), { status: 200, headers: { 'content-type': 'application/json' } })
    );
    const adapter = new SupabaseStorageAdapter({
      url: `${baseUrl}/`,
      serviceRoleKey,
      bucketName,
      fetchImpl: fetchMock,
    });

    const result = await adapter.upload(testBytes, testContentType);

    const digest = sha3_384(testBytes);
    const prefix = new Uint8Array([0x15, 0x30]);
    const multihashBytes = new Uint8Array(prefix.length + digest.length);
    multihashBytes.set(prefix);
    multihashBytes.set(digest, prefix.length);
    const expectedHash = encodeMultibase58btc(multihashBytes);

    expect(result.encodedMultiHash).toBe(expectedHash);
    expect(result.publicUrl).toBe(`${baseUrl}/storage/v1/object/public/${bucketName}/${expectedHash}`);
    expect(fetchMock).toHaveBeenCalledWith(
      `${baseUrl}/storage/v1/object/${bucketName}/${expectedHash}`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          authorization: `Bearer ${serviceRoleKey}`,
          apikey: serviceRoleKey,
          'content-type': testContentType,
          'x-upsert': 'true',
        }),
      }),
    );
  });

  it('should reject private bucket mode because the contract expects a stable public URL', async () => {
    const adapter = new SupabaseStorageAdapter({
      url: baseUrl,
      serviceRoleKey,
      bucketName,
      publicBucket: false,
      fetchImpl: jest.fn<typeof fetch>(),
    });

    await expect(adapter.upload(testBytes, testContentType)).rejects.toThrow(
      'SupabaseStorageAdapter currently requires a public bucket to return a stable publicUrl.'
    );
  });

  it('should re-throw a specific error if the upload fails', async () => {
    const fetchMock = jest.fn<typeof fetch>().mockResolvedValue(
      new Response('bucket not found', { status: 404, statusText: 'Not Found' })
    );
    const adapter = new SupabaseStorageAdapter({
      url: baseUrl,
      serviceRoleKey,
      bucketName,
      fetchImpl: fetchMock,
    });

    await expect(adapter.upload(testBytes, testContentType)).rejects.toThrow(
      'Supabase upload failed: 404 Not Found: bucket not found'
    );
  });

  it('should download a stored object through the Supabase REST API', async () => {
    const fetchMock = jest.fn<typeof fetch>().mockResolvedValue(
      new Response(testBytes, { status: 200, headers: { 'content-type': testContentType } })
    );
    const adapter = new SupabaseStorageAdapter({
      url: baseUrl,
      serviceRoleKey,
      bucketName,
      fetchImpl: fetchMock,
    });

    const result = await adapter.download('zQmBlobRef');

    expect(result.dataBytes).toEqual(testBytes);
    expect(result.contentType).toBe(testContentType);
    expect(fetchMock).toHaveBeenCalledWith(
      `${baseUrl}/storage/v1/object/${bucketName}/zQmBlobRef`,
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          authorization: `Bearer ${serviceRoleKey}`,
          apikey: serviceRoleKey,
        }),
      }),
    );
  });
});
