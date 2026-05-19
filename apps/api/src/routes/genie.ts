import { Router, type NextFunction, type Response } from 'express';
import type { DatabaseClient } from '@finlake/db';
import {
  DEFAULT_GENIE_SPACE_PURPOSE,
  GenieChatRequestSchema,
  GenieSetupRequestSchema,
  type Env,
} from '@finlake/shared';
import {
  GenieServiceError,
  askFinLakeGenie,
  deleteFinLakeGenieSpace,
  getGenieSpaceStatus,
  normalizeGeniePurpose,
  setupFinLakeGenieSpace,
  streamFinLakeGenieConversation,
  streamFinLakeGenieExistingMessage,
  streamFinLakeGenieMessage,
  type GenieStreamEvent,
} from '../services/genie.js';

export function genieRouter(db: DatabaseClient, env: Env): Router {
  const router = Router();

  router.post('/setup', async (req, res, next) => {
    try {
      const parsed = GenieSetupRequestSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ error: { message: 'Invalid input', issues: parsed.error.issues } });
        return;
      }
      const result = await setupFinLakeGenieSpace(
        env,
        db,
        parsed.data.warehouseId,
        DEFAULT_GENIE_SPACE_PURPOSE,
      );
      res.json(result);
    } catch (err) {
      handleJsonError(err, res, next);
    }
  });

  router.delete('/space', async (_req, res, next) => {
    try {
      await deleteFinLakeGenieSpace(env, db);
      res.status(204).end();
    } catch (err) {
      handleJsonError(err, res, next);
    }
  });

  router.post('/chat', async (req, res, next) => {
    try {
      const parsed = GenieChatRequestSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res
          .status(400)
          .json({ error: { message: parsed.error.issues[0]?.message ?? 'Invalid request' } });
        return;
      }
      if (!requireOboAccessToken(req.user?.accessToken, res)) return;
      const result = await askFinLakeGenie(env, db, {
        ...parsed.data,
        purpose: DEFAULT_GENIE_SPACE_PURPOSE,
        userAccessToken: req.user?.accessToken,
      });
      res.json(result);
    } catch (err) {
      handleJsonError(err, res, next);
    }
  });

  router.get('/:alias/space', async (req, res, next) => {
    try {
      const purpose = geniePurposeOr404(req.params.alias, res);
      if (!purpose) return;
      res.json(await getGenieSpaceStatus(db, purpose));
    } catch (err) {
      handleJsonError(err, res, next);
    }
  });

  router.post('/:alias/setup', async (req, res, next) => {
    try {
      const purpose = geniePurposeOr404(req.params.alias, res);
      if (!purpose) return;
      const parsed = GenieSetupRequestSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({ error: { message: 'Invalid input', issues: parsed.error.issues } });
        return;
      }
      const result = await setupFinLakeGenieSpace(env, db, parsed.data.warehouseId, purpose);
      res.json(result);
    } catch (err) {
      handleJsonError(err, res, next);
    }
  });

  router.delete('/:alias/space', async (req, res, next) => {
    try {
      const purpose = geniePurposeOr404(req.params.alias, res);
      if (!purpose) return;
      await deleteFinLakeGenieSpace(env, db, purpose);
      res.status(204).end();
    } catch (err) {
      handleJsonError(err, res, next);
    }
  });

  router.post('/:alias/messages', async (req, res, next) => {
    try {
      const purpose = geniePurposeOr404(req.params.alias, res);
      if (!purpose) return;
      const parsed = GenieChatRequestSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res
          .status(400)
          .json({ error: { message: parsed.error.issues[0]?.message ?? 'Invalid request' } });
        return;
      }
      if (!requireOboAccessToken(req.user?.accessToken, res)) return;
      prepareSse(res);
      await streamFinLakeGenieMessage(env, db, {
        ...parsed.data,
        purpose,
        userAccessToken: req.user?.accessToken,
        emit: (event) => writeSse(res, event),
      });
      res.end();
    } catch (err) {
      handleSseError(err, res, next);
    }
  });

  router.get('/:alias/conversations/:conversationId', async (req, res, next) => {
    try {
      const purpose = geniePurposeOr404(req.params.alias, res);
      if (!purpose) return;
      if (!requireOboAccessToken(req.user?.accessToken, res)) return;
      prepareSse(res);
      await streamFinLakeGenieConversation(env, db, {
        purpose,
        conversationId: req.params.conversationId,
        pageToken: typeof req.query.pageToken === 'string' ? req.query.pageToken : undefined,
        includeQueryResults: req.query.includeQueryResults !== 'false',
        userAccessToken: req.user?.accessToken,
        emit: (event) => writeSse(res, event),
      });
      res.end();
    } catch (err) {
      handleSseError(err, res, next);
    }
  });

  router.get(
    '/:alias/conversations/:conversationId/messages/:messageId',
    async (req, res, next) => {
      try {
        const purpose = geniePurposeOr404(req.params.alias, res);
        if (!purpose) return;
        if (!requireOboAccessToken(req.user?.accessToken, res)) return;
        prepareSse(res);
        await streamFinLakeGenieExistingMessage(env, db, {
          purpose,
          conversationId: req.params.conversationId,
          messageId: req.params.messageId,
          userAccessToken: req.user?.accessToken,
          emit: (event) => writeSse(res, event),
        });
        res.end();
      } catch (err) {
        handleSseError(err, res, next);
      }
    },
  );

  return router;
}

function geniePurposeOr404(alias: string | undefined, res: Response) {
  const purpose = normalizeGeniePurpose(alias);
  if (!purpose) {
    res.status(404).json({ error: { message: `Unknown Genie space alias: ${alias}` } });
    return null;
  }
  return purpose;
}

function requireOboAccessToken(accessToken: string | undefined, res: Response): boolean {
  if (accessToken?.trim()) return true;
  res.status(401).json({ error: { message: 'Genie requires an OBO access token.' } });
  return false;
}

function prepareSse(res: Response): void {
  res.setHeader('content-type', 'text/event-stream');
  res.setHeader('cache-control', 'no-cache, no-transform');
  res.setHeader('connection', 'keep-alive');
  res.flushHeaders?.();
}

function writeSse(res: Response, event: GenieStreamEvent): void {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

function handleJsonError(err: unknown, res: Response, next: NextFunction): void {
  if (err instanceof GenieServiceError) {
    res.status(err.statusCode).json({ error: { message: err.message } });
    return;
  }
  next(err);
}

function handleSseError(err: unknown, res: Response, next: NextFunction): void {
  if (res.headersSent) {
    writeSse(res, {
      type: 'error',
      error: err instanceof Error ? err.message : 'Genie request failed',
    });
    res.end();
    return;
  }
  if (err instanceof GenieServiceError) {
    res.status(err.statusCode).json({ error: { message: err.message } });
    return;
  }
  next(err);
}
