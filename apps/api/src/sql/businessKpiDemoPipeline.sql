CREATE OR REFRESH STREAMING TABLE business_kpi_bronze
COMMENT 'Synthetic team-level support KPIs loaded from the FinLake demo volume'
AS
SELECT
  CAST(date AS DATE) AS date,
  CAST(team_id AS STRING) AS team_id,
  CAST(headcount AS INT) AS headcount,
  CAST(tickets_resolved AS INT) AS tickets_resolved,
  CAST(avg_resolution_minutes AS DOUBLE) AS avg_resolution_minutes,
  CAST(csat AS DOUBLE) AS csat,
  CAST(active_customers AS INT) AS active_customers,
  CAST(is_demo AS BOOLEAN) AS is_demo,
  CAST(_rescued_data AS STRING) AS _rescued_data,
  _metadata.file_path AS source_file
FROM STREAM read_files(
  '${demo_raw_path}',
  format => 'json',
  schema => 'date DATE, team_id STRING, headcount INT, tickets_resolved INT, avg_resolution_minutes DOUBLE, csat DOUBLE, active_customers INT, is_demo BOOLEAN',
  rescuedDataColumn => '_rescued_data'
);

CREATE OR REFRESH MATERIALIZED VIEW `${gold_schema_name}`.`business_kpi_daily`
COMMENT 'Synthetic daily support KPIs for the FinLake AI value demo'
AS
SELECT
  date,
  team_id,
  MAX(headcount) AS headcount,
  SUM(tickets_resolved) AS tickets_resolved,
  AVG(avg_resolution_minutes) AS avg_resolution_minutes,
  AVG(csat) AS csat,
  MAX(active_customers) AS active_customers,
  BOOL_AND(is_demo) AS is_demo
FROM business_kpi_bronze
WHERE is_demo = true
  AND _rescued_data IS NULL
GROUP BY date, team_id;
