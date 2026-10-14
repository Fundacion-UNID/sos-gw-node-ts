/* eslint-disable prettier/prettier */
/*
 * SPDX-License-Identifier: Apache-2.0
 */

/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  Contract,
  Proposal,
  SubmittedTransaction,
  Transaction,
} from '@hyperledger/fabric-gateway';
// import { CallOptions } from '@grpc/grpc-js';
import { common, ledger, msp, peer } from '@hyperledger/fabric-protos';
import Long from 'long';
import * as config from './fabric-config';
// Using console for logging to remove dependency
const logger = console;
// import { handleError } from '../../../app/errors-v3';
// import { getContractByMspIdAndContractName } from './contract';

/**
 * Evaluate a transaction and handle any errors
 */
export const evaluateTransaction = async (
  contract: Contract,
  transactionName: string,
  ...transactionArgs: string[] // assetId is the first argument
): Promise<Proposal> => {
  console.log(`---> evaluateTransaction`);
  const transactionProposal: Proposal = contract.newProposal(
    transactionName,
    {arguments: transactionArgs}
  );
  const transactionId = transactionProposal.getTransactionId();
  logger.trace({ transactionProposal }, 'Evaluating transaction');
  console.log(`---> transactionId = ${transactionId}, args=${transactionArgs}`);

  try {
    const payloadBytes: Uint8Array = await transactionProposal.evaluate();
    logger.trace(
      { transactionId: transactionId, payload: payloadBytes.toString() },
      'Evaluate transaction response received'
    );
    return transactionProposal;
  } catch (err) {
    // throw handleError(transactionId, err);
    throw new Error('throw handleError(transactionId, err)')
  }
};

/**
 * Endorse and submit a proposed transaction, and handle any errors
 */
export const submitTransaction = async (
  transactionProposal: Proposal, // transaction id and arguments
): Promise<Uint8Array> => {
  const txnId = transactionProposal.getTransactionId();
  logger.trace({ transactionProposal }, 'Submitting transaction');

  try {
    const transaction: Transaction = await transactionProposal.endorse();
    logger.trace(
      { transactionId: txnId, payload: transaction.getResult().toString() },
      'Endorse transaction response received'
    );

    const submitted: SubmittedTransaction = await transaction.submit();
    const resultBytes: Uint8Array = submitted.getResult();
    logger.trace(
      { transactionId: txnId, payload: resultBytes.toString() },
      'Submit transaction response received'
    );
    return resultBytes;
  } catch (err) {
    // throw handleError(txnId, err);
    throw new Error('handleError(txnId, err)');
  }
};

/**
 * Get the validation code of the specified transaction
 */
export const getTransactionValidationCode = async (
  qsccContract: Contract,
  transactionId: string
): Promise<string> => {
  const transactionProposal: Proposal = await evaluateTransaction(
    qsccContract,
    'GetTransactionByID',
    config.channelName,
    transactionId
  );

  const processedTransaction = peer.ProcessedTransaction.deserializeBinary(transactionProposal.getBytes());
  const validationCode = processedTransaction.getValidationcode();
  logger.debug({ transactionId }, 'Validation code: %s', validationCode);
  return validationCode.toString();  
  
};

/**
 * Get the current block height
 *
 * This example of using a system contract is used for the liveness REST
 * endpoint
 */
export const getBlockHeight = async (
  qscc: Contract
): Promise<number | Long> => {
  const resultBytes = await qscc.evaluateTransaction(
    'GetChainInfo',
    config.channelName
  );
  const info = common.BlockchainInfo.deserializeBinary(resultBytes);
  const blockHeight = info.getHeight();

  logger.debug('Current block height: %d', blockHeight);
  return blockHeight;
};
