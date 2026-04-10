import { Button } from "@/components/ui/button";
import { Eye, EyeOff } from "lucide-react";
import { useWatchlist, WatchType } from "@/hooks/useWatchlist";
import { cn } from "@/lib/utils";

interface Props {
  watchType: WatchType;
  label: string;
  countryIso3?: string;
  regionId?: string;
  hotspotKey?: string;
  size?: "sm" | "default" | "icon";
  className?: string;
}

export const WatchButton = ({ watchType, label, countryIso3, regionId, hotspotKey, size = "sm", className }: Props) => {
  const { isWatching, toggleWatch } = useWatchlist();
  const key = countryIso3 || regionId || hotspotKey || "";
  const watching = isWatching(watchType, key);

  return (
    <Button
      variant={watching ? "default" : "outline"}
      size={size}
      className={cn("gap-1.5 text-xs", className)}
      onClick={(e) => {
        e.stopPropagation();
        toggleWatch({ watch_type: watchType, label, country_iso3: countryIso3, region_id: regionId, hotspot_key: hotspotKey });
      }}
    >
      {watching ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
      {watching ? "Watching" : "Watch"}
    </Button>
  );
};
