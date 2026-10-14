// src/__tests__/unit/adapters/async-response-store.mem.test.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { AsyncResponseStoreMem } from '../../../adapters/async-response-store.mem';
import { testThid1, testPendingJob, testCompletedJob } from '../../data/async-response.data';

describe('AsyncResponseStoreMem', () => {
  let store: AsyncResponseStoreMem;

  beforeEach(() => {
    store = new AsyncResponseStoreMem();
  });

  it('should set and get a job successfully', () => {
    // Arrange
    const thid = testThid1;
    const job = testPendingJob;

    // Act
    store.set(thid, job);
    const retrievedJob = store.get(thid);

    // Assert
    expect(retrievedJob).toBeDefined();
    expect(retrievedJob).toEqual(job);
  });

  it('should return undefined for a non-existent job', () => {
    // Act
    const retrievedJob = store.get('non-existent-thid');

    // Assert
    expect(retrievedJob).toBeUndefined();
  });

  it('should delete a job successfully', () => {
    // Arrange
    const thid = testThid1;
    store.set(thid, testPendingJob);
    
    // Act
    store.delete(thid);
    const retrievedJob = store.get(thid);

    // Assert
    expect(retrievedJob).toBeUndefined();
  });

  it('should overwrite an existing job with the same thid', () => {
    // Arrange
    const thid = testThid1;
    store.set(thid, testPendingJob);

    // Act
    store.set(thid, testCompletedJob);
    const retrievedJob = store.get(thid);

    // Assert
    expect(retrievedJob).toEqual(testCompletedJob);
  });
});
