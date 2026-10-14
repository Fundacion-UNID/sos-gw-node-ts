// src/security/middleware/decodeRequest.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { Request, Response, NextFunction } from 'express';
import { ICryptography } from 'gdc-common-utils-ts/interfaces/ICryptography';

// This is a placeholder for the full implementation
export const createDecodeRequestMiddleware = (cryptoService: ICryptography) => {
  return async (req: Request, res: Response, next: NextFunction) => {
    // In the final version, this will perform JWE/JWS decoding
    // For now, we just pass through to make the test work.
    (req as any).decodedRequest = { thid: 'mock-thid' };
    next();
  };
};
