import type { JobRequest } from 'gdc-common-utils-ts/models/confidential-job';
import type { IAsyncResponseStore, StoredJob } from '../adapters/async-response-store.mem';
import type { QueueAdapter } from '../adapters/queue';

export async function enqueueAsyncJob(params: {
  responseStore: IAsyncResponseStore;
  queueAdapter: QueueAdapter;
  thid: string;
  jobName: string;
  request: JobRequest;
  priority?: number;
  pending: StoredJob;
}): Promise<void> {
  await params.responseStore.set(params.thid, params.pending);
  try {
    if (params.priority === undefined) {
      await params.queueAdapter.addJob(params.jobName, params.request);
    } else {
      await params.queueAdapter.addJob(params.jobName, params.request, params.priority);
    }
  } catch (error) {
    await params.responseStore.delete(params.thid);
    throw error;
  }
}
