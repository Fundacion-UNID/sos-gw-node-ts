import {
  assertFabricChannelAllowed,
  assertFabricTargetAllowed,
  assertLedgerGenesisVerificationMode,
  fabricChannelPolicyFromBindings,
} from '../../../blockchain/fabric/v3/fabric-target-policy';
import { ManageAsset } from '../../../blockchain/fabric/v3/manageAsset';

describe('scoped Fabric channel policy', () => {
  const policy = fabricChannelPolicyFromBindings([
    { channel: 'identity', genesisSha256: 'a'.repeat(64) },
    { channel: 'health-care-eu', genesisSha256: 'b'.repeat(64) },
  ]);

  test('derives the exact channel ceiling from verified genesis bindings', () => {
    expect([...policy]).toEqual(['identity', 'health-care-eu']);
  });

  test('fails closed outside bound channels but does not restrict chaincodes per host', () => {
    expect(() => assertFabricChannelAllowed('animal-pet-eu', policy)).toThrow(/not allowed/);
    expect(() => assertFabricTargetAllowed('identity', 'artifact-sc', policy)).not.toThrow();
    expect(() => assertFabricTargetAllowed('identity', 'credential-sc', policy)).not.toThrow();
  });

  test('the shared contract boundary rejects an unbound request channel before connecting', async () => {
    const previous = {
      storageLayout: process.env.STORAGE_LAYOUT,
      deploymentEnv: process.env.DEPLOYMENT_ENV,
      networkMode: process.env.NETWORK_MODE,
      hostStorageScope: process.env.HOST_STORAGE_SCOPE,
      genesisVerification: process.env.LEDGER_GENESIS_VERIFICATION,
      bindings: process.env.LEDGER_CHANNEL_GENESIS_SHA256,
    };
    process.env.STORAGE_LAYOUT = 'scoped-v2';
    process.env.DEPLOYMENT_ENV = 'staging';
    process.env.NETWORK_MODE = 'test-network';
    process.env.HOST_STORAGE_SCOPE = 'host-a';
    process.env.LEDGER_GENESIS_VERIFICATION = 'true';
    process.env.LEDGER_CHANNEL_GENESIS_SHA256 = `identity=${'a'.repeat(64)}`;
    try {
      const manager = new ManageAsset('credential', {
        channelName: 'production-identity',
        chaincodeName: 'credential-sc',
      });
      await expect(manager.read('HOSTMSP', 'credential-1')).rejects.toThrow(/channel is not allowed/);
    } finally {
      for (const [key, value] of Object.entries({
        STORAGE_LAYOUT: previous.storageLayout,
        DEPLOYMENT_ENV: previous.deploymentEnv,
        NETWORK_MODE: previous.networkMode,
        HOST_STORAGE_SCOPE: previous.hostStorageScope,
        LEDGER_GENESIS_VERIFICATION: previous.genesisVerification,
        LEDGER_CHANNEL_GENESIS_SHA256: previous.bindings,
      })) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  test('staging test-network scoped-v2 needs neither genesis hashes nor a chaincode allowlist', () => {
    const previous = {
      storageLayout: process.env.STORAGE_LAYOUT,
      deploymentEnv: process.env.DEPLOYMENT_ENV,
      networkMode: process.env.NETWORK_MODE,
      hostStorageScope: process.env.HOST_STORAGE_SCOPE,
      genesisVerification: process.env.LEDGER_GENESIS_VERIFICATION,
      bindings: process.env.LEDGER_CHANNEL_GENESIS_SHA256,
    };
    process.env.STORAGE_LAYOUT = 'scoped-v2';
    process.env.DEPLOYMENT_ENV = 'staging';
    process.env.NETWORK_MODE = 'test-network';
    process.env.HOST_STORAGE_SCOPE = 'host-a';
    process.env.LEDGER_GENESIS_VERIFICATION = 'false';
    delete process.env.LEDGER_CHANNEL_GENESIS_SHA256;
    try {
      expect(() => assertFabricTargetAllowed('animal-pet-eu', 'any-approved-chaincode')).not.toThrow();
    } finally {
      for (const [key, value] of Object.entries({
        STORAGE_LAYOUT: previous.storageLayout,
        DEPLOYMENT_ENV: previous.deploymentEnv,
        NETWORK_MODE: previous.networkMode,
        HOST_STORAGE_SCOPE: previous.hostStorageScope,
        LEDGER_GENESIS_VERIFICATION: previous.genesisVerification,
        LEDGER_CHANNEL_GENESIS_SHA256: previous.bindings,
      })) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  test('requires genesis verification only at the production ledger boundary', () => {
    expect(() => assertLedgerGenesisVerificationMode({
      deploymentEnv: 'staging', networkMode: 'test-network', enabled: false,
    })).not.toThrow();
    expect(() => assertLedgerGenesisVerificationMode({
      deploymentEnv: 'prod', networkMode: 'network', enabled: false,
    })).toThrow(/requires LEDGER_GENESIS_VERIFICATION=true/);
  });
});
