// src/__tests__/integration/server.robustness.test.ts

import request from 'supertest';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { createApp } from '../../app';
import { createGlobalErrorHandler } from '../../middlewares/global-error-handler';
import { ConsoleLogger } from '../../loggers/ConsoleLogger';
import { startServer } from '../../server';

const TEST_ROUTE_PATH = '/payload-limit-check';
const REQUEST_BODY_LIMIT_ENV = 'GW_REQUEST_BODY_LIMIT';
const JSON_MEDIA_TYPE = 'application/json';
const FHIR_JSON_MEDIA_TYPE = 'application/fhir+json';
const OVERSIZED_PAYLOAD_PROPERTY = 'payload';
const OVERSIZED_PAYLOAD_CHUNK = 'x'.repeat(256);
const PREVIOUS_REQUEST_BODY_LIMIT = process.env[REQUEST_BODY_LIMIT_ENV];
const MAX_HEADER_SIZE_ENV = 'GW_MAX_HEADER_SIZE';
const PREVIOUS_MAX_HEADER_SIZE = process.env[MAX_HEADER_SIZE_ENV];
const PREVIOUS_PORT = process.env.PORT;
const PREVIOUS_HOST_INTERNAL_IP = process.env.HOST_INTERNAL_IP;

describe('Server Robustness', () => {
  afterEach(() => {
    if (PREVIOUS_REQUEST_BODY_LIMIT === undefined) {
      delete process.env[REQUEST_BODY_LIMIT_ENV];
    } else {
      process.env[REQUEST_BODY_LIMIT_ENV] = PREVIOUS_REQUEST_BODY_LIMIT;
    }
    if (PREVIOUS_MAX_HEADER_SIZE === undefined) {
      delete process.env[MAX_HEADER_SIZE_ENV];
    } else {
      process.env[MAX_HEADER_SIZE_ENV] = PREVIOUS_MAX_HEADER_SIZE;
    }
    if (PREVIOUS_PORT === undefined) {
      delete process.env.PORT;
    } else {
      process.env.PORT = PREVIOUS_PORT;
    }
    if (PREVIOUS_HOST_INTERNAL_IP === undefined) {
      delete process.env.HOST_INTERNAL_IP;
    } else {
      process.env.HOST_INTERNAL_IP = PREVIOUS_HOST_INTERNAL_IP;
    }
  });

  describe('Global Error Handler', () => {
    it('should catch malformed JSON and return a 400 Bad Request', async () => {
      const logger = new ConsoleLogger();
      const handler = createGlobalErrorHandler(logger);

      const err = new SyntaxError('Unexpected token } in JSON at position 10');
      (err as any).body = '{"broken": }'; // Body-parser marks the error with a `body` property.

      const req = { path: '/host/cds-xx/v1/test/ping/standard/resource/_batch', method: 'POST' } as any;

      let statusCode = 200;
      let jsonBody: any;
      const res = {
        status(code: number) {
          statusCode = code;
          return this;
        },
        json(payload: any) {
          jsonBody = payload;
          return this;
        },
      } as any;

      handler(err as any, req, res, () => undefined);

      expect(statusCode).toBe(400);
      expect(jsonBody).toBeDefined();
      expect(jsonBody.type).toBe('application/bundle-api+json');
      expect(jsonBody.body.resourceType).toBe('Bundle');
      expect(jsonBody.body.data).toEqual([]);
      expect(jsonBody.body.total).toBe(0);
      expect(jsonBody.body.issues.issue[0].severity).toBe('error');
      expect(jsonBody.body.issues.issue[0].code).toBe('invalid');
      expect(jsonBody.body.issues.issue[0].diagnostics).toContain('Malformed JSON in request body');
    });

    it('should catch oversized request bodies and return a 413 response', async () => {
      const logger = new ConsoleLogger();
      const handler = createGlobalErrorHandler(logger);

      const err = Object.assign(new Error('request entity too large'), {
        type: 'entity.too.large',
        status: 413,
        limit: 128,
        length: 512,
      });

      const req = {
        path: '/host/cds-xx/v1/health-care/individual/org.hl7.fhir.r4/Communication/_batch',
        method: 'POST',
        params: { format: 'org.hl7.fhir.r4' },
        headers: { 'content-type': FHIR_JSON_MEDIA_TYPE },
      } as any;

      let statusCode = 200;
      let jsonBody: any;
      const res = {
        status(code: number) {
          statusCode = code;
          return this;
        },
        set() {
          return this;
        },
        send(payload: any) {
          jsonBody = JSON.parse(String(payload));
          return this;
        },
        json(payload: any) {
          jsonBody = payload;
          return this;
        },
      } as any;

      handler(err as any, req, res, () => undefined);

      expect(statusCode).toBe(413);
      expect(jsonBody).toBeDefined();
      expect(jsonBody.resourceType || jsonBody.body?.resourceType).toBe('Bundle');
      expect(JSON.stringify(jsonBody)).toContain('configured size limit');
    });
  });

  describe('Request body parser', () => {
    it('should enforce the configured JSON body size limit before routing', async () => {
      process.env[REQUEST_BODY_LIMIT_ENV] = '128b';

      const app = createApp();
      app.post(TEST_ROUTE_PATH, (_req, res) => {
        res.status(200).json({ ok: true });
      });
      app.use(createGlobalErrorHandler(new ConsoleLogger()));

      const response = await request(app)
        .post(TEST_ROUTE_PATH)
        .set('Content-Type', JSON_MEDIA_TYPE)
        .send({
          [OVERSIZED_PAYLOAD_PROPERTY]: OVERSIZED_PAYLOAD_CHUNK,
        });

      expect(response.status).toBe(413);
      expect(response.body).toBeDefined();
      expect(JSON.stringify(response.body)).toContain('configured size limit');
    });
  });

  describe('HTTP header limits', () => {
    it('accepts controller proof bearer sized headers when GW_MAX_HEADER_SIZE is raised', async () => {
      process.env[MAX_HEADER_SIZE_ENV] = String(128 * 1024);
      process.env.PORT = '0';
      process.env.HOST_INTERNAL_IP = '127.0.0.1';

      const { server, queueAdapter } = await startServer();
      try {
        if (server && !server.listening) {
          await once(server, 'listening');
        }
        const address = server?.address() as AddressInfo | null;
        expect(address?.port).toBeGreaterThan(0);

        const oversizedBearer = `Bearer ${'v'.repeat(24 * 1024)}`;
        const response = await fetch(`http://127.0.0.1:${address?.port}/host/cds-ES/v1/test/.well-known/ping`, {
          headers: {
            Authorization: oversizedBearer,
          },
        });

        expect(response.status).toBe(200);
      } finally {
        (queueAdapter as any)?.stop?.();
        await new Promise<void>((resolve, reject) => {
          server?.close((error) => {
            if (error) reject(error);
            else resolve();
          });
        });
      }
    });
  });
});
