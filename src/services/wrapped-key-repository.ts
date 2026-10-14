import type { RecordBase } from 'gdc-common-utils-ts/models/resource-document';
import type { IVaultRepository } from '../database/repositories/vault/vault.repository';
import { getEnvSectionId } from '../utils/section-env';

export type WrappedKeyPurpose = 'hmac' | 'storage' | 'comm_sig' | 'vc_sign' | 'encryption';

export type WrappedKeyRecord = {
  entityVaultId: string;
  purpose: WrappedKeyPurpose;
  keyVersion: string;
  wrappedKeyMaterial: string;
  updatedAt: string;
  kid?: string;
};

export interface WrappedKeyRepository {
  put(record: WrappedKeyRecord): Promise<void>;
  get(entityVaultId: string, purpose: WrappedKeyPurpose, keyVersion?: string): Promise<WrappedKeyRecord | undefined>;
  findByKid(kid: string, purpose?: WrappedKeyPurpose): Promise<WrappedKeyRecord | undefined>;
}

export class InMemoryWrappedKeyRepository implements WrappedKeyRepository {
  private readonly records = new Map<string, WrappedKeyRecord>();

  async put(record: WrappedKeyRecord): Promise<void> {
    this.records.set(this.buildKey(record.entityVaultId, record.purpose, record.keyVersion), record);
  }

  async get(entityVaultId: string, purpose: WrappedKeyPurpose, keyVersion?: string): Promise<WrappedKeyRecord | undefined> {
    if (keyVersion) {
      return this.records.get(this.buildKey(entityVaultId, purpose, keyVersion));
    }

    const prefix = `${entityVaultId}::${purpose}::`;
    const matches = Array.from(this.records.entries())
      .filter(([key]) => key.startsWith(prefix))
      .sort(([left], [right]) => left.localeCompare(right));
    return matches.at(-1)?.[1];
  }

  async findByKid(kid: string, purpose?: WrappedKeyPurpose): Promise<WrappedKeyRecord | undefined> {
    const normalizedKid = String(kid || '').trim();
    if (!normalizedKid) return undefined;
    const matches = Array.from(this.records.values())
      .filter((record) => record.kid === normalizedKid && (!purpose || record.purpose === purpose))
      .sort((left, right) => left.keyVersion.localeCompare(right.keyVersion));
    return matches.at(-1);
  }

  private buildKey(entityVaultId: string, purpose: WrappedKeyPurpose, keyVersion: string): string {
    return `${entityVaultId}::${purpose}::${keyVersion}`;
  }
}

type WrappedKeyDocument = RecordBase & WrappedKeyRecord & {
  status?: string;
  sequence?: number;
};

export class VaultWrappedKeyRepository implements WrappedKeyRepository {
  private readonly sectionId: string;

  constructor(
    private readonly vaultRepository: IVaultRepository,
    private readonly hostCollectionName: string,
  ) {
    this.sectionId = getEnvSectionId('wrapped_keys');
  }

  async put(record: WrappedKeyRecord): Promise<void> {
    const persisted: WrappedKeyDocument = {
      id: this.buildKey(record.entityVaultId, record.purpose, record.keyVersion),
      status: 'active',
      sequence: 0,
      ...record,
    };
    await this.vaultRepository.put(this.hostCollectionName, [persisted], this.sectionId);
  }

  async get(entityVaultId: string, purpose: WrappedKeyPurpose, keyVersion?: string): Promise<WrappedKeyRecord | undefined> {
    if (keyVersion) {
      const found = await this.vaultRepository.get<WrappedKeyDocument>(
        this.hostCollectionName,
        this.buildKey(entityVaultId, purpose, keyVersion),
        this.sectionId,
      );
      return found ? this.toRecord(found) : undefined;
    }

    const records = await this.vaultRepository.listContainersInSection<WrappedKeyDocument>(this.hostCollectionName, this.sectionId);
    const matches = records
      .filter((record) => record.entityVaultId === entityVaultId && record.purpose === purpose)
      .sort((left, right) => this.compareVersions(left.keyVersion, right.keyVersion));
    return matches.at(-1) ? this.toRecord(matches.at(-1)!) : undefined;
  }

  async findByKid(kid: string, purpose?: WrappedKeyPurpose): Promise<WrappedKeyRecord | undefined> {
    const normalizedKid = String(kid || '').trim();
    if (!normalizedKid) return undefined;
    const records = await this.vaultRepository.listContainersInSection<WrappedKeyDocument>(this.hostCollectionName, this.sectionId);
    const matches = records
      .filter((record) => record.kid === normalizedKid && (!purpose || record.purpose === purpose))
      .sort((left, right) => this.compareVersions(left.keyVersion, right.keyVersion));
    return matches.at(-1) ? this.toRecord(matches.at(-1)!) : undefined;
  }

  private toRecord(document: WrappedKeyDocument): WrappedKeyRecord {
    return {
      entityVaultId: document.entityVaultId,
      purpose: document.purpose,
      keyVersion: document.keyVersion,
      wrappedKeyMaterial: document.wrappedKeyMaterial,
      updatedAt: document.updatedAt,
      kid: document.kid,
    };
  }

  private buildKey(entityVaultId: string, purpose: WrappedKeyPurpose, keyVersion: string): string {
    return `${entityVaultId}::${purpose}::${keyVersion}`;
  }

  private compareVersions(left: string, right: string): number {
    const leftNumeric = Number(left);
    const rightNumeric = Number(right);
    if (Number.isFinite(leftNumeric) && Number.isFinite(rightNumeric)) {
      return leftNumeric - rightNumeric;
    }
    return left.localeCompare(right);
  }
}
