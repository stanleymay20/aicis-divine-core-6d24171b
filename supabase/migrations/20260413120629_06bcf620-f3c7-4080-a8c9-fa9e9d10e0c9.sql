
DROP VIEW IF EXISTS canonical_country_list;
CREATE VIEW canonical_country_list
WITH (security_invoker = true)
AS
SELECT id, iso3, canonical_name, entity_type::text
FROM canonical_entities
WHERE entity_type::text IN ('country', 'territory')
  AND iso3 IS NOT NULL
ORDER BY iso3;
