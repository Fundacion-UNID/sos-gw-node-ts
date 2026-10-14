// Flow contract: a durable async request is published once, processed by a pull subscriber,
// persisted before acknowledgement, and remains pollable through a different process instance.

import { EventEmitter } from 'node:events';
import { AsyncResponseStoreFirestore } from '../../../adapters/async-response-store.firestore';
import { QueueAdapterGcpPubSub } from '../../../adapters/queue-gcp-pubsub';
import { enqueueAsyncJob } from '../../../services/async-job-submission';
import { buildAsyncJobInfrastructure } from '../../../bootstrap/build-async-job-infrastructure';
import { AsyncJobPayloadStoreGcs } from '../../../adapters/async-job-payload-store.gcs';

class FirestoreDocumentFake {
  public value: Record<string, unknown> | undefined;

  async get() {
    return { exists: this.value !== undefined, data: () => this.value };
  }

  async set(value: Record<string, unknown>) {
    this.value = value;
  }

  async delete() {
    this.value = undefined;
  }
}

class FirestoreFake {
  readonly documents = new Map<string, FirestoreDocumentFake>();

  collection(collectionName: string) {
    return {
      doc: (documentId: string) => {
        const path = `${collectionName}/${documentId}`;
        const existing = this.documents.get(path);
        if (existing) return existing;
        const created = new FirestoreDocumentFake();
        this.documents.set(path, created);
        return created;
      },
    };
  }
}

class SubscriptionFake extends EventEmitter {
  async close(): Promise<void> {}
}

describe('durable async job adapters', () => {
  it('keeps complete job payloads in a private GCS object instead of the Pub/Sub message', async () => {
    const save = jest.fn().mockResolvedValue(undefined);
    const download = jest.fn().mockResolvedValue([Buffer.from('{"job":"value"}')]);
    const remove = jest.fn().mockResolvedValue(undefined);
    const file = jest.fn(() => ({ save, download, delete: remove }));
    const storage = { bucket: jest.fn(() => ({ file })) };
    const store = new AsyncJobPayloadStoreGcs('private-job-bucket', 'async-jobs/vet', storage as any);

    const reference = await store.put({ job: 'value' });
    expect(reference).toMatch(/^async-jobs\/vet\/[0-9a-f-]+\.json$/);
    expect(save).toHaveBeenCalledWith(Buffer.from('{"job":"value"}'), expect.objectContaining({
      contentType: 'application/json',
      resumable: false,
    }));
    await expect(store.get(reference)).resolves.toEqual({ job: 'value' });
    await store.delete(reference);
    expect(remove).toHaveBeenCalledWith({ ignoreNotFound: true });
    await expect(store.get('../foreign-object')).rejects.toThrow('Invalid async job payload reference');
  });

  it('persists PENDING before publish and removes it when publishing fails', async () => {
    const events: string[] = [];
    const responseStore = {
      get: jest.fn(),
      set: jest.fn(async () => { events.push('pending'); }),
      delete: jest.fn(async () => { events.push('deleted'); }),
    };
    const queue = {
      addJob: jest.fn(async () => {
        events.push('publish');
        throw new Error('pubsub unavailable');
      }),
    };

    await expect(enqueueAsyncJob({
      responseStore: responseStore as any,
      queueAdapter: queue,
      thid: 'thread-submit',
      jobName: 'host:Organization:_status',
      request: { content: { thid: 'thread-submit' } } as any,
      pending: { status: 'PENDING', vaultId: 'host' },
    })).rejects.toThrow('pubsub unavailable');

    expect(events).toEqual(['pending', 'publish', 'deleted']);
  });

  it('rejects Pub/Sub startup unless polling state is also durable', async () => {
    await expect(buildAsyncJobInfrastructure({
      queueProvider: 'gcp-pubsub',
      responseStoreProvider: 'mem',
      worker: {} as any,
      env: {
        GCP_PUBSUB_TOPIC: 'gw-jobs',
        GCP_PUBSUB_SUBSCRIPTION: 'gw-jobs-worker',
      },
      firestoreFactory: jest.fn() as any,
      pubSubFactory: jest.fn() as any,
    })).rejects.toThrow('ASYNC_RESPONSE_STORE_PROVIDER=firestore');
  });

  it('persists a response in Firestore so another store instance can retrieve it', async () => {
    const firestore = new FirestoreFake();
    const firstProcess = new AsyncResponseStoreFirestore(firestore as any, {
      collectionName: 'gw_async_responses',
      ttlSeconds: 3600,
    });
    const secondProcess = new AsyncResponseStoreFirestore(firestore as any, {
      collectionName: 'gw_async_responses',
      ttlSeconds: 3600,
    });

    await firstProcess.set('thread/one', { status: 'PENDING', vaultId: 'host' });

    await expect(secondProcess.get('thread/one')).resolves.toEqual({ status: 'PENDING', vaultId: 'host' });
    const persisted = [...firestore.documents.values()][0].value;
    expect(persisted?.expiresAt).toBeInstanceOf(Date);
    expect([...firestore.documents.keys()][0]).not.toContain('thread/one');
  });

  it('publishes a versioned job and acknowledges only after the completed response is durable', async () => {
    const subscription = new SubscriptionFake();
    const publishMessage = jest.fn().mockResolvedValue('message-1');
    const client = {
      topic: jest.fn(() => ({ publishMessage })),
      subscription: jest.fn(() => subscription),
    };
    const events: string[] = [];
    const responseStore = {
      get: jest.fn(),
      set: jest.fn(async () => { events.push('persisted'); }),
      delete: jest.fn(),
    };
    const worker = {
      process: jest.fn(async () => {
        events.push('processed');
        return 'encrypted-result';
      }),
    };
    const payloads = new Map<string, unknown>();
    const payloadStore = {
      put: jest.fn(async (value: unknown) => {
        payloads.set('payload-1', value);
        return 'payload-1';
      }),
      get: jest.fn(async (reference: string) => payloads.get(reference)),
      delete: jest.fn(async (reference: string) => { payloads.delete(reference); }),
    };
    const adapter = new QueueAdapterGcpPubSub(responseStore as any, worker as any, {
      client: client as any,
      topicName: 'gw-jobs',
      subscriptionName: 'gw-jobs-worker',
      payloadStore: payloadStore as any,
    });
    const request = {
      tenantId: 'host',
      sector: 'animal-care',
      contentType: 'application/didcomm-encrypted+json',
      content: { thid: 'thread-1' },
    } as any;

    await adapter.addJob('host:Organization:_status', request, 3);
    expect(payloadStore.put).toHaveBeenCalledWith({
      schemaVersion: 1,
      jobName: 'host:Organization:_status',
      priority: 3,
      request,
    });
    const publishedPointer = JSON.parse(publishMessage.mock.calls[0][0].data.toString('utf8'));
    expect(publishedPointer).toEqual({ schemaVersion: 1, payloadRef: 'payload-1' });

    const ack = jest.fn();
    const ackWithResponse = jest.fn(async () => { events.push('acked'); });
    const nack = jest.fn();
    subscription.emit('message', {
      data: publishMessage.mock.calls[0][0].data,
      ack,
      ackWithResponse,
      nack,
    });
    await new Promise((resolve) => setImmediate(resolve));

    expect(worker.process).toHaveBeenCalledWith('host:Organization:_status', request);
    expect(responseStore.set).toHaveBeenCalledWith('thread-1', {
      status: 'COMPLETED',
      vaultId: 'host',
      result: 'encrypted-result',
      contentType: 'application/didcomm-encrypted+json',
    });
    expect(events).toEqual(['processed', 'persisted', 'acked']);
    expect(ack).not.toHaveBeenCalled();
    expect(ackWithResponse).toHaveBeenCalledTimes(1);
    expect(nack).not.toHaveBeenCalled();
    expect(payloadStore.get).toHaveBeenCalledWith('payload-1');
    expect(payloadStore.delete).toHaveBeenCalledWith('payload-1');
    await adapter.close();
  });

  it('nacks a valid job when its completed response cannot be persisted', async () => {
    const subscription = new SubscriptionFake();
    const client = {
      topic: jest.fn(() => ({ publishMessage: jest.fn().mockResolvedValue('message-1') })),
      subscription: jest.fn(() => subscription),
    };
    const responseStore = {
      get: jest.fn(),
      set: jest.fn().mockRejectedValue(new Error('firestore unavailable')),
      delete: jest.fn(),
    };
    const worker = { process: jest.fn().mockResolvedValue('encrypted-result') };
    const payloadStore = {
      put: jest.fn(),
      get: jest.fn().mockResolvedValue({
        schemaVersion: 1,
        jobName: 'host:Organization:_status',
        priority: 10,
        request: { tenantId: 'host', sector: 'animal-care', content: { thid: 'thread-2' } },
      }),
      delete: jest.fn(),
    };
    const adapter = new QueueAdapterGcpPubSub(responseStore as any, worker as any, {
      client: client as any,
      topicName: 'gw-jobs',
      subscriptionName: 'gw-jobs-worker',
      payloadStore: payloadStore as any,
    });
    const ack = jest.fn();
    const nack = jest.fn();

    subscription.emit('message', {
      data: Buffer.from(JSON.stringify({ schemaVersion: 1, payloadRef: 'payload-2' })),
      ack,
      nack,
    });
    await new Promise((resolve) => setImmediate(resolve));

    expect(ack).not.toHaveBeenCalled();
    expect(nack).toHaveBeenCalledTimes(1);
    await adapter.close();
  });
});
