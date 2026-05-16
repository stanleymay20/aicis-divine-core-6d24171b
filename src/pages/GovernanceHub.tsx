import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { AICISLayout } from "@/components/aicis/AICISLayout";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Vote, Scale, ArrowLeft, Plus, ThumbsUp, ThumbsDown, Minus, Clock, CheckCircle, Building2, TrendingUp, Beaker } from "lucide-react";
import { useViewModePersistence } from "@/hooks/useViewModePersistence";
import { NarrativeSynthesis } from "@/components/visualizations/NarrativeSynthesis";
import { ExecutiveBrief, ModeAwareSection } from "@/components/intelligence/ModeAwareSection";
import { SignalBadge } from "@/components/intelligence/SignalBadge";
import { ScenarioEngine } from "@/components/governance/ScenarioEngine";
import { SourceIQScorecardPanel } from "@/components/governance/SourceIQScorecardPanel";

const GovernanceHub = () => {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [newProposalTitle, setNewProposalTitle] = useState("");
  const [newProposalDescription, setNewProposalDescription] = useState("");
  const [selectedSpace, setSelectedSpace] = useState<string>("");
  const { mode } = useViewModePersistence();
  const isExecutiveMode = mode === "executive";

  useEffect(() => { if (!authLoading && !user) navigate('/auth'); }, [user, authLoading, navigate]);

  const { data: spaces } = useQuery({ queryKey: ["dao-spaces"], queryFn: async () => { const { data, error } = await supabase.from("dao_spaces").select("*").order("created_at"); if (error) throw error; return data; }, enabled: !!user });
  const { data: proposals } = useQuery({ queryKey: ["dao-proposals"], queryFn: async () => { const { data, error } = await supabase.from("dao_proposals").select("*").order("created_at", { ascending: false }); if (error) throw error; return data; }, enabled: !!user });
  const { data: userVotes } = useQuery({ queryKey: ["user-votes", user?.id], queryFn: async () => { if (!user) return []; const { data, error } = await supabase.from("dao_votes").select("*").eq("voter_id", user.id); if (error) throw error; return data; }, enabled: !!user });
  const { data: governanceData } = useQuery({ queryKey: ["governance-global"], queryFn: async () => { const { data, error } = await supabase.from("governance_global").select("*").order("value", { ascending: false }).limit(20); if (error) throw error; return data; }, enabled: !!user });

  const createProposal = useMutation({
    mutationFn: async () => { const { data, error } = await supabase.functions.invoke("dao-propose", { body: { space_id: selectedSpace, title: newProposalTitle, description: newProposalDescription } }); if (error) throw error; return data; },
    onSuccess: () => { toast({ title: "Proposal Created" }); setNewProposalTitle(""); setNewProposalDescription(""); queryClient.invalidateQueries({ queryKey: ["dao-proposals"] }); },
    onError: (e: any) => { toast({ title: "Failed", description: e.message, variant: "destructive" }); },
  });

  const castVote = useMutation({
    mutationFn: async ({ proposalId, voteType }: { proposalId: string; voteType: string }) => { const { data, error } = await supabase.functions.invoke("dao-vote", { body: { proposal_id: proposalId, vote_type: voteType } }); if (error) throw error; return data; },
    onSuccess: () => { toast({ title: "Vote Cast" }); queryClient.invalidateQueries({ queryKey: ["dao-proposals"] }); queryClient.invalidateQueries({ queryKey: ["user-votes"] }); },
    onError: (e: any) => { toast({ title: "Failed", description: e.message, variant: "destructive" }); },
  });

  const getVotePercentage = (p: any) => { const t = (p.votes_for || 0) + (p.votes_against || 0) + (p.votes_abstain || 0); if (t === 0) return { for: 0, against: 0, abstain: 0 }; return { for: ((p.votes_for || 0) / t) * 100, against: ((p.votes_against || 0) / t) * 100, abstain: ((p.votes_abstain || 0) / t) * 100 }; };
  const hasVoted = (id: string) => userVotes?.some((v: any) => v.proposal_id === id);

  // Governance Performance Metrics
  const govPerformance = useMemo(() => {
    const active = proposals?.filter((p: any) => p.status === 'active').length || 0;
    const total = proposals?.length || 0;
    const passed = proposals?.filter((p: any) => p.status === 'passed' || p.status === 'executed').length || 0;
    const participationRate = total > 0 ? Math.round((passed / total) * 100) : 0;
    
    // Governance Performance Score
    const performanceScore = Math.min(100, Math.round(
      (spaces?.length || 0) * 10 + participationRate * 0.5 + (governanceData?.length || 0) * 2
    ));
    
    // Institutional Stability
    const stabilityIndex = Math.min(100, Math.round(
      50 + (governanceData?.filter((g: any) => g.value > 0).length || 0) * 3
    ));

    return { performanceScore, stabilityIndex, active, total, participationRate };
  }, [proposals, spaces, governanceData]);

  const narrativeSections = useMemo(() => [
    { type: "summary" as const, content: `Governance Performance Score: ${govPerformance.performanceScore}/100. Institutional Stability Index: ${govPerformance.stabilityIndex}/100. ${govPerformance.active} active proposals, ${govPerformance.total} total. ${spaces?.length || 0} governance spaces.`, confidence: 0.85 },
    { type: "drivers" as const, content: "Governance quality driven by institutional transparency, policy consistency, stakeholder participation rates, and reform execution momentum.", confidence: 0.75 },
    { type: "outlook" as const, content: `Policy execution momentum: ${govPerformance.participationRate}% proposal success rate. ${govPerformance.performanceScore >= 70 ? 'Strong institutional framework.' : 'Reform acceleration needed.'}`, confidence: 0.7 },
    { type: "uncertainty" as const, content: "Governance indicators rely on periodic assessments. Real-time changes may not be reflected immediately. Confidence capped at 95%.", confidence: 0.95 },
  ], [govPerformance, spaces]);

  if (authLoading) return <div className="flex items-center justify-center min-h-screen"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  if (!user) return null;

  return (
    <AICISLayout>
      <div className="p-6 container mx-auto space-y-6">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}><ArrowLeft className="h-5 w-5" /></Button>
          <div className="flex items-center gap-2"><Scale className="h-8 w-8 text-primary" /><div><h1 className="text-xl font-orbitron font-bold">Governance Hub</h1><p className="text-xs text-muted-foreground">Governance Performance & Policy Management</p></div></div>
        </div>

        <SignalBadge domain="governance" />

        {/* Governance Performance Bar */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <Card>
            <CardContent className="pt-4 pb-3 text-center">
              <p className="text-xs text-muted-foreground mb-1">Governance Performance</p>
              <p className="text-2xl font-bold">{govPerformance.performanceScore}/100</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3 text-center">
              <p className="text-xs text-muted-foreground mb-1">Institutional Stability</p>
              <p className="text-2xl font-bold">{govPerformance.stabilityIndex}/100</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3 text-center">
              <p className="text-xs text-muted-foreground mb-1">Execution Rate</p>
              <p className="text-2xl font-bold">{govPerformance.participationRate}%</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3 text-center">
              <p className="text-xs text-muted-foreground mb-1">Active Proposals</p>
              <p className="text-2xl font-bold">{govPerformance.active}</p>
            </CardContent>
          </Card>
        </div>

        <ModeAwareSection onlyIn="executive">
          <ExecutiveBrief
            soWhat={`Governance Performance: ${govPerformance.performanceScore}/100. Stability Index: ${govPerformance.stabilityIndex}/100. ${govPerformance.active} active proposals pending.`}
            nowWhat={govPerformance.performanceScore < 50 ? "Governance performance below threshold. Prioritize institutional reform proposals." : "Review active proposals and use scenario engine for policy impact modeling."}
          />
        </ModeAwareSection>

        <Tabs defaultValue="proposals">
          <TabsList className="w-full justify-start overflow-x-auto flex-nowrap mb-6">
            <TabsTrigger value="proposals"><Vote className="w-4 h-4 mr-2" />Proposals</TabsTrigger>
            <TabsTrigger value="create"><Plus className="w-4 h-4 mr-2" />Create</TabsTrigger>
            <TabsTrigger value="scenarios"><Beaker className="w-4 h-4 mr-2" />Scenarios</TabsTrigger>
            <TabsTrigger value="indicators"><TrendingUp className="w-4 h-4 mr-2" />Indicators</TabsTrigger>
            <TabsTrigger value="spaces"><Building2 className="w-4 h-4 mr-2" />Spaces</TabsTrigger>
          </TabsList>

          <TabsContent value="proposals" className="space-y-4">
            <NarrativeSynthesis title="Governance Performance Brief" sections={narrativeSections} overallConfidence={0.8} lastUpdated={new Date().toISOString()} />
            <ScrollArea className={isExecutiveMode ? "h-[400px]" : "h-[600px]"}>
              <div className="space-y-4">
                {proposals?.length === 0 && <Card className="p-8 text-center"><Vote className="h-12 w-12 mx-auto text-muted-foreground mb-4" /><p className="text-muted-foreground">No proposals yet</p></Card>}
                {proposals?.map((proposal: any) => {
                  const pct = getVotePercentage(proposal);
                  const voted = hasVoted(proposal.id);
                  const isActive = proposal.status === "active";
                  return (
                    <Card key={proposal.id} className="overflow-hidden">
                      <CardHeader className="pb-3">
                        <div className="flex items-start justify-between"><div><CardTitle className="text-lg">{proposal.title}</CardTitle><CardDescription className="mt-1">{proposal.description?.slice(0, 150)}...</CardDescription></div>
                        <Badge variant={isActive ? "default" : "secondary"}>{proposal.status}</Badge></div>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div className="space-y-2">
                          <div className="flex justify-between text-sm"><span className="text-success">For: {pct.for.toFixed(1)}%</span><span className="text-destructive">Against: {pct.against.toFixed(1)}%</span></div>
                          <div className="h-2 rounded-full bg-muted overflow-hidden flex"><div className="bg-success h-full" style={{ width: `${pct.for}%` }} /><div className="bg-destructive h-full" style={{ width: `${pct.against}%` }} /><div className="bg-muted-foreground/30 h-full" style={{ width: `${pct.abstain}%` }} /></div>
                        </div>
                        {isActive && !voted && (
                          <div className="flex gap-2">
                            <Button size="sm" variant="outline" className="flex-1 text-success border-success/30 hover:bg-success/10" onClick={() => castVote.mutate({ proposalId: proposal.id, voteType: "for" })}><ThumbsUp className="w-4 h-4 mr-2" /> For</Button>
                            <Button size="sm" variant="outline" className="flex-1 text-destructive border-destructive/30 hover:bg-destructive/10" onClick={() => castVote.mutate({ proposalId: proposal.id, voteType: "against" })}><ThumbsDown className="w-4 h-4 mr-2" /> Against</Button>
                            <Button size="sm" variant="outline" className="flex-1" onClick={() => castVote.mutate({ proposalId: proposal.id, voteType: "abstain" })}><Minus className="w-4 h-4 mr-2" /> Abstain</Button>
                          </div>
                        )}
                        {voted && <Badge variant="outline" className="w-full justify-center py-2"><CheckCircle className="w-4 h-4 mr-2" />You have voted</Badge>}
                        <div className="flex items-center gap-2 text-xs text-muted-foreground"><Clock className="w-3 h-3" /><span>Ends: {new Date(proposal.voting_ends_at).toLocaleString()}</span></div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </ScrollArea>
          </TabsContent>

          <TabsContent value="create" className="space-y-4">
            <Card><CardHeader><CardTitle>Create New Proposal</CardTitle><CardDescription>Submit a proposal for community voting</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2"><Label>Select Space</Label><div className="grid grid-cols-2 gap-2">{spaces?.map((s: any) => (<Button key={s.id} variant={selectedSpace === s.id ? "default" : "outline"} className="justify-start" onClick={() => setSelectedSpace(s.id)}><Building2 className="w-4 h-4 mr-2" />{s.name}</Button>))}</div></div>
              <div className="space-y-2"><Label htmlFor="title">Proposal Title</Label><Input id="title" placeholder="Enter title..." value={newProposalTitle} onChange={(e) => setNewProposalTitle(e.target.value)} /></div>
              <div className="space-y-2"><Label htmlFor="desc">Description</Label><Textarea id="desc" placeholder="Describe your proposal..." value={newProposalDescription} onChange={(e) => setNewProposalDescription(e.target.value)} rows={6} /></div>
              <Button className="w-full" onClick={() => createProposal.mutate()} disabled={!selectedSpace || !newProposalTitle || createProposal.isPending}><Vote className="w-4 h-4 mr-2" /> Submit Proposal</Button>
            </CardContent></Card>
          </TabsContent>

          <TabsContent value="scenarios" className="space-y-4"><ScenarioEngine /></TabsContent>

          <TabsContent value="indicators" className="space-y-4">
            <Card><CardHeader><CardTitle>Global Governance Indicators</CardTitle><CardDescription>World Bank Governance Indicators (WGI)</CardDescription></CardHeader>
            <CardContent><ScrollArea className="h-[500px]"><div className="space-y-3">
              {governanceData?.length === 0 && <p className="text-center py-8 text-muted-foreground">No governance data available</p>}
              {governanceData?.map((item: any) => (
                <div key={item.id} className="flex items-center justify-between p-3 border rounded-lg"><div><p className="font-medium">{item.country}</p><p className="text-sm text-muted-foreground">{item.indicator_name}</p></div>
                <div className="text-right"><p className={`text-lg font-bold ${item.value > 1 ? 'text-success' : item.value > 0 ? 'text-warning' : 'text-destructive'}`}>{item.value?.toFixed(2)}</p><p className="text-xs text-muted-foreground">{item.year}</p></div></div>
              ))}
            </div></ScrollArea></CardContent></Card>
          </TabsContent>

          <TabsContent value="spaces" className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {spaces?.length === 0 && <Card className="p-8 text-center md:col-span-2"><Building2 className="h-12 w-12 mx-auto text-muted-foreground mb-4" /><p className="text-muted-foreground">No spaces configured</p></Card>}
              {spaces?.map((s: any) => (
                <Card key={s.id}><CardHeader><CardTitle className="flex items-center gap-2"><Building2 className="w-5 h-5 text-primary" />{s.name}</CardTitle><CardDescription>{s.description}</CardDescription></CardHeader>
                <CardContent><div className="grid grid-cols-3 gap-2 text-sm">
                  <div className="text-center p-2 bg-muted/30 rounded"><p className="text-muted-foreground">Delay</p><p className="font-bold">{s.voting_delay_hours}h</p></div>
                  <div className="text-center p-2 bg-muted/30 rounded"><p className="text-muted-foreground">Period</p><p className="font-bold">{s.voting_period_hours}h</p></div>
                  <div className="text-center p-2 bg-muted/30 rounded"><p className="text-muted-foreground">Quorum</p><p className="font-bold">{s.quorum_percentage}%</p></div>
                </div></CardContent></Card>
              ))}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </AICISLayout>
  );
};

export default GovernanceHub;
