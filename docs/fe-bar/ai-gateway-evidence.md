# FinLake FE Bar — Unity AI Gateway execution evidence

This document is the text-readable evidence checklist for the Support Copilot demo. Do not mark an item complete until its command has actually run. Never paste tokens, host credentials, customer prompts, or customer identifiers here.

## Current status

- Local implementation: complete (`npm test`, `npm run typecheck`, `npm run lint`, and `npm run build` passed on 2026-08-28)
- `fevm-mats-demo-tokyo` authentication: blocked; the local Databricks CLI currently reports the profile as invalid
- Live model calls, Lakeflow update, billing reconciliation, and Usage Dashboard: not yet executed

## 1. Synthetic business KPI journey

Run:

```sh
export DATABRICKS_HOST="https://fevm-mats-demo-tokyo.cloud.databricks.com"
export DATABRICKS_TOKEN="<redacted>"
npm run demo:business-kpi
```

Commit the scrubbed JSON output below after execution. It must show `demo: true`, 90 rows, the raw Volume path, target table, pipeline ID, and update ID.

```json
{
  "status": "NOT_RUN"
}
```

Validation query:

```sql
SELECT
  COUNT(*) AS row_count,
  MIN(date) AS start_date,
  MAX(date) AS end_date,
  MIN(team_id) AS team_id,
  BOOL_AND(is_demo) AS all_demo
FROM finops.analytics.business_kpi_daily;
```

## 2. Support Copilot model execution

Run:

```sh
npm run demo:ai-gateway
```

Commit the scrubbed JSON output below. It must show 20 successful requests, token totals when returned by the API, request tags, and one synthetic model output.

```json
{
  "status": "NOT_RUN"
}
```

Usage tracking query:

```sql
SELECT
  endpoint_name,
  COUNT(*) AS request_count,
  SUM(total_tokens) AS total_tokens,
  percentile(latency_ms, 0.95) AS p95_latency_ms,
  SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) AS error_count
FROM system.ai_gateway.usage
WHERE endpoint_name = 'finops.analytics.support_copilot'
  AND event_time >= current_timestamp() - INTERVAL 7 DAYS
GROUP BY endpoint_name;
```

## 3. Billing and FOCUS reconciliation

Bind the same UTC `:start_ts` (inclusive) and `:end_ts` (exclusive) values in both queries below. The source query mirrors the FOCUS price-window and account-price fallback logic.

```sql
WITH list_prices AS (
  SELECT COALESCE(price_end_time, date_add(current_date(), 1)) AS price_end, *
  FROM system.billing.list_prices
  WHERE currency_code = 'USD'
),
account_prices AS (
  SELECT COALESCE(price_end_time, date_add(current_date(), 1)) AS price_end, *
  FROM system.billing.account_prices
  WHERE currency_code = 'USD'
)
SELECT
  u.usage_metadata.ai_gateway.endpoint_name AS endpoint_name,
  SUM(
    u.usage_quantity * CAST(
      COALESCE(
        get_json_object(to_json(ap.pricing), '$.effective_list.default'),
        get_json_object(to_json(ap.pricing), '$.default'),
        get_json_object(to_json(lp.pricing), '$.effective_list.default'),
        get_json_object(to_json(lp.pricing), '$.default')
      ) AS DECIMAL(30, 15)
    )
  ) AS effective_cost_usd
FROM system.billing.usage u
LEFT JOIN list_prices lp
  ON u.account_id = lp.account_id
  AND u.sku_name = lp.sku_name
  AND u.usage_unit = lp.usage_unit
  AND u.usage_end_time BETWEEN lp.price_start_time AND lp.price_end
LEFT JOIN account_prices ap
  ON u.account_id = ap.account_id
  AND u.sku_name = ap.sku_name
  AND u.usage_unit = ap.usage_unit
  AND u.usage_end_time BETWEEN ap.price_start_time AND ap.price_end
WHERE u.billing_origin_product = 'MODEL_SERVING'
  AND u.usage_metadata.ai_gateway.endpoint_name = 'finops.analytics.support_copilot'
  AND u.usage_start_time >= :start_ts
  AND u.usage_start_time < :end_ts
GROUP BY endpoint_name;
```

FOCUS query:

```sql
SELECT
  ResourceName,
  ResourceType,
  ServiceCategory,
  SUM(EffectiveCost) AS effective_cost_usd
FROM finops.focus.databricks_usage
WHERE ResourceName = 'finops.analytics.support_copilot'
  AND BillingCurrency = 'USD'
  AND ChargePeriodStart >= :start_ts
  AND ChargePeriodStart < :end_ts
GROUP BY ResourceName, ResourceType, ServiceCategory;
```

Expected invariant: both queries use the same time window and return the same USD amount. `ResourceType` must be `AI Gateway Model Service`; `ServiceCategory` must be `AI and Machine Learning`.

## 4. AI Value output

Capture the Overview result as text after billing data is present:

```text
Status: NOT_RUN
AI Gateway spend: —
Share of cloud spend: —
AI cost per employee: —
AI cost per 1,000 tickets: —
Tickets per employee-day: —
```

The Unity AI Gateway built-in Usage Dashboard is the operational view for requests, tokens, latency, errors, and model-level costs. FinLake compares billed AI spend with cloud spend and synthetic team outcomes; it does not claim causality.
