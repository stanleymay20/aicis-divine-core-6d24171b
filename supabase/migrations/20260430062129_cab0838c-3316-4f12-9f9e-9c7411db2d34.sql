
CREATE OR REPLACE FUNCTION public.lril_fips_to_iso3(p_code text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE upper(coalesce(p_code,''))
    WHEN 'GM' THEN 'DEU' WHEN 'GER' THEN 'DEU'
    WHEN 'UK' THEN 'GBR' WHEN 'EN' THEN 'GBR'
    WHEN 'FR' THEN 'FRA' WHEN 'IT' THEN 'ITA' WHEN 'SP' THEN 'ESP'
    WHEN 'PO' THEN 'PRT' WHEN 'NL' THEN 'NLD' WHEN 'BE' THEN 'BEL'
    WHEN 'SZ' THEN 'CHE' WHEN 'EZ' THEN 'CZE'
    WHEN 'PL' THEN 'POL' WHEN 'HU' THEN 'HUN' WHEN 'RO' THEN 'ROU'
    WHEN 'BU' THEN 'BGR' WHEN 'GR' THEN 'GRC' WHEN 'TU' THEN 'TUR'
    WHEN 'RS' THEN 'RUS' WHEN 'UP' THEN 'UKR' WHEN 'BO' THEN 'BLR'
    WHEN 'IS' THEN 'ISR' WHEN 'IR' THEN 'IRN' WHEN 'IZ' THEN 'IRQ'
    WHEN 'SY' THEN 'SYR' WHEN 'JO' THEN 'JOR' WHEN 'LE' THEN 'LBN'
    WHEN 'SA' THEN 'SAU' WHEN 'YE' THEN 'YEM' WHEN 'AE' THEN 'ARE'
    WHEN 'KU' THEN 'KWT' WHEN 'QA' THEN 'QAT' WHEN 'BA' THEN 'BHR'
    WHEN 'AF' THEN 'AFG' WHEN 'PK' THEN 'PAK' WHEN 'IN' THEN 'IND'
    WHEN 'BG' THEN 'BGD' WHEN 'CE' THEN 'LKA' WHEN 'SRI' THEN 'LKA'
    WHEN 'NP' THEN 'NPL' WHEN 'BT' THEN 'BTN' WHEN 'BM' THEN 'MMR'
    WHEN 'CB' THEN 'KHM' WHEN 'CAM' THEN 'KHM' WHEN 'LA' THEN 'LAO'
    WHEN 'TH' THEN 'THA' WHEN 'VM' THEN 'VNM' WHEN 'MY' THEN 'MYS'
    WHEN 'SN' THEN 'SGP' WHEN 'ID' THEN 'IDN' WHEN 'RP' THEN 'PHL'
    WHEN 'PHI' THEN 'PHL' WHEN 'JA' THEN 'JPN' WHEN 'KS' THEN 'KOR'
    WHEN 'KN' THEN 'PRK' WHEN 'CH' THEN 'CHN' WHEN 'TW' THEN 'TWN'
    WHEN 'HK' THEN 'HKG' WHEN 'AS' THEN 'AUS'
    WHEN 'NZ' THEN 'NZL' WHEN 'NEW' THEN 'NZL' WHEN 'PP' THEN 'PNG'
    WHEN 'FJ' THEN 'FJI' WHEN 'FIJ' THEN 'FJI' WHEN 'CA' THEN 'CAN'
    WHEN 'US' THEN 'USA' WHEN 'MX' THEN 'MEX' WHEN 'BR' THEN 'BRA'
    WHEN 'AR' THEN 'ARG' WHEN 'CI' THEN 'CHL' WHEN 'PE' THEN 'PER'
    WHEN 'CO' THEN 'COL' WHEN 'VE' THEN 'VEN' WHEN 'EC' THEN 'ECU'
    WHEN 'BL' THEN 'BOL' WHEN 'PA' THEN 'PRY' WHEN 'UY' THEN 'URY'
    WHEN 'CU' THEN 'CUB' WHEN 'HA' THEN 'HTI' WHEN 'DR' THEN 'DOM'
    WHEN 'JM' THEN 'JAM' WHEN 'GT' THEN 'GTM' WHEN 'HO' THEN 'HND'
    WHEN 'NU' THEN 'NIC' WHEN 'ES' THEN 'SLV' WHEN 'CS' THEN 'CRI'
    WHEN 'PM' THEN 'PAN' WHEN 'EG' THEN 'EGY' WHEN 'MO' THEN 'MAR'
    WHEN 'AG' THEN 'DZA' WHEN 'TS' THEN 'TUN' WHEN 'LY' THEN 'LBY'
    WHEN 'SU' THEN 'SDN' WHEN 'OD' THEN 'SSD' WHEN 'ET' THEN 'ETH'
    WHEN 'ER' THEN 'ERI' WHEN 'DJ' THEN 'DJI' WHEN 'SO' THEN 'SOM'
    WHEN 'KE' THEN 'KEN' WHEN 'UG' THEN 'UGA' WHEN 'TZ' THEN 'TZA'
    WHEN 'RW' THEN 'RWA' WHEN 'BY' THEN 'BDI' WHEN 'CG' THEN 'COD'
    WHEN 'CF' THEN 'COG' WHEN 'CM' THEN 'CMR' WHEN 'NI' THEN 'NGA'
    WHEN 'NG' THEN 'NER' WHEN 'CD' THEN 'TCD' WHEN 'ML' THEN 'MLI'
    WHEN 'UV' THEN 'BFA' WHEN 'IV' THEN 'CIV' WHEN 'GH' THEN 'GHA'
    WHEN 'TO' THEN 'TGO' WHEN 'BN' THEN 'BEN' WHEN 'SG' THEN 'SEN'
    WHEN 'GA' THEN 'GMB' WHEN 'GV' THEN 'GIN' WHEN 'PU' THEN 'GNB'
    WHEN 'SL' THEN 'SLE' WHEN 'LI' THEN 'LBR' WHEN 'MZ' THEN 'MOZ'
    WHEN 'AO' THEN 'AGO' WHEN 'ZA' THEN 'ZMB' WHEN 'MI' THEN 'MWI'
    WHEN 'ZI' THEN 'ZWE' WHEN 'BC' THEN 'BWA' WHEN 'WA' THEN 'NAM'
    WHEN 'SF' THEN 'ZAF' WHEN 'LT' THEN 'LSO' WHEN 'WZ' THEN 'SWZ'
    WHEN 'MA' THEN 'MDG' WHEN 'MP' THEN 'MUS' WHEN 'EI' THEN 'IRL'
    WHEN 'IC' THEN 'ISL' WHEN 'DA' THEN 'DNK' WHEN 'NO' THEN 'NOR'
    WHEN 'SW' THEN 'SWE' WHEN 'FI' THEN 'FIN'
    WHEN 'LG' THEN 'LVA' WHEN 'LH' THEN 'LTU' WHEN 'AL' THEN 'ALB'
    WHEN 'MK' THEN 'MKD' WHEN 'MJ' THEN 'MNE' WHEN 'KV' THEN 'XKX'
    WHEN 'BK' THEN 'BIH' WHEN 'HR' THEN 'HRV' WHEN 'SI' THEN 'SVN'
    WHEN 'SK' THEN 'SVK' WHEN 'AM' THEN 'ARM' WHEN 'AJ' THEN 'AZE'
    WHEN 'GG' THEN 'GEO' WHEN 'KZ' THEN 'KAZ' WHEN 'KG' THEN 'KGZ'
    WHEN 'TI' THEN 'TJK' WHEN 'TX' THEN 'TKM' WHEN 'UZ' THEN 'UZB'
    WHEN 'MD' THEN 'MDA'
    ELSE NULLIF(upper(p_code), '')
  END;
$$;

CREATE OR REPLACE FUNCTION public.lril_source_tier(p_source text, p_url text)
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  SELECT CASE
    WHEN p_source IN ('gdacs','usgs','nasa_eonet','reliefweb','who','unicef','fao','oecd','imf','worldbank') THEN 0.95
    WHEN coalesce(p_url,'') ~* '(reuters|apnews|afp\.com|bbc\.|aljazeera|bloomberg|nytimes|wsj\.|ft\.com|economist|theguardian|washingtonpost|cnn\.com|dw\.com|france24|rfi\.fr|npr\.org)' THEN 0.85
    WHEN coalesce(p_url,'') ~* '(\.gov\.|\.gov/|europa\.eu|un\.org|nato\.int|worldbank|imf\.org|who\.int)' THEN 0.90
    WHEN coalesce(p_url,'') ~* '(allafrica|africanews|punchng|saharareporters|theeastafrican|nation\.africa|standardmedia|premiumtimes|dailytrust|vanguard)' THEN 0.75
    WHEN coalesce(p_url,'') ~* '(thehindu|indianexpress|timesofindia|ndtv|dawn\.com|geo\.tv|tribune\.com\.pk|prothomalo|thedailystar)' THEN 0.75
    WHEN coalesce(p_url,'') ~* '(scmp\.com|chinadaily|globaltimes|kyodo|asahi|mainichi|koreatimes|koreaherald|yonhap|straitstimes|jakartapost|bangkokpost|manilatimes|inquirer)' THEN 0.75
    WHEN coalesce(p_url,'') ~* '(clarin|lanacion|infobae|globo|folha|estadao|eluniversal|elcomercio|elmercurio|larepublica)' THEN 0.75
    ELSE 0.5
  END;
$$;

CREATE OR REPLACE FUNCTION public.lril_compute_confidence(
  p_source_count int,
  p_avg_source_reliability numeric,
  p_keyword_strength numeric,
  p_geo_confidence numeric,
  p_temporal_density numeric,
  p_proxy_boost numeric DEFAULT 0
) RETURNS numeric LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
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
  RETURN LEAST(1.0, ROUND(base::numeric, 4));
END;
$$;

ALTER TABLE public.aicis_local_events ADD COLUMN IF NOT EXISTS iso3_normalized text;
UPDATE public.aicis_local_events SET iso3_normalized = lril_fips_to_iso3(iso3);

-- Recompute confidence using the avg source tier of the linked raw signals
WITH agg AS (
  SELECT e.id,
         COALESCE(AVG(public.lril_source_tier(s.source_name, s.url)), 0.5) AS avg_tier,
         GREATEST(0.5, LEAST(2.0, jsonb_array_length(e.matched_keywords) * 0.3)) AS kw
  FROM public.aicis_local_events e
  LEFT JOIN public.aicis_raw_local_signals s
    ON s.id::text IN (SELECT jsonb_array_elements_text(e.raw_signal_ids))
  GROUP BY e.id
)
UPDATE public.aicis_local_events e
SET confidence = public.lril_compute_confidence(
  e.source_count,
  agg.avg_tier,
  agg.kw,
  CASE WHEN e.lat IS NOT NULL THEN 0.85 ELSE 0.4 END,
  LEAST(1.0, e.source_count::numeric / 12.0),
  0
)
FROM agg WHERE agg.id = e.id;
