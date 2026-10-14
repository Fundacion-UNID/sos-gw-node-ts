import {
  ClaimConsent,
  ClaimsPersonSchemaorg,
  getClaimsInFirstDataEntry,
} from 'gdc-common-utils-ts';

import {
  EXAMPLE_INDIVIDUAL_ORGANIZATION_START_INPUT,
  EXAMPLE_LIVE_CONSENT_GRANT_INPUT,
  EXAMPLE_EMPLOYEE_DEVICE_ACTIVATION_INPUT,
  EXAMPLE_GW_ORGANIZATION_ACTIVATE_PAYLOAD,
  EXAMPLE_OPENID_SMART_TOKEN_INPUT,
  EXAMPLE_ORGANIZATION_EMPLOYEE_INPUT,
  EXAMPLE_SMART_PRESENTATION_SUBMISSION,
} from 'gdc-common-utils-ts/examples/api-flow-examples';

import {
  CONSENT_CREATION_MESSAGE,
  FAMILY_REGISTRATION_REQUEST,
  DCR_REQUEST_BODY,
  EMPLOYEE_REGISTRATION_REQUEST,
  ORGANIZATION_ACTIVATION_REQUEST,
  SMART_TOKEN_REQUEST,
} from '../../data/example-payloads';

describe('shared flow examples conformance', () => {
  it('keeps organization-controller activation example aligned with shared organization-controller flow examples', () => {
    expect(ORGANIZATION_ACTIVATION_REQUEST.body.vp_token).toBe(EXAMPLE_GW_ORGANIZATION_ACTIVATE_PAYLOAD.vp_token);
    expect(ORGANIZATION_ACTIVATION_REQUEST.body.controller).toEqual(
      expect.objectContaining({
        did: EXAMPLE_GW_ORGANIZATION_ACTIVATE_PAYLOAD.controller.did,
        publicKeyJwk: EXAMPLE_GW_ORGANIZATION_ACTIVATE_PAYLOAD.controller.publicKeyJwk,
      }),
    );
  });

  it('keeps device activation example aligned with shared organization-controller DCR examples', () => {
    expect(DCR_REQUEST_BODY).toEqual(
      expect.objectContaining({
        application_type: expect.any(String),
        client_name: expect.any(String),
        token_endpoint_auth_method: 'private_key_jwt',
        redirect_uris: expect.any(Array),
        jwks: expect.objectContaining({
          keys: expect.any(Array),
        }),
        ext_device_info: expect.objectContaining({
          device_id: expect.any(String),
        }),
      }),
    );
    expect(EXAMPLE_EMPLOYEE_DEVICE_ACTIVATION_INPUT.dcrPayload).toEqual(
      expect.objectContaining({
        application_type: expect.any(String),
        client_name: expect.any(String),
        redirect_uris: expect.any(Array),
        jwks: expect.objectContaining({
          keys: expect.any(Array),
        }),
      }),
    );
  });

  it('keeps SMART OpenID example aligned with shared professional flow examples', () => {
    expect(SMART_TOKEN_REQUEST.body.vp_token).toBe(EXAMPLE_OPENID_SMART_TOKEN_INPUT.vpToken);
    expect(SMART_TOKEN_REQUEST.body.presentation_submission).toEqual(EXAMPLE_SMART_PRESENTATION_SUBMISSION);
  });

  it('keeps individual onboarding and consent examples on shared individual-controller semantics', () => {
    const familyClaims = getClaimsInFirstDataEntry(FAMILY_REGISTRATION_REQUEST.body) as Record<string, unknown>;
    const consentClaims = CONSENT_CREATION_MESSAGE.body.entry[0].resource.meta.claims as Record<string, unknown>;
    const contextualizedOrganization = familyClaims.Organization as Record<string, unknown> | undefined;
    const contextualizedOwner = contextualizedOrganization?.owner as Record<string, unknown> | undefined;
    const ownerEmail = contextualizedOwner?.email ?? familyClaims['Organization.owner.email'];

    expect(typeof FAMILY_REGISTRATION_REQUEST.iss).toBe('string');
    expect(FAMILY_REGISTRATION_REQUEST.iss).toBe(ownerEmail);
    expect(consentClaims[ClaimConsent.subject]).toBe('{{individualDid}}');
    expect(consentClaims[ClaimConsent.actorRole]).toBe(EXAMPLE_LIVE_CONSENT_GRANT_INPUT.actorRole);
    expect(typeof ownerEmail).toBe('string');
    expect(String(ownerEmail)).toContain('@');
    expect(typeof EXAMPLE_INDIVIDUAL_ORGANIZATION_START_INPUT.controllerEmail).toBe('string');
  });

  it('keeps employee example on canonical role claim key', () => {
    const claims = getClaimsInFirstDataEntry(EMPLOYEE_REGISTRATION_REQUEST.body) as Record<string, unknown>;
    expect(claims).toEqual(
      expect.objectContaining({
        [ClaimsPersonSchemaorg.email]: EXAMPLE_ORGANIZATION_EMPLOYEE_INPUT.employeeClaims[ClaimsPersonSchemaorg.email],
      }),
    );
    expect(Object.prototype.hasOwnProperty.call(claims, ClaimsPersonSchemaorg.hasOccupationalRoleValue)).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(claims, ClaimsPersonSchemaorg.hasOccupation)).toBe(false);
  });
});
