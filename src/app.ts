// src/app.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import express from 'express';
import cors from 'cors';
import { createOperationOutcomeLoggingMiddleware } from './observability/operation-outcome-logging';

type SecurityMode = 'strict' | 'compat' | 'demo';

const JSON_MEDIA_TYPE = 'application/json';
const FHIR_JSON_MEDIA_TYPE = 'application/fhir+json';
const DIDCOMM_PLAINTEXT_JSON_MEDIA_TYPE = 'application/didcomm-plain+json';
const DIDCOMM_PLAINTEXT_JSON_LEGACY_MEDIA_TYPE = 'application/didcomm-plaintext+json';
const DEFAULT_REQUEST_BODY_LIMIT = '25mb';
const PRIMARY_REQUEST_BODY_LIMIT_ENV = 'GW_REQUEST_BODY_LIMIT';
const COMPAT_REQUEST_BODY_LIMIT_ENV = 'REQUEST_BODY_LIMIT';

function parseBooleanEnv(value: string | undefined, fallback = false): boolean {
  if (value === undefined) return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'enabled') return true;
  if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'disabled') return false;
  return fallback;
}

function resolveSecurityModeFromEnv(): SecurityMode {
  const normalized = String(process.env.SECURITY_MODE || 'strict').trim().toLowerCase();
  if (normalized === 'strict' || normalized === 'compat' || normalized === 'demo') return normalized;
  return 'strict';
}

/**
 * Resolves the request body size limit shared by JSON and urlencoded parsers.
 *
 * Why this exists:
 * - Communication/Document style flows can legitimately carry large payloads,
 *   especially when a DIDComm message embeds a FHIR Bundle or base64 payload.
 * - Express defaults to `100kb`, which is too small for realistic IPS and
 *   clinical ingestion scenarios.
 * - Keeping the limit configurable lets deployments tighten or relax it without
 *   changing code.
 */
export function resolveRequestBodyLimit(): string {
  return String(
    process.env[PRIMARY_REQUEST_BODY_LIMIT_ENV]
    || process.env[COMPAT_REQUEST_BODY_LIMIT_ENV]
    || DEFAULT_REQUEST_BODY_LIMIT,
  ).trim();
}

function buildAcceptedJsonBodyTypes(): string[] {
  const mode = resolveSecurityModeFromEnv();
  const didcommPlainEnabled = parseBooleanEnv(process.env.DIDCOMM_PLAIN, false);
  const acceptLegacyDidcommPlaintextMediaType = parseBooleanEnv(process.env.DIDCOMM_LEGACY_PLAINTEXT_MEDIA_TYPE, false);
  const acceptsDidcommPlain = mode === 'demo' || didcommPlainEnabled;
  const types = [JSON_MEDIA_TYPE, FHIR_JSON_MEDIA_TYPE];
  if (acceptsDidcommPlain) {
    types.push(DIDCOMM_PLAINTEXT_JSON_MEDIA_TYPE);
    if (acceptLegacyDidcommPlaintextMediaType) {
      types.push(DIDCOMM_PLAINTEXT_JSON_LEGACY_MEDIA_TYPE);
    }
  }
  return types;
}

export function createApp() {
  const app = express();

  // This block enables Cross-Origin Resource Sharing (CORS) for local development.
  // It allows the frontend running on localhost:8081 to communicate with the backend.
  // This is NOT enabled in production, where the frontend and backend are expected
  // to be served from the same origin or a properly configured CDN.
  if (process.env.NODE_ENV !== 'production') {
    const corsOptions = {
      // `origin`: Specifies which domains are allowed to make requests.
      // We lock it down to the specific port of the local frontend development server.
      origin: 'http://localhost:8081',

      // `methods`: A list of HTTP methods that are allowed.
      methods: 'GET,POST,OPTIONS',

      // `allowedHeaders`: A list of HTTP headers that the client is allowed to send.
      // This is critical. The browser's preflight `OPTIONS` request will ask for permission
      // for any "non-simple" headers.
      // - `Content-Type`: Necessary because the frontend sends `application/json`.
      // - `Authorization`: Necessary for the frontend to send the Bearer token for authenticated requests.
      // - `Accept`, `X-Requested-With`: Common headers sent by HTTP clients; including them makes the API more robust.
      allowedHeaders: 'Content-Type, Authorization, Accept, X-Requested-With',

      // `exposedHeaders`: A list of headers that the server is allowed to send back and that
      // the browser should expose to the frontend JavaScript code.
      // By default, browsers hide most headers from the client for security.
      // - `Location`: CRITICAL for the async polling pattern. The server responds to a `POST` with a `202 Accepted`
      //   and this header contains the URL the client must poll for the result.
      // - `Retry-After`: Sent with a `202 Accepted` to suggest how long the client should wait before polling.
      exposedHeaders: 'Location, Retry-After',
    };
    app.use(cors(corsOptions));
  }

  // Capture HTTP failures and failed entries inside successful batch responses.
  // The middleware extracts only status/OperationOutcome metadata; it never logs
  // request or response bodies. It must run before body parsing so parser errors
  // (malformed JSON and oversized requests) are observed too.
  app.use(createOperationOutcomeLoggingMiddleware());

  app.use(express.json({
    limit: resolveRequestBodyLimit(),
    type: buildAcceptedJsonBodyTypes(),
    verify: (req, _res, buffer) => {
      // Stripe signatures cover the exact received bytes. Preserve them while
      // still exposing parsed JSON to the rest of the application.
      (req as express.Request & { rawBody?: Buffer }).rawBody = Buffer.from(buffer);
    },
  }));

  return app;
}

export default createApp;
