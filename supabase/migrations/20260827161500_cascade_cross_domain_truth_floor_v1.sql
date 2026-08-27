-- AICIS cascade cross-domain truth floor v1
-- Unknown domain spread must remain unknown; it is not an observed zero.

ALTER TABLE public.aicis_cascades
  ALTER COLUMN cross_domain_count DROP DEFAULT,
  ALTER COLUMN cross_domain_count DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS cross_domain_count_semantics text;

UPDATE public.aicis_cascades
SET cross_domain_count_semantics = 'legacy_numeric_semantics_unverified'
WHERE cross_domain_count IS NOT NULL
  AND cross_domain_count_semantics IS NULL;

COMMENT ON COLUMN public.aicis_cascades.cross_domain_count IS
  'Nullable count of distinct mapped domains represented in the cascade. NULL means domain spread has not been assessed.';
COMMENT ON COLUMN public.aicis_cascades.cross_domain_count_semantics IS
  'Declares how cross_domain_count was derived. A missing domain mapping must never be represented as zero.';