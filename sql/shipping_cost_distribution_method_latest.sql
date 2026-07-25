WITH latest AS (
  SELECT
    json_payload,
    ROW_NUMBER() OVER (
      PARTITION BY JSON_VALUE(json_payload, '$.scdm_id')
      ORDER BY uploaded_at DESC
    ) AS rn
  FROM `project-aa7ee149-5e29-4eb4-8bc.fixmart_bi.JSON_STAGE`
  WHERE source_table = 'shipping_cost_distribution_method'
)
SELECT
    SAFE_CAST(JSON_VALUE(json_payload, '$.scdm_id') AS INT64) AS scdm_id
  , JSON_VALUE(json_payload, '$.scdm_description') AS scdm_description
FROM latest
WHERE rn = 1;
