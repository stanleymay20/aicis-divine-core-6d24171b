import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization')!;
    
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_PUBLISHABLE_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user } } = await supabaseClient.auth.getUser();
    if (!user) throw new Error('Unauthorized');

    // DISABLED: this function previously wrote randomised ±2% "balance" fluctuations
    // into exchange_accounts and reported them as real financial state.
    // AICIS has no authorized exchange integration, so no balance can be observed.
    // It now refuses to write rather than fabricating financial operational data.
    await supabaseClient.from('system_logs').insert({
      user_id: user.id,
      division: 'finance',
      action: 'exchange_balance_update',
      result: 'not_implemented_no_authorized_exchange_connector',
      log_level: 'warn',
      metadata: { reason: 'synthetic balance generation removed; no real exchange API configured' }
    });

    return new Response(JSON.stringify({
      ok: false,
      code: 'no_authorized_exchange_connector',
      message: 'Exchange balances cannot be updated: no authorized exchange integration is configured. Synthetic balance generation has been removed.',
      updated: 0,
    }), {
      status: 501,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in update-exchange-balances:', error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : 'Unknown error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
