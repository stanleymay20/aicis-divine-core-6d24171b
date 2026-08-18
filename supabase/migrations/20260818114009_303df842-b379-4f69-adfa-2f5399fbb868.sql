
CREATE OR REPLACE FUNCTION public.verify_prediction_ledger_chain_full(p_limit int DEFAULT 200000)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  r record; v_prev text := 'genesis'; v_checked int := 0;
  v_link_bad int := 0; v_payload_bad int := 0; v_payload_checked int := 0; v_unverifiable int := 0;
  v_first_bad text; v_a text; v_b text; v_c text; v_core text; v_ok boolean;
BEGIN
  FOR r IN SELECT ledger_key, payload_hash, previous_hash, chain_hash, payload_canonical,
                  source_table, subject_key, domain, predicted_at, horizon_days,
                  predicted_probability, model_version
             FROM public.prediction_ledger ORDER BY sequence_number ASC LIMIT p_limit LOOP
    v_checked := v_checked + 1;
    v_ok := NULL;

    IF r.payload_canonical IS NOT NULL THEN
      v_ok := encode(sha256(convert_to(r.payload_canonical::text, 'UTF8')), 'hex') = r.payload_hash;
      v_payload_checked := v_payload_checked + 1;
    ELSIF r.subject_key IS NOT NULL AND r.predicted_at IS NOT NULL AND r.horizon_days IS NOT NULL THEN
      -- historical canonical forms (both variants shipped by the sealer)
      v_core := split_part(r.subject_key,'/',1) || '|' || COALESCE(r.domain,'') || '|' || r.predicted_at::text
             || '|' || r.horizon_days::text || '|' || round(r.predicted_probability, 8)::text
             || '|' || COALESCE(r.model_version,'unknown');
      v_a := encode(sha256(convert_to(v_core, 'UTF8')), 'hex');
      v_b := encode(sha256(convert_to(COALESCE(r.source_table,'') || '|' || v_core, 'UTF8')), 'hex');
      v_c := encode(sha256(convert_to(replace(v_core, '|' || round(r.predicted_probability,8)::text || '|',
                                              '|' || trim(to_char(r.predicted_probability,'FM9990.00000000')) || '|'), 'UTF8')), 'hex');
      v_ok := r.payload_hash IN (v_a, v_b, v_c);
      v_payload_checked := v_payload_checked + 1;
    ELSE
      v_unverifiable := v_unverifiable + 1;
    END IF;

    IF v_ok IS FALSE THEN
      v_payload_bad := v_payload_bad + 1;
      IF v_first_bad IS NULL THEN v_first_bad := r.ledger_key; END IF;
    END IF;

    IF r.previous_hash <> v_prev
       OR r.chain_hash <> encode(sha256(convert_to(r.previous_hash || r.payload_hash, 'UTF8')), 'hex') THEN
      v_link_bad := v_link_bad + 1;
      IF v_first_bad IS NULL THEN v_first_bad := r.ledger_key; END IF;
    END IF;
    v_prev := r.chain_hash;
  END LOOP;

  RETURN jsonb_build_object('checked', v_checked, 'payload_checked', v_payload_checked,
    'payload_unverifiable_form', v_unverifiable,
    'broken_links', v_link_bad, 'payload_mismatches', v_payload_bad,
    'first_broken_key', v_first_bad,
    'links_valid', v_link_bad = 0, 'payloads_valid', v_payload_bad = 0,
    'chain_valid', v_link_bad = 0 AND v_payload_bad = 0);
END $$;
