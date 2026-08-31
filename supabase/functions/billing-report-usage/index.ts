import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Stripe from "https://esm.sh/stripe@14.21.0";
import { requireAdminOrCron } from "../_shared/auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

interface UsageRecord {
  id: string;
  org_id: string | null;
  metric_key: string;
  quantity: number | string | null;
  recorded_at: string;
}

interface BillingError {
  group: string;
  reason: string;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, "Content-Type": "application/json" },
});

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const auth = await requireAdminOrCron(req, corsHeaders);
  if (auth.response) return auth.response;

  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
  if (!stripeKey) return json({ error: "Stripe is not configured" }, 503);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );
  const stripe = new Stripe(stripeKey, { apiVersion: "2023-10-16" });

  try {
    const { data: rawUsage, error: fetchError } = await supabase
      .from("billing_usage_queue")
      .select("id,org_id,metric_key,quantity,recorded_at")
      .eq("processed", false)
      .order("recorded_at", { ascending: true })
      .limit(1000);
    if (fetchError) throw fetchError;

    const usageRecords = (rawUsage ?? []) as UsageRecord[];
    if (usageRecords.length === 0) return json({ ok: true, processed: 0, skipped: 0, errors: [] });

    const metricPriceMap: Record<string, string> = {
      api_calls: Deno.env.get("STRIPE_PRICE_API_CALLS") ?? "",
      scrollcoin_tx: Deno.env.get("STRIPE_PRICE_SCROLLCOIN_TX") ?? "",
    };

    const grouped = new Map<string, UsageRecord[]>();
    for (const record of usageRecords) {
      if (!record.org_id || !record.metric_key) continue;
      const key = `${record.org_id}:${record.metric_key}`;
      grouped.set(key, [...(grouped.get(key) ?? []), record]);
    }

    let processed = 0;
    let skipped = usageRecords.length - [...grouped.values()].reduce((sum, records) => sum + records.length, 0);
    const errors: BillingError[] = [];

    for (const [groupKey, records] of grouped) {
      const separator = groupKey.lastIndexOf(":");
      const orgId = groupKey.slice(0, separator);
      const metricKey = groupKey.slice(separator + 1);
      const priceId = metricPriceMap[metricKey];

      if (!priceId) {
        skipped += records.length;
        errors.push({ group: metricKey, reason: "metric_price_not_configured" });
        continue;
      }

      const { data: org, error: orgError } = await supabase
        .from("organizations")
        .select("stripe_subscription_id")
        .eq("id", orgId)
        .maybeSingle();
      if (orgError) {
        errors.push({ group: metricKey, reason: `organization_lookup_failed:${orgError.message}` });
        continue;
      }
      if (!org?.stripe_subscription_id) {
        skipped += records.length;
        errors.push({ group: metricKey, reason: "organization_has_no_subscription" });
        continue;
      }

      try {
        const subscription = await stripe.subscriptions.retrieve(org.stripe_subscription_id);
        const subscriptionItem = subscription.items.data.find((item: { price: { id: string } }) => item.price.id === priceId);
        if (!subscriptionItem) {
          skipped += records.length;
          errors.push({ group: metricKey, reason: "subscription_item_not_found" });
          continue;
        }

        const quantities = records.map((record) => Number(record.quantity));
        if (quantities.some((quantity) => !Number.isFinite(quantity) || quantity < 0)) {
          errors.push({ group: metricKey, reason: "invalid_usage_quantity" });
          continue;
        }
        const totalQuantity = quantities.reduce((sum, quantity) => sum + quantity, 0);
        if (!Number.isSafeInteger(totalQuantity) || totalQuantity <= 0) {
          errors.push({ group: metricKey, reason: "usage_quantity_must_be_positive_integer" });
          continue;
        }

        const timestamps = records
          .map((record) => Math.floor(new Date(record.recorded_at).getTime() / 1000))
          .filter((timestamp) => Number.isFinite(timestamp));
        const usageTimestamp = timestamps.length > 0
          ? Math.min(Math.max(...timestamps), Math.floor(Date.now() / 1000))
          : Math.floor(Date.now() / 1000);

        await stripe.subscriptionItems.createUsageRecord(subscriptionItem.id, {
          quantity: totalQuantity,
          timestamp: usageTimestamp,
          action: "increment",
        });

        const recordIds = records.map((record) => record.id);
        const { error: updateError } = await supabase
          .from("billing_usage_queue")
          .update({ processed: true })
          .in("id", recordIds);
        if (updateError) {
          // Stripe accepted the usage. Do not retry blindly: the queue state now
          // needs operator reconciliation to avoid double-reporting.
          errors.push({ group: metricKey, reason: `stripe_reported_queue_update_failed:${updateError.message}` });
          continue;
        }
        processed += records.length;
      } catch (error) {
        errors.push({ group: metricKey, reason: error instanceof Error ? error.message : String(error) });
      }
    }

    const { error: logError } = await supabase.from("system_logs").insert({
      division: "system",
      action: "billing_report_usage",
      log_level: errors.length > 0 ? "warn" : "info",
      result: `Billing usage report processed=${processed} skipped=${skipped} errors=${errors.length}`,
      metadata: { processed, skipped, error_count: errors.length, invoked_via: auth.via },
    });
    if (logError) console.error("billing-report-usage audit log failed", logError.message);

    return json({ ok: errors.length === 0, processed, skipped, errors });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("billing-report-usage error", message);
    return json({ error: message }, 500);
  }
});
