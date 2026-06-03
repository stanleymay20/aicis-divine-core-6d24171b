import { useSovereignStats } from "@/lib/sovereign/useSovereignStats";
import { t } from "@/lib/i18n";
import { Check, Lock } from "lucide-react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";

/**
 * Quiet trust footer shown on every authenticated page.
 * Reinforces auditability, federation signing, residency, and source breadth.
 */
export const TrustFooter = ({ className }: { className?: string }) => {
  const { data } = useSovereignStats();

  const items = [
    { label: t("trust.ledger_verified"), ok: !!data?.ledgerChainOk, detail: `${data?.ledgerEntries ?? 0} entries` },
    { label: t("trust.federation_signed"), ok: (data?.activeKeys ?? 0) > 0, detail: data?.activeKeys ? "Ed25519 active" : "key pending" },
    { label: t("trust.residency_resources"), ok: (data?.residencyResources ?? 0) > 0, detail: `${data?.residencyResources ?? 0} resources`, href: "/residency" },
    { label: t("trust.authority_sources"), ok: (data?.authoritySources ?? 0) > 0, detail: `${data?.authoritySources ?? 0} publishers` },
  ];

  return (
    <footer
      className={cn(
        "w-full border-t border-border bg-muted/20 text-[10px] font-mono",
        "px-3 py-1.5 flex flex-wrap items-center justify-between gap-2",
        className,
      )}
      role="contentinfo"
      aria-label="Trust footer"
    >
      <div className="flex items-center gap-3 flex-wrap">
        {items.map((it) => {
          const inner = (
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <Check className={cn("h-2.5 w-2.5", it.ok ? "text-emerald-500" : "text-muted-foreground/40")} aria-hidden />
              <span>{it.label}</span>
              <span className="text-muted-foreground/60">· {it.detail}</span>
            </span>
          );
          return it.href ? <Link key={it.label} to={it.href} className="hover:underline">{inner}</Link> : <span key={it.label}>{inner}</span>;
        })}
      </div>
      <div className="flex items-center gap-1 text-muted-foreground/70">
        <Lock className="h-2.5 w-2.5" aria-hidden /> Non-Surveillance Guarantee · Public &amp; aggregate data only
      </div>
    </footer>
  );
};
