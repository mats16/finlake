import { loadEnv } from './config/env.js';
import { logger } from './config/logger.js';
import { createDatabaseClient } from '@finlake/db';
import { buildApp, resolveWebDistDir } from './app.js';

async function main() {
  const env = loadEnv();
  const db = await createDatabaseClient(env);
  if (env.MIGRATE_ON_BOOT) {
    await db.migrate();
  }

  if (env.NODE_ENV === 'production' && (await startWithAppKit({ env, db }))) {
    return;
  }

  const app = await buildApp({ env, db });
  const port = env.DATABRICKS_APP_PORT ?? env.PORT;
  app.listen(port, '0.0.0.0', () => {
    logger.info({ port, backend: db.backend, nodeEnv: env.NODE_ENV }, 'finlake api listening');
  });
}

async function startWithAppKit({
  env,
  db,
}: {
  env: ReturnType<typeof loadEnv>;
  db: Awaited<ReturnType<typeof createDatabaseClient>>;
}): Promise<boolean> {
  const appkit = await import('@databricks/appkit').catch((err: unknown) => {
    logger.warn({ err }, '@databricks/appkit not available; falling back to Express listener');
    return undefined;
  });
  if (!appkit) return false;

  const port = env.DATABRICKS_APP_PORT ?? env.PORT;
  const distDir = resolveWebDistDir(env);
  if (!distDir) {
    logger.warn('Web dist directory not found; AppKit static server will not serve the SPA');
  }

  const api = await buildApp({ env, db, serveSpa: false });
  try {
    await appkit.createApp({
      plugins: [
        appkit.server({
          host: '0.0.0.0',
          port,
          staticPath: distDir,
        }),
      ],
      onPluginsReady(appkitServer) {
        appkitServer.server.extend((app) => {
          app.use(api);
        });
      },
    });
  } catch (err) {
    logger.warn(
      { err },
      '@databricks/appkit server failed to start; falling back to Express listener',
    );
    return false;
  }
  logger.info(
    { port, backend: db.backend, nodeEnv: env.NODE_ENV, distDir },
    'finlake app listening via @databricks/appkit server',
  );
  return true;
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
