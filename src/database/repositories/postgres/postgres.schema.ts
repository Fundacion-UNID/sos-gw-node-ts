import { Pool } from 'pg';

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

export function resolvePostgresSchema(schema?: string): string {
  return schema && schema.trim() ? schema.trim() : 'public';
}

export async function ensurePostgresVaultSchema(pool: Pool, schema?: string): Promise<void> {
  const schemaName = resolvePostgresSchema(schema);
  const qualifiedSchema = quoteIdentifier(schemaName);

  await pool.query(`CREATE SCHEMA IF NOT EXISTS ${qualifiedSchema}`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${qualifiedSchema}.vaults (
      collection_name TEXT PRIMARY KEY,
      config_json JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${qualifiedSchema}.vault_sections (
      collection_name TEXT NOT NULL,
      section_id TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (collection_name, section_id),
      FOREIGN KEY (collection_name)
        REFERENCES ${qualifiedSchema}.vaults(collection_name)
        ON DELETE CASCADE
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${qualifiedSchema}.vault_documents (
      collection_name TEXT NOT NULL,
      section_id TEXT NOT NULL,
      document_id TEXT NOT NULL,
      payload_json JSONB NOT NULL,
      deleted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (collection_name, section_id, document_id),
      FOREIGN KEY (collection_name, section_id)
        REFERENCES ${qualifiedSchema}.vault_sections(collection_name, section_id)
        ON DELETE CASCADE
    )
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${qualifiedSchema}.vault_document_indexes (
      collection_name TEXT NOT NULL,
      section_id TEXT NOT NULL,
      document_id TEXT NOT NULL,
      attr_name TEXT NOT NULL,
      attr_value TEXT NOT NULL,
      is_unique BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      PRIMARY KEY (collection_name, section_id, document_id, attr_name, attr_value),
      FOREIGN KEY (collection_name, section_id, document_id)
        REFERENCES ${qualifiedSchema}.vault_documents(collection_name, section_id, document_id)
        ON DELETE CASCADE
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_vault_documents_section
      ON ${qualifiedSchema}.vault_documents (collection_name, section_id)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_vault_indexes_lookup
      ON ${qualifiedSchema}.vault_document_indexes (collection_name, section_id, attr_name, attr_value)
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_vault_indexes_document
      ON ${qualifiedSchema}.vault_document_indexes (collection_name, section_id, document_id)
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_vault_indexes_unique_attr
      ON ${qualifiedSchema}.vault_document_indexes (collection_name, section_id, attr_name, attr_value)
      WHERE is_unique = true
  `);
}