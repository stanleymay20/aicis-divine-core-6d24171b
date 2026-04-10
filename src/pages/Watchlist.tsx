import { AICISLayout } from "@/components/aicis/AICISLayout";
import { WatchlistPanel } from "@/components/watchlist/WatchlistPanel";
import { Eye } from "lucide-react";

export default function Watchlist() {
  return (
    <AICISLayout>
      <div className="p-4 md:p-6 lg:p-8 max-w-[1000px] mx-auto overflow-y-auto h-full space-y-4">
        <div className="space-y-1">
          <h1 className="text-xl md:text-2xl font-bold text-foreground tracking-tight flex items-center gap-2">
            <Eye className="h-5 w-5 text-primary" />
            Tracked Markets
          </h1>
          <p className="text-sm text-muted-foreground">
            Monitor your key sourcing markets, trade routes, and supply regions for disruptions
          </p>
        </div>
        <WatchlistPanel />
      </div>
    </AICISLayout>
  );
}
