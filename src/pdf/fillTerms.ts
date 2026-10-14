// src/pdf/fillTermsPdf.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import fs from 'fs';
import { PDFDocument } from 'pdf-lib';

export enum TermsForm {
    entityLegalName = 'legalName',
    entityAlternateName = 'alternateName', // common name
    legalIdentifier = 'identifier',
    entitySector = 'type',
    email = 'email',
    mobile = 'mobile',
    personalFullNameICAO = 'name',
    personalGivenNames = 'givenName',
    personalSurname1 = 'familyName',
    personalSurname2 = 'additionalName',
    streetAddress = 'streetAddress',
    addressLocality = 'addressLocality', // e.g. city
    addressRegion = 'addressRegion', // e.g. state or province
    postalCode = 'postalCode',
    postOfficeBoxNumber = 'postOfficeBoxNumber',
    addressCountry = 'addressCountry', // required for current data residency
    providerLegalName = 'Antifraud Services LLC',
    providerAlternateName = 'antifraud.services',
    providerBrandLogoURL = 'https://connecthealth.info/wp-content/uploads/2021/01/connecthealth-logoa.png',
    providerLegalIdentifier = '<US-WA TAX ID>',
    recipientUrl = 'recipientUrl',
    termsUrl = 'string',
    // termsOfService = 'string',
};

export interface ConsentIndividualData {
    name: string;       // ICAO 9303 full legal name (upper case)
    identifier: string; // National Identity Document, Passport, Driver license (e.g.: https://terminology.hl7.org/CodeSystem-v2-0203.html)
    role?: string;      // single, partner, parent, son / daughter, grandparent, ...
    recipientUrl: string; // required
    termsUrl: string;   // requiered
    // individual's address
    streetAddress?: string;
    addressLocality?: string; // e.g. city
    addressRegion?: string; // e.g. state or province
    postalCode?: string;
    postOfficeBoxNumber?: string;
    addressCountry: string; // required for current data residency
    // contact data
    email: string;      // email will be always required
    mobile?: string;    // mobile is for OTP when provided
}

export interface ConsentEntityData {
    legalName: string; // organization's legal name (upper case)
    alternateName?: string // organization's common name
    identifier: string; // TAX or Employer Number (e.g.: https://terminology.hl7.org/CodeSystem-v2-0203.html)
    type: string; // e.g.: https://hl7.org/fhir/R5/valueset-organization-type.html
    recipientUrl: string;
    termsUrl: string;
    
    // organization's official address
    streetAddress?: string;
    addressLocality?: string; // e.g. city
    addressRegion?: string; // e.g. state or province
    postalCode?: string;
    postOfficeBoxNumber?: string;
    addressCountry: string; // required for current data residency

    // representative data
    givenName: string, // local given name(s) and middle name (s) with special characters
    familyName: string, // first surname in the local language (including special characters).
    additionalName: string, // second surname in Spanish spoken countries or mother's maiden name in the US and other countries
    email: string;
    mobile: string;
    role: string; // ISCO08 employee role
}

export async function fillPersonalTermsPdf(templatePath: string, data: ConsentIndividualData): Promise<Uint8Array> {
    const existingPdfBytes = fs.readFileSync(templatePath);
    const pdfDoc = await PDFDocument.load(existingPdfBytes);
    const form = pdfDoc.getForm();

    form.getTextField(TermsForm.email).setText(data.email);
    form.getTextField(TermsForm.personalFullNameICAO).setText(data.name);
    form.getTextField(TermsForm.recipientUrl).setText(data.recipientUrl);
    form.getTextField(TermsForm.termsUrl).setText(data.termsUrl);

    form.flatten();
    return await pdfDoc.save();
}

export async function fillEntityTermsPdf(templatePath: string, data: ConsentEntityData): Promise<Uint8Array> {
    const existingPdfBytes = fs.readFileSync(templatePath);
    const pdfDoc = await PDFDocument.load(existingPdfBytes);
    const form = pdfDoc.getForm();

    form.getTextField(TermsForm.entityLegalName).setText(data.legalName);
    form.getTextField(TermsForm.entitySector).setText(data.type);
    form.getTextField(TermsForm.email).setText(data.email);
    form.getTextField(TermsForm.mobile).setText(data.mobile);
    form.getTextField(TermsForm.personalGivenNames).setText(data.givenName);
    form.getTextField(TermsForm.personalSurname1).setText(data.familyName);
    form.getTextField(TermsForm.personalSurname2).setText(data.alternateName);
    form.getTextField(TermsForm.recipientUrl).setText(data.recipientUrl);
    form.getTextField(TermsForm.termsUrl).setText(data.termsUrl);

    form.flatten();
    return await pdfDoc.save();
}
