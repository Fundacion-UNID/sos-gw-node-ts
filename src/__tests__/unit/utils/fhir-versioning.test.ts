// Flow contract: reuse shared test fixtures and canonical types; do not introduce duplicated literals.
// Canonical FHIR content produces a deterministic CID while
// transport location stays private and optional coded tags are positively
// allowlisted before the mapping reaches a blockchain adapter.
// TDD contract: write this test red first; make it green only with the complete real behavior.
import { ResourceTypesFhirR4 } from 'gdc-common-utils-ts/constants/fhir-resource-types';
import { CompositionClaim } from 'gdc-common-utils-ts/models/interoperable-claims/composition-claims';
import {
  EXAMPLE_CONTROLLER_DID,
  EXAMPLE_CONTROLLER_SIGN_KEY,
  EXAMPLE_KYC_CONTROLLER_USER_UUID,
  EXAMPLE_PROFESSIONAL_DID,
  EXAMPLE_PROVIDER_ORGANIZATION_DID,
} from 'gdc-common-utils-ts/examples/shared';
import { describe, expect, it, jest } from '@jest/globals';
import {
  applyFhirCidVersioningToEntry,
  buildClinicalLedgerReferenceId,
  buildFhirLedgerProvenance,
  canonicalizeFhirResource,
  fhirResourceToCid,
  registerFhirCidMappings,
} from '../../../utils/fhir-versioning';
import { uuidToBytes } from '../../../utils/uuid';
import { sha3_384 } from '@noble/hashes/sha3.js';
import { encodeMultibase58btc } from 'gdc-common-utils-ts/utils/multibase58';

describe('fhir-versioning utils', () => {
  it('anchors UUID-backed employees from their 16 UUID bytes, independent of reference syntax', () => {
    const employeeUuid = EXAMPLE_KYC_CONTROLLER_USER_UUID;
    const expected = encodeMultibase58btc(Uint8Array.from([
      0x15,
      0x30,
      ...sha3_384(uuidToBytes(employeeUuid)),
    ]));

    expect(buildClinicalLedgerReferenceId(employeeUuid)).toBe(expected);
    expect(buildClinicalLedgerReferenceId(`urn:uuid:${employeeUuid}`)).toBe(expected);
    expect(buildClinicalLedgerReferenceId(`PractitionerRole/${employeeUuid}`)).toBe(expected);
    expect(buildClinicalLedgerReferenceId(`${EXAMPLE_PROFESSIONAL_DID}:instance:${employeeUuid}`)).toBe(expected);
  });

  it('hashes document author, attesters, sender, submitter, signing key and subject into ledger-safe links', () => {
    const provenance = buildFhirLedgerProvenance({
      claims: {
        [CompositionClaim.Author]: EXAMPLE_PROVIDER_ORGANIZATION_DID,
        [CompositionClaim.Attester]: `${EXAMPLE_PROFESSIONAL_DID},${EXAMPLE_CONTROLLER_DID}`,
        [CompositionClaim.Custodian]: EXAMPLE_PROVIDER_ORGANIZATION_DID,
        [CompositionClaim.Subject]: EXAMPLE_CONTROLLER_DID,
      },
      sender: EXAMPLE_PROFESSIONAL_DID,
      submitter: EXAMPLE_CONTROLLER_DID,
      signingKeyId: EXAMPLE_CONTROLLER_SIGN_KEY.kid,
    });

    expect(provenance.relationships.author).toHaveLength(1);
    expect(provenance.relationships.attester).toHaveLength(2);
    expect(provenance.relationships.sender).toHaveLength(1);
    expect(provenance.relationships.submitter).toHaveLength(1);
    expect(provenance.relationships.signingKey).toHaveLength(1);
    expect(provenance.relationships.custodian).toEqual(provenance.relationships.author);
    expect(provenance.ownerships).toHaveLength(1);
    expect(JSON.stringify(provenance)).not.toContain('did:web:');
    expect(JSON.stringify(provenance)).not.toContain(EXAMPLE_CONTROLLER_SIGN_KEY.kid);
    expect(provenance).toEqual(buildFhirLedgerProvenance({
      claims: {
        [CompositionClaim.Subject]: EXAMPLE_CONTROLLER_DID,
        [CompositionClaim.Custodian]: EXAMPLE_PROVIDER_ORGANIZATION_DID,
        [CompositionClaim.Attester]: `${EXAMPLE_PROFESSIONAL_DID},${EXAMPLE_CONTROLLER_DID}`,
        [CompositionClaim.Author]: EXAMPLE_PROVIDER_ORGANIZATION_DID,
      },
      sender: EXAMPLE_PROFESSIONAL_DID,
      submitter: EXAMPLE_CONTROLLER_DID,
      signingKeyId: EXAMPLE_CONTROLLER_SIGN_KEY.kid,
    }));
  });

  it('builds deterministic CID while ignoring top-level id, meta, and narrative text', () => {
    const a = {
      resourceType: 'Patient',
      id: '68a78f38-7d7d-4f6e-b6ef-0d0066f8c241',
      meta: { versionId: 'old', lastUpdated: '2026-06-05T10:00:00Z' },
      text: { status: 'generated', div: '<div xmlns="http://www.w3.org/1999/xhtml">Alpha</div>' },
      name: [{ family: 'Lopez', given: ['Ana'] }],
    };
    const b = {
      name: [{ given: ['Ana'], family: 'Lopez' }],
      resourceType: 'Patient',
      id: 'patient-replayed-002',
      meta: { versionId: 'new', source: 'ips-replay' },
      text: { status: 'generated', div: '<div xmlns="http://www.w3.org/1999/xhtml">Beta</div>' },
    };

    const cidA = fhirResourceToCid(a);
    const cidB = fhirResourceToCid(b);
    expect(cidA.cid).toBe(cidB.cid);
    expect(cidA.cid.startsWith('z')).toBe(true);
  });

  it('assigns meta.versionId in resource and claims', () => {
    const entry: any = {
      fullUrl: 'urn:uuid:8e4db04c-3536-4b03-a33a-69bb1f3729e7',
      resource: {
        resourceType: ResourceTypesFhirR4.DocumentReference,
        meta: {
          tag: [{ id: 'DocumentReference[0].type', system: 'http://loinc.org', code: '34133-9', display: 'must stay private' }],
        },
      },
    };
    const claims: Record<string, any> = {
      '@context': 'org.hl7.fhir.r4',
    };

    const out = applyFhirCidVersioningToEntry({
      entry,
      claims,
      resourceType: ResourceTypesFhirR4.DocumentReference,
      resourceId: '8e4db04c-3536-4b03-a33a-69bb1f3729e7',
    });

    expect(entry.resource.id).toBe('8e4db04c-3536-4b03-a33a-69bb1f3729e7');
    expect(entry.resource.meta.versionId).toBeDefined();
    expect(claims['DocumentReference.meta.versionId']).toBe(entry.resource.meta.versionId);
    expect(claims['org.hl7.fhir.r4.DocumentReference.meta.versionId']).toBe(entry.resource.meta.versionId);
    expect(out.mapping).not.toHaveProperty('fullUrl');
    expect(out.mapping?.tags).toEqual([
      { id: 'DocumentReference[0].type', system: 'http://loinc.org', code: '34133-9' },
    ]);
  });

  it('registers mappings only when adapter supports it', async () => {
    const previousDataChannel = process.env.LEDGER_DATA_CHANNEL_DEFAULT;
    const previousVersionChaincode = process.env.FHIR_VERSION_LEDGER_CHAINCODE;
    const previousNetworkMode = process.env.NETWORK_MODE;
    process.env.LEDGER_DATA_CHANNEL_DEFAULT = 'must-not-control-manager-routing';
    process.env.FHIR_VERSION_LEDGER_CHAINCODE = 'must-not-control-manager-routing';
    process.env.NETWORK_MODE = 'test';
    const register = jest.fn(async () => ({ accepted: 1, txId: 'tx-1' }));
    try {
      await registerFhirCidMappings({
        blockchainAdapter: { registerCidVersionMappings: register },
        sector: 'health-care',
        jurisdiction: 'ES',
        mappings: [{ cid: 'zabc', versionId: 'zabc' }],
      });

      expect(register).toHaveBeenCalledTimes(1);
      const firstCall = (register.mock.calls as any[])[0];
      expect(firstCall[1]).toBe('health-care-eu');
      expect(firstCall[2]).toBe('artifact-sc');
    } finally {
      if (previousDataChannel === undefined) delete process.env.LEDGER_DATA_CHANNEL_DEFAULT;
      else process.env.LEDGER_DATA_CHANNEL_DEFAULT = previousDataChannel;
      if (previousVersionChaincode === undefined) delete process.env.FHIR_VERSION_LEDGER_CHAINCODE;
      else process.env.FHIR_VERSION_LEDGER_CHAINCODE = previousVersionChaincode;
      if (previousNetworkMode === undefined) delete process.env.NETWORK_MODE;
      else process.env.NETWORK_MODE = previousNetworkMode;
    }
  });

  it('canonicalizes recursively', () => {
    const canonical = canonicalizeFhirResource({
      id: 'ignored',
      meta: { versionId: 'ignored', source: 'ignored' },
      text: { div: '<div>ignored</div>' },
      b: { z: 1, a: 2 },
      a: [{ d: 1, c: 2 }],
    });
    expect(canonical).toBe('{"a":[{"c":2,"d":1}],"b":{"a":2,"z":1}}');
  });
});
