import { useEffect, useState, useRef } from 'react';
import { validateV2 } from '@/lib/performance-engine-v2-validate';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Loader2, Activity, Database, Zap, AlertCircle } from 'lucide-react';
import { AICISLayout } from '@/components/aicis/AICISLayout';
import { supabase } from '@/integrations/supabase/client';
import { PlanetaryScaleMonitor } from '@/components/PlanetaryScaleMonitor';

interface SystemStatus {
  alerts_count: number;
  incidents_count: number;
  satellite_observations: number;
  last_cron_run: string | null;
  functions_status: Record<string, { status: string; last_run?: string }>;
}

export default function Debug() {
  const { session, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!authLoading && !session) {
      navigate('/auth');
    }
  }, [session, authLoading, navigate]);

  const v2Ran = useRef(false);
  useEffect(() => {
    loadStatus();
    if (!v2Ran.current) {
      v2Ran.current = true;
      validateV2();
    }
  }, []);

  const loadStatus = async () => {
    try {
      const [alertsRes, incidentsRes, satelliteRes, logsRes] = await Promise.all([
        supabase.from('critical_alerts').select('id', { count: 'exact', head: true }),
        supabase.from('security_incidents').select('id', { count: 'exact', head: true }),
        supabase.from('satellite_observations').select('id', { count: 'exact', head: true }),
        supabase.from('automation_logs').select('*').order('executed_at', { ascending: false }).limit(10)
      ]);

      setStatus({
        alerts_count: alertsRes.count || 0,
        incidents_count: incidentsRes.count || 0,
        satellite_observations: satelliteRes.count || 0,
        last_cron_run: logsRes.data?.[0]?.executed_at || null,
        functions_status: {
          'fetch-security-incidents': { 
            status: logsRes.data?.find(l => l.job_name.includes('security'))?.status || 'unknown',
            last_run: logsRes.data?.find(l => l.job_name.includes('security'))?.executed_at
          },
          'score-security-incidents': { 
            status: logsRes.data?.find(l => l.job_name.includes('score'))?.status || 'unknown',
            last_run: logsRes.data?.find(l => l.job_name.includes('score'))?.executed_at
          },
          'fetch-satellite-global': { 
            status: satelliteRes.count && satelliteRes.count > 0 ? 'ok' : 'unknown'
          }
        }
      });
    } catch (error) {
      console.error('Failed to load status:', error);
    } finally {
      setLoading(false);
    }
  };

  if (authLoading || loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!session) return null;

  return (
    <AICISLayout>
    <div className="container mx-auto py-8 px-4">
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold">AICIS System Diagnostics</h1>
          <p className="text-muted-foreground">Real-time system health and data pipeline status</p>
        </div>

        {/* Data Metrics */}
        <div className="grid gap-4 md:grid-cols-3">
          <Card className="p-6">
            <div className="flex items-center gap-3">
              <AlertCircle className="h-8 w-8 text-destructive" />
              <div>
                <p className="text-sm text-muted-foreground">Critical Alerts</p>
                <p className="text-3xl font-bold">{status?.alerts_count || 0}</p>
              </div>
            </div>
          </Card>

          <Card className="p-6">
            <div className="flex items-center gap-3">
              <Database className="h-8 w-8 text-primary" />
              <div>
                <p className="text-sm text-muted-foreground">Security Incidents</p>
                <p className="text-3xl font-bold">{status?.incidents_count || 0}</p>
              </div>
            </div>
          </Card>

          <Card className="p-6">
            <div className="flex items-center gap-3">
              <Activity className="h-8 w-8 text-primary" />
              <div>
                <p className="text-sm text-muted-foreground">Satellite Observations</p>
                <p className="text-3xl font-bold">{status?.satellite_observations || 0}</p>
              </div>
            </div>
          </Card>
        </div>

        {/* Function Status */}
        <Card className="p-6">
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <Zap className="h-5 w-5 text-primary" />
              <h2 className="text-xl font-semibold">Edge Functions Status</h2>
            </div>
            
            <div className="space-y-3">
              {status && Object.entries(status.functions_status).map(([name, info]) => (
                <div key={name} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                  <div>
                    <p className="font-medium">{name}</p>
                    {info.last_run && (
                      <p className="text-xs text-muted-foreground">
                        Last run: {new Date(info.last_run).toLocaleString()}
                      </p>
                    )}
                  </div>
                  <Badge variant={info.status === 'ok' || info.status === 'success' ? 'default' : 'secondary'}>
                    {info.status}
                  </Badge>
                </div>
              ))}
            </div>
          </div>
        </Card>

        {/* Last Cron Run */}
        {status?.last_cron_run && (
          <Card className="p-6">
            <p className="text-sm text-muted-foreground">
              Last automated task: {new Date(status.last_cron_run).toLocaleString()}
            </p>
          </Card>
        )}

        {/* Planetary Scale Monitor */}
        <PlanetaryScaleMonitor />
      </div>
    </div>
    </AICISLayout>
  );
}
