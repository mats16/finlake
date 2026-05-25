import {
  UsageBySkuRowSchema,
  UsageTopWorkloadRowSchema,
  usageBySkuSql,
  usageTopWorkloadsSql,
  type UsageBySkuRow,
  type UsageRange,
  type UsageTopWorkloadRow,
} from '@finlake/shared';
import type { StatementExecutor } from './statementExecution.js';

export class UsageQueries {
  constructor(private executor: StatementExecutor) {}

  async bySku(range: UsageRange): Promise<UsageBySkuRow[]> {
    return this.executor.run(usageBySkuSql, this.rangeParams(range), UsageBySkuRowSchema);
  }

  async topWorkloads(range: UsageRange): Promise<UsageTopWorkloadRow[]> {
    return this.executor.run(
      usageTopWorkloadsSql,
      this.rangeParams(range),
      UsageTopWorkloadRowSchema,
    );
  }

  private rangeParams(range: UsageRange) {
    return [
      { name: 'start_ts', value: range.start, type: 'TIMESTAMP' as const },
      { name: 'end_ts', value: range.end, type: 'TIMESTAMP' as const },
      {
        name: 'workspace_id',
        value: range.workspaceId ?? null,
        type: 'STRING' as const,
      },
    ];
  }
}
