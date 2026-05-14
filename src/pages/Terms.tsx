import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Scale, AlertTriangle } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { SEO } from "@/components/SEO";

const Terms = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background p-4">
      <SEO
        title="Terms of Service — AICIS"
        description="AICIS Terms of Service: usage rights, data sovereignty commitments, and operational obligations for sovereign-grade intelligence."
        path="/terms"
      />
      <div className="container mx-auto max-w-4xl">
        <Button
          variant="outline"
          onClick={() => navigate(-1)}
          className="mb-4"
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back
        </Button>

        <Card className="bg-card/50 backdrop-blur-sm border-primary/20">
          <CardHeader>
            <CardTitle className="text-3xl font-orbitron flex items-center gap-3">
              <Scale className="h-7 w-7 text-primary" />
              Terms of Service
            </CardTitle>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs">Version 2.0</Badge>
              <p className="text-muted-foreground text-sm">Effective: March 21, 2026</p>
            </div>
          </CardHeader>
          <CardContent className="prose prose-sm dark:prose-invert max-w-none space-y-6">

            {/* AI Disclaimer Banner */}
            <div className="rounded-lg border border-warning/30 bg-warning/5 p-4">
              <p className="text-sm text-foreground font-medium flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-warning shrink-0 mt-0.5" />
                <span>
                  <strong>AI Advisory Notice:</strong> AICIS is a decision-support system that provides AI-assisted analytical insights. 
                  All outputs are advisory in nature and should not be treated as definitive predictions, validated intelligence, 
                  or instructions for autonomous action. Human oversight and independent verification are required before 
                  making decisions based on AICIS outputs.
                </span>
              </p>
            </div>

            <section>
              <h2 className="text-2xl font-semibold mb-3">1. Acceptance of Terms</h2>
              <p className="text-muted-foreground">
                By accessing and using the AICIS platform, you accept and agree to be bound by these Terms of Service.
                If you do not agree with any part of these terms, you must not use the platform. These terms constitute 
                a legally binding agreement between you and AICIS.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-3">2. Nature of the Service</h2>
              <p className="text-muted-foreground mb-2">
                AICIS is an AI-assisted geopolitical and socioeconomic intelligence platform that:
              </p>
              <ul className="list-disc list-inside text-muted-foreground space-y-1">
                <li>Aggregates publicly available data from recognized international sources</li>
                <li>Generates analytical assessments using machine learning and statistical models</li>
                <li>Provides estimated risk indicators, trend analyses, and scenario projections</li>
                <li>Operates in an <strong>advisory/shadow mode</strong> — outputs are analytical signals, not validated intelligence</li>
              </ul>
              <p className="text-muted-foreground mt-3 font-medium">
                AICIS does not provide: financial advice, military intelligence, legal counsel, medical guidance, 
                or any form of guaranteed prediction.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-3">3. AI-Generated Content Disclaimer</h2>
              <p className="text-muted-foreground mb-2">
                Users acknowledge and agree that:
              </p>
              <ul className="list-disc list-inside text-muted-foreground space-y-1">
                <li>All analytical outputs are <strong>AI-assisted estimates</strong> with associated confidence intervals</li>
                <li>Forecasts are probabilistic projections, not certainties — they may be inaccurate</li>
                <li>Conflict risk assessments are AI-synthesized hypotheses for human review, not validated field intelligence</li>
                <li>Scenario projections represent possible futures based on current data patterns, not predictions of what will happen</li>
                <li>No output should be used as the sole basis for policy, investment, military, or humanitarian decisions</li>
                <li>Independent verification from primary sources is always recommended</li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-3">4. Human-in-the-Loop Governance</h2>
              <p className="text-muted-foreground">
                AICIS enforces mandatory human oversight for all actionable outputs:
              </p>
              <ul className="list-disc list-inside text-muted-foreground space-y-1 mt-2">
                <li>Analysts review all AI-generated assessments before dissemination</li>
                <li>Policy-makers approve recommendations before any action is proposed</li>
                <li>All approvals are logged to an immutable Decision Ledger with timestamps and reviewer identity</li>
                <li>No autonomous action is ever taken by the system</li>
                <li>Users have the right to appeal any AI-assisted assessment through the ethics review process</li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-3">5. Use License</h2>
              <p className="text-muted-foreground mb-2">
                Permission is granted to access AICIS for authorized personal or organizational use. Under this license you may not:
              </p>
              <ul className="list-disc list-inside text-muted-foreground space-y-1">
                <li>Reverse engineer, decompile, or attempt to extract the source code of AICIS</li>
                <li>Redistribute, republish, or commercially resell AICIS outputs without authorization</li>
                <li>Present AI-generated outputs as your own original analysis without attribution</li>
                <li>Use AICIS outputs to support discriminatory, unlawful, or harmful activities</li>
                <li>Misrepresent AICIS outputs as validated intelligence, guaranteed predictions, or official government assessments</li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-3">6. Data Sources &amp; Attribution</h2>
              <p className="text-muted-foreground">
                AICIS aggregates data from publicly available international sources including the World Bank, 
                WHO, FAO, GDELT, NASA, and others. Data provenance is displayed alongside all analytical outputs. 
                Users acknowledge that the accuracy of AICIS outputs depends on the accuracy and timeliness of 
                these upstream data sources, which are outside our control.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-3">7. Limitation of Liability</h2>
              <p className="text-muted-foreground">
                To the maximum extent permitted by applicable law, AICIS and its operators shall not be liable for:
              </p>
              <ul className="list-disc list-inside text-muted-foreground space-y-1 mt-2">
                <li>Any direct, indirect, incidental, consequential, or special damages arising from the use of AICIS outputs</li>
                <li>Decisions made based on AI-generated assessments, forecasts, or risk indicators</li>
                <li>Inaccuracies, delays, or omissions in upstream data sources</li>
                <li>Service interruptions, data loss, or technical failures</li>
                <li>Any losses resulting from reliance on AICIS outputs without independent verification</li>
              </ul>
              <p className="text-muted-foreground mt-2 font-medium">
                AICIS outputs are provided "as-is" without warranty of any kind, express or implied, including 
                but not limited to warranties of accuracy, completeness, or fitness for a particular purpose.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-3">8. Indemnification</h2>
              <p className="text-muted-foreground">
                You agree to indemnify and hold harmless AICIS, its operators, employees, and affiliates from any claims, 
                damages, losses, or expenses arising from your use of the platform, your violation of these terms, or 
                your misrepresentation of AICIS outputs as validated intelligence or guaranteed predictions.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-3">9. Service Availability</h2>
              <p className="text-muted-foreground">
                We strive for high availability but do not guarantee uninterrupted service. Scheduled maintenance 
                will be communicated in advance when possible. We are not liable for service interruptions caused 
                by factors beyond our reasonable control, including but not limited to upstream data source outages.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-3">10. Intellectual Property</h2>
              <p className="text-muted-foreground">
                The AICIS platform, its algorithms, user interface, and analytical methodologies are proprietary. 
                Aggregated analytical outputs generated for you may be used in accordance with your license terms. 
                The underlying data from public sources remains subject to their respective licenses.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-3">11. Governing Law</h2>
              <p className="text-muted-foreground">
                These terms shall be governed by and construed in accordance with the laws of the Federal Republic 
                of Germany and the European Union. Any disputes shall be subject to the exclusive jurisdiction of 
                the courts of Berlin, Germany.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-3">12. Regulatory Compliance</h2>
              <p className="text-muted-foreground">
                AICIS is designed to comply with:
              </p>
              <ul className="list-disc list-inside text-muted-foreground space-y-1 mt-2">
                <li>EU AI Act — as an AI system providing decision-support (not autonomous decision-making)</li>
                <li>GDPR — for processing of platform user data</li>
                <li>ISO 27001 principles — for information security management</li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-3">13. Modifications to Terms</h2>
              <p className="text-muted-foreground">
                We reserve the right to modify these terms. Material changes will be communicated via email 
                at least 30 days before taking effect. Continued use after the effective date constitutes acceptance.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-3">14. Contact</h2>
              <p className="text-muted-foreground">
                Questions about these Terms of Service should be directed to: <strong>legal@aicis.com</strong>
              </p>
            </section>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Terms;
