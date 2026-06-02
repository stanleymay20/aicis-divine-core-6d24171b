
CREATE OR REPLACE FUNCTION public.append_ledger_entry(p_type ledger_entry_type, p_payload jsonb)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_prev text;
  v_hash text;
  v_id   uuid;
  v_canonical text;
BEGIN
  SELECT hash INTO v_prev FROM ledger_entries ORDER BY block_number DESC LIMIT 1;
  v_canonical := COALESCE(v_prev,'') || '|' || p_type::text || '|' || p_payload::text || '|' || clock_timestamp()::text;
  v_hash := encode(extensions.digest(v_canonical, 'sha256'), 'hex');
  INSERT INTO ledger_entries (entry_type, payload, hash, previous_hash, verified)
  VALUES (p_type, p_payload, v_hash, v_prev, true)
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
