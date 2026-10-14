import forge from 'node-forge';
import crypto from 'crypto';
import { Buffer } from 'buffer';

export class VerifyPdf {
  getSignature(pdf: Buffer): { signature: string; signedData: Buffer } {
    let byteRangePos = pdf.lastIndexOf('/ByteRange[');
    if (byteRangePos === -1) byteRangePos = pdf.lastIndexOf('/ByteRange [');

    const byteRangeEnd = pdf.indexOf(']', byteRangePos);
    const byteRange = pdf.slice(byteRangePos, byteRangeEnd + 1).toString();
    const byteRangeNumbers = /(\d+) +(\d+) +(\d+) +(\d+)/.exec(byteRange);
    if (!byteRangeNumbers) {
      throw new Error('Invalid PDF ByteRange structure.');
    }
    const byteRangeArr = byteRangeNumbers[0].split(' ');

    const signedData = Buffer.concat([
      pdf.slice(parseInt(byteRangeArr[0], 10), parseInt(byteRangeArr[1], 10)),
      pdf.slice(
        parseInt(byteRangeArr[2], 10),
        parseInt(byteRangeArr[2], 10) + parseInt(byteRangeArr[3], 10),
      ),
    ]);

    let signatureHex = pdf
      .slice(
        parseInt(byteRangeArr[0], 10) + (parseInt(byteRangeArr[1], 10) + 1),
        parseInt(byteRangeArr[2], 10) - 1,
      )
      .toString('binary');
    signatureHex = signatureHex.replace(/(?:00)*$/, '');
    const signature = Buffer.from(signatureHex, 'hex').toString('binary');
    return { signature, signedData };
  }

  verify(pdf: Buffer): void {
    const extractedData = this.getSignature(pdf);
    const p7Asn1 = forge.asn1.fromDer(extractedData.signature);
    const message = forge.pkcs7.messageFromAsn1(p7Asn1);
    const {
      signature: sig,
      digestAlgorithm,
      authenticatedAttributes: attrs,
    } = message.rawCapture as {
      signature: string;
      digestAlgorithm: string;
      authenticatedAttributes: any[];
    };
    const set = forge.asn1.create(
      forge.asn1.Class.UNIVERSAL,
      forge.asn1.Type.SET,
      true,
      attrs,
    );

    const hashAlgorithmOid = forge.asn1.derToOid(digestAlgorithm);
    const hashAlgorithm = forge.pki.oids[hashAlgorithmOid].toUpperCase();

    const buf = Buffer.from(forge.asn1.toDer(set).data, 'binary');
    const validAuthenticatedAttributes = message.certificates.some((certificate: any) => {
      const verifier = crypto.createVerify(`RSA-${hashAlgorithm}`);
      verifier.update(buf);
      const cert = forge.pki.certificateToPem(certificate);
      return verifier.verify(cert, sig, 'binary');
    });
    if (!validAuthenticatedAttributes) {
      throw new Error('Invalid PDF authenticated-attributes signature.');
    }

    const pdfHash = crypto.createHash(hashAlgorithm);
    const data = extractedData.signedData;
    pdfHash.update(data);

    const oids = forge.pki.oids;
    const fullAttrDigest = attrs.find(
      (attr: any) => forge.asn1.derToOid(attr.value[0].value) === oids.messageDigest,
    );
    if (!fullAttrDigest) {
      throw new Error('Missing messageDigest authenticated attribute.');
    }
    const attrDigest = fullAttrDigest.value[1].value[0].value as string;

    const dataDigest = pdfHash.digest();
    const validContentDigest = dataDigest.toString('binary') === attrDigest;
    if (!validContentDigest) {
      throw new Error('Wrong content digest');
    }
  }
}
