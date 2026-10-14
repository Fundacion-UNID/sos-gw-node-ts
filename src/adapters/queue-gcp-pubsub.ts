import type { JobRequest } from 'gdc-common-utils-ts/models/confidential-job';
import { getTenantVaultId } from '../utils/tenant';
import type { Worker } from '../worker';
import type { IAsyncResponseStore, StoredJob } from './async-response-store.mem';
import type { QueueAdapter } from './queue';
import type { IAsyncJobPayloadStore } from './async-job-payload-store.gcs';

interface PubSubMessageLike {
  data: Buffer;
  ack(): void;
  ackWithResponse?(): Promise<unknown>;
  nack(): void;
}

interface PubSubSubscriptionLike {
  on(event: 'message', listener: (message: PubSubMessageLike) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  off?(event: 'message', listener: (message: PubSubMessageLike) => void): unknown;
  close(): Promise<unknown>;
}

interface PubSubClientLike {
  topic(name: string): {
    publishMessage(message: { data: Buffer; attributes?: Record<string, string> }): Promise<string>;
  };
  subscription(name: string, options?: Record<string, unknown>): PubSubSubscriptionLike;
}

type DurableJobEnvelope = {
  schemaVersion: 1;
  jobName: string;
  request: JobRequest;
  priority: number;
};

type DurableJobPointer = {
  schemaVersion: 1;
  payloadRef: string;
};

export interface QueueAdapterGcpPubSubOptions {
  client: PubSubClientLike;
  topicName: string;
  subscriptionName: string;
  payloadStore: IAsyncJobPayloadStore;
  maxOutstandingMessages?: number;
}

/** Pull-based Pub/Sub queue. The message is acknowledged only after its poll result is durable. */
export class QueueAdapterGcpPubSub implements QueueAdapter {
  private readonly subscription: PubSubSubscriptionLike;
  private readonly handleMessageBound: (message: PubSubMessageLike) => void;

  constructor(
    private readonly responseStore: IAsyncResponseStore,
    private readonly worker: Worker,
    private readonly options: QueueAdapterGcpPubSubOptions,
  ) {
    this.subscription = options.client.subscription(options.subscriptionName, {
      flowControl: {
        maxMessages: Math.max(1, Math.floor(options.maxOutstandingMessages || 10)),
        allowExcessMessages: false,
      },
    });
    this.handleMessageBound = (message) => {
      void this.handleMessage(message);
    };
    this.subscription.on('message', this.handleMessageBound);
    this.subscription.on('error', (error) => {
      console.error('[QueueAdapterGcpPubSub] Subscriber error:', error);
    });
  }

  async addJob(jobName: string, request: JobRequest, priority = 10): Promise<void> {
    const envelope: DurableJobEnvelope = {
      schemaVersion: 1,
      jobName,
      request,
      priority,
    };
    const payloadRef = await this.options.payloadStore.put(envelope);
    const pointer: DurableJobPointer = { schemaVersion: 1, payloadRef };
    await this.options.client.topic(this.options.topicName).publishMessage({
      data: Buffer.from(JSON.stringify(pointer), 'utf8'),
      attributes: {
        schemaVersion: '1',
        priority: String(priority),
      },
    });
  }

  private parsePointer(message: PubSubMessageLike): DurableJobPointer {
    const pointer = JSON.parse(message.data.toString('utf8')) as Partial<DurableJobPointer>;
    if (pointer.schemaVersion !== 1 || typeof pointer.payloadRef !== 'string' || !pointer.payloadRef) {
      throw new Error('Invalid durable job pointer.');
    }
    return pointer as DurableJobPointer;
  }

  private parseEnvelope(value: unknown): DurableJobEnvelope {
    const envelope = value as Partial<DurableJobEnvelope>;
    if (
      envelope.schemaVersion !== 1
      || typeof envelope.jobName !== 'string'
      || !envelope.jobName
      || !envelope.request
      || typeof envelope.request.content?.thid !== 'string'
      || !envelope.request.content.thid
    ) {
      throw new Error('Invalid durable job envelope.');
    }
    return envelope as DurableJobEnvelope;
  }

  private async handleMessage(message: PubSubMessageLike): Promise<void> {
    let pointer: DurableJobPointer;
    let envelope: DurableJobEnvelope;
    try {
      pointer = this.parsePointer(message);
      envelope = this.parseEnvelope(await this.options.payloadStore.get(pointer.payloadRef));
    } catch (error) {
      console.error('[QueueAdapterGcpPubSub] Rejected malformed message:', error);
      message.nack();
      return;
    }

    const thid = envelope.request.content!.thid as string;
    let finalResult: StoredJob;
    try {
      const encryptedResult = await this.worker.process(envelope.jobName, envelope.request);
      const vaultId = envelope.request.tenantId === 'host'
        ? 'host'
        : getTenantVaultId(envelope.request.sector!, envelope.request.tenantId!);
      finalResult = {
        status: 'COMPLETED',
        vaultId,
        result: encryptedResult,
        contentType: envelope.request.contentType,
      };
    } catch (error) {
      const errorMessage = `Catastrophic failure in worker while processing job ${envelope.jobName}: ${(error as Error).message}`;
      console.error(errorMessage);
      finalResult = { status: 'FAILED', result: JSON.stringify({ error: errorMessage }) };
    }

    try {
      await this.responseStore.set(thid, finalResult);
      if (message.ackWithResponse) {
        await message.ackWithResponse();
        try {
          await this.options.payloadStore.delete(pointer.payloadRef);
        } catch (error) {
          console.error('[QueueAdapterGcpPubSub] Failed to remove acknowledged payload:', error);
        }
      } else {
        message.ack();
      }
    } catch (error) {
      console.error('[QueueAdapterGcpPubSub] Failed to persist result before acknowledgement:', error);
      message.nack();
    }
  }

  async close(): Promise<void> {
    this.subscription.off?.('message', this.handleMessageBound);
    await this.subscription.close();
  }

  stop(): void {
    void this.close();
  }
}
