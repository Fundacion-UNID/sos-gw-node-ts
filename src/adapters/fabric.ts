
const MOCK_DELAY_MS = 6000; // 6 segundos

function delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

class ChainCodeProcessor {
    static async process(data: any): Promise<void> {
      // console.log(`Invoking smart contract with data: ${JSON.stringify(data)}`);
      // Use the Hyperledger Fabric SDK here
      await delay(MOCK_DELAY_MS);
    }
  }
  