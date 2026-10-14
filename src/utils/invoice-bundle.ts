import { ResourceTypesFhirR4 } from 'gdc-common-utils-ts/constants/fhir-resource-types';
import { Buffer } from 'buffer';
import { hashUblInvoiceXml } from './ubl-invoice';

type InvoiceBundleInput = Readonly<{
  invoiceId: string;
  subjectReference: string;
  issuerReference?: string;
  issuerDisplay?: string;
  recipientReference?: string;
  issuedAt: string;
  amount?: string;
  currency?: string;
  paymentMethod?: string;
  paymentUrl?: string;
}>;

function normalizeText(value: unknown): string | undefined {
  const normalized = String(value ?? '').trim();
  return normalized || undefined;
}

function encodeBase64(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64');
}

function buildInvoicePdfBase64(input: InvoiceBundleInput): string {
  const pdfText = [
    '%PDF-1.4',
    `Invoice ${input.invoiceId}`,
    `Issued ${input.issuedAt}`,
    `Amount ${input.amount || ''} ${input.currency || ''}`.trim(),
    `Payment ${input.paymentMethod || ''}`.trim(),
    input.paymentUrl || '',
    '%%EOF',
  ].filter(Boolean).join('\n');
  return encodeBase64(pdfText);
}

function buildInvoiceJson(input: InvoiceBundleInput): string {
  return JSON.stringify({
    invoiceId: input.invoiceId,
    issuedAt: input.issuedAt,
    amount: input.amount,
    currency: input.currency,
    paymentMethod: input.paymentMethod,
    paymentUrl: input.paymentUrl,
    subjectReference: input.subjectReference,
    recipientReference: input.recipientReference,
    issuerReference: input.issuerReference,
    issuerDisplay: input.issuerDisplay,
  });
}

function buildInvoiceXml(input: InvoiceBundleInput): string {
  return [
    '<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2">',
    `  <ID>${input.invoiceId}</ID>`,
    `  <IssueDate>${input.issuedAt.slice(0, 10)}</IssueDate>`,
    `  <DocumentCurrencyCode>${input.currency || ''}</DocumentCurrencyCode>`,
    `  <Note>${input.paymentMethod || ''}</Note>`,
    `  <AccountingCustomerParty><Party><EndpointID>${input.recipientReference || input.subjectReference}</EndpointID></Party></AccountingCustomerParty>`,
    `  <AccountingSupplierParty><Party><EndpointID>${input.issuerReference || ''}</EndpointID></Party></AccountingSupplierParty>`,
    `  <LegalMonetaryTotal><PayableAmount currencyID="${input.currency || ''}">${input.amount || ''}</PayableAmount></LegalMonetaryTotal>`,
    '</Invoice>',
  ].join('\n');
}

/**
 * Builds the current invoice bundle projection returned by portal-managed and
 * direct GW order confirmations.
 *
 * The gateway keeps order claims for compatibility, but the user-facing
 * readback should rely on this richer `Bundle` with:
 * - one FHIR `Invoice`
 * - one `DocumentReference` carrying the PDF representation
 * - one `DocumentReference` carrying the structured JSON and UBL/XML payload
 */
export function buildGatewayInvoiceBundle(
  input: InvoiceBundleInput,
): Record<string, unknown> {
  const structuredJson = buildInvoiceJson(input);
  const structuredXml = buildInvoiceXml(input);
  const xmlHash = hashUblInvoiceXml(structuredXml).hashHex;
  return {
    resourceType: ResourceTypesFhirR4.Bundle,
    type: 'collection',
    entry: [
      {
        resource: {
          resourceType: ResourceTypesFhirR4.Invoice,
          id: input.invoiceId,
          status: 'issued',
          identifier: [{ value: input.invoiceId }],
          subject: { reference: input.subjectReference },
          recipient: input.recipientReference ? { reference: input.recipientReference } : undefined,
          issuer: input.issuerReference || input.issuerDisplay
            ? { reference: input.issuerReference, display: input.issuerDisplay }
            : undefined,
          date: input.issuedAt,
          paymentTerms: input.paymentMethod,
          note: input.paymentUrl ? [{ text: input.paymentUrl }] : undefined,
          totalNet: normalizeText(input.amount)
            ? { value: Number(input.amount), currency: input.currency }
            : undefined,
          totalGross: normalizeText(input.amount)
            ? { value: Number(input.amount), currency: input.currency }
            : undefined,
        },
      },
      {
        resource: {
          resourceType: ResourceTypesFhirR4.DocumentReference,
          id: `${input.invoiceId}-pdf`,
          status: 'current',
          identifier: [{ value: `${input.invoiceId}-pdf` }],
          subject: { reference: input.subjectReference },
          date: input.issuedAt,
          description: 'Human-readable invoice PDF',
          content: [{
            attachment: {
              contentType: 'application/pdf',
              data: buildInvoicePdfBase64(input),
              title: `${input.invoiceId}.pdf`,
              language: 'en',
              creation: input.issuedAt,
            },
          }],
        },
      },
      {
        resource: {
          resourceType: ResourceTypesFhirR4.DocumentReference,
          id: `${input.invoiceId}-json`,
          status: 'current',
          identifier: [{ value: `${input.invoiceId}-json` }],
          subject: { reference: input.subjectReference },
          date: input.issuedAt,
          description: 'Structured invoice payloads',
          content: [
            {
              attachment: {
                contentType: 'application/json',
                data: encodeBase64(structuredJson),
                title: `${input.invoiceId}.json`,
                language: 'en',
                creation: input.issuedAt,
              },
            },
            {
              attachment: {
                contentType: 'application/xml',
                data: encodeBase64(structuredXml),
                title: `${input.invoiceId}.xml`,
                language: 'en',
                creation: input.issuedAt,
                hash: xmlHash,
              },
            },
          ],
        },
      },
    ],
  };
}
