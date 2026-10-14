// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { hashUblInvoiceXml } from '../../../utils/ubl-invoice';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe('UBL Invoice hash', () => {
  const xmlPath = path.resolve(__dirname, '../../data/ubl-invoice-minimal.xml');

  it('computes a stable hash for anchoring', () => {
    const xml = readFileSync(xmlPath, 'utf8');
    const { hashHex, hashAlgo } = hashUblInvoiceXml(xml);
    expect(hashAlgo).toBe('sha256');
    expect(hashHex).toMatch(/^[a-f0-9]{64}$/);
  });
});
