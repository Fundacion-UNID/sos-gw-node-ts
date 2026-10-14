import request from 'supertest';
import { createApp } from '../../../app';
import { createGlobalErrorHandler } from '../../../middlewares/global-error-handler';
import type { ILogger } from '../../../loggers/ILogger';
import {
  collectOperationOutcomeErrors,
  logOperationOutcomeErrors,
  type StructuredErrorLog,
} from '../../../observability/operation-outcome-logging';

describe('OperationOutcome error observability', () => {
  it('finds failed entries in an HTTP 200 batch response', () => {
    const issues = collectOperationOutcomeErrors({
      resourceType: 'Bundle',
      type: '_batch-response',
      data: [{
        type: 'Condition-response-v1.0',
        response: {
          status: '400',
          outcome: {
            resourceType: 'OperationOutcome',
            issue: [{ severity: 'error', code: 'invalid', diagnostics: 'Invalid condition' }],
          },
        },
      }],
    }, 200);

    expect(issues).toEqual([{
      severity: 'error',
      code: 'invalid',
      diagnostics: 'Invalid condition',
      responseStatus: 400,
      entryIndex: 0,
    }]);
  });

  it('ignores a successful informational OperationOutcome', () => {
    const issues = collectOperationOutcomeErrors({
      resourceType: 'OperationOutcome',
      issue: [{ severity: 'information', code: 'informational', diagnostics: 'Ping successful' }],
    }, 200);

    expect(issues).toEqual([]);
  });

  it('captures a FHIR-compatible early error envelope', () => {
    const entries: StructuredErrorLog[] = [];
    const count = logOperationOutcomeErrors({
      type: 'application/fhir+json',
      body: {
        resourceType: 'Bundle',
        entry: [],
        total: 0,
        issues: {
          issue: [{
            severity: 'error',
            code: 'not-found',
            diagnostics: 'The requested endpoint does not exist.',
          }],
        },
      },
    }, {
      source: 'http_response',
      httpStatus: 404,
      method: 'POST',
      path: '/example',
    }, (entry) => entries.push(entry));

    expect(count).toBe(1);
    expect(entries[0]).toMatchObject({
      event: 'operation_outcome_error',
      httpStatus: 404,
      issues: [{ severity: 'error', code: 'not-found', responseStatus: 404 }],
    });
  });

  it('redacts bearer tokens and JWTs from diagnostics', () => {
    const issues = collectOperationOutcomeErrors({
      resourceType: 'OperationOutcome',
      issue: [{
        severity: 'error',
        code: 'security',
        diagnostics: 'Bearer secret-token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature',
      }],
    }, 401);

    expect(issues[0].diagnostics).toBe('Bearer [REDACTED] [REDACTED_JWT]');
  });

  it('writes a structured log for a failed batch entry returned with HTTP 200', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const app = createApp();
    app.get('/batch', (_req, res) => res.status(200).json({
      resourceType: 'Bundle',
      data: [{
        response: {
          status: '500',
          outcome: {
            resourceType: 'OperationOutcome',
            issue: [{ severity: 'fatal', code: 'exception', diagnostics: 'Manager unavailable' }],
          },
        },
      }],
    }));

    await request(app).get('/batch').expect(200);

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(consoleSpy.mock.calls[0][0]))).toMatchObject({
      severity: 'ERROR',
      event: 'operation_outcome_error',
      source: 'http_response',
      httpStatus: 200,
      method: 'GET',
      path: '/batch',
      issues: [{ severity: 'fatal', code: 'exception', responseStatus: 500 }],
    });
  });

  it('writes a generic structured log for HTTP errors without an OperationOutcome', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const app = createApp();
    app.get('/plain-error', (_req, res) => res.status(503).send('unavailable'));

    await request(app).get('/plain-error').expect(503);

    expect(JSON.parse(String(consoleSpy.mock.calls[0][0]))).toMatchObject({
      severity: 'ERROR',
      event: 'http_error_response',
      source: 'http_response',
      httpStatus: 503,
      operationOutcomeDetected: false,
    });
  });

  it('observes OperationOutcome responses created for body-parser failures', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const app = createApp();
    const logger: ILogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    };
    app.use(createGlobalErrorHandler(logger));

    await request(app)
      .post('/malformed')
      .set('Content-Type', 'application/json')
      .send('{"broken":}')
      .expect(400);

    expect(consoleSpy).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(consoleSpy.mock.calls[0][0]))).toMatchObject({
      event: 'operation_outcome_error',
      source: 'http_response',
      httpStatus: 400,
      method: 'POST',
      path: '/malformed',
      issues: [{ severity: 'error', code: 'invalid', responseStatus: 400 }],
    });
  });
});
