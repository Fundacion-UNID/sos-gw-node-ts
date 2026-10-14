/**
 * Flow contract: signed individual-onboarding PDF evidence
 *
 * 1. GW extracts the detached CMS signature and the exact signed byte ranges.
 * 2. GW verifies the RSA signature over the authenticated attributes.
 * 3. GW independently verifies the signed-content messageDigest.
 * 4. Either failed check rejects the onboarding evidence; neither is a warning.
 */
import crypto from 'crypto';
import { VerifyPdf } from '../../../utils/verifyPdf.class';

const TEST_SIGNED_CONTENT = Buffer.from('hello-vetchain-pdf');

// Deterministic CMS fixture signed by the test-only certificate
// CN=VetChain Test Signer, serialNumber=TEST-0001, C=CA.
const TEST_CMS_DER_BASE64 =
  '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';

function makeVerifier(): VerifyPdf {
  const verifier = new VerifyPdf();
  verifier.getSignature = () => ({
    signature: Buffer.from(TEST_CMS_DER_BASE64, 'base64').toString('binary'),
    signedData: TEST_SIGNED_CONTENT,
  });
  return verifier;
}

describe('VerifyPdf', () => {
  afterEach(() => jest.restoreAllMocks());

  it('accepts a valid detached signature whose content digest also matches', () => {
    expect(() => makeVerifier().verify(Buffer.alloc(0))).not.toThrow();
  });

  it('rejects evidence when the RSA authenticated-attributes signature is false', () => {
    jest.spyOn(crypto, 'createVerify').mockReturnValue({
      update: jest.fn(),
      verify: jest.fn().mockReturnValue(false),
    } as unknown as crypto.Verify);

    expect(() => makeVerifier().verify(Buffer.alloc(0))).toThrow(
      'Invalid PDF authenticated-attributes signature.',
    );
  });

  it('rejects evidence when the signed content no longer matches messageDigest', () => {
    const verifier = makeVerifier();
    verifier.getSignature = () => ({
      signature: Buffer.from(TEST_CMS_DER_BASE64, 'base64').toString('binary'),
      signedData: Buffer.from('tampered-vetchain-pdf'),
    });

    expect(() => verifier.verify(Buffer.alloc(0))).toThrow('Wrong content digest');
  });
});
