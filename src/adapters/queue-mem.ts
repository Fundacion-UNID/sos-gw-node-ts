import { JobRequest } from 'gdc-common-utils-ts/models/confidential-job';
import { getTenantVaultId } from '../utils/tenant';
import { IAsyncResponseStore, StoredJob } from './async-response-store.mem';
import { QueueAdapter } from './queue';
import { Worker } from '../worker'

/**
 * An in-memory implementation of the QueueAdapter.
import { Worker } from '../worker';
import { JobRequest } from '../models/confidential-job';
import { IAsyncResponseStore, StoredJob } from './async-response-store.mem';

/**
 * An in-memory implementation of the QueueAdapter.
 * It follows the Adapter pattern: its only job is to manage a queue of jobs in memory.
 * It is "dumb" and knows nothing about how to process the jobs. It delegates that
 * responsibility to an injected Worker instance.
 *
 * This design allows for easily swapping this implementation with a more robust one
 * like RabbitMQ or Redis (e.g., BullMQ) without changing any other part of the system.
 */
export class QueueAdapterMem implements QueueAdapter {
  private queue: { name: string; request: JobRequest; priority: number }[] = [];
  private responseStore: IAsyncResponseStore;
  private worker: Worker;
  private intervalId: NodeJS.Timeout | null = null;

  constructor(responseStore: IAsyncResponseStore, worker: Worker) {
    this.responseStore = responseStore;
    this.worker = worker;
    this.startWorker();
  }



  /**
   * Adds a job to the in-memory queue.
   */
  async addJob(jobName: string, request: JobRequest, priority = 10): Promise<void> {
    this.queue.push({ name: jobName, request, priority });
    // Sort by priority (lower value = higher priority)
    this.queue.sort((a, b) => a.priority - b.priority);
  }

  /**
   * The core processing loop. It pulls a job from the queue and passes it to the Worker.
   */
  private async processQueue(): Promise<void> {
    if (this.queue.length > 0) {
      const job = this.queue.shift();
      if (job) {
        const thid = job.request.content?.thid;
        if (!thid) {
          console.error(`Job ${job.name} is missing a 'thid'. Skipping.`);
          return;
        }
        try {
          // Delegate to the worker, which now returns the final, encrypted JWE string.
          const encryptedResult = await this.worker.process(job.name, job.request);
          
          // CRITICAL ARCHITECTURE: The vaultId MUST be persisted in the stored job.
          // It is constructed here from the job's tenantId (alternateName) and sector,
          // because this is the last point before the result is stored for polling.
          const vaultId = job.request.tenantId === 'host'
            ? 'host'
            : getTenantVaultId(job.request.sector!, job.request.tenantId!);

          const finalResult: StoredJob = { 
            status: 'COMPLETED', 
            vaultId: vaultId, // Persist the vaultId
            result: encryptedResult,
            contentType: job.request.contentType, // Persist the original content type
          };
          await this.responseStore.set(thid, finalResult);
        } catch (error) {
          // This catch is for catastrophic errors where the worker itself fails.
          const errorMessage = `Catastrophic failure in worker while processing job ${job.name}: ${(error as Error).message}`;
          console.error(errorMessage);
          const finalResult: StoredJob = { status: 'FAILED', result: JSON.stringify({ error: errorMessage }) };
          await this.responseStore.set(thid, finalResult);
        }
      }
    }
  }

  /**
   * Starts a simple interval to process the queue periodically.
   * In a real system, this would be a more robust consumer process.
   */
  private startWorker(): void {
    this.intervalId = setInterval(() => { this.processQueue(); }, 50);
  }

  /**
   * Stops the worker's processing loop. Essential for graceful shutdowns in tests.
   */
  public stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }
  
  /**
   * FOR TESTING ONLY: Returns a promise that resolves when the queue is empty.
   * This is crucial for synchronous testing of asynchronous operations.
   */
  public async waitForEmptyQueue(): Promise<void> {
    return new Promise(resolve => {
      const checkQueue = () => {
        if (this.queue.length === 0) {
          resolve();
        } else {
          setTimeout(checkQueue, 50); // Check again after a short delay
        }
      };
      checkQueue();
    });
  }  
}
