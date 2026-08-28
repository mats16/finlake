const serviceName = 'finops.analytics.support_copilot';
const destinationModel = 'models/system.ai.databricks-gpt-5';
const destinationType = 'DESTINATION_TYPE_PAY_PER_TOKEN_FOUNDATION_MODEL';
const servicePath = `/api/2.1/unity-catalog/model-services/${encodeURIComponent(serviceName)}`;
const tickets = [
  'After enabling SSO, invited users see an access denied page even though they belong to the correct group.',
  'Our monthly invoice is higher than expected after adding five seats. Explain the proration.',
  'CSV export stays in processing for more than two hours for a 50 MB report.',
  'The API returns 429 during the morning batch although our documented limit should be sufficient.',
  'A dashboard shared with the finance group opens but all charts are empty.',
  'Please help us rotate an API token without interrupting the nightly integration.',
  'Email notifications arrive twice for every workflow failure.',
  'The audit log is missing sign-in events from one workspace.',
  'Our sandbox was deleted and we need to know whether its configuration can be recovered.',
  'A user changed teams but still sees data owned by the previous cost center.',
  'The mobile app repeatedly asks users to sign in after the latest update.',
  'Webhook signature validation started failing after we changed the endpoint URL.',
  'We need a list of supported regions before moving production data.',
  'The usage report total does not match the amount displayed on the billing page.',
  'A scheduled report runs successfully but no attachment is included in the email.',
  'Search results omit records created earlier today.',
  'An administrator cannot transfer ownership of a dashboard to a service account.',
  'The integration test connection succeeds, but the first sync imports zero rows.',
  'Users receive a generic error when uploading files with Japanese filenames.',
  'We need guidance for reducing response latency for users in Australia.',
];

if (process.argv.includes('--dry-run')) {
  process.stdout.write(
    `${JSON.stringify({ modelService: serviceName, destinationModel, requestCount: tickets.length }, null, 2)}\n`,
  );
  process.exit(0);
}

const host = workspaceOrigin(requiredEnv('DATABRICKS_HOST'));
const token = requiredEnv('DATABRICKS_TOKEN');

let service = await api(servicePath, { allow: [404] });
if (service.status === 404) {
  const query = new URLSearchParams({
    parent: 'schemas/finops.analytics',
    model_service_id: 'support_copilot',
  });
  service = await api(`/api/2.1/unity-catalog/model-services?${query}`, {
    method: 'POST',
    body: {
      model_service: {
        comment: 'Synthetic Support Copilot for the FinLake FE Bar demo',
        config: {
          routing: {
            destinations: [
              {
                name: 'primary',
                destination_type: destinationType,
                pay_per_token_config: { model: destinationModel },
                traffic_percentage: 100,
              },
            ],
          },
        },
      },
    },
  });
}
assertExpectedServiceConfig(service);

const requestTags = {
  team: 'support',
  cost_center: 'cx',
  product: 'support-copilot',
  environment: 'demo',
};
const requestTagsHeader = JSON.stringify(requestTags);
const results = [];
for (const ticket of tickets) {
  const response = await api('/ai-gateway/mlflow/v1/chat/completions', {
    method: 'POST',
    headers: { 'Databricks-Ai-Gateway-Request-Tags': requestTagsHeader },
    body: {
      model: serviceName,
      max_tokens: 256,
      temperature: 0,
      messages: [
        {
          role: 'system',
          content:
            'Return compact JSON with keys summary, category, priority, and suggested_reply. The ticket is synthetic demo data.',
        },
        { role: 'user', content: ticket },
      ],
    },
  });
  const content = response.choices?.[0]?.message?.content;
  results.push({
    content: validateModelOutput(content),
    inputTokens: response.usage?.prompt_tokens ?? null,
    outputTokens: response.usage?.completion_tokens ?? null,
  });
}

process.stdout.write(
  `${JSON.stringify(
    {
      modelService: serviceName,
      destinationModel,
      requestCount: tickets.length,
      succeeded: results.length,
      inputTokens: sumKnown(results, 'inputTokens'),
      outputTokens: sumKnown(results, 'outputTokens'),
      sampleOutput: results[0]?.content ?? null,
      requestTags,
    },
    null,
    2,
  )}\n`,
);

function sumKnown(items, key) {
  const values = items.map((item) => item[key]).filter((value) => Number.isFinite(value));
  return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
}

function assertExpectedServiceConfig(service) {
  const config = service.config ?? {};
  const routing = config.routing ?? {};
  const destinations = routing.destinations ?? [];
  const primary = destinations.find((item) => item.name === 'primary');
  const differs =
    destinations.length !== 1 ||
    primary?.destination_type !== destinationType ||
    primary?.traffic_percentage !== 100 ||
    primary?.pay_per_token_config?.model !== destinationModel ||
    hasConfig(primary?.external_model_config) ||
    hasConfig(primary?.provisioned_throughput_config) ||
    hasConfig(routing.fallback) ||
    (config.rate_limits?.length ?? 0) > 0 ||
    hasConfig(config.inference_table) ||
    hasConfig(config.guardrails) ||
    hasConfig(service.guardrails);
  if (differs) {
    throw new Error(
      `${serviceName} exists with a different configuration; refusing to overwrite it`,
    );
  }
}

function hasConfig(value) {
  return value !== null && typeof value === 'object' && Object.keys(value).length > 0;
}

function validateModelOutput(content) {
  if (typeof content !== 'string') throw new Error('Model response is missing assistant content');
  let output;
  try {
    output = JSON.parse(content);
  } catch {
    throw new Error('Model response is not valid JSON');
  }
  for (const key of ['summary', 'category', 'priority', 'suggested_reply']) {
    if (typeof output[key] !== 'string' || !output[key].trim()) {
      throw new Error(`Model response is missing a non-empty ${key}`);
    }
  }
  return content;
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers);
  headers.set('Authorization', `Bearer ${token}`);
  if (options.body !== undefined) headers.set('Content-Type', 'application/json');
  const response = await fetch(`${host}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: AbortSignal.timeout(options.timeoutMs ?? 120_000),
  });
  if (options.allow?.includes(response.status)) {
    if (response.status === 404) return { status: 404 };
  }
  if (!response.ok)
    throw new Error(
      `${options.method ?? 'GET'} ${path}: ${response.status} ${await response.text()}`,
    );
  const text = await response.text();
  return text ? JSON.parse(text) : {};
}

function workspaceOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error('DATABRICKS_HOST must be a valid HTTPS workspace URL');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error(
      'DATABRICKS_HOST must be an HTTPS origin without credentials, path, query, or hash',
    );
  }
  return url.origin;
}

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}
