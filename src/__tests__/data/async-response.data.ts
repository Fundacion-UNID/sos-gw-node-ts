// src/__tests__/data/async-response.data.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { v4 as uuidv4 } from 'uuid';
import { StoredJob } from '../../adapters/async-response-store.mem';

export const testThid1 = uuidv4();
export const testEncryptedJwe1 = 'eyJhbGciOiJSU0EtT0FFUC0yNTYiLCJlbmMiOiJBMjU2R0NNIn0.protected.encrypted_key.iv.ciphertext.tag';

export const testPendingJob: StoredJob = {
  status: 'PENDING',
};

export const testCompletedJob: StoredJob = {
  status: 'COMPLETED',
  result: testEncryptedJwe1,
};
