import { createHash } from 'crypto';
import { newGatewayConnection, newGrpcConnection } from './connect';

/**
 * Reads block zero through the configured Fabric Gateway peer and returns its
 * canonical serialized SHA-256 fingerprint. Channel names are not sufficient
 * to distinguish independent test and production ledgers.
 */
export async function fetchChannelGenesisSha256(mspId: string, channelName: string): Promise<string> {
  const client = await newGrpcConnection(mspId);
  const gateway = await newGatewayConnection(client, mspId);
  try {
    const blocks = await gateway.getNetwork(channelName).getBlockEvents({ startBlock: BigInt(0) });
    try {
      const first = await blocks[Symbol.asyncIterator]().next();
      if (first.done || !first.value) {
        throw new Error(`Fabric channel ${channelName} returned no genesis block.`);
      }
      return createHash('sha256').update(first.value.serializeBinary()).digest('hex');
    } finally {
      blocks.close();
    }
  } finally {
    gateway.close();
    client.close();
  }
}
