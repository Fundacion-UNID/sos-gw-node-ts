// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/routes/fhir.ts

import { Router } from 'express';
import { QueueAdapter } from '../adapters/queue';
import { IAuthorizationManager } from '../managers/auth/IAuthorizationManager';
import { FhirController } from './handlers/fhir/FhirController';

/**
 * Creates and configures the Express router for FHIR resource handling.
 * This function encapsulates all the FHIR-related endpoints.
 * @returns An Express router instance.
 */
export function createFhirRouter(queueAdapter: QueueAdapter, authManager: IAuthorizationManager): Router {
  const router = Router();
  
  // Manually instantiate the controller with its required dependencies.
  const fhirController = new FhirController(queueAdapter, authManager);
  
  // Register the routes defined within the controller
  fhirController.register(router);
  
  return router;
}
