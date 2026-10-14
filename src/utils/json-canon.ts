// src/utils/json-canon.ts

// A robust, general-purpose, RFC 8785-compliant JSON canonicalization utility.
// Use this before signing any complex JSON object to ensure a stable,
// reproducible byte representation for signature verification.

// Sourced from 'is-plain-object': https://github.com/yefremov/isplainobject
/**
 * Test whether a value is a plain object.
 * @param data The value to test.
 * @returns True if the value is a plain object, false otherwise.
 */
function isPlainObject(data: any): boolean {
    if (Object.prototype.toString.call(data) !== '[object Object]') {
        return false;
    }
    const proto = Object.getPrototypeOf(data);
    return proto === null || proto === Object.prototype;
}

// Sourced from 'js-deep-sort-object': https://github.com/IndigoUnited/js-deep-sort-object
function defaultSortFn(a: string, b: string): number {
    return a.localeCompare(b);
}

/**
 * Recursively sorts the keys of a JSON object or array.
 * @param json The object or array to sort.
 * @param comparator An optional comparison function for keys.
 * @returns The deep-sorted object or array.
 */
function deepSort(json: any, comparator?: (a: string, b: string) => number): any {
    if (Array.isArray(json)) {
        return json.map(item => deepSort(item, comparator));
    }

    if (isPlainObject(json)) {
        const out: { [key: string]: any } = {};
        Object.keys(json).sort(comparator || defaultSortFn).forEach(key => {
            out[key] = deepSort(json[key], comparator);
        });
        return out;
    }

    return json;
}

/**
 * Creates a canonical string representation of a JSON object by deep sorting
 * its keys and then serializing it to a compact string.
 * This is the primary export for general-purpose JSON canonicalization.
 * @param obj The JSON object to canonicalize.
 * @returns The canonical string.
 */
export function canonicalize(obj: any): string {
    const sorted = deepSort(obj);
    return JSON.stringify(sorted);
}
