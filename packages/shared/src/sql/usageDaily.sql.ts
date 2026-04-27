export const usageDailySql = /* sql */ `
SELECT
  date_format(date_trunc('day', u.usage_start_time), 'yyyy-MM-dd') AS usage_date,
  u.sku_name                                                       AS sku_name,
  u.workspace_id                                                   AS workspace_id,
  SUM(u.usage_quantity * lp.pricing.effective_list.default)        AS cost_usd
FROM system.billing.usage u
LEFT JOIN system.billing.list_prices lp
  ON  u.cloud    = lp.cloud
  AND u.sku_name = lp.sku_name
  AND u.usage_start_time >= lp.price_start_time
  AND (u.usage_end_time <= lp.price_end_time OR lp.price_end_time IS NULL)
WHERE u.usage_start_time >= :start_ts
  AND u.usage_start_time <  :end_ts
  AND (:workspace_id IS NULL OR u.workspace_id = :workspace_id)
GROUP BY 1, 2, 3
ORDER BY 1
`;
