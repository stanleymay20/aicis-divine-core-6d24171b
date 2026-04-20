import { useState, useRef, useEffect, useCallback } from "react";
import maplibregl from "maplibre-gl";
import { Header } from "./Header";
import { CommandBar } from "./CommandBar";
import { AlertsPanel } from "./AlertsPanel";
import { AlertDetailSheet } from "./AlertDetailSheet";
import { AnalyticsOverlay } from "./AnalyticsOverlay";
import { GlobalMap, GlobalMapRef } from "./GlobalMap";
import { CountryPanel } from "./CountryPanel";
import { IntelligenceHUD } from "./IntelligenceHUD";
import { DataStreamPanel } from "./DataStreamPanel";
import { GlobalStatsBar } from "./GlobalStatsBar";
import { MiniMap } from "./MiniMap";
import { MobileNav } from "./MobileNav";
import { LocationSearch } from "./LocationSearch";
import { KeyboardShortcutsModal, useKeyboardShortcuts } from "./KeyboardShortcuts";
import { AskAnythingPill } from "./AskAnythingPill";
import { type Country, getCountryCoordinates, searchCountries } from "@/lib/geo/all-countries";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useIsMobile } from "@/hooks/use-mobile";

interface Alert {
  id: string;
  title: string;
  message: string;
  severity: "critical" | "high" | "medium" | "low";
  division: string;
  country?: string;
  created_at: string;
  acknowledged: boolean;
}

export const CommandCenter = () => {
  const isMobile = useIsMobile();
  const mapRef = useRef<GlobalMapRef>(null);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  const [dataStreamOpen, setDataStreamOpen] = useState(!isMobile);
  const [unreadAlerts, setUnreadAlerts] = useState(0);
  const [mainMap, setMainMap] = useState<maplibregl.Map | null>(null);
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [selectedAlert, setSelectedAlert] = useState<Alert | null>(null);
  const [systemStatus, setSystemStatus] = useState<"operational" | "degraded" | "offline">("operational");
  const [selectedCountry, setSelectedCountry] = useState<{
    name: string;
    iso3: string;
    lat: number;
    lng: number;
  } | null>(null);

  // Sync main map reference for MiniMap
  useEffect(() => {
    const interval = setInterval(() => {
      const m = mapRef.current?.getMap();
      if (m && !mainMap) setMainMap(m);
    }, 500);
    return () => clearInterval(interval);
  }, [mainMap]);

  // Check system status
  useEffect(() => {
    const checkStatus = async () => {
      try {
        const { data, error } = await supabase.from("ai_divisions").select("status").limit(10);
        if (error) {
          setSystemStatus("degraded");
        } else {
          const activeCount = data?.filter(d => 
            d.status === "operational" || d.status === "active" || d.status === "optimal"
          ).length || 0;
          setSystemStatus(activeCount >= 6 ? "operational" : activeCount >= 3 ? "degraded" : "offline");
        }
      } catch {
        setSystemStatus("offline");
      }
    };
    checkStatus();
    const interval = setInterval(checkStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  // Check if data exists and seed if necessary
  useEffect(() => {
    const checkAndSeedData = async () => {
      try {
        const [alertsResult, crisesResult, intelResult] = await Promise.all([
          supabase.from("alerts").select("*", { count: "exact", head: true }),
          supabase.from("crisis_events").select("*", { count: "exact", head: true }),
          supabase.from("intel_events").select("*", { count: "exact", head: true }),
        ]);

        const totalRecords = (alertsResult.count || 0) + (crisesResult.count || 0) + (intelResult.count || 0);

        if (totalRecords === 0) {
          setIsLoadingData(true);
          toast.info("Loading live global data...", { duration: 5000 });
          
          const { data, error } = await supabase.functions.invoke("seed-live-data");
          
          if (error) {
            console.error("Error seeding live data:", error);
            toast.error("Failed to load live data. Some features may be limited.");
          } else {
            const results = data?.results || {};
            toast.success(
              `Live data loaded: ${results.crises || 0} crises, ${results.alerts || 0} alerts, ${results.intel_events || 0} intel events`,
              { duration: 5000 }
            );
          }
          setIsLoadingData(false);
        }
      } catch (error) {
        console.error("Error checking data:", error);
        setIsLoadingData(false);
      }
    };

    checkAndSeedData();
  }, []);

  // Fetch unread alerts count
  useEffect(() => {
    const fetchUnreadCount = async () => {
      const { count } = await supabase
        .from("alerts")
        .select("*", { count: "exact", head: true })
        .eq("acknowledged", false);
      setUnreadAlerts(count || 0);
    };

    fetchUnreadCount();

    const channel = supabase
      .channel("alerts-count")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "alerts" },
        () => fetchUnreadCount()
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const handleCountrySelect = useCallback((country: Country) => {
    const coords = getCountryCoordinates(country.iso2);
    mapRef.current?.flyToCountry(country);
    setSelectedCountry({
      name: country.name,
      iso3: country.iso3,
      lat: coords?.lat || 0,
      lng: coords?.lng || 0,
    });
    toast.success(`Navigating to ${country.name}`);
  }, []);

  const handleMapCountrySelect = useCallback((data: { country: string; iso3: string }) => {
    setSelectedCountry({
      name: data.country,
      iso3: data.iso3,
      lat: 0,
      lng: 0,
    });
  }, []);

  const handleNavigate = useCallback((view: string) => {
    if (view === "alerts") setAlertsOpen(true);
    if (view === "analytics") setAnalyticsOpen(true);
    if (view === "map") {
      mapRef.current?.resetView();
      setSelectedCountry(null);
    }
  }, []);

  const handleAlertClick = useCallback((alert: Alert) => {
    setSelectedAlert(alert);
    setAlertsOpen(false);
  }, []);

  const handleNavigateToLocation = useCallback((country: string) => {
    const countries = searchCountries(country);
    if (countries.length > 0) {
      handleCountrySelect(countries[0]);
    }
    setSelectedAlert(null);
  }, [handleCountrySelect]);

  const handleLocationSelect = useCallback((location: { lat: number; lng: number; name: string; zoom?: number }) => {
    const map = mapRef.current?.getMap();
    if (map) {
      map.flyTo({
        center: [location.lng, location.lat],
        zoom: location.zoom || 12,
        duration: 2000,
      });
      toast.success(`Navigating to ${location.name.split(",")[0]}`);
    }
  }, []);

  // Keyboard shortcuts
  const shortcutHandlers = {
    a: () => setAlertsOpen(prev => !prev),
    d: () => setAnalyticsOpen(prev => !prev),
    escape: () => {
      setAlertsOpen(false);
      setAnalyticsOpen(false);
      setSelectedCountry(null);
      setSelectedAlert(null);
    },
    g: () => mapRef.current?.spinGlobe(),
    r: () => mapRef.current?.resetView(),
    "cmd+k": () => {
      const input = document.querySelector('input[placeholder*="Search"]') as HTMLInputElement;
      input?.focus();
    },
  };

  const { showShortcuts, setShowShortcuts } = useKeyboardShortcuts(shortcutHandlers);

  return (
    <div className="h-screen w-full overflow-hidden bg-background">
      {/* Header with live ticker */}
      <Header
        onToggleAlerts={() => setAlertsOpen(!alertsOpen)}
        onToggleAnalytics={() => setAnalyticsOpen(!analyticsOpen)}
        alertsOpen={alertsOpen}
        analyticsOpen={analyticsOpen}
        unreadAlerts={unreadAlerts}
      />

      {/* Mobile Navigation */}
      {isMobile && (
        <div className="fixed top-2 left-2 z-50">
          <MobileNav
            onToggleAlerts={() => setAlertsOpen(!alertsOpen)}
            onToggleAnalytics={() => setAnalyticsOpen(!analyticsOpen)}
            onToggleData={() => setDataStreamOpen(!dataStreamOpen)}
            onToggleSatellite={() => {}}
            unreadAlerts={unreadAlerts}
            systemStatus={systemStatus}
          />
        </div>
      )}

      {/* Main map area */}
      <div className={cn(
        "h-full",
        isMobile ? "pt-14 pb-16" : "pt-[88px] pb-20 md:pb-24"
      )}>
        <GlobalMap
          ref={mapRef}
          onCountrySelect={handleMapCountrySelect}
          className="w-full h-full"
          isMobile={isMobile}
        />
      </div>

      {/* Global stats bar - hidden on mobile */}
      {!isMobile && <GlobalStatsBar />}

      {/* Intelligence HUD - hidden on mobile */}
      {!isMobile && <IntelligenceHUD />}

      {/* Data stream panel - collapsible on mobile */}
      {(!isMobile || dataStreamOpen) && <DataStreamPanel />}

      {/* Location search button */}
      <div className="fixed bottom-24 md:bottom-28 left-4 z-20">
        <LocationSearch onLocationSelect={handleLocationSelect} />
      </div>

      {/* MiniMap - hidden on mobile */}
      {!isMobile && <MiniMap mainMap={mainMap} />}

      {/* Country detail panel */}
      <CountryPanel
        country={selectedCountry}
        onClose={() => setSelectedCountry(null)}
      />

      {/* Overlays */}
      <AlertsPanel
        isOpen={alertsOpen}
        onClose={() => setAlertsOpen(false)}
        onAlertClick={handleAlertClick}
      />

      {/* Alert detail sheet for probing */}
      <AlertDetailSheet
        alert={selectedAlert}
        onClose={() => setSelectedAlert(null)}
        onNavigateToLocation={handleNavigateToLocation}
      />

      <AnalyticsOverlay
        isOpen={analyticsOpen}
        onClose={() => setAnalyticsOpen(false)}
        selectedCountry={selectedCountry ? { name: selectedCountry.name, iso3: selectedCountry.iso3 } : null}
      />

      {/* Keyboard shortcuts modal */}
      {showShortcuts && (
        <KeyboardShortcutsModal onClose={() => setShowShortcuts(false)} />
      )}

      {/* Command bar at bottom */}
      <CommandBar
        onCountrySelect={handleCountrySelect}
        onNavigate={handleNavigate}
      />
    </div>
  );
};