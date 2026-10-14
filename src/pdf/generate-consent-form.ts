// src/pdf/generate-consent-form.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

/**
 * Generates a Consent Form PDF with form fields and dropdowns.
 * Returns the PDF as a Uint8Array.
 */
export async function generateConsentForm(): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595, 842]); // A4 size
  const form = pdfDoc.getForm();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const drawLabel = (label: string, x: number, y: number) => {
    page.drawText(label, {
      x,
      y,
      size: 10,
      font,
      color: rgb(0, 0, 0)
    });
  };

  let y = 800;
  const labelX = 50;
  const inputX = 200;
  const fieldWidth = 300;
  const fieldHeight = 16;
  const spacing = 22;

  const textFields: [string, string][] = [
    // TODO: "Organization Data" header
    ['Legal Name', 'legalName'],
    ['Common Name (optional)', 'alternateName'],
    ['Street Address', 'streetAddress'],
    ['City', 'addressLocality'],
    ['State / Province', 'addressRegion'],
    ['Postal Code', 'postalCode'],
    ['PO Box', 'postOfficeBoxNumber'],
    ['Country', 'addressCountry'], // TODO: select a country in the list as XX - Name of Country in the local language, where "XX" is the 2-letter ISO country
    // TODO: "Legal representative data" header
    ['First Name', 'givenName'],
    ['Last Name', 'familyName'],
    ['Additional Name', 'additionalName'],
    ['Email', 'email'],
    ['Mobile', 'mobile'],
    ['Role', 'role'],
    // TODO:  "Consent data" header
    ['Authorized Organization', 'providerLegalName'],
    ['Authorized Service Name', 'providerServiceName'],
    ['Authorized Service URL', 'providerServiceUrl'],
    ['Consent Terms URL', 'providerTermsUrl'],
  ];

  for (const [label, name] of textFields) {
    drawLabel(label, labelX, y);
    const textField = form.createTextField(name);
    textField.setText('');
    textField.addToPage(page, {
      x: inputX,
      y: y - 4,
      width: fieldWidth,
      height: fieldHeight
    });
    y -= spacing;
  }

  // Dropdown: Identifier
  drawLabel('Identifier', labelX, y);
  const identifierField = form.createDropdown('identifier');
  identifierField.addOptions([
    'VAT ID (TAX)',
    'Employer Number (EI)'
  ]);
  identifierField.select('VAT ID (TAX)');
  identifierField.addToPage(page, {
    x: inputX,
    y: y - 4,
    width: fieldWidth,
    height: fieldHeight
  });
  y -= spacing;

  // Dropdown: Organization Type
  drawLabel('Organization Type', labelX, y);
  const typeField = form.createDropdown('type');
  typeField.addOptions([
    'Healthcare Provider (prov)',
    'Educational Institution (edu)',
    'Government (gov)',
    'Insurance Company (ins)',
    // 'Non-profit (non)',
    // 'Business Company (bus)'
  ]);
  typeField.select('Company (bus)');
  typeField.addToPage(page, {
    x: inputX,
    y: y - 4,
    width: fieldWidth,
    height: fieldHeight
  });
  y -= spacing;

  // Terms and conditions section (static text)
  y -= 30;
  drawLabel('Terms of Service', labelX, y);
  page.drawText(
    '<TODO: Set Terms and Conditions from mark-down template based on the terms URL>',
    {
      x: labelX,
      y: y - 18,
      size: 9,
      font,
      color: rgb(0.3, 0.3, 0.3),
      maxWidth: 500,
      lineHeight: 12
    }
  );

  return await pdfDoc.save();
}
