import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { ArrowRight, BarChart3, RefreshCw, ShieldAlert, Store, TrendingUp, Users } from "lucide-react";
import { useNavigate } from "react-router-dom";
import {
  type GovernanceTrade,
  type GovernanceAssetsResponse,
  getErrorMessage,
} from "@/types/aicis";

export const GovernanceMarketPanel = () => {
  const { toast } = useToast();
  const navigate = useNavigate();

  const { data: assetsData, refetch: refetchAssets } = useQuery({
    queryKey: ["governance-assets"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("gov-get-assets");
      if (error) throw error;
      return data as GovernanceAssetsResponse;
    },
  });

  const { data: tradesData, refetch: refetchTrades } = useQuery({
    queryKey: ["governance-trades"],
    queryFn: async (): Promise<GovernanceTrade[]> => {
      // Fetch trades via the gov-get-assets function which includes recent trades
      const { data, error } = await supabase.functions.invoke("gov-get-assets");
      if (error) return [];
      return (data?.trades || []) as GovernanceTrade[];
    },
  });

  const handleSyncPartners = async () => {
    try {
      const { data, error } = await supabase.functions.invoke("gov-sync-partners");
      if (error) throw error;

      toast({
        title: "Partners Synced",
        description: `Updated ${data.synced} partner oracles`,
      });
      
      refetchAssets();
    } catch (error) {
      toast({
        title: "Sync Failed",
        description: getErrorMessage(error),
        variant: "destructive",
      });
    }
  };

  return (
    <Card className="p-6 bg-card/50 backdrop-blur-sm border-primary/20">
      <Tabs defaultValue="market" className="w-full">
        <TabsList className="grid w-full grid-cols-4 mb-4">
          <TabsTrigger value="market">
            <Store className="w-4 h-4 mr-2" />
            Market
          </TabsTrigger>
          <TabsTrigger value="partners">
            <Users className="w-4 h-4 mr-2" />
            Partners
          </TabsTrigger>
          <TabsTrigger value="trades">
            <TrendingUp className="w-4 h-4 mr-2" />
            My Trades
          </TabsTrigger>
          <TabsTrigger value="metrics">
            <BarChart3 className="w-4 h-4 mr-2" />
            Metrics
          </TabsTrigger>
        </TabsList>

        <TabsContent value="market" className="space-y-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-orbitron font-bold text-primary">Governance Assets</h3>
            <Button variant="outline" size="sm" onClick={() => refetchAssets()}>
              <RefreshCw className="w-4 h-4" />
            </Button>
          </div>

          <div className="grid gap-3">
            {assetsData?.assets?.map((asset) => (
              <Card key={asset.id} className="p-4 bg-muted/20">
                <div className="flex justify-between items-start">
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="font-semibold">{asset.asset_symbol}</h4>
                      <Badge variant="outline">{asset.source_system}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">{asset.asset_name}</p>
                    <p className="text-xs text-muted-foreground mt-2">{asset.description_md}</p>
                  </div>
                  <Badge variant="secondary">View only</Badge>
                </div>
              </Card>
            ))}
          </div>

          <Card className="p-4 border-dashed bg-muted/20">
            <div className="flex items-start gap-3">
              <ShieldAlert className="mt-0.5 h-4 w-4 text-muted-foreground" />
              <div className="flex-1">
                <p className="text-sm font-semibold">Legacy SC trading disabled</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  This historical panel previously used demo pricing and internal wallet mutation. It is now view-only.
                  Use Opportunity Radar for verified transaction construction and the audited execution-preview workflow.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="mt-3 gap-2"
                  onClick={() => navigate("/opportunities")}
                >
                  Open Opportunity Radar
                  <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="partners" className="space-y-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-orbitron font-bold text-primary">Partner Oracles</h3>
            <Button variant="outline" size="sm" onClick={handleSyncPartners}>
              <RefreshCw className="w-4 h-4 mr-2" />
              Sync Partners
            </Button>
          </div>

          <div className="grid gap-3">
            {assetsData?.partners?.map((partner) => (
              <Card key={partner.id} className="p-4 bg-muted/20">
                <div className="flex justify-between items-center">
                  <div>
                    <h4 className="font-semibold">{partner.partner_name}</h4>
                    <p className="text-xs text-muted-foreground mt-1">
                      Last checked: {new Date(partner.last_checked).toLocaleString()}
                    </p>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-bold text-primary">{partner.trust_score}%</div>
                    <Badge variant={partner.enabled ? "default" : "secondary"}>
                      {partner.enabled ? "Active" : "Disabled"}
                    </Badge>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="trades" className="space-y-4">
          <h3 className="text-lg font-orbitron font-bold text-primary mb-4">Recent Trades</h3>
          <div className="space-y-3">
            {tradesData?.map((trade) => (
              <Card key={trade.id} className="p-4 bg-muted/20">
                <div className="flex justify-between items-center">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{trade.asset_symbol}</span>
                      <Badge variant="outline">{trade.status}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">
                      {trade.asset_amount} @ {trade.price} SC/unit = {trade.sc_amount} SC
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(trade.created_at).toLocaleString()}
                    </p>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="metrics" className="space-y-4">
          <h3 className="text-lg font-orbitron font-bold text-primary mb-4">Governance Metrics</h3>
          <div className="grid grid-cols-2 gap-4">
            <Card className="p-4 bg-muted/20">
              <p className="text-sm text-muted-foreground">SC Reference</p>
              <p className="text-2xl font-bold text-primary">
                {assetsData?.scPrice?.value?.toFixed(6) || "—"}
              </p>
            </Card>
            <Card className="p-4 bg-muted/20">
              <p className="text-sm text-muted-foreground">Avg Trust Score</p>
              <p className="text-2xl font-bold text-primary">
                {assetsData?.partners?.reduce((sum, partner) => sum + partner.trust_score, 0) / 
                 (assetsData?.partners?.length || 1)}%
              </p>
            </Card>
            <Card className="p-4 bg-muted/20">
              <p className="text-sm text-muted-foreground">Active Assets</p>
              <p className="text-2xl font-bold text-primary">{assetsData?.assets?.length || 0}</p>
            </Card>
            <Card className="p-4 bg-muted/20">
              <p className="text-sm text-muted-foreground">Active Partners</p>
              <p className="text-2xl font-bold text-primary">
                {assetsData?.partners?.filter((partner) => partner.enabled)?.length || 0}
              </p>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </Card>
  );
};
