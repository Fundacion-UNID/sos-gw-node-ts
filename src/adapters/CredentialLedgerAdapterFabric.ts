// src/adapters/CredentialLedgerAdapterFabric.ts
// Copyright 2025 Antifraud Services Inc. under the Apache License, Version 2.0.

import { CredentialHistoryEvent, CredentialLedgerContext, CredentialStatusRecord, ICredentialLedgerAdapter } from './ICredentialLedgerAdapter';
import { ManageAsset } from '../blockchain/fabric/v3/manageAsset';
import { ManageAssetCredential } from '../blockchain/fabric/v3/manageAssetCredential';
import { ManageAssetCryptographicKey } from '../blockchain/fabric/v3/manageAssetCryptographicKey';

type FabricLedgerConfig = {
  mspId: string;
  itemType: string;
};

const DEFAULT_FABRIC_CONFIG: FabricLedgerConfig = {
  mspId: 'Org1MSP',
  itemType: 'credential',
};

function loadFabricConfig(): FabricLedgerConfig {
  const itemType = process.env.LEDGER_FABRIC_ITEM_TYPE || DEFAULT_FABRIC_CONFIG.itemType;

  return {
    mspId: process.env.LEDGER_FABRIC_MSP_ID || DEFAULT_FABRIC_CONFIG.mspId,
    itemType,
  };
}

export class CredentialLedgerAdapterFabric implements ICredentialLedgerAdapter {
  public async getCredentialStatus(
    id: string,
    network: string,
    context?: CredentialLedgerContext
  ): Promise<CredentialStatusRecord | undefined> {
    const config = loadFabricConfig();
    const manager = this.getManager(config, context);
    return (await manager.read(config.mspId, id)) as CredentialStatusRecord;
  }

  public async getCredentialHistory(
    id: string,
    network: string,
    context?: CredentialLedgerContext
  ): Promise<CredentialHistoryEvent[]> {
    const config = loadFabricConfig();
    const manager = this.getManager(config, context);
    return (await manager.history(config.mspId, id)) as CredentialHistoryEvent[];
  }

  private getManager(config: FabricLedgerConfig, context?: CredentialLedgerContext): ManageAsset {
    const options = { chaincodeName: `${config.itemType.toLowerCase()}-sc`, channelName: context?.channelName };
    if (config.itemType.toLowerCase() === 'credential') {
      return new ManageAssetCredential(options);
    }
    if (config.itemType.toLowerCase() === 'cryptographickey') {
      return new ManageAssetCryptographicKey(options);
    }
    return new ManageAsset(config.itemType, options);
  }
}
