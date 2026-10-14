// src/utils/fhir-versioning.ts
// Copyright 2026 Antifraud Services Inc. under the Apache License, Version 2.0.

import { sha3_384 } from '@noble/hashes/sha3.js';
import { utf8ToBytes } from '@noble/hashes/utils.js';
import { encodeMultibase58btc } from 'gdc-common-utils-ts/utils/multibase58';
import { CompositionClaim } from 'gdc-common-utils-ts/models/interoperable-claims/composition-claims';
import type { LedgerSafeMetaTag } from '../services/ai/metaTagSanitizer';
import { extractLedgerSafeResearchTags } from './fhir-ingestion';
import { ClinicalEvidenceChaincode, resolveClinicalDataChannel } from './ledger';
import { uuidToBytes } from './uuid';

export type FhirCidVersionMapping = {
  resourceType?: string;
  resourceId?: string;
  cid: string;
  versionId: string;
  tags?: LedgerSafeMetaTag[];
  relationships?: FhirLedgerRelationships;
  ownerships?: string[];
};

export type FhirLedgerRelationshipKind =
  | 'author'
  | 'attester'
  | 'custodian'
  | 'sender'
  | 'submitter'
  | 'signingKey';

export type FhirLedgerRelationships = Partial<Record<FhirLedgerRelationshipKind, string[]>>;

export type FhirLedgerProvenance = Readonly<{
  relationships: FhirLedgerRelationships;
  ownerships: string[];
}>;

const MULTIHASH_SHA3_384_CODE = 0x15;
const MULTIHASH_SHA3_384_LEN = 48;
const UUID_TEXT_PATTERN = '[0-9a-fA-F]{8}-?[0-9a-fA-F]{4}-?[1-5][0-9a-fA-F]{3}-?[89abAB][0-9a-fA-F]{3}-?[0-9a-fA-F]{12}';
const UUID_REFERENCE_PATTERN = new RegExp(`(?:^urn:uuid:|^|/|:instance:)(${UUID_TEXT_PATTERN})$`, 'i');

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((acc, p) => acc + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

function encodeVarint(value: number): Uint8Array {
  if (!Number.isInteger(value) || value < 0) throw new Error(`Invalid varint value ${value}`);
  const out: number[] = [];
  let n = value >>> 0;
  while (n >= 0x80) {
    out.push((n & 0x7f) | 0x80);
    n >>>= 7;
  }
  out.push(n);
  return Uint8Array.from(out);
}

function sha3Multihash(value: string | Uint8Array): string {
  const digest = sha3_384(typeof value === 'string' ? utf8ToBytes(value) : value);
  const multihash = concatBytes(
    encodeVarint(MULTIHASH_SHA3_384_CODE),
    encodeVarint(MULTIHASH_SHA3_384_LEN),
    digest,
  );
  return encodeMultibase58btc(multihash);
}

/** Builds a private deterministic ledger link, hashing UUID references as their canonical 16 bytes. */
export function buildClinicalLedgerReferenceId(reference: string): string {
  const canonicalReference = String(reference || '').trim();
  const uuid = UUID_REFERENCE_PATTERN.exec(canonicalReference)?.[1];
  return sha3Multihash(uuid ? uuidToBytes(uuid) : canonicalReference);
}

function splitReferenceList(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap((item) => splitReferenceList(item));
  return String(value ?? '').split(',').map((item) => item.trim()).filter(Boolean);
}

function hashReferenceList(value: unknown): string[] {
  return Array.from(new Set(splitReferenceList(value))).map(buildClinicalLedgerReferenceId);
}

/** Projects private FHIR provenance into opaque ledger-safe relationship links. */
export function buildFhirLedgerProvenance(input: Readonly<{
  claims: Readonly<Record<string, unknown>>;
  sender?: string;
  submitter?: string;
  signingKeyId?: string;
  subject?: string;
}>): FhirLedgerProvenance {
  const relationshipInputs: ReadonlyArray<readonly [FhirLedgerRelationshipKind, unknown]> = [
    ['author', input.claims[CompositionClaim.Author]],
    ['attester', input.claims[CompositionClaim.Attester]],
    ['custodian', input.claims[CompositionClaim.Custodian]],
    ['sender', input.sender],
    ['submitter', input.submitter],
    ['signingKey', input.signingKeyId],
  ];
  const relationships: FhirLedgerRelationships = {};
  for (const [kind, raw] of relationshipInputs) {
    const hashes = hashReferenceList(raw);
    if (hashes.length) relationships[kind] = hashes;
  }
  return {
    relationships,
    ownerships: hashReferenceList(input.subject || input.claims[CompositionClaim.Subject]),
  };
}

function canonicalizeValue(value: unknown, depth = 0): unknown {
  if (Array.isArray(value)) return value.map((v) => canonicalizeValue(v, depth + 1));
  if (value && typeof value === 'object') {
    const asRecord = value as Record<string, unknown>;
    const keys = Object.keys(asRecord).sort();
    const out: Record<string, unknown> = {};
    for (const key of keys) {
      if (depth === 0 && (key === 'id' || key === 'meta' || key === 'text')) {
        continue;
      }
      out[key] = canonicalizeValue(asRecord[key], depth + 1);
    }
    return out;
  }
  return value;
}

export function canonicalizeFhirResource(resource: Record<string, unknown>): string {
  return JSON.stringify(canonicalizeValue(resource, 0));
}

export function fhirResourceToCid(resource: Record<string, unknown>): { cid: string; versionId: string } {
  const canonicalJson = canonicalizeFhirResource(resource);
  const versionId = sha3Multihash(canonicalJson);
  return { cid: versionId, versionId };
}

export function applyFhirCidVersioningToEntry(params: {
  entry: any;
  claims?: Record<string, any>;
  resourceType: string;
  resourceId: string;
}): { versionId?: string; mapping?: FhirCidVersionMapping } {
  const { entry, claims, resourceType, resourceId } = params;
  const resource = entry?.resource;
  if (!resource || typeof resource !== 'object' || Array.isArray(resource)) {
    return {};
  }

  if (!resource.id) {
    resource.id = resourceId;
  }
  if (!resource.meta || typeof resource.meta !== 'object' || Array.isArray(resource.meta)) {
    resource.meta = {};
  }

  const { cid, versionId } = fhirResourceToCid(resource as Record<string, unknown>);
  resource.meta.versionId = versionId;

  if (claims && typeof claims === 'object') {
    const context = claims['@context'];
    claims[`${resourceType}.meta.versionId`] = versionId;
    if (typeof context === 'string' && context.trim().length > 0) {
      const prefix = context.endsWith('.') ? context : `${context}.`;
      claims[`${prefix}${resourceType}.meta.versionId`] = versionId;
    }
  }

  return {
    versionId,
    mapping: {
      resourceType,
      resourceId: String(resource.id || resourceId),
      cid,
      versionId,
      tags: extractLedgerSafeResearchTags(entry),
    },
  };
}

export async function registerFhirCidMappings(params: {
  blockchainAdapter?: {
    registerCidVersionMappings?: (
      mappings: FhirCidVersionMapping[],
      channel: string,
      chaincode: string,
    ) => Promise<{ accepted: number; txId?: string }>;
  };
  sector: string;
  jurisdiction: string;
  mappings: FhirCidVersionMapping[];
}): Promise<void> {
  const { blockchainAdapter, sector, jurisdiction, mappings } = params;
  if (!blockchainAdapter?.registerCidVersionMappings) return;
  if (!mappings || mappings.length === 0) return;

  await blockchainAdapter.registerCidVersionMappings(
    mappings,
    resolveClinicalDataChannel(sector, jurisdiction),
    ClinicalEvidenceChaincode,
  );
}
