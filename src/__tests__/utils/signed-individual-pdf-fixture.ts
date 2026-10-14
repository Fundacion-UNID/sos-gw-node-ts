// Flow contract: build a self-contained, cryptographically signed individual-registration PDF; no external fixture or mocked signature boundary may satisfy this test.
import forge from 'node-forge';
import { PDFDocument } from 'pdf-lib';

// Generate disposable signing material at test runtime; no private key is stored in Git.
const TEST_KEY_PAIR = forge.pki.rsa.generateKeyPair(2048);
const TEST_CERTIFICATE = forge.pki.createCertificate();
TEST_CERTIFICATE.publicKey = TEST_KEY_PAIR.publicKey;
TEST_CERTIFICATE.serialNumber = '01';
TEST_CERTIFICATE.validity.notBefore = new Date('2026-01-01T00:00:00.000Z');
TEST_CERTIFICATE.validity.notAfter = new Date('2126-01-01T00:00:00.000Z');
const TEST_SUBJECT = [
  { name: 'countryName', value: 'ES' },
  { name: 'serialNumber', value: 'IDCES-00000000T' },
  { name: 'givenName', value: 'GDC Test' },
  { name: 'surname', value: 'Controller' },
  { name: 'commonName', value: 'GDC Test Controller' },
];
TEST_CERTIFICATE.setSubject(TEST_SUBJECT);
TEST_CERTIFICATE.setIssuer(TEST_SUBJECT);
TEST_CERTIFICATE.setExtensions([{ name: 'basicConstraints', cA: true }]);
TEST_CERTIFICATE.sign(TEST_KEY_PAIR.privateKey, forge.md.sha256.create());

const SIGNATURE_HEX_LENGTH = 16_384;
const FIXED_PDF_DATE = new Date('2026-09-11T00:00:00.000Z');

export const SIGNED_INDIVIDUAL_PDF_EXPECTED = Object.freeze({
  controllerEmail: 'signed.controller@example.org',
  organizationAlternateName: 'Signed Individual Test',
  signerCommonName: 'GDC Test Controller',
  signerGivenName: 'GDC Test',
  signerSurname: 'Controller',
  signerSerialNumber: 'IDCES-00000000T',
  signerCountry: 'ES',
  signerSubjectDn: 'CN=GDC Test Controller,SN=Controller,GN=GDC Test,serialNumber=IDCES-00000000T,C=ES',
});

function fixedWidthOffset(value: number): string {
  return String(value).padStart(10, '0');
}

async function createIndividualRegistrationPdf(): Promise<Buffer> {
  const document = await PDFDocument.create();
  document.setCreationDate(FIXED_PDF_DATE);
  document.setModificationDate(FIXED_PDF_DATE);
  document.setProducer('GW CORE signed individual fixture');
  document.setCreator('GW CORE tests');
  const page = document.addPage([600, 800]);
  const form = document.getForm();

  const alternateName = form.createTextField('controllerAlternateName');
  alternateName.setText(SIGNED_INDIVIDUAL_PDF_EXPECTED.organizationAlternateName);
  alternateName.addToPage(page, { x: 20, y: 740, width: 250, height: 20 });
  const email = form.createTextField('controllerEmail');
  email.setText(SIGNED_INDIVIDUAL_PDF_EXPECTED.controllerEmail);
  email.addToPage(page, { x: 20, y: 700, width: 250, height: 20 });
  const consentDate = form.createTextField('docDate');
  consentDate.setText('2026-09-11');
  consentDate.addToPage(page, { x: 20, y: 660, width: 250, height: 20 });
  const provider = form.createTextField('serviceProviderDomain');
  provider.setText('https://provider.example.org');
  provider.addToPage(page, { x: 20, y: 620, width: 250, height: 20 });
  const self = form.createCheckBox('controllerIsSubject');
  self.addToPage(page, { x: 20, y: 580, width: 20, height: 20 });
  self.check();

  return Buffer.from(await document.save({ useObjectStreams: false }));
}

/** Builds a stable PDF body carrying a real detached PKCS#7 signature and signer certificate. */
export async function buildSignedIndividualPdfFixture(): Promise<Buffer> {
  const pdfBody = await createIndividualRegistrationPdf();
  const placeholder = '0'.repeat(SIGNATURE_HEX_LENGTH);
  const unsignedTailTemplate = `\n/ByteRange[${'0'.repeat(10)} ${'0'.repeat(10)} ${'0'.repeat(10)} ${'0'.repeat(10)}] /Contents <${placeholder}>\n`;
  const placeholderPdf = Buffer.concat([pdfBody, Buffer.from(unsignedTailTemplate, 'latin1')]);
  const signatureStart = placeholderPdf.lastIndexOf(Buffer.from(`<${placeholder}>`, 'latin1'));
  const secondRangeStart = signatureStart + SIGNATURE_HEX_LENGTH + 2;
  const secondRangeLength = placeholderPdf.length - secondRangeStart;
  const byteRange = `/ByteRange[${fixedWidthOffset(0)} ${fixedWidthOffset(signatureStart)} ${fixedWidthOffset(secondRangeStart)} ${fixedWidthOffset(secondRangeLength)}]`;
  const unsignedTail = unsignedTailTemplate.replace(/\/ByteRange\[[^\]]+\]/, byteRange);
  const unsignedPdf = Buffer.concat([pdfBody, Buffer.from(unsignedTail, 'latin1')]);
  const signedData = Buffer.concat([
    unsignedPdf.subarray(0, signatureStart),
    unsignedPdf.subarray(secondRangeStart),
  ]);

  const message = forge.pkcs7.createSignedData();
  message.content = forge.util.createBuffer(signedData.toString('binary'));
  const certificate = TEST_CERTIFICATE;
  message.addCertificate(certificate);
  message.addSigner({
    key: TEST_KEY_PAIR.privateKey,
    certificate,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
    ],
  });
  message.sign({ detached: true });

  const signatureHex = forge.asn1.toDer(message.toAsn1()).getBytes().split('')
    .map((character: string) => character.charCodeAt(0).toString(16).padStart(2, '0'))
    .join('');
  if (signatureHex.length > SIGNATURE_HEX_LENGTH) {
    throw new Error(`Signed PDF fixture signature exceeds ${SIGNATURE_HEX_LENGTH} hexadecimal characters.`);
  }

  const paddedSignature = signatureHex.padEnd(SIGNATURE_HEX_LENGTH, '0');
  return Buffer.concat([
    unsignedPdf.subarray(0, signatureStart + 1),
    Buffer.from(paddedSignature, 'latin1'),
    unsignedPdf.subarray(secondRangeStart - 1),
  ]);
}
