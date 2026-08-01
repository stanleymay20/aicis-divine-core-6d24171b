UPDATE public.global_signals
SET country_extracted_at = COALESCE(country_extracted_at, now()),
    country_extraction_method = COALESCE(country_extraction_method, 'ingest_provided'),
    country_extraction_status = COALESCE(country_extraction_status, 'extracted'),
    country_extraction_confidence = COALESCE(country_extraction_confidence, 60)
WHERE country_extracted_at IS NULL
  AND affected_countries IS NOT NULL
  AND affected_countries <> '{}';