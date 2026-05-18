import assert from 'node:assert/strict';
import test from 'node:test';

import {
  finlakeResourceTags,
  startPipelineUpdate,
  upsertMultiPipelineSchedule,
} from '../src/services/databricksJobs.js';

test('finlakeResourceTags includes FinLake cost allocation tags', () => {
  assert.deepEqual(finlakeResourceTags('production'), {
    ManagedBy: 'finlake',
    Project: 'finops',
    CostCenter: 'finlake',
    Environment: 'production',
  });
});

test('finlakeResourceTags falls back to local when environment is unavailable', () => {
  assert.equal(finlakeResourceTags().Environment, 'local');
  assert.equal(finlakeResourceTags('   ').Environment, 'local');
  assert.equal(finlakeResourceTags('${bundle.target}').Environment, 'local');
});

test('upsertMultiPipelineSchedule creates one job with silver tasks feeding gold', async () => {
  const imports: unknown[] = [];
  const createdPipelines: unknown[] = [];
  const createdJobs: unknown[] = [];
  let nextPipeline = 1;
  const wc = {
    workspace: {
      mkdirs: async () => {},
      import: async (input: unknown) => {
        imports.push(input);
      },
    },
    pipelines: {
      create: async (input: unknown) => {
        createdPipelines.push(input);
        return { pipeline_id: `pipeline-${nextPipeline++}` };
      },
    },
    jobs: {
      create: async (input: unknown) => {
        createdJobs.push(input);
        return { job_id: 123 };
      },
    },
  };

  const result = await upsertMultiPipelineSchedule(
    wc as never,
    {
      jobName: 'finops-master-job',
      pipelines: [
        {
          taskKey: 'silver_databricks_default',
          pipelineName: 'finops-databricks-focus-silver-pipeline',
          files: [
            {
              workspacePath: '/Workspace/Shared/finlake/data_sources/databricks/silver.sql',
              pipelineSql: 'CREATE VIEW a AS SELECT 1',
            },
          ],
          catalog: 'finops',
          schema: 'focus',
        },
        {
          taskKey: 'silver_aws_123456789012',
          pipelineName: 'finops-aws-123456789012-silver-pipeline',
          files: [
            {
              workspacePath: '/Workspace/Shared/finlake/data_sources/aws/silver.sql',
              pipelineSql: 'CREATE VIEW b AS SELECT 1',
            },
          ],
          catalog: 'finops',
          schema: 'focus',
        },
        {
          taskKey: 'gold_usage',
          pipelineName: 'finops-gold-aggregate-pipeline',
          files: [
            {
              workspacePath: '/Workspace/Shared/finlake/data_sources/shared/gold_usage.sql',
              pipelineSql: 'CREATE VIEW usage AS SELECT 1',
            },
          ],
          catalog: 'finops',
          schema: 'focus',
          dependsOn: ['silver_databricks_default', 'silver_aws_123456789012'],
        },
      ],
      cronExpression: '0 0 21 * * ?',
      timezoneId: 'UTC',
      servicePrincipalId: 'spn-1',
      environmentTag: 'test',
    },
    { jobId: null },
  );

  assert.equal(result.jobId, 123);
  assert.deepEqual(
    result.pipelines.map((pipeline) => pipeline.taskKey),
    ['silver_databricks_default', 'silver_aws_123456789012', 'gold_usage'],
  );
  assert.equal(imports.length, 3);
  assert.equal(createdPipelines.length, 3);
  assert.equal(createdJobs.length, 1);

  const job = createdJobs[0] as {
    tasks: Array<{ task_key: string; depends_on?: Array<{ task_key: string }> }>;
  };
  assert.deepEqual(
    job.tasks.map((task) => task.task_key),
    ['silver_databricks_default', 'silver_aws_123456789012', 'gold_usage'],
  );
  assert.equal(job.tasks[0]?.depends_on, undefined);
  assert.equal(job.tasks[1]?.depends_on, undefined);
  assert.deepEqual(job.tasks[2]?.depends_on, [
    { task_key: 'silver_databricks_default' },
    { task_key: 'silver_aws_123456789012' },
  ]);
});

test('upsertMultiPipelineSchedule replaces a saved pipeline id that no longer exists', async () => {
  const updates: unknown[] = [];
  const creates: unknown[] = [];
  const wc = {
    workspace: {
      mkdirs: async () => {},
      import: async () => {},
    },
    pipelines: {
      update: async (input: unknown) => {
        updates.push(input);
        const err = new Error('The specified pipeline deleted-pipeline was not found.');
        Object.assign(err, {
          errorCode: 'RESOURCE_DOES_NOT_EXIST',
          details: [{ reason: 'PIPELINE_NOT_FOUND', domain: 'deltapipelines.databricks.com' }],
        });
        throw err;
      },
      create: async (input: unknown) => {
        creates.push(input);
        return { pipeline_id: 'replacement-pipeline' };
      },
    },
    jobs: {
      create: async () => ({ job_id: 456 }),
    },
  };

  const result = await upsertMultiPipelineSchedule(
    wc as never,
    {
      jobName: 'finops-master-job',
      pipelines: [
        {
          taskKey: 'silver_databricks_default',
          pipelineName: 'finops-ingest-databricks-pipeline',
          files: [
            {
              workspacePath: '/Workspace/Shared/finlake/data_sources/databricks_default/silver.sql',
              pipelineSql: 'CREATE VIEW a AS SELECT 1',
            },
          ],
          catalog: 'finops',
          schema: 'focus',
          existingPipelineId: 'deleted-pipeline',
        },
      ],
      cronExpression: '0 0 21 * * ?',
      timezoneId: 'UTC',
    },
    { jobId: null },
  );

  assert.equal(updates.length, 1);
  assert.equal(creates.length, 1);
  assert.equal(result.pipelines[0]?.pipelineId, 'replacement-pipeline');
});

test('upsertMultiPipelineSchedule retries job creation while pipeline reference is not visible', async () => {
  let jobCreateAttempts = 0;
  const wc = {
    workspace: {
      mkdirs: async () => {},
      import: async () => {},
    },
    pipelines: {
      create: async () => ({ pipeline_id: 'new-pipeline' }),
    },
    jobs: {
      create: async () => {
        jobCreateAttempts += 1;
        if (jobCreateAttempts === 1) {
          const err = new Error('The specified pipeline new-pipeline was not found.');
          Object.assign(err, {
            errorCode: 'RESOURCE_DOES_NOT_EXIST',
            details: [{ reason: 'PIPELINE_NOT_FOUND', domain: 'deltapipelines.databricks.com' }],
          });
          throw err;
        }
        return { job_id: 789 };
      },
    },
  };

  const result = await upsertMultiPipelineSchedule(
    wc as never,
    {
      jobName: 'finops-master-job',
      pipelines: [
        {
          taskKey: 'silver_databricks_default',
          pipelineName: 'finops-ingest-databricks-pipeline',
          files: [
            {
              workspacePath: '/Workspace/Shared/finlake/data_sources/databricks_default/silver.sql',
              pipelineSql: 'CREATE VIEW a AS SELECT 1',
            },
          ],
          catalog: 'finops',
          schema: 'focus',
        },
      ],
      cronExpression: '0 0 21 * * ?',
      timezoneId: 'UTC',
    },
    { jobId: null },
  );

  assert.equal(result.jobId, 789);
  assert.equal(jobCreateAttempts, 2);
});

test('startPipelineUpdate starts a Lakeflow pipeline update directly', async () => {
  const requests: unknown[] = [];
  const wc = {
    apiClient: {
      request: async (input: unknown) => {
        requests.push(input);
        return { update_id: 'update-123', request_id: 'request-456' };
      },
    },
  };

  const result = await startPipelineUpdate(wc as never, 'pipeline-123');

  assert.deepEqual(result, {
    pipelineId: 'pipeline-123',
    updateId: 'update-123',
    requestId: 'request-456',
  });
  assert.equal(requests.length, 1);
  const request = requests[0] as {
    path: string;
    method: string;
    headers: Headers;
    raw: boolean;
    payload: unknown;
  };
  assert.equal(request.path, '/api/2.0/pipelines/pipeline-123/updates');
  assert.equal(request.method, 'POST');
  assert.equal(request.headers.get('Accept'), 'application/json');
  assert.equal(request.headers.get('Content-Type'), 'application/json');
  assert.equal(request.raw, false);
  assert.deepEqual(request.payload, { full_refresh: false });
});
