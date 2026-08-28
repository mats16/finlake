CREATE OR REFRESH STREAMING TABLE gcp_billing_demo (
  CONSTRAINT valid_billing_account EXPECT (billing_account_id IS NOT NULL) ON VIOLATION FAIL UPDATE,
  CONSTRAINT valid_usage_start EXPECT (usage_start_time IS NOT NULL) ON VIOLATION FAIL UPDATE,
  CONSTRAINT valid_currency EXPECT (currency = 'USD') ON VIOLATION FAIL UPDATE,
  CONSTRAINT valid_cost EXPECT (cost IS NOT NULL) ON VIOLATION FAIL UPDATE
)
COMMENT 'Synthetic GCP detailed billing export raw records for the FinLake demo.'
AS SELECT * FROM STREAM read_files(
  '${raw_path}',
  format => 'json',
  schema => 'billing_account_id STRING, service STRUCT<id:STRING,description:STRING>, sku STRUCT<id:STRING,description:STRING>, usage_start_time TIMESTAMP, usage_end_time TIMESTAMP, project STRUCT<id:STRING,number:STRING,name:STRING,labels:ARRAY<STRUCT<key:STRING,value:STRING>>,ancestry_numbers:STRING>, resource STRUCT<name:STRING,global_name:STRING>, location STRUCT<location:STRING,country:STRING,region:STRING,zone:STRING>, usage STRUCT<amount:DOUBLE,unit:STRING,amount_in_pricing_units:DOUBLE,pricing_unit:STRING>, price STRUCT<effective_price:DOUBLE,effective_price_default:DOUBLE,list_price:DOUBLE,list_price_consumption_model:DOUBLE,tier_start_amount:DOUBLE,unit:STRING,pricing_unit_quantity:DOUBLE>, cost DOUBLE, cost_type STRING, credits ARRAY<STRUCT<id:STRING,full_name:STRING,type:STRING,name:STRING,amount:DOUBLE>>, invoice STRUCT<month:STRING,publisher_type:STRING>, labels ARRAY<STRUCT<key:STRING,value:STRING>>, system_labels ARRAY<STRUCT<key:STRING,value:STRING>>, tags ARRAY<STRUCT<key:STRING,value:STRING,namespace:STRING>>, subscription STRUCT<instance_id:STRING>, consumption_model STRUCT<id:STRING,description:STRING>, adjustment_info STRUCT<id:STRING,description:STRING,type:STRING,mode:STRING>, currency STRING, currency_conversion_rate DOUBLE, seller_name STRING, transaction_type STRING, cost_at_list DOUBLE, cost_at_list_consumption_model DOUBLE'
);
