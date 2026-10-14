import * as express from 'express';
import { randomUUID } from 'crypto';
import { TokenManager } from '../managers/TokenManager';
import { IssueType } from 'gdc-common-utils-ts/models/issue';
import { ManagerError } from 'gdc-common-utils-ts/utils/manager-error';
import { AppAuthorizationManager } from '../managers/AppAuthorizationManager';
import { sendDidcommEarlyError } from '../utils/didcomm-error-response';

/**
 * Creates a router for authentication-related endpoints, like the token exchange.
 * This router acts as an orchestrator, using managers for specific tasks.
 * @param appAuthManager The manager for validating credentials like id_tokens and activation codes.
 * @param tokenManager The manager for creating system-level tokens.
 */
export function createAuthRouter(
  appAuthManager: AppAuthorizationManager,
  tokenManager: TokenManager
): express.Router {
  const router = express.Router();

  /**
   * @openapi
   * /auth/token:
   *   post:
   *     tags:
   *       - 99. Legacy / Internal
   *     summary: Exchange an Activation Code for an Initial Access Token
   *     description: |
   *       This endpoint performs a token exchange. The user authenticates by presenting a valid `id_token` (from an OIDC provider) as a Bearer token.
   *       In the request body, they provide an `activation_code` (`subject_token`).
   *       If both are valid, the server returns a short-lived `initial_access_token` with the scope `dcr:register`, which grants permission to call the DCR endpoint.
   *     security:
   *       - BearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/TokenExchangeRequest'
   *     responses:
   *       '200':
   *         description: Success. Returns the initial access token.
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/TokenExchangeResponse'
   *       '400':
   *         description: Bad Request. The request body is malformed or the activation code is invalid.
   *       '401':
   *         description: Unauthorized. The `id_token` is missing, invalid, or expired.
   *       '404':
   *         description: The activation code was not found.
   *       '409':
   *         description: Conflict. The activation code has already been used.
   */
  // Back-compat: previously mounted under `/auth` but also used `/auth/token` internally.
  // The effective path became `/auth/auth/token`. Keep accepting `/auth/token` for now.
  router.post(['/token', '/auth/token'], async (req: express.Request, res: express.Response) => {
    try {
      // This endpoint is an orchestrator, not a job processor.
      // It handles a synchronous request flow.

      // 1. Verify the user's identity via the id_token in the header.
      const idToken = req.headers.authorization?.split(' ')[1];
      if (!idToken) {
        throw new ManagerError('Missing Bearer token.', IssueType.Security);
      }
      const verificationResult = await appAuthManager.verifyIdToken(idToken);
      const { sub: userId, tenant_id: tenantId, sector } = verificationResult.payload;

      // 2. Verify and consume the activation code from the body.
      const activationCode = req.body.subject_token;
      if (!activationCode) {
        throw new ManagerError('Missing subject_token in request body.', IssueType.Value);
      }
      if (!tenantId) {
        throw new ManagerError('tenant_id claim missing from id_token.', IssueType.BusinessRule);
      }
      if (typeof sector !== 'string' || !sector.trim()) {
        throw new ManagerError('sector claim missing from id_token.', IssueType.BusinessRule);
      }
      await appAuthManager.verifyAndConsumeActivationCode(activationCode, tenantId, sector);

      // 3. If both are valid, create the initial access token.
      const tokenLifetime = 60; // seconds
      const claims = {
        sub: userId,
        jti: randomUUID(),
        act_code: activationCode,
        tenant_id: tenantId,
      };
      const accessToken = await tokenManager.createInitialAccessToken(claims, tokenLifetime);

      const response = {
        initial_access_token: accessToken,
        token_type: 'Bearer',
        expires_in: tokenLifetime,
        scope: 'dcr:register',
      };
      
      res.status(200).json(response);

    } catch (error) {
      if (error instanceof ManagerError) {
        return sendDidcommEarlyError(
          req,
          res,
          parseInt(error.status, 10) || 400,
          error.code,
          error.message,
        );
      }
      // Generic error for unexpected issues
      console.error('[AuthRouter] Unexpected error:', error);
      return sendDidcommEarlyError(
        req,
        res,
        500,
        IssueType.Exception,
        'An unexpected internal server error occurred.',
      );
    }
  });

  return router;
}
