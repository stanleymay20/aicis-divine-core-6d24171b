import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const start = performance.now();

  try {
    // Allow: (a) service-role bearer (cron), or (b) authenticated admin user
    const authHeader = req.headers.get('Authorization') ?? '';
    const bearer = authHeader.replace(/^Bearer\s+/i, '');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const isServiceRole = bearer && bearer === serviceRoleKey;

    if (!isServiceRole) {
      if (!authHeader) {
        return new Response(JSON.stringify({ status: 'unauthorized' }), {
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
        return new Response(JSON.stringify({ status: 'unauthorized' }), {
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const adminCheck = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        serviceRoleKey
      );
      const { data: roles } = await adminCheck.from('user_roles').select('role').eq('user_id', user.id);
      const isAdmin = roles?.some((r: any) => r.role === 'admin');
      if (!isAdmin) {
        return new Response(JSON.stringify({ status: 'forbidden' }), {
          status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? '',
      serviceRoleKey
    );

    const envVars = [
      "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_ANON_KEY",
      "ALPHAVANTAGE_API_KEY", "EIA_API_KEY", "ABUSEIPDB_API_KEY",
      "NEWSAPI_KEY", "OPENWEATHER_API_KEY"
    ];

    const missingEnv = envVars.filter(v => !Deno.env.get(v));
    const failedAPIs: any[] = [];
    const failedTables: string[] = [];

    // Test API helper
    async function testAPI(name: string, url: string, headers?: Record<string, string>) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        
        const r = await fetch(url, { 
          headers: headers || {},
          signal: controller.signal 
        });
        clearTimeout(timeout);
        
        if (!r.ok && r.status !== 401) throw new Error(`Status ${r.status}`);
        return { name, ok: true, status: r.status };
      } catch (e: unknown) {
        const errorMsg = e instanceof Error ? e.message : 'Unknown error';
        failedAPIs.push({ name, error: errorMsg });
        return { name, ok: false, error: errorMsg };
      }
    }

    // Test critical APIs
    const apiTests = await Promise.all([
      testAPI("WHO", "https://ghoapi.azureedge.net/api/WHOSIS_000001?$top=1"),
      testAPI("WorldBank", "https://api.worldbank.org/v2/country/USA/indicator/NY.GDP.MKTP.CD?format=json&per_page=1"),
      testAPI("GDELT", "https://api.gdeltproject.org/api/v2/doc/doc?query=test&mode=artlist&maxrecords=1&format=json")
    ]);

    console.log('API test results:', apiTests);

    // Check table access
    const tables = [
      "security_incidents", "critical_alerts", "satellite_observations",
      "governance_global", "vulnerability_scores", "system_errors"
    ];

    for (const tbl of tables) {
      try {
        const { error } = await supabase.from(tbl).select("id").limit(1);
        if (error) {
          console.error(`Table ${tbl} error:`, error);
          failedTables.push(tbl);
        }
      } catch (e) {
        console.error(`Table ${tbl} exception:`, e);
        failedTables.push(tbl);
      }
    }

    const apiHealthy = apiTests.filter((t) => t.ok).length;
    const criticalFailure = missingEnv.length > 0 || failedTables.length > 0 || apiHealthy === 0;
    const degraded = !criticalFailure && failedAPIs.length > 0;

    const diagnostics = {
      status: criticalFailure ? 'down' : degraded ? 'degraded' : 'healthy',
      missing_env: missingEnv,
      failed_apis: failedAPIs,
      failed_tables: failedTables,
      api_summary: {
        total: apiTests.length,
        healthy: apiHealthy,
        degraded: failedAPIs.length,
      },
      latency_ms: Math.round(performance.now() - start)
    };

    // Log diagnostics
    await supabase.from("diagnostics_log").insert(diagnostics);

    // Log errors if system is degraded or down
    if (diagnostics.status !== 'healthy') {
      await supabase.from("system_errors").insert({
        component: "diagnostic",
        message: diagnostics.status === 'down' ? "Critical system issues detected" : "External dependency degradation detected",
        details: diagnostics,
        severity: criticalFailure ? 'high' : 'medium'
      });
    }

    console.log('Diagnostics complete:', diagnostics);

    await supabase.rpc("register_pipeline_heartbeat", {
      _pipeline_name: "log-system-health",
      _success: !criticalFailure,
      _metadata: {
        status: diagnostics.status,
        failed_apis: failedAPIs.length,
        failed_tables: failedTables.length,
        missing_env: missingEnv.length,
        healthy_apis: apiHealthy,
      },
    });

    return new Response(JSON.stringify({
      ok: !criticalFailure,
      ...diagnostics,
      timestamp: new Date().toISOString()
    }, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });

  } catch (error) {
    console.error('Error in log-system-health:', error);

    try {
      const sb = createClient(
        Deno.env.get("SUPABASE_URL") ?? '',
        Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ''
      );
      await sb.rpc("register_pipeline_heartbeat", {
        _pipeline_name: "log-system-health",
        _success: false,
        _error: error instanceof Error ? error.message : 'Unknown error',
      });
    } catch (_) { /* ignore */ }

    return new Response(JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" }
    });
  }
});
