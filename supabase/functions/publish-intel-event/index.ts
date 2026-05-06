import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://esm.sh/zod@3.23.8";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const SeverityEnum = z.enum(['info', 'low', 'medium', 'high', 'critical', 'emergency']);

const EventSchema = z.object({
  division: z.string().trim().min(1).max(80),
  event_type: z.string().trim().min(1).max(80),
  severity: SeverityEnum,
  title: z.string().trim().min(1).max(300),
  description: z.string().max(5000).optional().nullable(),
  payload: z.any().optional().refine(v => v === undefined || v === null || JSON.stringify(v).length <= 50_000, 'payload too large'),
  source_system: z.string().max(120).optional().nullable(),
});

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } }
    );

    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const raw = await req.json().catch(() => ({}));
    const parsed = EventSchema.safeParse(raw);
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: 'Invalid input', issues: parsed.error.flatten() }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const { division, event_type, severity, title, description, payload, source_system } = parsed.data;

    await supabaseClient.from('compliance_audit').insert({
      action_type: 'intel_event_publish',
      division,
      user_id: user.id,
      action_description: `Published ${severity} intel event: ${title}`,
      compliance_status: 'compliant',
      data_accessed: { event_type, severity },
    });

    const { data: event, error: insertError } = await supabaseClient
      .from('intel_events')
      .insert({
        division, event_type, severity, title,
        description: description ?? null,
        payload: payload ?? null,
        source_system: source_system ?? null,
        published_by: user.id,
      })
      .select()
      .single();

    if (insertError) throw insertError;

    await supabaseClient.from('system_logs').insert({
      action: 'intel_event_published',
      division,
      user_id: user.id,
      log_level: severity === 'emergency' ? 'error' : severity === 'critical' ? 'warning' : 'info',
      result: `Published: ${title}`,
      metadata: { event_id: event.id, event_type, severity },
    });

    return new Response(JSON.stringify({
      success: true,
      message: `✅ Intel event published to ${division} division`,
      event,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error) {
    console.error('Publish intel event error:', error);
    return new Response(JSON.stringify({ error: 'Failed to publish event' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
