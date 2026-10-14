// Flow contract: a verified professional route matches its exact ISO 3166-2 subdivision or a controller grant for its ISO 3166-1 country; subdivision grants never broaden to country or sibling regions.
import { OpenIdAuthManager } from '../../../managers/OpenIdAuthManager';

describe('regional Consent actor matching', () => {
  const manager = new OpenIdAuthManager({} as any, {} as any, {} as any, {} as any) as any;

  it('preserves exact ISO 3166-2 subdivisions and canonical country actors', () => {
    expect(manager.normalizeJurisdictionRuleActor('urn:iso:3166-2:CA-BC')).toBe('CA-BC');
    expect(manager.normalizeJurisdictionRuleActor('urn:iso:3166-2:US-WA')).toBe('US-WA');
    expect(manager.normalizeJurisdictionRuleActor('urn:iso:3166:ES')).toBe('ES');
  });

  it('rejects malformed or over-broad jurisdiction actors', () => {
    expect(manager.normalizeJurisdictionRuleActor('urn:iso:3166-2:CA')).toBeUndefined();
    expect(manager.normalizeJurisdictionRuleActor('urn:iso:3166-2:CA-BC:any')).toBeUndefined();
    expect(manager.normalizeJurisdictionRuleActor('CA-BC')).toBe('CA-BC');
  });

  it('matches a standing regional rule only to the professional route in that exact subdivision', () => {
    const actor = {
      sub: 'did:web:clinic.example:employee:vet-1',
      organization: 'did:web:clinic.example',
    };
    const rule = { 'Consent.actor-identifier': 'urn:iso:3166-2:CA-BC' };

    expect(manager.resolveRuleMatchKind(rule, actor, undefined, 'CA-BC')).toBe('jurisdiction');
    expect(manager.resolveRuleMatchKind(rule, actor, undefined, 'CA-AB')).toBeUndefined();
    expect(manager.resolveRuleMatchKind(rule, actor, undefined, 'US-WA')).toBeUndefined();
  });

  it('lets a country rule cover its subdivisions without crossing a country boundary', () => {
    const actor = {
      sub: 'did:web:clinic.example:employee:vet-1',
      organization: 'did:web:clinic.example',
    };
    const rule = { 'Consent.actor-identifier': 'urn:iso:3166:CA' };

    expect(manager.resolveRuleMatchKind(rule, actor, undefined, 'CA')).toBe('jurisdiction');
    expect(manager.resolveRuleMatchKind(rule, actor, undefined, 'CA-BC')).toBe('jurisdiction');
    expect(manager.resolveRuleMatchKind(rule, actor, undefined, 'CA-ON')).toBe('jurisdiction');
    expect(manager.resolveRuleMatchKind(rule, actor, undefined, 'US-WA')).toBeUndefined();
  });
});
