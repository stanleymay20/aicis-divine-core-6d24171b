
INSERT INTO public.aicis_keyword_packs (language, country, domain, subtype, keywords, weight) VALUES
('en', NULL, 'human_rights', 'activist_killing_headline', '["killing of activist","death of activist","killed activist","murder of activist","slain activist","death of journalist","killing of journalist","death of critic","killing of critic","death of opposition","vocal critic","outspoken critic","prominent activist","leading activist","known activist","prominent journalist","leading critic"]'::jsonb, 1.0),
('fr', NULL, 'human_rights', 'activist_killing_headline', '["meurtre d un militant","mort d un militant","assassinat d un militant","meurtre d un journaliste","mort d un journaliste","critique virulent","critique acharné","figure de proue","militant connu"]'::jsonb, 1.0),
('pt', NULL, 'human_rights', 'activist_killing_headline', '["assassinato de ativista","morte de ativista","morte de activista","assassinato de jornalista","morte de jornalista","crítico ferrenho","crítico contundente","figura proeminente","ativista conhecido","activista conhecido","crítico do regime militar","crítico da junta militar"]'::jsonb, 1.0)
ON CONFLICT DO NOTHING;
