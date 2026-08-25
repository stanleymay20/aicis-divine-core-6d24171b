// Multi-agent cognition orchestrator.
// Fans a scoped question out to independent domain-specialist agents, each of which
// must ground its claim in real evidence rows pulled from production tables, then
// synthesises the perspectives WITHOUT collapsing disagreement.
import { createClient } from "npm:@supabase/supabase-js@2";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { aiChat } from "../_shared/ai-gateway.ts";

type EvidenceRow = {
  ref: string;
  source_kind: string;
  source_table: string;
  source_row_id: string | null;
  source_url: string | null;
  source_title: string;
  excerpt: string | null;
  observed_at: string | null;
};

const DOMAIN_CATEGORIES: Record<string, string[]> = {
  security: ["defense_conflict", "social_unrest", "cybersecurity", "maritime_security"],
  governance: ["geopolitical", "legal_regulatory", "elections"],
  finance: ["economic", "financial_markets", "central_banking"],
  energy: ["energy", "infrastructure"],
  food: ["food_agriculture", "water_hydrology"],
  health: ["public_health"],
  climate: ["climate_disaster"],
  supply_chain: ["supply_chain", "technology"],
  migration: ["migration_displacement"],
};

async function sha256(text: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function callModel(system: string, user: string) {
  const result = await aiChat({
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
    responseFormat: { type: "json_object" },
    temperature: 0.2,
    timeoutMs: 30_000,
  });

  let parsed: any;
  try {
    parsed = JSON.parse(result.content);
  } catch {
    const m = result.content.match(/\{[\s\S]*\}/);
    if (!m) throw new Error("Model returned unparseable output");
    parsed = JSON.parse(m[0]);
  }
  return { output: parsed, provider: result.provider, model: result.model };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let taskId: string | null = null;
  try {
    const body = await req.json().catch(() => ({}));
    const question: string = (body.question ?? "").trim();
    const subject_kind: string = body.subject_kind ?? "country";
    const subject_key: string | null = body.subject_key ?? null;
    const windowDays: number = Math.min(Math.max(Number(body.evidence_window_days ?? 30), 3), 180);
    const domains: string[] = Array.isArray(body.domains) && body.domains.length
      ? body.domains.filter((d: string) => d in DOMAIN_CATEGORIES)
      : ["security", "governance", "finance"];

    if (!question) return json({ error: "question is required" }, 400);
    if (domains.length < 2) return json({ error: "at least two domains are required" }, 400);

    const task_key = `${subject_kind}:${subject_key ?? "global"}:${(await sha256(question)).slice(0, 16)}:${new Date().toISOString()}`;
    const configuredProvider = Deno.env.get("AICIS_MODEL_PROVIDER")?.trim() || "provider-neutral";
    const configuredModel = Deno.env.get("AICIS_MODEL_NAME")?.trim() || "default";

    const { data: task, error: taskErr } = await supabase
      .from("agent_coordination_tasks")
      .insert({
        task_key,
        question,
        subject_kind,
        subject_key,
        domains,
        status: "running",
        provider: configuredProvider,
        model: configuredModel,
        evidence_window_days: windowDays,
        started_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    if (taskErr) throw taskErr;
    taskId = task.id;

    const since = new Date(Date.now() - windowDays * 86400_000).toISOString();

    const evidenceByDomain: Record<string, EvidenceRow[]> = {};
    for (const domain of domains) {
      const rows: EvidenceRow[] = [];
      let sig = supabase
        .from("global_signals")
        .select("id,title,summary,primary_source,ingested_at,occurred_at,category,geo_admin0_iso3")
        .gte("ingested_at", since)
        .in("category", DOMAIN_CATEGORIES[domain])
        .order("ingested_at", { ascending: false })
        .limit(12);
      if (subject_kind === "country" && subject_key) sig = sig.eq("geo_admin0_iso3", subject_key);
      const { data: signals, error: sigErr } = await sig;
      if (sigErr) throw sigErr;
      (signals ?? []).forEach((s: any, i: number) =>
        rows.push({
          ref: `${domain}-S${i + 1}`,
          source_kind: "signal",
          source_table: "global_signals",
          source_row_id: s.id,
          source_url: s.primary_source ?? null,
          source_title: s.title ?? "(untitled signal)",
          excerpt: (s.summary ?? "").slice(0, 400) || null,
          observed_at: s.occurred_at ?? s.ingested_at,
        }),
      );

      if (subject_kind === "country" && subject_key) {
        const { data: snaps, error: snapErr } = await supabase
          .from("country_performance_snapshots")
          .select("id,domain,performance_index,momentum_score,volatility_index,snapshot_date")
          .eq("iso3", subject_key)
          .eq("domain", domain)
          .order("snapshot_date", { ascending: false })
          .limit(4);
        if (snapErr) throw snapErr;
        (snaps ?? []).forEach((s: any, i: number) =>
          rows.push({
            ref: `${domain}-M${i + 1}`,
            source_kind: "measurement",
            source_table: "country_performance_snapshots",
            source_row_id: s.id,
            source_url: null,
            source_title: `${domain} performance index ${s.snapshot_date}`,
            excerpt: `index=${s.performance_index}, momentum=${s.momentum_score}, volatility=${s.volatility_index}`,
            observed_at: s.snapshot_date,
          }),
        );
      }
      evidenceByDomain[domain] = rows;
    }

    const perspectives: any[] = [];
    let succeeded = 0;
    let failed = 0;

    for (const domain of domains) {
      const evidence = evidenceByDomain[domain];
      const started = Date.now();
      const system =
        `You are the ${domain} specialist analyst in a multi-agent intelligence cell. ` +
        `Reason ONLY from the numbered evidence provided. You may not use outside knowledge as evidence. ` +
        `You must reach your OWN independent judgement, including disagreeing with what other domains would likely say. ` +
        `If the evidence is too thin to support a claim, say so and set a low confidence. ` +
        `Return strict JSON with keys: claim (one sentence), assessment (<=180 words), key_findings (array of short strings), ` +
        `evidence_refs (array of the evidence ref codes you actually used), assumptions (array), counterevidence (array of strings ` +
        `describing what in the evidence argues against your claim), uncertainty_notes (string), confidence (number 0-1).`;
      const user =
        `Question: ${question}\nSubject: ${subject_kind} ${subject_key ?? "global"}\n` +
        `Evidence window: last ${windowDays} days\n\nEVIDENCE:\n` +
        (evidence.length
          ? evidence.map((e) => `[${e.ref}] (${e.source_kind}, ${e.observed_at ?? "undated"}) ${e.source_title}${e.excerpt ? ` — ${e.excerpt}` : ""}`).join("\n")
          : "(no evidence rows exist for this domain in the window)");

      const promptHash = await sha256(system + user);
      try {
        const modelRun = await callModel(system, user);
        const out = modelRun.output;
        const usedRefs: string[] = Array.isArray(out.evidence_refs)
          ? out.evidence_refs.filter((r: string) => evidence.some((e) => e.ref === r))
          : [];
        let confidence = Math.max(0, Math.min(1, Number(out.confidence ?? 0)));
        if (usedRefs.length === 0) confidence = 0;
        else if (usedRefs.length === 1) confidence = Math.min(confidence, 0.55);

        const { data: analysis, error: aErr } = await supabase
          .from("agent_specialist_analyses")
          .insert({
            task_id: taskId,
            specialist: domain,
            claim: String(out.claim ?? "").slice(0, 2000),
            assessment: String(out.assessment ?? "").slice(0, 8000),
            key_findings: Array.isArray(out.key_findings) ? out.key_findings : [],
            evidence_references: usedRefs,
            evidence_count: usedRefs.length,
            assumptions: Array.isArray(out.assumptions) ? out.assumptions : [],
            counterevidence: Array.isArray(out.counterevidence) ? out.counterevidence : [],
            confidence,
            uncertainty_notes: typeof out.uncertainty_notes === "string" ? out.uncertainty_notes : null,
            provider: modelRun.provider,
            model: modelRun.model,
            prompt_hash: promptHash,
            latency_ms: Date.now() - started,
            status: "success",
          })
          .select("id")
          .single();
        if (aErr) throw aErr;

        const cites = evidence.filter((e) => usedRefs.includes(e.ref)).map((e) => ({
          task_id: taskId,
          analysis_id: analysis.id,
          specialist: domain,
          source_kind: e.source_kind,
          source_table: e.source_table,
          source_row_id: e.source_row_id,
          source_url: e.source_url,
          source_title: e.source_title,
          excerpt: e.excerpt,
          observed_at: e.observed_at,
          weight: 1,
        }));
        if (cites.length) await supabase.from("agent_evidence_citations").insert(cites);

        perspectives.push({ domain, ...out, confidence, evidence_refs: usedRefs, provider: modelRun.provider, model: modelRun.model });
        succeeded++;
      } catch (e) {
        failed++;
        await supabase.from("agent_specialist_analyses").insert({
          task_id: taskId,
          specialist: domain,
          claim: "",
          assessment: "",
          key_findings: [],
          evidence_references: [],
          evidence_count: 0,
          assumptions: [],
          counterevidence: [],
          confidence: 0,
          provider: configuredProvider,
          model: configuredModel,
          prompt_hash: promptHash,
          latency_ms: Date.now() - started,
          status: "error",
          error: (e as Error).message.slice(0, 1000),
        });
      }
    }

    if (succeeded < 2) {
      await supabase.from("agent_coordination_tasks").update({
        status: "error",
        error: `only ${succeeded} specialist perspective(s) succeeded; synthesis requires at least 2`,
        completed_at: new Date().toISOString(),
      }).eq("id", taskId);
      return json({ task_id: taskId, status: "error", specialists_succeeded: succeeded }, 200);
    }

    const synthSystem =
      "You are the synthesis agent. You receive independent specialist perspectives. " +
      "You must NOT average them into a single bland answer. Preserve genuine disagreement explicitly. " +
      "Return strict JSON with keys: executive_summary (<=150 words), agreed_points (array of strings), " +
      "disputed_points (array of {topic, specialist_a, position_a, specialist_b, position_b, divergence 0-1}), " +
      "preserved_dissent (array of strings stating minority positions that must survive), strongest_evidence (string), " +
      "weakest_assumption (string), missing_evidence (array of strings), next_verification_step (string), " +
      "overall_confidence (0-1), confidence_lower (0-1), confidence_upper (0-1).";
    const synthUser =
      `Question: ${question}\nSubject: ${subject_kind} ${subject_key ?? "global"}\n\nPERSPECTIVES:\n` +
      perspectives.map((p) =>
        `### ${p.domain} (confidence ${p.confidence})\nCLAIM: ${p.claim}\nASSESSMENT: ${p.assessment}\n` +
        `ASSUMPTIONS: ${JSON.stringify(p.assumptions ?? [])}\nCOUNTEREVIDENCE: ${JSON.stringify(p.counterevidence ?? [])}\n` +
        `EVIDENCE USED: ${JSON.stringify(p.evidence_refs)}`,
      ).join("\n\n");
    const synthHash = await sha256(synthSystem + synthUser);
    const synthRun = await callModel(synthSystem, synthUser);
    const syn = synthRun.output;

    const confs = perspectives.map((p) => p.confidence);
    const citationCount = perspectives.reduce((a, p) => a + p.evidence_refs.length, 0);
    const thinEvidence = perspectives.some((p) => p.evidence_refs.length === 0);
    const lower = Math.max(0, Math.min(1, Number(syn.confidence_lower ?? Math.min(...confs))));
    const upper = Math.max(lower, Math.min(1, Number(syn.confidence_upper ?? Math.max(...confs))));
    const overall = Math.max(lower, Math.min(upper, Number(syn.overall_confidence ?? 0)));

    await supabase.from("agent_syntheses").insert({
      task_id: taskId,
      executive_summary: String(syn.executive_summary ?? "").slice(0, 8000),
      agreed_points: Array.isArray(syn.agreed_points) ? syn.agreed_points : [],
      disputed_points: Array.isArray(syn.disputed_points) ? syn.disputed_points : [],
      preserved_dissent: Array.isArray(syn.preserved_dissent) ? syn.preserved_dissent : [],
      strongest_evidence: syn.strongest_evidence ?? null,
      weakest_assumption: syn.weakest_assumption ?? null,
      missing_evidence: Array.isArray(syn.missing_evidence) ? syn.missing_evidence : [],
      next_verification_step: syn.next_verification_step ?? null,
      overall_confidence: overall,
      confidence_lower: lower,
      confidence_upper: upper,
      evidence_reference_count: citationCount,
      provider: synthRun.provider,
      model: synthRun.model,
      prompt_hash: synthHash,
      human_authorization_required: true,
      degraded: thinEvidence || failed > 0,
      degradation_reason: thinEvidence
        ? "at least one specialist had no usable evidence rows in the window"
        : failed > 0
          ? `${failed} specialist run(s) failed`
          : null,
      specialists_succeeded: succeeded,
      specialists_failed: failed,
    });

    const disputes = Array.isArray(syn.disputed_points) ? syn.disputed_points : [];
    if (disputes.length) {
      await supabase.from("agent_disagreements").insert(
        disputes.filter((d: any) => d?.specialist_a && d?.specialist_b).map((d: any) => ({
          task_id: taskId,
          topic: String(d.topic ?? "unspecified").slice(0, 500),
          specialist_a: String(d.specialist_a),
          position_a: String(d.position_a ?? "").slice(0, 4000),
          specialist_b: String(d.specialist_b),
          position_b: String(d.position_b ?? "").slice(0, 4000),
          divergence: Math.max(0, Math.min(1, Number(d.divergence ?? 0.5))),
        })),
      );
    }

    await supabase.from("agent_coordination_tasks").update({
      status: "completed",
      provider: synthRun.provider,
      model: synthRun.model,
      completed_at: new Date().toISOString(),
    }).eq("id", taskId);

    return json({
      task_id: taskId,
      status: "completed",
      specialists_succeeded: succeeded,
      specialists_failed: failed,
      citations: citationCount,
      disagreements: disputes.length,
      provider: synthRun.provider,
      model: synthRun.model,
    });
  } catch (e) {
    const message = (e as Error).message ?? "unknown error";
    if (taskId) {
      await supabase.from("agent_coordination_tasks").update({
        status: "error",
        error: message.slice(0, 1000),
        completed_at: new Date().toISOString(),
      }).eq("id", taskId);
    }
    return json({ error: message, task_id: taskId }, 500);
  }
});
