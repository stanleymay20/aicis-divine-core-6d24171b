import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Globe, CheckCircle2, Loader2 } from "lucide-react";
import { toast } from "sonner";

export default function RegisterNode() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    org_name: "",
    org_type: "ngo",
    country: "",
    jurisdiction: "",
    contact_email: "",
    api_endpoint: "",
    description: "",
  });

  const register = useMutation({
    mutationFn: async () => {
      const { data: userResp } = await supabase.auth.getUser();
      if (!userResp.user) throw new Error("You must be signed in to register a node.");

      const { data, error } = await supabase
        .from("accountability_nodes")
        .insert({
          org_name: form.org_name,
          org_type: form.org_type as any,
          country: form.country.toUpperCase().slice(0, 3),
          jurisdiction: form.jurisdiction,
          contact_email: form.contact_email,
          api_endpoint: form.api_endpoint || null,
          metadata: { description: form.description, registered_by: userResp.user.id },
          verified: false,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      toast.success("Node registered. An admin will verify your application within 48 hours.");
      navigate("/governance");
    },
    onError: (err: any) => {
      toast.error(err.message ?? "Registration failed");
    },
  });

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    register.mutate();
  };

  return (
    <div className="container mx-auto p-6 max-w-2xl">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <Globe className="h-7 w-7 text-primary" />
            <div>
              <CardTitle className="text-2xl">Register an Accountability Node</CardTitle>
              <CardDescription className="mt-1">
                Cooperatives, NGOs, agencies, and institutions can join the AICIS federation as
                voting members. Verification typically completes within 48 hours.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="org_name">Organization Name *</Label>
                <Input
                  id="org_name"
                  required
                  value={form.org_name}
                  onChange={(e) => setForm({ ...form, org_name: e.target.value })}
                  placeholder="e.g. Mampong Farmers Cooperative"
                />
              </div>

              <div className="space-y-2">
                <Label>Organization Type *</Label>
                <Select
                  value={form.org_type}
                  onValueChange={(v) => setForm({ ...form, org_type: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="government">Government</SelectItem>
                    <SelectItem value="ngo">NGO / Non-profit</SelectItem>
                    <SelectItem value="academic">Academic / Research</SelectItem>
                    <SelectItem value="private">Private sector</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="country">Country (ISO3) *</Label>
                <Input
                  id="country"
                  required
                  maxLength={3}
                  value={form.country}
                  onChange={(e) => setForm({ ...form, country: e.target.value.toUpperCase() })}
                  placeholder="GHA"
                />
              </div>

              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="jurisdiction">Jurisdiction *</Label>
                <Input
                  id="jurisdiction"
                  required
                  value={form.jurisdiction}
                  onChange={(e) => setForm({ ...form, jurisdiction: e.target.value })}
                  placeholder="e.g. Ashanti Region, Ghana"
                />
              </div>

              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="contact_email">Contact Email *</Label>
                <Input
                  id="contact_email"
                  type="email"
                  required
                  value={form.contact_email}
                  onChange={(e) => setForm({ ...form, contact_email: e.target.value })}
                />
              </div>

              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="api_endpoint">API Endpoint (optional)</Label>
                <Input
                  id="api_endpoint"
                  value={form.api_endpoint}
                  onChange={(e) => setForm({ ...form, api_endpoint: e.target.value })}
                  placeholder="https://your-node.example.org"
                />
                <p className="text-xs text-muted-foreground">
                  If you operate your own AICIS instance, provide its base URL for federation peering.
                </p>
              </div>

              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="description">Mission / Description</Label>
                <Textarea
                  id="description"
                  rows={3}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="What does your organization do, and what data will you contribute?"
                />
              </div>
            </div>

            <div className="rounded-lg border bg-muted/30 p-4 text-sm space-y-2">
              <div className="font-medium flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-success" />
                What happens after registration
              </div>
              <ul className="list-disc list-inside text-muted-foreground space-y-1 text-xs">
                <li>An admin reviews your application within 48 hours</li>
                <li>Once verified, you receive DAO voting weight proportional to verified contributions</li>
                <li>Verified nodes can submit community-tier metrics via the federation API</li>
                <li>Your node appears on the public Global Node Federation panel</li>
              </ul>
            </div>

            <Button type="submit" disabled={register.isPending} className="w-full">
              {register.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Registering…
                </>
              ) : (
                "Submit Application"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
