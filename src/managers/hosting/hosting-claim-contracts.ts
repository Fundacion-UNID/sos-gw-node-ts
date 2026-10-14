import {
  ClaimsOfferSchemaorg,
  ClaimsOrderSchemaorg,
  ClaimsOrganizationSchemaorg,
  ClaimsServiceSchemaorg,
} from 'gdc-common-utils-ts/constants/schemaorg';
import { toExternalClaimLabel } from '../../utils/claim-contract';

/**
 * Minimum gateway-enforced claim contracts for host legal-organization flows.
 *
 * These constants document the specific claim paths that GW itself treats as
 * non-optional in addition to any broader schema validation.
 */
export const HOST_TRANSACTION_REQUIRED_INPUT_CLAIMS = [
  ClaimsOrganizationSchemaorg.alternateName,
  ClaimsServiceSchemaorg.category,
] as const;

export const HOST_TRANSACTION_REQUIRED_OUTPUT_CLAIMS = [
  ClaimsOfferSchemaorg.identifier,
] as const;

export const HOST_ACTIVATE_REQUIRED_INPUT_CLAIMS = [
  ClaimsOrganizationSchemaorg.alternateName,
  ClaimsServiceSchemaorg.category,
  ClaimsOrganizationSchemaorg.addressCountry,
] as const;

export const HOST_ACTIVATE_REQUIRED_OUTPUT_CLAIMS = [
  ClaimsOfferSchemaorg.identifier,
] as const;

export const HOST_ORDER_REQUIRED_INPUT_CLAIMS = [
  ClaimsOrderSchemaorg.acceptedOfferIdentifier,
] as const;

export const HOST_ORDER_REQUIRED_INPUT_DISPLAY_CLAIMS = [
  toExternalClaimLabel(ClaimsOrderSchemaorg.acceptedOfferIdentifier),
] as const;
