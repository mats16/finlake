import assert from 'node:assert/strict';
import test from 'node:test';
import { EnvSchema } from '@finlake/shared';
import {
  PipelineRunPermissionError,
  assertAppServicePrincipalCanRunPipeline,
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
