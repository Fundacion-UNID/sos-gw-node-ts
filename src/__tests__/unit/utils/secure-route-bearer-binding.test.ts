// Flow contract: a registered profile wallet may bootstrap and poll its first SMART token with an OIDC account bearer, while every other secure actor route remains bearer-bound to the message issuer.
import {
  isRegisteredProfileAccountDirectoryRoute,
  isVerifiedBearerBoundToRegisteredProfile,
  requiresVerifiedBearerActorBindingForSecureRoute,
} from '../../../utils/secure-route-bearer-binding';
import {
  IdentityAuthActions,
  IdentityAuthResourceTypes,
  SmartPostDcrActions,
} from 'gdc-common-utils-ts/constants/identity-auth';
import {
  GatewayRouteFormats,
  GatewayRouteSections,
} from 'gdc-common-utils-ts/constants/gateway-response';
import { SecureIdTypesIndividual } from 'gdc-common-utils-ts/constants/identity-identifiers';
import {
  EXAMPLE_ACCOUNT_OWNER_ID,
  EXAMPLE_DEVICE_CLIENT_ID,
  EXAMPLE_FORM_CONTROLLER_PHONE,
  EXAMPLE_FORM_SUBJECT_PHONE,
  EXAMPLE_HOSTED_INDIVIDUAL_DID,
  EXAMPLE_INDIVIDUAL_CONTROLLER_ROLE_TYPE,
  EXAMPLE_INDIVIDUAL_CONTROLLER_ROLE_VALUE,
} from 'gdc-common-utils-ts/examples/shared';
import {
  buildIndividualMemberDidWeb,
  buildSecureIdValueMember,
} from 'gdc-common-utils-ts/utils/did';

describe('secure route bearer binding', () => {
  it.each(Object.values(SmartPostDcrActions))(
    'uses DCR wallet proof instead of pre-existing SMART bearer binding for Smart/%s',
    (action) => {
      expect(requiresVerifiedBearerActorBindingForSecureRoute({
        section: GatewayRouteSections.Identity,
        format: GatewayRouteFormats.OpenId,
        resourceType: IdentityAuthResourceTypes.Smart,
        action,
      })).toBe(false);
    },
  );

  it('keeps normal secure individual actions bound to the verified bearer actor', () => {
    expect(requiresVerifiedBearerActorBindingForSecureRoute({
      section: GatewayRouteSections.Identity,
      format: GatewayRouteFormats.OpenId,
      resourceType: IdentityAuthResourceTypes.Smart,
      action: IdentityAuthActions.Search,
    })).toBe(true);
  });

  it.each([
    ['Organization', '_search'],
    ['Organization', '_search-response'],
    ['License', '_search'],
    ['License', '_search-response'],
  ])('recognizes only the registered-profile pre-SMART directory route %s/%s', (resourceType, action) => {
    const route = {
      section: 'individual',
      format: 'org.schema',
      resourceType,
      action,
    };
    expect(isRegisteredProfileAccountDirectoryRoute(route)).toBe(true);
    expect(requiresVerifiedBearerActorBindingForSecureRoute(route)).toBe(false);
  });

  it.each([
    ['registry', 'org.schema', 'Organization', '_search'],
    ['individual', 'org.hl7.fhir.r4', 'Organization', '_search'],
    ['individual', 'org.schema', 'Employee', '_search'],
    ['individual', 'org.schema', 'Organization', '_batch'],
  ])('does not widen the account-bound directory exception to %s/%s/%s/%s', (
    section,
    format,
    resourceType,
    action,
  ) => {
    expect(isRegisteredProfileAccountDirectoryRoute({ section, format, resourceType, action })).toBe(false);
    expect(requiresVerifiedBearerActorBindingForSecureRoute({ section, format, resourceType, action })).toBe(true);
  });

  it('accepts a verified account only when sub, actor and one issued contact match the protected DCR profile', () => {
    const actorDid = 'did:web:example.org:individual:multibase:z123:member:z456:role:RESPRSN';
    const profile = {
      clientId: 'client-1',
      actorDid,
      profileDid: actorDid,
      authenticatedSubject: 'firebase-account-1',
      authenticatedEmail: 'owner@example.org',
      authenticatedTelephone: 'tel:+16045550123',
    };

    expect(isVerifiedBearerBoundToRegisteredProfile({
      payload: {
        sub: 'firebase-account-1',
        email: 'OWNER@example.org',
        email_verified: true,
      },
      senderDid: actorDid,
      clientId: 'client-1',
      deviceProfile: profile,
    })).toBe(true);
    expect(isVerifiedBearerBoundToRegisteredProfile({
      payload: {
        sub: 'firebase-account-1',
        phone_number: '+1 (604) 555-0123',
        phone_number_verified: true,
      },
      senderDid: actorDid,
      clientId: 'client-1',
      deviceProfile: profile,
    })).toBe(true);
  });

  it('recovers a legacy registered profile whose verified phone is still bound by its actor DID', () => {
    const actorDid = buildIndividualMemberDidWeb({
      individualDidWeb: EXAMPLE_HOSTED_INDIVIDUAL_DID,
      memberId: buildSecureIdValueMember({
        secureIdTypeMember: SecureIdTypesIndividual.Phone,
        privateIdValueMember: EXAMPLE_FORM_CONTROLLER_PHONE,
      }),
      roleType: EXAMPLE_INDIVIDUAL_CONTROLLER_ROLE_TYPE,
      roleValue: EXAMPLE_INDIVIDUAL_CONTROLLER_ROLE_VALUE,
    });
    const legacyProfileWithoutCopiedContact = {
      clientId: EXAMPLE_DEVICE_CLIENT_ID,
      actorDid,
      profileDid: actorDid,
      authenticatedSubject: EXAMPLE_ACCOUNT_OWNER_ID,
    };

    expect(isVerifiedBearerBoundToRegisteredProfile({
      payload: {
        sub: EXAMPLE_ACCOUNT_OWNER_ID,
        phone_number: EXAMPLE_FORM_CONTROLLER_PHONE,
      },
      senderDid: actorDid,
      clientId: EXAMPLE_DEVICE_CLIENT_ID,
      deviceProfile: legacyProfileWithoutCopiedContact,
    })).toBe(true);
    expect(isVerifiedBearerBoundToRegisteredProfile({
      payload: {
        sub: EXAMPLE_ACCOUNT_OWNER_ID,
        phone_number: EXAMPLE_FORM_SUBJECT_PHONE,
      },
      senderDid: actorDid,
      clientId: EXAMPLE_DEVICE_CLIENT_ID,
      deviceProfile: legacyProfileWithoutCopiedContact,
    })).toBe(false);
  });

  it.each([
    {
      label: 'wrong account subject',
      payload: { sub: 'firebase-account-2', email: 'owner@example.org', email_verified: true },
      senderDid: 'did:web:example.org:individual:multibase:z123:member:z456:role:RESPRSN',
      clientId: 'client-1',
    },
    {
      label: 'wrong actor DID',
      payload: { sub: 'firebase-account-1', email: 'owner@example.org', email_verified: true },
      senderDid: 'did:web:example.org:individual:multibase:z999:member:z456:role:RESPRSN',
      clientId: 'client-1',
    },
    {
      label: 'wrong registered client',
      payload: { sub: 'firebase-account-1', email: 'owner@example.org', email_verified: true },
      senderDid: 'did:web:example.org:individual:multibase:z123:member:z456:role:RESPRSN',
      clientId: 'client-2',
    },
    {
      label: 'unverified contact',
      payload: { sub: 'firebase-account-1', email: 'owner@example.org', email_verified: false },
      senderDid: 'did:web:example.org:individual:multibase:z123:member:z456:role:RESPRSN',
      clientId: 'client-1',
    },
    {
      label: 'different contact',
      payload: { sub: 'firebase-account-1', email: 'attacker@example.org', email_verified: true },
      senderDid: 'did:web:example.org:individual:multibase:z123:member:z456:role:RESPRSN',
      clientId: 'client-1',
    },
  ])('rejects a registered-profile directory request with $label', ({ payload, senderDid, clientId }) => {
    const actorDid = 'did:web:example.org:individual:multibase:z123:member:z456:role:RESPRSN';
    expect(isVerifiedBearerBoundToRegisteredProfile({
      payload,
      senderDid,
      clientId,
      deviceProfile: {
        clientId: 'client-1',
        actorDid,
        profileDid: actorDid,
        authenticatedSubject: 'firebase-account-1',
        authenticatedEmail: 'owner@example.org',
        authenticatedTelephone: 'tel:+16045550123',
      },
    })).toBe(false);
  });
});
