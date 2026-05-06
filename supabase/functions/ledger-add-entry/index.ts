import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://esm.sh/zod@3.23.8";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-aicis-node-key',
};

const EntrySchema = z.object({
  entryType: z.string().trim().min(1).max(80),
  payload: z.record(z.any()).refine(v => JSON.stringify(v).length <= 100_000, 'payload too large'),
  signature: z.string().max(8000).optional().nullable(),
});

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const raw = await req.json().catch(() => ({}));
    const parsed = EntrySchema.safeParse(raw);
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: 'Invalid input', issues: parsed.error.flatten() }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const { entryType, payload, signature } = parsed.data;
    const nodeKey = req.headers.get('X-AICIS-Node-Key');

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    let nodeId: string | null = null;
    if (nodeKey) {
      const keyHash = await sha256Hex(nodeKey);
      const { data: node } = await supabaseClient
        .from('accountability_nodes')
        .select('id, verified')
        .eq('api_key_hash', keyHash)
        .single();

      if (!node || !node.verified) {
        return new Response(JSON.stringify({ error: 'Invalid or unverified node key' }), {
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      nodeId = node.id;
    }

    const { data: lastEntry } = await supabaseClient
      .from('ledger_entries')
      .select('hash')
      .order('block_number', { ascending: false })
      .limit(1)
      .single();

    const previousHash = lastEntry?.hash || 'genesis';
    const entryData = {
      entry_type: entryType,
      payload,
      previous_hash: previousHash,
      timestamp: new Date().toISOString(),
    };
    const hash = await sha256Hex(JSON.stringify(entryData));

    const { data: entry, error: entryError } = await supabaseClient
      .from('ledger_entries')
      .insert({
        entry_type: entryType,
        node_id: nodeId,
        hash,
        payload,
        signature: signature ?? null,
        previous_hash: previousHash,
        verified: !!signature,
      })
      .select()
      .single();

    if (entryError) throw entryError;

    if (nodeId) {
      await supabaseClient.from('node_audit_trail').insert({
        node_id: nodeId,
        action: 'ledger_entry_added',
        status: 'success',
        metadata: { entry_id: entry.id, entry_type: entryType, hash },
      });
    }

    return new Response(JSON.stringify({
      success: true,
      entry: { id: entry.id, hash, block_number: entry.block_number, verified: entry.verified },
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error) {
    console.error('ledger-add-entry error:', error);
    return new Response(JSON.stringify({ error: 'Failed to add entry' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
