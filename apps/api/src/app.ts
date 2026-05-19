import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { pinoHttp } from 'pino-http';
import type { Env } from '@finlake/shared';
import type { DatabaseClient } from '@finlake/db';
import { logger } from './config/logger.js';
import { findRepoRoot } from './config/env.js';
import { errorHandler } from './middlewares/error.js';
import { oboMiddleware } from './middlewares/obo.js';
import { healthRouter } from './routes/health.js';
import { usageRouter } from './routes/usage.js';
import { budgetsRouter } from './routes/budgets.js';
import { setupRouter } from './routes/setup.js';
import { appSettingsRouter, settingsRouter } from './routes/settings.js';
import { meRouter } from './routes/me.js';
import { dataSourcesRouter } from './routes/dataSources.js';
import { catalogsRouter } from './routes/catalogs.js';
import { externalLocationsRouter } from './routes/externalLocations.js';
import { storageCredentialsRouter } from './routes/storageCredentials.js';
import { serviceCredentialsRouter } from './routes/serviceCredentials.js';
import { transformationsRouter } from './routes/transformations.js';
import { governedTagsRouter } from './routes/governedTags.js';
import { genieRouter } from './routes/genie.js';
import { adminRouter } from './routes/admin.js';
import { sqlRouter } from './routes/sql.js';
import { pricingRouter } from './routes/pricing.js';
import { jobsRouter } from './routes/jobs.js';
import { workspacesRouter } from './routes/workspaces.js';

export interface AppDeps {
  env: Env;
  db: DatabaseClient;
  serveSpa?: boolean;
}

export async function buildApp({ env, db, serveSpa = true }: AppDeps): Promise<express.Express> {
  const app = express();
  app.disable('x-powered-by');
  app.use(pinoHttp({ logger }));
  app.use(express.json({ limit: '1mb' }));

  app.use(oboMiddleware);

  app.use('/api/health', healthRouter(db, env));
  app.use('/api/usage', usageRouter(db, env));
  app.use('/api/budgets', budgetsRouter(db));
  app.use('/api/setup', setupRouter(db, env));
  app.use('/api/app-settings', appSettingsRouter(db, env));
  app.use('/api/settings', settingsRouter(db));
  app.use('/api/me', meRouter(env));
  app.use('/api/tags', governedTagsRouter(db, env));
  app.use('/api/integrations', dataSourcesRouter(db, env));
  app.use('/api/transformations', transformationsRouter(db, env));
  app.use('/api/catalogs', catalogsRouter(env));
  app.use('/api/storage-credentials', storageCredentialsRouter(env));
  app.use('/api/unity-catalog/external-locations', externalLocationsRouter(env));
  app.use('/api/unity-catalog/credentials', serviceCredentialsRouter(env));
  app.use('/api/genie', genieRouter(db, env));
  app.use('/api/admin', adminRouter(db, env));
  app.use('/api/sql', sqlRouter(db, env));
  app.use('/api/pricing', pricingRouter(db, env));
  app.use('/api/jobs', jobsRouter(db, env));
  app.use('/api/workspaces', workspacesRouter(db));

  if (serveSpa && env.NODE_ENV === 'production') {
    const distDir = resolveWebDistDir(env);
    if (distDir && fs.existsSync(distDir)) {
      logger.info({ distDir }, 'Serving SPA from web dist directory');
      app.use(express.static(distDir));
      app.get(/^(?!\/api\/).*/, (_req, res) => {
        res.sendFile(path.join(distDir, 'index.html'));
      });
    } else {
      logger.warn({ distDir }, 'Web dist directory not found; SPA will not be served');
    }
  }

  app.use(errorHandler);
  return app;
}

export function resolveWebDistDir(env: Env): string | undefined {
  if (env.WEB_DIST_DIR) {
    const candidates = path.isAbsolute(env.WEB_DIST_DIR)
      ? [env.WEB_DIST_DIR]
      : buildRelativeDistCandidates(env.WEB_DIST_DIR);
    return candidates.find(hasIndexHtml);
  }
  const candidates = [
    path.resolve(process.cwd(), 'apps/web/dist'),
    path.resolve(process.cwd(), '../web/dist'),
    path.resolve(process.cwd(), '../../apps/web/dist'),
    path.resolve(findRepoRoot(process.cwd()) ?? process.cwd(), 'apps/web/dist'),
  ];
  return candidates.find(hasIndexHtml);
}

function buildRelativeDistCandidates(relativePath: string): string[] {
  const cwd = process.cwd();
  const repoRoot = findRepoRoot(cwd);
  return [
    path.resolve(cwd, relativePath),
    path.resolve(cwd, '..', '..', relativePath),
    ...(repoRoot ? [path.resolve(repoRoot, relativePath)] : []),
  ];
}

function hasIndexHtml(distDir: string): boolean {
  return fs.existsSync(path.join(distDir, 'index.html'));
}
