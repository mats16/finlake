CREATE OR REFRESH MATERIALIZED VIEW ${table_name}
COMMENT 'Snowflake organization usage in currency transformed to FOCUS-compatible usage details. Managed by FinLake.'
AS
WITH source_rows AS (
  SELECT
    *,
    CASE lower(CAST(`RATING_TYPE` AS STRING))
      WHEN 'compute' THEN 'credits'
      WHEN 'data_transfer' THEN 'terabytes'
      WHEN 'storage' THEN 'terabytes'
      ELSE CAST(`RATING_TYPE` AS STRING)
    END AS finlake_usage_unit,
    CASE
      WHEN CAST(`USAGE` AS DECIMAL(30, 15)) IS NOT NULL
        AND CAST(`USAGE` AS DECIMAL(30, 15)) != CAST(0 AS DECIMAL(30, 15))
        THEN CAST(`USAGE_IN_CURRENCY` AS DECIMAL(30, 15)) / CAST(`USAGE` AS DECIMAL(30, 15))
      ELSE CAST(NULL AS DECIMAL(30, 15))
    END AS finlake_unit_price,
    to_utc_timestamp(CAST(`USAGE_DATE` AS TIMESTAMP), 'UTC') AS finlake_usage_period_start,
    to_utc_timestamp(CAST(date_add(CAST(`USAGE_DATE` AS DATE), 1) AS TIMESTAMP), 'UTC') AS finlake_usage_period_end
  FROM ${source_fqn}
)
SELECT
  CAST(NULL AS STRING) AS AvailabilityZone,
  CAST(`USAGE_IN_CURRENCY` AS DECIMAL(30, 15)) AS BilledCost,
  CAST(`ORGANIZATION_NAME` AS STRING) AS BillingAccountId,
  CAST(`ORGANIZATION_NAME` AS STRING) AS BillingAccountName,
  'Organization' AS BillingAccountType,
  CAST(`CURRENCY` AS STRING) AS BillingCurrency,
  CAST(add_months(DATE_TRUNC('MONTH', finlake_usage_period_start), 1) AS TIMESTAMP) AS BillingPeriodEnd,
  CAST(DATE_TRUNC('MONTH', finlake_usage_period_start) AS TIMESTAMP) AS BillingPeriodStart,
  CAST(NULL AS STRING) AS CapacityReservationId,
  CAST(NULL AS STRING) AS CapacityReservationStatus,
  CASE
    WHEN COALESCE(CAST(`IS_ADJUSTMENT` AS BOOLEAN), false) THEN 'Adjustment'
    WHEN CAST(`USAGE_IN_CURRENCY` AS DECIMAL(30, 15)) < CAST(0 AS DECIMAL(30, 15))
      OR lower(CAST(`BILLING_TYPE` AS STRING)) IN ('rebate', 'support_credit')
      OR lower(CAST(`BALANCE_SOURCE` AS STRING)) IN ('free usage', 'rebate')
      THEN 'Credit'
    ELSE 'Usage'
  END AS ChargeCategory,
  CASE
    WHEN COALESCE(CAST(`IS_ADJUSTMENT` AS BOOLEAN), false) THEN 'Correction'
    ELSE CAST(NULL AS STRING)
  END AS ChargeClass,
  CAST(COALESCE(`USAGE_TYPE`, `SERVICE_TYPE`, `BILLING_TYPE`) AS STRING) AS ChargeDescription,
  CASE
    WHEN lower(CAST(`BILLING_TYPE` AS STRING)) = 'consumption' THEN 'Usage-Based'
    WHEN lower(CAST(`BILLING_TYPE` AS STRING)) IN ('capacity', 'reserved_capacity', 'pro_rated_capacity') THEN 'Recurring'
    ELSE 'One-Time'
  END AS ChargeFrequency,
  CAST(finlake_usage_period_end AS TIMESTAMP) AS ChargePeriodEnd,
  CAST(finlake_usage_period_start AS TIMESTAMP) AS ChargePeriodStart,
  CAST(NULL AS STRING) AS CommitmentDiscountCategory,
  CAST(NULL AS STRING) AS CommitmentDiscountId,
  CAST(NULL AS STRING) AS CommitmentDiscountName,
  CAST(NULL AS DECIMAL(30, 15)) AS CommitmentDiscountQuantity,
  CAST(NULL AS STRING) AS CommitmentDiscountStatus,
  CAST(NULL AS STRING) AS CommitmentDiscountType,
  CAST(NULL AS STRING) AS CommitmentDiscountUnit,
  CAST(`USAGE` AS DECIMAL(30, 15)) AS ConsumedQuantity,
  CAST(finlake_usage_unit AS STRING) AS ConsumedUnit,
  CAST(`USAGE_IN_CURRENCY` AS DECIMAL(30, 15)) AS ContractedCost,
  CAST(finlake_unit_price AS DECIMAL(30, 15)) AS ContractedUnitPrice,
  CAST(`USAGE_IN_CURRENCY` AS DECIMAL(30, 15)) AS EffectiveCost,
  CAST(date_format(CAST(`USAGE_DATE` AS DATE), 'yyyy-MM') AS STRING) AS InvoiceId,
  'Snowflake' AS InvoiceIssuerName,
  CAST(`USAGE_IN_CURRENCY` AS DECIMAL(30, 15)) AS ListCost,
  CAST(finlake_unit_price AS DECIMAL(30, 15)) AS ListUnitPrice,
  CAST(COALESCE(`BILLING_TYPE`, `RATING_TYPE`) AS STRING) AS PricingCategory,
  CAST(`CURRENCY` AS STRING) AS PricingCurrency,
  CAST(finlake_unit_price AS DECIMAL(30, 15)) AS PricingCurrencyContractedUnitPrice,
  CAST(`USAGE_IN_CURRENCY` AS DECIMAL(30, 15)) AS PricingCurrencyEffectiveCost,
  CAST(finlake_unit_price AS DECIMAL(30, 15)) AS PricingCurrencyListUnitPrice,
  CAST(`USAGE` AS DECIMAL(30, 15)) AS PricingQuantity,
  CAST(finlake_usage_unit AS STRING) AS PricingUnit,
  'Snowflake' AS ProviderName,
  'Snowflake' AS PublisherName,
  CAST(`REGION` AS STRING) AS RegionId,
  CAST(`REGION` AS STRING) AS RegionName,
  concat_ws('|', CAST(`ACCOUNT_LOCATOR` AS STRING), CAST(`SERVICE_TYPE` AS STRING)) AS ResourceId,
  CAST(`SERVICE_TYPE` AS STRING) AS ResourceName,
  CAST(`SERVICE_TYPE` AS STRING) AS ResourceType,
  CASE lower(CAST(`RATING_TYPE` AS STRING))
    WHEN 'compute' THEN 'Compute'
    WHEN 'storage' THEN 'Storage'
    WHEN 'data_transfer' THEN 'Network'
    ELSE 'Other'
  END AS ServiceCategory,
  CAST(`SERVICE_TYPE` AS STRING) AS ServiceName,
  CAST(`RATING_TYPE` AS STRING) AS ServiceSubcategory,
  CAST(`SERVICE_TYPE` AS STRING) AS SkuId,
  CAST(finlake_usage_unit AS STRING) AS SkuMeter,
  CAST(
    map_from_entries(
      filter(
        array(
          named_struct('key', 'UsageType', 'value', CAST(`USAGE_TYPE` AS STRING)),
          named_struct('key', 'BillingType', 'value', CAST(`BILLING_TYPE` AS STRING)),
          named_struct('key', 'RatingType', 'value', CAST(`RATING_TYPE` AS STRING)),
          named_struct('key', 'BalanceSource', 'value', CAST(`BALANCE_SOURCE` AS STRING)),
          named_struct('key', 'ServiceLevel', 'value', CAST(`SERVICE_LEVEL` AS STRING)),
          named_struct('key', 'IsAdjustment', 'value', CAST(`IS_ADJUSTMENT` AS STRING)),
          named_struct('key', 'ContractNumber', 'value', CAST(`CONTRACT_NUMBER` AS STRING)),
          named_struct('key', 'OrganizationName', 'value', CAST(`ORGANIZATION_NAME` AS STRING)),
          named_struct('key', 'AccountLocator', 'value', CAST(`ACCOUNT_LOCATOR` AS STRING))
        ),
        kv -> kv.value IS NOT NULL
      )
    ) AS MAP<STRING, STRING>
  ) AS SkuPriceDetails,
  concat_ws(
    '|',
    concat('organization:', COALESCE(CAST(`ORGANIZATION_NAME` AS STRING), '')),
    concat('contract:', CAST(COALESCE(`CONTRACT_NUMBER`, '') AS STRING)),
    concat('account:', COALESCE(CAST(`ACCOUNT_LOCATOR` AS STRING), '')),
    concat('service:', COALESCE(CAST(`SERVICE_TYPE` AS STRING), '')),
    concat('rating:', COALESCE(CAST(`RATING_TYPE` AS STRING), '')),
    concat('billing:', COALESCE(CAST(`BILLING_TYPE` AS STRING), ''))
  ) AS SkuPriceId,
  CAST(`ACCOUNT_LOCATOR` AS STRING) AS SubAccountId,
  CAST(`ACCOUNT_NAME` AS STRING) AS SubAccountName,
  'Snowflake Account' AS SubAccountType,
  CAST(map_from_arrays(array(), array()) AS MAP<STRING, STRING>) AS Tags
FROM source_rows;
