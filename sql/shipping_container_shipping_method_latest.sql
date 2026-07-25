WITH latest AS (
  SELECT
    json_payload,
    ROW_NUMBER() OVER (
      PARTITION BY JSON_VALUE(json_payload, '$.shpcsm_id')
      ORDER BY uploaded_at DESC
    ) AS rn
  FROM `project-aa7ee149-5e29-4eb4-8bc.fixmart_bi.JSON_STAGE`
  WHERE source_table = 'shipping_container_shipping_method'
)
SELECT
    SAFE_CAST(JSON_VALUE(json_payload, '$.shpcsm_id') AS INT64) AS shpcsm_id
  , SAFE_CAST(JSON_VALUE(json_payload, '$.shpcsm_shpc_id') AS INT64) AS shpcsm_shpc_id
  , SAFE_CAST(JSON_VALUE(json_payload, '$.shpcsm_psh_id') AS INT64) AS shpcsm_psh_id
  , SAFE_CAST(JSON_VALUE(json_payload, '$.shpcsm_c_id') AS INT64) AS shpcsm_c_id
  , SAFE_CAST(JSON_VALUE(json_payload, '$.shpcsm_net') AS NUMERIC) AS shpcsm_net
  , SAFE_CAST(JSON_VALUE(json_payload, '$.shpcsm_vat') AS NUMERIC) AS shpcsm_vat
  , SAFE_CAST(JSON_VALUE(json_payload, '$.shpcsm_gross') AS NUMERIC) AS shpcsm_gross
  , SAFE_CAST(JSON_VALUE(json_payload, '$.shpcsm_foreign_net') AS NUMERIC) AS shpcsm_foreign_net
  , SAFE_CAST(JSON_VALUE(json_payload, '$.shpcsm_foreign_vat') AS NUMERIC) AS shpcsm_foreign_vat
  , SAFE_CAST(JSON_VALUE(json_payload, '$.shpcsm_foreign_gross') AS NUMERIC) AS shpcsm_foreign_gross
  , SAFE_CAST(JSON_VALUE(json_payload, '$.shpcsm_sd_id') AS INT64) AS shpcsm_sd_id
  , JSON_VALUE(json_payload, '$.shpcsm_description') AS shpcsm_description
  , SAFE_CAST(JSON_VALUE(json_payload, '$.shpcsm_nc_id') AS INT64) AS shpcsm_nc_id
  , SAFE_CAST(JSON_VALUE(json_payload, '$.shpcsm_vr_id') AS INT64) AS shpcsm_vr_id
  , SAFE_CAST(JSON_VALUE(json_payload, '$.shpcsm_coc_id') AS INT64) AS shpcsm_coc_id
  , SAFE_CAST(JSON_VALUE(json_payload, '$.shpcsm_dc_id') AS INT64) AS shpcsm_dc_id
  , LOWER(JSON_VALUE(json_payload, '$.shpcsm_distribute')) IN ('true', '1', 'yes') AS shpcsm_distribute
  , SAFE_CAST(JSON_VALUE(json_payload, '$.shpcsm_cost') AS NUMERIC) AS shpcsm_cost
  , SAFE_CAST(JSON_VALUE(json_payload, '$.shpcsm_foreign_cost') AS NUMERIC) AS shpcsm_foreign_cost
  , SAFE_CAST(JSON_VALUE(json_payload, '$.shpcsm_exchange_rate') AS NUMERIC) AS shpcsm_exchange_rate
  , SAFE_CAST(JSON_VALUE(json_payload, '$.shpcsm_list_order') AS INT64) AS shpcsm_list_order
  , SAFE_CAST(JSON_VALUE(json_payload, '$.shpcsm_distribution_method') AS INT64) AS shpcsm_distribution_method
  , LOWER(JSON_VALUE(json_payload, '$.shpcsm_include_in_duty_costs')) IN ('true', '1', 'yes') AS shpcsm_include_in_duty_costs
FROM latest
WHERE rn = 1;
