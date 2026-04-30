
INSERT INTO public.aicis_geo_entities (iso3, admin_level_1, admin_level_2, city, locality, lat, lon, geo_confidence, aliases, population)
VALUES
  ('PNG','Morobe','Bulolo District','Bulolo','Sambio',-7.21,146.65,0.85,'["Bulolo","Sambio village","Wau-Bulolo","Bulolo district"]'::jsonb,30000),
  ('PNG','Morobe','Lae District','Lae',NULL,-6.73,146.99,0.9,'["Lae city","Lae"]'::jsonb,100000),
  ('PNG','Hela','Tari-Pori','Tari',NULL,-5.85,142.95,0.8,'["Tari","Hela province","Hela"]'::jsonb,15000),
  ('PNG','Enga','Wabag',NULL,NULL,-5.49,143.71,0.8,'["Wabag","Porgera","Enga"]'::jsonb,10000),
  ('PNG','Southern Highlands','Mendi',NULL,NULL,-6.15,143.66,0.8,'["Mendi","SHP","Southern Highlands"]'::jsonb,26000),
  ('PNG','Bougainville','Buka',NULL,NULL,-5.43,154.67,0.8,'["Bougainville","Arawa","Buka"]'::jsonb,40000),
  ('PNG','Eastern Highlands','Goroka',NULL,NULL,-6.08,145.39,0.8,'["Goroka","EHP","Eastern Highlands"]'::jsonb,20000),
  ('NGA','Plateau','Jos North','Jos',NULL,9.92,8.89,0.85,'["Jos","Plateau state","Mangu","Bokkos"]'::jsonb,900000),
  ('NGA','Benue','Makurdi',NULL,NULL,7.73,8.52,0.85,'["Benue","Guma","Logo","Agatu"]'::jsonb,300000),
  ('NGA','Zamfara','Gusau',NULL,NULL,12.16,6.66,0.85,'["Zamfara","Maradun","Anka","Bukkuyum"]'::jsonb,200000),
  ('NGA','Kaduna','Kaduna North',NULL,NULL,10.52,7.44,0.85,'["Kaduna","Birnin Gwari","Chikun","Kajuru"]'::jsonb,760000),
  ('NGA','Borno','Maiduguri',NULL,NULL,11.85,13.16,0.9,'["Borno","Maiduguri","Bama","Gwoza","Konduga"]'::jsonb,1100000),
  ('NGA','Sokoto','Sokoto',NULL,NULL,13.06,5.24,0.85,'["Sokoto","Goronyo","Isa","Sabon Birni"]'::jsonb,500000),
  ('NGA','Niger','Minna',NULL,NULL,9.61,6.55,0.8,'["Niger state","Shiroro","Munya","Rafi"]'::jsonb,300000),
  ('ETH','Amhara','Bahir Dar',NULL,NULL,11.59,37.39,0.85,'["Amhara","Bahir Dar","Gondar","Lalibela","Fano"]'::jsonb,350000),
  ('ETH','Oromia','Addis Ababa',NULL,NULL,9.03,38.74,0.8,'["Oromia","Wollega","Shewa","OLA"]'::jsonb,500000),
  ('ETH','Tigray','Mekelle',NULL,NULL,13.49,39.47,0.85,'["Tigray","Mekelle","Adigrat","Axum"]'::jsonb,300000),
  ('MMR','Rakhine','Sittwe',NULL,NULL,20.14,92.89,0.85,'["Rakhine","Sittwe","Maungdaw","Buthidaung"]'::jsonb,180000),
  ('MMR','Sagaing','Sagaing',NULL,NULL,21.88,95.98,0.8,'["Sagaing","Kale","Tamu","PDF"]'::jsonb,70000),
  ('MMR','Chin','Hakha',NULL,NULL,22.65,93.61,0.8,'["Chin state","Hakha","Falam"]'::jsonb,30000),
  ('IND','Manipur','Imphal West','Imphal',NULL,24.81,93.94,0.85,'["Manipur","Imphal","Churachandpur","Bishnupur","Kuki","Meitei"]'::jsonb,270000),
  ('COD','Ituri','Djugu',NULL,NULL,1.92,30.49,0.85,'["Ituri","Djugu","Mahagi","CODECO"]'::jsonb,50000),
  ('COD','North Kivu','Beni',NULL,NULL,0.49,29.46,0.85,'["Beni","Butembo","ADF","M23"]'::jsonb,230000),
  ('MOZ','Cabo Delgado','Mocimboa da Praia',NULL,NULL,-11.34,40.36,0.85,'["Cabo Delgado","Mocimboa","Pemba","Macomia","Palma"]'::jsonb,50000),
  ('COL','Cauca','Popayan',NULL,NULL,2.44,-76.61,0.8,'["Cauca","Popayan","Toribio"]'::jsonb,270000),
  ('COL','Norte de Santander','Cucuta',NULL,NULL,7.91,-72.5,0.8,'["Catatumbo","Cucuta","Tibu","Ocana"]'::jsonb,700000),
  ('MEX','Sinaloa','Culiacan',NULL,NULL,24.79,-107.39,0.8,'["Sinaloa","Culiacan","Mazatlan","Sinaloa cartel"]'::jsonb,900000),
  ('MEX','Guerrero','Chilpancingo',NULL,NULL,17.55,-99.5,0.8,'["Guerrero","Acapulco","Chilpancingo","Iguala"]'::jsonb,240000),
  ('MEX','Michoacan','Morelia',NULL,NULL,19.7,-101.18,0.8,'["Michoacan","Morelia","Apatzingan","Uruapan","CJNG"]'::jsonb,780000)
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION public.lril_compute_confidence(
  p_source_count integer,
  p_avg_source_reliability numeric,
  p_keyword_strength numeric,
  p_geo_confidence numeric,
  p_temporal_density numeric,
  p_proxy_boost numeric DEFAULT 0,
  p_fatality_count integer DEFAULT 0
)
RETURNS numeric
LANGUAGE plpgsql
IMMUTABLE
SET search_path TO 'public'
AS $function$
DECLARE
  src_score numeric;
  base numeric;
BEGIN
  src_score := LEAST(1.0, 0.35 + 0.25 * ln(GREATEST(p_source_count,1)));
  base := 0.35 * src_score
        + 0.25 * GREATEST(0.3, COALESCE(p_avg_source_reliability,0.5))
        + 0.20 * GREATEST(0, COALESCE(p_keyword_strength,0))
        + 0.15 * COALESCE(p_geo_confidence, 0.3)
        + 0.05 * LEAST(1.0, COALESCE(p_temporal_density,0))
        + LEAST(0.2, COALESCE(p_proxy_boost,0));
  IF p_source_count >= 1 AND COALESCE(p_avg_source_reliability,0) >= 0.85 AND COALESCE(p_keyword_strength,0) >= 1.0 THEN
    base := GREATEST(base, 0.45);
  END IF;
  IF p_source_count >= 3 AND COALESCE(p_avg_source_reliability,0) >= 0.7 THEN
    base := GREATEST(base, 0.7);
  END IF;
  IF COALESCE(p_fatality_count,0) >= 3
     AND COALESCE(p_geo_confidence,0) >= 0.6
     AND COALESCE(p_avg_source_reliability,0) >= 0.6 THEN
    base := GREATEST(base, 0.55);
  END IF;
  IF COALESCE(p_fatality_count,0) >= 10
     AND COALESCE(p_geo_confidence,0) >= 0.6 THEN
    base := GREATEST(base, 0.7);
  END IF;
  RETURN LEAST(1.0, ROUND(base::numeric, 4));
END;
$function$;
