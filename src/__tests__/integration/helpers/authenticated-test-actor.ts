// TDD contract: integration authors use a deterministic verified identity, never an anonymous demo bearer.
import {
  EXAMPLE_CONTROLLER_DID,
  EXAMPLE_EMAIL_CONTROLLER_ORG,
} from 'gdc-common-utils-ts/examples/shared';
import { registerTokenVerifierAdapter } from '../../../auth/token-verifier-registry';
import {
  buildDeterministicIdTokenFixture,
  DeterministicJwtTokenVerifier,
} from '../../utils/deterministic-jwt-fixtures';

const TEST_ACTOR_VERIFIER = 'deterministic-integration-actor';
const TEST_ACTOR_ISSUER = 'did:web:bff.integration.example';
const TEST_ACTOR_AUDIENCE = 'gw-integration-audience';
const TEST_ACTOR_SEED = 'gw-authenticated-integration-actor-seed';

/** Installs one locally verified OIDC-style actor for route-to-worker tests. */
export async function configureAuthenticatedTestActor(): Promise<{
  actorDid: string;
  authorizationHeader: string;
}> {
  const fixture = await buildDeterministicIdTokenFixture({
    seed: TEST_ACTOR_SEED,
    issuer: TEST_ACTOR_ISSUER,
    audience: TEST_ACTOR_AUDIENCE,
    subject: EXAMPLE_CONTROLLER_DID,
    email: EXAMPLE_EMAIL_CONTROLLER_ORG,
  });
  registerTokenVerifierAdapter(TEST_ACTOR_VERIFIER, () => new DeterministicJwtTokenVerifier({
    issuer: TEST_ACTOR_ISSUER,
    audience: TEST_ACTOR_AUDIENCE,
    publicJwk: fixture.publicJwk,
  }));
  process.env.AUTH_TOKEN_VERIFIER = TEST_ACTOR_VERIFIER;
  process.env.DEMO_ALLOW_INSECURE_BEARER = 'false';
  return {
    actorDid: EXAMPLE_CONTROLLER_DID,
    authorizationHeader: `Bearer ${fixture.compactToken}`,
  };
}
