import assert from 'node:assert/strict';
import test from 'node:test';
import { SqliteClient } from '@finlake/db';
import {
  EnvSchema,
  PROVIDER_AWS,
  PROVIDER_DATABRICKS,
  type Env,
  type ServiceCredentialSummary,
} from '@finlake/shared';
import { listFinLakeAwsAccounts, listGovernedTags } from '../src/services/governedTags.js';

const env: Env = EnvSchema.parse({});

test('listFinLakeAwsAccounts uses enabled AWS data sources as the account population', async () => {
  const db = await SqliteClient.create({ sqlitePath: ':memory:' });
  try {
    await db.repos.dataSources.create({
      name: 'AWS enabled',
      providerName: PROVIDER_AWS,
      accountId: '111111111111',
      tableName: 'aws_111111111111_usage',
      enabled: true,
      config: {},
    });
    await db.repos.dataSources.create({
      name: 'AWS disabled',
      providerName: PROVIDER_AWS,
      accountId: '222222222222',
      tableName: 'aws_222222222222_usage',
      enabled: false,
      config: {},
    });
    await db.repos.dataSources.create({
      name: 'Databricks',
      providerName: PROVIDER_DATABRICKS,
      accountId: 'default',
      tableName: 'databricks_usage',
      enabled: true,
      config: {},
    });

    const warnings: string[] = [];
    const accounts = await listFinLakeAwsAccounts(env, db, warnings, async () => [
      serviceCredential('finlake_service_credential_111111111111', '111111111111'),
      serviceCredential('finlake_service_credential_333333333333', '333333333333'),
    ]);

    assert.deepEqual(accounts, [
      {
        awsAccountId: '111111111111',
        credentialName: 'finlake_service_credential_111111111111',
      },
    ]);
    assert.deepEqual(warnings, []);
  } finally {
    await db.close();
  }
});

test('listGovernedTags keeps enabled AWS data source accounts when credentials are missing', async () => {
  const db = await SqliteClient.create({ sqlitePath: ':memory:' });
  try {
    await db.repos.dataSources.create({
      name: 'AWS enabled',
      providerName: PROVIDER_AWS,
      accountId: '123456789012',
      tableName: 'aws_123456789012_usage',
      enabled: true,
      config: {},
    });

    const result = await listGovernedTags(env, db);

    assert.deepEqual(result.awsAccounts, [
      {
        awsAccountId: '123456789012',
        credentialName: null,
      },
    ]);
    assert.equal(result.items.length > 0, true);
    for (const row of result.items) {
      assert.equal(row.aws.length, 1);
      assert.equal(row.aws[0]?.accountId, '123456789012');
      assert.equal(row.aws[0]?.status, 'Error');
      assert.match(row.aws[0]?.message ?? '', /FinLakeServiceRole service credential not found/);
    }
  } finally {
    await db.close();
  }
});

function serviceCredential(name: string, awsAccountId: string): ServiceCredentialSummary {
  return {
    name,
    awsAccountId,
    roleArn: `arn:aws:iam::${awsAccountId}:role/FinLakeServiceRole`,
    externalId: null,
    unityCatalogIamArn: null,
    owner: null,
    createdAt: null,
    comment: null,
  };
}
