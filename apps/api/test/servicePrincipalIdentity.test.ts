import assert from 'node:assert/strict';
import test from 'node:test';
import { EnvSchema } from '@finlake/shared';
import {
  currentServicePrincipalOwnerAliases,
  requireAppWorkspaceClient,
} from '../src/services/servicePrincipalIdentity.js';
import { WorkspaceServiceError } from '../src/services/workspaceClientErrors.js';

test('currentServicePrincipalOwnerAliases includes the application id', async () => {
  const env = EnvSchema.parse({ DATABRICKS_CLIENT_ID: 'client-id-123' });
  const wc = {
    currentUser: {
      me: async () => ({
        id: 'scim-id-123',
        userName: 'app-user',
        displayName: 'FinLake App',
        externalId: 'external-id-123',
        applicationId: 'application-id-123',
      }),
    },
  };

  const aliases = await currentServicePrincipalOwnerAliases(wc as never, env);

  assert.ok(aliases.has('client-id-123'));
  assert.ok(aliases.has('application-id-123'));
});

test('requireAppWorkspaceClient defaults missing credentials to an internal error', () => {
  const env = EnvSchema.parse({});

  assert.throws(
    () => requireAppWorkspaceClient(env, WorkspaceServiceError),
    (err) => err instanceof WorkspaceServiceError && err.statusCode === 500,
  );
});

test('requireAppWorkspaceClient lets callers override the missing-credentials status', () => {
  const env = EnvSchema.parse({});

  assert.throws(
    () => requireAppWorkspaceClient(env, WorkspaceServiceError, 412),
    (err) => err instanceof WorkspaceServiceError && err.statusCode === 412,
  );
});
