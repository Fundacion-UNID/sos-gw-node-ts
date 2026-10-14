// src/__tests__/utils/vc-id.test.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { generateVcId } from '../../utils/vc-id';
import { testHostVc } from '../data/credential.data';

describe('VC ID Generation', () => {
  it('should generate a deterministic, versioned ID based on subject URN and issuance date', () => {
    // Arrange
    const subjectIdentifier = testHostVc.credentialSubject.identifier as string;
    const validFrom = testHostVc.validFrom as string;

    // This is the known correct output for the given input.
    // It is derived from the SHA3-256 hash of 'did:web:host.dev.antifraud.svc:timestamp:epoch:1759161600'
    const expectedVcId = 'urn:multibase:zTPUv68jLbzLtntHG39SMcJuKd8eLSfz4eTcPSGMumqQfHC';

    // Act
    const generatedId = generateVcId(subjectIdentifier, validFrom);

    // Assert
    expect(generatedId).toEqual(expectedVcId);
  });
});
