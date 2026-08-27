-- AICIS relationship strength semantics.
-- A numeric edge strength is not self-describing. Preserve legacy values, but
-- prevent new graph analytics from treating them as quantitatively trustworthy
-- until their derivation is declared.

ALTER TABLE public.aicis_world_relationships
  ADD COLUMN IF NOT EXISTS strength_semantics text;

UPDATE public.aicis_world_relationships
SET strength_semantics = 'legacy_numeric_strength_semantics_unverified'
WHERE strength IS NOT NULL AND strength_semantics IS NULL;

COMMENT ON COLUMN public.aicis_world_relationships.strength IS
  'Nullable relationship-strength measure. Its unit/derivation must be declared in strength_semantics before quantitative graph propagation.';
COMMENT ON COLUMN public.aicis_world_relationships.strength_semantics IS
  'Declares the meaning and derivation of relationship strength; legacy/unverified/unknown semantics are excluded from truth-floor quantitative propagation.';
