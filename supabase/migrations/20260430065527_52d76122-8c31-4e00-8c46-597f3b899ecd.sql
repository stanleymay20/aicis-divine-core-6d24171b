
-- v5: ISO3 normalization at ingest time (not only at processing)
CREATE OR REPLACE FUNCTION public.lril_normalize_country_hint()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.country_hint IS NOT NULL AND length(NEW.country_hint) BETWEEN 2 AND 3 THEN
    NEW.country_hint := COALESCE(public.lril_fips_to_iso3(NEW.country_hint), NEW.country_hint);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lril_normalize_country ON public.aicis_raw_local_signals;
CREATE TRIGGER trg_lril_normalize_country
BEFORE INSERT OR UPDATE OF country_hint ON public.aicis_raw_local_signals
FOR EACH ROW EXECUTE FUNCTION public.lril_normalize_country_hint();

-- Sub-national hotspots: Maghreb + Egypt + Sudan + Libya
INSERT INTO public.aicis_geo_entities (iso3, admin_level_1, admin_level_2, city, locality, lat, lon, geo_confidence, aliases, population)
VALUES
  -- Algeria wilayas
  ('DZA','Tissemsilt','Tissemsilt','Tissemsilt',NULL,35.61,1.81,0.88,'["Tissemsilt","Wilaya de Tissemsilt","ولاية تيسمسيلت"]'::jsonb,300000),
  ('DZA','Tlemcen','Tlemcen','Tlemcen',NULL,34.88,-1.32,0.85,'["Tlemcen","تلمسان"]'::jsonb,170000),
  ('DZA','Oran','Oran','Oran',NULL,35.7,-0.63,0.9,'["Oran","Wahran","وهران"]'::jsonb,800000),
  ('DZA','Constantine','Constantine','Constantine',NULL,36.36,6.61,0.9,'["Constantine","Qacentina","قسنطينة"]'::jsonb,450000),
  ('DZA','Annaba','Annaba','Annaba',NULL,36.9,7.76,0.85,'["Annaba","عنابة"]'::jsonb,260000),
  ('DZA','Béjaïa','Bejaia','Béjaïa',NULL,36.75,5.08,0.85,'["Bejaia","Béjaïa","بجاية"]'::jsonb,180000),
  ('DZA','Sétif','Setif','Sétif',NULL,36.19,5.41,0.85,'["Setif","Sétif","سطيف"]'::jsonb,290000),
  ('DZA','Ouargla','Hassi Messaoud',NULL,NULL,31.7,6.07,0.85,'["Hassi Messaoud","Ouargla","حاسي مسعود"]'::jsonb,90000),
  ('DZA','Adrar','Adrar','Adrar',NULL,27.87,-0.29,0.8,'["Adrar","أدرار"]'::jsonb,65000),
  ('DZA','Tamanrasset','Tamanrasset','Tamanrasset',NULL,22.78,5.52,0.8,'["Tamanrasset","تمنراست"]'::jsonb,90000),
  -- Morocco provinces
  ('MAR','Tanger-Tetouan','Tangier','Tangier',NULL,35.76,-5.83,0.9,'["Tangier","Tanger","طنجة"]'::jsonb,950000),
  ('MAR','Casablanca-Settat','Casablanca','Casablanca',NULL,33.57,-7.6,0.92,'["Casablanca","الدار البيضاء"]'::jsonb,3360000),
  ('MAR','Rabat-Salé-Kénitra','Kenitra','Kenitra',NULL,34.26,-6.58,0.85,'["Kenitra","القنيطرة"]'::jsonb,430000),
  ('MAR','El Jadida','Jorf Lasfar','Jorf Lasfar',NULL,33.13,-8.62,0.8,'["Jorf Lasfar"]'::jsonb,15000),
  ('MAR','Casablanca-Settat','Mohammedia','Mohammedia',NULL,33.69,-7.39,0.85,'["Mohammedia","المحمدية"]'::jsonb,200000),
  -- Tunisia governorates
  ('TUN','Sfax','Sfax','Sfax',NULL,34.74,10.76,0.88,'["Sfax","صفاقس"]'::jsonb,330000),
  ('TUN','Sousse','Sousse','Sousse',NULL,35.83,10.64,0.85,'["Sousse","سوسة"]'::jsonb,270000),
  ('TUN','Bizerte','Bizerte','Bizerte',NULL,37.27,9.87,0.82,'["Bizerte","بنزرت"]'::jsonb,140000),
  ('TUN','Gafsa','Gafsa','Gafsa',NULL,34.43,8.78,0.8,'["Gafsa","قفصة"]'::jsonb,110000),
  -- Libya municipalities
  ('LBY','Misrata','Misrata','Misrata',NULL,32.38,15.09,0.85,'["Misrata","مصراتة"]'::jsonb,280000),
  ('LBY','Benghazi','Benghazi','Benghazi',NULL,32.12,20.07,0.9,'["Benghazi","بنغازي"]'::jsonb,650000),
  ('LBY','Sirte','Sirte','Sirte',NULL,31.21,16.59,0.82,'["Sirte","سرت"]'::jsonb,80000),
  -- Egypt governorates
  ('EGY','Alexandria','Alexandria','Alexandria',NULL,31.2,29.92,0.92,'["Alexandria","الإسكندرية"]'::jsonb,5200000),
  ('EGY','Suez','Suez','Suez',NULL,29.97,32.55,0.85,'["Suez","السويس","Suez Canal"]'::jsonb,560000),
  ('EGY','Port Said','Port Said','Port Said',NULL,31.26,32.3,0.85,'["Port Said","بورسعيد"]'::jsonb,750000),
  ('EGY','Aswan','Aswan','Aswan',NULL,24.09,32.9,0.82,'["Aswan","أسوان"]'::jsonb,290000),
  -- Sudan states
  ('SDN','Khartoum','Khartoum','Khartoum',NULL,15.5,32.56,0.92,'["Khartoum","الخرطوم","Omdurman"]'::jsonb,5300000),
  ('SDN','North Darfur','El Fasher','El Fasher',NULL,13.63,25.35,0.88,'["El Fasher","Al-Fashir","الفاشر"]'::jsonb,260000),
  ('SDN','South Kordofan','Kadugli','Kadugli',NULL,11.02,29.72,0.8,'["Kadugli","كادقلي"]'::jsonb,90000),
  ('SDN','Red Sea','Port Sudan','Port Sudan',NULL,19.62,37.22,0.85,'["Port Sudan","بورتسودان"]'::jsonb,490000)
ON CONFLICT DO NOTHING;

-- Backfill: re-normalize existing rows so historical Algeria/Nigeria/etc. queries work.
UPDATE public.aicis_raw_local_signals
SET country_hint = public.lril_fips_to_iso3(country_hint)
WHERE country_hint IS NOT NULL
  AND length(country_hint) IN (2,3)
  AND public.lril_fips_to_iso3(country_hint) IS DISTINCT FROM country_hint
  AND ingested_at > now() - interval '14 days';
