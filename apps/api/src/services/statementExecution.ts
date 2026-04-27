import type { ZodType } from 'zod';
import { logger } from '../config/logger.js';

export type SqlParam = {
  name: string;
  value: string | number | null;
  type?: 'STRING' | 'INT' | 'BIGINT' | 'TIMESTAMP' | 'DATE';
};

interface StatementResponse {
  statement_id: string;
  status: { state: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELED' | 'CLOSED' };
  result?: {
    data_array?: Array<Array<string | number | null>>;
  };
  manifest?: {
    schema?: { columns?: Array<{ name: string; type_name?: string }> };
  };
}

export interface StatementExecutorOpts {
  host: string;
  warehouseId: string;
  tokenProvider: () => Promise<string>;
  fetchImpl?: typeof fetch;
}

export class StatementExecutor {
  private fetchImpl: typeof fetch;

  constructor(private opts: StatementExecutorOpts) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async run<T>(sqlText: string, params: SqlParam[], rowSchema: ZodType<T>): Promise<T[]> {
    const token = await this.opts.tokenProvider();
    const body = {
      warehouse_id: this.opts.warehouseId,
      statement: sqlText,
      wait_timeout: '30s',
      on_wait_timeout: 'CONTINUE',
      disposition: 'INLINE',
      format: 'JSON_ARRAY',
      parameters: params.map((p) => ({ name: p.name, value: p.value, type: p.type })),
    };
    const url = new URL('/api/2.0/sql/statements', this.opts.host).toString();
    let res = await this.fetchImpl(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    let payload = (await res.json()) as StatementResponse;

    while (payload.status.state === 'PENDING' || payload.status.state === 'RUNNING') {
      await sleep(500);
      const pollUrl = new URL(
        `/api/2.0/sql/statements/${payload.statement_id}`,
        this.opts.host,
      ).toString();
      res = await this.fetchImpl(pollUrl, {
        headers: { authorization: `Bearer ${token}` },
      });
      payload = (await res.json()) as StatementResponse;
    }

    if (payload.status.state !== 'SUCCEEDED') {
      logger.error({ payload }, 'Statement Execution failed');
      throw new Error(`Statement failed: ${payload.status.state}`);
    }

    const columns = payload.manifest?.schema?.columns ?? [];
    const rows = payload.result?.data_array ?? [];
    return rows.map((rawRow) => {
      const obj: Record<string, unknown> = {};
      columns.forEach((col, i) => {
        obj[snakeToCamel(col.name)] = coerce(rawRow[i], col.type_name);
      });
      return rowSchema.parse(obj);
    });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function snakeToCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

function coerce(v: string | number | null | undefined, typeName: string | undefined): unknown {
  if (v === null || v === undefined) return null;
  if (
    typeName === 'INT' ||
    typeName === 'BIGINT' ||
    typeName === 'DOUBLE' ||
    typeName === 'FLOAT'
  ) {
    return typeof v === 'number' ? v : Number(v);
  }
  return v;
}
