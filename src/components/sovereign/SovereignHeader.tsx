import { useSovereignStats, formatRelativeTime, formatCompact } from "@/lib/sovereign/useSovereignStats";
import { t } from "@/lib/i18n";
import { Shield, FileCheck, Clock, Quote, Globe2 } from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";

/**
 * Persistent sovereign-grade header. Shows platform identity, classification,
 * mode, and live trust telemetry on every authenticated page.
 */
export const SovereignHeader = ({ className }: { className?: string }) => {
  const { data, isLoading } = useSovereignStats();

  return (
    <header
      className={cn(
        "w-full border-b border-border bg-gradient-to-r from-background via-background to-muted/30",
        "text-xs font-mono tracking-tight",
        className,
      )}
      role="banner"
      aria-label="Sovereign platform header"
    >
      {/* Classification strip */}
      <div className="w-full bg-primary/90 text-primary-foreground text-center py-0.5 text-[10px] font-semibold uppercase tracking-widest">
        {t("sovereign.classification")}
      </div>

      {/* Identity + telemetry strip */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5">
        <div className="flex items-center gap-2 min-w-0">
          <Shield className="h-3.5 w-3.5 text-primary shrink-0" aria-hidden />
          <Link to="/morning-brief" className="font-semibold text-foreground truncate hover:underline">
            {t("sovereign.platform_name")}
          </Link>
          <span className="hidden sm:inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
            <Globe2 className="h-3 w-3" aria-hidden /> {t("sovereign.mode.global")}
          </span>
        </div>

        <div className="flex items-center gap-3 text-muted-foreground">
          <Stat
            icon={<FileCheck className="h-3 w-3" />}
            label={t("sovereign.ledger")}
            value={isLoading ? "…" : formatCompact(data?.ledgerEntries ?? 0)}
            ok={!!data?.ledgerChainOk}
          />
          <Stat
            icon={<Shield className="h-3 w-3" />}
            label={t("sovereign.sources")}
            value={isLoading ? "…" : `${data?.authoritySources ?? 0} ${t("sovereign.tier1")}`}
            ok={(data?.authoritySources ?? 0) >= 10}
          />
          <Stat
            icon={<Clock className="h-3 w-3" />}
            label={t("sovereign.last_signed")}
            value={isLoading ? "…" : formatRelativeTime(data?.lastSignedAt ?? null)}
            ok={!!data?.lastSignedAt}
          />
          <Stat
            icon={<Quote className="h-3 w-3" />}
            label={t("sovereign.citations_active")}
            value={isLoading ? "…" : formatCompact(data?.citationsActive ?? 0)}
            ok={(data?.citationsActive ?? 0) > 0}
          />
        </div>
      </div>
    </header>
  );
};

const Stat = ({
  icon, label, value, ok,
}: { icon: React.ReactNode; label: string; value: string; ok: boolean }) => (
  <span
    className="hidden md:inline-flex items-center gap-1"
    title={`${label}: ${value}`}
  >
    <span className={cn("inline-flex items-center", ok ? "text-emerald-500" : "text-amber-500")}>
      {icon}
    </span>
    <span className="text-muted-foreground/70">{label}:</span>
    <span className="text-foreground font-medium">{value}</span>
  </span>
);
