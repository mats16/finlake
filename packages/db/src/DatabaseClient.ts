import type { Repositories } from './repositories/index.js';

export type Backend = 'lakebase' | 'sqlite';

export interface DatabaseClient {
  readonly backend: Backend;
  readonly repos: Repositories;
  healthCheck(): Promise<{ ok: true; backend: Backend }>;
  migrate(): Promise<void>;
  close(): Promise<void>;
}
