/**
 * One-code contract: the value that proves postal delivery is the exact value
 * assigned to the controller license and later consumed by exchange/DCR.
 */
import { scryptSync } from 'node:crypto';
import { ClaimsOrderSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { POSTAL_ACTIVATION_CODE_BINDING_ALGORITHM, type PostalActivationCodeBinding } from 'gdc-common-utils-ts/utils/organization-test-network-credential';
import {
  EXAMPLE_POSTAL_ACTIVATION_CODE,
  EXAMPLE_POSTAL_ACTIVATION_CODE_INVALID,
  EXAMPLE_POSTAL_ACTIVATION_PEPPER,
  EXAMPLE_POSTAL_ACTIVATION_SALT,
} from 'gdc-common-utils-ts/examples/shared';
import { verifyBoundPostalActivationCode } from '../../../managers/hosting/postal-activation-code';

describe('postal activation code binding', () => {
  const code = EXAMPLE_POSTAL_ACTIVATION_CODE;
  const pepper = EXAMPLE_POSTAL_ACTIVATION_PEPPER;
  const salt = EXAMPLE_POSTAL_ACTIVATION_SALT;
  const binding: PostalActivationCodeBinding = {
    algorithm: POSTAL_ACTIVATION_CODE_BINDING_ALGORITHM,
    salt,
    digest: scryptSync(`${code}:${pepper}`, salt, 32).toString('base64url'),
  };

  it('returns the normalized clear code only after protected-binding verification', () => {
    expect(verifyBoundPostalActivationCode(
      { [ClaimsOrderSchemaorg.confirmationNumber]: code.toLowerCase() }, binding, pepper,
    )).toBe(code);
  });

  it('fails closed for another code or a missing host pepper', () => {
    expect(() => verifyBoundPostalActivationCode(
      { [ClaimsOrderSchemaorg.confirmationNumber]: EXAMPLE_POSTAL_ACTIVATION_CODE_INVALID }, binding, pepper,
    )).toThrow('does not match');
    expect(() => verifyBoundPostalActivationCode(
      { [ClaimsOrderSchemaorg.confirmationNumber]: code }, binding, undefined,
    )).toThrow('binding is incomplete');
  });
});
