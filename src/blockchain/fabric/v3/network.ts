import { Gateway, Network } from '@hyperledger/fabric-gateway';
import { newGatewayConnection, newGrpcConnection } from './connect';
import * as config from './fabric-config';
import { assertFabricChannelAllowed } from './fabric-target-policy';

export async function createGateway(mspId: string): Promise<Gateway> {
  const client = await newGrpcConnection(mspId);
  let gateway;
  try {
    gateway = await newGatewayConnection(client, mspId);
  } catch (e) {
    console.log(`error getting gateway for MSP ${mspId}: ${e}`);
    throw new Error(`error getting gateway for MSP ${mspId}: ${e}`);
  }
  return gateway;
}

export const getNetwork = async (gateway: Gateway): Promise<Network> => {
  assertFabricChannelAllowed(config.channelName);
  const network = await gateway.getNetwork(config.channelName);
  return network;
};

export async function getNetworkByMspId(mspId: string): Promise<Network> {
  console.log(`---> getNetworkByMspId; mspId=${mspId}`);
  const gateway: Gateway = await createGateway(mspId);
  const network = await getNetwork(gateway);
  return network;
}
