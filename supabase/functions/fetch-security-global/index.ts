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

    // CISA KEV — gold-standard free CVE feed, no auth, no rate limit, allowed from edge IPs.
    // Replaces NVD which 404s consistently from Deno egress.
    await resilientCall(`${FN}:cisa-kev`, async () => {
      const resp = await fetch('https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json', {
        headers: { 'User-Agent': 'AICIS-Intelligence/1.0', 'Accept': 'application/json' },
      });
      if (!resp.ok) throw new Error(`CISA KEV: ${resp.status}`);
      const data = await resp.json();
      const cutoff = Date.now() - 30 * 86400000; // last 30 days
      const recent = (data.vulnerabilities || []).filter((v: any) => {
        const t = Date.parse(v.dateAdded || '');
        return Number.isFinite(t) && t >= cutoff;
      });
      if (recent.length > 0) {
        const cveRecords = recent.map((v: any) => ({
          source: 'cisa_kev',
          event_type: 'vulnerability',
          severity: 'critical', // KEV inclusion implies active exploitation
          title: v.cveID,
          description: `${v.vulnerabilityName || ''} — ${v.shortDescription || ''}`.slice(0, 1000),
          cve_id: v.cveID,
          threat_score: 95,
          metadata: {
            vendor: v.vendorProject,
            product: v.product,
            date_added: v.dateAdded,
            due_date: v.dueDate,
            ransomware_use: v.knownRansomwareCampaignUse,
            required_action: v.requiredAction,
          },
        }));
        const { error } = await supabase.from('security_events').insert(cveRecords);
        if (error) throw new Error(`DB insert: ${error.message}`);
        results.security += cveRecords.length;
        structuredLog('info', FN, `CISA KEV: ${cveRecords.length} actively-exploited CVEs`);
      }
    }, { timeoutMs: TIMEOUT_MS }).catch(e => {
      const msg = `CISA-KEV: ${(e as Error).message}`;
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
