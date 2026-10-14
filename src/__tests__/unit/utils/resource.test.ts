// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.
// File: src/__tests__/unit/utils/resource.test.ts

import { jest } from '@jest/globals';

const uuidMock = {
    v4: jest.fn(),
    validate: jest.fn(),
};

jest.unstable_mockModule('uuid', () => uuidMock);

const { determineResourceId } = await import('../../../utils/resource'); // Corrected import path
const { v4: uuidv4, validate: uuidValidate } = await import('uuid');

describe('determineResourceId', () => {
    const validUuid = 'a1b2c3d4-e5f6-7890-1234-567890abcdef';
    const validIdentifier = `urn:uuid:${validUuid}`;
    const nonUuidIdentifier = 'user-123';
    
    beforeEach(() => {
        // Reset mocks before each test
        (uuidv4 as jest.Mock).mockClear();
        (uuidValidate as jest.Mock).mockClear();
    });

    it('should return the UUID from a valid identifier', () => {
        (uuidValidate as jest.Mock).mockReturnValue(true);
        const resourceId = determineResourceId(validIdentifier);
        expect(resourceId).toBe(validUuid);
        expect(uuidv4).not.toHaveBeenCalled();
    });

    it("should generate a new UUID if the identifier is invalid", () => {
        (uuidValidate as jest.Mock).mockReturnValue(false);
        (uuidv4 as jest.Mock).mockReturnValue('new-generated-uuid');
        const resourceId = determineResourceId('invalid-identifier');
        expect(resourceId).toBe('new-generated-uuid');
        expect(uuidv4).toHaveBeenCalledTimes(1);
    });

    it("should generate a new UUID if no identifier is provided", () => {
        (uuidv4 as jest.Mock).mockReturnValue('new-generated-uuid');
        const resourceId = determineResourceId(undefined);
        expect(resourceId).toBe('new-generated-uuid');
        expect(uuidv4).toHaveBeenCalledTimes(1);
    });

    it("should return the non-UUID identifier directly when in 'demo' mode", () => {
        const resourceId = determineResourceId(nonUuidIdentifier, 'demo');
        expect(resourceId).toBe(nonUuidIdentifier);
        expect(uuidValidate).not.toHaveBeenCalled();
        expect(uuidv4).not.toHaveBeenCalled();
    });

    it("should still extract a valid UUID even in 'demo' mode if provided", () => {
        (uuidValidate as jest.Mock).mockReturnValue(true);
        const resourceId = determineResourceId(validIdentifier, 'demo');
        expect(resourceId).toBe(validUuid);
    });

    it("should extract the UUID from a complex identifier string containing a comma", () => {
        (uuidValidate as jest.Mock).mockReturnValue(true);
        const complexIdentifier = `urn:uuid:${validUuid},did:web:some-controller`;
        const resourceId = determineResourceId(complexIdentifier);
        expect(resourceId).toBe(validUuid);
        expect(uuidv4).not.toHaveBeenCalled();
    });
});
