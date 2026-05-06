import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://esm.sh/zod@3.23.8";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const RegisterNodeSchema = z.object({
  orgName: z.string().trim().min(2).max(200),
  country: z.string().trim().min(2).max(100),
  orgType: z.string().trim().min(1).max(50),
  jurisdiction: z.string().trim().min(2).max(150),
  contactEmail: z.string().email().max(254).optional().nullable(),
  pgpPublicKey: z.string().max(20000).optional().nullable(),
  apiEndpoint: z.string().url().max(500).optional().nullable(),
});

function generateApiKey(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const raw = await req.json().catch(() => ({}));
    const parsed = RegisterNodeSchema.safeParse(raw);
    if (!parsed.success) {
      return new Response(JSON.stringify({ error: 'Invalid input', issues: parsed.error.flatten() }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const { orgName, country, orgType, jurisdiction, contactEmail, pgpPublicKey, apiEndpoint } = parsed.data;

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const userClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user } } = await userClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Service-role client to write hashed key + audit
    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Generate plaintext API key, return ONCE; trigger hashes & nulls plaintext on insert
    const plaintextApiKey = generateApiKey();
    const apiKeyHash = Array.from(new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(plaintextApiKey))
    )).map(b => b.toString(16).padStart(2, '0')).join('');

    const { data: node, error: nodeError } = await admin
      .from('accountability_nodes')
      .insert({
        org_name: orgName,
        country,
        org_type: orgType,
        jurisdiction,
        contact_email: contactEmail ?? null,
        pgp_public_key: pgpPublicKey ?? null,
        api_endpoint: apiEndpoint ?? null,
        api_key_hash: apiKeyHash,
        verified: false,
      })
      .select('id, org_name, verified')
      .single();

    if (nodeError) throw nodeError;

    // Ensure plaintext is not stored (defense-in-depth, trigger also handles)
    await admin.from('accountability_nodes').update({ api_key: null }).eq('id', node.id);

    await admin.from('node_audit_trail').insert({
      node_id: node.id,
      action: 'node_registered',
      status: 'pending_verification',
      metadata: { registered_by: user.id, org_type: orgType, jurisdiction },
    });

    const { data: admins } = await admin
      .from('user_roles').select('user_id').eq('role', 'admin');
    if (admins) {
      for (const a of admins) {
        await admin.from('notifications').insert({
          user_id: a.user_id,
          type: 'info',
          title: 'New Node Registration',
          message: `${orgName} from ${country} has requested to join the accountability network.`,
          division: 'accountability',
          link: `/accountability/nodes/${node.id}`,
        });
      }
    }

    return new Response(JSON.stringify({
      success: true,
      node: {
        id: node.id,
        org_name: node.org_name,
        api_key: plaintextApiKey, // returned ONCE; never stored as plaintext
        verified: node.verified,
        message: 'Node registered. Save your API key now — it will not be shown again.',
      },
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error) {
    console.error('register-node error:', error);
    return new Response(JSON.stringify({ error: 'Registration failed' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
