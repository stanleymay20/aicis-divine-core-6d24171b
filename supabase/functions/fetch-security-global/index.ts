import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resilientCall, structuredLog, handleCors, corsHeaders, errorResponse, jsonResponse } from "../_shared/resilience.ts";

const FN = "fetch-security-global";
const TIMEOUT_MS = 15000;

serve(async (req) => {
  const cors = handleCors(req);
  if (cors) return cors;

  const start = Date.now();

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
    );

    const NVD_KEY = Deno.env.get("NVD_API_KEY");
    const ABUSEIPDB_KEY = Deno.env.get("ABUSEIPDB_API_KEY");
    structuredLog('info', FN, 'Starting security data collection');
    const results: { security: number; errors: string[] } = { security: 0, errors: [] };

    // NVD - Recent CVEs (NVD requires User-Agent; rejects empty UA with 403/404)
    await resilientCall(`${FN}:nvd`, async () => {
      const nvdHeaders: Record<string, string> = {
        'User-Agent': 'AICIS-Intelligence/1.0 (planetary-coordination)',
        'Accept': 'application/json',
      };
      if (NVD_KEY) nvdHeaders['apiKey'] = NVD_KEY;
      // Pull last 7 days of CVEs to get a real flow rather than the same top-20 each run
      const end = new Date();
      const start = new Date(end.getTime() - 7 * 24 * 3600 * 1000);
      const fmt = (d: Date) => d.toISOString().replace(/\.\d{3}Z$/, '.000');
      const nvdResponse = await fetch(
        `https://services.nvd.nist.gov/rest/json/cves/2.0?lastModStartDate=${fmt(start)}&lastModEndDate=${fmt(end)}&resultsPerPage=50`,
        { headers: nvdHeaders }
      );
      if (!nvdResponse.ok) throw new Error(`NVD API: ${nvdResponse.status}`);
      const nvdData = await nvdResponse.json();

      if (nvdData.vulnerabilities) {
        const cveRecords = nvdData.vulnerabilities.map((v: any) => {
          const cve = v.cve;
          const severity = cve.metrics?.cvssMetricV31?.[0]?.cvssData?.baseSeverity ||
                          cve.metrics?.cvssMetricV2?.[0]?.baseSeverity || 'UNKNOWN';
          return {
            source: 'nvd', event_type: 'vulnerability',
            severity: severity.toLowerCase(),
            title: cve.id,
            description: cve.descriptions?.[0]?.value || 'No description',
            cve_id: cve.id,
            threat_score: Math.round((cve.metrics?.cvssMetricV31?.[0]?.cvssData?.baseScore || 0) * 10),
            metadata: { published: cve.published, modified: cve.lastModified }
          };
        });

        const { error } = await supabase.from('security_events').insert(cveRecords);
        if (error) throw new Error(`DB insert: ${error.message}`);
        results.security += cveRecords.length;
        structuredLog('info', FN, `NVD: ${cveRecords.length} CVEs`);
      }
    }, { timeoutMs: TIMEOUT_MS }).catch(e => {
      const msg = `NVD: ${(e as Error).message}`;
      results.errors.push(msg);
      structuredLog('warn', FN, msg);
    });

    // AbuseIPDB
    await resilientCall(`${FN}:abuseipdb`, async () => {
      if (!ABUSEIPDB_KEY) { structuredLog('warn', FN, 'No ABUSEIPDB_API_KEY'); return; }
      const badIPs = ['185.220.101.1', '45.148.10.1'];
      for (const ip of badIPs) {
        try {
          const resp = await fetch(`https://api.abuseipdb.com/api/v2/check?ipAddress=${ip}`, {
            headers: { 'Key': ABUSEIPDB_KEY, 'Accept': 'application/json' }
          });
          if (!resp.ok) { structuredLog('warn', FN, `AbuseIPDB ${ip}: ${resp.status}`); continue; }
          const data = await resp.json();
          if (data.data && data.data.abuseConfidenceScore > 20) {
            const { error } = await supabase.from('security_events').insert({
              source: 'abuseipdb', event_type: 'ip_abuse',
              severity: data.data.abuseConfidenceScore > 80 ? 'critical' :
                       data.data.abuseConfidenceScore > 50 ? 'high' : 'medium',
              title: `Suspicious IP: ${ip}`,
              description: `Abuse confidence: ${data.data.abuseConfidenceScore}%`,
              ip_address: ip, threat_score: data.data.abuseConfidenceScore,
              metadata: { country: data.data.countryCode, total_reports: data.data.totalReports }
            });
            if (!error) results.security++;
          }
        } catch (e) {
          structuredLog('warn', FN, `AbuseIPDB ${ip}: ${(e as Error).message}`);
        }
      }
    }, { timeoutMs: TIMEOUT_MS }).catch(e => {
      const msg = `AbuseIPDB: ${(e as Error).message}`;
      results.errors.push(msg);
      structuredLog('warn', FN, msg);
    });

    await supabase.from('automation_logs').insert({
      job_name: FN,
      status: results.errors.length === 0 ? 'success' : (results.security > 0 ? 'partial' : 'error'),
      message: `Fetched ${results.security} security events. Errors: ${results.errors.length}${results.errors.length > 0 ? ` [${results.errors.join('; ')}]` : ''}`
    });

    structuredLog('info', FN, `Complete: ${results.security} records, ${results.errors.length} errors`, undefined, start);
    return jsonResponse({ ok: true, message: `Fetched ${results.security} security events`, data: results });
  } catch (e) {
    structuredLog('error', FN, (e as Error).message, undefined, start);
    const supabase = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
    await supabase.from('automation_logs').insert({ job_name: FN, status: 'error', message: (e as Error).message });
    return errorResponse(e);
  }
});
