// src/middlewares/global-error-handler.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import * as express from 'express';
import { ILogger } from '../loggers/ILogger';
import { IssueType } from 'gdc-common-utils-ts/models/issue';
import { sendDidcommEarlyError } from '../utils/didcomm-error-response';

type RequestBodySizeError = Error & {
  body?: unknown;
  type?: string;
  status?: number;
  statusCode?: number;
  limit?: number;
  length?: number;
};

const BODY_TOO_LARGE_ERROR_TYPE = 'entity.too.large';
const HTTP_STATUS_REQUEST_ENTITY_TOO_LARGE = 413;

/**
 * Detects body-parser payload limit errors raised before a request reaches
 * routing or manager code.
 */
function isRequestBodyTooLargeError(err: RequestBodySizeError): boolean {
  return err?.type === BODY_TOO_LARGE_ERROR_TYPE
    || err?.status === HTTP_STATUS_REQUEST_ENTITY_TOO_LARGE
    || err?.statusCode === HTTP_STATUS_REQUEST_ENTITY_TOO_LARGE;
}

export function createGlobalErrorHandler(logger: ILogger): express.ErrorRequestHandler {
  return (err: Error, req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const sizedError = err as RequestBodySizeError;

    if (isRequestBodyTooLargeError(sizedError)) {
      logger.error('Request body exceeded configured size limit', err, {
        path: req.path,
        method: req.method,
        limit: sizedError.limit,
        length: sizedError.length,
      });
      return sendDidcommEarlyError(
        req,
        res,
        HTTP_STATUS_REQUEST_ENTITY_TOO_LARGE,
        IssueType.TooLong,
        'Request body exceeded the configured size limit. Reduce payload size or increase GW_REQUEST_BODY_LIMIT.',
      );
    }

    // Check if the error is a SyntaxError from body-parser
    if (err instanceof SyntaxError && 'body' in err) {
      logger.error('Malformed JSON received', err, { path: req.path, method: req.method });
      return sendDidcommEarlyError(
        req,
        res,
        400,
        IssueType.Invalid,
        `Malformed JSON in request body: ${err.message}`,
      );
    }

    // Handle other unexpected errors
    logger.error('An unexpected error occurred in the global error handler', err, { path: req.path, method: req.method });
    return sendDidcommEarlyError(
      req,
      res,
      500,
      IssueType.Exception,
      'An unexpected internal server error occurred.',
    );
  };
}
