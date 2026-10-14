import { Pool } from 'pg';
import type { ListTasksQuery, TaskRecord, TaskRepository } from 'tasks-core-node-ts';
import { resolvePostgresSchema } from '../database/repositories/postgres/postgres.schema';

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

function toTaskRecord(row: Record<string, any>): TaskRecord {
  return {
    id: row.task_id,
    subjectId: row.task_subject,
    title: row.task_title,
    description: row.task_description ?? undefined,
    status: row.task_status,
    channels: row.task_channel ? [row.task_channel] : [],
    dueAt: row.task_auto_close_at ? new Date(row.task_auto_close_at).toISOString() : undefined,
    scheduledFor: row.task_scheduled_at ? new Date(row.task_scheduled_at).toISOString() : undefined,
    acknowledgedAt: row.task_confirmed_at ? new Date(row.task_confirmed_at).toISOString() : undefined,
    closedAt: undefined,
    closureReason: undefined,
    metadata: row.task_metadata_json ?? {},
    createdAt: new Date(row.task_authored_on).toISOString(),
    updatedAt: new Date(row.task_updated_at).toISOString(),
  };
}

export class PostgresTaskRepository implements TaskRepository {
  private readonly pool: Pool;
  private readonly tableName: string;

  constructor(pool: Pool, schema?: string) {
    this.pool = pool;
    const schemaName = resolvePostgresSchema(schema);
    this.tableName = `${quoteIdentifier(schemaName)}.care_task_trigger`;
  }

  async save(task: TaskRecord): Promise<TaskRecord> {
    const attempt = Number.parseInt(task.metadata.attempt || '0', 10);
    const scheduledAt = task.scheduledFor ?? task.createdAt;
    await this.pool.query(`DELETE FROM ${this.tableName} WHERE Task_id = $1`, [task.id]);
    const query = `
      INSERT INTO ${this.tableName} (
        Task_id, Task_status, Task_subject, Task_owner, Task_focus, Task_scheduled_at,
        Task_trigger_type, Task_attempt, Task_window_start, Task_window_end, Task_channel,
        Task_confirmed, Task_confirmed_at, Task_auto_close_at, Task_escalation_recipient,
        Task_title, Task_description, Task_metadata_json, Task_authored_on, Task_updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10, $11,
        $12, $13, $14, $15,
        $16, $17, $18::jsonb, $19, $20
      RETURNING *
    `;
    const result = await this.pool.query(query, [
      task.id,
      task.status,
      task.subjectId,
      task.metadata.owner ?? null,
      task.metadata.focus ?? null,
      scheduledAt,
      task.metadata['trigger-type'] ?? null,
      Number.isFinite(attempt) ? attempt : 0,
      task.metadata['window-start'] ?? null,
      task.metadata['window-end'] ?? null,
      task.channels[0] ?? null,
      task.metadata.confirmed === 'true',
      task.acknowledgedAt ?? null,
      task.metadata['auto-close-at'] ?? task.dueAt ?? null,
      task.metadata['escalation-recipient'] ?? null,
      task.title,
      task.description ?? null,
      JSON.stringify(task.metadata ?? {}),
      task.createdAt,
      task.updatedAt,
    ]);
    return toTaskRecord(result.rows[0]);
  }

  async getById(taskId: string): Promise<TaskRecord | undefined> {
    const result = await this.pool.query(
      `SELECT * FROM ${this.tableName} WHERE Task_id = $1 ORDER BY Task_scheduled_at DESC NULLS LAST, Task_attempt DESC LIMIT 1`,
      [taskId],
    );
    return result.rows[0] ? toTaskRecord(result.rows[0]) : undefined;
  }

  async list(query?: ListTasksQuery): Promise<TaskRecord[]> {
    const where: string[] = [];
    const params: unknown[] = [];

    if (query?.subjectId) {
      params.push(query.subjectId);
      where.push(`Task_subject = $${params.length}`);
    }
    if (query?.status) {
      params.push(query.status);
      where.push(`Task_status = $${params.length}`);
    }

    const sql = `SELECT * FROM ${this.tableName}`
      + (where.length ? ` WHERE ${where.join(' AND ')}` : '')
      + ' ORDER BY Task_authored_on ASC';
    const result = await this.pool.query(sql, params);
    return result.rows.map((row) => toTaskRecord(row));
  }

  async delete(taskId: string): Promise<void> {
    await this.pool.query(`DELETE FROM ${this.tableName} WHERE Task_id = $1`, [taskId]);
  }
}