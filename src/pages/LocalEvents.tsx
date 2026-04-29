import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, MapPin, Radio, ShieldAlert, ChevronRight, ExternalLink, Globe, Radar } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

type ConfTier = "high" | "medium" | "low";

interface LocalEvent {
  id: string;
  event_type: string;
  subtype: string | null;
  iso3: string;
  locality: string | null;
  admin_level_1: string | null;
  lat: number | null;
  lon: number | null;
  start_time: string;
  severity: number;
  confidence: number;
  confidence_tier: ConfTier;
  source_count: number;
  raw_signal_ids: string[];
  matched_keywords: string[];
  title: string | null;
  description: string | null;
}

interface RawSignal {
  id: string;
  source_name: string;
  source_type: string;
  raw_text: string | null;
  url: string | null;
  published_at: string | null;
  language: string;
}

const tierColor = (t: ConfTier) =>
  t === "high" ? "bg-destructive text-destructive-foreground"
  : t === "medium" ? "bg-amber-500 text-white"
  : "bg-muted text-muted-foreground";

const tierLabel = (t: ConfTier) =>
  t === "high" ? "Confirmed" : t === "medium" ? "Watch" : "Early Signal";

function EventCard({ ev, onOpen }: { ev: LocalEvent; onOpen: (id: string) => void }) {
  return (
    <button
      onClick={() => onOpen(ev.id)}
      className="w-full text-left rounded-lg border border-border bg-card hover:bg-accent/50 transition p-4 group"
    >
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <Badge className={tierColor(ev.confidence_tier)}>{tierLabel(ev.confidence_tier)}</Badge>
            <Badge variant="outline" className="capitalize">{ev.event_type}</Badge>
            {ev.subtype && <Badge variant="secondary" className="capitalize">{ev.subtype.replace(/_/g, ' ')}</Badge>}
          </div>
          <h3 className="font-semibold text-foreground line-clamp-2">
            {ev.title || `${ev.subtype} in ${ev.locality || ev.iso3}`}
          </h3>
          <div className="flex items-center gap-3 text-xs text-muted-foreground mt-2">
            <span className="flex items-center gap-1"><MapPin className="h-3 w-3" />{ev.locality || ev.admin_level_1 || ev.iso3}</span>
            <span className="flex items-center gap-1"><Radio className="h-3 w-3" />{ev.source_count} source{ev.source_count > 1 ? 's' : ''}</span>
            <span>{formatDistanceToNow(new Date(ev.start_time))} ago</span>
          </div>
        </div>
        <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition" />
      </div>
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
          <div className="h-full bg-primary" style={{ width: `${Math.round(ev.confidence * 100)}%` }} />
        </div>
        <span className="text-xs font-mono text-muted-foreground tabular-nums">
          {Math.round(ev.confidence * 100)}%
        </span>
      </div>
    </button>
  );
}

function EventDrawer({ eventId, onClose }: { eventId: string | null; onClose: () => void }) {
  const { data: ev } = useQuery({
    queryKey: ["lril-event", eventId],
    enabled: !!eventId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("aicis_local_events")
        .select("*")
        .eq("id", eventId!)
        .single();
      if (error) throw error;
      return data as any as LocalEvent;
    },
  });

  const { data: signals } = useQuery({
    queryKey: ["lril-event-signals", eventId, ev?.raw_signal_ids],
    enabled: !!ev?.raw_signal_ids?.length,
    queryFn: async () => {
      const ids = (ev!.raw_signal_ids || []).slice(0, 50);
      if (ids.length === 0) return [];
      const { data, error } = await supabase
        .from("aicis_raw_local_signals")
        .select("id, source_name, source_type, raw_text, url, published_at, language")
        .in("id", ids);
      if (error) throw error;
      return (data || []) as RawSignal[];
    },
  });

  if (!eventId) return null;

  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-stretch justify-end" onClick={onClose}>
      <div className="w-full max-w-xl bg-card border-l border-border overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-card border-b border-border p-4 flex items-center justify-between">
          <h2 className="font-semibold">Event Detail</h2>
          <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
        </div>
        {!ev ? (
          <div className="p-4 space-y-3">
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : (
          <div className="p-4 space-y-4">
            <div>
              <div className="flex items-center gap-2 flex-wrap mb-2">
                <Badge className={tierColor(ev.confidence_tier)}>{tierLabel(ev.confidence_tier)}</Badge>
                <Badge variant="outline" className="capitalize">{ev.event_type}</Badge>
                {ev.subtype && <Badge variant="secondary" className="capitalize">{ev.subtype.replace(/_/g, ' ')}</Badge>}
              </div>
              <h1 className="text-xl font-bold mb-1">{ev.title}</h1>
              <p className="text-sm text-muted-foreground">{ev.description}</p>
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-md border border-border p-3">
                <div className="text-xs text-muted-foreground mb-1">Confidence</div>
                <div className="font-mono text-lg">{Math.round(ev.confidence * 100)}%</div>
              </div>
              <div className="rounded-md border border-border p-3">
                <div className="text-xs text-muted-foreground mb-1">Severity</div>
                <div className="font-mono text-lg">{Math.round(ev.severity * 100)}%</div>
              </div>
              <div className="rounded-md border border-border p-3">
                <div className="text-xs text-muted-foreground mb-1">Sources</div>
                <div className="font-mono text-lg">{ev.source_count}</div>
              </div>
              <div className="rounded-md border border-border p-3">
                <div className="text-xs text-muted-foreground mb-1">Started</div>
                <div className="text-xs">{new Date(ev.start_time).toLocaleString()}</div>
              </div>
            </div>

            <div>
              <div className="text-xs font-medium uppercase text-muted-foreground mb-2">Location</div>
              <div className="rounded-md border border-border p-3 text-sm">
                <div className="flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-muted-foreground" />
                  <span>{[ev.locality, ev.admin_level_1, ev.iso3].filter(Boolean).join(", ")}</span>
                </div>
                {ev.lat != null && ev.lon != null && (
                  <div className="text-xs text-muted-foreground mt-1 font-mono">
                    {Number(ev.lat).toFixed(3)}, {Number(ev.lon).toFixed(3)}
                  </div>
                )}
              </div>
            </div>

            {ev.matched_keywords?.length > 0 && (
              <div>
                <div className="text-xs font-medium uppercase text-muted-foreground mb-2">Matched Keywords</div>
                <div className="flex flex-wrap gap-1.5">
                  {ev.matched_keywords.slice(0, 12).map((kw, i) => (
                    <Badge key={i} variant="outline" className="text-xs">{kw}</Badge>
                  ))}
                </div>
              </div>
            )}

            <div>
              <div className="text-xs font-medium uppercase text-muted-foreground mb-2">
                Raw Evidence ({signals?.length || 0})
              </div>
              <div className="space-y-2">
                {(signals || []).map((s) => (
                  <div key={s.id} className="rounded-md border border-border p-3 text-sm">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-medium text-xs uppercase text-muted-foreground">
                        {s.source_type} · {s.source_name}
                      </span>
                      {s.url && (
                        <a href={s.url} target="_blank" rel="noopener noreferrer"
                           className="text-primary hover:underline">
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                    <p className="text-xs line-clamp-3">{s.raw_text}</p>
                  </div>
                ))}
                {(!signals || signals.length === 0) && (
                  <p className="text-xs text-muted-foreground italic">No raw signals available.</p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function LocalEvents() {
  const params = useParams<{ iso3?: string; locality?: string }>();
  const iso3 = params.iso3?.toUpperCase();
  const locality = params.locality;

  const [filter, setFilter] = useState("");
  const [tierFilter, setTierFilter] = useState<"all" | ConfTier>("all");
  const [openEvent, setOpenEvent] = useState<string | null>(null);

  const { data: events, isLoading, refetch } = useQuery({
    queryKey: ["lril-events", iso3, locality, tierFilter],
    queryFn: async () => {
      let q = supabase
        .from("aicis_local_events")
        .select("*")
        .eq("status", "active")
        .order("start_time", { ascending: false })
        .limit(200);
      if (iso3) q = q.eq("iso3", iso3);
      if (locality) q = q.ilike("locality", `%${locality}%`);
      if (tierFilter !== "all") q = q.eq("confidence_tier", tierFilter);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as any as LocalEvent[];
    },
  });

  const filtered = useMemo(() => {
    if (!events) return [];
    if (!filter.trim()) return events;
    const lc = filter.toLowerCase();
    return events.filter((e) =>
      e.title?.toLowerCase().includes(lc) ||
      e.locality?.toLowerCase().includes(lc) ||
      e.iso3.toLowerCase().includes(lc) ||
      e.subtype?.toLowerCase().includes(lc)
    );
  }, [events, filter]);

  const counts = useMemo(() => {
    const c = { high: 0, medium: 0, low: 0, total: events?.length || 0 };
    for (const e of events || []) c[e.confidence_tier]++;
    return c;
  }, [events]);

  // Crumbs
  const crumbs = (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <Link to="/local-events" className="hover:text-foreground flex items-center gap-1">
        <Globe className="h-3 w-3" /> Global
      </Link>
      {iso3 && (<><ChevronRight className="h-3 w-3" /><Link to={`/local-events/${iso3}`} className="hover:text-foreground">{iso3}</Link></>)}
      {locality && (<><ChevronRight className="h-3 w-3" /><span className="text-foreground">{locality}</span></>)}
    </div>
  );

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/50 backdrop-blur-sm sticky top-0 z-10">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center gap-2 mb-2">
            <Radar className="h-5 w-5 text-primary" />
            <h1 className="text-lg font-bold">Local Reality Intelligence</h1>
            <Badge variant="outline" className="ml-2 text-xs">LRIL · Beta</Badge>
          </div>
          {crumbs}
          <p className="text-xs text-muted-foreground mt-2">
            Village- and town-level event detection from multi-source signals. Low-confidence events are surfaced as
            <span className="font-medium text-foreground"> early signals</span> — never suppressed.
          </p>
        </div>
      </header>

      <div className="container mx-auto px-4 py-6 space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card><CardContent className="p-3">
            <div className="text-xs text-muted-foreground">Total Events</div>
            <div className="text-2xl font-bold">{counts.total}</div>
          </CardContent></Card>
          <Card><CardContent className="p-3">
            <div className="text-xs text-muted-foreground flex items-center gap-1"><ShieldAlert className="h-3 w-3 text-destructive" />Confirmed</div>
            <div className="text-2xl font-bold text-destructive">{counts.high}</div>
          </CardContent></Card>
          <Card><CardContent className="p-3">
            <div className="text-xs text-muted-foreground flex items-center gap-1"><AlertTriangle className="h-3 w-3 text-amber-500" />Watch</div>
            <div className="text-2xl font-bold text-amber-500">{counts.medium}</div>
          </CardContent></Card>
          <Card><CardContent className="p-3">
            <div className="text-xs text-muted-foreground">Early Signals</div>
            <div className="text-2xl font-bold text-muted-foreground">{counts.low}</div>
          </CardContent></Card>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-2">
          <Input
            placeholder="Search by locality, country, or event…"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="flex-1"
          />
          <div className="flex gap-1.5">
            {(["all", "high", "medium", "low"] as const).map((t) => (
              <Button
                key={t}
                size="sm"
                variant={tierFilter === t ? "default" : "outline"}
                onClick={() => setTierFilter(t)}
              >
                {t === "all" ? "All" : tierLabel(t)}
              </Button>
            ))}
          </div>
          <Button size="sm" variant="outline" onClick={() => refetch()}>Refresh</Button>
        </div>

        {/* Events */}
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-24 w-full" />)}
          </div>
        ) : filtered.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">No detectable digital signals</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {iso3 || locality
                ? `No active LRIL events for ${[locality, iso3].filter(Boolean).join(", ")} in the current window.`
                : "No active local events. The ingestion pipeline runs every 30 minutes — check back shortly."}
              <p className="mt-2 text-xs">
                This means no signals matched our keyword packs, geo resolution, or proxy thresholds. The system is
                actively listening across {`>15`} languages and 200+ countries.
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {filtered.map((ev) => (
              <EventCard key={ev.id} ev={ev} onOpen={setOpenEvent} />
            ))}
          </div>
        )}
      </div>

      <EventDrawer eventId={openEvent} onClose={() => setOpenEvent(null)} />
    </div>
  );
}
