import { Pool, PoolConfig } from 'pg';
import { IServerConfig } from '../../../config';

export function createPostgresPool(config?: IServerConfig['postgres']): Pool {
  const poolConfig: PoolConfig = {
    host: config?.host,
    port: config?.port,
    database: config?.database,
    user: config?.user,
    password: config?.password,
    max: config?.maxPoolSize,
  };

  if (config?.ssl) {
    poolConfig.ssl = { rejectUnauthorized: false };
  }

  return new Pool(poolConfig);
}