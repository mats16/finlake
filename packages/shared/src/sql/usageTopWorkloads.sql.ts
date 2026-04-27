export const usageTopWorkloadsSql = /* sql */ `
SELECT
  CASE
    WHEN u.usage_metadata.job_id       IS NOT NULL THEN 'JOB'
    WHEN u.usage_metadata.warehouse_id IS NOT NULL THEN 'WAREHOUSE'
    WHEN u.usage_metadata.cluster_id   IS NOT NULL THEN 'CLUSTER'
    WHEN u.usage_metadata.dlt_pipeline_id IS NOT NULL THEN 'PIPELINE'
    ELSE 'OTHER'
  END AS workload_type,
  COALESCE(
    u.usage_metadata.job_id,
    u.usage_metadata.warehouse_id,
    u.usage_metadata.cluster_id,
    u.usage_metadata.dlt_pipeline_id
  )                                                         AS workload_id,
  CAST(NULL AS STRING)                                      AS workload_name,
  SUM(u.usage_quantity * lp.pricing.effective_list.default) AS cost_usd
FROM system.billing.usage u
LEFT JOIN system.billing.list_prices lp
  ON  u.cloud    = lp.cloud
  AND u.sku_name = lp.sku_name
  AND u.usage_start_time >= lp.price_start_time
  AND (u.usage_end_time <= lp.price_end_time OR lp.price_end_time IS NULL)
WHERE u.usage_start_time >= :start_ts
  AND u.usage_start_time <  :end_ts
  AND (:workspace_id IS NULL OR u.workspace_id = :workspace_id)
GROUP BY 1, 2
ORDER BY cost_usd DESC
LIMIT 20
`;
