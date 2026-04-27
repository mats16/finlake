import type { RequestHandler } from 'express';

declare module 'express-serve-static-core' {
  interface Request {
    user?: {
      accessToken?: string;
      email?: string;
      ipAddress?: string;
    };
  }
}

/**
 * Reads Databricks Apps OBO headers and attaches them to req.user.
 * On Databricks Apps:
 *   x-forwarded-access-token: user OAuth token (when OBO is enabled & user consented)
 *   x-forwarded-email:        user email
 *   x-real-ip:                client ip
 */
export const oboMiddleware: RequestHandler = (req, _res, next) => {
  const accessToken = headerValue(req.headers['x-forwarded-access-token']);
  const email = headerValue(req.headers['x-forwarded-email']);
  const ipAddress = headerValue(req.headers['x-real-ip']);
  if (accessToken || email) {
    req.user = { accessToken, email, ipAddress };
  }
  next();
};

function headerValue(v: string | string[] | undefined): string | undefined {
  if (Array.isArray(v)) return v[0];
  return v ?? undefined;
}
