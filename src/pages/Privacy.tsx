import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Shield, Database, Eye, Lock } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { SEO } from "@/components/SEO";

const Privacy = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background p-4">
      <SEO
        title="Privacy Policy — AICIS"
        description="AICIS privacy policy: non-surveillance guarantee, public/aggregate data only, no PII processing, and full data sovereignty controls."
        path="/privacy"
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
              <Shield className="h-7 w-7 text-primary" />
              Privacy Policy
            </CardTitle>
            <div className="flex items-center gap-2">
              <Badge variant="outline" className="text-xs">Version 2.0</Badge>
              <p className="text-muted-foreground text-sm">Effective: March 21, 2026</p>
            </div>
          </CardHeader>
          <CardContent className="prose prose-sm dark:prose-invert max-w-none space-y-6">

            {/* Core Principle Banner */}
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
              <p className="text-sm text-foreground font-medium flex items-center gap-2">
                <Lock className="h-4 w-4 text-primary shrink-0" />
                AICIS is a decision-support platform built on publicly available macro-level data. We do not collect, process, or store personal data of individuals observed or analyzed by the system. The platform analyzes country-level indicators, not individual behavior.
              </p>
            </div>

            <section>
              <h2 className="text-2xl font-semibold mb-3">1. Introduction &amp; Scope</h2>
              <p className="text-muted-foreground">
                AICIS (AI-Assisted Civilization Intelligence System) is an AI-assisted geopolitical and socioeconomic intelligence platform. This Privacy Policy explains how we handle data in two categories:
              </p>
              <ul className="list-disc list-inside text-muted-foreground space-y-1 mt-2">
                <li><strong>Platform user data</strong> — your account credentials, usage patterns, and preferences</li>
                <li><strong>Analytical data</strong> — publicly sourced country-level indicators used for intelligence generation</li>
              </ul>
              <p className="text-muted-foreground mt-2">
                This policy is designed to comply with the General Data Protection Regulation (GDPR), the EU AI Act, and applicable international data protection frameworks.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-3">2. Data We Collect</h2>
              
              <h3 className="text-xl font-semibold mb-2 flex items-center gap-2">
                <Database className="h-4 w-4 text-primary" />
                2.1 User Account Data
              </h3>
              <p className="text-muted-foreground mb-2">When you create an account, we collect:</p>
              <ul className="list-disc list-inside text-muted-foreground space-y-1">
                <li>Email address and display name</li>
                <li>Organization affiliation (if provided)</li>
                <li>Authentication credentials (stored encrypted, never in plaintext)</li>
                <li>Role and access level within the platform</li>
              </ul>

              <h3 className="text-xl font-semibold mb-2 mt-4">2.2 Usage Data</h3>
              <ul className="list-disc list-inside text-muted-foreground space-y-1">
                <li>Pages viewed and features accessed</li>
                <li>Query history within the intelligence interface</li>
                <li>Session duration and access timestamps</li>
                <li>Device type and browser information</li>
              </ul>

              <h3 className="text-xl font-semibold mb-2 mt-4 flex items-center gap-2">
                <Eye className="h-4 w-4 text-primary" />
                2.3 Analytical Data (Non-Personal)
              </h3>
              <p className="text-muted-foreground mb-2">
                AICIS processes publicly available macro-level data from recognized international sources:
              </p>
              <ul className="list-disc list-inside text-muted-foreground space-y-1">
                <li>World Bank Development Indicators</li>
                <li>WHO Global Health Observatory</li>
                <li>FAO Food Security data</li>
                <li>GDELT Project (event data)</li>
                <li>NASA POWER (climate data)</li>
                <li>Our World in Data (energy, health)</li>
              </ul>
              <p className="text-muted-foreground mt-2">
                <strong>This data contains no personally identifiable information.</strong> All indicators are aggregated at national, regional, or settlement level. No individual surveillance, tracking, or profiling is performed.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-3">3. Data We Do NOT Collect</h2>
              <p className="text-muted-foreground mb-2">AICIS explicitly does not:</p>
              <ul className="list-disc list-inside text-muted-foreground space-y-1">
                <li>Monitor, track, or profile individual citizens of any country</li>
                <li>Collect biometric data, location data of individuals, or social media profiles</li>
                <li>Scrape private communications, personal records, or restricted databases</li>
                <li>Use facial recognition, behavioral tracking, or individual sentiment analysis</li>
                <li>Process data that could identify specific persons within analyzed populations</li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-3">4. How We Use Data</h2>
              <p className="text-muted-foreground mb-2">
                <strong>User data</strong> is used exclusively for:
              </p>
              <ul className="list-disc list-inside text-muted-foreground space-y-1">
                <li>Account authentication and session management</li>
                <li>Access control and role-based permissions</li>
                <li>Platform improvement and error resolution</li>
                <li>Compliance with audit and governance requirements</li>
              </ul>
              <p className="text-muted-foreground mt-3 mb-2">
                <strong>Analytical data</strong> is used for:
              </p>
              <ul className="list-disc list-inside text-muted-foreground space-y-1">
                <li>Generating AI-assisted geopolitical and socioeconomic assessments</li>
                <li>Computing risk indicators, vulnerability scores, and trend analyses</li>
                <li>Producing forecasts with explicit confidence intervals and uncertainty labeling</li>
                <li>Detecting anomalies and emerging patterns across domains</li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-3">5. AI Processing &amp; Transparency</h2>
              <p className="text-muted-foreground">
                AICIS uses artificial intelligence for analytical signal generation. In compliance with the EU AI Act:
              </p>
              <ul className="list-disc list-inside text-muted-foreground space-y-1 mt-2">
                <li>All AI-generated outputs are labeled as <strong>"AI-assisted analysis"</strong></li>
                <li>No autonomous decision-making is performed — all outputs are advisory</li>
                <li>Human-in-the-loop governance is mandatory for all actionable recommendations</li>
                <li>Confidence scores and data provenance are displayed for every assessment</li>
                <li>The methodology and model architecture are documented and auditable</li>
                <li>AI models are calibrated against historical data with published accuracy metrics</li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-3">6. Your Rights (GDPR &amp; International)</h2>
              <p className="text-muted-foreground mb-2">Under GDPR and applicable data protection laws, you have the right to:</p>
              <ul className="list-disc list-inside text-muted-foreground space-y-1">
                <li><strong>Access:</strong> Request a copy of your personal data held by AICIS</li>
                <li><strong>Rectification:</strong> Correct inaccurate or incomplete personal data</li>
                <li><strong>Erasure:</strong> Request deletion of your personal data ("right to be forgotten")</li>
                <li><strong>Portability:</strong> Receive your data in a structured, machine-readable format</li>
                <li><strong>Restriction:</strong> Request restriction of processing under certain conditions</li>
                <li><strong>Objection:</strong> Object to processing based on legitimate interests</li>
                <li><strong>Withdraw consent:</strong> Withdraw consent at any time without affecting prior lawful processing</li>
                <li><strong>Automated decisions:</strong> Request human review of any AI-assisted output affecting you</li>
              </ul>
              <p className="text-muted-foreground mt-2">
                To exercise these rights, contact: <strong>privacy@aicis.com</strong>
              </p>
              <p className="text-muted-foreground mt-1 text-xs">
                We will respond to all data subject requests within 30 days, in compliance with GDPR Article 12.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-3">7. Data Security</h2>
              <p className="text-muted-foreground">
                We implement technical and organizational measures proportionate to the sensitivity of data processed:
              </p>
              <ul className="list-disc list-inside text-muted-foreground space-y-1 mt-2">
                <li>Encryption in transit (TLS 1.3) and at rest (AES-256)</li>
                <li>Role-based access control (RBAC) with row-level security</li>
                <li>Immutable audit logs for all data access and modifications</li>
                <li>Regular security assessments and dependency scanning</li>
                <li>Incident response procedures with breach notification within 72 hours (GDPR Art. 33)</li>
              </ul>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-3">8. Data Retention</h2>
              <p className="text-muted-foreground">
                User account data is retained for the duration of your account plus 30 days after deletion request.
                Analytical data (country-level indicators) is retained indefinitely as public statistical records
                necessary for time-series analysis and forecast validation. Audit logs are retained for a minimum
                of 7 years for compliance purposes.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-3">9. International Data Transfers</h2>
              <p className="text-muted-foreground">
                Data may be processed on infrastructure located within the European Economic Area (EEA). Where
                transfers outside the EEA are necessary, we rely on Standard Contractual Clauses (SCCs) or
                adequacy decisions as approved by the European Commission.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-3">10. Third-Party Data Sources</h2>
              <p className="text-muted-foreground">
                All external data sources used by AICIS are publicly available datasets provided by international
                organizations (World Bank, WHO, FAO, etc.) under their respective open data licenses. We comply
                with all applicable terms of service and attribution requirements. No restricted, proprietary, or
                scraped data is used without explicit authorization.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-3">11. Children's Privacy</h2>
              <p className="text-muted-foreground">
                AICIS is a professional intelligence platform not intended for use by individuals under 16 years of age.
                We do not knowingly collect personal information from minors.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-3">12. Changes to This Policy</h2>
              <p className="text-muted-foreground">
                Material changes to this Privacy Policy will be communicated via email notification to registered users
                and through a prominent notice on the platform at least 30 days before taking effect.
              </p>
            </section>

            <section>
              <h2 className="text-2xl font-semibold mb-3">13. Contact &amp; Data Protection Officer</h2>
              <p className="text-muted-foreground">
                For privacy inquiries or to exercise your data rights:
              </p>
              <p className="text-muted-foreground mt-2">
                Email: <strong>privacy@aicis.com</strong><br />
                Data Protection Officer: <strong>dpo@aicis.com</strong>
              </p>
            </section>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};

export default Privacy;
