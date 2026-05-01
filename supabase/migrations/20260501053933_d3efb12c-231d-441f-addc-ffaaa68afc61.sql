-- LRIL v8: Destabilization plots, foreign mercenary detentions, coup conspiracies
-- Adds keyword packs and Madagascar (+ Indian Ocean) sub-national geo-seeding.

INSERT INTO public.aicis_keyword_packs (language, country, domain, subtype, keywords, weight) VALUES
('en', NULL, 'political_stability', 'destabilization_plot',
 '["destabilize the country","plot to destabilize","conspiracy to destabilize","destabilization plot","alleged conspiracy","coup plot","coup attempt foiled","plot foiled","plotting against the state","subversive activities","treason charges","high treason","sedition","spy ring","espionage ring","arms cache discovered","weapons cache seized","explosives seized","plot uncovered"]'::jsonb, 1.8),
('en', NULL, 'political_stability', 'foreign_mercenary_detained',
 '["foreign mercenary","foreign mercenaries","mercenaries arrested","mercenaries detained","former French serviceman","ex-military detained","former soldier detained","Wagner operatives","private military contractor","PMC arrested","foreign fighters arrested","foreign nationals detained","Guy Baret"]'::jsonb, 2.0),
('fr', NULL, 'political_stability', 'destabilization_plot',
 '["complot pour déstabiliser","tentative de déstabilisation","tentative de coup","putsch déjoué","complot déjoué","atteinte à la sûreté de l''État","activités subversives","haute trahison","trahison","cache d''armes découverte","explosifs saisis"]'::jsonb, 1.8),
('fr', NULL, 'political_stability', 'foreign_mercenary_detained',
 '["mercenaires arrêtés","mercenaires détenus","ancien militaire français","ex-militaire français","ressortissant français arrêté","ressortissants étrangers arrêtés","Wagner","Guy Baret"]'::jsonb, 2.0),
('pt', NULL, 'political_stability', 'destabilization_plot',
 '["conspiração para desestabilizar","tentativa de golpe","plano para desestabilizar","golpe frustrado","alta traição","atividades subversivas"]'::jsonb, 1.8),
('pt', NULL, 'political_stability', 'foreign_mercenary_detained',
 '["mercenários detidos","ex-militar detido","ex-militar francês","cidadão francês detido","cidadãos estrangeiros detidos"]'::jsonb, 2.0),
('es', NULL, 'political_stability', 'destabilization_plot',
 '["conspiración para desestabilizar","intento de golpe","complot golpista","golpe frustrado","alta traición","actividades subversivas"]'::jsonb, 1.8),
('es', NULL, 'political_stability', 'foreign_mercenary_detained',
 '["mercenarios detenidos","exmilitar detenido","ciudadano francés detenido","ciudadanos extranjeros detenidos"]'::jsonb, 2.0),
('ar', NULL, 'political_stability', 'destabilization_plot',
 '["مؤامرة لزعزعة الاستقرار","محاولة انقلاب","إحباط انقلاب","تهمة الخيانة العظمى","أنشطة تخريبية"]'::jsonb, 1.8),
('ar', NULL, 'political_stability', 'foreign_mercenary_detained',
 '["اعتقال مرتزقة","مرتزقة أجانب","اعتقال عسكري سابق","اعتقال مواطن فرنسي"]'::jsonb, 2.0)
ON CONFLICT DO NOTHING;

-- Madagascar + Indian Ocean sub-national hotspots (cities, regions, islands)
INSERT INTO public.aicis_geo_entities (iso3, admin_level_1, city, locality, lat, lon, geo_confidence) VALUES
('MDG', 'Analamanga', 'Antananarivo', 'Antananarivo', -18.8792, 47.5079, 0.95),
('MDG', 'Analamanga', 'Antananarivo', 'Tana', -18.8792, 47.5079, 0.90),
('MDG', 'Atsinanana', 'Toamasina', 'Toamasina', -18.1492, 49.4023, 0.95),
('MDG', 'Boeny', 'Mahajanga', 'Mahajanga', -15.7167, 46.3167, 0.95),
('MDG', 'Diana', 'Antsiranana', 'Antsiranana', -12.2787, 49.2917, 0.95),
('MDG', 'Diana', 'Nosy Be', 'Nosy Be', -13.3167, 48.2667, 0.92),
('MDG', 'Atsimo-Andrefana', 'Toliara', 'Toliara', -23.3500, 43.6667, 0.95),
('MDG', 'Haute Matsiatra', 'Fianarantsoa', 'Fianarantsoa', -21.4536, 47.0854, 0.95),
('MDG', 'Vakinankaratra', 'Antsirabe', 'Antsirabe', -19.8659, 47.0333, 0.92),
('MDG', 'Sava', 'Sambava', 'Sambava', -14.2667, 50.1667, 0.90),
('MDG', 'Anosy', 'Tolagnaro', 'Fort Dauphin', -25.0317, 46.9893, 0.90),
('COM', 'Grande Comore', 'Moroni', 'Moroni', -11.7042, 43.2402, 0.95),
('COM', 'Anjouan', 'Mutsamudu', 'Mutsamudu', -12.1667, 44.4000, 0.92),
('SYC', 'Mahé', 'Victoria', 'Victoria', -4.6191, 55.4513, 0.95),
('MUS', 'Port Louis', 'Port Louis', 'Port Louis', -20.1609, 57.5012, 0.95)
ON CONFLICT DO NOTHING;