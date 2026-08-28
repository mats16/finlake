import json
import re
from datetime import datetime, timezone
from urllib.parse import unquote

from pyspark import pipelines as dp
from pyspark.sql import functions as F


TABLE_NAME = __TABLE_NAME__
S3_BUCKET = __S3_BUCKET__
S3_PREFIX = __S3_PREFIX__
EXPORT_NAME = __EXPORT_NAME__

EXPORT_ROOT = f"s3://{S3_BUCKET}/{S3_PREFIX}/{EXPORT_NAME}"
DATA_ROOT = f"{EXPORT_ROOT}/data/"
MANIFEST_ROOT = f"{EXPORT_ROOT}/metadata/"
PERIOD_RE = re.compile(r"/BILLING_PERIOD=(\d{4})-(\d{2})(?:/|$)")

COLUMNS = [
    ("AvailabilityZone", "STRING"),
    ("BilledCost", "DOUBLE"),
    ("BillingAccountId", "STRING"),
    ("BillingAccountName", "STRING"),
    ("BillingAccountType", "STRING"),
    ("BillingCurrency", "STRING"),
    ("BillingPeriodEnd", "TIMESTAMP"),
    ("BillingPeriodStart", "TIMESTAMP"),
    ("CapacityReservationId", "STRING"),
    ("CapacityReservationStatus", "STRING"),
    ("ChargeCategory", "STRING"),
    ("ChargeClass", "STRING"),
    ("ChargeDescription", "STRING"),
    ("ChargeFrequency", "STRING"),
    ("ChargePeriodEnd", "TIMESTAMP"),
    ("ChargePeriodStart", "TIMESTAMP"),
    ("CommitmentDiscountCategory", "STRING"),
    ("CommitmentDiscountId", "STRING"),
    ("CommitmentDiscountName", "STRING"),
    ("CommitmentDiscountQuantity", "DOUBLE"),
    ("CommitmentDiscountStatus", "STRING"),
    ("CommitmentDiscountType", "STRING"),
    ("CommitmentDiscountUnit", "STRING"),
    ("ConsumedQuantity", "DOUBLE"),
    ("ConsumedUnit", "STRING"),
    ("ContractedCost", "DOUBLE"),
    ("ContractedUnitPrice", "DOUBLE"),
    ("EffectiveCost", "DOUBLE"),
    ("InvoiceId", "STRING"),
    ("InvoiceIssuerName", "STRING"),
    ("ListCost", "DOUBLE"),
    ("ListUnitPrice", "DOUBLE"),
    ("PricingCategory", "STRING"),
    ("PricingCurrency", "STRING"),
    ("PricingCurrencyContractedUnitPrice", "DOUBLE"),
    ("PricingCurrencyEffectiveCost", "DOUBLE"),
    ("PricingCurrencyListUnitPrice", "DOUBLE"),
    ("PricingQuantity", "DOUBLE"),
    ("PricingUnit", "STRING"),
    ("ProviderName", "STRING"),
    ("PublisherName", "STRING"),
    ("RegionId", "STRING"),
    ("RegionName", "STRING"),
    ("ResourceId", "STRING"),
    ("ResourceName", "STRING"),
    ("ResourceType", "STRING"),
    ("ServiceCategory", "STRING"),
    ("ServiceName", "STRING"),
    ("ServiceSubcategory", "STRING"),
    ("SkuId", "STRING"),
    ("SkuMeter", "STRING"),
    ("SkuPriceDetails", "MAP<STRING, STRING>"),
    ("SkuPriceId", "STRING"),
    ("SubAccountId", "STRING"),
    ("SubAccountName", "STRING"),
    ("SubAccountType", "STRING"),
    ("Tags", "MAP<STRING, STRING>"),
    ("x_Discounts", "MAP<STRING, DOUBLE>"),
    ("x_Operation", "STRING"),
    ("x_ServiceCode", "STRING"),
]


def _billing_period_bounds(period):
    start = datetime.strptime(period, "%Y-%m").replace(tzinfo=timezone.utc)
    if start.month == 12:
        return start, start.replace(year=start.year + 1, month=1)
    return start, start.replace(month=start.month + 1)


def _period_from_manifest_path(path):
    match = PERIOD_RE.search(path)
    if not match:
        raise ValueError(f"AWS manifest path has no BILLING_PERIOD=YYYY-MM partition: {path}")
    period = f"{match.group(1)}-{match.group(2)}"
    _billing_period_bounds(period)
    return period


def _data_path(path, period):
    if not isinstance(path, str) or not path.strip():
        raise ValueError("AWS manifest dataFiles must contain non-empty strings")
    normalized = path.strip()
    if any(segment in (".", "..") for segment in unquote(normalized).split("/")):
        raise ValueError(f"AWS manifest data file contains a relative path segment: {path}")
    if not normalized.startswith("s3://"):
        key = normalized.lstrip("/")
        if key.startswith("data/"):
            normalized = f"{EXPORT_ROOT}/{key}"
        else:
            normalized = f"s3://{S3_BUCKET}/{key}"
    expected = f"{DATA_ROOT}BILLING_PERIOD={period}/"
    if not normalized.startswith(expected) or not normalized.lower().endswith(".parquet"):
        raise ValueError(f"AWS manifest data file is outside {expected}: {normalized}")
    return normalized


def _manifest(row):
    path = row["path"]
    try:
        payload = json.loads(bytes(row["content"]).decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError, TypeError) as err:
        raise ValueError(f"Invalid AWS manifest JSON at {path}: {err}") from err
    data_files = payload.get("dataFiles") if isinstance(payload, dict) else None
    if not isinstance(data_files, list):
        raise ValueError(f"AWS manifest dataFiles must be an array: {path}")
    period = _period_from_manifest_path(path)
    return {
        "period": period,
        "modification_time": row["modificationTime"],
        "path": path,
        "data_files": sorted({_data_path(item, period) for item in data_files}),
    }


def _ensure_target(spark_session):
    columns = ",\n".join(f"`{name}` {data_type}" for name, data_type in COLUMNS)
    spark_session.sql(
        f"""
        CREATE TABLE IF NOT EXISTS `{TABLE_NAME}` (
          {columns}
        ) USING DELTA
        PARTITIONED BY (`BillingPeriodStart`)
        TBLPROPERTIES (
          'delta.enableDeletionVectors' = true,
          'delta.enableRowTracking' = true,
          'delta.enableChangeDataFeed' = true
        )
        """
    )


def _replace_period(spark_session, manifest):
    start, end = _billing_period_bounds(manifest["period"])
    start_sql = start.strftime("%Y-%m-%d %H:%M:%S")
    end_sql = end.strftime("%Y-%m-%d %H:%M:%S")
    predicate = (
        f"BillingPeriodStart >= TIMESTAMP '{start_sql}' "
        f"AND BillingPeriodStart < TIMESTAMP '{end_sql}'"
    )
    if not manifest["data_files"]:
        spark_session.sql(f"DELETE FROM `{TABLE_NAME}` WHERE {predicate}")
        return

    source = spark_session.read.parquet(*manifest["data_files"])
    snapshot = source.select(
        *[F.col(name).cast(data_type).alias(name) for name, data_type in COLUMNS]
    )
    (
        snapshot.write.format("delta")
        .mode("overwrite")
        .option("replaceWhere", predicate)
        .saveAsTable(TABLE_NAME)
    )


@dp.foreach_batch_sink(name="aws_focus_manifest_sink")
def replace_aws_focus_periods(batch_df, _batch_id):
    spark_session = batch_df.sparkSession
    _ensure_target(spark_session)
    latest_by_period = {}
    for row in batch_df.collect():
        manifest = _manifest(row)
        current = latest_by_period.get(manifest["period"])
        sort_key = (manifest["modification_time"], manifest["path"])
        if current is None or sort_key > (
            current["modification_time"],
            current["path"],
        ):
            latest_by_period[manifest["period"]] = manifest
    for period in sorted(latest_by_period):
        _replace_period(spark_session, latest_by_period[period])


@dp.append_flow(target="aws_focus_manifest_sink", name="aws_focus_manifest_flow")
def aws_focus_manifests():
    return (
        spark.readStream.format("cloudFiles")
        .option("cloudFiles.format", "binaryFile")
        .option("cloudFiles.allowOverwrites", "true")
        .load(f"{MANIFEST_ROOT}**/*Manifest.json")
        .select("path", "modificationTime", "content")
    )
