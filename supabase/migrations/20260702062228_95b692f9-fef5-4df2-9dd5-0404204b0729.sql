ALTER TYPE public.ledger_entry_type ADD VALUE IF NOT EXISTS 'ranking_prediction';
ALTER TYPE public.ledger_entry_type ADD VALUE IF NOT EXISTS 'ml_prediction';
ALTER TYPE public.ledger_entry_type ADD VALUE IF NOT EXISTS 'action_recommendation';
ALTER TYPE public.ledger_entry_type ADD VALUE IF NOT EXISTS 'signal';
ALTER TYPE public.ledger_entry_type ADD VALUE IF NOT EXISTS 'early_warning';