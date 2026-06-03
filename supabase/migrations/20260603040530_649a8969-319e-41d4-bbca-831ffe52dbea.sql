CREATE OR REPLACE FUNCTION public.ledger_append(p_entry_type text, p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public, extensions
AS $function$
DECLARE
  v_prev text;
  v_hash text;
  v_canonical text;
  v_id uuid;
BEGIN
  SELECT hash INTO v_prev FROM public.ledger_entries
    ORDER BY block_number DESC NULLS LAST, created_at DESC LIMIT 1;
  IF v_prev IS NULL THEN v_prev := 'genesis'; END IF;

  v_canonical := jsonb_build_object(
    'entry_type', p_entry_type,
    'payload', p_payload,
    'previous_hash', v_prev,
    'ts', extract(epoch from now())::bigint
  )::text;

  v_hash := encode(extensions.digest(v_canonical, 'sha256'), 'hex');

  INSERT INTO public.ledger_entries (entry_type, payload, previous_hash, hash, verified)
  VALUES (p_entry_type::ledger_entry_type, p_payload, v_prev, v_hash, false)
  RETURNING id INTO v_id;

  RETURN v_id;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'ledger_append failed for %: %', p_entry_type, SQLERRM;
  RETURN NULL;
END;
$function$;