export interface DomainStat {
  domain: string;
  rows: number;
  countries: number;
  providers: number;
  last_write: string | null;
  source: "raw" | "snapshot";
}
export interface DailyPoint { day: string; n: number; }
export interface DomainDaily { domain: string; series: DailyPoint[]; }
export interface ProviderStat { provider: string; rows: number; last: string | null; }
export interface TableTotal { tbl: string; rows: number; last: string | null; label: string; href?: string; }
