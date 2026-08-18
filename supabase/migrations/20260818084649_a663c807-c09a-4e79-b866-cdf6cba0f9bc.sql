
DELETE FROM public.planetary_propagation_events WHERE evidence_status IS NULL;

SELECT cron.unschedule('planetary-edge-evidence-weekly')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='planetary-edge-evidence-weekly');
SELECT cron.schedule('planetary-edge-evidence-weekly','20 3 * * 1',
  $$SELECT public.refresh_planetary_edge_evidence();$$);

SELECT cron.unschedule('pns-certification-daily')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='pns-certification-daily');
SELECT cron.schedule('pns-certification-daily','50 4 * * *',
  $$SELECT public.compute_pns_certification();$$);

SELECT public.compute_pns_certification();
