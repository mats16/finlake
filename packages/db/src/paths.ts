import path from 'node:path';
import fs from 'node:fs';
import type { Env } from '@lakecost/shared';

export function resolveSqlitePath(env: Env): string {
  if (env.SQLITE_PATH) return env.SQLITE_PATH;

  if (env.DATABRICKS_APP_NAME || fs.existsSync('/home/app')) {
    return '/home/app/data/lakecost.db';
  }

  return path.resolve(process.cwd(), 'data/lakecost.db');
}

export function ensureParentDir(filePath: string): void {
  if (filePath === ':memory:') return;
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
}
