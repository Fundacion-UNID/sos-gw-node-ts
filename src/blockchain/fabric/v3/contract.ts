import { Contract, Network } from '@hyperledger/fabric-gateway';
import { getNetworkByMspId } from './network';

const contractNameSuffix = '-sc'; // i.e. 'employee-sc'

/**
 * Get the asset transfer sample contract and the qscc system contract
 *
 * The system contract is used for the liveness REST endpoint
 */
export const getContractAndQSCC = async (
  network: Network,
  chaincodeName: string
): Promise<{ assetContract: Contract; qsccContract: Contract }> => {
  console.log(`---> getContracts: chaincode name "${chaincodeName}"`);
  const assetContract = network.getContract(chaincodeName);
  // Query system chaincode (QSCC) runs in all peers to provide ledger APIs which include block query, transaction query etc.
  const qsccContract = network.getContract('qscc');
  return { assetContract, qsccContract };
};

/**
 * Get the asset transfer contract by item type
 * by adding '-sc' to the item type in lower case.
 */
export async function getContractByItemType(
  network: Network,
  itemType: string
): Promise<Contract> {
  const contractName = itemType.toLowerCase() + contractNameSuffix; // i.e. 'employee-sc'
  const assetContract = network.getContract(contractName);
  return assetContract;
}

/**
 * Get the contract for a type of asset in the network for a Fabric client entity (API Service Client).
 */
export async function getContractByMspIdAndItemType(
  mspId: string,
  itemType: string
): Promise<Contract> {
  console.log(
    `---> getContractByMspIdAndItemType: mspId=${mspId}; itemType=${itemType}`
  );
  const contractName = itemType.toLowerCase() + contractNameSuffix; // i.e. 'employee-sc'
  return await getContractByMspIdAndContractName(mspId, contractName);
}

/**
 * Get the contract for a type of asset in the network for a Fabric client entity (API Service Client).
 */
export async function getContractByMspIdAndContractName(
  mspId: string,
  contractName: string
): Promise<Contract> {
  console.log(
    `---> getContractByMspIdAndContractName: mspId=${mspId}; contractName=${contractName}`
  );
  const network = await getNetworkByMspId(mspId); // CAUTION: apiKey = mspId
  const contract = network.getContract(contractName);
  return contract;
}
