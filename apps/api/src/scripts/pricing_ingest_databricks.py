import argparse

from pyspark.sql import functions as F
from pyspark.sql.functions import coalesce, col, concat, date_format, length, lit, substr, when


def parse_args():
    parser = argparse.ArgumentParser(description="Ingest Databricks pricing data for FinLake.")
    parser.add_argument("--source-table", default="system.billing.list_prices")
    parser.add_argument("--target-table", default="finops.pricing.databricks_list_prices")
    return parser.parse_args()


def quote_ident(identifier: str) -> str:
    return "`" + identifier.replace("`", "``") + "`"


def quote_fqn(fqn: str) -> str:
    parts = [part.strip() for part in fqn.split(".")]
    if len(parts) != 3 or any(not part for part in parts):
        raise ValueError(f"Expected a three-part table name, got: {fqn}")
    return ".".join(quote_ident(part) for part in parts)


def load_region_map():
    region_mapping = [
        ("AP_JAKARTA", "ap-southeast-3", "Asia Pacific (Jakarta)"),
        ("AP_MUMBAI", "ap-south-1", "Asia Pacific (Mumbai)"),
        ("AP_SEOUL", "ap-northeast-2", "Asia Pacific (Seoul)"),
        ("AP_SINGAPORE", "ap-southeast-1", "Asia Pacific (Singapore)"),
        ("AP_SYDNEY", "ap-southeast-2", "Asia Pacific (Sydney)"),
        ("AP_TOKYO", "ap-northeast-1", "Asia Pacific (Tokyo)"),
        ("CANADA", "ca-central-1", "Canada (Central)"),
        ("EUROPE_FRANCE", "eu-west-3", "EU (Paris)"),
        ("EUROPE_FRANKFURT", "eu-central-1", "EU (Frankfurt)"),
        ("EUROPE_IRELAND", "eu-west-1", "EU (Ireland)"),
        ("EUROPE_LONDON", "eu-west-2", "EU (London)"),
        ("EUROPE_STOCKHOLM", "eu-north-1", "EU (Stockholm)"),
        ("SA_BRAZIL", "sa-east-1", "South America (Sao Paulo)"),
        ("US_EAST_N_VIRGINIA", "us-east-1", "US East (N. Virginia)"),
        ("US_EAST_OHIO", "us-east-2", "US East (Ohio)"),
        ("US_WEST_CALIFORNIA", "us-west-1", "US West (N. California)"),
        ("US_WEST_OREGON", "us-west-2", "US West (Oregon)"),
    ]

    df_region_map = spark.createDataFrame(
        region_mapping,
        schema="region_suffix STRING, RegionId STRING, RegionName STRING",
    )
    print(f"Region mapping loaded: {len(region_mapping)} entries")
    return df_region_map


def build_pricing_dataframe(source_fqn: str):
    df_region_map = load_region_map()

    df_source = (
        spark.table(source_fqn)
        .filter(col("price_end_time").isNull())
        .select(
            col("account_id"),
            col("sku_name"),
            col("cloud"),
            col("currency_code"),
            col("usage_unit"),
            col("pricing.default").alias("list_price"),
            col("pricing.effective_list.default").alias("effective_list_price"),
            col("pricing.promotional.default").alias("promotional_price"),
            col("price_start_time"),
            col("price_end_time"),
        )
    )

    df_with_region = (
        df_source.alias("s")
        .join(
            df_region_map.alias("rm"),
            F.expr("endswith(s.sku_name, concat('_', rm.region_suffix))"),
            how="left",
        )
        .withColumn(
            "sku_name_base",
            when(
                col("rm.region_suffix").isNotNull(),
                substr(
                    col("s.sku_name"),
                    lit(1),
                    length(col("s.sku_name")) - length(col("rm.region_suffix")) - 1,
                ),
            ).otherwise(col("s.sku_name")),
        )
    )

    df_pricing = df_with_region.select(
        col("s.sku_name").alias("SkuId"),
        concat(
            col("s.sku_name"),
            lit("|"),
            date_format(col("price_start_time"), "yyyy-MM-dd'T'HH:mm:ss"),
        ).alias("SkuPriceId"),
        lit("Databricks").alias("ServiceName"),
        coalesce(col("rm.RegionId"), lit("global")).alias("RegionId"),
        coalesce(col("rm.RegionName"), lit("Any")).alias("RegionName"),
        col("usage_unit").alias("PricingUnit"),
        col("list_price").cast("double").alias("ListUnitPrice"),
        col("effective_list_price").cast("double").alias("EffectiveListUnitPrice"),
        col("promotional_price").cast("double").alias("PromotionalUnitPrice"),
        col("currency_code").alias("PricingCurrency"),
        col("price_start_time").cast("date").alias("EffectiveDate"),
        col("price_end_time").cast("timestamp").alias("x_PriceEndTime"),
        col("sku_name_base").alias("x_SkuNameBase"),
        col("account_id").alias("BillingAccountId"),
        col("cloud").alias("Provider"),
    )

    print(f"Pricing dataframe ready: {len(df_pricing.columns)} columns")
    return df_pricing


def main() -> None:
    args = parse_args()
    source_table = args.source_table.strip()
    target_table = args.target_table.strip()

    if not source_table:
        raise ValueError("source_table is required")
    if not target_table:
        raise ValueError("target_table is required")

    source_fqn = quote_fqn(source_table)
    target_fqn = quote_fqn(target_table)
    target_catalog, target_schema, _target_name = [part.strip() for part in target_table.split(".")]

    df_pricing = build_pricing_dataframe(source_fqn)

    spark.sql(f"CREATE SCHEMA IF NOT EXISTS {quote_ident(target_catalog)}.{quote_ident(target_schema)}")

    df_pricing.write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(target_fqn)

    row_count = spark.table(target_fqn).count()
    print(f"Wrote Databricks pricing table: {target_fqn}")
    print(f"Row count: {row_count:,}")


if __name__ == "__main__":
    main()
