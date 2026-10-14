import forge from 'node-forge';
import { PDFDocument } from 'pdf-lib';
import { VerifyPdf } from './verifyPdf.class';
import { buildClaimsFromIndividualFormPdf } from './individual-form-pdf';

export type DidCommAttachmentLike = {
  id?: string;
  description?: string;
  filename?: string;
  format?: string;
  media_type?: string;
  data?: {
    base64?: string;
    json?: unknown;
    links?: string[];
  };
};

export type IndividualRegistrationPdfAttachmentResult = {
  attachmentId?: string;
  fields: Record<string, string>;
  signerSubjectDn: string;
  claims: Record<string, string>;
};

type ForgeCertificateLike = {
  subject?: {
    attributes?: Array<{ shortName?: string; name?: string; value?: unknown }>;
  };
};

function isPdfMediaType(value: unknown): boolean {
  return String(value || '').trim().toLowerCase() === 'application/pdf';
}

function normalizeAttachmentBase64(base64Value: string): string {
  const normalized = String(base64Value || '').trim().replace(/\s+/g, '');
  if (!normalized) throw new Error('PDF attachment is missing base64 data.');
  return normalized.replace(/-/g, '+').replace(/_/g, '/');
}

function normalizeAttachmentLinks(linksValue: unknown): string[] {
  if (!Array.isArray(linksValue)) return [];
  return linksValue
    .map((entry) => String(entry || '').trim())
    .filter((entry) => /^https:\/\//i.test(entry));
}

async function resolveAttachmentPdfBytes(pdfAttachment: DidCommAttachmentLike): Promise<Buffer> {
  const embeddedBase64 = String(pdfAttachment.data?.base64 || '').trim();
  if (embeddedBase64) {
    return Buffer.from(normalizeAttachmentBase64(embeddedBase64), 'base64');
  }

  const remoteLinks = normalizeAttachmentLinks(pdfAttachment.data?.links);
  const remoteUrl = remoteLinks[0];
  if (remoteUrl) {
    const response = await fetch(remoteUrl, { redirect: 'follow' });
    if (!response.ok) {
      throw new Error(`PDF attachment download failed with HTTP ${response.status} for ${remoteUrl}.`);
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length) {
      throw new Error(`PDF attachment download returned empty content for ${remoteUrl}.`);
    }
    return bytes;
  }

  throw new Error('PDF attachment must provide either data.base64 or data.links[0] with an HTTPS URL.');
}

function escapeDnValue(value: string): string {
  return String(value || '').replace(/\\/g, '\\\\').replace(/,/g, '\\,');
}

function normalizeDnKey(rawKey: string): string {
  return String(rawKey || '').trim().toUpperCase().replace(/\s+/g, '');
}

function mapForgeAttributeKey(attribute: { shortName?: string; name?: string }): string {
  const rawKey = attribute.shortName || attribute.name || '';
  const normalized = normalizeDnKey(rawKey);
  if (normalized === 'COUNTRYNAME') return 'C';
  if (normalized === 'SURNAME') return 'SN';
  if (normalized === 'GIVENNAME') return 'GN';
  return rawKey;
}

function isNaturalPersonCertificate(cert: ForgeCertificateLike): boolean {
  const attributes = Array.isArray(cert.subject?.attributes) ? cert.subject.attributes : [];
  const keys = new Set(attributes.map((attribute: { shortName?: string; name?: string }) => normalizeDnKey(attribute.shortName || attribute.name || '')));
  return keys.has('GN') || keys.has('GIVENNAME') || keys.has('SN') || keys.has('SURNAME') || keys.has('SERIALNUMBER');
}

function extractSignerSubjectDnFromPdf(pdfBytes: Buffer): string {
  const verifier = new VerifyPdf();
  verifier.verify(pdfBytes);

  const { signature } = verifier.getSignature(pdfBytes);
  const p7Asn1 = forge.asn1.fromDer(signature);
  const message = forge.pkcs7.messageFromAsn1(p7Asn1);
  const signerCertificate = message.certificates?.find((cert: ForgeCertificateLike) => isNaturalPersonCertificate(cert)) || message.certificates?.[0];
  if (!signerCertificate) {
    throw new Error('Signed PDF does not contain a signer certificate.');
  }

  const subjectAttributes = Array.isArray(signerCertificate.subject?.attributes)
    ? signerCertificate.subject.attributes
    : [];
  if (subjectAttributes.length === 0) {
    throw new Error('Signer certificate subject is empty.');
  }

  return subjectAttributes
    .map((attribute: { shortName?: string; name?: string; value?: unknown }) => `${mapForgeAttributeKey(attribute)}=${escapeDnValue(String(attribute.value || '').trim())}`)
    .join(',');
}

async function extractPdfFormFields(pdfBytes: Buffer): Promise<Record<string, string>> {
  const document = await PDFDocument.load(pdfBytes, { ignoreEncryption: true, updateMetadata: false });
  const fields: Record<string, string> = {};

  for (const field of document.getForm().getFields()) {
    const name = String(field.getName() || '').trim();
    if (!name) continue;

    let value = '';
    if (typeof (field as any).getText === 'function') {
      value = String((field as any).getText() || '').trim();
    } else if (typeof (field as any).getSelected === 'function') {
      const selected = (field as any).getSelected();
      value = Array.isArray(selected) ? selected.join(', ').trim() : String(selected || '').trim();
    } else if (typeof (field as any).isChecked === 'function') {
      value = (field as any).isChecked() ? 'true' : 'false';
    }

    if (value) fields[name] = value;
  }

  return fields;
}

/**
 * Extracts and verifies the signed PDF attachment used in individual organization onboarding.
 *
 * The returned claims are derived from:
 * - the natural-person signer certificate subject, and
 * - the additional PDF form fields that complement that identity.
 *
 * The form may provide contact and alternate-name data, but certificate-derived identity claims
 * remain authoritative and must not be overwritten by caller-supplied fields.
 */
export async function buildClaimsFromIndividualRegistrationPdfAttachment(
  attachments: unknown,
): Promise<IndividualRegistrationPdfAttachmentResult | undefined> {
  const candidates = Array.isArray(attachments) ? attachments as DidCommAttachmentLike[] : [];
  const pdfAttachment = candidates.find((attachment) => isPdfMediaType(attachment?.media_type));
  if (!pdfAttachment) return undefined;

  const pdfBytes = await resolveAttachmentPdfBytes(pdfAttachment);
  const fields = await extractPdfFormFields(pdfBytes);
  const signerSubjectDn = extractSignerSubjectDnFromPdf(pdfBytes);
  const claims = buildClaimsFromIndividualFormPdf(fields, signerSubjectDn);

  return {
    ...(pdfAttachment.id ? { attachmentId: pdfAttachment.id } : {}),
    fields,
    signerSubjectDn,
    claims,
  };
}
