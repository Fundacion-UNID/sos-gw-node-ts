// src/adapters/async-response-store.mem.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

/**
 * Represents the structure of a stored job result.
 */
export interface StoredJob {
  status: 'PENDING' | 'COMPLETED' | 'FAILED';
  vaultId?: string; // The vaultId of the tenant who owns the job
  result?: any; // The encrypted JWE or an error object
  contentType?: string; // The content type of the original request
}

export type AsyncStoreResult<T> = T | Promise<T>;

/**
 * Defines the contract for a temporary key-value store used to hold
 * the results of asynchronous operations.
 */
export interface IAsyncResponseStore {
  /**
   * Retrieves a job's status and result by its thread ID.
   * @param thid The unique thread identifier.
   * @returns The stored job object, or undefined if not found.
   */
  get(thid: string): AsyncStoreResult<StoredJob | undefined>;

  /**
   * Stores a job's status and result.
   * @param thid The unique thread identifier.
   * @param value The job object to store.
   */
  set(thid: string, value: StoredJob): AsyncStoreResult<void>;

  /**
   * Deletes a job from the store.
   * @param thid The unique thread identifier.
   */
  delete(thid: string): AsyncStoreResult<void>;
}

/**
 * An in-memory implementation of the IAsyncResponseStore.
 * Useful for development, testing, or single-instance deployments.
 * In a scaled environment, this would be replaced with Redis, Firestore, etc.
 */
export class AsyncResponseStoreMem implements IAsyncResponseStore {
  private store = new Map<string, StoredJob>();

  public get(thid: string): StoredJob | undefined {
    return this.store.get(thid);
  }

  public set(thid: string, value: StoredJob): void {
    this.store.set(thid, value);
  }

  public delete(thid: string): void {
    this.store.delete(thid);
  }

  /**
   * Clears the entire store. Used for test teardown.
   */
  public clear(): void {
    this.store.clear();
  }
}
