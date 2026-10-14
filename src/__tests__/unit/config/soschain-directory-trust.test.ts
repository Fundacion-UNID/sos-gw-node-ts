// Flow contract: SOSChain presents its signed Firebase token only for verified-contact card discovery; trusted issuer/audience validation grants no role, Consent or SMART authority.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('SOSChain Personal read-only directory trust', () => {
  it('keeps product trust in its deployment overlay rather than the generic environment template', () => {
    const file = 'deploy/profiles/human/staging/configmap.yaml';
    const source = readFileSync(resolve(process.cwd(), file), 'utf8');
    expect(source).toContain('https://securetoken.google.com/soschain-unid-personal-staging');
    expect(source).toContain('"aud":"soschain-unid-personal-staging"');
    const genericTemplate = readFileSync(resolve(process.cwd(), 'env.staging.example'), 'utf8');
    expect(genericTemplate).not.toContain('soschain');
    expect(genericTemplate).not.toContain('unid');
  });
});
