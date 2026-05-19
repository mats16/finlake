import type {
  SqlWarehouseListResponse,
  SqlStatementResultResponse,
  SqlStatementSubmitRequest,
  SqlStatementSubmitResponse,
} from '@finlake/shared';
import { apiFetch } from './client';

export { isTerminalSqlStatus } from '@finlake/shared';

export function submitSqlStatement(
  input: SqlStatementSubmitRequest,
): Promise<SqlStatementSubmitResponse> {
  return apiFetch<SqlStatementSubmitResponse>('/api/sql/statements', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function getSqlStatement(statement_id: string): Promise<SqlStatementResultResponse> {
  return apiFetch<SqlStatementResultResponse>(
    `/api/sql/statements/${encodeURIComponent(statement_id)}`,
  );
}

export function listSqlWarehouses(): Promise<SqlWarehouseListResponse> {
  return apiFetch<SqlWarehouseListResponse>('/api/sql/warehouses');
}
