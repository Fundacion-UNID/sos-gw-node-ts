import {
  COMMUNICATION_CREATION_MESSAGE,
  COMPOSITION_UPDATE_MESSAGE,
  CONSENT_CREATION_MESSAGE,
  DEVICE_REGISTRATION_REQUEST,
  EMPLOYEE_REGISTRATION_REQUEST,
  FAMILY_ORDER_REQUEST,
  FAMILY_REGISTRATION_REQUEST,
  FAMILY_REGISTRATION_REQUEST_INLINE_BASE64,
  FIREBASE_CUSTOM_TOKEN_REQUEST,
  INITIAL_ACCESS_TOKEN_EXCHANGE_REQUEST,
  LICENSE_ISSUE_REQUEST,
  ORGANIZATION_ORDER_REQUEST,
  ORGANIZATION_REGISTRATION_REQUEST,
  SMART_TOKEN_REQUEST,
} from '../src/__tests__/data/example-payloads.ts';

const fixtures = {
  COMMUNICATION_CREATION_MESSAGE,
  COMPOSITION_UPDATE_MESSAGE,
  CONSENT_CREATION_MESSAGE,
  DEVICE_REGISTRATION_REQUEST,
  EMPLOYEE_REGISTRATION_REQUEST,
  FAMILY_ORDER_REQUEST,
  FAMILY_REGISTRATION_REQUEST,
  FAMILY_REGISTRATION_REQUEST_INLINE_BASE64,
  FIREBASE_CUSTOM_TOKEN_REQUEST,
  INITIAL_ACCESS_TOKEN_EXCHANGE_REQUEST,
  LICENSE_ISSUE_REQUEST,
  ORGANIZATION_ORDER_REQUEST,
  ORGANIZATION_REGISTRATION_REQUEST,
  SMART_TOKEN_REQUEST,
} as const;

type FixtureName = keyof typeof fixtures;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value));
}

function decodeJsonArg(raw: string | undefined): Record<string, unknown> {
  if (!raw || !raw.trim()) return {};
  return JSON.parse(raw);
}

function decodeJsonPointerSegment(segment: string): string {
  return segment.replace(/~1/g, '/').replace(/~0/g, '~');
}

function setByJsonPointer(target: any, pointer: string, value: unknown) {
  if (!pointer.startsWith('/')) {
    throw new Error(`Invalid JSON pointer '${pointer}'. Expected leading '/'.`);
  }
  const segments = pointer
    .split('/')
    .slice(1)
    .map(decodeJsonPointerSegment);

  let cursor = target;
  for (let i = 0; i < segments.length - 1; i += 1) {
    const current = segments[i];
    const next = segments[i + 1];
    const nextIsIndex = /^\d+$/.test(next);

    if (Array.isArray(cursor)) {
      const index = Number(current);
      if (!Number.isInteger(index)) {
        throw new Error(`Expected array index in pointer '${pointer}' at segment '${current}'.`);
      }
      if (cursor[index] === undefined) {
        cursor[index] = nextIsIndex ? [] : {};
      }
      cursor = cursor[index];
      continue;
    }

    if (cursor[current] === undefined) {
      cursor[current] = nextIsIndex ? [] : {};
    }
    cursor = cursor[current];
  }

  const finalSegment = segments[segments.length - 1];
  if (Array.isArray(cursor)) {
    const index = Number(finalSegment);
    if (!Number.isInteger(index)) {
      throw new Error(`Expected final array index in pointer '${pointer}' at segment '${finalSegment}'.`);
    }
    cursor[index] = value;
    return;
  }
  cursor[finalSegment] = value;
}

function applyPointerOverrides<T>(base: T, overrides: Record<string, unknown>): T {
  const result = clone(base);
  for (const [pointer, value] of Object.entries(overrides)) {
    setByJsonPointer(result, pointer, value);
  }
  return result;
}

function main() {
  const fixtureName = process.argv[2] as FixtureName | undefined;
  const overridesArg = process.argv[3] || process.env.EXAMPLE_OVERRIDES_JSON;

  if (!fixtureName || !(fixtureName in fixtures)) {
    const available = Object.keys(fixtures).sort().join(', ');
    throw new Error(`Usage: render-example-payload.mts <FIXTURE_NAME> [JSON_POINTER_OVERRIDES_JSON]\nAvailable: ${available}`);
  }

  const base = fixtures[fixtureName];
  const overrides = decodeJsonArg(overridesArg);
  const rendered = applyPointerOverrides(base, overrides);
  process.stdout.write(JSON.stringify(rendered));
}

main();
