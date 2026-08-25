import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";
import { aiChat } from "../_shared/ai-gateway.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const ObjectiveSchema = z.object({
  objective: z.string().trim().min(5).max(4000),
});

const ALLOWED_FUNCTIONS: Record<string, string> = {
  "pull-coingecko": "finance",
  "pull-owid-energy": "energy",
  "pull-faostat-food": "food",
  "pull-owid-health": "health",
  "detect-anomalies": "system",
  "analyze-global-status": "system",
  "predict-risks": "system",
  "governance-scan": "governance",
  "defense-posture-refresh": "defense",
  "diplomacy-scan": "diplomacy",
  "crisis-scan": "crisis",
};

const TaskSchema = z.object({
  division: z.string().trim().min(1).max(64),
  action: z.string().trim().min(1).max(300),
  function_name: z.string().trim().min(1).max(128),
  parameters: z.record(z.unknown()).default({}),
});

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) throw new Error("Unauthorized");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) throw new Error("Unauthorized");

    const parsedInput = ObjectiveSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsedInput.success) {
      return new Response(JSON.stringify({ error: "Invalid objective", details: parsedInput.error.issues }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { objective } = parsedInput.data;

    const allowedFunctionList = Object.entries(ALLOWED_FUNCTIONS)
      .map(([fn, division]) => `- ${fn} (${division})`)
      .join("\n");

    const plan = await aiChat({
      messages: [
        {
          role: "system",
          content: `You are AICIS Strategic Planner operating in planning-only mode. Break the user's objective into a small, reviewable sequence of tasks. You may ONLY reference functions from this allowlist:\n${allowedFunctionList}\n\nReturn ONLY valid JSON in this shape: {"tasks":[{"division":"...","action":"...","function_name":"...","parameters":{}}]}. Do not invent functions, credentials, URLs, SQL, shell commands, or autonomous execution steps. Maximum 10 tasks.`,
        },
        { role: "user", content: `Objective: ${objective}` },
      ],
      responseFormat: { type: "json_object" },
      temperature: 0.1,
      maxTokens: 1400,
      timeoutMs: 20000,
    });

    let rawTasks: unknown[] = [];
    try {
      const decoded = JSON.parse(plan.content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim());
      rawTasks = Array.isArray(decoded?.tasks) ? decoded.tasks.slice(0, 10) : [];
    } catch {
      rawTasks = [];
    }

    const rejectedTasks: Array<{ reason: string; function_name?: string }> = [];
    const tasks = rawTasks.flatMap((raw) => {
      const candidate = TaskSchema.safeParse(raw);
      if (!candidate.success) {
        rejectedTasks.push({ reason: "invalid_task_schema" });
        return [];
      }
      const task = candidate.data;
      const expectedDivision = ALLOWED_FUNCTIONS[task.function_name];
      if (!expectedDivision) {
        rejectedTasks.push({ reason: "function_not_allowlisted", function_name: task.function_name });
        return [];
      }
      const division = expectedDivision === "system" ? task.division : expectedDivision;
      return [{
        division,
        action: task.action,
        function_name: task.function_name,
        parameters: task.parameters,
        plan_provider: plan.provider,
        plan_model: plan.model,
        execution_class: "queued_for_human_review",
      }];
    });

    const { data: objectiveRecord, error: objectiveError } = await supabase
      .from("objectives")
      .insert({
        issued_by: user.id,
        objective_text: objective,
        ai_plan: {
          tasks,
          rejected_tasks: rejectedTasks,
          provider: plan.provider,
          model: plan.model,
          output_class: "ai_generated_plan_requires_review",
        },
        status: "pending",
      })
      .select()
      .single();
    if (objectiveError || !objectiveRecord) throw objectiveError || new Error("Failed to create objective");

    const taskInserts = tasks.map((task) => ({
      objective_id: objectiveRecord.id,
      division: task.division,
      action: task.action,
      function_name: task.function_name,
      parameters: {
        ...task.parameters,
        _planning_provenance: {
          provider: task.plan_provider,
          model: task.plan_model,
          execution_class: task.execution_class,
        },
      },
      status: "queued",
    }));

    if (taskInserts.length > 0) {
      const { error: tasksError } = await supabase.from("objective_tasks").insert(taskInserts);
      if (tasksError) throw tasksError;
    }

    await supabase.from("system_logs").insert({
      action: "process_objective",
      division: "system",
      user_id: user.id,
      log_level: rejectedTasks.length ? "warning" : "info",
      result: `Objective planned with ${tasks.length} allowlisted tasks; ${rejectedTasks.length} rejected`,
      metadata: {
        objective_id: objectiveRecord.id,
        tasks: tasks.length,
        rejected_tasks: rejectedTasks,
        provider: plan.provider,
        model: plan.model,
        execution_class: "queued_for_human_review",
      },
    });

    await supabase.from("compliance_audit").insert({
      action_type: "strategic_planning",
      division: "system",
      user_id: user.id,
      action_description: `Generated review-required strategic plan for objective ${objectiveRecord.id}`,
      compliance_status: "review",
      data_accessed: { objective_id: objectiveRecord.id, task_count: tasks.length, rejected_task_count: rejectedTasks.length },
    });

    return new Response(JSON.stringify({
      ok: true,
      objective: objectiveRecord,
      tasks: taskInserts,
      rejected_tasks: rejectedTasks,
      execution_class: "queued_for_human_review",
      provider: plan.provider,
      model: plan.model,
      message: `Objective planned with ${tasks.length} validated tasks`,
    }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("process-objective error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
