// src/__tests__/unit/crypto/jwk-thumbprint.test.ts

// WebCrypto is available in Node 18+. This line makes it available to the test runner.
import { webcrypto } from 'node:crypto';

globalThis.crypto = webcrypto as any;

import { MlkemPublicJwk, MldsaPublicJwk } from "gdc-common-utils-ts/interfaces/Cryptography.types";
import {
    toBaseJwk,
    computeJwkThumbprint,
    makePublicJwkWithKid,
} from "../../../gdc-backend-utils-node/jwk-thumbprint";
import { canonicalize } from "../../../utils/json-canon";

describe("JWK thumbprints for ML-KEM (OKP) and ML-DSA (AKP)", () => {
    test("Base JWK extraction for ML-KEM keeps only crv,kty,x", () => {
        const pubKem: MlkemPublicJwk = {
            kty: "OKP",
            crv: "ML-KEM-768",
            x: "AQIDBA",
            kid: "ignore-me",
        };
        const base = toBaseJwk(pubKem);
        expect(base).toEqual({
            kty: "OKP",
            crv: "ML-KEM-768",
            x: "AQIDBA",
        });
        // no kid here
        expect((base as any).kid).toBeUndefined();
    });

    test("Base JWK extraction for ML-DSA keeps only alg,kty,pub", () => {
        const pubDsa: MldsaPublicJwk = {
            kty: "AKP",
            alg: "ML-DSA-65",
            pub: "Zm9vYmFy",
            kid: "ignore-me",
        };
        const base = toBaseJwk(pubDsa);
        expect(base).toEqual({
            kty: "AKP",
            alg: "ML-DSA-65",
            pub: "Zm9vYmFy",
        });
        expect((base as any).kid).toBeUndefined();
    });

    test("Canonical JSON is lexicographic and compact", () => {
        const kemBase = { kty: "OKP", x: "AQIDBA", crv: "ML-KEM-768" };
        const canonical = canonicalize(kemBase);
        // Keys must be in order: crv, kty, x
        expect(canonical).toBe('{"crv":"ML-KEM-768","kty":"OKP","x":"AQIDBA"}');
    });

    test("Known thumbprint vector for ML-KEM (OKP) with SHA-256", async () => {
        // Base JWK canonical:
        // {"crv":"ML-KEM-768","kty":"OKP","x":"AQIDBA"}
        // Precomputed thumbprint: glmw6ePQD0KXPyHOGLK52XWcPmK3tjWjEGxboiWmErc
        const kem = { kty: "OKP", crv: "ML-KEM-768", x: "AQIDBA" } as const;
        const tp = await computeJwkThumbprint(kem);
        expect(tp).toBe("glmw6ePQD0KXPyHOGLK52XWcPmK3tjWjEGxboiWmErc");
    });

    test("Known thumbprint vector for ML-DSA (AKP) with SHA-256", async () => {
        // Base JWK canonical:
        // {"alg":"ML-DSA-65","kty":"AKP","pub":"Zm9vYmFy"}
        // Precomputed thumbprint: zRghDhXixbmcA7PuRmwdk7xCxsram-o1n8ZpykiuIF8
        const dsa = { kty: "AKP", alg: "ML-DSA-65", pub: "Zm9vYmFy" } as const;
        const tp = await computeJwkThumbprint(dsa);
        expect(tp).toBe("zRghDhXixbmcA7PuRmwdk7xCxsram-o1n8ZpykiuIF8");
    });

    test("withKid adds the RFC 7638 thumbprint as kid (KEM)", async () => {
        const kem = await makePublicJwkWithKid({
            kty: "OKP",
            crv: "ML-KEM-768",
            x: "AQIDBA",
        });
        expect(kem.kid).toBe("glmw6ePQD0KXPyHOGLK52XWcPmK3tjWjEGxboiWmErc");
    });

    test("withKid adds the RFC 7638 thumbprint as kid (DSA)", async () => {
        const dsa = await makePublicJwkWithKid({
            kty: "AKP",
            alg: "ML-DSA-65",
            pub: "Zm9vYmFy",
        });
        expect(dsa.kid).toBe("zRghDhXixbmcA7PuRmwdk7xCxsram-o1n8ZpykiuIF8");
    });
});
