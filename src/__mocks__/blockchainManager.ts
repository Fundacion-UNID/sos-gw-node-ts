// src/__mocks__/blockchainManager.ts

/**
 * This is a mock of the blockchain manager (e.g., ManageEmployeeSchemaorgV3).
 * It simulates the interface of the real manager but doesn't perform any
 * actual blockchain operations. It's used for testing the business logic
 * in isolation.
 */
export class MockBlockchainManager {
  private itemType: string;

  constructor(itemType: string) {
    this.itemType = itemType;
    // console.log(`[MockBlockchainManager] Initialized for item type: ${this.itemType}`);
  }

  /**
   * Simulates creating an item on the blockchain.
   * In this mock, it just returns the object it was given, simulating a successful creation.
   * @param mspId The MSP ID of the organization.
   * @param performerRoleURI The role of the person performing the action.
   * @param assetUUID The UUID of the asset.
   * @param resourceObj The object to be "stored".
   * @returns A promise that resolves to the "stored" object.
   */
  async create(
    mspId: string,
    performerRoleURI: string,
    assetUUID: string,
    resourceObj: any,
  ): Promise<any> {
    // console.log(`[MockBlockchainManager] Simulating creation of ${this.itemType} with ID: ${assetUUID}`);
    // In a real scenario, this would interact with a blockchain.
    // Here, we just return the object, perhaps wrapped in a "data" property
    // to mimic the primary document structure you showed.
    const primaryDocument = {
      data: [{ ...resourceObj, id: assetUUID }],
    };
    return Promise.resolve(primaryDocument);
  }

  // Add other mocked methods as needed (e.g., update, read, etc.)
  async read(mspId: string, assetId: string): Promise<any> {
    // console.log(`[MockBlockchainManager] Simulating read of ${this.itemType} with ID: ${assetId}`);
    // This would fetch from the blockchain. We'll return a dummy object.
    return Promise.resolve({ data: [{ id: assetId, mocked: true }] });
  }
}
