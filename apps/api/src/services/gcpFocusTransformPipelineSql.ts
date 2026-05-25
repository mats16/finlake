import { IDENT_RE, quoteIdent } from '@finlake/shared';

const GCP_DETAILED_EXPORT_PREFIX = 'gcp_billing_export_resource_v1_';

export function isGcpDetailedBillingExportTable(tableName: string): boolean {
  return tableName.trim().startsWith(GCP_DETAILED_EXPORT_PREFIX);
}

export function gcpBillingAccountIdFromTableName(tableName: string): string {
  const trimmed = tableName.trim();
  return trimmed.startsWith(GCP_DETAILED_EXPORT_PREFIX)
    ? trimmed.slice(GCP_DETAILED_EXPORT_PREFIX.length)
    : trimmed;
}

export function gcpUsageTableName(accountId: string): string {
  const suffix = accountId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!suffix) return 'gcp_usage';
  return `gcp_${suffix}_usage`;
}

export function buildGcpFocusSilverPipelineSql(opts: {
  tableName: string;
  sourceCatalog: string;
  sourceSchema: string;
  sourceTable: string;
}): string {
  if (!IDENT_RE.test(opts.tableName)) {
    throw new Error(`Invalid table identifier "${opts.tableName}"`);
  }
  if (!isGcpDetailedBillingExportTable(opts.sourceTable)) {
    throw new Error(
      `Google Cloud source table must be the resource-level detailed export table matching ${GCP_DETAILED_EXPORT_PREFIX}<BILLING_ACCOUNT_ID>`,
    );
  }
  return gcpSilverSql({
    tableName: quoteIdent(opts.tableName),
    sourceFqn: quotePossiblyQualified([opts.sourceCatalog, opts.sourceSchema, opts.sourceTable]),
  });
}

function quotePossiblyQualified(parts: string[]): string {
  return parts.map(quoteBacktickEscaped).join('.');
}

function quoteBacktickEscaped(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error('Source table identifier parts must not be empty.');
  return `\`${trimmed.replace(/`/g, '``')}\``;
}

function gcpSilverSql({ tableName, sourceFqn }: { tableName: string; sourceFqn: string }): string {
  return /* sql */ `CREATE OR REFRESH MATERIALIZED VIEW ${tableName}
COMMENT 'Google Cloud detailed billing export transformed to FOCUS-compatible usage details. Managed by FinLake.'
AS
WITH source_rows AS (
  SELECT
    *,
    CAST(
      COALESCE(
        aggregate(
          credits,
          CAST(0 AS DOUBLE),
          (acc, credit) -> acc + COALESCE(CAST(credit.amount AS DOUBLE), CAST(0 AS DOUBLE))
        ),
        CAST(0 AS DOUBLE)
      ) AS DECIMAL(30, 15)
    ) AS finlake_credit_amount
  FROM ${sourceFqn}
)
SELECT
  CAST(location.zone AS STRING) AS AvailabilityZone,
  CAST(COALESCE(cost, 0) + finlake_credit_amount AS DECIMAL(30, 15)) AS BilledCost,
  CAST(billing_account_id AS STRING) AS BillingAccountId,
  CAST(billing_account_id AS STRING) AS BillingAccountName,
  CAST(NULL AS STRING) AS BillingAccountType,
  CAST(currency AS STRING) AS BillingCurrency,
  to_timestamp(concat(invoice.month, '01'), 'yyyyMMdd') + INTERVAL 1 MONTH AS BillingPeriodEnd,
  to_timestamp(concat(invoice.month, '01'), 'yyyyMMdd') AS BillingPeriodStart,
  CAST(NULL AS STRING) AS CapacityReservationId,
  CAST(NULL AS STRING) AS CapacityReservationStatus,
  CASE lower(COALESCE(cost_type, 'regular'))
    WHEN 'tax' THEN 'Tax'
    WHEN 'adjustment' THEN 'Adjustment'
    WHEN 'rounding_error' THEN 'Rounding Error'
    ELSE 'Usage'
  END AS ChargeCategory,
  CAST(adjustment_info.type AS STRING) AS ChargeClass,
  CAST(sku.description AS STRING) AS ChargeDescription,
  'Usage-Based' AS ChargeFrequency,
  CAST(usage_end_time AS TIMESTAMP) AS ChargePeriodEnd,
  CAST(usage_start_time AS TIMESTAMP) AS ChargePeriodStart,
  CAST(NULL AS STRING) AS CommitmentDiscountCategory,
  CAST(NULL AS STRING) AS CommitmentDiscountId,
  CAST(NULL AS STRING) AS CommitmentDiscountName,
  CAST(NULL AS DECIMAL(30, 15)) AS CommitmentDiscountQuantity,
  CAST(NULL AS STRING) AS CommitmentDiscountStatus,
  CAST(NULL AS STRING) AS CommitmentDiscountType,
  CAST(NULL AS STRING) AS CommitmentDiscountUnit,
  CAST(usage.amount AS DECIMAL(30, 15)) AS ConsumedQuantity,
  CAST(usage.unit AS STRING) AS ConsumedUnit,
  CAST(cost AS DECIMAL(30, 15)) AS ContractedCost,
  CAST(price.effective_price AS DECIMAL(30, 15)) AS ContractedUnitPrice,
  CAST(COALESCE(cost, 0) + finlake_credit_amount AS DECIMAL(30, 15)) AS EffectiveCost,
  CAST(invoice.month AS STRING) AS InvoiceId,
  CAST(COALESCE(seller_name, 'Google Cloud') AS STRING) AS InvoiceIssuerName,
  CAST(COALESCE(cost_at_list, cost) AS DECIMAL(30, 15)) AS ListCost,
  CAST(price.list_price AS DECIMAL(30, 15)) AS ListUnitPrice,
  CAST(NULL AS STRING) AS PricingCategory,
  CAST(currency AS STRING) AS PricingCurrency,
  CAST(price.effective_price AS DECIMAL(30, 15)) AS PricingCurrencyContractedUnitPrice,
  CAST(COALESCE(cost, 0) + finlake_credit_amount AS DECIMAL(30, 15)) AS PricingCurrencyEffectiveCost,
  CAST(price.list_price AS DECIMAL(30, 15)) AS PricingCurrencyListUnitPrice,
  CAST(usage.amount_in_pricing_units AS DECIMAL(30, 15)) AS PricingQuantity,
  CAST(COALESCE(usage.pricing_unit, price.unit, usage.unit) AS STRING) AS PricingUnit,
  'Google Cloud' AS ProviderName,
  CAST(COALESCE(seller_name, 'Google Cloud') AS STRING) AS PublisherName,
  CAST(COALESCE(location.region, location.location) AS STRING) AS RegionId,
  CAST(location.location AS STRING) AS RegionName,
  CAST(resource.global_name AS STRING) AS ResourceId,
  CAST(resource.name AS STRING) AS ResourceName,
  CAST(service.description AS STRING) AS ResourceType,
  'Cloud Service' AS ServiceCategory,
  CAST(service.description AS STRING) AS ServiceName,
  CAST(NULL AS STRING) AS ServiceSubcategory,
  CAST(sku.id AS STRING) AS SkuId,
  CAST(usage.unit AS STRING) AS SkuMeter,
  map_from_entries(
    filter(
      array(
        named_struct('key', 'ServiceId', 'value', CAST(service.id AS STRING)),
        named_struct('key', 'ProjectNumber', 'value', CAST(project.number AS STRING)),
        named_struct('key', 'Location', 'value', CAST(location.location AS STRING)),
        named_struct('key', 'CostType', 'value', CAST(cost_type AS STRING)),
        named_struct('key', 'TransactionType', 'value', CAST(transaction_type AS STRING))
      ),
      kv -> kv.value IS NOT NULL
    )
  ) AS SkuPriceDetails,
  CAST(sku.id AS STRING) AS SkuPriceId,
  CAST(project.id AS STRING) AS SubAccountId,
  CAST(project.name AS STRING) AS SubAccountName,
  'Project' AS SubAccountType,
  map_from_entries(
    filter(
      transform(
        labels,
        label -> named_struct('key', CAST(label.key AS STRING), 'value', CAST(label.value AS STRING))
      ),
      kv -> kv.key IS NOT NULL AND kv.value IS NOT NULL
    )
  ) AS Tags
FROM source_rows;`;
}
