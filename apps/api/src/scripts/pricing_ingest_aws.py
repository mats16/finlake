import argparse
import os
import re

import requests
from pyspark.sql import functions as F


def parse_args():
    parser = argparse.ArgumentParser(description="Ingest AWS pricing data for FinLake.")
    parser.add_argument("--aws-service-code", default="AmazonEC2")
    parser.add_argument(
        "--source-url",
        default="https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonEC2/current/index.csv",
    )
    parser.add_argument(
        "--volume-path",
        default="/Volumes/finops/ingest/downloads/pricing_aws_ec2.csv",
    )
    parser.add_argument("--raw-table", default="finops.ingest.pricing_aws_ec2")
    parser.add_argument("--target-table", default="finops.pricing.aws_ec2")
    return parser.parse_args()


def quote_ident(identifier: str) -> str:
    return "`" + identifier.replace("`", "``") + "`"


def quote_fqn(fqn: str) -> str:
    parts = [part.strip() for part in fqn.split(".")]
    if len(parts) != 3 or any(not part for part in parts):
        raise ValueError(f"Expected a three-part table name, got: {fqn}")
    return ".".join(quote_ident(part) for part in parts)


def optional_string(df_clean, column_name: str):
    return (
        F.col(column_name).cast("string")
        if column_name in df_clean.columns
        else F.lit(None).cast("string")
    )


def parsed_double(df_clean, column_name: str):
    normalized = F.regexp_replace(optional_string(df_clean, column_name), ",", "")
    matched = F.regexp_extract(normalized, r"([0-9]+(?:\.[0-9]+)?)", 1)
    return F.when(matched != "", matched.cast("double")).otherwise(F.lit(None).cast("double"))


def download_price_file(url: str, volume_path: str) -> str:
    if not url:
        raise ValueError("source_url is required")

    local_path = volume_path
    parent_dir = os.path.dirname(local_path)
    tmp_path = f"{local_path}.tmp"

    if not parent_dir:
        raise ValueError(f"Expected volume_path to be a file path, got: {volume_path}")

    os.makedirs(parent_dir, exist_ok=True)

    print(f"Downloading from: {url}")
    print(f"Saving to: {local_path}")

    response = requests.get(url, stream=True, timeout=60)
    response.raise_for_status()

    total_size = int(response.headers.get("content-length", 0))
    downloaded = 0

    with open(tmp_path, "wb") as f:
        for chunk in response.iter_content(chunk_size=8 * 1024 * 1024):
            if not chunk:
                continue
            f.write(chunk)
            downloaded += len(chunk)
            if total_size > 0:
                pct = downloaded / total_size * 100
                print(
                    f"\rProgress: {downloaded / (1024**2):.0f} MB / "
                    f"{total_size / (1024**2):.0f} MB ({pct:.1f}%)",
                    end="",
                )

    os.replace(tmp_path, local_path)
    print(f"\nDownload complete: {os.path.getsize(local_path) / (1024**2):.1f} MB")
    return local_path


def create_raw_view(raw_table: str, local_path: str) -> str:
    raw_fqn = quote_fqn(raw_table)
    csv_path_sql = local_path.replace("'", "''")

    spark.sql(
        f"""
        CREATE OR REPLACE VIEW {raw_fqn} AS
        SELECT * FROM read_files(
            '{csv_path_sql}',
            format => 'csv',
            header => true,
            inferSchema => true,
            skipRows => 5
        )
        """
    )

    print(f"Created raw CSV view: {raw_fqn}")
    return raw_fqn


def write_pricing_table(aws_service_code: str, raw_fqn: str, target_table: str) -> None:
    output_fqn = quote_fqn(target_table)
    df = spark.table(raw_fqn)

    cleaned_cols = []
    for column in df.columns:
        cleaned = re.sub(r"[^a-zA-Z0-9_]", "", column)
        cleaned_cols.append(cleaned)

    df_clean = df.toDF(*cleaned_cols)

    focus_renames = {
        "SKU": "SkuId",
        "usageType": "SkuMeter",
        "RateCode": "SkuPriceId",
        "RegionCode": "RegionId",
        "Location": "RegionName",
        "Currency": "PricingCurrency",
        "PricePerUnit": "ListUnitPrice",
        "TermType": "PricingCategory",
        "serviceCode": "x_ServiceCode",
        "serviceName": "ServiceName",
    }
    for old, new in focus_renames.items():
        if old in df_clean.columns:
            df_clean = df_clean.withColumnRenamed(old, new)

    if "PricingCategory" in df_clean.columns:
        df_clean = df_clean.withColumn(
            "PricingCategory",
            F.when(F.col("PricingCategory") == "OnDemand", F.lit("Standard"))
            .when(F.col("PricingCategory") == "Reserved", F.lit("Committed"))
            .otherwise(F.lit("Other")),
        )

    instance_type = optional_string(df_clean, "InstanceType")
    instance_type_family = optional_string(df_clean, "InstanceTypeFamily")
    instance_type_parts = F.split(instance_type, r"\.")
    instance_series_from_type = (
        F.when(instance_type.isNull(), F.lit(None).cast("string"))
        .when(
            instance_type.startswith("db.") & (F.size(instance_type_parts) >= 2),
            F.concat_ws(".", instance_type_parts.getItem(0), instance_type_parts.getItem(1)),
        )
        .when(F.instr(instance_type, ".") > 0, instance_type_parts.getItem(0))
        .otherwise(instance_type)
    )
    if aws_service_code == "AmazonRDS":
        instance_series = F.coalesce(instance_type_family, instance_series_from_type)
    elif aws_service_code == "AmazonEC2":
        instance_series = F.upper(instance_series_from_type)
    else:
        instance_series = instance_series_from_type

    df_clean = df_clean.withColumn(
        "SkuPriceDetails",
        F.map_filter(
            F.create_map(
                F.lit("CoreCount"),
                parsed_double(df_clean, "vCPU").cast("string"),
                F.lit("GpuCount"),
                parsed_double(df_clean, "GPU").cast("string"),
                F.lit("MemorySize"),
                parsed_double(df_clean, "Memory").cast("string"),
                F.lit("InstanceType"),
                instance_type,
                F.lit("InstanceSeries"),
                instance_series,
                F.lit("OperatingSystem"),
                optional_string(df_clean, "OperatingSystem"),
            ),
            lambda _key, value: value.isNotNull(),
        ),
    )

    df_clean.write.mode("overwrite").option("overwriteSchema", "true").saveAsTable(output_fqn)

    column_comments = {
        "SkuId": "Provider-specified unique identifier that represents a specific SKU (e.g., a quantifiable good or service offering).",
        "SkuPriceId": "A provider-specified unique identifier that represents a specific SKU Price associated with a resource or service used or purchased.",
        "SkuMeter": "Describes the functionality being metered or measured by a particular SKU in a charge.",
        "SkuPriceDetails": "A set of properties of a SKU Price ID which are meaningful and common to all instances of that SKU Price ID.",
        "PricingCurrency": "The national or virtual currency denomination that a resource or service was priced in.",
        "ListUnitPrice": "The suggested provider-published unit price for a single Pricing Unit of the associated SKU, exclusive of any discounts.",
        "RegionName": "The name of an isolated geographic area where a resource is provisioned or a service is provided.",
        "RegionId": "Provider-assigned identifier for an isolated geographic area where a resource is provisioned or a service is provided.",
    }
    for column_name, comment in column_comments.items():
        if column_name in df_clean.columns:
            comment_sql = comment.replace("'", "''")
            spark.sql(
                f"ALTER TABLE {output_fqn} ALTER COLUMN {quote_ident(column_name)} COMMENT '{comment_sql}'"
            )

    print(f"Wrote Delta table: {output_fqn}")


def main() -> None:
    args = parse_args()
    aws_service_code = args.aws_service_code.strip()
    source_url = args.source_url.strip()
    volume_path = args.volume_path.strip()
    raw_table = args.raw_table.strip()
    target_table = args.target_table.strip()

    print(f"AWS service code: {aws_service_code}")
    local_path = download_price_file(source_url, volume_path)
    raw_fqn = create_raw_view(raw_table, local_path)
    write_pricing_table(aws_service_code, raw_fqn, target_table)


if __name__ == "__main__":
    main()
