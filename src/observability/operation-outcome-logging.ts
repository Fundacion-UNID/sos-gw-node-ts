// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import type { NextFunction, Request, RequestHandler, Response } from 'express';

const ERROR_SEVERITIES = new Set(['error', 'fatal']);
const MAX_DIAGNOSTICS_LENGTH = 512;
const MAX_ISSUES_PER_EVENT = 25;

type JsonRecord = Record<string, unknown>;

export interface OperationOutcomeIssueLog {
  severity?: string;
  code?: string;
  diagnostics?: string;
  responseStatus?: number;
  entryIndex?: number;
}

export interface OperationOutcomeLogContext {
  source: 'http_response' | 'worker_response' | 'worker_exception';
  httpStatus?: number;
  method?: string;
  path?: string;
  thid?: string;
  jobName?: string;
  resourceType?: string;
  action?: string;
}

export interface StructuredOperationOutcomeLog extends OperationOutcomeLogContext {
  severity: 'ERROR';
  event: 'operation_outcome_error';
  message: string;
  issueCount: number;
  issues: OperationOutcomeIssueLog[];
  issuesTruncated?: boolean;
}

export interface StructuredHttpErrorLog extends Omit<OperationOutcomeLogContext, 'source'> {
  severity: 'ERROR';
  event: 'http_error_response';
  message: string;
  source: 'http_response';
  operationOutcomeDetected: false;
}

export type StructuredErrorLog = StructuredOperationOutcomeLog | StructuredHttpErrorLog;
export type StructuredErrorLogSink = (entry: StructuredErrorLog) => void;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseStatus(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return undefined;
  const match = value.match(/^\s*(\d{3})/);
  return match ? Number(match[1]) : undefined;
}

function sanitizeDiagnostics(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[REDACTED_JWT]')
    .trim();
  if (!normalized) return undefined;
  return normalized.slice(0, MAX_DIAGNOSTICS_LENGTH);
}

function normalizeIssue(
  issue: unknown,
  responseStatus: number | undefined,
  entryIndex: number | undefined,
): OperationOutcomeIssueLog | undefined {
  if (!isRecord(issue)) return undefined;
  const severity = typeof issue.severity === 'string' ? issue.severity.toLowerCase() : undefined;
  const isFailedStatus = responseStatus !== undefined && responseStatus >= 400;
  if (!isFailedStatus && !ERROR_SEVERITIES.has(severity || '')) return undefined;

  const diagnostics = sanitizeDiagnostics(issue.diagnostics);

  return {
    ...(severity ? { severity } : {}),
    ...(typeof issue.code === 'string' ? { code: issue.code } : {}),
    ...(diagnostics ? { diagnostics } : {}),
    ...(responseStatus !== undefined ? { responseStatus } : {}),
    ...(entryIndex !== undefined ? { entryIndex } : {}),
  };
}

function collectIssueArray(
  issues: unknown,
  responseStatus: number | undefined,
  entryIndex: number | undefined,
): OperationOutcomeIssueLog[] {
  if (!Array.isArray(issues)) return [];
  return issues
    .map((issue) => normalizeIssue(issue, responseStatus, entryIndex))
    .filter((issue): issue is OperationOutcomeIssueLog => Boolean(issue));
}

function parsePayload(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return value;
  try {
    return JSON.parse(trimmed);
  } catch {
    return value;
  }
}

/**
 * Extracts only failure metadata from supported GW/FHIR response shapes.
 * It deliberately does not recurse through clinical `resource` content.
 */
export function collectOperationOutcomeErrors(
  payload: unknown,
  outerStatus?: number,
): OperationOutcomeIssueLog[] {
  const root = parsePayload(payload);
  const collected: OperationOutcomeIssueLog[] = [];
  const visited = new Set<object>();

  const visit = (value: unknown, inheritedStatus?: number, entryIndex?: number): void => {
    const parsed = parsePayload(value);
    if (!isRecord(parsed) || visited.has(parsed)) return;
    visited.add(parsed);

    const response = isRecord(parsed.response) ? parsed.response : undefined;
    const explicitResponseStatus = parseStatus(response?.status);
    const responseStatus = explicitResponseStatus ?? inheritedStatus;

    if (parsed.resourceType === 'OperationOutcome') {
      collected.push(...collectIssueArray(parsed.issue, responseStatus, entryIndex));
    }

    const issuesContainer = isRecord(parsed.issues) ? parsed.issues : undefined;
    if (issuesContainer) {
      collected.push(...collectIssueArray(issuesContainer.issue, responseStatus, entryIndex));
    }

    const outcome = response && isRecord(response.outcome) ? response.outcome : undefined;
    const outcomeIssues = outcome ? collectIssueArray(outcome.issue, responseStatus, entryIndex) : [];
    collected.push(...outcomeIssues);

    if (explicitResponseStatus !== undefined && explicitResponseStatus >= 400 && outcomeIssues.length === 0) {
      collected.push({
        severity: 'error',
        code: 'missing-operation-outcome',
        responseStatus: explicitResponseStatus,
        ...(entryIndex !== undefined ? { entryIndex } : {}),
      });
    }

    if (parsed.body !== undefined) visit(parsed.body, responseStatus, entryIndex);

    for (const collectionName of ['data', 'entry'] as const) {
      const entries = parsed[collectionName];
      if (!Array.isArray(entries)) continue;
      entries.forEach((entry, index) => visit(entry, responseStatus, index));
    }

    // Some APIs return a raw OperationOutcome under `outcome`, outside an entry response.
    if (isRecord(parsed.outcome) && parsed.outcome !== outcome) {
      visit(parsed.outcome, responseStatus, entryIndex);
    }
  };

  visit(root, outerStatus);
  return collected;
}

function defaultSink(entry: StructuredErrorLog): void {
  console.error(JSON.stringify(entry));
}

export function logOperationOutcomeErrors(
  payload: unknown,
  context: OperationOutcomeLogContext,
  sink: StructuredErrorLogSink = defaultSink,
): number {
  const issues = collectOperationOutcomeErrors(payload, context.httpStatus);
  if (issues.length === 0) return 0;

  sink({
    severity: 'ERROR',
    event: 'operation_outcome_error',
    message: 'GW response contains one or more failed OperationOutcome issues',
    ...context,
    issueCount: issues.length,
    issues: issues.slice(0, MAX_ISSUES_PER_EVENT),
    ...(issues.length > MAX_ISSUES_PER_EVENT ? { issuesTruncated: true } : {}),
  });
  return issues.length;
}

function headerValue(req: Request, name: string): string | undefined {
  const value = req.headers[name];
  if (Array.isArray(value)) return value[0];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function requestThid(req: Request): string | undefined {
  const bodyThid = isRecord(req.body) && typeof req.body.thid === 'string' ? req.body.thid : undefined;
  const queryThid = typeof req.query?.thid === 'string' ? req.query.thid : undefined;
  return bodyThid || queryThid || headerValue(req, 'x-request-id');
}

function requestRoute(req: Request): string {
  const routePath = isRecord(req.route) && typeof req.route.path === 'string'
    ? req.route.path
    : undefined;
  return routePath ? `${req.baseUrl || ''}${routePath}` : req.path;
}

/**
 * Observes completed Express responses without logging request/response bodies.
 * - HTTP >= 400 is always logged.
 * - HTTP 200 bundles are logged when an entry has status >= 400 or an
 *   OperationOutcome issue has severity `error`/`fatal`.
 */
export function createOperationOutcomeLoggingMiddleware(
  sink: StructuredErrorLogSink = defaultSink,
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction): void => {
    let responseBody: unknown;
    const originalJson = res.json.bind(res);
    const originalSend = res.send.bind(res);

    res.json = ((body: unknown) => {
      if (responseBody === undefined) responseBody = body;
      return originalJson(body);
    }) as Response['json'];

    res.send = ((body: unknown) => {
      if (responseBody === undefined) responseBody = body;
      return originalSend(body);
    }) as Response['send'];

    res.once('finish', () => {
      const context: OperationOutcomeLogContext = {
        source: 'http_response',
        httpStatus: res.statusCode,
        method: req.method,
        // Prefer the parameterized Express route and never include the query string.
        path: requestRoute(req),
        ...(requestThid(req) ? { thid: requestThid(req) } : {}),
      };
      const issueCount = logOperationOutcomeErrors(responseBody, context, sink);
      if (res.statusCode >= 400 && issueCount === 0) {
        sink({
          severity: 'ERROR',
          event: 'http_error_response',
          message: 'GW returned an HTTP error response without a detectable OperationOutcome',
          ...context,
          source: 'http_response',
          operationOutcomeDetected: false,
        });
      }
    });

    next();
  };
}
