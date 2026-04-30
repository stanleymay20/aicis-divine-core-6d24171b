
-- v7: Human-rights & junta keyword packs
INSERT INTO public.aicis_keyword_packs (language, country, domain, subtype, keywords, weight) VALUES
-- ENGLISH
('en', NULL, 'human_rights', 'activist_killing', '["activist killed","activist found dead","activist murdered","activist assassinated","activist shot dead","rights defender killed","rights defender murdered","civil society leader killed","opposition figure killed","critic of military killed","critic of junta killed","vocal critic killed","outspoken critic killed","prominent activist","government critic killed","whistleblower killed"]'::jsonb, 1.0),
('en', NULL, 'human_rights', 'journalist_killing', '["journalist killed","reporter killed","journalist murdered","reporter murdered","journalist found dead","journalist shot","press freedom","media worker killed","editor killed","photojournalist killed","blogger killed"]'::jsonb, 1.0),
('en', NULL, 'human_rights', 'political_assassination', '["assassinated","assassination","political killing","targeted killing","execution-style","killed by gunmen","shot by unknown","unknown assailants","drive-by killing","contract killing","masked gunmen"]'::jsonb, 0.95),
('en', NULL, 'human_rights', 'enforced_disappearance', '["abducted by security forces","disappeared","forced disappearance","enforced disappearance","whereabouts unknown","taken by armed men","missing after arrest","held incommunicado","secret detention"]'::jsonb, 0.9),
('en', NULL, 'human_rights', 'extrajudicial_killing', '["extrajudicial killing","extrajudicial execution","summary execution","died in custody","killed in custody","custodial death","tortured to death","police killed","soldiers killed civilians","security forces killed"]'::jsonb, 0.95),
('en', NULL, 'human_rights', 'crackdown', '["crackdown","mass arrests","sweeping arrests","detained protesters","banned opposition","dissolved party","arrested journalists","raided offices","blocked rally","forced exile","silenced dissent","stifling dissent"]'::jsonb, 0.85),
('en', NULL, 'human_rights', 'arbitrary_detention', '["arbitrary detention","arbitrarily detained","held without charge","held without trial","incommunicado detention","political prisoner","prisoner of conscience","jailed for criticism","jailed for tweet","jailed for post"]'::jsonb, 0.85),
-- FRENCH (West/Central Africa, Maghreb, DRC)
('fr', NULL, 'human_rights', 'activist_killing', '["militant tué","militant assassiné","militant retrouvé mort","activiste tué","défenseur des droits tué","figure de l opposition tuée","critique du régime tué","critique de la junte tué","leader de la société civile assassiné"]'::jsonb, 1.0),
('fr', NULL, 'human_rights', 'journalist_killing', '["journaliste tué","journaliste assassiné","journaliste retrouvé mort","reporter tué","journaliste abattu","liberté de la presse"]'::jsonb, 1.0),
('fr', NULL, 'human_rights', 'political_assassination', '["assassinat","assassiné","tué par balle","exécuté","tué par des hommes armés","assaillants inconnus","tueurs masqués","crime politique"]'::jsonb, 0.95),
('fr', NULL, 'human_rights', 'enforced_disappearance', '["disparition forcée","enlevé","porté disparu","enlevé par des hommes armés","détention au secret"]'::jsonb, 0.9),
('fr', NULL, 'human_rights', 'crackdown', '["répression","arrestations massives","opposition interdite","parti dissous","manifestants arrêtés","journalistes arrêtés","exil forcé"]'::jsonb, 0.85),
-- PORTUGUESE (Lusophone Africa: GNB, AGO, MOZ, CPV, STP, GNQ; BRA)
('pt', NULL, 'human_rights', 'activist_killing', '["ativista morto","ativista assassinado","ativista encontrado morto","activista morto","activista assassinado","activista encontrado morto","defensor dos direitos morto","crítico do regime morto","crítico da junta morto","crítico militar morto","figura da oposição morta","líder da sociedade civil morto","sinais de agressão"]'::jsonb, 1.0),
('pt', NULL, 'human_rights', 'journalist_killing', '["jornalista morto","jornalista assassinado","jornalista encontrado morto","repórter morto","liberdade de imprensa"]'::jsonb, 1.0),
('pt', NULL, 'human_rights', 'political_assassination', '["assassinato","assassinado","execução","morto a tiro","mortos por homens armados","atacantes desconhecidos","crime político"]'::jsonb, 0.95),
('pt', NULL, 'human_rights', 'enforced_disappearance', '["desaparecimento forçado","raptado","sequestrado","levado por homens armados","detido em segredo"]'::jsonb, 0.9),
('pt', NULL, 'human_rights', 'crackdown', '["repressão","prisões em massa","oposição banida","partido dissolvido","manifestantes detidos","jornalistas detidos","exílio forçado"]'::jsonb, 0.85),
-- ARABIC (Sahel/MENA juntas, Sudan, Egypt)
('ar', NULL, 'human_rights', 'activist_killing', '["مقتل ناشط","ناشط قتيل","ناشط اغتيل","ناشط حقوقي قتل","معارض قتل","انتقد الجيش","انتقد المجلس العسكري"]'::jsonb, 1.0),
('ar', NULL, 'human_rights', 'journalist_killing', '["مقتل صحفي","صحفي قتيل","اغتيال صحفي"]'::jsonb, 1.0),
('ar', NULL, 'human_rights', 'crackdown', '["حملة قمع","اعتقالات جماعية","حظر المعارضة","اعتقال صحفيين"]'::jsonb, 0.85),
-- POLITICAL STABILITY: junta / military-rule signals
('en', NULL, 'political_stability', 'junta_action', '["military junta","junta leader","junta decree","ruling military","military council","transitional military","CNSP","CNRD","CNT","supreme council","seized power","suspended constitution","dissolved parliament","banned political activity","extended transition"]'::jsonb, 0.9),
('en', NULL, 'political_stability', 'coup_aftermath', '["post-coup","since the coup","after the coup","coup leaders","sanctions following coup","ECOWAS sanctions","AU suspension","frozen assets"]'::jsonb, 0.85),
('fr', NULL, 'political_stability', 'junta_action', '["junte militaire","chef de la junte","conseil militaire","CNSP","CNRD","CNT","transition militaire","constitution suspendue","parlement dissous","prolongation de la transition"]'::jsonb, 0.9),
('pt', NULL, 'political_stability', 'junta_action', '["junta militar","líder da junta","conselho militar","transição militar","constituição suspensa","parlamento dissolvido"]'::jsonb, 0.9)
ON CONFLICT DO NOTHING;

-- v7: Sub-national hotspots — junta belt + Lusophone Africa
INSERT INTO public.aicis_geo_entities (iso3, admin_level_1, city, locality, lat, lon, geo_confidence) VALUES
-- Guinea-Bissau
('GNB','Bissau','Bissau','Bissau',11.8636,-15.5980,0.95),
('GNB','Bafatá','Bafatá','Bafatá',12.1716,-14.6622,0.9),
('GNB','Gabú','Gabú','Gabú',12.2820,-14.2280,0.9),
('GNB','Cacheu','Cacheu','Cacheu',12.2745,-16.1652,0.9),
('GNB','Oio','Farim','Farim',12.4836,-15.2233,0.85),
('GNB','Bolama','Bolama','Bolama',11.5750,-15.4761,0.85),
('GNB','Quinara','Buba','Buba',11.5897,-14.9981,0.85),
('GNB','Tombali','Catió','Catió',11.2833,-15.2500,0.85),
('GNB','Biombo','Quinhámel','Quinhámel',11.8833,-15.8500,0.85),
-- Mali junta belt
('MLI','Bamako','Bamako','Bamako',12.6392,-8.0029,0.95),
('MLI','Mopti','Mopti','Mopti',14.4843,-4.1814,0.9),
('MLI','Ségou','Ségou','Ségou',13.4317,-6.2157,0.9),
('MLI','Kidal','Kidal','Kidal',18.4411,1.4078,0.9),
('MLI','Gao','Gao','Gao',16.2667,-0.0500,0.9),
('MLI','Tombouctou','Timbuktu','Timbuktu',16.7666,-3.0026,0.9),
-- Burkina Faso
('BFA','Centre','Ouagadougou','Ouagadougou',12.3714,-1.5197,0.95),
('BFA','Sahel','Dori','Dori',14.0353,-0.0344,0.9),
('BFA','Est','Fada N''gourma','Fada N''gourma',12.0617,0.3617,0.85),
('BFA','Nord','Ouahigouya','Ouahigouya',13.5825,-2.4214,0.85),
('BFA','Boucle du Mouhoun','Dédougou','Dédougou',12.4636,-3.4647,0.85),
-- Niger
('NER','Niamey','Niamey','Niamey',13.5128,2.1126,0.95),
('NER','Tillabéri','Tillabéri','Tillabéri',14.2103,1.4533,0.9),
('NER','Diffa','Diffa','Diffa',13.3122,12.6111,0.9),
('NER','Maradi','Maradi','Maradi',13.5000,7.1000,0.9),
('NER','Agadez','Agadez','Agadez',16.9742,7.9911,0.9),
-- Guinea
('GIN','Conakry','Conakry','Conakry',9.6412,-13.5784,0.95),
('GIN','Kindia','Kindia','Kindia',10.0566,-12.8650,0.9),
('GIN','Nzérékoré','Nzérékoré','Nzérékoré',7.7561,-8.8175,0.9),
('GIN','Kankan','Kankan','Kankan',10.3853,-9.3050,0.9),
('GIN','Labé','Labé','Labé',11.3175,-12.2833,0.85),
-- Chad
('TCD','N''Djamena','N''Djamena','N''Djamena',12.1348,15.0557,0.95),
('TCD','Lac','Bol','Bol',13.4636,14.7136,0.85),
('TCD','Logone Oriental','Doba','Doba',8.6500,16.8500,0.85),
-- Sudan / Myanmar (additional resolution for known junta contexts)
('SDN','Khartoum','Khartoum','Khartoum',15.5007,32.5599,0.95),
('SDN','North Darfur','El Fasher','El Fasher',13.6308,25.3492,0.95),
('SDN','South Darfur','Nyala','Nyala',12.0489,24.8807,0.9),
('SDN','Gezira','Wad Madani','Wad Madani',14.4011,33.5197,0.9),
('MMR','Yangon','Yangon','Yangon',16.8409,96.1735,0.95),
('MMR','Mandalay','Mandalay','Mandalay',21.9588,96.0891,0.95),
('MMR','Sagaing','Sagaing','Sagaing',21.8788,95.9794,0.9),
-- Lusophone Africa extras
('AGO','Luanda','Luanda','Luanda',-8.8390,13.2894,0.95),
('AGO','Cabinda','Cabinda','Cabinda',-5.5500,12.2000,0.9),
('AGO','Huambo','Huambo','Huambo',-12.7761,15.7392,0.9),
('MOZ','Maputo','Maputo','Maputo',-25.9692,32.5732,0.95),
('MOZ','Cabo Delgado','Pemba','Pemba',-12.9740,40.5178,0.95),
('MOZ','Nampula','Nampula','Nampula',-15.1165,39.2666,0.9),
('CPV','Praia','Praia','Praia',14.9330,-23.5133,0.95),
('STP','São Tomé','São Tomé','São Tomé',0.3365,6.7273,0.95)
ON CONFLICT DO NOTHING;
