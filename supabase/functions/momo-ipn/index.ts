import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { hmacSha256, jsonResponse } from "../_shared/momo.ts";

Deno.serve(async (req) => {
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  const body = await req.json().catch(() => null);
  if (!body) return jsonResponse({ error: "Invalid JSON" }, 400);

  const accessKey = Deno.env.get("MOMO_ACCESS_KEY")!;
  const secretKey = Deno.env.get("MOMO_SECRET_KEY")!;
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const signatureText =
    "accessKey=" + accessKey +
    "&amount=" + body.amount +
    "&extraData=" + (body.extraData || "") +
    "&message=" + body.message +
    "&orderId=" + body.orderId +
    "&orderInfo=" + body.orderInfo +
    "&orderType=" + body.orderType +
    "&partnerCode=" + body.partnerCode +
    "&payType=" + body.payType +
    "&requestId=" + body.requestId +
    "&responseTime=" + body.responseTime +
    "&resultCode=" + body.resultCode +
    "&transId=" + body.transId;

  const expected = await hmacSha256(secretKey, signatureText);
  if (!body.signature || body.signature !== expected) {
    return jsonResponse({ error: "Invalid signature" }, 401);
  }

  const { data: order, error: orderError } = await supabase
    .from("orders")
    .select("id,user_id,plan,amount,status")
    .eq("provider_order_id", body.orderId)
    .single();

  if (orderError || !order) return jsonResponse({ error: "Order not found" }, 404);

  const configuredPartnerCode = Deno.env.get("MOMO_PARTNER_CODE")!;
  if (body.partnerCode !== configuredPartnerCode) {
    return jsonResponse({ error: "Invalid partnerCode" }, 401);
  }

  if (Number(body.amount) !== Number(order.amount)) {
    return jsonResponse({ error: "Amount mismatch" }, 400);
  }

  const success = Number(body.resultCode) === 0;
  const update = {
    status: success ? "paid" : "failed",
    provider_result_code: Number(body.resultCode),
    provider_message: body.message || null,
    paid_at: success ? new Date().toISOString() : null,
    updated_at: new Date().toISOString(),
  };

  if (order.status === "paid") {
    return jsonResponse({ resultCode: 0, message: "already processed" });
  }

  const { data: claimedOrder, error: updateError } = await supabase
    .from("orders")
    .update(update)
    .eq("id", order.id)
    .neq("status", "paid")
    .select("id")
    .maybeSingle();

  if (updateError) return jsonResponse({ error: "Order update failed" }, 500);
  if (!claimedOrder) return jsonResponse({ resultCode: 0, message: "already processed" });

  if (success) {
    const { data: plan } = await supabase
      .from("plans")
      .select("id,key,token_limit,reset_hours,capabilities,enabled")
      .eq("key", order.plan)
      .maybeSingle();
    if (!plan) return jsonResponse({ error: "Plan configuration not found" }, 500);
    const caps = (plan.capabilities && typeof plan.capabilities === "object") ? plan.capabilities : {};
    await supabase.from("profiles").update({
      plan: plan.key,
      plan_id: plan.id,
      token_limit: Number(plan.token_limit || 0),
      memory_enabled: Boolean(caps.memory),
      vision_enabled: Boolean(caps.vision),
      web_search_enabled: Boolean(caps.webSearch),
      tokens_used: 0,
      token_reset_at: new Date(Date.now() + Number(plan.reset_hours || 6) * 3600000).toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", order.user_id);
  }

  // MoMo expects HTTP 200 from a successfully processed IPN.
  return jsonResponse({ resultCode: 0, message: "received" });
});
