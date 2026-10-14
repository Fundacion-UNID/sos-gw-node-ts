import {
  IdentityAuthResourceTypes,
  SmartPostDcrActions,
} from 'gdc-common-utils-ts/constants/identity-auth';
import {
  GatewayRouteFormats,
  GatewayRouteSections,
} from 'gdc-common-utils-ts/constants/gateway-response';
import { SecureIdTypesIndividual } from 'gdc-common-utils-ts/constants/identity-identifiers';
import {
  buildSecureIdValueMember,
  parseIndividualMemberDidWeb,
} from 'gdc-common-utils-ts/utils/did';
import { normalizeIndexedEmail, normalizeIndexedPhone } from './indexed-contact';

type SecureRouteIdentity = Readonly<{
  section?: string;
  format?: string;
  resourceType?: string;
  action?: string;
}>;

type RegisteredProfileAccountBindingInput = Readonly<{
  payload?: Readonly<Record<string, unknown>>;
  senderDid: string;
  clientId: string;
  deviceProfile?: Readonly<Record<string, unknown>>;
}>;

const REGISTERED_PROFILE_DIRECTORY_RESOURCE_TYPES = new Set(['organization', 'license']);
const REGISTERED_PROFILE_DIRECTORY_ACTIONS = new Set(['_search', '_search-response']);

/**
 * Identifies the exact pre-SMART directory surface used by one registered
 * personal wallet to discover its authorized subjects. No data mutation,
 * professional directory or native-FHIR route is included in this exception.
 */
export function isRegisteredProfileAccountDirectoryRoute(
  route: SecureRouteIdentity,
): boolean {
  const section = String(route.section || '').trim().toLowerCase();
  const format = String(route.format || '').trim().toLowerCase();
  const resourceType = String(route.resourceType || '').trim().toLowerCase();
  const action = String(route.action || '').trim().toLowerCase();
  return section === 'individual'
    && format === GatewayRouteFormats.SchemaOrg
    && REGISTERED_PROFILE_DIRECTORY_RESOURCE_TYPES.has(resourceType)
    && REGISTERED_PROFILE_DIRECTORY_ACTIONS.has(action);
}

/**
 * Binds one pre-SMART directory request to the protected DCR profile that
 * signed it. The provider-local OIDC subject, operational actor DID, DCR
 * client and one verified issued contact are independent values and all must
 * match. For a legacy profile that predates persisted contact fields, the
 * verified bearer contact must reproduce the exact hashed member segment of
 * the registered actor DID. This does not grant access to any subject; the
 * directory managers still enforce requested contact/relationship filters.
 */
export function isVerifiedBearerBoundToRegisteredProfile(
  input: RegisteredProfileAccountBindingInput,
): boolean {
  const profile = input.deviceProfile;
  if (!profile) return false;
  const payload = input.payload || {};
  const senderDid = String(input.senderDid || '').trim();
  const clientId = String(input.clientId || '').trim();
  if (!senderDid || !clientId
    || String(profile.clientId || '').trim() !== clientId
    || String(profile.actorDid || '').trim() !== senderDid
    || String(profile.profileDid || '').trim() !== senderDid
    || String(profile.authenticatedSubject || '').trim() !== String(payload.sub || '').trim()) {
    return false;
  }

  const storedEmail = normalizeIndexedEmail(profile.authenticatedEmail);
  const bearerEmail = payload.email_verified === true
    ? normalizeIndexedEmail(payload.email)
    : undefined;
  if (storedEmail && bearerEmail === storedEmail) return true;

  const storedPhone = normalizeIndexedPhone(profile.authenticatedTelephone);
  const bearerPhone = payload.phone_number_verified !== false
    ? normalizeIndexedPhone(payload.phone_number)
    : undefined;
  if (storedPhone) return bearerPhone === storedPhone;

  // Compatibility for an already-registered individual controller created by
  // an older DCR runtime that protected the OIDC subject and actor DID but did
  // not copy the issued contact into the device profile. The contact is not
  // trusted merely because it appears in the current bearer: its canonical
  // SHA3-384 member identifier must be the exact member segment already bound
  // into the registered actor DID. Once either protected contact exists above,
  // this fallback is deliberately unavailable.
  if (!storedEmail && !storedPhone) {
    try {
      const registeredMemberId = parseIndividualMemberDidWeb(senderDid).memberId;
      const bearerMemberIds = [
        bearerEmail
          ? buildSecureIdValueMember({
              secureIdTypeMember: SecureIdTypesIndividual.Email,
              privateIdValueMember: bearerEmail,
            })
          : undefined,
        bearerPhone
          ? buildSecureIdValueMember({
              secureIdTypeMember: SecureIdTypesIndividual.Phone,
              privateIdValueMember: bearerPhone,
            })
          : undefined,
      ].filter((value): value is string => Boolean(value));
      return bearerMemberIds.includes(registeredMemberId);
    } catch {
      return false;
    }
  }
  return false;
}

/** Server-authored marker carried with the queued directory job. */
export const REGISTERED_PROFILE_ACCOUNT_DIRECTORY_META = 'registeredProfileAccountDirectory';

/**
 * The post-DCR SMART `token` request and canonical `token-response` poll are
 * authenticated by the account OIDC bearer plus the registered DCR wallet and
 * private_key_jwt. The signed-message actor DID and registered client id remain
 * distinct identities. A SMART bearer cannot exist until this exchange
 * completes. Every other secure actor route retains the normal
 * bearer-to-message-issuer binding.
 */
export function requiresVerifiedBearerActorBindingForSecureRoute(
  route: SecureRouteIdentity,
): boolean {
  const section = String(route.section || '').trim().toLowerCase();
  const format = String(route.format || '').trim().toLowerCase();
  const resourceType = String(route.resourceType || '').trim().toLowerCase();
  const action = String(route.action || '').trim().toLowerCase();
  // TODO: Remove the legacy polling alias after installed SDKs have migrated
  // to the canonical token-response action.
  const isSmartBootstrap = section === GatewayRouteSections.Identity
    && format === GatewayRouteFormats.OpenId
    && resourceType === IdentityAuthResourceTypes.Smart
    && (
      action === SmartPostDcrActions.Token
      || action === SmartPostDcrActions.TokenResponse
      || action === SmartPostDcrActions.LegacyBatchResponse
    );
  return !isSmartBootstrap && !isRegisteredProfileAccountDirectoryRoute(route);
}
