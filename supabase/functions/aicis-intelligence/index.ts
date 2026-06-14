import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface QueryContext {
  alerts: unknown[];
  crises: unknown[];
  incidents: unknown[];
  intel: unknown[];
  countryData: unknown[];
  vulnerabilities: unknown[];
  healthData: unknown[];
  foodData: unknown[];
  energyData: unknown[];
  economicData: unknown[];
  governanceData: unknown[];
}

interface DashboardCard {
  id: string;
  title: string;
  value: string | number;
  trend?: "up" | "down" | "stable";
  trendValue?: string;
  riskLevel?: "low" | "medium" | "high" | "critical";
  source?: string;
  division: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Require authenticated user + Sovereign tier (server-side gate)
  const { requireTier } = await import("../_shared/auth.ts");
  const { ctx, response: gate } = await requireTier(req, "sovereign", corsHeaders);
  if (gate || !ctx) return gate!;
  const user = ctx.user;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  // Operator/analyst/admin role is still required on top of tier
  const { data: roles } = await supabase
    .from('user_roles').select('role').eq('user_id', user.id);
  const allowed = roles?.some((r: any) => ['admin', 'operator', 'analyst'].includes(r.role));
  if (!allowed) {
    return new Response(JSON.stringify({ error: 'Forbidden', reason: 'role_required' }), {
      status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  try {
    const { query, conversationHistory = [] } = await req.json();

    if (!query || typeof query !== "string" || query.length > 4000) {
      return new Response(
        JSON.stringify({ error: "Valid query is required (max 4000 chars)" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("AICIS Intelligence Query:", query);

    // Extract location/country mentions from the query
    const locations = extractLocations(query);
    const topics = extractTopics(query);
    
    // Gather relevant context from the database
    const context = await gatherContext(supabase, locations, topics, query);
    
    // Generate auto-dashboards based on context
    const dashboards = generateDashboards(context, topics, locations);
    
    // Determine severity based on data
    const severity = determineSeverity(context, dashboards);
    
    // Calculate confidence based on data availability
    const confidence = calculateConfidence(context);
    
    // Identify affected divisions
    const divisions = identifyDivisions(topics, context);
    
    // Build the system prompt with real data context
    const systemPrompt = buildSystemPrompt(context, locations, topics);
    
    // Call Lovable AI for intelligent response
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) {
      throw new Error("LOVABLE_API_KEY not configured");
    }

    const messages = [
      { role: "system", content: systemPrompt },
      ...conversationHistory.slice(-10),
      { role: "user", content: query }
    ];

    const aiResponse = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages,
        temperature: 0.7,
        max_tokens: 2000,
      }),
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error("AI API error:", aiResponse.status, errorText);
      
      if (aiResponse.status === 429) {
        return new Response(
          JSON.stringify({ error: "Rate limit exceeded. Please try again in a moment." }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      if (aiResponse.status === 402) {
        return new Response(
          JSON.stringify({ error: "AI credits exhausted. Please add credits to continue." }),
          { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      throw new Error(`AI gateway error: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    const responseContent = aiData.choices?.[0]?.message?.content || "I couldn't generate a response. Please try again.";

    // Log the intelligence query for analytics
    try {
      await supabase.from("intel_events").insert({
        division: "system",
        event_type: "intelligence_query",
        severity: severity === "critical" ? "critical" : severity === "high" ? "high" : "info",
        title: `Query: ${query.substring(0, 100)}`,
        description: `User queried AICIS intelligence system`,
        payload: { 
          query, 
          locations_detected: locations, 
          topics_detected: topics,
          context_items: {
            alerts: context.alerts.length,
            crises: context.crises.length,
            incidents: context.incidents.length,
            intel: context.intel.length,
          }
        },
        source_system: "AICIS Intelligence",
      });
    } catch (logError) {
      console.error("Failed to log intel event:", logError);
    }

    // Identify location coordinates if available
    const location = await resolveLocation(supabase, locations);

    // Compile sources
    const sources = compileSources(context, topics);

    // Generate actionable guidance for the queried region/country
    const guidance = generateActionableGuidance(context, locations, topics);
    
    // Calculate data completeness for transparency
    const dataCompleteness = calculateDataCompleteness(context);

    return new Response(
      JSON.stringify({
        success: true,
        response: responseContent,
        summary: responseContent.substring(0, 500),
        briefing: responseContent,
        severity,
        confidence,
        divisions,
        dashboards,
        sources,
        location,
        guidance,
        dataCompleteness,
        metadata: {
          locations_analyzed: locations,
          topics: topics,
          data_sources: {
            alerts: context.alerts.length,
            crises: context.crises.length,
            incidents: context.incidents.length,
            intel_events: context.intel.length,
            country_data: context.countryData.length,
          },
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("AICIS Intelligence error:", error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : "Unknown error",
        response: "I encountered an error processing your request. Please try rephrasing your question.",
        summary: "Unable to complete analysis. Please try again.",
        severity: "low",
        confidence: 0,
        divisions: [],
        dashboards: [],
        sources: ["AICIS Core - Error Recovery"],
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// Extract location mentions from query - enhanced for global coverage
function extractLocations(query: string): string[] {
  const q = query.toLowerCase();
  const locations: string[] = [];

  // Common country/region patterns - covering more of the world
  const countryPatterns: Record<string, string[]> = {
    // Middle East & North Africa
    "Syria": ["syria", "syrian", "damascus", "aleppo"],
    "Yemen": ["yemen", "yemeni", "sanaa", "aden"],
    "Palestine": ["palestine", "palestinian", "gaza", "west bank"],
    "Israel": ["israel", "israeli", "tel aviv", "jerusalem"],
    "Lebanon": ["lebanon", "lebanese", "beirut"],
    "Iraq": ["iraq", "iraqi", "baghdad", "mosul"],
    "Iran": ["iran", "iranian", "tehran"],
    "Saudi Arabia": ["saudi", "riyadh", "jeddah"],
    "UAE": ["uae", "emirates", "dubai", "abu dhabi"],
    "Egypt": ["egypt", "egyptian", "cairo", "alexandria"],
    "Libya": ["libya", "libyan", "tripoli", "benghazi"],
    "Algeria": ["algeria", "algerian", "algiers"],
    "Morocco": ["morocco", "moroccan", "rabat", "casablanca"],
    "Tunisia": ["tunisia", "tunisian", "tunis"],
    "Jordan": ["jordan", "jordanian", "amman"],
    
    // Sub-Saharan Africa
    "Sudan": ["sudan", "sudanese", "khartoum", "darfur"],
    "South Sudan": ["south sudan", "juba"],
    "Ethiopia": ["ethiopia", "ethiopian", "addis ababa", "tigray"],
    "Somalia": ["somalia", "somali", "mogadishu"],
    "Kenya": ["kenya", "kenyan", "nairobi"],
    "Nigeria": ["nigeria", "nigerian", "lagos", "abuja"],
    "DRC": ["congo", "drc", "kinshasa", "goma"],
    "South Africa": ["south africa", "johannesburg", "cape town", "pretoria"],
    "Mali": ["mali", "malian", "bamako"],
    "Burkina Faso": ["burkina", "ouagadougou"],
    "Niger": ["niger", "niamey"],
    "Chad": ["chad", "ndjamena"],
    "Cameroon": ["cameroon", "cameroonian", "yaounde"],
    "Central African Republic": ["central african", "car", "bangui"],
    "Mozambique": ["mozambique", "maputo"],
    "Zimbabwe": ["zimbabwe", "harare"],
    "Rwanda": ["rwanda", "kigali"],
    "Uganda": ["uganda", "kampala"],
    "Tanzania": ["tanzania", "dar es salaam"],
    "Ghana": ["ghana", "accra"],
    "Senegal": ["senegal", "dakar"],
    
    // Europe
    "Ukraine": ["ukraine", "ukrainian", "kyiv", "kiev", "donbas", "crimea", "kharkiv"],
    "Russia": ["russia", "russian", "moscow", "st petersburg"],
    "Germany": ["germany", "german", "berlin", "munich"],
    "France": ["france", "french", "paris", "lyon"],
    "UK": ["uk", "britain", "british", "england", "london"],
    "Italy": ["italy", "italian", "rome", "milan"],
    "Spain": ["spain", "spanish", "madrid", "barcelona"],
    "Poland": ["poland", "polish", "warsaw"],
    "Romania": ["romania", "bucharest"],
    "Netherlands": ["netherlands", "dutch", "amsterdam"],
    "Belgium": ["belgium", "brussels"],
    "Greece": ["greece", "greek", "athens"],
    "Turkey": ["turkey", "turkish", "ankara", "istanbul"],
    "Serbia": ["serbia", "belgrade"],
    "Hungary": ["hungary", "budapest"],
    "Sweden": ["sweden", "stockholm"],
    "Norway": ["norway", "oslo"],
    "Finland": ["finland", "helsinki"],
    "Denmark": ["denmark", "copenhagen"],
    "Austria": ["austria", "vienna"],
    "Switzerland": ["switzerland", "swiss", "zurich", "geneva"],
    
    // Asia
    "China": ["china", "chinese", "beijing", "shanghai", "hong kong"],
    "India": ["india", "indian", "delhi", "mumbai", "bangalore"],
    "Pakistan": ["pakistan", "pakistani", "karachi", "islamabad", "lahore"],
    "Bangladesh": ["bangladesh", "dhaka"],
    "Afghanistan": ["afghanistan", "afghan", "kabul", "kandahar"],
    "Myanmar": ["myanmar", "burma", "burmese", "yangon", "rohingya"],
    "Thailand": ["thailand", "thai", "bangkok"],
    "Vietnam": ["vietnam", "vietnamese", "hanoi", "ho chi minh"],
    "Indonesia": ["indonesia", "indonesian", "jakarta", "bali"],
    "Philippines": ["philippines", "filipino", "manila"],
    "Malaysia": ["malaysia", "kuala lumpur"],
    "Singapore": ["singapore"],
    "Japan": ["japan", "japanese", "tokyo", "osaka"],
    "South Korea": ["south korea", "seoul", "korean"],
    "North Korea": ["north korea", "dprk", "pyongyang"],
    "Taiwan": ["taiwan", "taiwanese", "taipei"],
    "Sri Lanka": ["sri lanka", "colombo"],
    "Nepal": ["nepal", "kathmandu"],
    
    // Central Asia
    "Kazakhstan": ["kazakhstan", "astana", "almaty"],
    "Uzbekistan": ["uzbekistan", "tashkent"],
    "Turkmenistan": ["turkmenistan", "ashgabat"],
    "Kyrgyzstan": ["kyrgyzstan", "bishkek"],
    "Tajikistan": ["tajikistan", "dushanbe"],
    
    // Americas
    "USA": ["usa", "united states", "america", "american", "washington", "new york"],
    "Canada": ["canada", "canadian", "toronto", "vancouver", "ottawa"],
    "Mexico": ["mexico", "mexican", "mexico city"],
    "Brazil": ["brazil", "brazilian", "sao paulo", "rio", "brasilia"],
    "Argentina": ["argentina", "buenos aires"],
    "Venezuela": ["venezuela", "venezuelan", "caracas"],
    "Colombia": ["colombia", "colombian", "bogota", "medellin"],
    "Chile": ["chile", "santiago"],
    "Peru": ["peru", "lima"],
    "Ecuador": ["ecuador", "quito"],
    "Bolivia": ["bolivia", "la paz"],
    "Cuba": ["cuba", "havana"],
    "Haiti": ["haiti", "port-au-prince"],
    "Guatemala": ["guatemala"],
    "Honduras": ["honduras"],
    "El Salvador": ["el salvador"],
    "Nicaragua": ["nicaragua", "managua"],
    
    // Oceania
    "Australia": ["australia", "australian", "sydney", "melbourne", "canberra"],
    "New Zealand": ["new zealand", "auckland", "wellington"],
    "Papua New Guinea": ["papua", "port moresby"],
    "Fiji": ["fiji", "suva"],
    "Nauru": ["nauru"],
    "Tuvalu": ["tuvalu"],
    "Samoa": ["samoa", "apia"],
    "Vanuatu": ["vanuatu"],
    "Solomon Islands": ["solomon"],
    
    // Regions
    "Europe": ["europe", "european", "eu"],
    "Africa": ["africa", "african"],
    "Asia": ["asia", "asian"],
    "Middle East": ["middle east", "mideast"],
    "Latin America": ["latin america", "south america", "central america"],
    "Southeast Asia": ["southeast asia", "asean"],
    "Sahel": ["sahel", "sahelian"],
    "Horn of Africa": ["horn of africa"],
    "Global": ["global", "worldwide", "world", "planet", "international"],
  };

  for (const [country, patterns] of Object.entries(countryPatterns)) {
    for (const pattern of patterns) {
      if (q.includes(pattern)) {
        if (!locations.includes(country)) {
          locations.push(country);
        }
        break;
      }
    }
  }

  // If query mentions "around the world" or "globally", add Global
  if (q.includes("around the world") || q.includes("globally") || q.includes("worldwide")) {
    if (!locations.includes("Global")) {
      locations.push("Global");
    }
  }

  return locations;
}

// Extract topics from query - expanded coverage
function extractTopics(query: string): string[] {
  const q = query.toLowerCase();
  const topics: string[] = [];

  const topicPatterns: Record<string, string[]> = {
    "conflict": ["war", "conflict", "fighting", "battle", "military", "attack", "violence", "bombing", "strike", "missile", "drone", "invasion", "occupation"],
    "killings": ["killing", "killings", "murder", "assassination", "massacre", "execution", "death toll", "casualties", "fatalities"],
    "terrorism": ["terrorism", "terrorist", "extremist", "jihad", "isis", "al-qaeda", "boko haram", "insurgent", "militant"],
    "humanitarian": ["humanitarian", "crisis", "refugee", "displaced", "aid", "emergency", "relief", "idp", "asylum"],
    "health": ["health", "disease", "outbreak", "epidemic", "pandemic", "medical", "hospital", "covid", "cholera", "ebola", "mpox", "malaria", "vaccination"],
    "food": ["food", "hunger", "famine", "starvation", "malnutrition", "agriculture", "crop", "ipc", "food security", "food insecurity"],
    "economic": ["economic", "economy", "inflation", "currency", "trade", "sanctions", "poverty", "gdp", "recession", "debt"],
    "governance": ["governance", "government", "election", "democracy", "corruption", "political", "regime", "coup", "rule of law", "policy"],
    "political": ["protest", "demonstration", "unrest", "riot", "civil", "opposition", "reform"],
    "natural_disaster": ["earthquake", "flood", "hurricane", "typhoon", "cyclone", "tsunami", "wildfire", "drought", "landslide", "volcanic"],
    "security": ["security", "threat", "cyber", "espionage", "intelligence"],
    "energy": ["energy", "oil", "gas", "power", "electricity", "fuel", "renewable", "solar", "wind", "nuclear", "grid"],
    "climate": ["climate", "environmental", "pollution", "carbon", "emissions", "warming", "deforestation"],
    "population": ["population", "demographic", "migration", "urbanization", "fertility", "mortality"],
    "education": ["education", "school", "literacy", "university", "learning"],
    "human_rights": ["human rights", "rights", "freedom", "persecution", "discrimination", "gender", "minority"],
    "satellite": ["satellite", "imagery", "fires", "floods", "deforestation", "urban", "land use"],
  };

  for (const [topic, patterns] of Object.entries(topicPatterns)) {
    for (const pattern of patterns) {
      if (q.includes(pattern)) {
        if (!topics.includes(topic)) {
          topics.push(topic);
        }
        break;
      }
    }
  }

  if (topics.length === 0) {
    topics.push("general_situation");
  }

  return topics;
}

// Gather relevant data from database - enhanced
async function gatherContext(
  supabase: any,
  locations: string[],
  topics: string[],
  query: string
): Promise<QueryContext> {
  const context: QueryContext = {
    alerts: [],
    crises: [],
    incidents: [],
    intel: [],
    countryData: [],
    vulnerabilities: [],
    healthData: [],
    foodData: [],
    energyData: [],
    economicData: [],
    governanceData: [],
  };

  const isGlobal = locations.includes("Global") || locations.length === 0;

  // Fetch recent alerts
  let alertsQuery = supabase
    .from("alerts")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(25);
  
  if (!isGlobal && locations.length > 0) {
    alertsQuery = alertsQuery.or(locations.map(l => `country.ilike.%${l}%,title.ilike.%${l}%,message.ilike.%${l}%`).join(","));
  }
  const { data: alerts } = await alertsQuery;
  context.alerts = alerts || [];

  // Fetch crisis events
  let crisesQuery = supabase
    .from("crisis_events")
    .select("*")
    .order("opened_at", { ascending: false })
    .limit(20);
  
  if (!isGlobal && locations.length > 0) {
    crisesQuery = crisesQuery.or(locations.map(l => `region.ilike.%${l}%,kind.ilike.%${l}%`).join(","));
  }
  const { data: crises } = await crisesQuery;
  context.crises = crises || [];

  // Fetch security incidents (killings, terrorism, etc.)
  let incidentsQuery = supabase
    .from("security_incidents")
    .select("*")
    .order("start_time", { ascending: false })
    .limit(25);
  
  if (!isGlobal && locations.length > 0) {
    incidentsQuery = incidentsQuery.or(locations.map(l => `country.ilike.%${l}%,title.ilike.%${l}%`).join(","));
  }
  const { data: incidents } = await incidentsQuery;
  context.incidents = incidents || [];

  // Fetch intel events
  let intelQuery = supabase
    .from("intel_events")
    .select("*")
    .order("published_at", { ascending: false })
    .limit(25);
  
  const { data: intel } = await intelQuery;
  context.intel = intel || [];

  // Fetch health data if relevant
  if (topics.includes("health") || topics.includes("humanitarian")) {
    const { data: healthData } = await supabase
      .from("health_data")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(15);
    context.healthData = healthData || [];
  }

  // Fetch food security data if relevant
  if (topics.includes("food") || topics.includes("humanitarian")) {
    const { data: foodData } = await supabase
      .from("food_security")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(15);
    context.foodData = foodData || [];
  }

  // Fetch energy data if relevant
  if (topics.includes("energy")) {
    const { data: energyData } = await supabase
      .from("energy_grid")
      .select("*")
      .order("updated_at", { ascending: false })
      .limit(15);
    context.energyData = energyData || [];
  }

  // Fetch country-specific data if locations identified
  for (const location of locations.slice(0, 5)) {
    if (location === "Global") continue;
    
    const { data: countryProfile } = await supabase
      .from("country_profiles")
      .select("*")
      .ilike("country_name", `%${location}%`)
      .limit(1)
      .maybeSingle();
    
    if (countryProfile) {
      context.countryData.push(countryProfile);
    }

    const { data: vulnScore } = await supabase
      .from("vulnerability_scores")
      .select("*")
      .ilike("country", `%${location}%`)
      .order("computed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    
    if (vulnScore) {
      context.vulnerabilities.push(vulnScore);
    }
  }

  return context;
}

// Generate auto-dashboards based on context
function generateDashboards(context: QueryContext, topics: string[], locations: string[]): DashboardCard[] {
  const dashboards: DashboardCard[] = [];
  let cardId = 0;

  // Active Alerts Dashboard
  if (context.alerts.length > 0) {
    const criticalAlerts = context.alerts.filter((a: any) => a.severity === "critical" || a.severity === "high");
    dashboards.push({
      id: `card-${cardId++}`,
      title: "Active Alerts",
      value: context.alerts.length,
      riskLevel: criticalAlerts.length > 3 ? "critical" : criticalAlerts.length > 0 ? "high" : "medium",
      trend: "stable",
      source: "AICIS Alert System",
      division: "Security",
    });
  }

  // Active Crises Dashboard
  if (context.crises.length > 0) {
    const activeCrises = context.crises.filter((c: any) => c.status !== "resolved");
    const avgSeverity = activeCrises.reduce((sum: number, c: any) => sum + (c.severity || 5), 0) / (activeCrises.length || 1);
    dashboards.push({
      id: `card-${cardId++}`,
      title: "Active Crises",
      value: activeCrises.length,
      riskLevel: avgSeverity >= 8 ? "critical" : avgSeverity >= 6 ? "high" : avgSeverity >= 4 ? "medium" : "low",
      source: "Crisis Events Database",
      division: "Humanitarian",
    });
  }

  // Security Incidents - Killings
  if (context.incidents.length > 0) {
    const totalKilled = context.incidents.reduce((sum: number, i: any) => sum + (i.killed || 0), 0);
    const totalInjured = context.incidents.reduce((sum: number, i: any) => sum + (i.injured || 0), 0);
    const totalDisplaced = context.incidents.reduce((sum: number, i: any) => sum + (i.displaced || 0), 0);

    if (totalKilled > 0) {
      dashboards.push({
        id: `card-${cardId++}`,
        title: "Fatalities (Recent)",
        value: totalKilled.toLocaleString(),
        riskLevel: totalKilled > 1000 ? "critical" : totalKilled > 100 ? "high" : totalKilled > 10 ? "medium" : "low",
        trend: "up",
        source: "Security Incidents",
        division: "Conflict",
      });
    }

    if (totalInjured > 0) {
      dashboards.push({
        id: `card-${cardId++}`,
        title: "Injuries (Recent)",
        value: totalInjured.toLocaleString(),
        riskLevel: totalInjured > 5000 ? "critical" : totalInjured > 500 ? "high" : "medium",
        source: "Security Incidents",
        division: "Conflict",
      });
    }

    if (totalDisplaced > 0) {
      dashboards.push({
        id: `card-${cardId++}`,
        title: "Displaced Persons",
        value: totalDisplaced.toLocaleString(),
        riskLevel: totalDisplaced > 100000 ? "critical" : totalDisplaced > 10000 ? "high" : "medium",
        source: "Security Incidents",
        division: "Humanitarian",
      });
    }

    // Count by incident type
    const terrorIncidents = context.incidents.filter((i: any) => 
      i.event_type?.toLowerCase().includes("terror") || 
      i.event_type?.toLowerCase().includes("bomb") ||
      i.event_type?.toLowerCase().includes("attack")
    );
    if (terrorIncidents.length > 0) {
      dashboards.push({
        id: `card-${cardId++}`,
        title: "Terror-Related Incidents",
        value: terrorIncidents.length,
        riskLevel: terrorIncidents.length > 10 ? "critical" : terrorIncidents.length > 3 ? "high" : "medium",
        source: "Security Database",
        division: "Security",
      });
    }
  }

  // Health Data
  if (context.healthData.length > 0) {
    const totalAffected = context.healthData.reduce((sum: number, h: any) => sum + (h.affected_count || 0), 0);
    const highRisk = context.healthData.filter((h: any) => h.risk_level === "high" || h.risk_level === "critical");
    
    dashboards.push({
      id: `card-${cardId++}`,
      title: "Health Cases Tracked",
      value: totalAffected.toLocaleString(),
      riskLevel: highRisk.length > 0 ? "high" : "medium",
      source: "Health Data Feed",
      division: "Health",
    });
  }

  // Food Security Data
  if (context.foodData.length > 0) {
    const criticalFood = context.foodData.filter((f: any) => f.alert_level === "critical" || f.alert_level === "emergency");
    const avgYieldIndex = context.foodData.reduce((sum: number, f: any) => sum + (f.yield_index || 0), 0) / context.foodData.length;
    
    dashboards.push({
      id: `card-${cardId++}`,
      title: "Food Security Alerts",
      value: criticalFood.length,
      riskLevel: criticalFood.length > 3 ? "critical" : criticalFood.length > 0 ? "high" : "medium",
      source: "FAO / WFP",
      division: "Food",
    });

    dashboards.push({
      id: `card-${cardId++}`,
      title: "Avg Yield Index",
      value: avgYieldIndex.toFixed(1),
      riskLevel: avgYieldIndex < 0.5 ? "critical" : avgYieldIndex < 0.7 ? "high" : avgYieldIndex < 0.9 ? "medium" : "low",
      source: "Agricultural Data",
      division: "Food",
    });
  }

  // Energy Data
  if (context.energyData.length > 0) {
    const avgStability = context.energyData.reduce((sum: number, e: any) => sum + (e.stability_index || 0), 0) / context.energyData.length;
    const avgRenewable = context.energyData.reduce((sum: number, e: any) => sum + (e.renewable_percentage || 0), 0) / context.energyData.length;
    
    dashboards.push({
      id: `card-${cardId++}`,
      title: "Grid Stability",
      value: `${(avgStability * 100).toFixed(1)}%`,
      riskLevel: avgStability < 0.5 ? "critical" : avgStability < 0.7 ? "high" : avgStability < 0.9 ? "medium" : "low",
      source: "Energy Grid Data",
      division: "Energy",
    });

    dashboards.push({
      id: `card-${cardId++}`,
      title: "Renewable Share",
      value: `${avgRenewable.toFixed(1)}%`,
      trend: "up",
      source: "EIA / OWID",
      division: "Energy",
    });
  }

  // Vulnerability Scores
  for (const vuln of context.vulnerabilities as any[]) {
    dashboards.push({
      id: `card-${cardId++}`,
      title: `${vuln.country} Vulnerability`,
      value: `${vuln.overall_score || 0}/100`,
      riskLevel: vuln.overall_score > 75 ? "critical" : vuln.overall_score > 50 ? "high" : vuln.overall_score > 25 ? "medium" : "low",
      source: "Vulnerability Index",
      division: "Governance",
    });
  }

  // Country Profiles - Governance indicators
  for (const profile of context.countryData as any[]) {
    if (profile.kpis) {
      const kpis = typeof profile.kpis === 'string' ? JSON.parse(profile.kpis) : profile.kpis;
      if (kpis.governance_index !== undefined) {
        dashboards.push({
          id: `card-${cardId++}`,
          title: `${profile.country_name} Governance`,
          value: kpis.governance_index.toFixed(1),
          riskLevel: kpis.governance_index < 30 ? "critical" : kpis.governance_index < 50 ? "high" : kpis.governance_index < 70 ? "medium" : "low",
          source: "World Bank / V-Dem",
          division: "Governance",
        });
      }
    }
  }

  return dashboards;
}

// Determine severity based on data
function determineSeverity(context: QueryContext, dashboards: DashboardCard[]): "low" | "medium" | "high" | "critical" {
  const criticalCount = dashboards.filter(d => d.riskLevel === "critical").length;
  const highCount = dashboards.filter(d => d.riskLevel === "high").length;
  
  const criticalAlerts = context.alerts.filter((a: any) => a.severity === "critical").length;
  const activeCrises = context.crises.filter((c: any) => (c.severity || 0) >= 8).length;
  
  if (criticalCount > 2 || criticalAlerts > 3 || activeCrises > 2) return "critical";
  if (criticalCount > 0 || highCount > 3 || criticalAlerts > 0) return "high";
  if (highCount > 0 || context.alerts.length > 5) return "medium";
  return "low";
}

// Calculate confidence based on data availability
function calculateConfidence(context: QueryContext): number {
  let score = 50; // Base confidence
  
  if (context.alerts.length > 0) score += 10;
  if (context.crises.length > 0) score += 10;
  if (context.incidents.length > 0) score += 10;
  if (context.countryData.length > 0) score += 10;
  if (context.intel.length > 0) score += 5;
  if (context.healthData.length > 0) score += 3;
  if (context.foodData.length > 0) score += 3;
  if (context.energyData.length > 0) score += 3;
  
  // Cap at 95% - never claim perfect confidence
  return Math.min(score, 95);
}

// Identify affected divisions
function identifyDivisions(topics: string[], context: QueryContext): string[] {
  const divisions: string[] = [];
  
  const topicToDivision: Record<string, string> = {
    conflict: "Security",
    killings: "Security",
    terrorism: "Security",
    security: "Security",
    humanitarian: "Humanitarian",
    health: "Health",
    food: "Food Security",
    economic: "Economy",
    governance: "Governance",
    political: "Governance",
    energy: "Energy",
    climate: "Climate",
    natural_disaster: "Emergency",
    population: "Demographics",
    education: "Education",
    human_rights: "Human Rights",
    satellite: "Earth Observation",
  };
  
  for (const topic of topics) {
    const div = topicToDivision[topic];
    if (div && !divisions.includes(div)) {
      divisions.push(div);
    }
  }
  
  // Add divisions based on available data
  if (context.incidents.length > 0 && !divisions.includes("Security")) divisions.push("Security");
  if (context.crises.length > 0 && !divisions.includes("Humanitarian")) divisions.push("Humanitarian");
  if (context.healthData.length > 0 && !divisions.includes("Health")) divisions.push("Health");
  if (context.foodData.length > 0 && !divisions.includes("Food Security")) divisions.push("Food Security");
  if (context.energyData.length > 0 && !divisions.includes("Energy")) divisions.push("Energy");
  
  return divisions;
}

// Resolve location coordinates
async function resolveLocation(supabase: any, locations: string[]): Promise<{ name: string; iso3?: string; lat?: number; lng?: number } | undefined> {
  if (locations.length === 0 || locations[0] === "Global") return undefined;
  
  const location = locations[0];
  
  // Try to find in geo_catalog
  const { data } = await supabase
    .from("geo_catalog")
    .select("name, iso3, lat, lon")
    .ilike("name", `%${location}%`)
    .limit(1)
    .maybeSingle();
  
  if (data) {
    return {
      name: data.name,
      iso3: data.iso3,
      lat: data.lat,
      lng: data.lon
    };
  }
  
  // Try country_profiles
  const { data: profile } = await supabase
    .from("country_profiles")
    .select("country_name, iso3")
    .ilike("country_name", `%${location}%`)
    .limit(1)
    .maybeSingle();
  
  if (profile) {
    return {
      name: profile.country_name,
      iso3: profile.iso3
    };
  }
  
  return { name: location };
}

// Compile data sources used
function compileSources(context: QueryContext, topics: string[]): string[] {
  const sources: string[] = ["AICIS Core Intelligence"];
  
  if (context.alerts.length > 0) sources.push("Alert System");
  if (context.crises.length > 0) sources.push("Crisis Database");
  if (context.incidents.length > 0) sources.push("Security Incidents", "GDELT");
  if (context.intel.length > 0) sources.push("Intel Events");
  if (context.countryData.length > 0) sources.push("Country Profiles");
  if (context.vulnerabilities.length > 0) sources.push("Vulnerability Index");
  if (context.healthData.length > 0) sources.push("WHO", "Health Data");
  if (context.foodData.length > 0) sources.push("FAO", "WFP", "Food Security");
  if (context.energyData.length > 0) sources.push("EIA", "OWID Energy");
  
  if (topics.includes("governance")) sources.push("World Bank", "V-Dem");
  if (topics.includes("economic")) sources.push("IMF", "World Bank");
  if (topics.includes("satellite")) sources.push("NASA", "Satellite Data");
  
  return [...new Set(sources)]; // Remove duplicates
}

// Build system prompt with data context
function buildSystemPrompt(context: QueryContext, locations: string[], topics: string[]): string {
  const now = new Date().toISOString().split("T")[0];
  
  let prompt = `You are AICIS (AI Civilization Intelligence System), an advanced global intelligence and crisis response system. You provide real-time, factual analysis of global situations based on live data feeds.

Current date: ${now}

IDENTITY & ROLE:
- You are AICIS, NOT Jarvis, NOT an assistant personality
- Provide accurate, actionable intelligence on global situations
- Analyze crises, conflicts, humanitarian situations, and security threats
- Be direct, professional, and neutral in your responses
- Cite specific data points when available
- Acknowledge limitations when data is incomplete
- Never claim certainty - use confidence ranges (e.g., "65-80% confidence")

CRITICAL GUIDELINES:
- Be factual and cite sources when providing information
- For ongoing conflicts/crises, provide current status, key actors, and impact
- Include casualty figures, displacement numbers, or other metrics when available
- For killings/terrorism queries, surface all relevant incident data
- Suggest actionable recommendations where appropriate
- If data is limited, clearly state this and provide historical context
- Never make up data - if unknown, say so

OUTPUT FORMAT:
Start with a brief executive summary (2-3 sentences) followed by:
- Current situation overview
- Key metrics and indicators
- Risk assessment with confidence band
- Recommendations or watch items
`;

  // Add context about detected locations
  if (locations.length > 0) {
    prompt += `\nLOCATIONS OF INTEREST: ${locations.join(", ")}\n`;
  }

  // Add context about detected topics
  if (topics.length > 0) {
    prompt += `TOPICS DETECTED: ${topics.join(", ")}\n\n`;
  }

  // Add live data context
  prompt += `CURRENT INTELLIGENCE DATA:\n\n`;

  // Alerts
  if (context.alerts.length > 0) {
    prompt += `ACTIVE ALERTS (${context.alerts.length}):\n`;
    for (const alert of context.alerts.slice(0, 12)) {
      const a = alert as Record<string, unknown>;
      prompt += `- [${a.severity}] ${a.title}: ${(a.message as string)?.substring(0, 200) || "No details"} (${a.country || "Global"}, ${a.division})\n`;
    }
    prompt += "\n";
  }

  // Crises
  if (context.crises.length > 0) {
    prompt += `ACTIVE CRISES (${context.crises.length}):\n`;
    for (const crisis of context.crises.slice(0, 10)) {
      const c = crisis as Record<string, unknown>;
      prompt += `- ${c.kind} in ${c.region}: Severity ${c.severity}/10, Status: ${c.status}\n`;
      if (c.details_md) {
        prompt += `  Details: ${(c.details_md as string).substring(0, 150)}...\n`;
      }
    }
    prompt += "\n";
  }

  // Security incidents - IMPORTANT for killings/terrorism
  if (context.incidents.length > 0) {
    prompt += `SECURITY INCIDENTS (${context.incidents.length}):\n`;
    for (const incident of context.incidents.slice(0, 12)) {
      const i = incident as Record<string, unknown>;
      prompt += `- ${i.event_type || i.title}: ${i.country || "Unknown"} - ${(i.summary as string)?.substring(0, 150) || "No details"}\n`;
      if (i.killed || i.injured || i.displaced) {
        prompt += `  IMPACT: ${i.killed || 0} killed, ${i.injured || 0} injured, ${i.displaced || 0} displaced\n`;
      }
      if (i.start_time) {
        prompt += `  Time: ${i.start_time}\n`;
      }
    }
    prompt += "\n";
  }

  // Health data
  if (context.healthData.length > 0) {
    prompt += `HEALTH DATA (${context.healthData.length}):\n`;
    for (const health of context.healthData.slice(0, 6) as any[]) {
      prompt += `- ${health.disease} in ${health.region}: ${health.affected_count} affected, Risk: ${health.risk_level}\n`;
    }
    prompt += "\n";
  }

  // Food security
  if (context.foodData.length > 0) {
    prompt += `FOOD SECURITY (${context.foodData.length}):\n`;
    for (const food of context.foodData.slice(0, 6) as any[]) {
      prompt += `- ${food.region} ${food.crop}: Yield Index ${food.yield_index}, Alert: ${food.alert_level}\n`;
    }
    prompt += "\n";
  }

  // Intel events
  if (context.intel.length > 0) {
    prompt += `RECENT INTELLIGENCE (${context.intel.length}):\n`;
    for (const intel of context.intel.slice(0, 8)) {
      const e = intel as Record<string, unknown>;
      prompt += `- [${e.severity}] ${e.division}: ${e.title}\n`;
    }
    prompt += "\n";
  }

  // Country-specific data
  if (context.countryData.length > 0) {
    prompt += `COUNTRY PROFILES:\n`;
    for (const profile of context.countryData) {
      const p = profile as Record<string, unknown>;
      prompt += `- ${p.country_name} (${p.iso3}): `;
      if (p.summary) {
        const summary = p.summary as Record<string, unknown>;
        prompt += `${JSON.stringify(summary).substring(0, 300)}...\n`;
      }
    }
    prompt += "\n";
  }

  // Vulnerability scores
  if (context.vulnerabilities.length > 0) {
    prompt += `VULNERABILITY SCORES:\n`;
    for (const vuln of context.vulnerabilities) {
      const v = vuln as Record<string, unknown>;
      prompt += `- ${v.country}: Overall ${v.overall_score}/100 (Health: ${v.health_risk}, Food: ${v.food_risk}, Energy: ${v.energy_risk})\n`;
    }
    prompt += "\n";
  }

  // If no data found
  if (context.alerts.length === 0 && context.crises.length === 0 && context.incidents.length === 0 && context.intel.length === 0) {
    prompt += `NOTE: Limited real-time data available for this specific query. Provide analysis based on general knowledge while clearly noting data limitations and confidence bounds.\n\n`;
  }

  prompt += `\nProvide a comprehensive, professional intelligence briefing. Be specific with data points when available. Include confidence ranges for any forecasts or assessments.`;

  return prompt;
}

// Calculate data completeness for transparency
function calculateDataCompleteness(context: QueryContext): number {
  const sources = [
    context.alerts.length > 0,
    context.crises.length > 0,
    context.incidents.length > 0,
    context.intel.length > 0,
    context.countryData.length > 0,
    context.vulnerabilities.length > 0,
    context.healthData.length > 0,
    context.foodData.length > 0,
    context.energyData.length > 0,
    context.economicData.length > 0,
    context.governanceData.length > 0,
  ];
  
  const availableSources = sources.filter(Boolean).length;
  return Math.round((availableSources / sources.length) * 100) / 100;
}

// Generate actionable guidance based on context
interface GuidanceItem {
  priority: "critical" | "high" | "medium" | "low";
  domain: string;
  title: string;
  description: string;
  actionable: string;
  sdgAlignment?: number[];
}

function generateActionableGuidance(
  context: QueryContext,
  locations: string[],
  topics: string[]
): GuidanceItem[] {
  const guidance: GuidanceItem[] = [];
  
  const locationName = locations.length > 0 && locations[0] !== "Global" 
    ? locations[0] 
    : "the region";

  // Critical: Active conflicts
  const activeCrises = context.crises.filter((c: any) => 
    c.status !== "resolved" && (c.severity || 0) >= 7
  );
  if (activeCrises.length > 0) {
    guidance.push({
      priority: "critical",
      domain: "Security",
      title: "Active Crisis Response Required",
      description: `${activeCrises.length} high-severity crisis event(s) affecting ${locationName}.`,
      actionable: "Activate emergency protocols, coordinate with humanitarian partners, and establish secure communication channels.",
      sdgAlignment: [16]
    });
  }

  // Critical: Mass casualty incidents
  const totalKilled = context.incidents.reduce((sum: number, i: any) => sum + (i.killed || 0), 0);
  if (totalKilled > 100) {
    guidance.push({
      priority: "critical",
      domain: "Humanitarian",
      title: "Mass Casualty Event",
      description: `${totalKilled.toLocaleString()} fatalities recorded in recent incidents.`,
      actionable: "Deploy medical surge capacity, coordinate victim identification, and engage international support mechanisms.",
      sdgAlignment: [3, 16]
    });
  }

  // High: Vulnerability indicators
  for (const vuln of context.vulnerabilities as any[]) {
    if (vuln.overall_score > 60) {
      guidance.push({
        priority: "high",
        domain: "Resilience",
        title: `Elevated Systemic Vulnerability: ${vuln.country || locationName}`,
        description: `Overall vulnerability score of ${vuln.overall_score}/100 indicates fragility across multiple domains.`,
        actionable: "Prioritize capacity building in weakest sectors, establish early warning systems, and diversify resource dependencies.",
        sdgAlignment: [1, 10, 16]
      });
    }
  }

  // High: Health emergencies
  const healthAlerts = context.alerts.filter((a: any) => 
    a.division === "health" && (a.severity === "critical" || a.severity === "high")
  );
  if (healthAlerts.length > 0) {
    guidance.push({
      priority: "high",
      domain: "Health",
      title: "Health System Alert",
      description: `${healthAlerts.length} active health concern(s) requiring attention.`,
      actionable: "Strengthen surveillance, ensure medical supply continuity, and coordinate with WHO regional office.",
      sdgAlignment: [3]
    });
  }

  // Medium: Food security
  const foodCritical = context.foodData.filter((f: any) => 
    f.alert_level === "critical" || f.alert_level === "emergency"
  );
  if (foodCritical.length > 0 || topics.includes("food")) {
    guidance.push({
      priority: foodCritical.length > 2 ? "critical" : "medium",
      domain: "Food Security",
      title: "Food Supply Monitoring",
      description: "Agricultural or supply indicators suggest potential food stress.",
      actionable: "Activate strategic reserves, coordinate with WFP for early intervention, and support agricultural inputs for next planting season.",
      sdgAlignment: [2]
    });
  }

  // Medium: Energy infrastructure
  const energyIssues = context.energyData.filter((e: any) => 
    (e.stability_index || 1) < 0.7
  );
  if (energyIssues.length > 0 || topics.includes("energy")) {
    guidance.push({
      priority: "medium",
      domain: "Energy",
      title: "Energy Grid Resilience",
      description: "Energy infrastructure indicators suggest potential reliability concerns.",
      actionable: "Assess grid redundancy, develop backup power protocols for critical facilities, and accelerate renewable integration.",
      sdgAlignment: [7, 9]
    });
  }

  // Medium: Governance capacity
  if (context.countryData.length > 0) {
    for (const profile of context.countryData as any[]) {
      const kpis = profile.kpis || {};
      if (kpis.governance?.completeness < 0.5) {
        guidance.push({
          priority: "medium",
          domain: "Governance",
          title: "Institutional Capacity Development",
          description: `Limited governance data for ${profile.country_name || locationName} suggests opportunities for capacity building.`,
          actionable: "Engage technical assistance programs, strengthen statistical capacity, and implement transparency initiatives.",
          sdgAlignment: [16, 17]
        });
      }
    }
  }

  // Low: General monitoring (if no other guidance)
  if (guidance.length === 0) {
    guidance.push({
      priority: "low",
      domain: "Strategic",
      title: "Routine Monitoring Active",
      description: `No critical alerts for ${locationName}. Continue standard monitoring protocols.`,
      actionable: "Maintain data reporting, strengthen regional partnerships, and invest in human capital development.",
      sdgAlignment: [17]
    });
  }

  // Sort by priority
  const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  guidance.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  return guidance.slice(0, 6); // Limit to top 6 recommendations
}
