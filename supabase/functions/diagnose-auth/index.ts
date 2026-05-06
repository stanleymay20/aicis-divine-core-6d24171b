import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { structuredLog, handleCors, errorResponse, jsonResponse } from '../_shared/resilience.ts';

const FN = 'diagnose-auth';

Deno.serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  const start = Date.now();

  try {
    // Require authenticated admin
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return jsonResponse({ status: 'unauthorized' }, 401);
    }

    const userClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return jsonResponse({ status: 'unauthorized' }, 401);

    const admin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );
    const { data: roles } = await admin
      .from('user_roles').select('role').eq('user_id', user.id);
    const isAdmin = roles?.some((r: any) => r.role === 'admin');
    if (!isAdmin) return jsonResponse({ status: 'forbidden' }, 403);

    // Run diagnostics; only return generic status enum to caller
    const required = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];
    const missing = required.filter((v) => !Deno.env.get(v));

    let dbOk = true;
    try {
      const { error } = await admin.from('user_roles').select('user_id').limit(1);
      if (error) dbOk = false;
    } catch { dbOk = false; }

    let authOk = true;
    try {
      await admin.auth.getSession();
    } catch { authOk = false; }

    const status = missing.length > 0 || !dbOk || !authOk
      ? (missing.length > 0 || !dbOk ? 'down' : 'degraded')
      : 'healthy';

    // Write full diagnostic detail to internal log (admin-only RLS expected on system_errors)
    if (status !== 'healthy') {
      await admin.from('system_errors').insert({
        component: 'diagnose-auth',
        message: `Diagnostic status: ${status}`,
        details: { missing, dbOk, authOk },
        severity: status === 'down' ? 'high' : 'medium',
      });
    }

    structuredLog('info', FN, 'Diagnosis complete', { status }, start);
    return jsonResponse({ status, timestamp: new Date().toISOString() });
  } catch (err: any) {
    structuredLog('error', FN, err.message, undefined, start);
    return errorResponse(new Error('Diagnostic failure'));
  }
});
