WITH latest AS (
  SELECT
    json_payload,
    ROW_NUMBER() OVER (
      PARTITION BY JSON_VALUE(json_payload, '$.shpc_id')
      ORDER BY uploaded_at DESC
    ) AS rn
  FROM `project-aa7ee149-5e29-4eb4-8bc.fixmart_bi.JSON_STAGE`
  WHERE source_table = 'shipping_container'
)
SELECT
    SAFE_CAST(JSON_VALUE(json_payload, '$.shpc_id') AS INT64) AS shpc_id
  , JSON_VALUE(json_payload, '$.shpc_number') AS shpc_number
  , JSON_VALUE(json_payload, '$.shpc_description') AS shpc_description
  , LOWER(JSON_VALUE(json_payload, '$.shpc_fully_received')) IN ('true', '1', 'yes') AS shpc_fully_received
  , SAFE_CAST(JSON_VALUE(json_payload, '$.shpc_date_promised') AS TIMESTAMP) AS shpc_date_promised
  , SAFE_CAST(JSON_VALUE(json_payload, '$.shpc_shipped_datetime') AS TIMESTAMP) AS shpc_shipped_datetime
  , SAFE_CAST(JSON_VALUE(json_payload, '$.shpc_port_eta_datetime') AS TIMESTAMP) AS shpc_port_eta_datetime
  , SAFE_CAST(JSON_VALUE(json_payload, '$.shpc_actual_delivery_datetime') AS TIMESTAMP) AS shpc_actual_delivery_datetime
  , JSON_VALUE(json_payload, '$.shpc_vessel') AS shpc_vessel
  , JSON_VALUE(json_payload, '$.shpc_box_number') AS shpc_box_number
  , SAFE_CAST(JSON_VALUE(json_payload, '$.shpc_sd_id') AS INT64) AS shpc_sd_id
  , SAFE_CAST(JSON_VALUE(json_payload, '$.shpc_scs_id') AS INT64) AS shpc_scs_id
  , LOWER(JSON_VALUE(json_payload, '$.shpc_active')) IN ('true', '1', 'yes') AS shpc_active
  , LOWER(JSON_VALUE(json_payload, '$.shpc_all_invoices_received')) IN ('true', '1', 'yes') AS shpc_all_invoices_received
FROM latest
WHERE rn = 1;
