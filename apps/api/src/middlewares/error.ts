import type { ErrorRequestHandler } from 'express';
import { logger } from '../config/logger.js';

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  logger.error({ err }, 'Unhandled error');
  if (res.headersSent) return;
  const status = typeof err?.statusCode === 'number' ? err.statusCode : 500;
  res.status(status).json({
    error: {
      message: err?.message ?? 'Internal Server Error',
    },
  });
};
