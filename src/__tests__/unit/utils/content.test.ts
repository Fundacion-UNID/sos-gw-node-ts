// src/__tests__/unit/utils/convert.test.ts

import { Content } from 'gdc-common-utils-ts/utils/content';

describe("Content Class - Conversion Utilities", () => {

    describe("Base58 Conversions", () => {
        it("should encode and decode a string to/from Base58", () => {
            const testString = "Hello world!";
            const testBytes = Content.stringToBytesUTF8(testString);

            // Encode
            const encoded = Content.bytesToBase58(testBytes);
            expect(encoded).toBe("2NEpo7TZRhna7vSvL");

            // Decode
            const decodedBytes = Content.base58ToBytes(encoded);
            const decodedString = Content.bytesToStringUTF8(decodedBytes);

            expect(decodedString).toBe(testString);
        });
    });

    describe("Base64URL Conversions", () => {
        it("should encode and decode bytes to/from raw Base64URL", () => {
            const testString = "some important data!?";
            const testBytes = Content.stringToBytesUTF8(testString);

            // Encode
            const encoded = Content.bytesToRawBase64UrlSafe(testBytes);
            expect(encoded).toBe("c29tZSBpbXBvcnRhbnQgZGF0YSE_");

            // Decode
            const decodedBytes = Content.base64ToBytes(encoded);
            expect(decodedBytes).toEqual(testBytes);
        });
    });

    describe("Object Serialization", () => {
        it("should serialize and deserialize an object to/from raw Base64URL", () => {
            const testObject = {
                id: "12345",
                aud: ["did:web:example.com"],
                exp: 1678886400,
                verified: true,
            };

            // Serialize
            const encoded = Content.objectToRawBase64UrlSafe(testObject);

            // Deserialize
            const decodedObject = Content.base64UrlSafeToJSON(encoded);

            expect(decodedObject).toEqual(testObject);
        });
    });

    describe("Array Utilities", () => {
        it("should correctly compare two identical arrays of primitives", () => {
            const arr1 = [1, 2, "hello", true, null];
            const arr2 = [1, 2, "hello", true, null];
            expect(Content.arrayCompare(arr1, arr2)).toBe(true);
        });

        it("should correctly identify two different arrays", () => {
            const arr1 = [1, 2, 5];
            const arr2 = [1, 2, 9];
            expect(Content.arrayCompare(arr1, arr2)).toBe(false);
        });
    });
});

