import type { Env, SetupCheckResult, SetupStepId } from '@lakecost/shared';
import { StatementExecutor } from './statementExecution.js';
import { AppServicePrincipalTokenProvider } from '../auth/appServicePrincipal.js';
import { z } from 'zod';

export async function runSetupCheck(
  step: SetupStepId,
  env: Env,
  input: Record<string, unknown>,
): Promise<SetupCheckResult> {
  const checkedAt = new Date().toISOString();

  switch (step) {
    case 'systemTables':
      return await checkSystemTables(env, checkedAt);
    case 'permissions':
      return await checkPermissions(env, checkedAt);
    case 'awsCur':
      return checkAwsCur(input, checkedAt);
    case 'azureExport':
      return checkAzureExport(input, checkedAt);
    case 'tagging':
      return checkTagging(checkedAt);
    default:
      return {
        step,
        status: 'unknown',
        message: `Unknown setup step: ${step}`,
        checkedAt,
      };
  }
}

async function checkSystemTables(env: Env, checkedAt: string): Promise<SetupCheckResult> {
  const executor = tryBuildExecutor(env);
  if (!executor) {
    return notConfigured('systemTables', checkedAt);
  }
  try {
    const rows = await executor.run(
      'SHOW SCHEMAS IN system',
      [],
      z.object({ databaseName: z.string().optional(), schemaName: z.string().optional() }),
    );
    const names = rows.map((r) => r.databaseName ?? r.schemaName ?? '').filter(Boolean);
    const required = ['billing'];
    const missing = required.filter((s) => !names.includes(s));
    if (missing.length > 0) {
      return {
        step: 'systemTables',
        status: 'error',
        message: `Required system schemas not enabled: ${missing.join(', ')}`,
        details: { enabled: names, missing },
        remediation: {
          terraform: missing
            .map((s) => `resource "databricks_system_schema" "${s}" {\n  schema = "${s}"\n}`)
            .join('\n\n'),
          cli: missing
            .map((s) => `databricks account metastores systemschemas enable <metastore-id> ${s}`)
            .join('\n'),
        },
        checkedAt,
      };
    }
    return {
      step: 'systemTables',
      status: 'ok',
      message: 'Required system schemas are enabled',
      details: { enabled: names },
      checkedAt,
    };
  } catch (err) {
    return {
      step: 'systemTables',
      status: 'error',
      message: `Failed to query system schemas: ${(err as Error).message}`,
      checkedAt,
    };
  }
}

async function checkPermissions(env: Env, checkedAt: string): Promise<SetupCheckResult> {
  const executor = tryBuildExecutor(env);
  if (!executor) {
    return notConfigured('permissions', checkedAt);
  }
  const grantSql = [
    'GRANT USE CATALOG ON CATALOG system TO `<app-service-principal>`;',
    'GRANT USE SCHEMA  ON SCHEMA  system.billing TO `<app-service-principal>`;',
    'GRANT SELECT      ON TABLE   system.billing.usage        TO `<app-service-principal>`;',
    'GRANT SELECT      ON TABLE   system.billing.list_prices  TO `<app-service-principal>`;',
  ].join('\n');
  try {
    await executor.run(
      'SELECT count(*) AS n FROM system.billing.usage LIMIT 1',
      [],
      z.object({ n: z.number() }),
    );
    return {
      step: 'permissions',
      status: 'ok',
      message: 'App service principal can read system.billing.usage',
      checkedAt,
    };
  } catch (err) {
    return {
      step: 'permissions',
      status: 'error',
      message: `Cannot read system.billing.usage: ${(err as Error).message}`,
      remediation: { sql: grantSql },
      checkedAt,
    };
  }
}

function checkAwsCur(input: Record<string, unknown>, checkedAt: string): SetupCheckResult {
  const bucket = typeof input.bucket === 'string' ? input.bucket : undefined;
  if (!bucket) {
    return {
      step: 'awsCur',
      status: 'warning',
      message: 'AWS CUR bucket not provided yet',
      remediation: {
        terraform: `resource "aws_cur_report_definition" "lakecost" {
  report_name                = "lakecost-cur"
  time_unit                  = "DAILY"
  format                     = "Parquet"
  compression                = "Parquet"
  additional_schema_elements = ["RESOURCES"]
  s3_bucket                  = "<your-bucket>"
  s3_region                  = "us-east-1"
  s3_prefix                  = "cur/lakecost"
  refresh_closed_reports     = true
  report_versioning          = "OVERWRITE_REPORT"
}`,
        cli: 'aws cur put-report-definition --report-definition file://cur.json',
      },
      checkedAt,
    };
  }
  return {
    step: 'awsCur',
    status: 'ok',
    message: `Marked CUR bucket: ${bucket}. Validate the manifest exists in s3://${bucket}/cur/lakecost/`,
    details: { bucket },
    checkedAt,
  };
}

function checkAzureExport(input: Record<string, unknown>, checkedAt: string): SetupCheckResult {
  const storageAccount =
    typeof input.storageAccount === 'string' ? input.storageAccount : undefined;
  if (!storageAccount) {
    return {
      step: 'azureExport',
      status: 'warning',
      message: 'Azure Cost Management Export not configured',
      remediation: {
        cli: 'az costmanagement export create --name lakecost-export --scope <subscription> --storage-account <name> --container <container> --root-folder-path <path>',
      },
      checkedAt,
    };
  }
  return {
    step: 'azureExport',
    status: 'ok',
    message: `Marked storage account: ${storageAccount}`,
    details: { storageAccount },
    checkedAt,
  };
}

function checkTagging(checkedAt: string): SetupCheckResult {
  return {
    step: 'tagging',
    status: 'warning',
    message: 'Configure recommended cost-attribution tags',
    details: {
      recommendedKeys: ['team', 'cost_center', 'project', 'environment'],
    },
    remediation: {
      sql: `-- Apply via Compute Policy (admin console > Compute > Policies)
{
  "custom_tags.team":         { "type": "fixed", "value": "{user.team}" },
  "custom_tags.cost_center":  { "type": "regex", "pattern": "^CC-[0-9]{4}$" },
  "custom_tags.project":      { "type": "unlimited" }
}`,
    },
    checkedAt,
  };
}

function tryBuildExecutor(env: Env): StatementExecutor | undefined {
  if (!env.DATABRICKS_HOST || !env.SQL_WAREHOUSE_ID) return undefined;
  if (!env.DATABRICKS_CLIENT_ID || !env.DATABRICKS_CLIENT_SECRET) return undefined;
  const tokenProvider = new AppServicePrincipalTokenProvider(env);
  return new StatementExecutor({
    host: env.DATABRICKS_HOST,
    warehouseId: env.SQL_WAREHOUSE_ID,
    tokenProvider: () => tokenProvider.getToken(),
  });
}

function notConfigured(step: SetupStepId, checkedAt: string): SetupCheckResult {
  return {
    step,
    status: 'unknown',
    message:
      'Databricks workspace credentials not configured (DATABRICKS_HOST, SQL_WAREHOUSE_ID, DATABRICKS_CLIENT_ID, DATABRICKS_CLIENT_SECRET)',
    checkedAt,
  };
}
