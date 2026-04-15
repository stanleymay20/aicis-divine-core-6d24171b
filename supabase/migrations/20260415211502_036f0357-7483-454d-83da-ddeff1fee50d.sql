
ALTER TABLE model_registry DROP CONSTRAINT IF EXISTS model_registry_status_check;
ALTER TABLE model_registry ADD CONSTRAINT model_registry_status_check 
  CHECK (status IN ('draft', 'candidate', 'active', 'retired', 'champion', 'rejected'));
