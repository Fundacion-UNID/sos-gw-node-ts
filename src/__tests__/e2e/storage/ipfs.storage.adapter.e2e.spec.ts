import { IpfsStorageAdapter } from '../../../database/storage/ipfs.storage.adapter';

const apiUrl = process.env.IPFS_API_URL || 'http://127.0.0.1:5001';
const gatewayUrl = process.env.IPFS_GATEWAY_URL || 'http://127.0.0.1:8080';
const shouldRun = process.env.IPFS_E2E === 'true';
const describeIfConfigured = shouldRun ? describe : describe.skip;

describeIfConfigured('IpfsStorageAdapter (E2E)', () => {
  const adapter = new IpfsStorageAdapter({ apiUrl, gatewayUrl });
  const testFileContent = `test-file-content-${Date.now()}`;
  const testFileBytes = new Uint8Array(Buffer.from(testFileContent));
  let uploadedFileHash: string | null = null;

  afterAll(async () => {
    if (uploadedFileHash) {
      await adapter.delete?.(uploadedFileHash);
    }
  });

  it('should upload, download, and delete a blob through a live Kubo node', async () => {
    const upload = await adapter.upload(testFileBytes, 'text/plain');
    uploadedFileHash = upload.encodedMultiHash;

    expect(upload.encodedMultiHash).toBeDefined();
    expect(upload.encodedMultiHash.startsWith('z')).toBe(true);
    expect(upload.publicUrl).toContain('/ipfs/');

    const download = await adapter.download(upload.encodedMultiHash);
    expect(Buffer.from(download.dataBytes).toString('utf8')).toBe(testFileContent);

    await adapter.delete?.(upload.encodedMultiHash);
    uploadedFileHash = null;
  }, 20000);
});
