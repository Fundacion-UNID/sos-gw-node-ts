// src/adapters/queue.ts

import { JobRequest } from "gdc-common-utils-ts/models/confidential-job";


export interface QueueAdapter {
  addJob(jobName: string, request: JobRequest, priority?: number): Promise<void>;
  close?(): Promise<void>;
}
