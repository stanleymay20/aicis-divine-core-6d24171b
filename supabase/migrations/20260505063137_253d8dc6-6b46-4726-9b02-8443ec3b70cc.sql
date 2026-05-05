
-- 1. Detection audit runs (daily Firecrawl-vs-AICIS scoring)
CREATE TABLE IF NOT EXISTS public.detection_audit_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_at timestamptz NOT NULL DEFAULT now(),
  trending_events_checked integer NOT NULL DEFAULT 0,
  events_detected integer NOT NULL DEFAULT 0,
  events_missed integer NOT NULL DEFAULT 0,
  detection_rate numeric(5,2) NOT NULL DEFAULT 0,
  avg_latency_minutes numeric(8,2),
  missed_events jsonb NOT NULL DEFAULT '[]'::jsonb,
  detected_events jsonb NOT NULL DEFAULT '[]'::jsonb,
  query_set text NOT NULL DEFAULT 'global_breaking',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);
ALTER TABLE public.detection_audit_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admin_read_detection_audit" ON public.detection_audit_runs FOR SELECT USING (has_role(auth.uid(),'admin'));
CREATE POLICY "service_write_detection_audit" ON public.detection_audit_runs FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE INDEX IF NOT EXISTS idx_detection_audit_runs_run_at ON public.detection_audit_runs(run_at DESC);

-- 2. Web search sweep queries (editable rolling search list)
CREATE TABLE IF NOT EXISTS public.web_search_sweep_queries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  query text NOT NULL UNIQUE,
  category text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  priority integer NOT NULL DEFAULT 100,
  time_filter text NOT NULL DEFAULT 'qdr:d',
  result_limit integer NOT NULL DEFAULT 8,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.web_search_sweep_queries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "auth_read_sweep_queries" ON public.web_search_sweep_queries FOR SELECT TO authenticated USING (true);
CREATE POLICY "service_manage_sweep_queries" ON public.web_search_sweep_queries FOR ALL TO service_role USING (true) WITH CHECK (true);

INSERT INTO public.web_search_sweep_queries (query, category, priority, time_filter) VALUES
('breaking world news today', 'geopolitical', 10, 'qdr:d'),
('major political crisis OR coup OR sanctions today', 'geopolitical', 15, 'qdr:d'),
('bilateral agreement OR diplomatic deal signed today', 'geopolitical', 20, 'qdr:d'),
('central bank rate decision today', 'central_banking', 20, 'qdr:d'),
('inflation data OR GDP release today', 'economic', 25, 'qdr:d'),
('stock market crash OR currency collapse today', 'financial_markets', 25, 'qdr:d'),
('oil OR gas OR LNG OR diesel OR jet fuel deal OR shortage today', 'energy', 20, 'qdr:d'),
('OPEC OR refinery outage OR pipeline incident today', 'energy', 20, 'qdr:d'),
('tanker hijacked OR ship attacked OR maritime incident', 'maritime_security', 15, 'qdr:d'),
('Houthi OR pirates OR Strait of Hormuz OR Red Sea OR Gulf of Aden incident', 'maritime_security', 15, 'qdr:d'),
('port closure OR shipping disruption OR supply chain crisis today', 'supply_chain', 20, 'qdr:d'),
('semiconductor OR chip OR rare earth shortage today', 'supply_chain', 25, 'qdr:d'),
('war OR ceasefire OR military strike OR missile attack today', 'defense_conflict', 15, 'qdr:d'),
('cyber attack OR ransomware OR data breach today', 'cybersecurity', 25, 'qdr:d'),
('disease outbreak OR pandemic OR WHO alert today', 'public_health', 20, 'qdr:d'),
('earthquake OR flood OR hurricane OR wildfire today', 'climate_disaster', 25, 'qdr:d'),
('protest OR riot OR civil unrest today', 'social_unrest', 30, 'qdr:d'),
('election OR referendum OR vote result today', 'elections', 30, 'qdr:d'),
('food crisis OR grain shortage OR famine today', 'food_agriculture', 30, 'qdr:d'),
('refugee crisis OR migration surge today', 'migration_displacement', 30, 'qdr:d'),
('infrastructure failure OR blackout OR grid down today', 'infrastructure', 30, 'qdr:d'),
('court ruling OR major lawsuit OR regulatory action today', 'legal_regulatory', 35, 'qdr:d'),
('AI regulation OR tech antitrust today', 'technology', 35, 'qdr:d'),
('Asia Pacific breaking news today', 'geopolitical', 40, 'qdr:d'),
('Africa breaking news today', 'geopolitical', 40, 'qdr:d'),
('Middle East breaking news today', 'geopolitical', 40, 'qdr:d'),
('Latin America breaking news today', 'geopolitical', 40, 'qdr:d'),
('Europe breaking news today', 'geopolitical', 40, 'qdr:d'),
('China economy OR policy announcement today', 'geopolitical', 30, 'qdr:d'),
('India OR Indonesia OR Brazil OR Nigeria policy news today', 'geopolitical', 35, 'qdr:d')
ON CONFLICT (query) DO NOTHING;

-- 3. Massive source registry expansion (~120 new official feeds)
INSERT INTO public.signal_source_registry (source_name, source_type, parser_type, urls, official_source, trust_weight, geo_scope, thematic_scope, priority) VALUES
-- Multilateral / UN system
('UNHCR News','official_feed','rss',ARRAY['https://www.unhcr.org/rss/news/en.xml'],true,90,'global',ARRAY['humanitarian','migration_displacement'],20),
('OCHA ReliefWeb Disasters','official_feed','rss',ARRAY['https://reliefweb.int/disasters/rss.xml'],true,92,'global',ARRAY['climate_disaster','humanitarian'],15),
('WMO Press','official_feed','rss',ARRAY['https://public.wmo.int/en/media/press-release/feed'],true,90,'global',ARRAY['climate_disaster'],25),
('OECD Newsroom','official_feed','rss',ARRAY['https://www.oecd.org/en/about/news.xml'],true,88,'global',ARRAY['economic','geopolitical'],30),
('IAEA News','official_feed','rss',ARRAY['https://www.iaea.org/news/feed'],true,92,'global',ARRAY['energy','defense_conflict'],20),
('OPCW News','official_feed','rss',ARRAY['https://www.opcw.org/media-centre/news/rss.xml'],true,90,'global',ARRAY['defense_conflict'],30),
('IOM News','official_feed','rss',ARRAY['https://www.iom.int/rss.xml'],true,88,'global',ARRAY['migration_displacement'],30),
('World Bank News','official_feed','rss',ARRAY['https://www.worldbank.org/en/news/all?format=atom'],true,88,'global',ARRAY['economic','financial_markets'],30),
('UN OCHA News','official_feed','rss',ARRAY['https://www.unocha.org/news/rss.xml'],true,90,'global',ARRAY['humanitarian'],25),
('WFP News','official_feed','rss',ARRAY['https://www.wfp.org/news/rss.xml'],true,88,'global',ARRAY['food_agriculture','humanitarian'],25),
('NATO News','official_feed','rss',ARRAY['https://www.nato.int/cps/en/natohq/news.rss'],true,90,'global',ARRAY['defense_conflict','geopolitical'],20),
('European Council News','official_feed','rss',ARRAY['https://www.consilium.europa.eu/en/press/press-releases/?dateFrom=&dateTo=&keyword=&format=rss'],true,88,'global',ARRAY['geopolitical','economic'],25),
('European Commission News','official_feed','rss',ARRAY['https://ec.europa.eu/commission/presscorner/api/rss?language=en'],true,88,'global',ARRAY['geopolitical','legal_regulatory'],25),
('ECB Banking Supervision','official_feed','rss',ARRAY['https://www.bankingsupervision.europa.eu/press/rss/index.en.html'],true,90,'global',ARRAY['central_banking','financial_markets'],25),
-- North America
('US State Department','official_feed','rss',ARRAY['https://www.state.gov/feed/'],true,88,'global',ARRAY['geopolitical'],20),
('US Treasury Press','official_feed','rss',ARRAY['https://home.treasury.gov/news/press-releases/feed'],true,88,'global',ARRAY['economic','financial_markets'],25),
('US Department of Defense','official_feed','rss',ARRAY['https://www.defense.gov/DesktopModules/ArticleCS/RSS.ashx?ContentType=1'],true,86,'global',ARRAY['defense_conflict'],25),
('US Department of Energy','official_feed','rss',ARRAY['https://www.energy.gov/articles/feed'],true,86,'global',ARRAY['energy'],30),
('US CDC Newsroom','official_feed','rss',ARRAY['https://tools.cdc.gov/api/v2/resources/media/132608.rss'],true,88,'global',ARRAY['public_health'],25),
('USGS Earthquake News','official_feed','rss',ARRAY['https://www.usgs.gov/news/feed'],true,88,'global',ARRAY['climate_disaster'],30),
('NHC Atlantic Tropical','official_feed','rss',ARRAY['https://www.nhc.noaa.gov/index-at.xml'],true,90,'global',ARRAY['climate_disaster'],30),
('Bank of Canada','official_feed','rss',ARRAY['https://www.bankofcanada.ca/content_type/press-releases/feed/'],true,86,'global',ARRAY['central_banking'],35),
('Government of Canada News','official_feed','rss',ARRAY['https://api.io.canada.ca/io-server/gc/news/en/v2?dept=&type=newsreleases&pick=100&format=atom'],true,84,'global',ARRAY['geopolitical'],35),
-- UK & Europe
('UK Government','official_feed','rss',ARRAY['https://www.gov.uk/government/announcements.atom'],true,86,'global',ARRAY['geopolitical'],25),
('Bank of England','official_feed','rss',ARRAY['https://www.bankofengland.co.uk/news/rss?relatedTaxonomy=News'],true,88,'global',ARRAY['central_banking','financial_markets'],25),
('UK MoD','official_feed','rss',ARRAY['https://www.gov.uk/government/organisations/ministry-of-defence.atom'],true,84,'global',ARRAY['defense_conflict'],30),
('UK FCDO','official_feed','rss',ARRAY['https://www.gov.uk/government/organisations/foreign-commonwealth-development-office.atom'],true,84,'global',ARRAY['geopolitical'],30),
('France Diplomatie','official_feed','rss',ARRAY['https://www.diplomatie.gouv.fr/spip.php?page=backend-fd&lang=en'],true,84,'global',ARRAY['geopolitical'],30),
('Banque de France','official_feed','rss',ARRAY['https://www.banque-france.fr/en/rss-press-releases.xml'],true,84,'global',ARRAY['central_banking'],35),
('German Foreign Office','official_feed','rss',ARRAY['https://www.auswaertiges-amt.de/en/newsroom/news.atom'],true,84,'global',ARRAY['geopolitical'],30),
('Bundesbank','official_feed','rss',ARRAY['https://www.bundesbank.de/service/rss/en/633286/feed.rss'],true,86,'global',ARRAY['central_banking'],30),
('Italy MFA','official_feed','rss',ARRAY['https://www.esteri.it/en/sala_stampa/feed/'],true,80,'global',ARRAY['geopolitical'],40),
('Spain MFA','official_feed','rss',ARRAY['https://www.exteriores.gob.es/en/SalaDePrensa/_layouts/15/listfeed.aspx?List={9bcaeb6d-a2cd-4c6c-a3d0-2cb13b08c6e3}'],true,80,'global',ARRAY['geopolitical'],40),
-- Asia-Pacific governments
('China MFA','official_feed','rss',ARRAY['https://www.fmprc.gov.cn/eng/wjbxw/rss.xml'],true,82,'global',ARRAY['geopolitical'],25),
('Japan MOFA','official_feed','rss',ARRAY['https://www.mofa.go.jp/announce/rss/jmofa_announce.xml'],true,84,'global',ARRAY['geopolitical'],25),
('Bank of Japan','official_feed','rss',ARRAY['https://www.boj.or.jp/en/rss/whatsnew.xml'],true,86,'global',ARRAY['central_banking'],30),
('Korea MOFA','official_feed','rss',ARRAY['https://www.mofa.go.kr/eng/board/rss/m_5676/list.do'],true,82,'global',ARRAY['geopolitical'],30),
('Bank of Korea','official_feed','rss',ARRAY['https://www.bok.or.kr/eng/rssfeed/main.rss?menuNo=400069'],true,82,'global',ARRAY['central_banking'],35),
('Australia DFAT','official_feed','rss',ARRAY['https://www.dfat.gov.au/news/rss.xml'],true,84,'global',ARRAY['geopolitical'],30),
('Reserve Bank of Australia','official_feed','rss',ARRAY['https://www.rba.gov.au/rss/rss-cb-media-releases.xml'],true,86,'global',ARRAY['central_banking'],30),
('Government of India PIB','official_feed','rss',ARRAY['https://pib.gov.in/RssMain.aspx?ModId=6&Lang=1&Regid=3'],true,80,'global',ARRAY['geopolitical','economic'],30),
('Reserve Bank of India','official_feed','rss',ARRAY['https://rbi.org.in/Scripts/Rss.aspx?Cat=4'],true,84,'global',ARRAY['central_banking'],30),
('India MEA','official_feed','rss',ARRAY['https://www.mea.gov.in/press-releases.htm?51/Press_Releases'],true,80,'global',ARRAY['geopolitical'],35),
('Indonesia MFA','official_feed','rss',ARRAY['https://kemlu.go.id/portal/en/feed/news'],true,76,'global',ARRAY['geopolitical'],40),
('Vietnam MFA','official_feed','rss',ARRAY['https://www.mofa.gov.vn/en_us/tt_baochi/rss/index.html'],true,74,'global',ARRAY['geopolitical'],45),
('Thailand MFA','official_feed','rss',ARRAY['https://www.mfa.go.th/en/rss/news_press_release'],true,76,'global',ARRAY['geopolitical'],45),
('Philippines DFA','official_feed','rss',ARRAY['https://dfa.gov.ph/dfa-news/rss'],true,76,'global',ARRAY['geopolitical'],45),
-- Latin America
('Brazil Itamaraty','official_feed','rss',ARRAY['https://www.gov.br/mre/pt-br/canais_atendimento/imprensa/notas-a-imprensa/RSS'],true,80,'global',ARRAY['geopolitical'],35),
('Banco Central do Brasil','official_feed','rss',ARRAY['https://www.bcb.gov.br/api/feed/sitebcb/notas-imprensa'],true,82,'global',ARRAY['central_banking'],35),
('Argentina MFA','official_feed','rss',ARRAY['https://www.cancilleria.gob.ar/es/actualidad/feed'],true,76,'global',ARRAY['geopolitical'],45),
('Mexico SRE','official_feed','rss',ARRAY['https://www.gob.mx/sre/rss'],true,78,'global',ARRAY['geopolitical'],40),
('Banxico','official_feed','rss',ARRAY['https://www.banxico.org.mx/rss-news/banxico-news.xml'],true,82,'global',ARRAY['central_banking'],35),
-- Middle East
('Saudi MoFA','official_feed','rss',ARRAY['https://www.mofa.gov.sa/sites/mofaen/HomeNewsRSS/Pages/HomeNewsRSS.aspx'],true,78,'global',ARRAY['geopolitical','energy'],35),
('UAE MoFA','official_feed','rss',ARRAY['https://www.mofa.gov.ae/en/RSSFeeds/News'],true,78,'global',ARRAY['geopolitical'],35),
('Israel MFA','official_feed','rss',ARRAY['https://www.gov.il/en/Departments/news/rss?OfficeId=1485f3b4-ac4d-43a3-aa57-c5d1c7a35d9f'],true,80,'global',ARRAY['geopolitical','defense_conflict'],30),
('Turkey MFA','official_feed','rss',ARRAY['https://www.mfa.gov.tr/site_media/_assets/rss/dt-en.xml'],true,76,'global',ARRAY['geopolitical'],40),
-- Africa
('African Union','official_feed','rss',ARRAY['https://au.int/en/feed/pressrelease'],true,82,'global',ARRAY['geopolitical','humanitarian'],30),
('South Africa DIRCO','official_feed','rss',ARRAY['https://www.dirco.gov.za/rss/rss.xml'],true,76,'global',ARRAY['geopolitical'],40),
('South African Reserve Bank','official_feed','rss',ARRAY['https://www.resbank.co.za/en/home/publications/RSS-Feeds/Latest-News'],true,80,'global',ARRAY['central_banking'],40),
('Kenya MFA','official_feed','rss',ARRAY['https://mfa.go.ke/feed/'],true,72,'global',ARRAY['geopolitical'],50),
('Nigeria MFA','official_feed','rss',ARRAY['https://foreignaffairs.gov.ng/feed/'],true,72,'global',ARRAY['geopolitical'],50),
-- Russia
('Russia MFA','official_feed','rss',ARRAY['https://www.mid.ru/en/foreign_policy/news/rss/'],true,72,'global',ARRAY['geopolitical'],35),
-- Maritime / aviation security
('UKMTO Warnings','official_feed','rss',ARRAY['https://www.ukmto.org/rss-feeds/incidents'],true,90,'global',ARRAY['maritime_security'],10),
('IMB Piracy','official_feed','rss',ARRAY['https://www.icc-ccs.org/index.php?option=com_content&view=category&id=60&format=feed&type=rss'],true,88,'global',ARRAY['maritime_security'],15),
('MARAD Advisories','official_feed','rss',ARRAY['https://www.maritime.dot.gov/rss/news.xml'],true,86,'global',ARRAY['maritime_security','shipping'],15),
('EUNAVFOR Atalanta','official_feed','rss',ARRAY['https://eunavfor.eu/feed'],true,86,'global',ARRAY['maritime_security'],15),
('EMSA Maritime','official_feed','rss',ARRAY['https://www.emsa.europa.eu/news-a-press-centre/news.rss'],true,84,'global',ARRAY['maritime_security','shipping'],20),
('FAA Press','official_feed','rss',ARRAY['https://www.faa.gov/newsroom/all-newsroom?field_news_release_type_value=rss'],true,84,'global',ARRAY['aviation','infrastructure'],25),
('EASA News','official_feed','rss',ARRAY['https://www.easa.europa.eu/en/newsroom-and-events/news/rss.xml'],true,84,'global',ARRAY['aviation'],30),
-- Energy / commodity
('OPEC News','official_feed','rss',ARRAY['https://www.opec.org/opec_web/en/feeds/press_releases.rss'],true,86,'global',ARRAY['energy'],20),
('IEA Oil Market','official_feed','rss',ARRAY['https://www.iea.org/topics/oil-market-report/rss'],true,86,'global',ARRAY['energy'],25),
('ENTSO-E News','official_feed','rss',ARRAY['https://www.entsoe.eu/news/feed/'],true,82,'global',ARRAY['energy','infrastructure'],30),
('NRC Press','official_feed','rss',ARRAY['https://www.nrc.gov/public-involve/news/news-rss.xml'],true,84,'global',ARRAY['energy'],35),
-- Cyber
('NCSC UK Advisories','official_feed','rss',ARRAY['https://www.ncsc.gov.uk/api/1/services/v1/news-rss-feed.xml'],true,88,'global',ARRAY['cybersecurity'],20),
('ENISA Press','official_feed','rss',ARRAY['https://www.enisa.europa.eu/news/enisa-news/RSS'],true,84,'global',ARRAY['cybersecurity'],25),
('US-CERT Alerts','official_feed','rss',ARRAY['https://www.cisa.gov/uscert/ncas/alerts.xml'],true,88,'global',ARRAY['cybersecurity'],15),
-- Finance / market regulators
('US SEC Press','official_feed','rss',ARRAY['https://www.sec.gov/news/pressreleases.rss'],true,84,'global',ARRAY['financial_markets','legal_regulatory'],25),
('FINRA News','official_feed','rss',ARRAY['https://www.finra.org/about/newsroom/rss'],true,80,'global',ARRAY['financial_markets'],35),
('BIS News','official_feed','rss',ARRAY['https://www.bis.org/list/press_releases/index.rss'],true,88,'global',ARRAY['central_banking','financial_markets'],25),
-- Public health / disease
('ECDC News','official_feed','rss',ARRAY['https://www.ecdc.europa.eu/en/taxonomy/term/13/all/feed'],true,88,'global',ARRAY['public_health'],25),
('WOAH Animal Health','official_feed','rss',ARRAY['https://www.woah.org/en/feed/'],true,82,'global',ARRAY['public_health','food_agriculture'],35),
-- Climate / disaster
('GDACS Alerts','official_feed','rss',ARRAY['https://www.gdacs.org/xml/rss.xml'],true,90,'global',ARRAY['climate_disaster'],10),
('Copernicus Emergency','official_feed','rss',ARRAY['https://emergency.copernicus.eu/mapping/list-of-activations-rapid/rss.xml'],true,86,'global',ARRAY['climate_disaster'],20),
('NOAA News','official_feed','rss',ARRAY['https://www.noaa.gov/news/rss.xml'],true,84,'global',ARRAY['climate_disaster'],25),
-- Election watchdogs
('IFES Elections','official_feed','rss',ARRAY['https://www.ifes.org/rss.xml'],true,80,'global',ARRAY['elections','geopolitical'],30),
-- Tier-1 wires & quality regional aggregators
('Reuters World','tier1_wire','rss',ARRAY['https://feeds.reuters.com/Reuters/worldNews'],false,80,'global',ARRAY['geopolitical'],20),
('Reuters Business','tier1_wire','rss',ARRAY['https://feeds.reuters.com/reuters/businessNews'],false,80,'global',ARRAY['economic','financial_markets'],25),
('Reuters Energy','tier1_wire','rss',ARRAY['https://feeds.reuters.com/reuters/energyNews'],false,80,'global',ARRAY['energy'],25),
('AP World','tier1_wire','rss',ARRAY['https://feeds.apnews.com/apf-topnews'],false,80,'global',ARRAY['geopolitical'],20),
('AFP English','tier1_wire','rss',ARRAY['https://www.afp.com/en/news-hub/rss'],false,80,'global',ARRAY['geopolitical'],25),
('BBC World','tier1_wire','rss',ARRAY['https://feeds.bbci.co.uk/news/world/rss.xml'],false,80,'global',ARRAY['geopolitical'],25),
('Al Jazeera English','tier1_wire','rss',ARRAY['https://www.aljazeera.com/xml/rss/all.xml'],false,76,'global',ARRAY['geopolitical'],30),
('Xinhua World','tier2_wire','rss',ARRAY['http://www.xinhuanet.com/english/rss/worldrss.xml'],false,68,'global',ARRAY['geopolitical'],40),
('Kyodo News','tier1_wire','rss',ARRAY['https://english.kyodonews.net/rss/news.xml'],false,76,'global',ARRAY['geopolitical'],35),
('Yonhap News','tier1_wire','rss',ARRAY['https://en.yna.co.kr/RSS/news.xml'],false,76,'global',ARRAY['geopolitical'],35),
('Anadolu Agency','tier1_wire','rss',ARRAY['https://www.aa.com.tr/en/rss/default?cat=guncel'],false,72,'global',ARRAY['geopolitical'],40),
('TASS English','tier2_wire','rss',ARRAY['https://tass.com/rss/v2.xml'],false,68,'global',ARRAY['geopolitical'],45),
('AllAfrica','tier2_wire','rss',ARRAY['https://allafrica.com/tools/headlines/rdf/latest/headlines.rdf'],false,72,'global',ARRAY['geopolitical','humanitarian'],40),
('MercoPress','tier2_wire','rss',ARRAY['https://en.mercopress.com/rss/'],false,72,'global',ARRAY['geopolitical'],45),
('Times of India World','tier2_wire','rss',ARRAY['https://timesofindia.indiatimes.com/rssfeeds/296589292.cms'],false,72,'global',ARRAY['geopolitical'],45),
('Bernama','tier2_wire','rss',ARRAY['https://www.bernama.com/en/rss/news_general.xml'],false,70,'global',ARRAY['geopolitical'],45),
('Antara News','tier2_wire','rss',ARRAY['https://en.antaranews.com/rss/news.xml'],false,70,'global',ARRAY['geopolitical'],45),
('Channel News Asia','tier1_wire','rss',ARRAY['https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml&category=6511'],false,76,'global',ARRAY['geopolitical'],35),
('Nikkei Asia','tier1_wire','rss',ARRAY['https://asia.nikkei.com/rss/feed/nar'],false,78,'global',ARRAY['economic','geopolitical'],30),
('South China Morning Post','tier1_wire','rss',ARRAY['https://www.scmp.com/rss/91/feed'],false,74,'global',ARRAY['geopolitical'],35),
('Hindustan Times World','tier2_wire','rss',ARRAY['https://www.hindustantimes.com/feeds/rss/world-news/rssfeed.xml'],false,70,'global',ARRAY['geopolitical'],45),
('Economic Times Markets','tier2_wire','rss',ARRAY['https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms'],false,72,'global',ARRAY['financial_markets'],40),
('Bloomberg Quint','tier2_wire','rss',ARRAY['https://www.bqprime.com/feed'],false,72,'global',ARRAY['financial_markets'],40),
('Politico EU','tier1_wire','rss',ARRAY['https://www.politico.eu/feed/'],false,76,'global',ARRAY['geopolitical'],35),
('Le Monde Diplomatique','tier2_wire','rss',ARRAY['https://mondediplo.com/spip.php?page=backend-en'],false,70,'global',ARRAY['geopolitical'],45),
('Deutsche Welle','tier1_wire','rss',ARRAY['https://rss.dw.com/rdf/rss-en-all'],false,76,'global',ARRAY['geopolitical'],35),
('France24 English','tier1_wire','rss',ARRAY['https://www.france24.com/en/rss'],false,74,'global',ARRAY['geopolitical'],35),
('CNBC World','tier2_wire','rss',ARRAY['https://www.cnbc.com/id/100727362/device/rss/rss.html'],false,72,'global',ARRAY['economic','financial_markets'],40),
('Financial Times World','tier1_wire','rss',ARRAY['https://www.ft.com/world?format=rss'],false,80,'global',ARRAY['economic','geopolitical'],30),
('The Guardian World','tier1_wire','rss',ARRAY['https://www.theguardian.com/world/rss'],false,76,'global',ARRAY['geopolitical'],35),
('Maritime Executive','tier2_wire','rss',ARRAY['https://www.maritime-executive.com/articles.rss'],false,72,'global',ARRAY['maritime_security','shipping'],30),
('gCaptain','tier2_wire','rss',ARRAY['https://gcaptain.com/feed/'],false,70,'global',ARRAY['maritime_security','shipping'],30),
('Splash247','tier2_wire','rss',ARRAY['https://splash247.com/feed/'],false,70,'global',ARRAY['maritime_security','shipping'],35),
('Lloyd''s List','tier2_wire','rss',ARRAY['https://lloydslist.maritimeintelligence.informa.com/rss/news.xml'],false,76,'global',ARRAY['maritime_security','shipping'],30),
('Aviation Week','tier2_wire','rss',ARRAY['https://aviationweek.com/rss.xml'],false,72,'global',ARRAY['aviation'],35),
('JANE''s Defence','tier2_wire','rss',ARRAY['https://www.janes.com/feeds/news'],false,76,'global',ARRAY['defense_conflict'],30),
('CSIS Analysis','tier2_wire','rss',ARRAY['https://www.csis.org/rss.xml'],false,74,'global',ARRAY['geopolitical','defense_conflict'],35),
('Brookings Foreign Policy','tier2_wire','rss',ARRAY['https://www.brookings.edu/topic/foreign-policy/feed/'],false,74,'global',ARRAY['geopolitical'],40),
('Council on Foreign Relations','tier2_wire','rss',ARRAY['https://www.cfr.org/rss-feeds/all-publications.xml'],false,76,'global',ARRAY['geopolitical'],35),
('Crisis Group','tier2_wire','rss',ARRAY['https://www.crisisgroup.org/rss.xml'],false,80,'global',ARRAY['geopolitical','defense_conflict'],25)
ON CONFLICT (source_name) DO UPDATE SET
  urls = EXCLUDED.urls,
  parser_type = EXCLUDED.parser_type,
  trust_weight = EXCLUDED.trust_weight,
  thematic_scope = EXCLUDED.thematic_scope,
  priority = EXCLUDED.priority,
  enabled = true,
  updated_at = now();
