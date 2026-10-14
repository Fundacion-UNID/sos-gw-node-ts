// src/security/middleware/parseCdsRequest.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { Request, Response, NextFunction } from 'express';
import { extractHttpRequestDataAsJson } from '../../utils/http-parser';
import { JobRequest } from 'gdc-common-utils-ts/models/confidential-job';
import { IssueType } from 'gdc-common-utils-ts/models/issue';
import { sendDidcommEarlyError } from '../../utils/didcomm-error-response';

// Extend the Express Request type to include our custom property
declare global {
  namespace Express {
    interface Request {
      cdsRequest?: JobRequest;
    }
  }
}

/**
 * Middleware to parse an incoming HTTP request into a structured `JobProcessingInfo` object.
 * It uses the `extractHttpRequestDataAsJson` utility to parse the complex CDS URL
 * and the request body. The resulting object is attached to `req.cdsRequest` for
 * use by subsequent middlewares and handlers.
 */
export const parseCdsRequest = (req: Request, res: Response, next: NextFunction) => {
  try {
    const fullUrl = `${req.protocol}://${req.get('host')}${req.originalUrl}`;
    
    // The body might be an object if express.json() or express.urlencoded() has run,
    // or it might be a raw buffer/string. We pass it along to the parser.
    const input = req.body;
    
    const contentType = req.headers['content-type'] || 'application/octet-stream';
    
    const cdsRequestData = extractHttpRequestDataAsJson(
      fullUrl,
      input,
      contentType,
      req.method
    );

    // Attach the parsed data to the request object
    req.cdsRequest = cdsRequestData;

    next();
  } catch (error: any) {
    return sendDidcommEarlyError(
      req,
      res,
      400,
      IssueType.Invalid,
      `Failed to parse CDS request URL: ${error.message}`,
    );
  }
};
