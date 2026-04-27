import { logger } from '../config/logger.js';
import type { Env } from '@lakecost/shared';

interface CachedToken {
  token: string;
  expiresAt: number;
}

/**
 * Acquires an M2M OAuth token for the App Service Principal using
 * `client_credentials` grant against the Databricks workspace OIDC endpoint.
 * Tokens are cached in memory and refreshed 60s before expiry.
 */
export class AppServicePrincipalTokenProvider {
  private cached: CachedToken | undefined;
  private inflight: Promise<string> | undefined;

  constructor(private env: Env) {}

  async getToken(): Promise<string> {
    const now = Date.now();
    if (this.cached && this.cached.expiresAt - 60_000 > now) {
      return this.cached.token;
    }
    if (this.inflight) return this.inflight;
    this.inflight = this.fetchToken().finally(() => {
      this.inflight = undefined;
    });
    return this.inflight;
  }

  private async fetchToken(): Promise<string> {
    const host = this.env.DATABRICKS_HOST;
    const clientId = this.env.DATABRICKS_CLIENT_ID;
    const clientSecret = this.env.DATABRICKS_CLIENT_SECRET;
    if (!host || !clientId || !clientSecret) {
      throw new Error(
        'Cannot fetch SP token: DATABRICKS_HOST, DATABRICKS_CLIENT_ID, DATABRICKS_CLIENT_SECRET required',
      );
    }
    const tokenUrl = new URL('/oidc/v1/token', host).toString();
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      scope: 'all-apis',
    });
    const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    const res = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: `Basic ${auth}`,
      },
      body,
    });
    if (!res.ok) {
      const detail = await res.text();
      throw new Error(`OAuth token request failed: ${res.status} ${detail}`);
    }
    const json = (await res.json()) as { access_token: string; expires_in: number };
    const token = json.access_token;
    const expiresAt = Date.now() + json.expires_in * 1000;
    this.cached = { token, expiresAt };
    logger.debug({ expiresAt }, 'Refreshed app SP token');
    return token;
  }
}
