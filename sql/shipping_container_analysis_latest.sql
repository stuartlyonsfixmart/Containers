WITH latest AS (
  SELECT
    json_payload,
    ROW_NUMBER() OVER (
      PARTITION BY JSON_VALUE(json_payload, '$.shpca_id')
      ORDER BY uploaded_at DESC
    ) AS rn
  FROM `project-aa7ee149-5e29-4eb4-8bc.fixmart_bi.JSON_STAGE`
  WHERE source_table = 'shipping_container_analysis'
)
SELECT
    SAFE_CAST(JSON_VALUE(json_payload, '$.shpca_id') AS INT64) AS shpca_id
  , SAFE_CAST(JSON_VALUE(json_payload, '$.shpca_shpc_id') AS INT64) AS shpca_shpc_id
  , JSON_VALUE(json_payload, '$.shpca_c_1') AS shpca_c_1
  , JSON_VALUE(json_payload, '$.shpca_c_2') AS shpca_c_2
  , JSON_VALUE(json_payload, '$.shpca_c_3') AS shpca_c_3
  , JSON_VALUE(json_payload, '$.shpca_c_4') AS shpca_c_4
  , JSON_VALUE(json_payload, '$.shpca_c_5') AS shpca_c_5
  , JSON_VALUE(json_payload, '$.shpca_c_6') AS shpca_c_6
  , JSON_VALUE(json_payload, '$.shpca_c_7') AS shpca_c_7
  , JSON_VALUE(json_payload, '$.shpca_c_8') AS shpca_c_8
  , JSON_VALUE(json_payload, '$.shpca_c_9') AS shpca_c_9
  , JSON_VALUE(json_payload, '$.shpca_c_10') AS shpca_c_10
  , SAFE_CAST(JSON_VALUE(json_payload, '$.shpca_n_1') AS NUMERIC) AS shpca_n_1
  , SAFE_CAST(JSON_VALUE(json_payload, '$.shpca_n_2') AS NUMERIC) AS shpca_n_2
  , SAFE_CAST(JSON_VALUE(json_payload, '$.shpca_n_3') AS NUMERIC) AS shpca_n_3
  , SAFE_CAST(JSON_VALUE(json_payload, '$.shpca_n_4') AS NUMERIC) AS shpca_n_4
  , SAFE_CAST(JSON_VALUE(json_payload, '$.shpca_n_5') AS NUMERIC) AS shpca_n_5
  , SAFE_CAST(JSON_VALUE(json_payload, '$.shpca_n_6') AS NUMERIC) AS shpca_n_6
  , SAFE_CAST(JSON_VALUE(json_payload, '$.shpca_n_7') AS NUMERIC) AS shpca_n_7
  , SAFE_CAST(JSON_VALUE(json_payload, '$.shpca_n_8') AS NUMERIC) AS shpca_n_8
  , SAFE_CAST(JSON_VALUE(json_payload, '$.shpca_n_9') AS NUMERIC) AS shpca_n_9
  , SAFE_CAST(JSON_VALUE(json_payload, '$.shpca_n_10') AS NUMERIC) AS shpca_n_10
  , SAFE_CAST(JSON_VALUE(json_payload, '$.shpca_d_1') AS TIMESTAMP) AS shpca_d_1
  , SAFE_CAST(JSON_VALUE(json_payload, '$.shpca_d_2') AS TIMESTAMP) AS shpca_d_2
  , SAFE_CAST(JSON_VALUE(json_payload, '$.shpca_d_3') AS TIMESTAMP) AS shpca_d_3
  , SAFE_CAST(JSON_VALUE(json_payload, '$.shpca_d_4') AS TIMESTAMP) AS shpca_d_4
  , SAFE_CAST(JSON_VALUE(json_payload, '$.shpca_d_5') AS TIMESTAMP) AS shpca_d_5
  , SAFE_CAST(JSON_VALUE(json_payload, '$.shpca_d_6') AS TIMESTAMP) AS shpca_d_6
  , SAFE_CAST(JSON_VALUE(json_payload, '$.shpca_d_7') AS TIMESTAMP) AS shpca_d_7
  , SAFE_CAST(JSON_VALUE(json_payload, '$.shpca_d_8') AS TIMESTAMP) AS shpca_d_8
  , SAFE_CAST(JSON_VALUE(json_payload, '$.shpca_d_9') AS TIMESTAMP) AS shpca_d_9
  , SAFE_CAST(JSON_VALUE(json_payload, '$.shpca_d_10') AS TIMESTAMP) AS shpca_d_10
  , LOWER(JSON_VALUE(json_payload, '$.shpca_l_1')) IN ('true', '1', 'yes') AS shpca_l_1
  , LOWER(JSON_VALUE(json_payload, '$.shpca_l_2')) IN ('true', '1', 'yes') AS shpca_l_2
  , LOWER(JSON_VALUE(json_payload, '$.shpca_l_3')) IN ('true', '1', 'yes') AS shpca_l_3
  , LOWER(JSON_VALUE(json_payload, '$.shpca_l_4')) IN ('true', '1', 'yes') AS shpca_l_4
  , LOWER(JSON_VALUE(json_payload, '$.shpca_l_5')) IN ('true', '1', 'yes') AS shpca_l_5
  , LOWER(JSON_VALUE(json_payload, '$.shpca_l_6')) IN ('true', '1', 'yes') AS shpca_l_6
  , LOWER(JSON_VALUE(json_payload, '$.shpca_l_7')) IN ('true', '1', 'yes') AS shpca_l_7
  , LOWER(JSON_VALUE(json_payload, '$.shpca_l_8')) IN ('true', '1', 'yes') AS shpca_l_8
  , LOWER(JSON_VALUE(json_payload, '$.shpca_l_9')) IN ('true', '1', 'yes') AS shpca_l_9
  , LOWER(JSON_VALUE(json_payload, '$.shpca_l_10')) IN ('true', '1', 'yes') AS shpca_l_10
  , JSON_VALUE(json_payload, '$.shpca_m_1') AS shpca_m_1
  , JSON_VALUE(json_payload, '$.shpca_m_2') AS shpca_m_2
  , JSON_VALUE(json_payload, '$.shpca_m_3') AS shpca_m_3
  , JSON_VALUE(json_payload, '$.shpca_m_4') AS shpca_m_4
  , JSON_VALUE(json_payload, '$.shpca_m_5') AS shpca_m_5
  , JSON_VALUE(json_payload, '$.shpca_m_6') AS shpca_m_6
  , JSON_VALUE(json_payload, '$.shpca_m_7') AS shpca_m_7
  , JSON_VALUE(json_payload, '$.shpca_m_8') AS shpca_m_8
  , JSON_VALUE(json_payload, '$.shpca_m_9') AS shpca_m_9
  , JSON_VALUE(json_payload, '$.shpca_m_10') AS shpca_m_10
FROM latest
WHERE rn = 1;
