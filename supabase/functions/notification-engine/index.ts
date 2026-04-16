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
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const body = await req.json().catch(() => ({}));
    const action = body.action || 'process_queue';

    if (action === 'process_queue') {
      // Process pending notifications from critical_alerts
      const { data: unacked } = await supabase
        .from('critical_alerts')
        .select('*')
        .eq('acknowledged', false)
        .order('triggered_at', { ascending: false })
        .limit(50);

      if (!unacked?.length) {
        return new Response(JSON.stringify({ ok: true, processed: 0 }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        });
      }

      // Get all users with notification preferences (analysts and admins)
      const { data: users } = await supabase
        .from('profiles')
        .select('id, email, full_name')
        .limit(100);

      // For each critical alert, create in-app notification records
      const notifications = unacked.map(alert => ({
        user_id: null, // broadcast
        type: 'critical_alert',
        title: `[${alert.level}] ${alert.headline}`,
        body: `Country: ${alert.country || 'Global'} | Event: ${alert.event_type || 'Unknown'} | Severity: ${alert.severity}/10`,
        metadata: {
          alert_id: alert.id,
          iso3: alert.iso3,
          level: alert.level,
          severity: alert.severity,
        },
        read: false,
        created_at: new Date().toISOString(),
      }));

      // Store notifications (we'll create the table if needed)
      const { error: notifError } = await supabase
        .from('user_notifications')
        .insert(notifications);

      if (notifError && notifError.code === '42P01') {
        // Table doesn't exist yet - will be created via migration
        console.log('user_notifications table not yet created');
      }

      // Log the processing
      await supabase.from('automation_logs').insert({
        job_name: 'notification-engine',
        status: 'success',
        message: `Processed ${unacked.length} alerts for ${users?.length || 0} users`,
      });

      return new Response(JSON.stringify({
        ok: true,
        processed: unacked.length,
        users_notified: users?.length || 0,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });

    } else if (action === 'send_digest') {
      // Daily digest: summarize last 24h alerts
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      
      const [alertsRes, decisionsRes, eventsRes] = await Promise.all([
        supabase.from('critical_alerts').select('*').gte('triggered_at', since).order('severity', { ascending: false }),
        supabase.from('adi_decisions').select('*').gte('created_at', since).order('severity_score', { ascending: false }),
        supabase.from('normalized_events').select('event_type, category, country_iso3, severity').gte('occurred_at', since),
      ]);

      const digest = {
        period: '24h',
        generated_at: new Date().toISOString(),
        alerts: {
          total: alertsRes.data?.length || 0,
          critical: alertsRes.data?.filter(a => a.level === 'critical').length || 0,
          high: alertsRes.data?.filter(a => a.level === 'high').length || 0,
        },
        decisions: {
          total: decisionsRes.data?.length || 0,
          approved: decisionsRes.data?.filter(d => d.status === 'approved').length || 0,
          pending: decisionsRes.data?.filter(d => d.status === 'pending').length || 0,
        },
        events: {
          total: eventsRes.data?.length || 0,
          by_category: eventsRes.data?.reduce((acc: Record<string, number>, e: any) => {
            acc[e.category] = (acc[e.category] || 0) + 1;
            return acc;
          }, {}),
        },
        top_alerts: alertsRes.data?.slice(0, 5).map(a => ({
          headline: a.headline,
          level: a.level,
          country: a.country,
          severity: a.severity,
        })),
      };

      return new Response(JSON.stringify({ ok: true, digest }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    return new Response(JSON.stringify({ ok: false, error: 'Unknown action' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Notification engine error:', error);
    return new Response(JSON.stringify({
      ok: false, error: error instanceof Error ? error.message : 'Unknown error'
    }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
});
