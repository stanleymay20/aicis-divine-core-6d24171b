
ALTER TABLE aicis_raw_local_signals DROP CONSTRAINT IF EXISTS aicis_raw_local_signals_source_type_check;
ALTER TABLE aicis_raw_local_signals ADD CONSTRAINT aicis_raw_local_signals_source_type_check
  CHECK (source_type = ANY (ARRAY['news','gov','ngo','remote','proxy','aggregator','social','sensor']));
