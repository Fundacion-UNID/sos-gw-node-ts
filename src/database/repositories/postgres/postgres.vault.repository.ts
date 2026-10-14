import { Pool, PoolClient } from 'pg';
import { RecordBase, VaultConfig } from 'gdc-common-utils-ts/models/resource-document';
import { IVaultRepository, type VaultQueryOptions } from '../vault/vault.repository';
import { getEnvSectionId } from '../../../utils/section-env';
import { resolvePostgresSchema } from './postgres.schema';
import type { IConfidentialBlobStore } from '../../storage/IConfidentialBlobStore';
import {
  externalizeConfidentialStorageDocForPersistence,
  hydrateConfidentialStorageDocFromPersistence,
} from '../vault/confidential-storage-persistence';

const DEFAULT_SECTION = 'default';

type VaultQueryCondition = {
  name?: string;
  value?: string;
  attribute?: string;
  equals?: string;
};

type LegacyVaultQuery = {
  section?: string;
  sectionId?: string;
  equals?: {
    'indexed.attributes'?: {
      name?: string;
      value?: string;
    };
  };
  where?: VaultQueryCondition[];
};

type IndexedAttribute = {
  name: string;
  value: string;
  unique?: boolean;
};

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function toQualifiedTable(schema: string, table: string): string {
  return `${quoteIdentifier(schema)}.${quoteIdentifier(table)}`;
}

function extractIndexedAttributes(document: unknown): IndexedAttribute[] {
  const doc = document as { indexed?: unknown };
  const indexed = doc?.indexed;
  if (!indexed) {
    return [];
  }

  const groups = Array.isArray(indexed) ? indexed : [indexed];
  return groups.flatMap((group) => {
    const attributes = (group as { attributes?: unknown })?.attributes;
    if (!Array.isArray(attributes)) {
      return [];
    }
    return attributes
      .filter((attribute): attribute is IndexedAttribute => {
        const typed = attribute as IndexedAttribute;
        return typeof typed?.name === 'string' && typeof typed?.value === 'string';
      })
      .map((attribute) => ({
        name: attribute.name,
        value: attribute.value,
        unique: Boolean(attribute.unique),
      }));
  });
}

function normalizeQuery(query: LegacyVaultQuery): { sectionId: string; conditions: Array<{ name: string; value: string }> } {
  const sectionId = query.sectionId || query.section || DEFAULT_SECTION;

  if (Array.isArray(query.where) && query.where.length > 0) {
    const conditions = query.where.map((condition) => ({
      name: condition.name ?? condition.attribute,
      value: condition.value ?? condition.equals,
    })).filter((condition): condition is { name: string; value: string } => Boolean(condition.name && condition.value));

    return { sectionId, conditions };
  }

  const legacyCondition = query.equals?.['indexed.attributes'];
  if (legacyCondition?.name && legacyCondition?.value) {
    return {
      sectionId,
      conditions: [{ name: legacyCondition.name, value: legacyCondition.value }],
    };
  }

  throw new Error(`Query type not supported by PostgresVaultRepository: ${JSON.stringify(query)}`);
}

export class PostgresVaultRepository extends IVaultRepository {
  private readonly schema: string;
  private readonly tables: {
    vaults: string;
    sections: string;
    documents: string;
    indexes: string;
  };
  private readonly blobStore?: IConfidentialBlobStore;

  constructor(
    private readonly pool: Pool,
    private readonly hostCollectionName: string,
    schema?: string,
    blobStore?: IConfidentialBlobStore,
  ) {
    super();
    this.schema = resolvePostgresSchema(schema);
    this.blobStore = blobStore;
    this.tables = {
      vaults: toQualifiedTable(this.schema, 'vaults'),
      sections: toQualifiedTable(this.schema, 'vault_sections'),
      documents: toQualifiedTable(this.schema, 'vault_documents'),
      indexes: toQualifiedTable(this.schema, 'vault_document_indexes'),
    };
  }

  async createNewVault(vaultConfig: VaultConfig): Promise<boolean> {
    const result = await this.pool.query(
      `
        INSERT INTO ${this.tables.vaults} (collection_name, config_json, updated_at)
        VALUES ($1, $2::jsonb, now())
        ON CONFLICT (collection_name) DO NOTHING
      `,
      [vaultConfig.id, JSON.stringify(vaultConfig)],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async vaultExists(vaultId: string): Promise<boolean> {
    if (vaultId === 'host') {
      const result = await this.pool.query(
        `SELECT 1 FROM ${this.tables.vaults} WHERE collection_name = $1 LIMIT 1`,
        [this.hostCollectionName],
      );
      return (result.rowCount ?? 0) > 0;
    }

    const result = await this.pool.query(
      `
        SELECT 1
        FROM ${this.tables.documents}
        WHERE collection_name = $1
          AND section_id = $2
          AND document_id = $3
          AND deleted_at IS NULL
        LIMIT 1
      `,
      [this.hostCollectionName, getEnvSectionId('tenants'), vaultId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async getVaultConfig(vaultId: string): Promise<VaultConfig | undefined> {
    const result = await this.pool.query<{ config_json: VaultConfig | null }>(
      `SELECT config_json FROM ${this.tables.vaults} WHERE collection_name = $1`,
      [vaultId],
    );
    return result.rows[0]?.config_json ?? undefined;
  }

  async createNewSection(collectionName: string, sectionId: string): Promise<boolean> {
    await this.ensureVaultExists(collectionName);
    const result = await this.pool.query(
      `
        INSERT INTO ${this.tables.sections} (collection_name, section_id, updated_at)
        VALUES ($1, $2, now())
        ON CONFLICT (collection_name, section_id) DO NOTHING
      `,
      [collectionName, sectionId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async updateSection(collectionName: string, sectionId: string, containers: RecordBase[] = []): Promise<boolean> {
    await this.ensureVaultExists(collectionName);
    await this.createNewSection(collectionName, sectionId);

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `DELETE FROM ${this.tables.documents} WHERE collection_name = $1 AND section_id = $2`,
        [collectionName, sectionId],
      );
      if (containers.length > 0) {
        await this.upsertDocuments(client, collectionName, sectionId, containers);
      }
      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getAllSections(collectionName: string): Promise<string[]> {
    const result = await this.pool.query<{ section_id: string }>(
      `SELECT section_id FROM ${this.tables.sections} WHERE collection_name = $1 ORDER BY section_id`,
      [collectionName],
    );
    return result.rows.map((row) => row.section_id);
  }

  async sectionExists(collectionName: string, sectionId: string): Promise<boolean> {
    const result = await this.pool.query(
      `SELECT 1 FROM ${this.tables.sections} WHERE collection_name = $1 AND section_id = $2 LIMIT 1`,
      [collectionName, sectionId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async getContainersListInSection(collectionName: string, sectionId: string): Promise<string[]> {
    const result = await this.pool.query<{ document_id: string }>(
      `
        SELECT document_id
        FROM ${this.tables.documents}
        WHERE collection_name = $1
          AND section_id = $2
          AND deleted_at IS NULL
        ORDER BY document_id
      `,
      [collectionName, sectionId],
    );
    return result.rows.map((row) => row.document_id);
  }

  async getContainersInSection<T extends RecordBase>(collectionName: string, sectionId: string): Promise<T[]> {
    const result = await this.pool.query<{ payload_json: T }>(
      `
        SELECT payload_json
        FROM ${this.tables.documents}
        WHERE collection_name = $1
          AND section_id = $2
          AND deleted_at IS NULL
        ORDER BY document_id
      `,
      [collectionName, sectionId],
    );
    return Promise.all(
      result.rows.map((row) => hydrateConfidentialStorageDocFromPersistence(row.payload_json, this.blobStore)),
    );
  }

  async listContainersInSection<T extends RecordBase>(collectionName: string, sectionId: string): Promise<T[]> {
    const result = await this.pool.query<{ payload_json: T }>(
      `
        SELECT payload_json
        FROM ${this.tables.documents}
        WHERE collection_name = $1
          AND section_id = $2
          AND deleted_at IS NULL
        ORDER BY document_id
      `,
      [collectionName, sectionId],
    );
    return result.rows.map((row) => row.payload_json);
  }

  async put<T extends RecordBase>(collectionName: string, containers: T[], sectionId: string = DEFAULT_SECTION): Promise<boolean> {
    if (containers.length === 0) {
      await this.ensureVaultExists(collectionName);
      await this.createNewSection(collectionName, sectionId);
      return true;
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.ensureVaultExists(collectionName, client);
      await this.ensureSectionExists(collectionName, sectionId, client);
      await this.upsertDocuments(client, collectionName, sectionId, containers);
      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async get<T extends RecordBase>(collectionName: string, containerId: string, sectionId: string = DEFAULT_SECTION): Promise<T | undefined> {
    const result = await this.pool.query<{ payload_json: T }>(
      `
        SELECT payload_json
        FROM ${this.tables.documents}
        WHERE collection_name = $1
          AND section_id = $2
          AND document_id = $3
          AND deleted_at IS NULL
        LIMIT 1
      `,
      [collectionName, sectionId, containerId],
    );
    const payload = result.rows[0]?.payload_json;
    return payload ? hydrateConfidentialStorageDocFromPersistence(payload, this.blobStore) : undefined;
  }

  async getHistory(): Promise<any[]> {
    return [];
  }

  async query<T extends RecordBase>(collectionName: string, query: LegacyVaultQuery, options?: VaultQueryOptions): Promise<T[]> {
    const normalized = normalizeQuery(query);
    if (normalized.conditions.length === 0) {
      return [];
    }

    const params: Array<string | number> = [collectionName, normalized.sectionId];
    const joinSql = normalized.conditions.map((condition, index) => {
      const nameParam = params.length + 1;
      const valueParam = params.length + 2;
      params.push(condition.name, condition.value);
      return `
        JOIN ${this.tables.indexes} i${index}
          ON i${index}.collection_name = d.collection_name
         AND i${index}.section_id = d.section_id
         AND i${index}.document_id = d.document_id
         AND i${index}.attr_name = $${nameParam}
         AND i${index}.attr_value = $${valueParam}
      `;
    }).join('\n');

    const result = await this.pool.query<{ payload_json: T }>(
      `
        SELECT d.payload_json
        FROM ${this.tables.documents} d
        ${joinSql}
        WHERE d.collection_name = $1
          AND d.section_id = $2
          AND d.deleted_at IS NULL
        ORDER BY d.document_id
      `,
      params,
    );

    if (options?.hydrate === false) {
      return result.rows.map((row) => row.payload_json);
    }

    return Promise.all(result.rows.map((row) => hydrateConfidentialStorageDocFromPersistence(row.payload_json, this.blobStore)));
  }

  async delete(collectionName: string, containerId: string, sectionId: string = DEFAULT_SECTION): Promise<boolean> {
    const result = await this.pool.query(
      `
        UPDATE ${this.tables.documents}
        SET deleted_at = now(), updated_at = now()
        WHERE collection_name = $1
          AND section_id = $2
          AND document_id = $3
          AND deleted_at IS NULL
      `,
      [collectionName, sectionId, containerId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  async purge(collectionName: string): Promise<boolean> {
    await this.pool.query(
      `DELETE FROM ${this.tables.documents} WHERE collection_name = $1 AND deleted_at IS NOT NULL`,
      [collectionName],
    );
    return true;
  }

  private async ensureVaultExists(collectionName: string, client?: PoolClient): Promise<void> {
    const executor = client ?? this.pool;
    await executor.query(
      `
        INSERT INTO ${this.tables.vaults} (collection_name, config_json, updated_at)
        VALUES ($1, $2::jsonb, now())
        ON CONFLICT (collection_name)
        DO UPDATE SET updated_at = now()
      `,
      [collectionName, JSON.stringify({ id: collectionName })],
    );
  }

  private async ensureSectionExists(collectionName: string, sectionId: string, client: PoolClient): Promise<void> {
    await client.query(
      `
        INSERT INTO ${this.tables.sections} (collection_name, section_id, updated_at)
        VALUES ($1, $2, now())
        ON CONFLICT (collection_name, section_id)
        DO UPDATE SET updated_at = now()
      `,
      [collectionName, sectionId],
    );
  }

  private async upsertDocuments<T extends RecordBase>(client: PoolClient, collectionName: string, sectionId: string, containers: T[]): Promise<void> {
    for (const document of containers) {
      if (!document?.id) {
        throw new Error('Document being put into a vault must have an id.');
      }
      const persistedDocument = await externalizeConfidentialStorageDocForPersistence(document, this.blobStore);

      await client.query(
        `
          INSERT INTO ${this.tables.documents} (
            collection_name,
            section_id,
            document_id,
            payload_json,
            deleted_at,
            updated_at
          )
          VALUES ($1, $2, $3, $4::jsonb, NULL, now())
          ON CONFLICT (collection_name, section_id, document_id)
          DO UPDATE SET payload_json = EXCLUDED.payload_json, deleted_at = NULL, updated_at = now()
        `,
        [collectionName, sectionId, document.id, JSON.stringify(persistedDocument)],
      );

      await client.query(
        `
          DELETE FROM ${this.tables.indexes}
          WHERE collection_name = $1 AND section_id = $2 AND document_id = $3
        `,
        [collectionName, sectionId, document.id],
      );

      const indexedAttributes = extractIndexedAttributes(persistedDocument);
      for (const attribute of indexedAttributes) {
        await client.query(
          `
            INSERT INTO ${this.tables.indexes} (
              collection_name,
              section_id,
              document_id,
              attr_name,
              attr_value,
              is_unique
            )
            VALUES ($1, $2, $3, $4, $5, $6)
          `,
          [collectionName, sectionId, document.id, attribute.name, attribute.value, Boolean(attribute.unique)],
        );
      }
    }
  }
}
