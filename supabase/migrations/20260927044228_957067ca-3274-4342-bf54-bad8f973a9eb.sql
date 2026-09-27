CREATE OR REPLACE FUNCTION public.batch_generate_links(_batch_size integer DEFAULT 2000)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' SET statement_timeout TO '50s'
AS $f$
DECLARE v_cursor uuid; v_last uuid; v_ins int := 0;
BEGIN
  SELECT NULLIF(value_text,'')::uuid INTO v_cursor FROM backfill_state WHERE key='link_gen_cursor';
  IF NOT FOUND THEN INSERT INTO backfill_state(key,value_text) VALUES ('link_gen_cursor',''); END IF;
  DROP TABLE IF EXISTS _b;
  CREATE TEMP TABLE _b ON COMMIT DROP AS
    SELECT id, iso3 FROM normalized_metrics
    WHERE (v_cursor IS NULL OR id > v_cursor) ORDER BY id LIMIT _batch_size;
  SELECT id INTO v_last FROM _b ORDER BY id DESC LIMIT 1;
  IF v_last IS NULL THEN RETURN jsonb_build_object('status','complete'); END IF;
  INSERT INTO entity_metric_links (metric_id, entity_id, link_role, confidence)
  SELECT b.id, ce.id, 'primary_country', 0.95 FROM _b b
  JOIN canonical_entities ce ON ce.iso3 = public.f_normalize_iso3(b.iso3)
   AND ce.entity_type IN ('country','territory') AND ce.sovereignty_status IN ('sovereign_state','territory','disputed')
  WHERE b.iso3 IS NOT NULL ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_ins = ROW_COUNT;
  UPDATE backfill_state SET value_text=v_last::text, updated_at=now() WHERE key='link_gen_cursor';
  RETURN jsonb_build_object('status','running','cursor',v_last,'inserted',v_ins);
END $f$;