import { scryptSync, timingSafeEqual } from 'node:crypto';
import { IssueType } from 'gdc-common-utils-ts/models/issue';
import { ManagerError } from 'gdc-common-utils-ts/utils/manager-error';
import { ClaimsOrderSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { POSTAL_ACTIVATION_CODE_BINDING_ALGORITHM, type PostalActivationCodeBinding } from 'gdc-common-utils-ts/utils/organization-test-network-credential';

/**
 * Verifies the clear code supplied at Order against the protected VC binding.
 * The pepper is host-only; the salted digest in the VC is not sufficient for
 * an offline guess. Clear code material must never be logged by callers.
 */
export function verifyBoundPostalActivationCode(
  orderClaims: Record<string, unknown>,
  binding: PostalActivationCodeBinding,
  pepper: string | undefined,
): string {
  const code = String(orderClaims[ClaimsOrderSchemaorg.confirmationNumber] || '').trim().toUpperCase();
  const { algorithm, salt, digest } = binding;
  const normalizedPepper = String(pepper || '').trim();
  if (!code || algorithm !== POSTAL_ACTIVATION_CODE_BINDING_ALGORITHM || !salt || !digest || !normalizedPepper) {
    throw new ManagerError('Postal activation code binding is incomplete.', IssueType.Security);
  }
  const actual = scryptSync(`${code}:${normalizedPepper}`, salt, 32);
  const expected = Buffer.from(digest, 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new ManagerError('Postal activation code does not match the delivered licence.', IssueType.Security);
  }
  return code;
}
