import { Pool } from 'pg';
import { resolvePostgresSchema } from '../database/repositories/postgres/postgres.schema';

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

export async function ensurePostgresTasksSchema(pool: Pool, schema?: string): Promise<void> {
  const schemaName = resolvePostgresSchema(schema);
  const qualifiedSchema = quoteIdentifier(schemaName);

  await pool.query(`CREATE SCHEMA IF NOT EXISTS ${qualifiedSchema}`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${qualifiedSchema}.care_task_trigger (
      Task_id TEXT NOT NULL,
      Task_status TEXT NOT NULL,
      Task_subject TEXT NOT NULL,
      Task_owner TEXT,
      Task_focus TEXT,
      Task_scheduled_at TIMESTAMPTZ,
      Task_trigger_type TEXT,
      Task_attempt INTEGER NOT NULL DEFAULT 0,
      Task_window_start TIMESTAMPTZ,
      Task_window_end TIMESTAMPTZ,
      Task_channel TEXT,
      Task_confirmed BOOLEAN,
      Task_confirmed_at TIMESTAMPTZ,
      Task_auto_close_at TIMESTAMPTZ,
      Task_escalation_recipient TEXT,
      Task_title TEXT NOT NULL,
      Task_description TEXT,
      Task_metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
      Task_authored_on TIMESTAMPTZ NOT NULL,
      Task_updated_at TIMESTAMPTZ NOT NULL,
      PRIMARY KEY (Task_id, Task_scheduled_at, Task_attempt)
    )
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS idx_care_task_trigger_subject_status
      ON ${qualifiedSchema}.care_task_trigger (Task_subject, Task_status, Task_authored_on)
  `);
}