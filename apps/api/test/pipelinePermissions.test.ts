import assert from 'node:assert/strict';
import test from 'node:test';
import { EnvSchema } from '@finlake/shared';
import {
  PipelineRunPermissionError,
  assertAppServicePrincipalCanRunPipeline,
  createAppServicePrincipalPipelineRunAsserter,
} from '../src/services/pipelinePermissions.js';

test('assertAppServicePrincipalCanRunPipeline accepts CAN_RUN for the app service principal', async () => {
  const requests: unknown[] = [];
  const env = EnvSchema.parse({ DATABRICKS_CLIENT_ID: 'app-client-id' });
  const wc = {
    currentUser: {
      me: async () => ({ id: 'sp-id', userName: 'app-client-id', displayName: 'FinLake App' }),
    },
    apiClient: {
      request: async (input: unknown) => {
        requests.push(input);
        return {
          access_control_list: [
            {
              service_principal_name: 'APP-CLIENT-ID',
              all_permissions: [{ permission_level: 'CAN_RUN' }],
            },
          ],
        };
      },
    },
  };

  await assertAppServicePrincipalCanRunPipeline(env, 'pipeline-123', wc as never);

  assert.equal(requests.length, 1);
  const request = requests[0] as { path: string; method: string; headers: Headers; raw: boolean };
  assert.equal(request.path, '/api/2.0/permissions/pipelines/pipeline-123');
  assert.equal(request.method, 'GET');
  assert.equal(request.headers.get('Accept'), 'application/json');
  assert.equal(request.raw, false);
});

test('assertAppServicePrincipalCanRunPipeline accepts CAN_MANAGE from a current principal group', async () => {
  const env = EnvSchema.parse({ DATABRICKS_CLIENT_ID: 'app-client-id' });
  const wc = {
    currentUser: {
      me: async () => ({
        id: 'sp-id',
        userName: 'app-client-id',
        groups: [{ display: 'finlake-runners', value: 'group-id-1' }],
      }),
    },
    apiClient: {
      request: async () => ({
        access_control_list: [
          {
            group_name: 'FINLAKE-RUNNERS',
            all_permissions: [{ permission_level: 'CAN_MANAGE' }],
          },
        ],
      }),
    },
  };

  await assertAppServicePrincipalCanRunPipeline(env, 'pipeline-123', wc as never);
});

test('assertAppServicePrincipalCanRunPipeline does not match group SCIM value', async () => {
  const env = EnvSchema.parse({ DATABRICKS_CLIENT_ID: 'app-client-id' });
  const wc = {
    currentUser: {
      me: async () => ({
        userName: 'app-client-id',
        groups: [{ display: 'finlake-runners', value: 'group-id-1' }],
      }),
    },
    apiClient: {
      request: async () => ({
        access_control_list: [
          {
            group_name: 'group-id-1',
            all_permissions: [{ permission_level: 'CAN_MANAGE' }],
          },
        ],
      }),
    },
  };

  await assert.rejects(
    () => assertAppServicePrincipalCanRunPipeline(env, 'pipeline-123', wc as never),
    (err) => err instanceof PipelineRunPermissionError && err.statusCode === 403,
  );
});

test('assertAppServicePrincipalCanRunPipeline keeps principal types separate', async () => {
  const env = EnvSchema.parse({ DATABRICKS_CLIENT_ID: 'app-client-id' });
  const wc = {
    currentUser: {
      me: async () => ({
        id: 'scim-id-123',
        userName: 'sp-user-name',
        displayName: 'Friendly App Name',
        externalId: 'external-id-123',
        applicationId: 'application-id-123',
        groups: [{ display: 'billing-admins', value: 'group-id-1' }],
      }),
    },
    apiClient: {
      request: async () => ({
        access_control_list: [
          {
            user_name: 'billing-admins',
            all_permissions: [{ permission_level: 'CAN_RUN' }],
          },
          {
            user_name: 'application-id-123',
            all_permissions: [{ permission_level: 'CAN_RUN' }],
          },
          {
            group_name: 'application-id-123',
            all_permissions: [{ permission_level: 'CAN_RUN' }],
          },
          {
            service_principal_name: 'scim-id-123',
            all_permissions: [{ permission_level: 'CAN_RUN' }],
          },
        ],
      }),
    },
  };

  await assert.rejects(
    () => assertAppServicePrincipalCanRunPipeline(env, 'pipeline-123', wc as never),
    (err) => err instanceof PipelineRunPermissionError && err.statusCode === 403,
  );
});

test('assertAppServicePrincipalCanRunPipeline accepts applicationId as service principal ACL name', async () => {
  const env = EnvSchema.parse({ DATABRICKS_CLIENT_ID: 'app-client-id' });
  const wc = {
    currentUser: {
      me: async () => ({ userName: 'sp-user-name', applicationId: 'application-id-123' }),
    },
    apiClient: {
      request: async () => ({
        access_control_list: [
          {
            service_principal_name: 'APPLICATION-ID-123',
            all_permissions: [{ permission_level: 'IS_OWNER' }],
          },
        ],
      }),
    },
  };

  await assertAppServicePrincipalCanRunPipeline(env, 'pipeline-123', wc as never);
});

test('assertAppServicePrincipalCanRunPipeline ignores top-level permission_level', async () => {
  const env = EnvSchema.parse({ DATABRICKS_CLIENT_ID: 'app-client-id' });
  const wc = {
    currentUser: {
      me: async () => ({ userName: 'app-client-id' }),
    },
    apiClient: {
      request: async () => ({
        access_control_list: [
          {
            user_name: 'app-client-id',
            permission_level: 'CAN_RUN',
          },
        ],
      }),
    },
  };

  await assert.rejects(
    () => assertAppServicePrincipalCanRunPipeline(env, 'pipeline-123', wc as never),
    (err) => err instanceof PipelineRunPermissionError && err.statusCode === 403,
  );
});

test('assertAppServicePrincipalCanRunPipeline rejects when the app service principal lacks run permission', async () => {
  const env = EnvSchema.parse({ DATABRICKS_CLIENT_ID: 'app-client-id' });
  const wc = {
    currentUser: {
      me: async () => ({ id: 'sp-id', userName: 'app-client-id' }),
    },
    apiClient: {
      request: async () => ({
        access_control_list: [
          {
            service_principal_name: 'app-client-id',
            all_permissions: [{ permission_level: 'CAN_VIEW' }],
          },
        ],
      }),
    },
  };

  await assert.rejects(
    () => assertAppServicePrincipalCanRunPipeline(env, 'pipeline-123', wc as never),
    (err) =>
      err instanceof PipelineRunPermissionError &&
      err.statusCode === 403 &&
      /needs CAN_RUN, CAN_MANAGE, or IS_OWNER/.test(err.message),
  );
});

test('assertAppServicePrincipalCanRunPipeline reports missing app credentials as precondition failure', async () => {
  const env = EnvSchema.parse({});

  await assert.rejects(
    () => assertAppServicePrincipalCanRunPipeline(env, 'pipeline-123'),
    (err) =>
      err instanceof PipelineRunPermissionError &&
      err.statusCode === 412 &&
      /credentials not configured/.test(err.message),
  );
});

test('assertAppServicePrincipalCanRunPipeline maps permission read failures by cause', async () => {
  const env = EnvSchema.parse({ DATABRICKS_CLIENT_ID: 'app-client-id' });
  const baseClient = (err: unknown) => ({
    currentUser: {
      me: async () => ({ userName: 'app-client-id' }),
    },
    apiClient: {
      request: async () => {
        throw err;
      },
    },
  });

  await assert.rejects(
    () =>
      assertAppServicePrincipalCanRunPipeline(
        env,
        'missing-pipeline',
        baseClient({ errorCode: 'RESOURCE_DOES_NOT_EXIST', message: 'missing' }) as never,
      ),
    (err) =>
      err instanceof PipelineRunPermissionError &&
      err.statusCode === 404 &&
      /not found/.test(err.message),
  );

  await assert.rejects(
    () =>
      assertAppServicePrincipalCanRunPipeline(
        env,
        'denied-pipeline',
        baseClient({ errorCode: 'PERMISSION_DENIED', message: 'denied' }) as never,
      ),
    (err) => err instanceof PipelineRunPermissionError && err.statusCode === 403,
  );

  await assert.rejects(
    () =>
      assertAppServicePrincipalCanRunPipeline(
        env,
        'broken-pipeline',
        baseClient(new Error('network failed')) as never,
      ),
    (err) => err instanceof PipelineRunPermissionError && err.statusCode === 502,
  );

  await assert.rejects(
    () =>
      assertAppServicePrincipalCanRunPipeline(
        env,
        'ambiguous-message',
        baseClient(new Error('404 page not found while reading proxy response')) as never,
      ),
    (err) => err instanceof PipelineRunPermissionError && err.statusCode === 502,
  );
});

test('createAppServicePrincipalPipelineRunAsserter retries identity lookup after a rejection', async () => {
  const env = EnvSchema.parse({});
  let identityCalls = 0;
  let permissionCalls = 0;
  const wc = {
    currentUser: {
      me: async () => {
        identityCalls += 1;
        if (identityCalls === 1) {
          throw new Error('transient current user failure');
        }
        return { applicationId: 'application-id-123' };
      },
    },
    apiClient: {
      request: async () => {
        permissionCalls += 1;
        return {
          access_control_list: [
            {
              service_principal_name: 'application-id-123',
              all_permissions: [{ permission_level: 'CAN_RUN' }],
            },
          ],
        };
      },
    },
  };
  const assertCanRun = createAppServicePrincipalPipelineRunAsserter(env, {
    workspaceClientFactory: () => wc as never,
  });

  await assert.rejects(
    () => assertCanRun('pipeline-123'),
    (err) => err instanceof PipelineRunPermissionError && err.statusCode === 502,
  );
  await assertCanRun('pipeline-123');

  assert.equal(identityCalls, 2);
  assert.equal(permissionCalls, 1);
});

test('createAppServicePrincipalPipelineRunAsserter refreshes cached identity after the ttl', async () => {
  const env = EnvSchema.parse({});
  let now = 0;
  let factoryCalls = 0;
  let identityCalls = 0;
  const assertCanRun = createAppServicePrincipalPipelineRunAsserter(env, {
    cacheTtlMs: 10,
    now: () => now,
    workspaceClientFactory: () => {
      factoryCalls += 1;
      const applicationId = `application-id-${factoryCalls}`;
      return {
        currentUser: {
          me: async () => {
            identityCalls += 1;
            return { applicationId };
          },
        },
        apiClient: {
          request: async () => ({
            access_control_list: [
              {
                service_principal_name: applicationId,
                all_permissions: [{ permission_level: 'CAN_RUN' }],
              },
            ],
          }),
        },
      } as never;
    },
  });

  await assertCanRun('pipeline-123');
  now = 9;
  await assertCanRun('pipeline-123');
  now = 10;
  await assertCanRun('pipeline-123');

  assert.equal(factoryCalls, 2);
  assert.equal(identityCalls, 2);
});
