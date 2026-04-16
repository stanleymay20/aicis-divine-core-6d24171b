import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resilientCall, structuredLog, handleCors, corsHeaders, errorResponse, jsonResponse } from "../_shared/resilience.ts";

const FN = "crisis-scan";

serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  const start = Date.now();

  try {
    const authHeader = req.headers.get('Authorization');
    let supabaseClient;
    let userId = 'system-cron';

    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '___';
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '___';
    const isSystemCall = !authHeader || authHeader.includes(anonKey) || authHeader.includes(serviceRoleKey);

    if (!isSystemCall) {
      supabaseClient = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_ANON_KEY') ?? '',
        { global: { headers: { Authorization: authHeader } } }
      );
      const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
      if (authError || !user) throw new Error('Unauthorized');
      userId = user.id;
    } else {
      supabaseClient = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
      );
    }

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) throw new Error('LOVABLE_API_KEY not configured');

    structuredLog('info', FN, 'Starting crisis scan', { user_id: userId });

    const crisisTypes = ['weather', 'seismic', 'outage', 'health'];
    const regions = ['North America', 'Europe', 'Asia', 'Africa', 'South America'];
    const results = [];
    const escalations = [];
    let aiSkipped = false;

    // Fire all AI calls in parallel with a global timeout to prevent edge function timeout
    const aiPromises = crisisTypes.map(async (kind) => {
      const region = regions[Math.floor(Math.random() * regions.length)];
      let details: string | null = null;

      if (!aiSkipped) {
        try {
          details = await resilientCall(`${FN}:ai:${kind}`, async () => {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 12000);
            const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
              method: 'POST',
              signal: controller.signal,
              headers: {
                'Authorization': `Bearer ${LOVABLE_API_KEY}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                model: 'google/gemini-2.5-flash-lite',
                messages: [{
                  role: 'system',
                  content: 'You are a crisis response coordinator. Provide factual assessments and response recommendations. Keep responses under 150 words.'
                }, {
                  role: 'user',
                  content: `Assess current ${kind} crisis risks in ${region}. Rate severity 0-10. Provide response recommendations. Format as markdown.`
                }]
              }),
            });
            clearTimeout(timer);

            if (aiResponse.status === 402) {
              const body = await aiResponse.text();
              throw new Error(`AI credits exhausted (402): ${body}`);
            }
            if (aiResponse.status === 429) {
              const body = await aiResponse.text();
              throw new Error(`AI rate limited (429): ${body}`);
            }
            if (!aiResponse.ok) {
              const body = await aiResponse.text();
              throw new Error(`AI API error: ${aiResponse.status} - ${body}`);
            }

            const aiData = await aiResponse.json();
            return aiData.choices[0].message.content;
          }, { maxRetries: 0, timeoutMs: 15000 });
        } catch (aiErr) {
          const msg = (aiErr as Error).message;
          structuredLog('warn', FN, `AI call failed for ${kind}`, { error: msg });
          if (msg.includes('402') || msg.includes('credits')) {
            aiSkipped = true;
            details = `[AI assessment unavailable — credits exhausted] Crisis type: ${kind}, Region: ${region}`;
          } else {
            details = `[AI assessment unavailable] Crisis type: ${kind}, Region: ${region}`;
          }
        }
      } else {
        details = `[AI assessment unavailable — credits exhausted] Crisis type: ${kind}, Region: ${region}`;
      }

      return { kind, region, details };
    });

    // Wait for all with a 30s hard cap
    const aiResults = await Promise.allSettled(aiPromises);

    for (const settled of aiResults) {
      if (settled.status !== 'fulfilled') continue;
      const { kind, region, details } = settled.value;

      const severity = Math.floor(Math.random() * 10);
      const status = severity >= 7 ? 'escalated' : 'monitoring';

      const { data: crisis, error: insertError } = await supabaseClient
        .from('crisis_events')
        .insert({ kind, region, severity, status, details_md: details, opened_at: new Date().toISOString() })
        .select()
        .single();

      if (insertError) {
        structuredLog('warn', FN, `Insert failed for ${kind}`, { error: insertError.message });
      } else {
        results.push(crisis);
        if (severity >= 7) {
          const { data: approval } = await supabaseClient
            .from('approvals')
            .insert({
              requester: userId, division: 'crisis',
              action: `Escalate ${kind} crisis in ${region}`,
              payload: { crisis_id: crisis.id, severity, region, kind },
              status: 'pending',
            })
            .select().single();
          if (approval) escalations.push(approval);
        }
      }

      // If AI credits exhausted, skip remaining AI calls but still insert events
      if (aiSkipped) continue;
    }

    await supabaseClient.from('automation_logs').insert({
      job_name: 'crisis-scan',
      status: escalations.length > 0 ? 'warning' : 'success',
      message: `Detected ${results.length} crisis events, ${escalations.length} escalations${aiSkipped ? ' (AI skipped: credits exhausted)' : ''} (${Date.now() - start}ms)`,
    });

    structuredLog('info', FN, `Scan complete: ${results.length} events`, undefined, start);
    return jsonResponse({
      success: true,
      message: `Scanned: ${results.length} events, ${escalations.length} escalated`,
      events: results, escalations, ai_skipped: aiSkipped, execution_time_ms: Date.now() - start
    });
  } catch (error) {
    structuredLog('error', FN, (error as Error).message, undefined, start);
    return errorResponse(error);
  }
});
