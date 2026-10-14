// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/models/env.ts

/**
 * Defines the canonical names for Host Organization environment variables.
 * Using an enum provides a single source of truth and prevents typos.
 */
export enum HostEnvVars {
    // Service config
    DOMAIN = 'ORG_HOST_DOMAIN',
    PORT = 'ORG_HOST_PORT',
    DB_TYPE = 'ORG_HOST_DB_TYPE',

    // Organization Identity
    JURISDICTION = 'ORG_HOST_JURISDICTION',
    ID_TYPE = 'ORG_HOST_ID_TYPE',
    ID_VALUE = 'ORG_HOST_ID_VALUE',
    LEGAL_NAME = 'ORG_HOST_LEGAL_NAME',
    DUNS = 'ORG_HOST_DUNS',

    // Admin Identity & Keys
    ADMIN_EMAIL = 'ORG_HOST_ADMIN_EMAIL',
    ADMIN_ROLE = 'ORG_HOST_ADMIN_ROLE',
    ADMIN_UID = 'ORG_HOST_ADMIN_UID',
    ADMIN_ENC_KID = 'ORG_HOST_ADMIN_ENC_KID',
    ADMIN_SIG_KID = 'ORG_HOST_ADMIN_SIG_KID',

    // Terms of Service
    TERMS_URL = 'ORG_HOST_TERMS_URL',
    TERMS_SIGNED_BASE64URL = 'ORG_HOST_TERMS_SIGNED_BASE64URL',
}
