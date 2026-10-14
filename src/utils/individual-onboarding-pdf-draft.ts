import { createHash, randomUUID } from 'crypto';
import { Buffer } from 'buffer';
import {
  buildIndividualOnboardingPdfDocumentReferenceEntry,
} from 'gdc-common-utils-ts/utils/individual-onboarding-document-reference';
import { mergeIndividualOrganizationClaims } from 'gdc-common-utils-ts/utils/individual-organization-claims';
import {
  IndividualIndexServiceFormFields,
  IndividualOnboardingDraftInput,
  IndividualOnboardingPdfDocumentReferenceEntry,
  IndividualOnboardingPdfTemplateInput,
} from 'gdc-common-utils-ts/models/individual-onboarding';
import { PDFCheckBox, PDFDropdown, PDFOptionList, PDFRadioGroup, PDFTextField, PDFDocument } from 'pdf-lib';

const templateCache = new Map<string, Uint8Array>();

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeOptionalText(value: unknown): string | undefined {
  const normalized = normalizeText(value);
  return normalized || undefined;
}

function normalizeBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) return undefined;
  if (normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on' || normalized === 'checked') return true;
  if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'off' || normalized === 'unchecked') return false;
  return undefined;
}

function resolveTemplateCacheKey(template: IndividualOnboardingPdfTemplateInput): string {
  return [
    normalizeText(template.sector),
    normalizeText(template.language),
    normalizeText(template.version),
    normalizeText(template.templateSha256),
    normalizeText(template.templateUrl),
  ].join('|');
}

async function readTemplateBytes(template: IndividualOnboardingPdfTemplateInput): Promise<Uint8Array> {
  const cacheKey = resolveTemplateCacheKey(template);
  const cached = templateCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  let templateBytes: Uint8Array | undefined;
  const inlineBytesBase64 = normalizeOptionalText(template.templateBytesBase64);
  if (inlineBytesBase64) {
    templateBytes = Buffer.from(inlineBytesBase64, 'base64');
  } else if (normalizeOptionalText(template.templateUrl)) {
    const response = await fetch(String(template.templateUrl));
    if (!response.ok) {
      throw new Error(`Failed to fetch onboarding PDF template: ${response.status} ${response.statusText}`);
    }
    templateBytes = new Uint8Array(await response.arrayBuffer());
  }

  if (!templateBytes || templateBytes.length === 0) {
    throw new Error('Individual onboarding PDF draft requires templateBytesBase64 or templateUrl.');
  }

  const expectedSha = normalizeOptionalText(template.templateSha256);
  if (expectedSha) {
    const actualSha = createHash('sha256').update(templateBytes).digest('hex');
    if (actualSha.toLowerCase() !== expectedSha.toLowerCase()) {
      throw new Error('Individual onboarding PDF template hash mismatch.');
    }
  }

  templateCache.set(cacheKey, templateBytes);
  return templateBytes;
}

function setPdfFieldValue(field: unknown, value: unknown): void {
  const textValue = value === undefined || value === null ? '' : String(value);
  const boolValue = normalizeBoolean(value);

  if (field instanceof PDFTextField) {
    field.setText(textValue);
    return;
  }
  if (field instanceof PDFCheckBox) {
    if (boolValue) field.check();
    else field.uncheck();
    return;
  }
  if (field instanceof PDFDropdown) {
    if (textValue) field.select(textValue);
    return;
  }
  if (field instanceof PDFOptionList) {
    if (textValue) field.select(textValue);
    return;
  }
  if (field instanceof PDFRadioGroup) {
    if (textValue) field.select(textValue);
  }
}

async function fillPdfTemplate(
  template: IndividualOnboardingPdfTemplateInput,
  formFields: IndividualIndexServiceFormFields,
): Promise<string> {
  const templateBytes = await readTemplateBytes(template);
  const pdf = await PDFDocument.load(templateBytes, { ignoreEncryption: true, updateMetadata: false });
  const form = pdf.getForm();

  for (const [fieldName, fieldValue] of Object.entries(formFields || {})) {
    if (fieldValue === undefined || fieldValue === null) continue;
    try {
      const field = form.getField(fieldName);
      setPdfFieldValue(field, fieldValue);
    } catch {
      // Ignore unknown template field names so one request can target multiple revisions.
    }
  }

  return Buffer.from(await pdf.save()).toString('base64');
}

function buildDraftClaims(input: IndividualOnboardingDraftInput): Record<string, string> {
  return mergeIndividualOrganizationClaims({
    claims: input.claims,
    kyc: input.kyc,
    formFields: input.formFields,
  }).claims;
}

export async function buildIndividualOnboardingPdfDraftResponse(
  input: IndividualOnboardingDraftInput,
  subjectDid: string,
  identifier?: string,
): Promise<IndividualOnboardingPdfDocumentReferenceEntry> {
  if (!input.template) {
    throw new Error('Individual onboarding PDF draft requires a template object.');
  }
  if (!input.formFields) {
    throw new Error('Individual onboarding PDF draft requires formFields.');
  }

  const claims = buildDraftClaims(input);
  const pdfBase64 = await fillPdfTemplate(input.template, input.formFields);
  return buildIndividualOnboardingPdfDocumentReferenceEntry({
    subject: subjectDid,
    contentData: pdfBase64,
    identifier: normalizeOptionalText(identifier) || `urn:uuid:${randomUUID()}`,
    contentType: 'application/pdf',
    description: [
      normalizeOptionalText(input.template.sector),
      'individual-onboarding-pdf',
      normalizeOptionalText(input.template.language),
      normalizeOptionalText(input.template.version),
    ].filter(Boolean).join(':'),
    date: new Date().toISOString(),
    claims,
  });
}
