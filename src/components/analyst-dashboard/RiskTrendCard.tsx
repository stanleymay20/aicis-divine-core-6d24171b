import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { PanelEmpty } from "@/components/ui/panel-empty";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, Tooltip as ReTooltip, Legend } from "recharts";

export function RiskTrendCard({ loading, data }: { loading: boolean; data: any[] | undefined }) {
  return (
    <Card className="border-border bg-card/70">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Risk Trend (last 24h)</CardTitle>
      </CardHeader>
      <CardContent>
        {loading ? <Skeleton className="h-56 w-full" /> : !data?.length ? (
          <PanelEmpty
            title="No events bucketed in the last 24h"
            reason="The 24-hour risk trend aggregates normalized events by hour and category. Nothing arrived in the window — likely a quiet period or an upstream ingestion gap."
            nextStep="Check signal intake health on Operations Backplane. If intake is healthy, this reflects real quiet."
            compact
          />
        ) : (
          <div className="h-56">
            <ResponsiveContainer>
              <LineChart data={data ?? []}>
                <XAxis dataKey="hh" stroke="#64748b" tick={{ fontSize: 10 }} />
                <YAxis stroke="#64748b" tick={{ fontSize: 10 }} />
                <ReTooltip contentStyle={{ background: "rgba(15,23,42,0.95)", border: "1px solid #334155", fontSize: 11 }} />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <Line type="monotone" dataKey="global" stroke="#ef4444" dot={false} strokeWidth={1.6} />
                <Line type="monotone" dataKey="geopolitical" stroke="#f97316" dot={false} strokeWidth={1.4} />
                <Line type="monotone" dataKey="cyber" stroke="#22d3ee" dot={false} strokeWidth={1.4} />
                <Line type="monotone" dataKey="economic" stroke="#a78bfa" dot={false} strokeWidth={1.4} />
                <Line type="monotone" dataKey="environmental" stroke="#10b981" dot={false} strokeWidth={1.4} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
