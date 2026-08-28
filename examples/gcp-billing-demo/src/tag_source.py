# Databricks notebook source
dbutils.widgets.text("catalog", "finops")
dbutils.widgets.text("schema", "ingest")
dbutils.widgets.text("table", "gcp_billing_demo")
dbutils.widgets.text("volume", "downloads")
dbutils.widgets.text("dataset_version", "v1")

catalog = dbutils.widgets.get("catalog")
schema = dbutils.widgets.get("schema")
table = dbutils.widgets.get("table")
volume = dbutils.widgets.get("volume")
version = dbutils.widgets.get("dataset_version")

for value in (catalog, schema, table, volume, version):
    if not value.replace("_", "").isalnum():
        raise ValueError(f"Invalid Unity Catalog identifier: {value}")

fqn = f"`{catalog}`.`{schema}`.`{table}`"
raw_path = f"/Volumes/{catalog}/{schema}/{volume}/gcp_billing_demo/{version}"
raw_count = spark.read.json(raw_path).count()
bronze_count = spark.table(f"{catalog}.{schema}.{table}").count()
if raw_count != bronze_count:
    raise AssertionError(f"Raw/Bronze row count mismatch: raw={raw_count} bronze={bronze_count}")
spark.sql(f"SET TAG ON TABLE {fqn} finlake_source_type = 'gcp_billing_demo'")
print(
    f"Validated and tagged {catalog}.{schema}.{table}: "
    f"raw_rows={raw_count} bronze_rows={bronze_count} "
    "finlake_source_type=gcp_billing_demo"
)
