// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/routes/handlers/fhir/FhirController.ts
import { ResourceTypesFhirR4 } from 'gdc-common-utils-ts/constants/fhir-resource-types';

import { Request, Response, Router } from 'express';
import { IAuthorizationManager } from '../../../managers/auth/IAuthorizationManager';
import { QueueAdapter } from '../../../adapters/queue';
import { IAccessTokenClaims } from 'gdc-common-utils-ts/models/auth';
import { JobRequest } from 'gdc-common-utils-ts/models/confidential-job';
import { IssueType } from 'gdc-common-utils-ts/models/issue';
import { validOrNewUuidv4 } from '../../../utils/uuid';
import { SUBJECT_SECTION_INDIVIDUAL } from '../../../constants/domain';
import { v4 as uuidv4 } from 'uuid';
import { sendDidcommEarlyError } from '../../../utils/didcomm-error-response';

export class FhirController {
  constructor(
    private readonly queueAdapter: QueueAdapter,
    private readonly authManager: IAuthorizationManager,
  ) {}

  /**
   * Handles the creation of a FHIR Communication resource.
   * It performs authorization checks before enqueuing the job for processing.
   */
  public async createCommunication(req: Request, res: Response): Promise<Response> {
    const resource = req.body;
    const accessTokenClaims = (req as any).claims as IAccessTokenClaims; // Assuming claims are populated by upstream middleware

    // 1. Validate 'partOf' exists
    const partOf = resource.partOf?.[0]?.reference;
    if (!partOf) {
      return sendDidcommEarlyError(
        req,
        res,
        400,
        IssueType.Required,
        "The 'partOf' field is required to link this communication to a consent.",
      );
    }

    const consentId = partOf;

    // 2. Perform authorization check
    const isAuthorized = await this.authManager.canAccess(accessTokenClaims, { resource: resource } as any, 'create', consentId);
    if (!isAuthorized) {
      return sendDidcommEarlyError(
        req,
        res,
        403,
        IssueType.Forbidden,
        'The provided credentials do not grant permission to perform this action.',
      );
    }

    // 3. If authorized, create and enqueue the job
    const thid = validOrNewUuidv4(resource.id);
    const job: JobRequest = {
      id: '',
      sequence: 0,
      status: 'DRAFT' as any,
      createdAtTimestamp: Date.now(),
      section: SUBJECT_SECTION_INDIVIDUAL,
      format: 'org.hl7.fhir.r4',
      action: 'create',
      resourceType: ResourceTypesFhirR4.Communication,
      tenantId: accessTokenClaims.iss, 
      sector: req.params.sector,
      content: {
        iss: accessTokenClaims.iss,
        jti: uuidv4(),
        type: 'https://didcomm.org/fhir/v1.0/Communication',
        thid: thid,
        aud: accessTokenClaims.iss, // The message is intended for the tenant itself to process
        body: {
          resource: resource
        },
        meta: {
          bearer: { jwt: { payload: accessTokenClaims } }
        }
      },
    };

    await this.queueAdapter.addJob('Communication', job);

    const location = `${req.protocol}://${req.get('host')}${req.originalUrl}/${thid}`;
    return res.status(202).location(location).send();
  }

  /**
   * Registers the routes for the FHIR controller.
   * @param router The express router to register the routes on.
   */
  public register(router: Router): void {
    router.post(
      '/v1/:sector/individual/org.hl7.fhir.r4/Communication',
      this.createCommunication.bind(this),
    );
  }
}
