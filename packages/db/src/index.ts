import type { Env } from '@finlake/shared';
import { logger } from './logger.js';
import type { DatabaseClient } from './DatabaseClient.js';
import { SqliteClient } from './SqliteClient.js';
import { LakebaseClient } from './LakebaseClient.js';
import { resolveSqlitePath } from './paths.js';

export type { DatabaseClient } from './DatabaseClient.js';
export type {
  GenieSpacesRepo,
  GenieSpaceValue,
  Repositories,
  WorkspacesRepo,
  WorkspaceValue,
} from './repositories/index.js';
export { settingsToRecord } from './repositories/index.js';
export { SqliteClient } from './SqliteClient.js';

export async function createDatabaseClient(env: Env): Promise<DatabaseClient> {
  if (env.LAKEBASE_ENDPOINT) {
    const client = await LakebaseClient.create(env);
    await client.healthCheck();
    logger.info('LAKEBASE_ENDPOINT is set, using Lakebase');
    return client;
  }

  const sqlitePath = resolveSqlitePath(env);
  logger.info({ sqlitePath }, 'LAKEBASE_ENDPOINT is not set, using SQLite');
  return await SqliteClient.create({ sqlitePath });
}
