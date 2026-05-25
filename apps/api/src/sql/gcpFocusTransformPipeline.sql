CREATE OR REFRESH MATERIALIZED VIEW ${table_name}
COMMENT 'Google Cloud detailed billing export transformed to FOCUS-compatible usage details. Managed by FinLake.'
AS
WITH source_rows AS (
  SELECT
    *,
    lower(COALESCE(cost_type, 'regular')) AS finlake_cost_type,
    CAST(
      COALESCE(
        aggregate(
          credits,
          CAST(0 AS DOUBLE),
          (acc, credit) -> acc + COALESCE(CAST(credit.amount AS DOUBLE), CAST(0 AS DOUBLE))
        ),
        CAST(0 AS DOUBLE)
      ) AS DECIMAL(30, 15)
    ) AS finlake_credit_amount,
    try_element_at(
      filter(
        COALESCE(credits, array()),
        credit ->
          credit.type IN (
            'COMMITTED_USAGE_DISCOUNT',
            'COMMITTED_USAGE_DISCOUNT_DOLLAR_BASE',
            'FEE_UTILIZATION_OFFSET'
          )
          OR lower(COALESCE(credit.full_name, credit.name, credit.id, '')) LIKE '%committed usage%'
      ),
      1
    ) AS finlake_commitment_credit,
    CAST(
      try_element_at(
        filter(
          COALESCE(system_labels, array()),
          label -> label.key = 'compute.googleapis.com/reservation_name'
        ),
        1
      ).value AS STRING
    ) AS finlake_reservation_name,
    CAST(
      try_element_at(
        filter(
          COALESCE(system_labels, array()),
          label -> label.key = 'compute.googleapis.com/reservation_project_id'
        ),
        1
      ).value AS STRING
    ) AS finlake_reservation_project_id,
    CAST(
      try_element_at(
        filter(
          COALESCE(system_labels, array()),
          label -> label.key = 'compute.googleapis.com/is_unused_reservation'
        ),
        1
      ).value AS STRING
    ) AS finlake_is_unused_reservation
  FROM ${source_fqn}
)
SELECT
  CAST(location.zone AS STRING) AS AvailabilityZone,
  CAST(COALESCE(cost, 0) + finlake_credit_amount AS DECIMAL(30, 15)) AS BilledCost,
  replace(CAST(billing_account_id AS STRING), '_', '-') AS BillingAccountId,
  replace(CAST(billing_account_id AS STRING), '_', '-') AS BillingAccountName,
  CAST(NULL AS STRING) AS BillingAccountType,
  CAST(currency AS STRING) AS BillingCurrency,
  to_utc_timestamp(
    add_months(to_timestamp(concat(invoice.month, '01'), 'yyyyMMdd'), 1),
    'America/Los_Angeles'
  ) AS BillingPeriodEnd,
  to_utc_timestamp(
    to_timestamp(concat(invoice.month, '01'), 'yyyyMMdd'),
    'America/Los_Angeles'
  ) AS BillingPeriodStart,
  CASE
    WHEN NULLIF(TRIM(finlake_reservation_name), '') IS NULL THEN CAST(NULL AS STRING)
    WHEN NULLIF(TRIM(finlake_reservation_project_id), '') IS NOT NULL
      THEN concat(finlake_reservation_project_id, '/', finlake_reservation_name)
    ELSE finlake_reservation_name
  END AS CapacityReservationId,
  CASE
    WHEN NULLIF(TRIM(finlake_reservation_name), '') IS NULL THEN CAST(NULL AS STRING)
    WHEN lower(COALESCE(finlake_is_unused_reservation, 'false')) = 'true'
      OR CAST(resource.global_name AS STRING) NOT LIKE '%/instances/%'
      THEN 'Unused'
    ELSE 'Used'
  END AS CapacityReservationStatus,
  CASE finlake_cost_type
    WHEN 'tax' THEN 'Tax'
    WHEN 'adjustment' THEN 'Adjustment'
    WHEN 'rounding_error' THEN 'Adjustment'
    ELSE 'Usage'
  END AS ChargeCategory,
  CASE
    WHEN COALESCE(
      adjustment_info.id,
      adjustment_info.description,
      adjustment_info.type,
      adjustment_info.mode
    ) IS NOT NULL THEN 'Correction'
    ELSE CAST(NULL AS STRING)
  END AS ChargeClass,
  CAST(sku.description AS STRING) AS ChargeDescription,
  CASE WHEN finlake_cost_type = 'regular' THEN 'Usage-Based' ELSE 'One-Time' END AS ChargeFrequency,
  CAST(usage_end_time AS TIMESTAMP) AS ChargePeriodEnd,
  CAST(usage_start_time AS TIMESTAMP) AS ChargePeriodStart,
  CASE
    WHEN COALESCE(
      NULLIF(CAST(subscription.instance_id AS STRING), ''),
      NULLIF(CAST(finlake_commitment_credit.id AS STRING), '')
    ) IS NULL THEN CAST(NULL AS STRING)
    WHEN finlake_commitment_credit.type IN ('COMMITTED_USAGE_DISCOUNT_DOLLAR_BASE', 'FEE_UTILIZATION_OFFSET')
      THEN 'Spend'
    ELSE 'Usage'
  END AS CommitmentDiscountCategory,
  COALESCE(
    NULLIF(CAST(subscription.instance_id AS STRING), ''),
    NULLIF(CAST(finlake_commitment_credit.id AS STRING), '')
  ) AS CommitmentDiscountId,
  COALESCE(
    NULLIF(CAST(finlake_commitment_credit.full_name AS STRING), ''),
    NULLIF(CAST(finlake_commitment_credit.name AS STRING), '')
  ) AS CommitmentDiscountName,
  CAST(NULL AS DECIMAL(30, 15)) AS CommitmentDiscountQuantity,
  CAST(NULL AS STRING) AS CommitmentDiscountStatus,
  CAST(finlake_commitment_credit.type AS STRING) AS CommitmentDiscountType,
  CAST(NULL AS STRING) AS CommitmentDiscountUnit,
  CAST(usage.amount AS DECIMAL(30, 15)) AS ConsumedQuantity,
  CAST(usage.unit AS STRING) AS ConsumedUnit,
  CAST(cost AS DECIMAL(30, 15)) AS ContractedCost,
  CASE
    WHEN finlake_cost_type = 'regular'
      THEN CAST(COALESCE(price.effective_price, price.effective_price_default) AS DECIMAL(30, 15))
    ELSE CAST(NULL AS DECIMAL(30, 15))
  END AS ContractedUnitPrice,
  CAST(COALESCE(cost, 0) + finlake_credit_amount AS DECIMAL(30, 15)) AS EffectiveCost,
  CAST(invoice.month AS STRING) AS InvoiceId,
  CAST(COALESCE(seller_name, 'Google Cloud') AS STRING) AS InvoiceIssuerName,
  CAST(COALESCE(cost_at_list_consumption_model, cost_at_list, cost) AS DECIMAL(30, 15)) AS ListCost,
  CASE
    WHEN finlake_cost_type = 'regular'
      THEN CAST(COALESCE(price.list_price_consumption_model, price.list_price) AS DECIMAL(30, 15))
    ELSE CAST(NULL AS DECIMAL(30, 15))
  END AS ListUnitPrice,
  CASE WHEN finlake_cost_type = 'regular' THEN 'Standard' ELSE CAST(NULL AS STRING) END AS PricingCategory,
  CAST(currency AS STRING) AS PricingCurrency,
  CASE
    WHEN finlake_cost_type = 'regular'
      THEN CAST(COALESCE(price.effective_price, price.effective_price_default) AS DECIMAL(30, 15))
    ELSE CAST(NULL AS DECIMAL(30, 15))
  END AS PricingCurrencyContractedUnitPrice,
  CAST(COALESCE(cost, 0) + finlake_credit_amount AS DECIMAL(30, 15)) AS PricingCurrencyEffectiveCost,
  CASE
    WHEN finlake_cost_type = 'regular'
      THEN CAST(COALESCE(price.list_price_consumption_model, price.list_price) AS DECIMAL(30, 15))
    ELSE CAST(NULL AS DECIMAL(30, 15))
  END AS PricingCurrencyListUnitPrice,
  CASE
    WHEN finlake_cost_type = 'regular'
      THEN CAST(usage.amount_in_pricing_units AS DECIMAL(30, 15))
    ELSE CAST(NULL AS DECIMAL(30, 15))
  END AS PricingQuantity,
  CASE
    WHEN finlake_cost_type = 'regular'
      THEN CAST(COALESCE(usage.pricing_unit, price.unit, usage.unit) AS STRING)
    ELSE CAST(NULL AS STRING)
  END AS PricingUnit,
  'Google Cloud' AS ProviderName,
  CAST(COALESCE(seller_name, 'Google Cloud') AS STRING) AS PublisherName,
  CAST(COALESCE(location.region, location.location) AS STRING) AS RegionId,
  CAST(location.location AS STRING) AS RegionName,
  CAST(COALESCE(resource.global_name, resource.name) AS STRING) AS ResourceId,
  CAST(COALESCE(resource.name, resource.global_name) AS STRING) AS ResourceName,
  CASE
    WHEN NULLIF(regexp_extract(CAST(resource.global_name AS STRING), '^//([^.]+)[.]googleapis[.]com/', 1), '') IS NOT NULL
      AND NULLIF(regexp_extract(CAST(resource.global_name AS STRING), '/([^/]+)/[^/]+$', 1), '') IS NOT NULL
      THEN concat(
        regexp_extract(CAST(resource.global_name AS STRING), '^//([^.]+)[.]googleapis[.]com/', 1),
        '.',
        regexp_extract(CAST(resource.global_name AS STRING), '/([^/]+)/[^/]+$', 1)
      )
    ELSE CAST(service.description AS STRING)
  END AS ResourceType,
  CASE CAST(service.description AS STRING)
    WHEN 'AlloyDB for PostgreSQL' THEN 'Databases'
    WHEN 'App Engine' THEN 'Compute'
    WHEN 'BigQuery' THEN 'Analytics'
    WHEN 'Bigtable' THEN 'Databases'
    WHEN 'Cloud Data Fusion' THEN 'Integration'
    WHEN 'Cloud Deploy' THEN 'Developer Tools'
    WHEN 'Cloud Run functions' THEN 'Compute'
    WHEN 'Cloud Logging' THEN 'Management and Governance'
    WHEN 'Cloud Run' THEN 'Compute'
    WHEN 'Cloud SQL' THEN 'Databases'
    WHEN 'Cloud Storage' THEN 'Storage'
    WHEN 'Compute Engine' THEN 'Compute'
    WHEN 'Dataflow' THEN 'Analytics'
    WHEN 'Managed Service for Apache Spark Metastore' THEN 'Databases'
    WHEN 'Firestore and Datastore' THEN 'Databases'
    WHEN 'Google Kubernetes Engine' THEN 'Compute'
    WHEN 'Managed Microsoft AD' THEN 'Security'
    WHEN 'Memorystore for Redis' THEN 'Databases'
    WHEN 'Pub/Sub' THEN 'Integration'
    WHEN 'Secret Manager' THEN 'Security'
    WHEN 'Spanner' THEN 'Databases'
    ELSE 'Other'
  END AS ServiceCategory,
  CAST(service.description AS STRING) AS ServiceName,
  CAST(NULL AS STRING) AS ServiceSubcategory,
  CASE WHEN finlake_cost_type = 'regular' THEN CAST(sku.id AS STRING) ELSE CAST(NULL AS STRING) END AS SkuId,
  CAST(usage.unit AS STRING) AS SkuMeter,
  map_from_entries(
    filter(
      array(
        named_struct('key', 'ServiceId', 'value', CAST(service.id AS STRING)),
        named_struct('key', 'ProjectNumber', 'value', CAST(project.number AS STRING)),
        named_struct('key', 'Location', 'value', CAST(location.location AS STRING)),
        named_struct('key', 'CostType', 'value', CAST(cost_type AS STRING)),
        named_struct('key', 'TransactionType', 'value', CAST(transaction_type AS STRING)),
        named_struct('key', 'InvoicePublisherType', 'value', CAST(invoice.publisher_type AS STRING)),
        named_struct('key', 'ConsumptionModelId', 'value', CAST(consumption_model.id AS STRING)),
        named_struct('key', 'ConsumptionModelDescription', 'value', CAST(consumption_model.description AS STRING)),
        named_struct('key', 'PriceTierStartAmount', 'value', CAST(price.tier_start_amount AS STRING)),
        named_struct('key', 'PriceUnitQuantity', 'value', CAST(price.pricing_unit_quantity AS STRING)),
        named_struct('key', 'CurrencyConversionRate', 'value', CAST(currency_conversion_rate AS STRING))
      ),
      kv -> kv.value IS NOT NULL
    )
  ) AS SkuPriceDetails,
  CASE
    WHEN finlake_cost_type = 'regular' AND sku.id IS NOT NULL THEN concat_ws(
      '|',
      concat('billing_account_id:', replace(CAST(billing_account_id AS STRING), '_', '-')),
      concat('sku_id:', CAST(sku.id AS STRING)),
      concat('tier_start:', COALESCE(CAST(price.tier_start_amount AS STRING), '0'))
    )
    ELSE CAST(NULL AS STRING)
  END AS SkuPriceId,
  CAST(project.id AS STRING) AS SubAccountId,
  CAST(project.name AS STRING) AS SubAccountName,
  'Project' AS SubAccountType,
  map_from_entries(
    filter(
      concat(
        COALESCE(
          transform(
            labels,
            label -> named_struct('key', CAST(label.key AS STRING), 'value', CAST(label.value AS STRING))
          ),
          array()
        ),
        COALESCE(
          transform(
            project.labels,
            label -> named_struct(
              'key',
              concat('project:', CAST(label.key AS STRING)),
              'value',
              CAST(label.value AS STRING)
            )
          ),
          array()
        ),
        COALESCE(
          transform(
            system_labels,
            label -> named_struct(
              'key',
              concat('system:', CAST(label.key AS STRING)),
              'value',
              CAST(label.value AS STRING)
            )
          ),
          array()
        ),
        COALESCE(
          transform(
            tags,
            tag -> named_struct(
              'key',
              concat(
                'tag:',
                COALESCE(CAST(tag.namespace AS STRING), 'global'),
                ':',
                CAST(tag.key AS STRING)
              ),
              'value',
              CAST(tag.value AS STRING)
            )
          ),
          array()
        )
      ),
      kv -> kv.key IS NOT NULL AND kv.value IS NOT NULL
    )
  ) AS Tags
FROM source_rows;
