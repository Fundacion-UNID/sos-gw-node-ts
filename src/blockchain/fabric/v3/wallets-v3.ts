/* eslint-disable @typescript-eslint/no-explicit-any */
import { Identity } from '@hyperledger/fabric-gateway';
import * as config from './fabric-config';
import { WalletsInMemory } from './walletsInMemory-v3';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let walletsInMemory: WalletsInMemory<any>;

/**
 * Creates an in-memory wallet to hold credentials for Org1 and Org2 users
 * and initializes the walletsInMemory instance.
 *
 * In this sample, there is a single user for each MSP ID to demonstrate how
 * a client app might submit transactions for different users.
 */
export const createWalletInMemory = async (): Promise<any> => {
  // Initialize walletsInMemory if it hasn't been initialized yet
  if (!walletsInMemory) {
    walletsInMemory = new WalletsInMemory();
  }

  // Create Org1 identity
  const org1Identity = {
    credentials: {
      certificate: config.certificateOrg1,
      privateKey: config.privateKeyOrg1,
    },
    mspId: config.mspIdOrg1,
    type: 'X.509',
  };
  console.log(
    `---> createWalletInMemory: org1Identity=${JSON.stringify(org1Identity)}`
  );
  await walletsInMemory.put(config.mspIdOrg1, org1Identity);

  // Create Org2 identity
  const org2Identity = {
    credentials: {
      certificate: config.certificateOrg2,
      privateKey: config.privateKeyOrg2,
    },
    mspId: config.mspIdOrg2,
    type: 'X.509',
  };
  console.log(
    `---> createWalletInMemory: org2Identity=${JSON.stringify(org2Identity)}`
  );
  await walletsInMemory.put(config.mspIdOrg2, org2Identity);
};

/**
 * Sets in the memory wallet the credentials for a Fabric client entity (API Service Client).
 */
export const setFabricIdentityInMemoryWallet = async (
  mspId: string,
  publicCert: string,
  privateCert: string
): Promise<void> => {
  // Ensure walletsInMemory is initialized before use
  if (!walletsInMemory) {
    walletsInMemory = new WalletsInMemory();
  }

  const newWalletIdentity = {
    credentials: {
      certificate: publicCert,
      privateKey: privateCert,
    },
    mspId: mspId,
    type: 'X.509',
  };

  // Log and add the new identity to the wallet
  console.log(
    `---> setFabricIdentityInMemoryWallet: adding wallet for mspId ${mspId}`
  );
  await walletsInMemory.put(mspId, newWalletIdentity);
};

/**
 * Gets an identity from the memory wallet for a Fabric client entity (API Service Client).
 */
export async function getFabricIdentityFromMemoryWallet(
  mspId: string
): Promise<Identity> {
  // Ensure walletsInMemory is initialized before use
  if (!walletsInMemory) {
    walletsInMemory = new WalletsInMemory();
  }

  console.log(`---> getFabricIdentityFromMemoryWallet: mspId=${mspId}`);
  const result = await walletsInMemory.get(mspId);

  if (!result) {
    console.log(`!!! empty identity for mspId ${mspId}`);
  }
  return result;
}
