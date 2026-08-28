# Databricks notebook source
import json

from pyspark.sql import functions as F

dbutils.widgets.text("catalog", "finops")
dbutils.widgets.text("schema", "ingest")
dbutils.widgets.text("volume", "downloads")
dbutils.widgets.text("dataset_version", "v1")
dbutils.widgets.text("as_of_date", "2026-08-28")
dbutils.widgets.text("seed", "72011857")

catalog = dbutils.widgets.get("catalog")
schema = dbutils.widgets.get("schema")
volume = dbutils.widgets.get("volume")
version = dbutils.widgets.get("dataset_version")
as_of_date = dbutils.widgets.get("as_of_date")
seed = int(dbutils.widgets.get("seed"))

for value in (catalog, schema, volume):
    if not value.replace("_", "").isalnum():
        raise ValueError(f"Invalid Unity Catalog identifier: {value}")
if not version.replace("_", "").isalnum():
    raise ValueError(f"Invalid dataset version: {version}")

spark.sql(f"CREATE VOLUME IF NOT EXISTS `{catalog}`.`{schema}`.`{volume}`")
raw_path = f"/Volumes/{catalog}/{schema}/{volume}/gcp_billing_demo/{version}"
manifest_path = f"{raw_path}/_finlake_manifest.json"
expected_manifest = {
    "generator_revision": 1,
    "dataset_version": version,
    "as_of_date": as_of_date,
    "seed": seed,
    "row_count": 100_000,
    "file_count": 10,
}


def is_path_not_found(exc):
    message = str(exc)
    return "FileNotFoundException" in message or "PATH_NOT_FOUND" in message

try:
    existing_manifest = json.loads(dbutils.fs.head(manifest_path, 4096))
except Exception as exc:
    if not is_path_not_found(exc):
        raise
    existing_manifest = None

if existing_manifest is not None:
    if existing_manifest != expected_manifest:
        raise ValueError(
            f"Dataset version {version} already exists with different inputs. "
            "Use a new dataset_version instead of rewriting a streaming source."
        )
    existing_files = [f.path for f in dbutils.fs.ls(raw_path) if f.name.endswith(".json.gz")]
    existing_count = spark.read.json(raw_path).count()
    if len(existing_files) != expected_manifest["file_count"] or existing_count != expected_manifest["row_count"]:
        raise AssertionError(
            f"Existing dataset is incomplete: rows={existing_count} files={len(existing_files)}"
        )
    dbutils.notebook.exit(
        f"Reusing immutable synthetic dataset: path={raw_path} rows={existing_count} "
        f"files={len(existing_files)} seed={seed} as_of_date={as_of_date}"
    )

try:
    untracked_files = [f.path for f in dbutils.fs.ls(raw_path) if f.name.endswith(".json.gz")]
except Exception as exc:
    if not is_path_not_found(exc):
        raise
    untracked_files = []
if untracked_files:
    raise ValueError(
        f"Dataset version {version} contains raw files without a FinLake manifest. "
        "Remove the incomplete dataset or use a new dataset_version."
    )

row_id = F.col("id")
bucket = F.pmod(F.xxhash64(row_id, F.lit(seed)), F.lit(10_000))
service_bucket = F.pmod(F.xxhash64(row_id, F.lit(seed + 2)), F.lit(10_000))
day_offset = F.pmod(row_id * 37 + seed, F.lit(90)).cast("int")
hour = F.pmod(row_id * 13 + seed, F.lit(24)).cast("int")
start_date = F.date_add(F.to_date(F.lit(as_of_date)), day_offset - 89)
usage_start = F.to_timestamp(F.from_unixtime(F.unix_timestamp(start_date) + hour * 3600))

environment = (
    F.when(bucket < 6500, "prod")
    .when(bucket < 8000, "staging")
    .when(bucket < 9200, "dev")
    .when(bucket < 9700, "analytics")
    .otherwise("shared")
)
service_name = (
    F.when(service_bucket < 3200, "Compute Engine")
    .when(service_bucket < 5700, "Google Kubernetes Engine")
    .when(service_bucket < 7200, "Cloud SQL")
    .when(service_bucket < 8500, "BigQuery")
    .otherwise("Cloud Storage")
)
service_id = (
    F.when(service_name == "Compute Engine", "6F81-5844-456A")
    .when(service_name == "Google Kubernetes Engine", "CCD8-9BF1-090E")
    .when(service_name == "Cloud SQL", "9662-B51E-5089")
    .when(service_name == "BigQuery", "24E6-581D-38E5")
    .otherwise("95FF-2EF5-5EA1")
)
sku_id = F.concat(F.lit("SKU-"), F.lpad(F.pmod(row_id, F.lit(120)).cast("string"), 4, "0"))
project_index = F.pmod(row_id, F.lit(24)).cast("int")
project_id = F.concat(F.lit("aurora-"), environment, F.lit("-"), F.lpad(project_index, 2, "0"))
region = F.when(F.pmod(row_id, F.lit(4)) == 0, "us-central1").otherwise("asia-northeast1")
zone = F.concat(region, F.when(region == "us-central1", "-a").otherwise("-b"))
growth = F.lit(0.85) + day_offset.cast("double") * F.lit(0.003)
noise = F.lit(0.8) + F.pmod(F.xxhash64(row_id, F.lit(seed + 1)), F.lit(400)).cast("double") / 1000
service_rate = (
    F.when(service_name == "Compute Engine", 1.8)
    .when(service_name == "Google Kubernetes Engine", 1.55)
    .when(service_name == "Cloud SQL", 0.9)
    .when(service_name == "BigQuery", 0.65)
    .otherwise(0.25)
)
env_rate = F.lit(1.0)
release_spike = F.when(
    (day_offset == 60) & (environment == "prod") & service_name.isin("Compute Engine", "Google Kubernetes Engine"),
    3.2,
).otherwise(1.0)
weekend_dev = F.when(
    (environment == "dev") & F.dayofweek(start_date).isin(1, 7) & (hour < 7), 1.65
).otherwise(1.0)
usage_amount = F.round((F.pmod(row_id * 19, F.lit(900)) + 100) * growth * release_spike * weekend_dev, 6)
list_cost = F.round(usage_amount * service_rate * env_rate * noise / 100, 6)
commitment = (service_name.isin("Compute Engine", "Google Kubernetes Engine")) & (service_bucket % 5 == 0)
cost_type = F.when(bucket >= 9970, "adjustment").otherwise("regular")
cost = F.when(cost_type == "adjustment", -F.round(list_cost * 0.2, 6)).otherwise(list_cost)
credit_amount = F.when(commitment, -F.round(list_cost * 0.18, 6)).otherwise(F.lit(0.0))
unused_reservation = commitment & (bucket % 20 == 0)
missing_project = bucket % 17 == 0
missing_environment = bucket % 13 == 0
missing_cost_center = bucket % 11 == 0

kv = lambda key, value: F.struct(F.lit(key).alias("key"), value.alias("value"))
tag = lambda key, value: F.struct(
    F.lit(key).alias("key"), value.alias("value"), F.lit("finlake.demo").alias("namespace")
)

df = (
    spark.range(100_000, numPartitions=16)
    .select(
        F.lit("01A2B3-4C5D6E-7F8G9H").alias("billing_account_id"),
        F.struct(service_id.alias("id"), service_name.alias("description")).alias("service"),
        F.struct(sku_id.alias("id"), F.concat(service_name, F.lit(" synthetic SKU")).alias("description")).alias("sku"),
        usage_start.alias("usage_start_time"),
        (usage_start + F.expr("INTERVAL 1 HOUR")).alias("usage_end_time"),
        F.struct(
            F.when(missing_project, F.lit(None).cast("string")).otherwise(project_id).alias("id"),
            F.format_string("%012d", project_index + 10_000).alias("number"),
            project_id.alias("name"),
            F.array(kv("business-unit", F.lit("saas-platform"))).alias("labels"),
            F.lit("organization/123456789/project").alias("ancestry_numbers"),
        ).alias("project"),
        F.struct(
            F.concat(service_name, F.lit("-"), row_id.cast("string")).alias("name"),
            F.concat(F.lit("//compute.googleapis.com/projects/"), project_id, F.lit("/instances/"), row_id.cast("string")).alias("global_name"),
        ).alias("resource"),
        F.struct(region.alias("location"), F.lit("JP").alias("country"), region.alias("region"), zone.alias("zone")).alias("location"),
        F.struct(usage_amount.alias("amount"), F.lit("hour").alias("unit"), usage_amount.alias("amount_in_pricing_units"), F.lit("hour").alias("pricing_unit")).alias("usage"),
        F.struct(
            F.round(cost / usage_amount, 9).alias("effective_price"),
            F.round(cost / usage_amount, 9).alias("effective_price_default"),
            F.round(list_cost / usage_amount, 9).alias("list_price"),
            F.round(list_cost / usage_amount, 9).alias("list_price_consumption_model"),
            F.lit(0.0).alias("tier_start_amount"),
            F.lit("hour").alias("unit"),
            F.lit(1.0).alias("pricing_unit_quantity"),
        ).alias("price"),
        cost.alias("cost"),
        cost_type.alias("cost_type"),
        F.array(F.struct(
            F.when(commitment, F.lit("cud-demo-1")).otherwise(F.lit("none")).alias("id"),
            F.when(commitment, F.lit("Synthetic committed usage discount")).otherwise(F.lit("No credit")).alias("full_name"),
            F.when(commitment, F.lit("COMMITTED_USAGE_DISCOUNT")).otherwise(F.lit("PROMOTION")).alias("type"),
            F.when(commitment, F.lit("Demo CUD")).otherwise(F.lit("None")).alias("name"),
            credit_amount.alias("amount"),
        )).alias("credits"),
        F.struct(F.date_format(start_date, "yyyyMM").alias("month"), F.lit("GOOGLE").alias("publisher_type")).alias("invoice"),
        F.array(
            kv("Environment", F.when(missing_environment, F.lit(None).cast("string")).otherwise(environment)),
            kv("CostCenter", F.when(missing_cost_center, F.lit(None).cast("string")).otherwise(F.concat(F.lit("CC-"), F.lpad((project_index % 8).cast("string"), 4, "0")))),
            kv("Project", F.when(missing_project, F.lit(None).cast("string")).otherwise(project_id)),
        ).alias("labels"),
        F.array(
            kv("compute.googleapis.com/reservation_name", F.when(commitment, F.lit("reservation-demo-a")).otherwise(F.lit(None).cast("string"))),
            kv("compute.googleapis.com/reservation_project_id", F.when(commitment, project_id).otherwise(F.lit(None).cast("string"))),
            kv("compute.googleapis.com/is_unused_reservation", F.when(unused_reservation, F.lit("true")).otherwise(F.lit("false"))),
        ).alias("system_labels"),
        F.array(tag("Environment", F.when(missing_environment, F.lit(None).cast("string")).otherwise(environment))).alias("tags"),
        F.struct(F.when(commitment, F.lit("subscription-demo-1")).otherwise(F.lit(None).cast("string")).alias("instance_id")).alias("subscription"),
        F.struct(F.when(commitment, F.lit("commitment-v1")).otherwise(F.lit("on-demand")).alias("id"), F.when(commitment, F.lit("Committed use")).otherwise(F.lit("On demand")).alias("description")).alias("consumption_model"),
        F.struct(
            F.when(cost_type == "adjustment", F.concat(F.lit("adj-"), row_id.cast("string"))).otherwise(F.lit(None).cast("string")).alias("id"),
            F.when(cost_type == "adjustment", F.lit("Synthetic invoice correction")).otherwise(F.lit(None).cast("string")).alias("description"),
            F.when(cost_type == "adjustment", F.lit("USAGE_CORRECTION")).otherwise(F.lit(None).cast("string")).alias("type"),
            F.when(cost_type == "adjustment", F.lit("COMPLETE_NEGATION_WITH_REMONETIZATION")).otherwise(F.lit(None).cast("string")).alias("mode"),
        ).alias("adjustment_info"),
        F.lit("USD").alias("currency"),
        F.lit(1.0).alias("currency_conversion_rate"),
        F.lit("Google Cloud").alias("seller_name"),
        F.lit("GOOGLE_TO_CUSTOMER").alias("transaction_type"),
        list_cost.alias("cost_at_list"),
        list_cost.alias("cost_at_list_consumption_model"),
    )
)

row_count = df.count()
if row_count != 100_000:
    raise AssertionError(f"Expected 100000 rows, got {row_count}")

metrics = df.agg(
    F.count("*").alias("row_count"),
    F.min("usage_start_time").alias("period_start"),
    F.max("usage_start_time").alias("period_end"),
    F.round(F.sum(F.col("cost") + F.expr("aggregate(credits, 0D, (a, x) -> a + x.amount)")), 2).alias("effective_cost"),
    F.round(F.sum(F.when(F.expr("exists(labels, x -> x.value IS NULL)"), F.col("cost")).otherwise(0)), 2).alias("untagged_cost"),
    F.round(F.sum(F.when(F.expr("exists(system_labels, x -> x.key = 'compute.googleapis.com/is_unused_reservation' AND x.value = 'true')"), F.col("cost")).otherwise(0)), 2).alias("unused_reservation_cost"),
    F.round(F.sum(F.when(F.to_date("usage_start_time") == F.date_add(F.to_date(F.lit(as_of_date)), -29), F.col("cost")).otherwise(0)), 2).alias("release_day_cost"),
)
metrics.show(truncate=False)

release_date = F.date_add(F.to_date(F.lit(as_of_date)), -29)
anomaly_metrics = df.agg(
    F.sum(F.when(F.to_date("usage_start_time") == release_date, F.col("cost")).otherwise(0)).alias("release_cost"),
    (F.sum(F.when(
        F.to_date("usage_start_time").between(F.date_add(release_date, -3), F.date_add(release_date, -1)),
        F.col("cost"),
    ).otherwise(0)) / 3).alias("baseline_daily_cost"),
    F.sum(F.when(F.expr("exists(labels, x -> x.value IS NULL)"), F.col("cost")).otherwise(0)).alias("untagged_cost"),
    F.sum(F.when(F.expr("exists(system_labels, x -> x.key = 'compute.googleapis.com/is_unused_reservation' AND x.value = 'true')"), F.col("cost")).otherwise(0)).alias("unused_reservation_cost"),
).select(
    F.round(F.greatest(F.col("release_cost") - F.col("baseline_daily_cost"), F.lit(0.0)), 2).alias("anomalous_increase"),
    F.round(F.col("unused_reservation_cost") + F.col("untagged_cost") * 0.10, 2).alias("estimated_savings_candidate"),
)
anomaly_metrics.show(truncate=False)

validation = df.agg(
    F.sum(F.when(F.col("project.name").contains("aurora-prod-"), F.col("cost")).otherwise(0)).alias("prod_cost"),
    F.sum("cost").alias("total_cost"),
    F.sum(F.when(
        F.to_date("usage_start_time").between(
            F.date_add(F.to_date(F.lit(as_of_date)), -89),
            F.date_add(F.to_date(F.lit(as_of_date)), -83),
        ),
        F.col("cost"),
    ).otherwise(0)).alias("first_week_cost"),
    F.sum(F.when(
        F.to_date("usage_start_time").between(
            F.date_add(F.to_date(F.lit(as_of_date)), -6),
            F.to_date(F.lit(as_of_date)),
        ),
        F.col("cost"),
    ).otherwise(0)).alias("last_week_cost"),
    F.sum(F.when(
        F.col("project.name").contains("aurora-dev-")
        & F.dayofweek(F.to_date("usage_start_time")).isin(1, 7)
        & (F.hour("usage_start_time") < 7),
        1,
    ).otherwise(0)).alias("off_hours_dev_rows"),
    F.sum(F.when(F.expr("exists(credits, x -> x.amount < 0)"), 1).otherwise(0)).alias("discounted_rows"),
).first()

prod_cost_share = validation.prod_cost / validation.total_cost
if not 0.60 <= prod_cost_share <= 0.70:
    raise AssertionError(f"Expected prod cost share near 65%, got {prod_cost_share:.3f}")
if validation.last_week_cost <= validation.first_week_cost:
    raise AssertionError("Expected normal business growth to increase last-week cost")
if validation.off_hours_dev_rows <= 0:
    raise AssertionError("Expected weekend off-hours dev usage")
if validation.discounted_rows <= 0:
    raise AssertionError("Expected committed-use discount credits")

anomaly = anomaly_metrics.first()
if anomaly.anomalous_increase <= 0:
    raise AssertionError("Expected a positive release-day anomalous increase")
if anomaly.estimated_savings_candidate <= 0:
    raise AssertionError("Expected a positive estimated savings candidate")

required_scenarios = {
    "release spike": df.filter(
        (F.to_date("usage_start_time") == F.date_add(F.to_date(F.lit(as_of_date)), -29))
        & F.col("project.name").contains("aurora-prod-")
        & (F.col("service.description").isin("Compute Engine", "Google Kubernetes Engine"))
    ),
    "missing tags": df.filter(F.expr("exists(labels, x -> x.value IS NULL)")),
    "unused reservation": df.filter(
        F.expr("exists(system_labels, x -> x.key = 'compute.googleapis.com/is_unused_reservation' AND x.value = 'true')")
    ),
    "adjustment": df.filter(F.col("cost_type") == "adjustment"),
}
for name, scenario in required_scenarios.items():
    if scenario.limit(1).count() != 1:
        raise AssertionError(f"Missing required synthetic scenario: {name}")

df.repartition(10).write.mode("overwrite").option("compression", "gzip").json(raw_path)
files = [f.path for f in dbutils.fs.ls(raw_path) if f.name.endswith(".json.gz")]
if len(files) != 10:
    raise AssertionError(f"Expected 10 JSON.gz data files, got {len(files)}")
dbutils.fs.put(manifest_path, json.dumps(expected_manifest, sort_keys=True), True)
print(f"Synthetic demo raw dataset written: path={raw_path} rows={row_count} files={len(files)} seed={seed} as_of_date={as_of_date}")
