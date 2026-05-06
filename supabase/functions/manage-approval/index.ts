import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://esm.sh/zod@3.23.8";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const CreateSchema = z.object({
  action: z.literal('create'),
  division: z.string().trim().min(1).max(80),
  action_text: z.string().trim().min(1).max(500),
  payload: z.any().optional().refine(v => v === undefined || JSON.stringify(v).length <= 50_000, 'payload too large'),
});

const DecideSchema = z.object({
  action: z.literal('decide'),
  approval_id: z.string().uuid(),
  decision: z.enum(['approved', 'rejected']),
});

const InputSchema = z.discriminatedUnion('action', [CreateSchema, DecideSchema]);

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
    const parsed = InputSchema.safeParse(raw);
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: 'Invalid input', issues: parsed.error.flatten() }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const input = parsed.data;

    if (input.action === 'create') {
      const { division, action_text, payload } = input;
      const { data: approval, error: insertError } = await supabaseClient
        .from('approvals')
        .insert({
          requester: user.id,
          division,
          action: action_text,
          payload: payload ?? null,
          status: 'pending',
        })
        .select().single();
      if (insertError) throw insertError;

      await supabaseClient.from('system_logs').insert({
        action: 'approval_requested',
        division, user_id: user.id, log_level: 'info',
        result: `Approval request created: ${action_text}`,
        metadata: { approval_id: approval.id },
      });

      return new Response(JSON.stringify({
        success: true, message: '✅ Approval request created', approval,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // decide
    const { approval_id, decision } = input;
    const { data: userRole } = await supabaseClient
      .from('user_roles').select('role').eq('user_id', user.id).single();
    if (!userRole || userRole.role !== 'admin') {
      return new Response(JSON.stringify({ error: 'Only admins can decide approvals' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: approval, error: updateError } = await supabaseClient
      .from('approvals')
      .update({
        status: decision,
        decided_at: new Date().toISOString(),
        decided_by: user.id,
      })
      .eq('id', approval_id)
      .select().single();
    if (updateError) throw updateError;

    await supabaseClient.from('system_logs').insert({
      action: 'approval_decided',
      division: approval.division,
      user_id: user.id,
      log_level: 'info',
      result: `Approval ${decision}: ${approval.action}`,
      metadata: { approval_id, decision },
    });

    return new Response(JSON.stringify({
      success: true, message: `✅ Approval ${decision}`, approval,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error) {
    console.error('Manage approval error:', error);
    return new Response(JSON.stringify({ error: 'Approval action failed' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
