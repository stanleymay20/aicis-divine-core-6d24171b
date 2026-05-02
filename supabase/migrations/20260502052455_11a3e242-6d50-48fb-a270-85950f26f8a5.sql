CREATE OR REPLACE FUNCTION public.lril_extract_place_phrases(p_text text)
RETURNS TABLE(phrase text, kind text, weight numeric)
LANGUAGE plpgsql STABLE SET search_path = public
AS $$
DECLARE
  v_text text;
  v_match text[];
BEGIN
  IF p_text IS NULL OR length(p_text) < 6 THEN RETURN; END IF;
  v_text := regexp_replace(p_text, '\s+', ' ', 'g');

  FOR v_match IN
    SELECT regexp_matches(
      v_text,
      '\y(?:in|at|near|outside|inside|around|from|across|to)\s+([[:upper:]][[:alpha:]\-]{2,}(?:\s+[[:upper:]][[:alpha:]\-]{2,}){0,2})',
      'g'
    )
  LOOP
    phrase := lower(unaccent(v_match[1]));
    kind := 'preposition';
    weight := 1.0;
    RETURN NEXT;
  END LOOP;

  FOR v_match IN
    SELECT regexp_matches(
      v_text,
      '\y([[:upper:]][[:alpha:]\-]{2,}(?:\s+[[:upper:]][[:alpha:]\-]{2,}){0,2})\s+(district|province|region|county|city|town|village|state|governorate|prefecture|department|municipality)\y',
      'g'
    )
  LOOP
    phrase := lower(unaccent(v_match[1]));
    kind := 'admin_suffix';
    weight := 1.2;
    RETURN NEXT;
  END LOOP;

  FOR v_match IN
    SELECT regexp_matches(
      v_text,
      '\y([[:upper:]][[:alpha:]\-]{3,}\s+[[:upper:]][[:alpha:]\-]{3,})\y',
      'g'
    )
  LOOP
    phrase := lower(unaccent(v_match[1]));
    kind := 'proper_bigram';
    weight := 0.5;
    RETURN NEXT;
  END LOOP;
END;
$$;
