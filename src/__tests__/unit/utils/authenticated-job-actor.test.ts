// Flow contract: a registered DCR actor is bound either by an exact SMART subject DID or by the same verified OIDC contact hash embedded in its canonical professional DID; unverified contacts never authorize it.
import { buildProfessionalDidWeb } from 'gdc-common-utils-ts/utils/did';
import {
  EXAMPLE_EMAIL_CONTROLLER_INDIVIDUAL,
  EXAMPLE_EMAIL_CONTROLLER_ORG,
  EXAMPLE_ACCOUNT_OWNER_ID,
  EXAMPLE_HOSTED_PROVIDER_DID,
  EXAMPLE_KYC_CONTROLLER_TELEPHONE,
  EXAMPLE_ORGANIZATION_CONTROLLER_ROLE,
} from 'gdc-common-utils-ts/examples/shared';
import type { JobRequest } from 'gdc-common-utils-ts/models/confidential-job';
import {
  getAuthenticatedJobActorIdentifiers,
  isVerifiedBearerBoundToActorDid,
} from '../../../utils/authenticated-job-actor';

describe('authenticated job actor binding', () => {
  const email = EXAMPLE_EMAIL_CONTROLLER_INDIVIDUAL;
  const actorDid = buildProfessionalDidWeb({
    organizationDidWeb: EXAMPLE_HOSTED_PROVIDER_DID,
    email,
    role: EXAMPLE_ORGANIZATION_CONTROLLER_ROLE,
  });

  it('derives linked contact identifiers from Firebase identities when custom-token ID tokens omit top-level contact claims', () => {
    const identifiers = getAuthenticatedJobActorIdentifiers({
      content: {
        meta: { bearer: { jwt: { payload: {
          sub: EXAMPLE_ACCOUNT_OWNER_ID,
          firebase: { sign_in_provider: 'custom', identities: {
              email: [EXAMPLE_EMAIL_CONTROLLER_INDIVIDUAL],
              phone: [EXAMPLE_KYC_CONTROLLER_TELEPHONE],
            } },
        } } } },
      },
    } as unknown as JobRequest);

    expect(identifiers).toEqual(expect.arrayContaining([
      expect.stringMatching(/^urn:multibase:/),
    ]));
    expect(identifiers).toHaveLength(2);
  });

  it('binds a verified OIDC email to the canonical DCR actor without requiring its unrelated account subject to equal the DID', () => {
    expect(isVerifiedBearerBoundToActorDid({
      sub: EXAMPLE_ACCOUNT_OWNER_ID,
      email,
      email_verified: true,
    }, actorDid)).toBe(true);
  });

  it('binds a Firebase linked identity when the custom-token exchange omits the top-level contact', () => {
    expect(isVerifiedBearerBoundToActorDid({
      sub: EXAMPLE_ACCOUNT_OWNER_ID,
      firebase: { sign_in_provider: 'custom', identities: { email: [email] } },
    }, actorDid)).toBe(true);
  });

  it('does not treat an unverified non-custom linked identity as verified contact evidence', () => {
    expect(isVerifiedBearerBoundToActorDid({
      sub: EXAMPLE_ACCOUNT_OWNER_ID,
      firebase: { sign_in_provider: 'password', identities: { email: [email] } },
    }, actorDid)).toBe(false);
  });

  it('rejects an unverified or different account contact', () => {
    expect(isVerifiedBearerBoundToActorDid({ email, email_verified: false }, actorDid)).toBe(false);
    expect(isVerifiedBearerBoundToActorDid({
      email: EXAMPLE_EMAIL_CONTROLLER_ORG,
      email_verified: true,
    }, actorDid)).toBe(false);
  });
});
