import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireAdminOrCron } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface CountryAggregate {
  iso3: string;
  avg_risk: number;
  avg_momentum: number;
  avg_fragility: number;
  avg_performance: number;
  avg_confidence: number;
  total_breaks: number;
  domains_down: number;
  domains_up: number;
  domain_count: number;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ ok: false, error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json", Allow: "POST" },
    });
  }

  const { response: authResponse } = await requireAdminOrCron(req, corsHeaders);
  if (authResponse) return authResponse;

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sb = createClient(supabaseUrl, serviceKey);

  try {
    const { data: latestRow, error: latestError } = await sb
      .from("country_performance_snapshots")
      .select("snapshot_date")
      .order("snapshot_date", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestError) throw latestError;
    if (!latestRow) {
      return new Response(
        JSON.stringify({ ok: false, error: "No snapshot data available" }),
        { status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const snapshotDate = latestRow.snapshot_date;

    const { data: countries, error: rpcError } = await sb.rpc(
      "aggregate_country_snapshots",
      { _snapshot_date: snapshotDate },
    );

    if (rpcError || !countries?.length) {
      throw new Error(rpcError?.message || "No aggregated data returned");
    }

    const typed = countries as CountryAggregate[];

    const deteriorating = [...typed]
      .sort((a, b) => {
        const scoreA = a.avg_risk * 0.5 + Math.abs(Math.min(a.avg_momentum, 0)) * 0.3 + a.total_breaks * 0.2;
        const scoreB = b.avg_risk * 0.5 + Math.abs(Math.min(b.avg_momentum, 0)) * 0.3 + b.total_breaks * 0.2;
        return scoreB - scoreA;
      })
      .slice(0, 5);

    const improving = [...typed]
      .sort((a, b) => {
        const scoreA = Math.max(a.avg_momentum, 0) * 0.5 + (100 - a.avg_risk) * 0.3 + a.domains_up * 0.2;
        const scoreB = Math.max(b.avg_momentum, 0) * 0.5 + (100 - b.avg_risk) * 0.3 + b.domains_up * 0.2;
        return scoreB - scoreA;
      })
      .slice(0, 5);

    const fragility = [...typed]
      .sort((a, b) => a.avg_fragility - b.avg_fragility)
      .slice(0, 5);

    const breakLeaders = [...typed]
      .sort((a, b) => b.total_breaks - a.total_breaks)
      .slice(0, 10);

    const totalCountries = typed.length;
    const totalDomains = typed.reduce((sum, country) => sum + country.domain_count, 0);
    const avgConfidence = totalCountries > 0
      ? +(typed.reduce((sum, country) => sum + country.avg_confidence, 0) / totalCountries).toFixed(1)
      : null;
    const totalBreaks = typed.reduce((sum, country) => sum + country.total_breaks, 0);

    const { data: calibration, error: calibrationError } = await sb
      .from("calibration_metrics")
      .select("metric_value")
      .eq("metric_name", "mape")
      .order("computed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (calibrationError) throw calibrationError;

    // Missing calibration must remain missing. A decision brief must never
    // replace absent evidence with a plausible-looking default statistic.
    const actualMape = calibration?.metric_value == null
      ? null
      : Number(calibration.metric_value);

    const issueDate = new Date().toISOString().split("T")[0];
    const weekNum = getISOWeek(new Date());

    // Idempotency guard for repeated cron/admin calls on the same date.
    const { data: existingBrief, error: existingError } = await sb
      .from("weekly_briefs")
      .select("id, issue_number, brief_date")
      .eq("brief_date", issueDate)
      .limit(1)
      .maybeSingle();
    if (existingError) throw existingError;
    if (existingBrief) {
      return new Response(JSON.stringify({
        ok: true,
        already_generated: true,
        id: existingBrief.id,
        issue_number: existingBrief.issue_number,
        brief_date: existingBrief.brief_date,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const calibrationText = actualMape == null
      ? "Calibration MAPE is not currently available."
      : `Calibration MAPE: ${actualMape.toFixed(1)}%.`;
    const confidenceText = avgConfidence == null
      ? "Average confidence is not currently available."
      : `Average confidence: ${avgConfidence}%.`;

    const sections = {
      executive_summary: {
        title: "Executive Summary",
        content:
          `AICIS Global Structural Risk Brief — Week ${weekNum}, ${issueDate}. ` +
          `The current snapshot contains ${totalCountries} countries across ${totalDomains} domain models. ` +
          `${calibrationText} ${confidenceText} ` +
          `Total structural breaks detected in the aggregated snapshot: ${totalBreaks}.`,
      },
      deteriorating: {
        title: "Top 5 Deteriorating Nations",
        countries: deteriorating.map((country) => ({
          iso3: country.iso3,
          risk_pressure: country.avg_risk,
          momentum: country.avg_momentum,
          fragility: country.avg_fragility,
          breaks: country.total_breaks,
          domains_declining: country.domains_down,
        })),
      },
      improving: {
        title: "Top 5 Improving Nations",
        countries: improving.map((country) => ({
          iso3: country.iso3,
          momentum: country.avg_momentum,
          risk_pressure: country.avg_risk,
          performance: country.avg_performance,
          domains_rising: country.domains_up,
        })),
      },
      fragility_watch: {
        title: "Systemic Fragility Watch",
        countries: fragility.map((country) => ({
          iso3: country.iso3,
          fragility_score: country.avg_fragility,
          risk_pressure: country.avg_risk,
          breaks: country.total_breaks,
        })),
      },
      break_density: {
        title: "Structural Break Density",
        leaders: breakLeaders.map((country) => ({
          iso3: country.iso3,
          total_breaks: country.total_breaks,
          confidence: country.avg_confidence,
        })),
      },
      confidence_assessment: {
        title: "Confidence Assessment",
        avg_confidence: avgConfidence,
        mape: actualMape,
        note:
          avgConfidence == null
            ? "Confidence aggregation is unavailable for this snapshot."
            : avgConfidence < 40
              ? "Current average confidence is low; decisions should require stronger corroboration and human review."
              : "Current average confidence is within the configured operational range.",
      },
      methodology: {
        title: "Methodology Note",
        content:
          "Rankings are derived from the current country performance snapshot and its configured statistical pipeline. " +
          "Exact upstream sources and provenance must be verified from the source ledger for each observation. " +
          "This brief is auto-generated decision support and does not constitute policy advice.",
      },
    };

    const summaryMd = generateMarkdown(sections, issueDate, weekNum);

    const { data: lastIssue, error: issueError } = await sb
      .from("weekly_briefs")
      .select("issue_number")
      .order("issue_number", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (issueError) throw issueError;

    const issueNumber = Number(lastIssue?.issue_number ?? 0) + 1;

    const { data: inserted, error: insertError } = await sb
      .from("weekly_briefs")
      .insert({
        issue_number: issueNumber,
        brief_date: issueDate,
        title: `AICIS Global Structural Risk Brief — Issue #${issueNumber}`,
        summary_md: summaryMd,
        sections,
        metadata: {
          snapshot_date: snapshotDate,
          engine_version: "APE-V2.1",
          generated_by: "generate-weekly-brief",
          aggregation: "server-side SQL",
          calibration_available: actualMape != null,
        },
        countries_covered: totalCountries,
        models_count: totalDomains,
        avg_mape: actualMape,
        avg_confidence: avgConfidence,
      })
      .select()
      .single();

    if (insertError) throw insertError;

    return new Response(JSON.stringify({
      ok: true,
      issue_number: issueNumber,
      brief_date: issueDate,
      countries_covered: totalCountries,
      models_count: totalDomains,
      avg_mape: actualMape,
      avg_confidence: avgConfidence,
      total_breaks: totalBreaks,
      id: inserted?.id,
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error(JSON.stringify({
      level: "error",
      function: "generate-weekly-brief",
      message: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    }));
    return new Response(JSON.stringify({ ok: false, error: "Weekly brief generation failed" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

function getISOWeek(input: Date): number {
  const date = new Date(input.getTime());
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7));
  const week1 = new Date(date.getFullYear(), 0, 4);
  return 1 + Math.round(
    ((date.getTime() - week1.getTime()) / 86400000 -
      3 +
      ((week1.getDay() + 6) % 7)) /
      7,
  );
}

function generateMarkdown(
  sections: Record<string, any>,
  date: string,
  week: number,
): string {
  const lines: string[] = [];

  lines.push("# AICIS Global Structural Risk Brief");
  lines.push(`**Week ${week} — ${date}**`);
  lines.push("");
  lines.push(`## ${sections.executive_summary.title}`);
  lines.push(sections.executive_summary.content);
  lines.push("");

  lines.push(`## ${sections.deteriorating.title}`);
  lines.push("| Rank | Country | Risk Pressure | Momentum | Fragility | Breaks |");
  lines.push("|------|---------|--------------|----------|-----------|--------|");
  sections.deteriorating.countries.forEach((country: any, index: number) => {
    lines.push(`| ${index + 1} | ${country.iso3} | ${country.risk_pressure} | ${country.momentum} | ${country.fragility} | ${country.breaks} |`);
  });
  lines.push("");

  lines.push(`## ${sections.improving.title}`);
  lines.push("| Rank | Country | Momentum | Risk Pressure | Performance | Domains ↑ |");
  lines.push("|------|---------|----------|--------------|-------------|-----------|");
  sections.improving.countries.forEach((country: any, index: number) => {
    lines.push(`| ${index + 1} | ${country.iso3} | ${country.momentum} | ${country.risk_pressure} | ${country.performance} | ${country.domains_rising} |`);
  });
  lines.push("");

  lines.push(`## ${sections.fragility_watch.title}`);
  lines.push("| Country | Fragility Score | Risk Pressure | Breaks |");
  lines.push("|---------|----------------|--------------|--------|");
  sections.fragility_watch.countries.forEach((country: any) => {
    lines.push(`| ${country.iso3} | ${country.fragility_score} | ${country.risk_pressure} | ${country.breaks} |`);
  });
  lines.push("");

  lines.push(`## ${sections.break_density.title}`);
  lines.push("| Country | Total Breaks | Confidence |");
  lines.push("|---------|-------------|------------|");
  sections.break_density.leaders.forEach((country: any) => {
    lines.push(`| ${country.iso3} | ${country.total_breaks} | ${country.confidence}% |`);
  });
  lines.push("");

  lines.push(`## ${sections.confidence_assessment.title}`);
  const confidence = sections.confidence_assessment.avg_confidence == null
    ? "unavailable"
    : `${sections.confidence_assessment.avg_confidence}%`;
  const mape = sections.confidence_assessment.mape == null
    ? "unavailable"
    : `${Number(sections.confidence_assessment.mape).toFixed(1)}%`;
  lines.push(`Average Confidence: **${confidence}** | MAPE: **${mape}**`);
  lines.push("");
  lines.push(`> ${sections.confidence_assessment.note}`);
  lines.push("");

  lines.push("---");
  lines.push(`*${sections.methodology.content}*`);

  return lines.join("\n");
}
