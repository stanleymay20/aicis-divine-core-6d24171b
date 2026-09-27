import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import { supabase } from "@/integrations/supabase/client";

interface Incident {
  id: string;
  latitude: number;
  longitude: number;
  severity: number;
  event_type: string;
  headline: string;
  country?: string;
  triggered_at: string;
}

interface IncidentMarkersProps {
  map: maplibregl.Map | null;
  isMapLoaded: boolean;
  onIncidentClick?: (incident: Incident) => void;
}

export const useIncidentMarkers = ({ map, isMapLoaded, onIncidentClick }: IncidentMarkersProps) => {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const clickRef = useRef(onIncidentClick);
  clickRef.current = onIncidentClick;

  useEffect(() => {
    const fetchIncidents = async () => {
      const { data: alertData } = await supabase
        .from("critical_alerts")
        .select("*")
        .order("triggered_at", { ascending: false })
        .limit(100);

      const allIncidents: Incident[] = [];

      alertData?.forEach(alert => {
        if (alert.meta && typeof alert.meta === 'object') {
          const meta = alert.meta as { latitude?: number; longitude?: number };
          if (meta.latitude && meta.longitude) {
            allIncidents.push({
              id: alert.id,
              latitude: meta.latitude,
              longitude: meta.longitude,
              severity: alert.severity || 50,
              event_type: alert.event_type || 'alert',
              headline: alert.headline,
              country: alert.country || undefined,
              triggered_at: alert.triggered_at || new Date().toISOString(),
            });
          }
        }
      });

      setIncidents(allIncidents);
    };

    fetchIncidents();

    const channel = supabase
      .channel("incident-markers")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "critical_alerts" }, () => fetchIncidents())
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    if (!map || !isMapLoaded) return;


    const newMarkers: maplibregl.Marker[] = [];

    incidents.forEach(incident => {
      const severity = incident.severity || 50;
      const el = document.createElement("div");
      el.className = "incident-marker";
      
      const size = 8 + (severity / 10);
      const color = severity >= 80 ? "hsl(0, 84%, 60%)" : severity >= 60 ? "hsl(38, 92%, 50%)" : "hsl(199, 89%, 48%)";

      el.innerHTML = `
        <div style="position: relative; width: ${size}px; height: ${size}px;">
          <div style="position: absolute; inset: 0; background: ${color}; border-radius: 50%; animation: incident-pulse 2s ease-out infinite;"></div>
          <div style="position: absolute; inset: 2px; background: ${color}; border-radius: 50%; border: 1px solid rgba(255,255,255,0.5);"></div>
        </div>
      `;
      el.style.cursor = "pointer";
      
      el.addEventListener("click", () => {
        clickRef.current?.(incident);
        map.flyTo({ center: [incident.longitude, incident.latitude], zoom: 8, duration: 1500 });
      });

      const marker = new maplibregl.Marker({ element: el })
        .setLngLat([incident.longitude, incident.latitude])
        .addTo(map);

      newMarkers.push(marker);
    });



    return () => {
      newMarkers.forEach(m => m.remove());
    };
  }, [map, isMapLoaded, incidents]);

  return { incidents, incidentCount: incidents.length };
};

// Pulse animation
if (typeof document !== 'undefined') {
  const style = document.createElement("style");
  style.textContent = `@keyframes incident-pulse { 0% { transform: scale(1); opacity: 0.8; } 100% { transform: scale(3); opacity: 0; } }`;
  document.head.appendChild(style);
}
