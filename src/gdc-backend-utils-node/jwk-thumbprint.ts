// src/crypto/jwk-thumbprint.ts
// Minimal utilities for ML-KEM (OKP) and ML-DSA (AKP)

import { Content } from "gdc-common-utils-ts/utils/content";
import { BaseJwk, PublicJwk, MlkemCurve, MldsaAlg, MlkemPublicJwk, MldsaPublicJwk, EcBaseJwk } from "gdc-common-utils-ts/interfaces/Cryptography.types";

/**
 * Creates a canonical string from a simple, flat JSON object as required by
 * RFC 7638 for JWK thumbprints. It performs a shallow, lexicographic sort of keys.
 * THIS IS NOT a general-purpose canonicalization function for complex objects.
 * @param obj The simple (BaseJwk) object to canonicalize.
 * @returns A compact, sorted JSON string.
 */
function canonicalizeForJwkThumbprint(obj: Record<string, unknown>): string {
    const keys = Object.keys(obj).sort();
    const parts = keys.map(k => `"${k}":${JSON.stringify(obj[k])}`);
    return `{${parts.join(",")}}`;
}

/** Compute JWK thumbprint per RFC 7638. Default SHA-256. */
export async function computeJwkThumbprint(
    baseJwk: BaseJwk,
    hash: "SHA-256" | "SHA-384" = "SHA-256"
): Promise<string> {
    const canonical = canonicalizeForJwkThumbprint(baseJwk);
    const digest = await crypto.subtle.digest(hash, Buffer.from(canonical));
    return Content.bytesToRawBase64UrlSafe(new Uint8Array(digest));
}

/** Extract Base JWK for thumbprint calculation per RFC 7638 */
export function toBaseJwk(jwk: PublicJwk): BaseJwk {
    if (jwk.kty === "OKP") {
        // For ML-KEM and other OKP keys (like Ed25519)
        const { crv, x } = jwk;
        return { kty: "OKP", crv, x };
    } else if (jwk.kty === "AKP") {
        // For ML-DSA
        const { alg, pub } = jwk;
        return { kty: "AKP", alg, pub };
    } else if (jwk.kty === "EC") {
        // For Elliptic Curve keys (legacy)
        const { crv, x, y } = jwk;
        const baseJwk: EcBaseJwk = { kty: "EC", crv, x, y };
        return baseJwk;
    } else {
        // This will cause a compile-time error if any type in PublicJwk is not handled.
        const exhaustiveCheck: never = jwk;
        throw new Error(`Unsupported key type for JWK thumbprint: ${(exhaustiveCheck as any).kty}`);
    }
}

/**
* Ensure kid on a Public JWK.
* Returns a copy with kid set to the RFC 7638 thumbprint of the Base JWK view.
*/
export async function withKid<T extends PublicJwk>(
    jwk: T,
    hash: "SHA-256" | "SHA-384" = "SHA-256"
): Promise<T & { kid: string }> {
    const base = toBaseJwk(jwk);
    const kid = await computeJwkThumbprint(base, hash);
    return { ...jwk, kid };
}

/** Build a Public JWK and attach kid in one call */
export async function makePublicJwkWithKid(
    params:
        | { kty: "OKP"; crv: MlkemCurve; x: string; alg?: never }
        | { kty: "AKP"; alg: MldsaAlg; pub: string; crv?: never },
    hash: "SHA-256" | "SHA-384" = "SHA-256"
) {
    const jwk = params.kty === "OKP"
        ? ({ kty: "OKP", crv: params.crv, x: params.x } as MlkemPublicJwk)
        : ({ kty: "AKP", alg: params.alg, pub: params.pub } as MldsaPublicJwk);
    return withKid(jwk, hash);
}
