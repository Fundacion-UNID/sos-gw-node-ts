import { readFileSync } from 'node:fs';
import { FirebaseTokenVerifier } from '../../../auth/FirebaseTokenVerifier';
import { allowedFirebaseProjectIds, firebaseTokenAudience } from '../../../auth/firebase-token-policy';

/**
 * Environment contract under test:
 * 1. FIREBASE_PROJECT_ID is the primary GW Admin/data project.
 * 2. FIREBASE_ADDITIONAL_AUTH_PROJECT_IDS adds only trusted token audiences.
 * 3. A public portal/GW URL is never a Firebase token audience.
 */
describe('FirebaseTokenVerifier project boundary', () => {
  it('accepts the primary data project and explicit portal auth projects', () => {
    expect(allowedFirebaseProjectIds({
      FIREBASE_PROJECT_ID: 'primary-project',
      FIREBASE_ADDITIONAL_AUTH_PROJECT_IDS: 'portal-project, primary-project',
    })).toEqual(['primary-project', 'portal-project']);
  });

  it('reads the audience only to select an allowlisted verifier', () => {
    const payload = Buffer.from(JSON.stringify({ aud: 'portal-project' })).toString('base64url');
    expect(firebaseTokenAudience(`header.${payload}.signature`)).toBe('portal-project');
    expect(firebaseTokenAudience('not-a-jwt')).toBeUndefined();
  });

  it('does not confuse an HTTPS origin with a Firebase project audience', () => {
    expect(allowedFirebaseProjectIds({
      FIREBASE_PROJECT_ID: 'primary-project',
      FIREBASE_ADDITIONAL_AUTH_PROJECT_IDS: 'https://portal.example.invalid',
    })).toEqual(['primary-project']);
    expect(firebaseTokenAudience(`header.${Buffer.from(JSON.stringify({ aud: 'portal-project' })).toString('base64url')}.signature`))
      .not.toBe('https://portal.example.invalid');
  });

  it('verifies through an injected Admin adapter without loading Firebase in unit tests', async () => {
    const payload = Buffer.from(JSON.stringify({ aud: 'primary-project' })).toString('base64url');
    const verifyIdToken = jest.fn().mockResolvedValue({ uid: 'employee-1' });
    const forProject = jest.fn().mockResolvedValue({ verifyIdToken });
    const verifier = new FirebaseTokenVerifier({ forProject }, { FIREBASE_PROJECT_ID: 'primary-project' });

    await expect(verifier.verify(`header.${payload}.signature`)).resolves.toEqual({
      valid: true,
      payload: { uid: 'employee-1' },
    });
    expect(forProject).toHaveBeenCalledWith('primary-project', 'primary-project');
  });

  it('documents both variables in deployment templates and the release skill', () => {
    for (const path of [
      'env.test.example',
      'env.demo.example',
      'env.local-network.example',
      'env.staging.example',
      'deploy/k8s/staging/secret.example.yaml',
    ]) {
      const template = readFileSync(path, 'utf8');
      expect(template).toContain('FIREBASE_PROJECT_ID');
      expect(template).toContain('FIREBASE_ADDITIONAL_AUTH_PROJECT_IDS');
    }
    expect(readFileSync('.codex/skills/gw-unid-local-image-release/references/unid-staging.md', 'utf8'))
      .toContain('Values are Firebase project IDs found in the token `aud` claim');
  });
});
