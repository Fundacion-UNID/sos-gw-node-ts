// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
import { describe, expect, it } from '@jest/globals';
import { randomUUID } from 'node:crypto';
import { ClaimsOrderSchemaorg } from 'gdc-common-utils-ts/constants/schemaorg';
import { readPendingOrderAcceptedOfferId } from '../../../routes/api';
import { toExternalClaimLabel } from '../../../utils/claim-contract';

describe('pending Order bootstrap claim resolution', () => {
  it('resolves the canonical Order claim under its declared schema.org context', () => {
    const offerId = `urn:uuid:${randomUUID()}`;
    const claimName = ClaimsOrderSchemaorg.acceptedOfferIdentifier;
    const claimContext = claimName.split('.').slice(0, 2).join('.');

    expect(readPendingOrderAcceptedOfferId({
      '@context': claimContext,
      [toExternalClaimLabel(claimName)]: offerId,
    })).toBe(offerId);
  });
});
