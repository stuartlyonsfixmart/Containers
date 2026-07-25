WITH latest AS (
  SELECT
    json_payload,
    ROW_NUMBER() OVER (
      PARTITION BY JSON_VALUE(json_payload, '$.scs_id')
      ORDER BY uploaded_at DESC
    ) AS rn
  FROM `project-aa7ee149-5e29-4eb4-8bc.fixmart_bi.JSON_STAGE`
  WHERE source_table = 'shipping_container_status'
)
SELECT
    SAFE_CAST(JSON_VALUE(json_payload, '$.scs_id') AS INT64) AS scs_id
  , JSON_VALUE(json_payload, '$.scs_status') AS scs_status
FROM latest
WHERE rn = 1;
