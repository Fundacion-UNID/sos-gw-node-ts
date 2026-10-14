export const TEST_PARTICIPANT = {
  WEB_DOMAIN: 'example.com',
  OFFICIAL_NAME: 'Example Company',
  COMMON_NAME: 'Company',
  VAT_ID: 'ESB12345678',
  COUNTRY_CODE: 'ES',
};

export const TEST_ISSUER = {
  DID: `did:web:${TEST_PARTICIPANT.WEB_DOMAIN}`,
};

export const TEST_TERMS_AND_CONDITIONS = {
  URL: `https://${TEST_PARTICIPANT.WEB_DOMAIN}/trust/terms`,
  DUMMY_CONTENT: 'dummy terms content for test',
};
