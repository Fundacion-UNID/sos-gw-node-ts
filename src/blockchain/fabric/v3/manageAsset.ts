// src/blockchain/fabric/v3/manageAsset.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import type { Contract, Gateway } from '@hyperledger/fabric-gateway';
import type * as grpc from '@grpc/grpc-js';
import { newGatewayConnection, newGrpcConnection } from './connect';
import { resolveIdentityChannel } from '../../../utils/ledger';
import { assertFabricTargetAllowed } from './fabric-target-policy';

type ContractSession = {
  contract: Contract;
  gateway: Gateway;
  client: grpc.Client;
};

const capitalize = (value: string) => (value ? value.charAt(0).toUpperCase() + value.slice(1) : value);

export class ManageAsset {
  protected itemType: string;
  protected chaincodeName?: string;
  protected channel?: string;

  constructor(itemType: string, options?: { chaincodeName?: string; channelName?: string }) {
    this.itemType = itemType;
    this.chaincodeName = options?.chaincodeName;
    this.channel = options?.channelName;
  }

  protected getContractName(): string {
    return this.chaincodeName || `${this.itemType.toLowerCase()}-sc`;
  }

  protected getReadFunction(): string {
    return `read${capitalize(this.itemType)}`;
  }

  protected getHistoryFunction(): string {
    return `get${capitalize(this.itemType)}History`;
  }

  protected async withContract(mspId: string, handler: (session: ContractSession) => Promise<Uint8Array>): Promise<Uint8Array> {
    const channelName = this.channel || resolveIdentityChannel(process.env.HOST_JURISDICTION || process.env.JURISDICTION);
    const chaincodeName = this.getContractName();
    assertFabricTargetAllowed(channelName, chaincodeName);
    const client = await newGrpcConnection(mspId);
    const gateway = await newGatewayConnection(client, mspId);
    try {
      const network = await gateway.getNetwork(channelName);
      const contract = network.getContract(chaincodeName);
      return await handler({ contract, gateway, client });
    } finally {
      gateway.close();
      client.close();
    }
  }

  protected parseJson<T>(payload: Uint8Array): T {
    const text = Buffer.from(payload).toString('utf8');
    return JSON.parse(text) as T;
  }

  /**
   * Submits one explicit transaction function to the target chaincode.
   *
   * Higher-level wrappers such as `registerKey(...)` or `upsertArtifact(...)`
   * are only semantic aliases over this method. They do not add extra Fabric
   * behavior; they simply fix the chaincode function name and serialize the
   * payload JSON for the caller.
   *
   * Use a domain-specific wrapper when one exists so the intent stays obvious
   * in manager code. Fall back to `submit(...)` only for uncommon or
   * temporary chaincode operations that do not yet have a dedicated helper.
   */
  public async submit(mspId: string, fnName: string, ...args: string[]): Promise<object> {
    const result = await this.withContract(mspId, async ({ contract }) => {
      const proposal = contract.newProposal(fnName, {
        arguments: args,
        endorsingOrganizations: [mspId],
      });
      const transaction = await proposal.endorse();
      const submitted = await transaction.submit();
      const status = await submitted.getStatus();
      if (!status.successful) {
        throw new Error(
          `Fabric transaction ${status.transactionId} was not committed successfully `
          + `(validation code ${status.code})`,
        );
      }
      return transaction.getResult();
    });
    return this.parseJson<object>(result);
  }

  /** Submits one transaction and returns both its decoded result and Fabric id. */
  protected async submitWithTransactionId(
    mspId: string,
    fnName: string,
    ...args: string[]
  ): Promise<{ result: object; transactionId: string }> {
    let transactionId = '';
    const result = await this.withContract(mspId, async ({ contract }) => {
      const proposal = contract.newProposal(fnName, {
        arguments: args,
        endorsingOrganizations: [mspId],
      });
      const transaction = await proposal.endorse();
      transactionId = transaction.getTransactionId();
      const submitted = await transaction.submit();
      const status = await submitted.getStatus();
      if (!status.successful) {
        throw new Error(
          `Fabric transaction ${status.transactionId} was not committed successfully `
          + `(validation code ${status.code})`,
        );
      }
      return transaction.getResult();
    });
    return { result: this.parseJson<object>(result), transactionId };
  }

  /**
   * Evaluates the default read function for the asset family.
   *
   * By convention this resolves to `read${ItemType}` unless a subclass
   * overrides the mapping for legacy or irregular chaincode names.
   */
  public async read(mspId: string, assetId: string): Promise<object> {
    const result = await this.withContract(mspId, async ({ contract }) => {
      return contract.evaluateTransaction(this.getReadFunction(), assetId);
    });
    return this.parseJson<object>(result);
  }

  /**
   * Evaluates the default history function for the asset family.
   *
   * By convention this resolves to `get${ItemType}History` unless a subclass
   * overrides the mapping for legacy or irregular chaincode names.
   */
  public async history(mspId: string, assetId: string): Promise<object[]> {
    const result = await this.withContract(mspId, async ({ contract }) => {
      return contract.evaluateTransaction(this.getHistoryFunction(), assetId);
    });
    return this.parseJson<object[]>(result);
  }
}
