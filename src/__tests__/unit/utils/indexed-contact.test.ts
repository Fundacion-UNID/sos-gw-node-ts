import { describe, expect, it } from '@jest/globals';
import {
  normalizeIndexedEmail,
  normalizeIndexedPhone,
  splitIndexedEmails,
  splitIndexedPhones,
} from '../../../utils/indexed-contact';

describe('indexed-contact helpers', () => {
  it('normalizes indexed emails without keeping the mailto prefix', () => {
    expect(normalizeIndexedEmail('  mailto:Controller@Acme.Org  ')).toBe('controller@acme.org');
    expect(normalizeIndexedEmail(' Controller@Acme.Org ')).toBe('controller@acme.org');
  });

  it('normalizes indexed phones to the tel form without formatting noise', () => {
    expect(normalizeIndexedPhone('  tel:+34 600 111 222  ')).toBe('tel:+34600111222');
    expect(normalizeIndexedPhone('+34 600 111 222')).toBe('tel:+34600111222');
  });

  it('splits and canonicalizes comma-separated owner email and phone claims', () => {
    expect(splitIndexedEmails(' Parent1@Acme.Org, mailto:Parent2@Acme.Org ')).toEqual([
      'parent1@acme.org',
      'parent2@acme.org',
    ]);
    expect(splitIndexedPhones(' +34 600 111 222, tel:+34 600 333 444 ')).toEqual([
      'tel:+34600111222',
      'tel:+34600333444',
    ]);
  });
});
