/**
 * AICIS Risk Atlas – Query Parser
 * Turns natural-language queries into structured map filters.
 */

export interface MapQuery {
  scope: "global" | "continent" | "country" | "region";
  geography: string | null; // e.g. "africa", "GHA", region id
  domains: string[];
  threshold: number | null;
  comparison: { a: string; b: string } | null;
  trend: "rising" | "falling" | null;
  viewLevel: "country" | "region" | "village";
  raw: string;
}

const CONTINENTS: Record<string, string[]> = {
  africa: [
    "DZA","AGO","BEN","BWA","BFA","BDI","CMR","CPV","CAF","TCD","COM","COG","COD",
    "DJI","EGY","GNQ","ERI","SWZ","ETH","GAB","GMB","GHA","GIN","GNB","CIV","KEN",
    "LSO","LBR","LBY","MDG","MWI","MLI","MRT","MUS","MAR","MOZ","NAM","NER","NGA",
    "RWA","STP","SEN","SYC","SLE","SOM","ZAF","SSD","SDN","TZA","TGO","TUN","UGA",
    "ZMB","ZWE"
  ],
  "west africa": [
    "BEN","BFA","CPV","CIV","GMB","GHA","GIN","GNB","LBR","MLI","MRT","NER","NGA",
    "SEN","SLE","TGO"
  ],
  "east africa": [
    "BDI","COM","DJI","ERI","ETH","KEN","MDG","MWI","MUS","MOZ","RWA","SYC","SOM",
    "SSD","TZA","UGA","ZMB","ZWE"
  ],
  "north africa": ["DZA","EGY","LBY","MAR","SDN","TUN"],
  "central africa": ["CMR","CAF","TCD","COG","COD","GNQ","GAB","STP"],
  "southern africa": ["BWA","LSO","NAM","ZAF","SWZ"],
  asia: [
    "AFG","ARM","AZE","BHR","BGD","BTN","BRN","KHM","CHN","GEO","IND","IDN","IRN",
    "IRQ","ISR","JPN","JOR","KAZ","KWT","KGZ","LAO","LBN","MYS","MDV","MNG","MMR",
    "NPL","OMN","PAK","PHL","QAT","SAU","SGP","KOR","LKA","SYR","TWN","TJK","THA",
    "TKM","ARE","UZB","VNM","YEM"
  ],
  "southeast asia": ["BRN","KHM","IDN","LAO","MYS","MMR","PHL","SGP","THA","VNM"],
  europe: [
    "ALB","AND","AUT","BLR","BEL","BIH","BGR","HRV","CYP","CZE","DNK","EST","FIN",
    "FRA","DEU","GRC","HUN","ISL","IRL","ITA","LVA","LTU","LUX","MLT","MDA","MNE",
    "NLD","MKD","NOR","POL","PRT","ROU","RUS","SRB","SVK","SVN","ESP","SWE","CHE",
    "TUR","UKR","GBR"
  ],
  "south america": [
    "ARG","BOL","BRA","CHL","COL","ECU","GUY","PRY","PER","SUR","URY","VEN"
  ],
  "central america": ["BLZ","CRI","SLV","GTM","HND","NIC","PAN"],
  "middle east": [
    "BHR","IRN","IRQ","ISR","JOR","KWT","LBN","OMN","QAT","SAU","SYR","ARE","YEM"
  ],
};

const COUNTRY_ALIASES: Record<string, string> = {
  ghana: "GHA", nigeria: "NGA", kenya: "KEN", ethiopia: "ETH", egypt: "EGY",
  "south africa": "ZAF", morocco: "MAR", tanzania: "TZA", uganda: "UGA",
  senegal: "SEN", mali: "MLI", niger: "NER", cameroon: "CMR", chad: "TCD",
  sudan: "SDN", "south sudan": "SSD", somalia: "SOM", mozambique: "MOZ",
  madagascar: "MDG", zambia: "ZMB", zimbabwe: "ZWE", angola: "AGO",
  "dr congo": "COD", congo: "COG", "burkina faso": "BFA",
  india: "IND", china: "CHN", pakistan: "PAK", bangladesh: "BGD",
  indonesia: "IDN", philippines: "PHL", vietnam: "VNM", thailand: "THA",
  myanmar: "MMR", japan: "JPN", "south korea": "KOR",
  brazil: "BRA", mexico: "MEX", colombia: "COL", argentina: "ARG",
  peru: "PER", venezuela: "VEN", chile: "CHL",
  germany: "DEU", france: "FRA", "united kingdom": "GBR", uk: "GBR",
  turkey: "TUR", ukraine: "UKR", russia: "RUS",
  "united states": "USA", usa: "USA", us: "USA",
  "saudi arabia": "SAU", iran: "IRN", iraq: "IRQ",
  "central african republic": "CAF", gambia: "GMB", kiribati: "KIR",
  "el salvador": "SLV",
};

const ALL_DOMAINS = [
  "climate", "education", "energy", "finance", "food", "governance", "health",
  "population", "security",
];

const DOMAIN_ALIASES: Record<string, string> = {
  "food security": "food",
  "food stress": "food",
  "food risk": "food",
  "energy risk": "energy",
  "energy grid": "energy",
  "climate risk": "climate",
  "climate change": "climate",
  "health risk": "health",
  "public health": "health",
  "governance risk": "governance",
  "security risk": "security",
  "financial risk": "finance",
  "finance risk": "finance",
  "population risk": "population",
  "education risk": "education",
  "supply chain": "food",
};

export function parseMapQuery(raw: string): MapQuery {
  const q = raw.toLowerCase().trim();
  const result: MapQuery = {
    scope: "global",
    geography: null,
    domains: [],
    threshold: null,
    comparison: null,
    trend: null,
    viewLevel: "country",
    raw,
  };

  // Detect domains
  for (const [alias, domain] of Object.entries(DOMAIN_ALIASES)) {
    if (q.includes(alias)) {
      if (!result.domains.includes(domain)) result.domains.push(domain);
    }
  }
  for (const d of ALL_DOMAINS) {
    if (q.includes(d) && !result.domains.includes(d)) result.domains.push(d);
  }

  // Detect comparison: "compare X and Y"
  const compareMatch = q.match(/compare\s+(\w[\w\s]*?)\s+and\s+(\w[\w\s]*?)(?:\s+on|\s*$)/);
  if (compareMatch) {
    const a = COUNTRY_ALIASES[compareMatch[1].trim()] || compareMatch[1].trim().toUpperCase();
    const b = COUNTRY_ALIASES[compareMatch[2].trim()] || compareMatch[2].trim().toUpperCase();
    result.comparison = { a, b };
    result.scope = "country";
  }

  // Detect threshold: "above 70", "over 60"
  const threshMatch = q.match(/(?:above|over|greater than|>=?)\s*(\d+)/);
  if (threshMatch) {
    result.threshold = parseInt(threshMatch[1]);
  }

  // Detect trend
  if (q.includes("rising") || q.includes("increasing") || q.includes("growing")) {
    result.trend = "rising";
  } else if (q.includes("falling") || q.includes("declining") || q.includes("decreasing")) {
    result.trend = "falling";
  }

  // Detect geography — check continents first, then countries
  for (const [continent, isos] of Object.entries(CONTINENTS)) {
    if (q.includes(continent)) {
      result.scope = "continent";
      result.geography = continent;
      break;
    }
  }

  if (!result.geography) {
    for (const [alias, iso] of Object.entries(COUNTRY_ALIASES)) {
      if (q.includes(alias)) {
        result.scope = "country";
        result.geography = iso;
        result.viewLevel = "region";
        break;
      }
    }
  }

  // Default domain if none detected
  if (result.domains.length === 0 && !result.comparison) {
    // Show all domains
  }

  return result;
}

export function getContinentISOs(continent: string): string[] {
  return CONTINENTS[continent.toLowerCase()] || [];
}

export { ALL_DOMAINS, COUNTRY_ALIASES, CONTINENTS };
