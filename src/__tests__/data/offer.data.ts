// src/__tests__/data/offer.data.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { ClaimsOfferSchemaorg } from "gdc-common-utils-ts/constants/schemaorg";

export const testClaimsOfferEntityExpanded = {
    [ClaimsOfferSchemaorg.acceptedPaymentMethod]: "Stripe",
    [ClaimsOfferSchemaorg.category]: "health-care",
    [ClaimsOfferSchemaorg.checkoutPageURLTemplate]: "<payment-url>",
    [ClaimsOfferSchemaorg.eligibleCustomerType]: "employee",
    [ClaimsOfferSchemaorg.eligibleQuantityValue]: 2, // for the legal representative and a first employee
    [ClaimsOfferSchemaorg.identifier]: "urn:cds-<jurisdiction>:v1:<sector>:product:org.schema:Offer:<offer-uuid>",
    [ClaimsOfferSchemaorg.itemOfferedName]: "License Tier XS",
    [ClaimsOfferSchemaorg.itemOfferedSku]: "web-or-app-identifier",
    [ClaimsOfferSchemaorg.offeredBy]: "did:web:host.example.com",
    [ClaimsOfferSchemaorg.price]: "0.00",
    [ClaimsOfferSchemaorg.priceCurrency]: "EUR",
    [ClaimsOfferSchemaorg.serialNumber]: "<license1>,<license2>"
}

export const testClaimsOfferFamilyExpanded = {
    [ClaimsOfferSchemaorg.acceptedPaymentMethod]: "Stripe",
    [ClaimsOfferSchemaorg.category]: "health-care",
    [ClaimsOfferSchemaorg.checkoutPageURLTemplate]: "<payment-url>",
    [ClaimsOfferSchemaorg.eligibleCustomerType]: "individual",
    [ClaimsOfferSchemaorg.eligibleQuantityValue]: 2, // for the representative and the subject (individual / customer / patient / donor)
    [ClaimsOfferSchemaorg.identifier]: "urn:cds-<jurisdiction>:v1:<sector>:product:org.schema:Offer:<offer-uuid>",
    [ClaimsOfferSchemaorg.itemOfferedName]: "License Tier XS",
    [ClaimsOfferSchemaorg.itemOfferedSku]: "web-or-app-identifier",
    [ClaimsOfferSchemaorg.offeredBy]: "did:web:gateway.example.com",
    [ClaimsOfferSchemaorg.price]: "0.00",
    [ClaimsOfferSchemaorg.priceCurrency]: "EUR",
    [ClaimsOfferSchemaorg.serialNumber]: "<license1>,<license2>"
}