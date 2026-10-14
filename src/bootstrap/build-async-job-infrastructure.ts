import { getFirestore } from 'firebase-admin/firestore';
import type { Worker } from '../worker';
import type { IAsyncResponseStore } from '../adapters/async-response-store.mem';
import { AsyncResponseStoreMem } from '../adapters/async-response-store.mem';
import { AsyncResponseStoreFirestore } from '../adapters/async-response-store.firestore';
import type { QueueAdapter } from '../adapters/queue';
import { QueueAdapterMem } from '../adapters/queue-mem';
import { QueueAdapterGcpPubSub } from '../adapters/queue-gcp-pubsub';
import { AsyncJobPayloadStoreGcs } from '../adapters/async-job-payload-store.gcs';

type Environment = Record<string, string | undefined>;
type QueueAdapterRuntime = QueueAdapter & { stop(): void };

export async function buildAsyncJobInfrastructure(params: {
  queueProvider: string;
  responseStoreProvider?: string;
  worker: Worker;
  env?: Environment;
  firestoreFactory?: () => any;
  pubSubFactory?: (projectId?: string) => Promise<any> | any;
}): Promise<{ asyncResponseStore: IAsyncResponseStore; queueAdapter: QueueAdapterRuntime }> {
  const env = params.env || process.env;
  const queueProvider = String(params.queueProvider || 'mem').trim().toLowerCase();
  const responseStoreProvider = String(params.responseStoreProvider || env.ASYNC_RESPONSE_STORE_PROVIDER || 'mem')
    .trim()
    .toLowerCase();

  if (!['mem', 'firestore'].includes(responseStoreProvider)) {
    throw new Error(`Unsupported ASYNC_RESPONSE_STORE_PROVIDER=${responseStoreProvider}. Use mem or firestore.`);
  }
  if (!['mem', 'gcp-pubsub'].includes(queueProvider)) {
    throw new Error(`Unsupported QUEUE_PROVIDER=${queueProvider}. Use mem or gcp-pubsub.`);
  }
  if (queueProvider === 'gcp-pubsub' && responseStoreProvider !== 'firestore') {
    throw new Error('QUEUE_PROVIDER=gcp-pubsub requires ASYNC_RESPONSE_STORE_PROVIDER=firestore.');
  }

  const asyncResponseStore: IAsyncResponseStore = responseStoreProvider === 'firestore'
    ? new AsyncResponseStoreFirestore((params.firestoreFactory || getFirestore)(), {
        collectionName: env.ASYNC_RESPONSE_FIRESTORE_COLLECTION || 'gw_async_responses',
        ttlSeconds: Number(env.ASYNC_RESPONSE_TTL_SECONDS || 86400),
      })
    : new AsyncResponseStoreMem();

  if (queueProvider === 'mem') {
    return {
      asyncResponseStore,
      queueAdapter: new QueueAdapterMem(asyncResponseStore, params.worker),
    };
  }

  const topicName = String(env.GCP_PUBSUB_TOPIC || '').trim();
  const subscriptionName = String(env.GCP_PUBSUB_SUBSCRIPTION || '').trim();
  if (!topicName || !subscriptionName) {
    throw new Error('QUEUE_PROVIDER=gcp-pubsub requires GCP_PUBSUB_TOPIC and GCP_PUBSUB_SUBSCRIPTION.');
  }
  const projectId = String(env.GCP_PUBSUB_PROJECT_ID || env.GOOGLE_CLOUD_PROJECT || env.GCLOUD_PROJECT || '').trim() || undefined;
  const jobBucket = String(env.GCP_PUBSUB_JOB_BUCKET || env.GCS_BUCKET_NAME || '').trim();
  if (!jobBucket) {
    throw new Error('QUEUE_PROVIDER=gcp-pubsub requires GCP_PUBSUB_JOB_BUCKET or GCS_BUCKET_NAME.');
  }
  const client = params.pubSubFactory
    ? await params.pubSubFactory(projectId)
    : await (async () => {
        const { PubSub } = await import('@google-cloud/pubsub');
        return new PubSub(projectId ? { projectId } : undefined);
      })();

  return {
    asyncResponseStore,
    queueAdapter: new QueueAdapterGcpPubSub(asyncResponseStore, params.worker, {
      client,
      topicName,
      subscriptionName,
      payloadStore: new AsyncJobPayloadStoreGcs(
        jobBucket,
        env.GCP_PUBSUB_JOB_PREFIX || 'async-jobs',
      ),
      maxOutstandingMessages: Number(env.GCP_PUBSUB_MAX_OUTSTANDING_MESSAGES || 10),
    }),
  };
}
