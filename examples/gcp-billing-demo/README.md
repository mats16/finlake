# FinLake synthetic GCP billing demo

This standalone bundle creates a deterministic, synthetic GCP detailed-billing-export-shaped dataset and a tagged Bronze streaming table. It does not add a demo-specific FinLake API or contain customer data.

The bundle manages the target catalog and ingestion schema. The shared `downloads` Volume is created idempotently by the generator. FinLake continues to manage the downstream FOCUS and Gold schemas and pipelines.

## Prerequisites

- Databricks CLI 0.287.0 or later.
- `CREATE CATALOG` on the Unity Catalog metastore when the target catalog does not exist.
- Managed storage available for the catalog. If the metastore has no storage root, create the catalog with Default Storage in Catalog Explorer or from serverless SQL, then follow the existing-catalog instructions below.

Catalogs with the same name are not adopted automatically. An existing catalog or schema must be bound to this bundle before deployment. Binding is scoped to a bundle target; repeat it for every target you deploy.

## Create a new catalog and schema

```sh
cd examples/gcp-billing-demo

databricks bundle validate --strict \
  --target demo \
  --profile fevm-mats-demo-tokyo

databricks bundle plan \
  --target demo \
  --profile fevm-mats-demo-tokyo

databricks bundle deploy \
  --target demo \
  --profile fevm-mats-demo-tokyo

databricks bundle run generate_gcp_billing_demo \
  --target demo \
  --profile fevm-mats-demo-tokyo
```

## Use an existing catalog or schema

If `finops` exists but `finops.ingest` does not, bind only the catalog. The next deployment creates the schema.

```sh
cd examples/gcp-billing-demo

databricks bundle deployment bind finlake_catalog finops \
  --target demo \
  --profile fevm-mats-demo-tokyo

databricks bundle plan \
  --target demo \
  --profile fevm-mats-demo-tokyo

databricks bundle deploy \
  --target demo \
  --profile fevm-mats-demo-tokyo
```

If both `finops` and `finops.ingest` exist, bind both before planning or deploying.

```sh
cd examples/gcp-billing-demo

databricks bundle deployment bind finlake_catalog finops \
  --target demo \
  --profile fevm-mats-demo-tokyo

databricks bundle deployment bind ingest_schema finops.ingest \
  --target demo \
  --profile fevm-mats-demo-tokyo

databricks bundle plan \
  --target demo \
  --profile fevm-mats-demo-tokyo

databricks bundle deploy \
  --target demo \
  --profile fevm-mats-demo-tokyo
```

After binding, the bundle definition becomes authoritative. A later deployment can overwrite manual changes such as comments. When overriding `catalog` or `ingest_schema`, pass the same `--var` values to `validate`, `bind`, `plan`, `deploy`, `run`, `unbind`, and `destroy`.

For details, see the official documentation for [binding existing bundle resources](https://docs.databricks.com/aws/en/dev-tools/cli/bundle-commands#databricks-bundle-deployment-bind), [bundle resource definitions](https://docs.databricks.com/gcp/en/dev-tools/bundles/resources), and [catalog creation requirements](https://docs.databricks.com/aws/en/catalogs/create-catalog).

## Demo output

The job writes 100,000 rows in ten gzip JSON files to `/Volumes/finops/ingest/downloads/gcp_billing_demo/v1/`, ingests them to `finops.ingest.gcp_billing_demo`, and applies `finlake_source_type=gcp_billing_demo`.

Each dataset version is immutable. Running the job again with the same version, seed, and as-of date validates and reuses the existing ten files so the streaming Bronze table does not duplicate rows. To change any generator input, use a new `dataset_version`.

In FinLake, choose Google Cloud, then select `finops.ingest.gcp_billing_demo`. The app labels the source as **Synthetic demo data** and sends it through the standard GCP to FOCUS and shared Gold pipelines.

## Evidence queries

```sql
SELECT COUNT(*), MIN(usage_start_time), MAX(usage_start_time),
       ROUND(SUM(cost + aggregate(credits, 0D, (a, x) -> a + x.amount)), 2) AS effective_cost
FROM finops.ingest.gcp_billing_demo;

SELECT COUNT(*), ROUND(SUM(EffectiveCost), 2)
FROM finops.focus.gcp_demo_usage;

SELECT COUNT(*), ROUND(SUM(EffectiveCost), 2)
FROM finops.analytics.usage_daily;

SELECT timestamp, details:flow_progress.data_quality AS expectations
FROM event_log(TABLE(finops.ingest.gcp_billing_demo))
WHERE event_type = 'flow_progress'
ORDER BY timestamp DESC
LIMIT 10;
```

Save the job run ID, pipeline update IDs, row counts, period, cost totals, untagged cost, release-day spike, and unused-reservation cost as text evidence for FE Bar. The generator reports anomalous increase as release-day cost above the preceding three-day daily average, and the illustrative savings candidate as unused-reservation cost plus 10% of untagged cost.

## Cleanup

The catalog and schema use `prevent_destroy`. For a full demo cleanup, remove the Bronze table and raw dataset first, then unbind the protected catalog/schema and destroy the job and pipeline. Pipeline destruction can also remove pipeline-managed datasets, so do not rely on the Bronze table surviving `bundle destroy`.

```sql
DROP TABLE IF EXISTS finops.ingest.gcp_billing_demo;
```

```python
dbutils.fs.rm('/Volumes/finops/ingest/downloads/gcp_billing_demo/v1/', True)
```

```sh
cd examples/gcp-billing-demo

databricks bundle deployment unbind ingest_schema \
  --target demo \
  --profile fevm-mats-demo-tokyo

databricks bundle deployment unbind finlake_catalog \
  --target demo \
  --profile fevm-mats-demo-tokyo

databricks bundle destroy \
  --target demo \
  --profile fevm-mats-demo-tokyo
```

Removing the GCP integration in FinLake deletes only FinLake-managed pipeline registration and FOCUS processing. It never deletes the Volume files or this external Bronze asset. The demo bundle owns the Bronze pipeline, while the shared Volume remains in Unity Catalog. The tutorial intentionally does not include a command that drops the catalog.
