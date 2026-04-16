import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const body = await req.json().catch(() => ({}));
    const batchSize = body.batch_size || 250;
    const timeWindow = body.time_window_minutes || 60;

    // Fetch recent GDELT events via their API
    const gdeltUrl = `https://api.gdeltproject.org/api/v2/doc/doc?query=conflict%20OR%20crisis%20OR%20attack%20OR%20protest%20OR%20earthquake%20OR%20flood%20OR%20famine&mode=ArtList&maxrecords=${batchSize}&format=json&timespan=${timeWindow}min`;

    const gdeltResp = await fetch(gdeltUrl);
    if (!gdeltResp.ok) {
      const errText = await gdeltResp.text();
      console.error('GDELT API error:', gdeltResp.status, errText);
      return new Response(JSON.stringify({ ok: false, error: 'GDELT API error', status: gdeltResp.status }), {
        status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const responseText = await gdeltResp.text();
    let gdeltData: any;
    try {
      gdeltData = JSON.parse(responseText);
    } catch {
      console.warn('GDELT returned non-JSON (rate-limited?):', responseText.slice(0, 200));
      await supabase.from('automation_logs').insert({
        job_name: 'ingest-gdelt', status: 'skipped',
        message: `GDELT rate-limited: ${responseText.slice(0, 100)}`,
      });
      return new Response(JSON.stringify({ ok: true, ingested: 0, message: 'GDELT rate-limited, skipping' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }
    const articles = gdeltData?.articles || [];

    if (articles.length === 0) {
      return new Response(JSON.stringify({ ok: true, ingested: 0, message: 'No new articles' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    // Classify and normalize events
    const events = articles.map((article: any) => {
      const category = classifyEvent(article.title || '', article.seendate || '');
      const country = extractCountryFromDomain(article.domain || '', article.sourcecountry || '');
      
      return {
        event_type: category.type,
        category: category.category,
        title: (article.title || 'Unknown event').slice(0, 500),
        description: (article.title || '').slice(0, 1000),
        source_url: article.url || null,
        source_name: article.domain || 'gdelt',
        country_iso3: country,
        severity: category.severity,
        confidence: 0.7,
        occurred_at: parseGdeltDate(article.seendate),
        raw_data: {
          tone: article.tone,
          language: article.language,
          socialimage: article.socialimage,
        },
        dedup_key: `gdelt_${hashString(article.url || article.title || '')}`,
      };
    });

    // Upsert into normalized_events
    const { data: insertedData, error: insertError } = await supabase
      .from('normalized_events')
      .upsert(events, { onConflict: 'dedup_key', ignoreDuplicates: true })
      .select('id');

    if (insertError) {
      console.error('Insert error:', insertError);
      return new Response(JSON.stringify({ ok: false, error: insertError.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const ingested = insertedData?.length || 0;

    // Log automation result
    await supabase.from('automation_logs').insert({
      job_name: 'gdelt-ingest',
      status: 'success',
      message: `Ingested ${ingested} events from ${articles.length} GDELT articles`,
    });

    return new Response(JSON.stringify({
      ok: true,
      ingested,
      total_articles: articles.length,
      message: `Successfully ingested ${ingested} events`,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('GDELT ingest error:', error);
    return new Response(JSON.stringify({
      ok: false, error: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});

function classifyEvent(title: string, date: string): { type: string; category: string; severity: number } {
  const t = title.toLowerCase();
  
  if (t.match(/attack|bomb|explosion|shoot|kill|terror|militia/)) {
    return { type: 'conflict', category: 'security', severity: 8 };
  }
  if (t.match(/protest|riot|demonstrat|unrest|strike/)) {
    return { type: 'civil_unrest', category: 'political_stability', severity: 6 };
  }
  if (t.match(/earthquake|tsunami|volcano|hurricane|cyclone|typhoon/)) {
    return { type: 'natural_disaster', category: 'climate', severity: 9 };
  }
  if (t.match(/flood|drought|wildfire|storm|landslide/)) {
    return { type: 'weather_event', category: 'climate', severity: 7 };
  }
  if (t.match(/famine|hunger|food crisis|starvation/)) {
    return { type: 'food_crisis', category: 'food', severity: 9 };
  }
  if (t.match(/outbreak|epidemic|pandemic|disease|virus|infection/)) {
    return { type: 'health_emergency', category: 'health', severity: 8 };
  }
  if (t.match(/election|vote|coup|impeach|resign/)) {
    return { type: 'political_event', category: 'governance', severity: 5 };
  }
  if (t.match(/sanction|tariff|trade war|embargo/)) {
    return { type: 'economic_event', category: 'finance', severity: 6 };
  }
  if (t.match(/blackout|power outage|energy crisis|oil|gas/)) {
    return { type: 'energy_event', category: 'energy', severity: 6 };
  }
  if (t.match(/refugee|migrat|displac|asylum/)) {
    return { type: 'migration', category: 'demographics', severity: 6 };
  }
  
  return { type: 'general', category: 'general', severity: 3 };
}

function extractCountryFromDomain(domain: string, sourceCountry: string): string | null {
  if (sourceCountry && sourceCountry.length === 2) {
    const iso2to3: Record<string, string> = {
      'US': 'USA', 'GB': 'GBR', 'FR': 'FRA', 'DE': 'DEU', 'JP': 'JPN',
      'CN': 'CHN', 'IN': 'IND', 'BR': 'BRA', 'RU': 'RUS', 'AU': 'AUS',
      'CA': 'CAN', 'MX': 'MEX', 'NG': 'NGA', 'ZA': 'ZAF', 'EG': 'EGY',
      'TR': 'TUR', 'ID': 'IDN', 'PK': 'PAK', 'KE': 'KEN', 'GH': 'GHA',
      'UA': 'UKR', 'PL': 'POL', 'IT': 'ITA', 'ES': 'ESP', 'NL': 'NLD',
      'SE': 'SWE', 'NO': 'NOR', 'KR': 'KOR', 'IL': 'ISR', 'SA': 'SAU',
      'AE': 'ARE', 'IQ': 'IRQ', 'IR': 'IRN', 'SY': 'SYR', 'AF': 'AFG',
      'YE': 'YEM', 'SO': 'SOM', 'SD': 'SDN', 'ET': 'ETH', 'CD': 'COD',
      'CO': 'COL', 'AR': 'ARG', 'CL': 'CHL', 'PE': 'PER', 'VE': 'VEN',
      'PH': 'PHL', 'VN': 'VNM', 'TH': 'THA', 'MM': 'MMR', 'MY': 'MYS',
      'SG': 'SGP', 'BD': 'BGD', 'LK': 'LKA', 'NP': 'NPL',
    };
    return iso2to3[sourceCountry.toUpperCase()] || null;
  }
  return null;
}

function parseGdeltDate(dateStr: string): string {
  if (!dateStr) return new Date().toISOString();
  try {
    // GDELT format: YYYYMMDDTHHmmSS or YYYYMMDD
    if (dateStr.includes('T')) {
      const y = dateStr.slice(0, 4);
      const m = dateStr.slice(4, 6);
      const d = dateStr.slice(6, 8);
      const h = dateStr.slice(9, 11);
      const min = dateStr.slice(11, 13);
      const s = dateStr.slice(13, 15);
      return `${y}-${m}-${d}T${h}:${min}:${s}Z`;
    }
    return new Date(dateStr).toISOString();
  } catch {
    return new Date().toISOString();
  }
}

function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // 32bit integer
  }
  return Math.abs(hash).toString(36);
}
